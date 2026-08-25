import nodemailer from 'nodemailer';
import { Types } from 'mongoose';
import { EmailConnection, IEmailConnection, ConnectionStatus, SmtpEncryption, ProviderType } from '../models/EmailConnection';
import { encrypt, decrypt } from '../utils/crypto';
import { AppError } from '../utils/AppError';
import logger from '../config/logger';
import {
  CreateEmailConnectionDto,
  UpdateEmailConnectionDto,
} from '../validators/emailConnection.validator';
import { env } from '../config/env';
import { Sequence, SequenceStatus } from '../models/Sequence';
import { SequenceStep } from '../models/SequenceStep';

// ─── Types ─────────────────────────────────────────────────────────

/** Safe version of IEmailConnection — never includes raw passwords */
export type SafeEmailConnection = Omit<
  IEmailConnection,
  'smtp_password_enc' | 'imap_password_enc'
> & {
  has_imap: boolean;
};

export interface SmtpTestResult {
  success: boolean;
  message: string;
  latency_ms?: number;
}

export interface ImapTestResult {
  success: boolean;
  message: string;
}

export interface ConnectionTestResult {
  smtp: SmtpTestResult;
  imap?: ImapTestResult;
}

// ─── Sanitizer — strip encrypted password fields from output ───────
function sanitize(doc: IEmailConnection): SafeEmailConnection {
  const obj = doc.toObject({ virtuals: false }) as Record<string, unknown>;

  delete obj.smtp_password_enc;
  delete obj.imap_password_enc;

  return {
    ...obj,
    has_imap: !!(doc.imap_host && doc.imap_username),
  } as SafeEmailConnection;
}

// ─── Service ───────────────────────────────────────────────────────
export class EmailConnectionService {

  // ── CREATE ────────────────────────────────────────────────────────
  async create(
    userId: string,
    dto: CreateEmailConnectionDto
  ): Promise<SafeEmailConnection> {
    // Check for duplicate from_email per user
    const existing = await EmailConnection.findOne({
      user_id: userId,
      from_email: dto.from_email.toLowerCase(),
    });
    if (existing) {
      throw AppError.conflict(
        `An email account with address "${dto.from_email}" already exists`
      );
    }

    const doc = new EmailConnection({
      user_id:           new Types.ObjectId(userId),
      label:             dto.label,
      from_name:         dto.from_name,
      from_email:        dto.from_email.toLowerCase(),
      reply_to:          dto.reply_to,
      provider:          dto.provider,

      // SMTP
      smtp_host:         dto.smtp_host,
      smtp_port:         dto.smtp_port,
      smtp_encryption:   dto.smtp_encryption,
      smtp_username:     dto.smtp_username,
      smtp_password_enc: dto.smtp_password ? encrypt(dto.smtp_password.replace(/\s+/g, '')) : undefined,

      // IMAP (optional)
      imap_host:         dto.imap_host         || undefined,
      imap_port:         dto.imap_port         || undefined,
      imap_encryption:   dto.imap_encryption   || undefined,
      imap_username:     dto.imap_username      || undefined,
      imap_password_enc: dto.imap_password
        ? encrypt(dto.imap_password.replace(/\s+/g, ''))
        : undefined,

      daily_limit:           dto.daily_limit,
      hourly_limit:          dto.hourly_limit,
      min_interval_seconds:  dto.min_interval_seconds,

      status: ConnectionStatus.PENDING,
    });

    await doc.save();

    logger.info('EmailConnection created', {
      connectionId: doc._id,
      userId,
      from_email: dto.from_email,
    });

    return sanitize(doc);
  }

  // ── LIST (user's connections) ─────────────────────────────────────
  async findAll(userId: string): Promise<SafeEmailConnection[]> {
    const docs = await EmailConnection.find({ user_id: userId })
      .sort({ created_at: -1 })
      .lean<IEmailConnection[]>();

    // lean() returns plain objects — strip manually
    return docs.map((doc) => {
      const { smtp_password_enc, imap_password_enc, ...safe } = doc as any;
      return { ...safe, has_imap: !!(doc.imap_host && doc.imap_username) };
    });
  }

  // ── GET ONE ───────────────────────────────────────────────────────
  async findById(
    userId: string,
    connectionId: string
  ): Promise<SafeEmailConnection> {
    const doc = await EmailConnection.findOne({
      _id: connectionId,
      user_id: userId,
    });

    if (!doc) {
      throw AppError.notFound('Email connection');
    }

    return sanitize(doc);
  }

