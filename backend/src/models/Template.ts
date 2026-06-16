import { Schema, model, Document, Types } from 'mongoose';

// ─── Enums ─────────────────────────────────────────────────────────
export enum TemplateCategory {
  COLD_OUTREACH  = 'cold_outreach',
  FOLLOW_UP      = 'follow_up',
  NURTURE        = 'nurture',
  ONBOARDING     = 'onboarding',
  REENGAGEMENT   = 'reengagement',
  TRANSACTIONAL  = 'transactional',
  CUSTOM         = 'custom',
}

// ─── Variable definition for template variable schema ──────────────
export interface TemplateVariable {
  name: string;        // e.g. "first_name"
  label: string;       // e.g. "First Name"
  default_value: string;
  required: boolean;
}

// ─── TypeScript Interface ──────────────────────────────────────────
export interface ITemplate extends Document {
  user_id: Types.ObjectId;

  name: string;             // Internal name: "Q1 Cold Outreach v2"
  subject: string;          // "{{first_name}}, quick question"
  body_html: string;        // Full HTML body
  body_text?: string;       // Plain-text fallback
  category: TemplateCategory;

  // Variable extraction — auto-populated from {{variable}} scan
  variables: TemplateVariable[];

  // AI-generation metadata (optional)
  ai_generated: boolean;
  ai_prompt?: string;

  // Usage tracking
  times_used: number;
  last_used_at?: Date;

  // Soft delete
  is_archived: boolean;

  created_at: Date;
  updated_at: Date;
}

// ─── Sub-schema ────────────────────────────────────────────────────
const TemplateVariableSchema = new Schema<TemplateVariable>(
  {
    name:          { type: String, required: true, trim: true },
    label:         { type: String, required: true, trim: true },
    default_value: { type: String, default: '' },
    required:      { type: Boolean, default: false },
  },
  { _id: false }
);

// ─── Schema ────────────────────────────────────────────────────────
const TemplateSchema = new Schema<ITemplate>(
  {
    user_id: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    name:        { type: String, required: true, trim: true, maxlength: 200 },
    subject:     { type: String, required: true, trim: true, maxlength: 500 },
    body_html:   { type: String, required: true },
    body_text:   { type: String },
    category:    {
      type: String,
      enum: Object.values(TemplateCategory),
      default: TemplateCategory.CUSTOM,
    },

    variables:    { type: [TemplateVariableSchema], default: [] },

    ai_generated: { type: Boolean, default: false },
    ai_prompt:    { type: String, maxlength: 2000 },

    times_used:   { type: Number, default: 0, min: 0 },
    last_used_at: { type: Date },

    is_archived:  { type: Boolean, default: false, index: true },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'templates',
  }
);

// ─── Indexes ───────────────────────────────────────────────────────
// User's non-archived templates by category
TemplateSchema.index({ user_id: 1, is_archived: 1, category: 1 });
// Full-text search on name + subject
TemplateSchema.index({ name: 'text', subject: 'text' });

// ─── Model ────────────────────────────────────────────────────────
export const Template = model<ITemplate>('Template', TemplateSchema);

/*
 * ── Example Document ─────────────────────────────────────────────
 * {
 *   _id: ObjectId("..."),
 *   user_id: ObjectId("user123"),
 *   name: "SaaS Cold Outreach — Intro",
 *   subject: "Quick question, {{first_name}}",
 *   body_html: "<p>Hi {{first_name}},</p><p>I noticed {{company}} uses...</p>",
 *   body_text:  "Hi {{first_name}}, I noticed {{company}} uses...",
 *   category: "cold_outreach",
 *   variables: [
 *     { name: "first_name", label: "First Name", default_value: "there", required: true },
 *     { name: "company",    label: "Company",    default_value: "your company", required: false }
 *   ],
 *   ai_generated: false,
 *   times_used: 34,
 *   is_archived: false,
 *   created_at: ISODate("2024-03-01"),
 *   updated_at: ISODate("2024-06-01")
 * }
 */
