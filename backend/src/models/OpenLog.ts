import { Schema, model, Document, Types } from 'mongoose';

// ─── TypeScript Interface ──────────────────────────────────────────
export interface IOpenLog extends Document {
  sequence_id:         Types.ObjectId;
  sequence_contact_id: Types.ObjectId;
  sending_log_id:      Types.ObjectId;
  user_id:             Types.ObjectId;

  contact_email: string;
  step_index:    number;

  is_first_open: boolean;
  open_count:    number;

  user_agent?:   string;
  ip_address?:   string;
  device_type?:  'desktop' | 'mobile' | 'tablet' | 'unknown';
  mail_client?:  string;
  country_code?: string;

  opened_at: Date;

  // TTL — auto-delete after 180 days
  expires_at: Date;

  created_at: Date;
  updated_at: Date;
}

// ─── Schema ────────────────────────────────────────────────────────
const OpenLogSchema = new Schema<IOpenLog>(
  {
    sequence_id:         { type: Schema.Types.ObjectId, ref: 'Sequence',        required: true },
    sequence_contact_id: { type: Schema.Types.ObjectId, ref: 'SequenceContact', required: true },
    sending_log_id:      { type: Schema.Types.ObjectId, ref: 'SendingLog',      required: true },
    user_id:             { type: Schema.Types.ObjectId, ref: 'User',            required: true },

    contact_email: { type: String, required: true, trim: true, lowercase: true },
    step_index:    { type: Number, required: true, min: 0 },

    is_first_open: { type: Boolean, default: true },
    open_count:    { type: Number, default: 1, min: 1 },

    user_agent:   { type: String, maxlength: 500 },
    ip_address:   { type: String, trim: true },
    device_type:  {
      type: String,
      enum: ['desktop', 'mobile', 'tablet', 'unknown'],
      default: 'unknown',
    },
    mail_client:  { type: String, trim: true, maxlength: 100 },
    country_code: { type: String, trim: true, maxlength: 2 },

    opened_at: { type: Date, required: true, default: Date.now },

    // MongoDB TTL index — auto-delete documents 180 days after opened_at
    expires_at: {
      type: Date,
      default: () => new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
      index: { expireAfterSeconds: 0 },
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'open_logs',
  }
);

// ─── Indexes ───────────────────────────────────────────────────────
// Pixel tracking — has this contact already opened? (dedup check)
OpenLogSchema.index({ sending_log_id: 1, contact_email: 1 });
// Analytics: open rate per step
OpenLogSchema.index({ sequence_id: 1, step_index: 1, is_first_open: 1 });
// Contact engagement timeline
OpenLogSchema.index({ sequence_contact_id: 1, opened_at: -1 });
// User-level open rate dashboard
OpenLogSchema.index({ user_id: 1, opened_at: -1 });

// ─── Model ────────────────────────────────────────────────────────
export const OpenLog = model<IOpenLog>('OpenLog', OpenLogSchema);

/*
 * ── Example Document ─────────────────────────────────────────────
 * {
 *   sequence_id: ObjectId("seq001"),
 *   sequence_contact_id: ObjectId("sc001"),
 *   sending_log_id: ObjectId("sl001"),
 *   contact_email: "founder@acme.io",
 *   step_index: 0,
 *   is_first_open: true,
 *   open_count: 1,
 *   device_type: "desktop",
 *   mail_client: "Gmail",
 *   country_code: "IN",
 *   opened_at: ISODate("2024-06-01T10:15:00Z"),
 *   expires_at: ISODate("2024-12-01T10:15:00Z")
 * }
 */
