import crypto from 'crypto';
import { env } from '../config/env';

const ALGORITHM = 'aes-256-cbc';
const KEY = Buffer.from(env.ENCRYPTION_KEY, 'utf-8'); // 32 bytes
const IV_LENGTH = parseInt(process.env.ENCRYPTION_IV_LENGTH || '16', 10);

/**
 * Encrypt plaintext using AES-256-CBC.
 * Returns: "iv:encryptedData" as hex string
 */
export function encrypt(plaintext: string): string {
  const iv = crypto.randomBytes(IV_LENGTH);
  const cipher = crypto.createCipheriv(ALGORITHM, KEY, iv);
  let encrypted = cipher.update(plaintext, 'utf-8', 'hex');
  encrypted += cipher.final('hex');
  return `${iv.toString('hex')}:${encrypted}`;
}

/**
 * Decrypt an AES-256-CBC encrypted string.
 * Expects format: "iv:encryptedData"
 */
export function decrypt(ciphertext: string): string {
  const [ivHex, encrypted] = ciphertext.split(':');
  if (!ivHex || !encrypted) {
    throw new Error('Invalid ciphertext format — expected "iv:data"');
  }
  const iv = Buffer.from(ivHex, 'hex');
  const decipher = crypto.createDecipheriv(ALGORITHM, KEY, iv);
  let decrypted = decipher.update(encrypted, 'hex', 'utf-8');
  decrypted += decipher.final('utf-8');
  return decrypted;
}

/**
 * Generate a cryptographically secure random token.
 */
export function generateSecureToken(bytes = 32): string {
  return crypto.randomBytes(bytes).toString('hex');
}

/**
 * Hash a value using SHA-256 (for indexing encrypted fields).
 */
export function hashValue(value: string): string {
  return crypto.createHash('sha256').update(value).digest('hex');
}