  // ── UPDATE ────────────────────────────────────────────────────────
  async update(
    userId: string,
    connectionId: string,
    dto: UpdateEmailConnectionDto
  ): Promise<SafeEmailConnection> {
    const doc = await EmailConnection.findOne({
      _id: connectionId,
      user_id: userId,
    });

    if (!doc) throw AppError.notFound('Email connection');

    // Apply updates
    if (dto.label)      doc.label      = dto.label;
    if (dto.from_name)  doc.from_name  = dto.from_name;
    if (dto.from_email) doc.from_email = dto.from_email.toLowerCase();
    if (dto.reply_to !== undefined) doc.reply_to = dto.reply_to ?? undefined;
    if (dto.provider)   doc.provider   = dto.provider;

    if (dto.smtp_host)       doc.smtp_host       = dto.smtp_host;
    if (dto.smtp_port)       doc.smtp_port       = dto.smtp_port;
    if (dto.smtp_encryption) doc.smtp_encryption = dto.smtp_encryption;
    if (dto.smtp_username)   doc.smtp_username   = dto.smtp_username;

    // Only re-encrypt password if a new one is provided
    if (dto.smtp_password) {
      doc.smtp_password_enc = encrypt(dto.smtp_password.replace(/\s+/g, ''));
      // Mark as pending re-verification after password change
      doc.status = ConnectionStatus.PENDING;
    }

    if (dto.imap_host !== undefined)  doc.imap_host     = dto.imap_host ?? undefined;
    if (dto.imap_port)                doc.imap_port     = dto.imap_port;
    if (dto.imap_encryption)          doc.imap_encryption = dto.imap_encryption;
    if (dto.imap_username !== undefined) doc.imap_username = dto.imap_username ?? undefined;

    if (dto.imap_password !== undefined && dto.imap_password !== null) {
      doc.imap_password_enc = encrypt(dto.imap_password.replace(/\s+/g, ''));
    } else if (dto.imap_password === null) {
      doc.imap_password_enc = undefined;
    }

    if (dto.daily_limit !== undefined)          doc.daily_limit           = dto.daily_limit;
    if (dto.hourly_limit !== undefined)         doc.hourly_limit          = dto.hourly_limit;
    if (dto.min_interval_seconds !== undefined) doc.min_interval_seconds  = dto.min_interval_seconds;

    await doc.save();

    logger.info('EmailConnection updated', { connectionId, userId });

    return sanitize(doc);
  }

  // ── DELETE ────────────────────────────────────────────────────────
  async delete(userId: string, connectionId: string): Promise<{ success: boolean; message?: string; affected_sequences?: string[] }> {
    // 1. Scan for references in Sequences (active/paused/draft)
    const activeSequences = await Sequence.find({
      user_id: userId,
      email_connection_id: connectionId,
      status: { $in: [SequenceStatus.ACTIVE, SequenceStatus.PAUSED, SequenceStatus.DRAFT] }
    }).select('_id name').lean();

    // 2. Scan for references in SequenceSteps (for any sequence that is active/paused/draft)
    const affectedStepSequences = await SequenceStep.find({
      user_id: userId,
      email_connection_id: connectionId,
    }).select('sequence_id').lean();

    const sequenceIdsFromSteps = affectedStepSequences.map(s => s.sequence_id.toString());
    
    // Filter these step references by checking if their parent sequence is active/paused/draft
    let stepSequences: Array<{_id: Types.ObjectId, name: string}> = [];
    if (sequenceIdsFromSteps.length > 0) {
       stepSequences = await Sequence.find({
         _id: { $in: sequenceIdsFromSteps },
         status: { $in: [SequenceStatus.ACTIVE, SequenceStatus.PAUSED, SequenceStatus.DRAFT] }
       }).select('_id name').lean();
    }

    // Combine and deduplicate
    const allAffected = [...activeSequences, ...stepSequences];
    const uniqueAffectedMap = new Map(allAffected.map(seq => [seq._id.toString(), seq]));
    const uniqueAffected = Array.from(uniqueAffectedMap.values());

    if (uniqueAffected.length > 0) {
      return {
        success: false,
        message: 'Email connection is currently used by active sequences.',
        affected_sequences: uniqueAffected.map(seq => seq._id.toString())
      };
    }

    const result = await EmailConnection.deleteOne({
      _id: connectionId,
      user_id: userId,
    });

    if (result.deletedCount === 0) {
      throw AppError.notFound('Email connection');
    }

    logger.info('EmailConnection deleted', { connectionId, userId });
    return { success: true };
  }

  // ── TEST CONNECTION ───────────────────────────────────────────────
  async testConnection(
    userId: string,
    connectionId: string,
    testImap = false
  ): Promise<ConnectionTestResult> {
    const doc = await EmailConnection.findOne({
      _id: connectionId,
      user_id: userId,
    });

    if (!doc) throw AppError.notFound('Email connection');

    const result: ConnectionTestResult = {
      smtp: await this._testSmtp(doc),
    };

    if (testImap && doc.imap_host && doc.imap_password_enc) {
      result.imap = await this._testImap(doc);
    }

    // Update status & timestamp based on result
    const smtpOk = result.smtp.success;
    const imapOk = !testImap || !result.imap || result.imap.success;

    doc.status            = smtpOk && imapOk
      ? ConnectionStatus.ACTIVE
      : ConnectionStatus.FAILED;
    doc.failure_reason    = smtpOk && imapOk
      ? undefined
      : result.smtp.message || result.imap?.message;
    doc.last_verified_at  = new Date();

    await doc.save();

    logger.info('EmailConnection test complete', {
      connectionId,
      smtpOk,
      imapOk,
      status: doc.status,
    });

    return result;
  }

