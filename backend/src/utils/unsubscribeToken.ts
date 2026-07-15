/**
 * src/utils/unsubscribeToken.ts
 *
 * HMAC-SHA256 unsubscribe token generator and verifier.
 *
 * Token format:  v1.<base64url(JSON payload)>.<base64url(HMAC-SHA256 signature)>
 * Payload shape: { c: contactId, s: sequenceId, ts: unixSeconds }
 *
 * Properties:
 *  - Non-reversible: no plaintext email or raw ObjectId exposed
 *  - Tamper-evident: constant-time signature comparison
 *  - Future-proof: `ts` field enables time-based expiry without format change
 *  - No extra dependencies: uses Node.js built-in `crypto`
 */

import crypto from 'crypto';
import { env } from '../config/env';

const TOKEN_VERSION  = 'v1';
const HMAC_ALGORITHM = 'sha256';

interface TokenPayload {
  c:  string; // contactId (MongoDB ObjectId string)
  s:  string; // sequenceId (MongoDB ObjectId string)
  ts: number; // unix epoch seconds — reserved for future expiry support
}

/** Prefer a dedicated secret; fall back to JWT_SECRET so existing deploys work. */
function getSecret(): string {
  return (env as any).UNSUBSCRIBE_SECRET ?? env.JWT_SECRET;
}

/**
 * Generate a URL-safe, cryptographically signed unsubscribe token.
 * Never embeds email addresses or raw database IDs in the final string.
 */
export function generateUnsubscribeToken(contactId: string, sequenceId: string): string {
  const payload: TokenPayload = {
    c:  contactId,
    s:  sequenceId,
    ts: Math.floor(Date.now() / 1000),
  };

  const payloadB64 = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const message    = `${TOKEN_VERSION}.${payloadB64}`;
  const sig        = crypto
    .createHmac(HMAC_ALGORITHM, getSecret())
    .update(message)
    .digest('base64url');

  return `${message}.${sig}`;
}

/**
 * Verify a token and decode its payload.
 * Returns null for any invalid, tampered, or malformed token.
 * Uses constant-time comparison to prevent timing-based forgery.
 */
export function verifyUnsubscribeToken(
  token: string
): { contactId: string; sequenceId: string } | null {
  try {
    const parts = token.split('.');
    // Expected structure: ["v1", "<payloadB64>", "<sig>"]
    if (parts.length !== 3) return null;

    const [version, payloadB64, sig] = parts;
    if (version !== TOKEN_VERSION) return null;

    // Recompute expected signature over the identical message string
    const message  = `${version}.${payloadB64}`;
    const expected = crypto
      .createHmac(HMAC_ALGORITHM, getSecret())
      .update(message)
      .digest('base64url');

    // Constant-time comparison — prevents timing attacks
    const expectedBuf = Buffer.from(expected);
    const actualBuf   = Buffer.from(sig);
    if (expectedBuf.length !== actualBuf.length) return null;
    if (!crypto.timingSafeEqual(expectedBuf, actualBuf)) return null;

    const payload = JSON.parse(
      Buffer.from(payloadB64, 'base64url').toString('utf-8')
    ) as Partial<TokenPayload>;

    if (typeof payload.c !== 'string' || typeof payload.s !== 'string') return null;

    return { contactId: payload.c, sequenceId: payload.s };
  } catch {
    return null;
  }
}
