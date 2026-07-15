import { Schema, model, Document, Types } from 'mongoose';

// ─── Enums ─────────────────────────────────────────────────────────
export enum ContactEnrollmentStatus {
  ACTIVE        = 'active',        // currently progressing through steps
  PAUSED        = 'paused',        // manually paused
  COMPLETED     = 'completed',     // finished all steps
  UNSUBSCRIBED  = 'unsubscribed',  // contact opted out
  BOUNCED       = 'bounced',       // hard bounce received
  REPLIED       = 'replied',       // replied (may auto-pause)
  FAILED        = 'failed',        // repeated send failures
  SKIPPED       = 'skipped',       // never sent (e.g. invalid email)
  REMOVED       = 'removed',       // soft-deleted by user
}

export enum UnsubscribeSource {
  LINK        = 'link',        // clicked unsubscribe link
  REPLY       = 'reply',       // replied STOP/unsubscribe
  MANUAL      = 'manual',      // manually removed by user
  BOUNCE      = 'bounce',      // hard bounce auto-unsubscribe
  SPAM        = 'spam',        // spam complaint
}

// ─── Per-step send record ──────────────────────────────────────────
export interface StepRecord {
  step_index:  number;
  step_id:     Types.ObjectId;
  sent_at?:    Date;
  message_id?: string;         // SMTP message-id for threading
  status:      'pending' | 'sent' | 'failed' | 'skipped';
  error?:      string;
}

// ─── TypeScript Interface ──────────────────────────────────────────
export interface ISequenceContact extends Document {
  // Core references
  sequence_id:          Types.ObjectId;
  user_id:              Types.ObjectId;
  email_connection_id?: Types.ObjectId;

  // Contact identity (denormalized — avoid join on hot scheduler path)
  contact_email:      string;
  contact_first_name: string;
  contact_last_name?: string;
  contact_company?:   string;

  // Custom variable overrides for this specific contact
  custom_variables: Map<string, string>;

  // Scheduler state — the two most important fields
  status:       ContactEnrollmentStatus;
  next_send_at: Date | null;      // NULL = no more sends
  sending_locked: boolean;        // Idempotency lock during processing

  // BullMQ Job State Tracking (for reconciliation)
  current_job_id?: string;
  job_state?: string;
  last_attempt_at?: Date;
  job_scheduled_at?: Date;
  
  // Rescheduling support
  schedule_version: number;
  last_rescheduled_at?: Date;
  last_rescheduled_by?: Types.ObjectId;

  // Step tracking
  current_step_index: number;     // next step to execute
  total_steps:        number;     // denormalized from Sequence
  step_records:       StepRecord[];

  // Engagement flags (set when any event fires)
  has_opened:  boolean;
  has_clicked: boolean;
  has_replied: boolean;

  // Unsubscribe
  unsubscribed_at?:      Date;
  unsubscribe_source?:   UnsubscribeSource;
  unsubscribe_reason?:   string; // optional free-text reason
  unsubscribe_ip?:       string; // IP address of the unsubscribe request
  unsubscribe_user_agent?: string; // UA of the unsubscribe request

  // Enrollment metadata
  enrolled_at:  Date;
  completed_at?: Date;
  paused_at?:   Date;
  failed_at?:   Date;

  // Error tracking
  last_error?:         string;
  consecutive_failures: number;

  created_at: Date;
  updated_at: Date;
}

// ─── Sub-schemas ───────────────────────────────────────────────────
const StepRecordSchema = new Schema<StepRecord>(
  {
    step_index:  { type: Number, required: true },
    step_id:     { type: Schema.Types.ObjectId, ref: 'SequenceStep', required: true },
    sent_at:     { type: Date },
    message_id:  { type: String, trim: true },
    status:      {
      type: String,
      enum: ['pending', 'sent', 'failed', 'skipped'],
      default: 'pending',
    },
    error: { type: String, maxlength: 500 },
  },
  { _id: false }
);

