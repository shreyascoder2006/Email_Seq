import { z } from 'zod';
import { SequenceStatus, SendingSchedule } from '../models/Sequence';
import { StepType } from '../models/SequenceStep';

// ─── Shared ────────────────────────────────────────────────────────
const objectIdField = z
  .string()
  .regex(/^[a-f\d]{24}$/i, 'Must be a valid MongoDB ObjectId');

export const IdParamSchema = z.object({
  id: objectIdField,
});

export const SequenceAndStepParamSchema = z.object({
  id:     objectIdField,
  stepId: objectIdField,
});

// ─── Sending Window ────────────────────────────────────────────────
const SendingWindowSchema = z.object({
  timezone: z
    .string()
    .trim()
    .default('UTC')
    .describe('IANA timezone, e.g. "Asia/Kolkata"'),
  schedule: z
    .nativeEnum(SendingSchedule)
    .default(SendingSchedule.WEEKDAYS_ONLY),
  start_hour: z
    .number()
    .int()
    .min(0)
    .max(23)
    .default(9)
    .describe('Hour to start sending (24h format)'),
  start_minute: z
    .number()
    .int()
    .min(0)
    .max(59)
    .default(0)
    .describe('Minute to start sending'),
  end_hour: z
    .number()
    .int()
    .min(0)
    .max(23)
    .default(17)
    .describe('Hour to stop sending (24h format)'),
  end_minute: z
    .number()
    .int()
    .min(0)
    .max(59)
    .default(0)
    .describe('Minute to stop sending'),
  custom_days: z
    .array(z.number().int().min(0).max(6))
    .optional()
    .describe('0=Sun … 6=Sat — only for schedule="custom"'),
})
.refine(
  (d) => {
    try {
      Intl.DateTimeFormat(undefined, { timeZone: d.timezone });
      return true;
    } catch (e) {
      return false;
    }
  },
  { message: 'Timezone must be a valid IANA timezone.', path: ['timezone'] }
)
.refine(
  (d) => (d.start_hour * 60 + d.start_minute) < (d.end_hour * 60 + d.end_minute),
  { message: 'Start time must be before end time.', path: ['start_hour'] }
)
.refine(
  (d) => ((d.end_hour * 60 + d.end_minute) - (d.start_hour * 60 + d.start_minute)) === 30,
  { message: 'Sending window must be exactly 30 minutes.', path: ['end_hour'] }
)
.refine(
  (d) => d.schedule !== SendingSchedule.CUSTOM || (d.custom_days && d.custom_days.length > 0),
  { message: 'custom_days is required when schedule is "custom"', path: ['custom_days'] }
);

// ─── Create Sequence ───────────────────────────────────────────────
export const CreateSequenceSchema = z.object({
  name: z
    .string({ required_error: 'Sequence name is required' })
    .trim()
    .min(2, 'Name must be at least 2 characters')
    .max(200, 'Name must be at most 200 characters'),

  description: z
    .string()
    .trim()
    .max(1000)
    .optional(),

  email_connection_id: objectIdField.optional().describe(
    'The default EmailConnection (SMTP account) to send from (optional)'
  ),

  launch_date: z.coerce.date().optional().refine(
    (d) => {
      if (!d) return true;
      // Allow slight past buffer (e.g. 5 minutes) in case of slow API request
      return d.getTime() > Date.now() - 5 * 60 * 1000;
    },
    { message: 'A valid future launch date is required for Schedule Later.' }
  ),
  daily_sending_limit: z.number().int().min(1).default(100),
  reserved_limit_phase1: z.number().int().min(0).max(100).default(50),
  warmup_percentage: z.number().int().min(0).max(100).optional(),

  sending_window: SendingWindowSchema.optional(),

  stop_on_reply:  z.boolean().default(true),
  stop_on_bounce: z.boolean().default(true),
  stop_on_click:  z.boolean().default(false),
  track_opens:    z.boolean().default(true),
  track_clicks:   z.boolean().default(true),

  is_wizard: z.boolean().optional(),
});

// ─── Update Sequence ───────────────────────────────────────────────
export const UpdateSequenceSchema = z.object({
  name:                z.string().trim().min(2).max(200).optional(),
  description:         z.string().trim().max(1000).optional().nullable(),
  email_connection_id: objectIdField.optional().nullable(),
  launch_date:         z.coerce.date().optional(),
  daily_sending_limit: z.number().int().min(1).optional(),
  reserved_limit_phase1: z.number().int().min(0).max(100).optional(),
  warmup_percentage:   z.number().int().min(0).max(100).optional().nullable(),
  sending_window:      SendingWindowSchema.optional(),
  stop_on_reply:       z.boolean().optional(),
  stop_on_bounce:      z.boolean().optional(),
  stop_on_click:       z.boolean().optional(),
  track_opens:         z.boolean().optional(),
  track_clicks:        z.boolean().optional(),
  is_wizard:           z.boolean().optional(),
});

