import { Schema, model, Document, Types } from 'mongoose';

// ─── Enums ─────────────────────────────────────────────────────────
export enum SendStatus {
  QUEUED    = 'queued',
  SENDING   = 'sending',
  SENT      = 'sent',
  DELIVERED = 'delivered', // if provider supports delivery webhooks
  FAILED    = 'failed',
  BOUNCED   = 'bounced',
  CANCELLED = 'cancelled',
}

// ─── TypeScript Interface ──────────────────────────────────────────
export interface ISendingLog extends Document {
  // References
  sequence_id:         Types.ObjectId;
  sequence_contact_id: Types.ObjectId;
  sequence_step_id:    Types.ObjectId;
  user_id:             Types.ObjectId;
  email_connection_id: Types.ObjectId;
  template_id?:        Types.ObjectId;

  // Email envelope
  to_email:    string;
  from_email:  string;
  from_name:   string;
  subject:     string;
  message_id?: string;     // SMTP Message-ID header (for threading/reply detection)
  in_reply_to?: string;    // for threading

  // Content snapshot (for audit — what was actually sent)
  body_html_snapshot?: string;
  body_text_snapshot?: string;

  // Step info (denormalized)
  step_index: number;

  // Status
  status:       SendStatus;
  error_code?:  string;
  error_message?: string;
  retry_count:  number;

  // Timing
  queued_at:    Date;
  sent_at?:     Date;
  delivered_at?: Date;
  failed_at?:   Date;

  // TTL — auto-delete sending logs after 90 days
  expires_at: Date;

  created_at: Date;
  updated_at: Date;
}

// ─── Schema ────────────────────────────────────────────────────────
const SendingLogSchema = new Schema<ISendingLog>(
  {
    sequence_id:         { type: Schema.Types.ObjectId, ref: 'Sequence',        required: true },
    sequence_contact_id: { type: Schema.Types.ObjectId, ref: 'SequenceContact', required: true },
    sequence_step_id:    { type: Schema.Types.ObjectId, ref: 'SequenceStep',    required: true },
    user_id:             { type: Schema.Types.ObjectId, ref: 'User',            required: true },
    email_connection_id: { type: Schema.Types.ObjectId, ref: 'EmailConnection', required: true },
    template_id:         { type: Schema.Types.ObjectId, ref: 'Template' },

    to_email:    { type: String, required: true, trim: true, lowercase: true },
    from_email:  { type: String, required: true, trim: true, lowercase: true },
    from_name:   { type: String, required: true, trim: true },
    subject:     { type: String, required: true, trim: true },
    message_id:  { type: String, trim: true },
    in_reply_to: { type: String, trim: true },

    body_html_snapshot: { type: String },
    body_text_snapshot: { type: String },

    step_index:    { type: Number, required: true, min: 0 },
    status:        { type: String, enum: Object.values(SendStatus), default: SendStatus.QUEUED },
    error_code:    { type: String, trim: true },
    error_message: { type: String, maxlength: 1000 },
    retry_count:   { type: Number, default: 0, min: 0 },

    queued_at:    { type: Date, default: Date.now },
    sent_at:      { type: Date },
    delivered_at: { type: Date },
    failed_at:    { type: Date },

    // TTL — auto-expire after 90 days
    expires_at: {
      type: Date,
      default: () => new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      index: { expireAfterSeconds: 0 }, // MongoDB TTL index
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'sending_logs',
  }
);

// ─── Indexes ───────────────────────────────────────────────────────
// Find all sends for a contact enrollment
SendingLogSchema.index({ sequence_contact_id: 1, step_index: 1 });
// Sequence-level analytics
SendingLogSchema.index({ sequence_id: 1, status: 1, sent_at: -1 });
// User-level analytics
SendingLogSchema.index({ user_id: 1, sent_at: -1 });
// SMTP message-id lookup (for reply matching)
SendingLogSchema.index({ message_id: 1 }, { sparse: true });

// ─── Model ────────────────────────────────────────────────────────
export const SendingLog = model<ISendingLog>('SendingLog', SendingLogSchema);

/*
 * ── Example Document ─────────────────────────────────────────────
 * {
 *   sequence_id: ObjectId("seq001"),
 *   sequence_contact_id: ObjectId("sc001"),
 *   sequence_step_id: ObjectId("step001"),
 *   user_id: ObjectId("user123"),
 *   to_email: "founder@acme.io",
 *   from_email: "shreyas@gmail.com",
 *   subject: "Quick question, Alice",
 *   message_id: "<20240601.abc123@gmail.com>",
 *   step_index: 0,
 *   status: "sent",
 *   retry_count: 0,
 *   queued_at: ISODate("2024-06-01T08:59:00Z"),
 *   sent_at:   ISODate("2024-06-01T09:00:01Z"),
 *   expires_at: ISODate("2024-09-01T09:00:01Z")   ← TTL auto-delete
 * }
 */