  // ── Private: SMTP test ────────────────────────────────────────────
  private async _testSmtp(doc: IEmailConnection): Promise<SmtpTestResult> {
    const start = Date.now();
    try {
      let authConfig: any;
      if (doc.auth_method === 'oauth2') {
        const refreshToken = decrypt(doc.oauth_refresh_token_enc!);
        authConfig = {
          type: 'OAuth2',
          user: doc.from_email,
          clientId: doc.provider === 'gmail' ? env.GOOGLE_CLIENT_ID : env.MICROSOFT_CLIENT_ID,
          clientSecret: doc.provider === 'gmail' ? env.GOOGLE_CLIENT_SECRET : env.MICROSOFT_CLIENT_SECRET,
          refreshToken,
        };
      } else {
        const rawPassword = decrypt(doc.smtp_password_enc!);
        authConfig = {
          user: doc.smtp_username,
          pass: rawPassword,
        };
      }

      const isSsl = doc.smtp_encryption === 'ssl' || doc.smtp_port === 465;

      const transport = nodemailer.createTransport({
        host: doc.smtp_host,
        port: doc.smtp_port,
        secure: isSsl,
        auth: authConfig,
        tls: {
          rejectUnauthorized: doc.provider !== 'custom',
        },
        connectionTimeout: 10_000,
        greetingTimeout:   8_000,
      });

      await transport.verify();
      transport.close();

      return {
        success: true,
        message: `SMTP connection to ${doc.smtp_host}:${doc.smtp_port} verified successfully`,
        latency_ms: Date.now() - start,
      };
    } catch (err) {
      const error = err as Error;
      logger.warn('SMTP test failed', {
        host: doc.smtp_host,
        error: error.message,
      });

      let friendlyMessage = error.message;
      if (error.message.includes('535') || error.message.includes('Username and Password not accepted') || error.message.includes('534')) {
        friendlyMessage = 'Google Authentication Failed (535): Please ensure you are using a 16-character Google App Password (not your personal account password) and that 2-Step Verification is turned ON.';
      } else if (error.message.includes('ETIMEDOUT') || error.message.includes('ECONNREFUSED')) {
        friendlyMessage = `Could not connect to ${doc.smtp_host}:${doc.smtp_port}. Please verify the host and port.`;
      }

      return {
        success: false,
        message: friendlyMessage,
        latency_ms: Date.now() - start,
      };
    }
  }

  // ── Private: IMAP test (basic TCP connect + greeting) ─────────────
  private async _testImap(doc: IEmailConnection): Promise<ImapTestResult> {
    return new Promise((resolve) => {
      const net   = require('net') as typeof import('net');
      const tls   = require('tls') as typeof import('tls');

      const host = doc.imap_host!;
      const port = doc.imap_port ?? 993;
      const useSSL = (doc.imap_encryption ?? 'ssl') !== 'none';

      let responded = false;
      const timeout = setTimeout(() => {
        if (!responded) {
          responded = true;
          resolve({ success: false, message: `IMAP timeout connecting to ${host}:${port}` });
        }
      }, 10_000);

      const onConnect = () => {
        clearTimeout(timeout);
        if (!responded) {
          responded = true;
          resolve({ success: true, message: `IMAP connection to ${host}:${port} successful` });
        }
        socket.destroy();
      };

      const onError = (err: Error) => {
        clearTimeout(timeout);
        if (!responded) {
          responded = true;
          resolve({ success: false, message: `IMAP failed: ${err.message}` });
        }
      };

      const socket = useSSL
        ? tls.connect({ host, port, rejectUnauthorized: doc.provider !== 'custom' }, onConnect)
        : net.connect({ host, port }, onConnect);

      socket.on('error', onError);
    });
  }

  // ── GET decrypted credentials (internal use only — NOT exposed via API) ─
  async getDecryptedCredentials(
    userId: string,
    connectionId: string
  ): Promise<{ smtpPassword?: string; imapPassword?: string; oauthRefreshToken?: string; authMethod: 'smtp' | 'oauth2' }> {
    const doc = await EmailConnection.findOne({
      _id: connectionId,
      user_id: userId,
    });

    if (!doc) throw AppError.notFound('Email connection');

    return {
      authMethod: doc.auth_method,
      smtpPassword: doc.smtp_password_enc ? decrypt(doc.smtp_password_enc) : undefined,
      imapPassword: doc.imap_password_enc
        ? decrypt(doc.imap_password_enc)
        : undefined,
      oauthRefreshToken: doc.oauth_refresh_token_enc ? decrypt(doc.oauth_refresh_token_enc) : undefined,
    };
  }
}

// Singleton export
export const emailConnectionService = new EmailConnectionService();
