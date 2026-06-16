import { Schema, model, Document, Types } from 'mongoose';

// ─── Enums ─────────────────────────────────────────────────────────
export enum StepType {
  EMAIL     = 'email',
  WAIT      = 'wait',       // pure delay, no email
  CONDITION = 'condition',  // branch on open/click/reply
}

export enum ConditionType {
  OPENED_EMAIL    = 'opened_email',
  CLICKED_LINK    = 'clicked_link',
  REPLIED         = 'replied',
  NOT_OPENED      = 'not_opened',
  NOT_CLICKED     = 'not_clicked',
}

// ─── Condition branch ──────────────────────────────────────────────
export interface StepCondition {
  type: ConditionType;
  // Index of step to jump to if condition is TRUE (null = continue)
  true_next_step_index?: number;
  // Index of step to jump to if condition is FALSE (null = continue)
  false_next_step_index?: number;
}

// ─── TypeScript Interface ──────────────────────────────────────────
export interface ISequenceStep extends Document {
  sequence_id: Types.ObjectId;
  user_id: Types.ObjectId;

  // Position in sequence (0-indexed, maintained by app logic)
  step_index: number;

  type: StepType;

  // ── EMAIL step fields ─────────────────────────────────────────
  template_id?: Types.ObjectId;  // ref Template (optional — can override below)
  email_connection_id?: Types.ObjectId; // ref EmailConnection (optional override)
  subject_override?: string;     // override template subject
  body_html_override?: string;   // override template body
  body_text_override?: string;

  // ── WAIT / delay settings (apply to all step types) ──────────
  // How long to wait BEFORE sending this step
  delay_days:  number;
  delay_hours: number;

  // ── CONDITION step fields ─────────────────────────────────────
  condition?: StepCondition;

  // Per-step tracking overrides
  track_opens?:  boolean;
  track_clicks?: boolean;

  // Denormalized stats for this step
  stats: {
    sent:     number;
    opens:    number;
    clicks:   number;
    replies:  number;
    bounces:  number;
    skipped:  number;
  };

  is_active: boolean;
  created_at: Date;
  updated_at: Date;
}

// ─── Sub-schemas ───────────────────────────────────────────────────
const ConditionSchema = new Schema<StepCondition>(
  {
    type:                  { type: String, enum: Object.values(ConditionType), required: true },
    true_next_step_index:  { type: Number },
    false_next_step_index: { type: Number },
  },
  { _id: false }
);

const StepStatsSchema = new Schema(
  {
    sent:    { type: Number, default: 0 },
    opens:   { type: Number, default: 0 },
    clicks:  { type: Number, default: 0 },
    replies: { type: Number, default: 0 },
    bounces: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
  },
  { _id: false }
);

// ─── Schema ────────────────────────────────────────────────────────
const SequenceStepSchema = new Schema<ISequenceStep>(
  {
    sequence_id: {
      type: Schema.Types.ObjectId,
      ref: 'Sequence',
      required: true,
      index: true,
    },
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },

    step_index: { type: Number, required: true, min: 0 },

    type: {
      type: String,
      enum: Object.values(StepType),
      default: StepType.EMAIL,
    },

    // EMAIL fields
    template_id:         { type: Schema.Types.ObjectId, ref: 'Template' },
    email_connection_id: { type: Schema.Types.ObjectId, ref: 'EmailConnection' },
    subject_override:    { type: String, trim: true, maxlength: 500 },
    body_html_override:  { type: String },
    body_text_override:  { type: String },

    // Delay
    delay_days:  { type: Number, default: 1, min: 0, max: 365 },
    delay_hours: { type: Number, default: 0, min: 0, max: 23 },

    // Condition (only used when type === 'condition')
    condition: { type: ConditionSchema },

    track_opens:  { type: Boolean },
    track_clicks: { type: Boolean },

    stats:     { type: StepStatsSchema, default: () => ({}) },
    is_active: { type: Boolean, default: true },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'sequence_steps',
  }
);

// ─── Indexes ───────────────────────────────────────────────────────
// Fetch all steps for a sequence ordered by position
SequenceStepSchema.index({ sequence_id: 1, step_index: 1 }, { unique: true });
// Jump to a step by sequence + type (condition branching)
SequenceStepSchema.index({ sequence_id: 1, type: 1 });

// ─── Model ────────────────────────────────────────────────────────
export const SequenceStep = model<ISequenceStep>('SequenceStep', SequenceStepSchema);

/*
 * ── Example Documents ────────────────────────────────────────────
 *
 * Step 0 — Initial email
 * {
 *   sequence_id: ObjectId("seq001"),
 *   step_index: 0,
 *   type: "email",
 *   template_id: ObjectId("tmpl001"),
 *   delay_days: 0, delay_hours: 0,
 *   stats: { sent: 200, opens: 80, clicks: 12 }
 * }
 *
 * Step 1 — Wait 3 days then follow-up
 * {
 *   sequence_id: ObjectId("seq001"),
 *   step_index: 1,
 *   type: "email",
 *   subject_override: "Following up, {{first_name}}",
 *   delay_days: 3, delay_hours: 0,
 * }
 *
 * Step 2 — Condition: if opened step 0, skip to step 3 (softer follow-up)
 * {
 *   sequence_id: ObjectId("seq001"),
 *   step_index: 2,
 *   type: "condition",
 *   condition: { type: "opened_email", true_next_step_index: 3, false_next_step_index: 4 }
 * }
 */
