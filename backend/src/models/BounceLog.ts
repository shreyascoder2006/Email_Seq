import { Schema, model, Document, Types } from 'mongoose';

// ─── Enums ─────────────────────────────────────────────────────────
export enum BounceType {
  HARD = 'hard',   // permanent — invalid address, domain not found
  SOFT = 'soft',   // temporary — mailbox full, server unavailable
}

export enum BounceSubType {
  INVALID_ADDRESS  = 'invalid_address',
  DOMAIN_NOT_FOUND = 'domain_not_found',
  MAILBOX_FULL     = 'mailbox_full',
  SERVER_DOWN      = 'server_down',
  POLICY_REJECTION = 'policy_rejection',
  SPAM_DETECTED    = 'spam_detected',
  UNKNOWN          = 'unknown',
}

// ─── TypeScript Interface ──────────────────────────────────────────
export interface IBounceLog extends Document {
  // References
  sequence_id:         Types.ObjectId;
  sequence_contact_id: Types.ObjectId;
  sending_log_id:      Types.ObjectId;
  user_id:             Types.ObjectId;
  email_connection_id: Types.ObjectId;

  // Bounced email
  to_email:   string;
  step_index: number;

  // Bounce details
  bounce_type:     BounceType;
  bounce_sub_type: BounceSubType;
  smtp_code?:      number;   // SMTP error code e.g. 550
  smtp_enhanced?:  string;   // Enhanced status code e.g. "5.1.1"
  diagnostic_msg?: string;   // Raw SMTP diagnostic

  // Was this bounce handled (contact marked, sequence paused etc.)
  is_handled: boolean;
  handled_at?: Date;

  bounced_at: Date;

  // TTL — auto-delete after 365 days (keep longer for deliverability analysis)
  expires_at: Date;

  created_at: Date;
  updated_at: Date;
}

// ─── Schema ────────────────────────────────────────────────────────
const BounceLogSchema = new Schema<IBounceLog>(
  {
    sequence_id:         { type: Schema.Types.ObjectId, ref: 'Sequence',        required: true },
    sequence_contact_id: { type: Schema.Types.ObjectId, ref: 'SequenceContact', required: true },
    sending_log_id:      { type: Schema.Types.ObjectId, ref: 'SendingLog',      required: true },
    user_id:             { type: Schema.Types.ObjectId, ref: 'User',            required: true },
    email_connection_id: { type: Schema.Types.ObjectId, ref: 'EmailConnection', required: true },

    to_email:   { type: String, required: true, trim: true, lowercase: true },
    step_index: { type: Number, required: true, min: 0 },

    bounce_type:     { type: String, enum: Object.values(BounceType),    required: true },
    bounce_sub_type: { type: String, enum: Object.values(BounceSubType), default: BounceSubType.UNKNOWN },
    smtp_code:       { type: Number },
    smtp_enhanced:   { type: String, trim: true },
    diagnostic_msg:  { type: String, maxlength: 2000 },

    is_handled: { type: Boolean, default: false },
    handled_at: { type: Date },

    bounced_at: { type: Date, required: true, default: Date.now },

    expires_at: {
      type: Date,
      default: () => new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
      index: { expireAfterSeconds: 0 },
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'bounce_logs',
  }
);

// ─── Indexes ───────────────────────────────────────────────────────
// Unhandled bounces queue (worker processes these)
BounceLogSchema.index({ user_id: 1, is_handled: 1, bounced_at: 1 });
// Deliverability: hard bounces per connection (monitor sender reputation)
BounceLogSchema.index({ email_connection_id: 1, bounce_type: 1, bounced_at: -1 });
// Contact-level bounce lookup
BounceLogSchema.index({ sequence_contact_id: 1 });
// Sequence analytics
BounceLogSchema.index({ sequence_id: 1, bounce_type: 1 });

// ─── Model ────────────────────────────────────────────────────────
export const BounceLog = model<IBounceLog>('BounceLog', BounceLogSchema);

/*
 * ── Example Document ─────────────────────────────────────────────
 * {
 *   sequence_id: ObjectId("seq001"),
 *   sequence_contact_id: ObjectId("sc001"),
 *   sending_log_id: ObjectId("sl002"),
 *   to_email: "invalid@notexist.io",
 *   step_index: 0,
 *   bounce_type: "hard",
 *   bounce_sub_type: "invalid_address",
 *   smtp_code: 550,
 *   smtp_enhanced: "5.1.1",
 *   diagnostic_msg: "The email account you tried to reach does not exist.",
 *   is_handled: true,
 *   handled_at: ISODate("2024-06-01T09:00:05Z"),
 *   bounced_at: ISODate("2024-06-01T09:00:03Z"),
 *   expires_at: ISODate("2025-06-01T09:00:03Z")
 * }
 */