// ─── Schema ────────────────────────────────────────────────────────
const SequenceContactSchema = new Schema<ISequenceContact>(
  {
    sequence_id: {
      type: Schema.Types.ObjectId,
      ref: 'Sequence',
      required: true,
    },
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    email_connection_id: {
      type: Schema.Types.ObjectId,
      ref: 'EmailConnection',
    },

    // Denormalized contact fields (fast scheduler access)
    contact_email:      {
      type: String,
      required: true,
      trim: true,
      lowercase: true,
      match: [/^[^\s@]+@[^\s@]+\.[^\s@]+$/, 'Invalid email'],
    },
    contact_first_name: { type: String, trim: true, default: '' },
    contact_last_name:  { type: String, trim: true },
    contact_company:    { type: String, trim: true },

    custom_variables: {
      type: Map,
      of: String,
      default: {},
    },

    // ── Scheduler core fields ─────────────────────────────────────
    status: {
      type: String,
      enum: Object.values(ContactEnrollmentStatus),
      default: ContactEnrollmentStatus.ACTIVE,
    },
    next_send_at: {
      type: Date,
      default: null,
    },
    sending_locked: {
      type: Boolean,
      default: false,
    },

    // BullMQ Job State Tracking
    current_job_id:  { type: String, trim: true },
    job_state:       { type: String, trim: true },
    last_attempt_at: { type: Date },
    job_scheduled_at: { type: Date },

    // Rescheduling Support
    schedule_version: { type: Number, default: 1 },
    last_rescheduled_at: { type: Date },
    last_rescheduled_by: { type: Schema.Types.ObjectId, ref: 'User' },

    // Step state
    current_step_index:  { type: Number, default: 0, min: 0 },
    total_steps:         { type: Number, default: 0 },
    step_records:        { type: [StepRecordSchema], default: [] },

    // Engagement flags
    has_opened:  { type: Boolean, default: false },
    has_clicked: { type: Boolean, default: false },
    has_replied: { type: Boolean, default: false },

    // Unsubscribe
    unsubscribed_at:      { type: Date },
    unsubscribe_source:   { type: String, enum: Object.values(UnsubscribeSource) },
    unsubscribe_reason:   { type: String, trim: true, maxlength: 500 },
    unsubscribe_ip:       { type: String, trim: true, maxlength: 100 },
    unsubscribe_user_agent: { type: String, trim: true, maxlength: 500 },

    // Timestamps
    enrolled_at:  { type: Date, default: Date.now },
    completed_at: { type: Date },
    paused_at:    { type: Date },
    failed_at:    { type: Date },

    // Errors
    last_error:           { type: String, maxlength: 500 },
    consecutive_failures: { type: Number, default: 0, min: 0 },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'sequence_contacts',
  }
);

// ─── Indexes ───────────────────────────────────────────────────────

/**
 * ⭐ PRIMARY SCHEDULER INDEX
 * The worker polls: "give me all ACTIVE contacts whose next_send_at <= now"
 * This is the hottest query path in the entire system.
 */
SequenceContactSchema.index({ status: 1, next_send_at: 1 });

/**
 * ⭐ SEQUENCE DASHBOARD
 * "Show all contacts for sequence X, sorted by enrollment date"
 */
SequenceContactSchema.index({ sequence_id: 1, status: 1, enrolled_at: -1 });

/**
 * ⭐ USER DASHBOARD
 * "Show all enrollments for user X"
 */
SequenceContactSchema.index({ user_id: 1, status: 1 });

/**
 * UNIQUE ENROLLMENT GUARD
 * Prevent double-enrolling a contact in the same sequence
 */
SequenceContactSchema.index(
  { sequence_id: 1, contact_email: 1 },
  { unique: true }
);

/**
 * UNSUBSCRIBE LOOKUP
 * "Is this email globally unsubscribed?" — per-user opt-out check
 */
SequenceContactSchema.index({ user_id: 1, contact_email: 1, status: 1 });

// ─── Model ────────────────────────────────────────────────────────
export const SequenceContact = model<ISequenceContact>(
  'SequenceContact',
  SequenceContactSchema
);

/*
 * ── Example Document ─────────────────────────────────────────────
 * {
 *   _id: ObjectId("sc001"),
 *   sequence_id: ObjectId("seq001"),
 *   user_id: ObjectId("user123"),
 *   email_connection_id: ObjectId("conn001"),
 *   contact_email: "founder@acme.io",
 *   contact_first_name: "Alice",
 *   contact_company: "Acme Inc",
 *   custom_variables: { "pain_point": "churn reduction", "use_case": "B2B SaaS" },
 *   status: "active",
 *   next_send_at: ISODate("2024-06-10T09:00:00Z"),   ← scheduler reads this
 *   current_step_index: 1,
 *   total_steps: 3,
 *   step_records: [
 *     { step_index: 0, step_id: ObjectId("..."), sent_at: ISODate("..."), status: "sent" }
 *   ],
 *   has_opened: true,
 *   has_clicked: false,
 *   has_replied: false,
 *   enrolled_at: ISODate("2024-06-07"),
 *   consecutive_failures: 0
 * }
 */