// ─── State Transition ──────────────────────────────────────────────
export const TransitionStatusSchema = z.object({
  status: z.enum(
    [
      SequenceStatus.ACTIVE,
      SequenceStatus.PAUSED,
      SequenceStatus.ARCHIVED,
      SequenceStatus.COMPLETED,
    ],
    {
      required_error: 'Status is required',
      invalid_type_error: `Status must be one of: active, paused, archived, completed`,
    }
  ),
  // Activation-time only: bypasses sending-window math so all active contacts
  // become due immediately. Has no effect for non-active transitions.
  // Must NOT be persisted — this is a one-shot request parameter.
  send_immediately: z.boolean().optional().default(false),
});

// ─── List Query ────────────────────────────────────────────────────
export const ListSequenceQuerySchema = z.object({
  status:  z.nativeEnum(SequenceStatus).optional(),
  page:    z.coerce.number().int().min(1).default(1),
  limit:   z.coerce.number().int().min(1).max(100).default(20),
  search:  z.string().trim().optional(),
  sort_by: z
    .enum(['created_at', 'updated_at', 'name', 'status'])
    .default('created_at'),
  sort_order: z.enum(['asc', 'desc']).default('desc'),
});

// ─── Steps ─────────────────────────────────────────────────────────

/** EMAIL step — requires template + email account */
const EmailStepSchema = z.object({
  type: z.literal(StepType.EMAIL),

  template_id: objectIdField.optional().describe('Template to use for this step (optional if subject & body provided)'),

  email_connection_id: objectIdField
    .optional()
    .describe('Override sequence-level email account for this step'),

  subject_override: z
    .string()
    .trim()
    .max(500)
    .optional()
    .describe('Overrides template subject (supports {{variables}})'),

  body_html_override: z.string().optional(),
  body_text_override: z.string().optional(),

  cc: z.array(z.string().email('Invalid CC email')).optional(),
  bcc: z.array(z.string().email('Invalid BCC email')).optional(),

  delay_days:  z.number().int().min(0).max(365).default(0),
  delay_hours: z.number().int().min(0).max(23).default(0),

  track_opens:  z.boolean().optional(),
  track_clicks: z.boolean().optional(),
});

/** WAIT/DELAY step — base object (no refine so it works in discriminatedUnion) */
const WaitStepBaseSchema = z.object({
  type: z.literal(StepType.WAIT),
  delay_days:  z.number().int().min(0).max(365).default(1),
  delay_hours: z.number().int().min(0).max(23).default(0),
});

/** Refined version for standalone use */
const WaitStepSchema = WaitStepBaseSchema.refine(
  (d) => d.delay_days > 0 || d.delay_hours > 0,
  { message: 'A wait step must have a delay of at least 1 hour', path: ['delay_hours'] }
);

/** CONDITION step — branch on contact engagement */
const ConditionStepSchema = z.object({
  type: z.literal(StepType.CONDITION),

  delay_days:  z.number().int().min(0).max(365).default(0),
  delay_hours: z.number().int().min(0).max(23).default(0),

  condition: z.object({
    type: z.enum([
      'opened_email',
      'clicked_link',
      'replied',
      'not_opened',
      'not_clicked',
    ]),
    true_next_step_index:  z.number().int().min(0).optional().nullable(),
    false_next_step_index: z.number().int().min(0).optional().nullable(),
  }),
});

/**
 * Discriminated union — uses base schemas (ZodObject, not ZodEffects)
 * so Zod can index on the 'type' discriminant field.
 */
export const CreateStepSchema = z.discriminatedUnion('type', [
  EmailStepSchema,
  WaitStepBaseSchema,  // ← base (not refined) required here
  ConditionStepSchema,
]);

/**
 * Update step — all fields optional except 'type' discriminant.
 * .partial() only works on ZodObject, so use base schemas.
 */
export const UpdateStepSchema = z.discriminatedUnion('type', [
  EmailStepSchema.partial().extend({ type: z.literal(StepType.EMAIL) }),
  WaitStepBaseSchema.partial().extend({ type: z.literal(StepType.WAIT) }),
  ConditionStepSchema.partial().extend({ type: z.literal(StepType.CONDITION) }),
]);

// Re-export refined wait schema for external validation if needed
export { WaitStepSchema };

/** Reorder steps */
export const ReorderStepsSchema = z.object({
  step_ids: z
    .array(objectIdField)
    .min(1, 'step_ids must contain at least one step ID')
    .describe('Ordered array of step ObjectIds — new order is applied as-is'),
});

// ─── Inferred types ────────────────────────────────────────────────
export type CreateSequenceDto       = z.infer<typeof CreateSequenceSchema>;
export type UpdateSequenceDto       = z.infer<typeof UpdateSequenceSchema>;
export type TransitionStatusDto     = z.infer<typeof TransitionStatusSchema>;
export type ListSequenceQueryDto    = z.infer<typeof ListSequenceQuerySchema>;
export type CreateStepDto           = z.infer<typeof CreateStepSchema>;
export type UpdateStepDto           = z.infer<typeof UpdateStepSchema>;
export type ReorderStepsDto         = z.infer<typeof ReorderStepsSchema>;
export type IdParam                 = z.infer<typeof IdParamSchema>;
export type SequenceAndStepParam    = z.infer<typeof SequenceAndStepParamSchema>;
