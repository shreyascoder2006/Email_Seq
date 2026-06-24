import { Request, Response } from 'express';
import { env } from '../config/env';
import { EmailConnection, ProviderType, ConnectionStatus } from '../models/EmailConnection';
import { encrypt } from '../utils/crypto';
import logger from '../config/logger';
import { AuthenticatedRequest } from '../types';

const FRONTEND_URL = env.CORS_ORIGIN;

const GOOGLE_AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
const GOOGLE_USERINFO_URL = 'https://www.googleapis.com/oauth2/v2/userinfo';

const MS_AUTH_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/authorize';
const MS_TOKEN_URL = 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
const MS_USERINFO_URL = 'https://graph.microsoft.com/v1.0/me';

// Utility
async function saveOauthConnection(
  userId: string,
  provider: ProviderType,
  email: string,
  refreshToken: string
) {
  let connection = await EmailConnection.findOne({ user_id: userId, from_email: email });
  const encryptedRefresh = encrypt(refreshToken);

  if (connection) {
    connection.auth_method = 'oauth2';
    connection.provider = provider;
    connection.oauth_refresh_token_enc = encryptedRefresh;
    connection.status = ConnectionStatus.ACTIVE;
    connection.failure_reason = undefined;
    
    if (provider === ProviderType.GMAIL) {
        connection.smtp_host = 'smtp.gmail.com';
        connection.smtp_port = 465;
        connection.smtp_encryption = 'ssl' as any;
    } else if (provider === ProviderType.OUTLOOK) {
        connection.smtp_host = 'smtp.office365.com';
        connection.smtp_port = 587;
        connection.smtp_encryption = 'tls' as any;
    }
    await connection.save();
  } else {
    // New connection
    connection = new EmailConnection({
      user_id: userId,
      label: `${provider === ProviderType.GMAIL ? 'Gmail' : 'Outlook'} - ${email}`,
      from_name: email.split('@')[0],
      from_email: email,
      provider: provider,
      auth_method: 'oauth2',
      oauth_refresh_token_enc: encryptedRefresh,
      status: ConnectionStatus.ACTIVE,
      smtp_host: provider === ProviderType.GMAIL ? 'smtp.gmail.com' : 'smtp.office365.com',
      smtp_port: provider === ProviderType.GMAIL ? 465 : 587,
      smtp_encryption: provider === ProviderType.GMAIL ? 'ssl' : 'tls',
    });
    await connection.save();
  }
}

// ─── GOOGLE ─────────────────────────────────────────────────────────

export const googleAuth = (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).user!.userId;
  const scope = encodeURIComponent('https://mail.google.com/ https://www.googleapis.com/auth/userinfo.email');
  const redirectUri = encodeURIComponent(env.GOOGLE_REDIRECT_URI || `${env.APP_BASE_URL}/api/oauth/google/callback`);
  
  const authUrl = `${GOOGLE_AUTH_URL}?client_id=${env.GOOGLE_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&access_type=offline&prompt=consent&state=${userId}`;
  res.redirect(authUrl);
};

