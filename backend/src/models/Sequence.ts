import { Schema, model, Document, Types } from 'mongoose';

// ─── Enums ─────────────────────────────────────────────────────────
export enum SequenceStatus {
  DRAFT     = 'draft',
  ACTIVE    = 'active',
  PAUSED    = 'paused',
  ARCHIVED  = 'archived',
  COMPLETED = 'completed',
}

export enum SendingSchedule {
  WEEKDAYS_ONLY = 'weekdays_only',
  ALL_DAYS      = 'all_days',
  CUSTOM        = 'custom',
}

// ─── Sending window sub-schema ─────────────────────────────────────
export interface SendingWindow {
  timezone: string;            // "Asia/Kolkata"
  schedule: SendingSchedule;
  start_hour: number;          // 9  → 9 AM
  end_hour: number;            // 17 → 5 PM
  custom_days?: number[];      // 0=Sun, 1=Mon ... 6=Sat
}

// ─── TypeScript Interface ──────────────────────────────────────────
export interface ISequence extends Document {
  user_id: Types.ObjectId;
  email_connection_id?: Types.ObjectId; // fallback/default sending account

  name: string;
  description?: string;
  status: SequenceStatus;

  // Sending window controls
  sending_window: SendingWindow;
  launch_date: Date;
  daily_sending_limit: number;
  reserved_limit_phase1: number;
  warmup_percentage?: number;

  // Stop conditions
  stop_on_reply:  boolean; // pause contact on reply
  stop_on_bounce: boolean; // pause contact on hard bounce
  stop_on_click:  boolean; // stop sequence when contact clicks

  // Tracking
  track_opens:  boolean;
  track_clicks: boolean;

  // Aggregated stats (updated by workers — avoid re-computing)
  stats: {
    total_contacts:  number;
    active_contacts: number;
    completed:       number;
    unsubscribed:    number;
    total_sent:      number;
    total_opens:     number;
    total_clicks:    number;
    total_replies:   number;
    total_bounces:   number;
  };

  // Step count (denormalized for UI)
  step_count: number;

  is_archived: boolean;
  created_at:  Date;
  updated_at:  Date;
}

// ─── Sub-schemas ───────────────────────────────────────────────────
const SendingWindowSchema = new Schema<SendingWindow>(
  {
    timezone:    { type: String, required: true, default: 'UTC' },
    schedule:    {
      type: String,
      enum: Object.values(SendingSchedule),
      default: SendingSchedule.WEEKDAYS_ONLY,
    },
    start_hour:  { type: Number, min: 0, max: 23, default: 9 },
    end_hour:    { type: Number, min: 0, max: 23, default: 17 },
    custom_days: { type: [Number], default: undefined },
  },
  { _id: false }
);

const StatsSchema = new Schema(
  {
    total_contacts:  { type: Number, default: 0 },
    active_contacts: { type: Number, default: 0 },
    completed:       { type: Number, default: 0 },
    unsubscribed:    { type: Number, default: 0 },
    total_sent:      { type: Number, default: 0 },
    total_opens:     { type: Number, default: 0 },
    total_clicks:    { type: Number, default: 0 },
    total_replies:   { type: Number, default: 0 },
    total_bounces:   { type: Number, default: 0 },
  },
  { _id: false }
);

// ─── Schema ────────────────────────────────────────────────────────
const SequenceSchema = new Schema<ISequence>(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },
    email_connection_id: {
      type: Schema.Types.ObjectId,
      ref: 'EmailConnection',
    },

    name:        { type: String, required: true, trim: true, maxlength: 200 },
    description: { type: String, trim: true, maxlength: 1000 },
    status:      {
      type: String,
      enum: Object.values(SequenceStatus),
      default: SequenceStatus.DRAFT,
      index: true,
    },

    launch_date:           { type: Date, required: true },
    daily_sending_limit:   { type: Number, required: true, default: 100 },
    reserved_limit_phase1: { type: Number, required: true, default: 50 },
    warmup_percentage:     { type: Number },

    sending_window: { type: SendingWindowSchema, default: () => ({}) },

    stop_on_reply:  { type: Boolean, default: true },
    stop_on_bounce: { type: Boolean, default: true },
    stop_on_click:  { type: Boolean, default: false },

    track_opens:  { type: Boolean, default: true },
    track_clicks: { type: Boolean, default: true },

    stats:      { type: StatsSchema, default: () => ({}) },
    step_count: { type: Number, default: 0, min: 0 },

    is_archived: { type: Boolean, default: false },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'sequences',
  }
);

// ─── Indexes ───────────────────────────────────────────────────────
// List user's active sequences
SequenceSchema.index({ user_id: 1, status: 1 });
// Dashboard: user's non-archived sequences sorted by date
SequenceSchema.index({ user_id: 1, is_archived: 1, created_at: -1 });
// Full-text search on name
SequenceSchema.index({ name: 'text', description: 'text' });

// ─── Model ────────────────────────────────────────────────────────
export const Sequence = model<ISequence>('Sequence', SequenceSchema);

/*
 * ── Example Document ─────────────────────────────────────────────
 * {
 *   _id: ObjectId("seq001"),
 *   user_id: ObjectId("user123"),
 *   email_connection_id: ObjectId("conn001"),
 *   name: "SaaS Founders — Q3 Outreach",
 *   description: "Cold outreach to Series A SaaS founders",
 *   status: "active",
 *   sending_window: {
 *     timezone: "Asia/Kolkata",
 *     schedule: "weekdays_only",
 *     start_hour: 9,
 *     end_hour: 18
 *   },
 *   stop_on_reply: true,
 *   track_opens: true,
 *   track_clicks: true,
 *   stats: { total_contacts: 200, total_sent: 450, total_opens: 120, total_replies: 18 },
 *   step_count: 3,
 *   created_at: ISODate("2024-06-01")
 * }
 */
