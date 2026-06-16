import { z } from 'zod';

// ─── Shared ────────────────────────────────────────────────────────
const objectIdField = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Must be a valid MongoDB ObjectId');

export const SequenceIdParamSchema = z.object({
  id: objectIdField,
});

export const ContactParamSchema = z.object({
  id:        objectIdField,
  contactId: objectIdField,
});

// ─── Single contact in the enroll payload ─────────────────────────
const EnrollContactSchema = z.object({
  email: z
    .string({ required_error: 'Email is required' })
    .email('Must be a valid email address')
    .toLowerCase()
    .trim(),

  first_name: z.string().trim().max(100).default(''),
  last_name:  z.string().trim().max(100).optional(),
  company:    z.string().trim().max(200).optional(),

  /**
   * Per-contact custom variables — override template {{variable}} tags.
   * Example: { "pain_point": "churn", "cta_url": "https://..." }
   */
  custom_variables: z
    .record(z.string(), z.string())
    .optional()
    .default({}),
});

// ─── POST /api/sequences/:id/enroll ───────────────────────────────
export const EnrollContactsSchema = z.object({
  contacts: z
    .array(EnrollContactSchema)
    .min(1, 'At least one contact is required')
    .max(500, 'Maximum 500 contacts per batch'),

  /**
   * When to start the first email (relative to now).
   * Default: start immediately (0 delay).
   * Example: "2024-07-01T09:00:00.000Z"
   */
  start_at: z
    .string()
    .datetime({ message: 'start_at must be an ISO 8601 datetime' })
    .optional()
    .describe('Schedule enrollment start time (ISO 8601). Default: now.'),

  /**
   * If true, skip contacts that are already enrolled (no error).
   * If false (default), return a 409 if any contact is already enrolled.
   */
  skip_existing: z.boolean().default(false),
});

// ─── GET /api/sequences/:id/contacts ──────────────────────────────
export const ListContactsQuerySchema = z.object({
  status: z
    .enum([
      'active',
      'paused',
      'completed',
      'bounced',
      'replied',
      'unsubscribed',
      'failed',
      'skipped',
      'removed',
    ])
    .optional(),
  page:  z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  search: z.string().trim().optional().describe('Search by email or name'),
});

// ─── PATCH /api/sequences/:id/contacts/:contactId ─────────────────
export const PatchContactStatusSchema = z.object({
  status: z.enum(['paused', 'active', 'removed'], {
    required_error: 'Status is required',
    invalid_type_error: 'Status must be "paused", "active", or "removed"',
  }),
  reason: z
    .string()
    .trim()
    .max(500)
    .optional()
    .describe('Optional reason for the status change (stored in last_error)'),
});

// ─── Inferred types ────────────────────────────────────────────────
export type EnrollContactsDto       = z.infer<typeof EnrollContactsSchema>;
export type ListContactsQueryDto    = z.infer<typeof ListContactsQuerySchema>;
export type PatchContactStatusDto   = z.infer<typeof PatchContactStatusSchema>;
export type SequenceIdParam         = z.infer<typeof SequenceIdParamSchema>;
export type ContactParam            = z.infer<typeof ContactParamSchema>;
export type EnrollContactItem       = z.infer<typeof EnrollContactSchema>;