export const googleCallback = async (req: Request, res: Response) => {
  try {
    const { code, state, error } = req.query;
    
    if (error) {
      logger.warn('Google OAuth error', { error });
      return res.redirect(`${FRONTEND_URL}/email-accounts?oauth_error=${error}`);
    }

    if (!code || !state) {
      return res.redirect(`${FRONTEND_URL}/email-accounts?oauth_error=invalid_request`);
    }

    const userId = state as string;
    const redirectUri = env.GOOGLE_REDIRECT_URI || `${env.APP_BASE_URL}/api/oauth/google/callback`;

    // 1. Exchange code for tokens
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: code as string,
        client_id: env.GOOGLE_CLIENT_ID || '',
        client_secret: env.GOOGLE_CLIENT_SECRET || '',
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenRes.json() as any;

    if (!tokenRes.ok || !tokenData.access_token) {
      logger.error('Google token exchange failed', tokenData);
      return res.redirect(`${FRONTEND_URL}/email-accounts?oauth_error=token_exchange_failed`);
    }

    // Refresh token is only sent on first authorization (prompt=consent)
    const refreshToken = tokenData.refresh_token;
    if (!refreshToken) {
      logger.warn('No refresh token provided by Google. User may need to revoke app access and try again.');
      return res.redirect(`${FRONTEND_URL}/email-accounts?oauth_error=no_refresh_token`);
    }

    // 2. Fetch User Profile (email)
    const profileRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profileData = await profileRes.json() as any;
    
    if (!profileRes.ok || !profileData.email) {
      return res.redirect(`${FRONTEND_URL}/email-accounts?oauth_error=profile_fetch_failed`);
    }

    const email = profileData.email.toLowerCase();

    // 3. Save connection
    await saveOauthConnection(userId, ProviderType.GMAIL, email, refreshToken);

    res.redirect(`${FRONTEND_URL}/email-accounts?oauth_success=true`);
  } catch (err) {
    logger.error('Google Callback Error', err);
    res.redirect(`${FRONTEND_URL}/email-accounts?oauth_error=internal_server_error`);
  }
};

// ─── MICROSOFT ──────────────────────────────────────────────────────

export const microsoftAuth = (req: Request, res: Response) => {
  const userId = (req as AuthenticatedRequest).user!.userId;
  const scope = encodeURIComponent('offline_access user.read mail.send mail.readwrite');
  const redirectUri = encodeURIComponent(env.MICROSOFT_REDIRECT_URI || `${env.APP_BASE_URL}/api/oauth/microsoft/callback`);
  
  const authUrl = `${MS_AUTH_URL}?client_id=${env.MICROSOFT_CLIENT_ID}&redirect_uri=${redirectUri}&response_type=code&scope=${scope}&prompt=select_account&state=${userId}`;
  res.redirect(authUrl);
};

export const microsoftCallback = async (req: Request, res: Response) => {
  try {
    const { code, state, error, error_description } = req.query;
    
    if (error) {
      logger.warn('Microsoft OAuth error', { error, error_description });
      return res.redirect(`${FRONTEND_URL}/email-accounts?oauth_error=${error}`);
    }

    if (!code || !state) {
      return res.redirect(`${FRONTEND_URL}/email-accounts?oauth_error=invalid_request`);
    }

    const userId = state as string;
    const redirectUri = env.MICROSOFT_REDIRECT_URI || `${env.APP_BASE_URL}/api/oauth/microsoft/callback`;

    // 1. Exchange code for tokens
    const tokenRes = await fetch(MS_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        client_id: env.MICROSOFT_CLIENT_ID || '',
        client_secret: env.MICROSOFT_CLIENT_SECRET || '',
        code: code as string,
        redirect_uri: redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    const tokenData = await tokenRes.json() as any;

    if (!tokenRes.ok || !tokenData.access_token) {
      logger.error('Microsoft token exchange failed', tokenData);
      return res.redirect(`${FRONTEND_URL}/email-accounts?oauth_error=token_exchange_failed`);
    }

    const refreshToken = tokenData.refresh_token;
    if (!refreshToken) {
      return res.redirect(`${FRONTEND_URL}/email-accounts?oauth_error=no_refresh_token`);
    }

    // 2. Fetch User Profile
    const profileRes = await fetch(MS_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });
    const profileData = await profileRes.json() as any;
    
    if (!profileRes.ok || (!profileData.mail && !profileData.userPrincipalName)) {
      return res.redirect(`${FRONTEND_URL}/email-accounts?oauth_error=profile_fetch_failed`);
    }

    const email = (profileData.mail || profileData.userPrincipalName).toLowerCase();

    // 3. Save connection
    await saveOauthConnection(userId, ProviderType.OUTLOOK, email, refreshToken);

    res.redirect(`${FRONTEND_URL}/email-accounts?oauth_success=true`);
  } catch (err) {
    logger.error('Microsoft Callback Error', err);
    res.redirect(`${FRONTEND_URL}/email-accounts?oauth_error=internal_server_error`);
  }
};
