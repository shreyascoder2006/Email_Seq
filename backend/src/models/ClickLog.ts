import { Schema, model, Document, Types } from 'mongoose';

// ─── TypeScript Interface ──────────────────────────────────────────
export interface IClickLog extends Document {
  sequence_id:         Types.ObjectId;
  sequence_contact_id: Types.ObjectId;
  sending_log_id:      Types.ObjectId;
  user_id:             Types.ObjectId;

  contact_email: string;
  step_index:    number;

  // The actual URL clicked
  original_url:  string;
  tracking_id:   string;      // short ID embedded in tracking URL

  is_first_click: boolean;
  click_count:    number;

  // Device info
  user_agent?:   string;
  ip_address?:   string;
  device_type?:  'desktop' | 'mobile' | 'tablet' | 'unknown';
  country_code?: string;

  clicked_at: Date;

  // TTL — auto-delete after 180 days
  expires_at: Date;

  created_at: Date;
  updated_at: Date;
}

// ─── Schema ────────────────────────────────────────────────────────
const ClickLogSchema = new Schema<IClickLog>(
  {
    sequence_id:         { type: Schema.Types.ObjectId, ref: 'Sequence',        required: true },
    sequence_contact_id: { type: Schema.Types.ObjectId, ref: 'SequenceContact', required: true },
    sending_log_id:      { type: Schema.Types.ObjectId, ref: 'SendingLog',      required: true },
    user_id:             { type: Schema.Types.ObjectId, ref: 'User',            required: true },

    contact_email: { type: String, required: true, trim: true, lowercase: true },
    step_index:    { type: Number, required: true, min: 0 },

    original_url: { type: String, required: true, maxlength: 2000 },
    tracking_id:  { type: String, required: true, trim: true, index: true },

    is_first_click: { type: Boolean, default: true },
    click_count:    { type: Number, default: 0, min: 0 },

    user_agent:   { type: String, maxlength: 500 },
    ip_address:   { type: String, trim: true },
    device_type:  { type: String, enum: ['desktop', 'mobile', 'tablet', 'unknown'], default: 'unknown' },
    country_code: { type: String, trim: true, maxlength: 2 },

    clicked_at: { type: Date, required: true, default: Date.now },

    expires_at: {
      type: Date,
      default: () => new Date(Date.now() + 180 * 24 * 60 * 60 * 1000),
      index: { expireAfterSeconds: 0 },
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'click_logs',
  }
);

// ─── Indexes ───────────────────────────────────────────────────────
// Fast redirect lookup by tracking_id (the hot path for click tracking)
ClickLogSchema.index({ tracking_id: 1 });
// Unique click per contact per URL (for de-duplication)
ClickLogSchema.index({ sending_log_id: 1, contact_email: 1, original_url: 1 });
// Analytics per sequence/step
ClickLogSchema.index({ sequence_id: 1, step_index: 1, is_first_click: 1 });
// Contact timeline
ClickLogSchema.index({ sequence_contact_id: 1, clicked_at: -1 });

// ─── Model ────────────────────────────────────────────────────────
export const ClickLog = model<IClickLog>('ClickLog', ClickLogSchema);

/*
 * ── Example Document ─────────────────────────────────────────────
 * {
 *   sequence_contact_id: ObjectId("sc001"),
 *   sending_log_id: ObjectId("sl001"),
 *   contact_email: "founder@acme.io",
 *   step_index: 0,
 *   original_url: "https://calendly.com/shreyas/30min",
 *   tracking_id:  "trk_7xKq2mZ",
 *   is_first_click: true,
 *   click_count: 1,
 *   device_type: "desktop",
 *   country_code: "IN",
 *   clicked_at: ISODate("2024-06-01T10:22:00Z"),
 *   expires_at: ISODate("2024-12-01T10:22:00Z")
 * }
 */
