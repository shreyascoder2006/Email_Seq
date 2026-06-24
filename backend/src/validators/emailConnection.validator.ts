import { z } from 'zod';
import { SmtpEncryption, ProviderType } from '../models/EmailConnection';

// ─── Shared field validators ───────────────────────────────────────
const emailField = z
  .string({ required_error: 'Email is required' })
  .email('Must be a valid email address')
  .toLowerCase()
  .trim();

const portField = z
  .number()
  .int()
  .min(1, 'Port must be ≥ 1')
  .max(65535, 'Port must be ≤ 65535');

const encryptionField = z.nativeEnum(SmtpEncryption, {
  errorMap: () => ({ message: `Must be one of: ${Object.values(SmtpEncryption).join(', ')}` }),
});

// ─── Create EmailConnection ────────────────────────────────────────
export const CreateEmailConnectionSchema = z.object({
  label: z
    .string({ required_error: 'Label is required' })
    .trim()
    .min(2, 'Label must be at least 2 characters')
    .max(100, 'Label must be at most 100 characters'),

  from_name: z
    .string({ required_error: 'Sender name is required' })
    .trim()
    .min(1, 'Sender name cannot be empty')
    .max(100),

  from_email: emailField.describe('The "From" email address'),

  reply_to: emailField.optional().describe('Optional reply-to address'),

  provider: z
    .nativeEnum(ProviderType, {
      errorMap: () => ({ message: `Must be one of: ${Object.values(ProviderType).join(', ')}` }),
    })
    .default(ProviderType.CUSTOM),

  auth_method: z.enum(['smtp', 'oauth2']).default('smtp'),

  // ── SMTP (required) ──────────────────────────────────────────────
  smtp_host: z
    .string({ required_error: 'SMTP host is required' })
    .trim()
    .min(4, 'SMTP host too short')
    .max(253, 'SMTP host too long'),

  smtp_port: portField.default(587),

  smtp_encryption: encryptionField.default(SmtpEncryption.TLS),

  smtp_username: z.string().trim().optional(),

  smtp_password: z.string().optional(),

  // ── IMAP (optional) ───────────────────────────────────────────────
  imap_host:       z.string().trim().max(253).optional(),
  imap_port:       portField.optional().default(993),
  imap_encryption: encryptionField.optional().default(SmtpEncryption.SSL),
  imap_username:   z.string().trim().optional(),
  imap_password:   z.string().optional(),

  // ── Sending limits ────────────────────────────────────────────────
  daily_limit: z
    .number()
    .int()
    .min(1)
    .max(5000)
    .default(200)
    .describe('Max emails per day'),

  hourly_limit: z
    .number()
    .int()
    .min(1)
    .max(1000)
    .default(50)
    .describe('Max emails per hour'),

  min_interval_seconds: z
    .number()
    .int()
    .min(0)
    .max(3600)
    .default(60)
    .describe('Minimum seconds between sends'),
}).refine(
  // If IMAP host provided, require username
  (data) => !data.imap_host || !!data.imap_username,
  { message: 'IMAP username is required when IMAP host is provided', path: ['imap_username'] }
).refine(
  // If IMAP host provided, require password
  (data) => !data.imap_host || !!data.imap_password,
  { message: 'IMAP password is required when IMAP host is provided', path: ['imap_password'] }
).refine(
  // If auth_method is smtp, require smtp_username
  (data) => data.auth_method === 'oauth2' || !!data.smtp_username,
  { message: 'SMTP username is required for SMTP auth', path: ['smtp_username'] }
).refine(
  // If auth_method is smtp, require smtp_password
  (data) => data.auth_method === 'oauth2' || !!data.smtp_password,
  { message: 'SMTP password is required for SMTP auth', path: ['smtp_password'] }
);

// ─── Update EmailConnection (all SMTP/IMAP fields optional) ────────
export const UpdateEmailConnectionSchema = z.object({
  label:        z.string().trim().min(2).max(100).optional(),
  from_name:    z.string().trim().min(1).max(100).optional(),
  from_email:   emailField.optional(),
  reply_to:     emailField.optional().nullable(),
  provider:     z.nativeEnum(ProviderType).optional(),

  smtp_host:       z.string().trim().min(4).max(253).optional(),
  smtp_port:       portField.optional(),
  smtp_encryption: encryptionField.optional(),
  smtp_username:   z.string().trim().min(1).optional(),
  smtp_password:   z.string().min(1).optional(), // only re-encrypt if provided

  imap_host:       z.string().trim().max(253).optional().nullable(),
  imap_port:       portField.optional(),
  imap_encryption: encryptionField.optional(),
  imap_username:   z.string().trim().optional().nullable(),
  imap_password:   z.string().optional().nullable(),

  daily_limit:          z.number().int().min(1).max(5000).optional(),
  hourly_limit:         z.number().int().min(1).max(1000).optional(),
  min_interval_seconds: z.number().int().min(0).max(3600).optional(),
});

// ─── Test Connection ───────────────────────────────────────────────
export const TestConnectionSchema = z.object({
  test_imap: z.boolean().default(false).describe('Also test IMAP connection'),
});

// ─── Param schemas ─────────────────────────────────────────────────
export const IdParamSchema = z.object({
  id: z
    .string({ required_error: 'ID is required' })
    .regex(/^[a-f\d]{24}$/i, 'Invalid MongoDB ObjectId'),
});

// ─── Inferred types ────────────────────────────────────────────────
export type CreateEmailConnectionDto = z.infer<typeof CreateEmailConnectionSchema>;
export type UpdateEmailConnectionDto = z.infer<typeof UpdateEmailConnectionSchema>;
export type TestConnectionDto        = z.infer<typeof TestConnectionSchema>;
export type IdParam                  = z.infer<typeof IdParamSchema>;
