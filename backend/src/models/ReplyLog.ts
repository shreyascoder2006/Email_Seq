import { Schema, model, Document, Types } from 'mongoose';

// ─── Enums ─────────────────────────────────────────────────────────
export enum ReplyClassification {
  INTERESTED     = 'interested',
  NOT_INTERESTED = 'not_interested',
  UNSUBSCRIBE    = 'unsubscribe',
  OUT_OF_OFFICE  = 'out_of_office',
  BOUNCE_LIKE    = 'bounce_like',
  REFERRAL       = 'referral',
  UNKNOWN        = 'unknown',
}

// ─── TypeScript Interface ──────────────────────────────────────────
export interface IReplyLog extends Document {
  // References
  sequence_id:         Types.ObjectId;
  sequence_contact_id: Types.ObjectId;
  sending_log_id:      Types.ObjectId;  // which email triggered the reply
  user_id:             Types.ObjectId;

  // Reply envelope
  from_email:   string;
  from_name?:   string;
  to_email:     string;
  subject:      string;
  body_text?:   string;
  body_html?:   string;
  message_id?:  string;
  in_reply_to?: string; // links back to sending_log.message_id

  // Which step index was replied to
  replied_to_step_index: number;

  // Classification (manual or AI)
  classification:     ReplyClassification;
  classification_confidence?: number; // 0–1 (AI confidence score)
  is_auto_classified: boolean;

  // Was this reply processed (paused sequence etc.)
  is_processed: boolean;
  processed_at?: Date;

  // IMAP source metadata
  imap_uid?:    number;
  received_at:  Date;

  // TTL — auto-delete reply logs after 180 days
  expires_at: Date;

  created_at: Date;
  updated_at: Date;
}

// ─── Schema ────────────────────────────────────────────────────────
const ReplyLogSchema = new Schema<IReplyLog>(
  {
    sequence_id:         { type: Schema.Types.ObjectId, ref: 'Sequence',        required: true },
    sequence_contact_id: { type: Schema.Types.ObjectId, ref: 'SequenceContact', required: true },
    sending_log_id:      { type: Schema.Types.ObjectId, ref: 'SendingLog',      required: true },
    user_id:             { type: Schema.Types.ObjectId, ref: 'User',            required: true },

    from_email:   { type: String, required: true, trim: true, lowercase: true },
    from_name:    { type: String, trim: true },
    to_email:     { type: String, required: true, trim: true, lowercase: true },
    subject:      { type: String, trim: true, default: '' },
    body_text:    { type: String },
    body_html:    { type: String },
    message_id:   { type: String, trim: true },
    in_reply_to:  { type: String, trim: true },

    replied_to_step_index: { type: Number, required: true, min: 0 },

    classification: {
      type: String,
      enum: Object.values(ReplyClassification),
      default: ReplyClassification.UNKNOWN,
    },
    classification_confidence: { type: Number, min: 0, max: 1 },
    is_auto_classified:        { type: Boolean, default: false },

    is_processed: { type: Boolean, default: false, index: true },
    processed_at: { type: Date },

    imap_uid:    { type: Number },
    received_at: { type: Date, required: true, default: Date.now },

    expires_at: {
      type: Date,
      default: () => new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
      index: { expireAfterSeconds: 0 },
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'reply_logs',
  }
);

// ─── Indexes ───────────────────────────────────────────────────────
// Fetch replies for a sequence contact
ReplyLogSchema.index({ sequence_contact_id: 1, received_at: -1 });
// Unprocessed replies queue (worker polls this)
ReplyLogSchema.index({ user_id: 1, is_processed: 1, received_at: 1 });
// Link from message_id → sending_log
ReplyLogSchema.index({ in_reply_to: 1 }, { sparse: true });
// Sequence-level reply analytics
ReplyLogSchema.index({ sequence_id: 1, classification: 1 });

// ─── Model ────────────────────────────────────────────────────────
export const ReplyLog = model<IReplyLog>('ReplyLog', ReplyLogSchema);

/*
 * ── Example Document ─────────────────────────────────────────────
 * {
 *   sequence_id: ObjectId("seq001"),
 *   sequence_contact_id: ObjectId("sc001"),
 *   sending_log_id: ObjectId("sl001"),
 *   from_email: "founder@acme.io",
 *   subject: "Re: Quick question, Alice",
 *   body_text: "Hey! Yes, we'd love to chat. Book a time here...",
 *   in_reply_to: "<20240601.abc123@gmail.com>",
 *   replied_to_step_index: 0,
 *   classification: "interested",
 *   classification_confidence: 0.92,
 *   is_auto_classified: true,
 *   is_processed: true,
 *   received_at: ISODate("2024-06-02T11:30:00Z"),
 *   expires_at: ISODate("2024-12-02T11:30:00Z")
 * }
 */
