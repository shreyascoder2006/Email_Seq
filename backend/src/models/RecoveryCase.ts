/**
 * src/models/RecoveryCase.ts
 *
 * Tracks payment failure → recovery lifecycle driven by Razorpay webhooks.
 *
 * ISOLATION:
 *   This model has zero dependencies on sequence, scheduling, Redis,
 *   email worker, or SMTP subsystems.  A payment failure opens a case;
 *   a successful charge/capture closes it.  Notification and re-try logic
 *   lives elsewhere (never here).
 *
 * IDEMPOTENCY (mirrors Payment.ts):
 *   razorpay_order_id + case_type has a unique index.
 *   Status-filtered updates (e.g. { status: OPEN }) mean duplicate webhook
 *   deliveries become no-ops at the database level — no application-level
 *   deduplication needed.
 *
 * DESIGN:
 *   One document per (order_id, case_type) pair.  A single order can have
 *   at most one open PAYMENT_FAILED case AND one open SUBSCRIPTION_FAILED
 *   case simultaneously.
 */

import { Schema, model, Document, Types } from 'mongoose';

// ─── Enums ──────────────────────────────────────────────────────────

export enum RecoveryCaseType {
  PAYMENT_FAILED      = 'PAYMENT_FAILED',
  SUBSCRIPTION_FAILED = 'SUBSCRIPTION_FAILED',
  STOPPED_DISPUTED    = 'STOPPED_DISPUTED',
}

export enum RecoveryCaseStatus {
  OPEN             = 'OPEN',
  RECOVERED        = 'RECOVERED',
  STOPPED_DISPUTED = 'STOPPED_DISPUTED',
}

// ─── TypeScript interface ────────────────────────────────────────────

export interface IRecoveryCase extends Document {
  // Ownership
  razorpay_order_id:        string;
  razorpay_subscription_id?: string;   // set for subscription events

  // Classification
  case_type: RecoveryCaseType;
  status:    RecoveryCaseStatus;

  // Failure details (populated on open)
  last_error?: {
    error_code?:        string;
    error_description?: string;
    error_source?:      string;
    error_step?:        string;
    error_reason?:      string;
  };

  // Recovery details (populated on close)
  recovered_amount?: number;  // in smallest currency unit (paise)
  recovered_at?:     Date;

  // Hard-stop: next_action_at=null means the sequencer must not retry
  next_action_at?: Date | null;

  // Audit
  opened_at:  Date;
  closed_at?: Date;

  created_at: Date;
  updated_at: Date;
}

// ─── Schema ─────────────────────────────────────────────────────────

const RecoveryCaseSchema = new Schema<IRecoveryCase>(
  {
    razorpay_order_id: {
      type:     String,
      required: true,
      trim:     true,
    },

    razorpay_subscription_id: {
      type: String,
      trim: true,
    },

    case_type: {
      type:     String,
      enum:     Object.values(RecoveryCaseType),
      required: true,
    },

    status: {
      type:    String,
      enum:    Object.values(RecoveryCaseStatus),
      default: RecoveryCaseStatus.OPEN,
    },

    last_error: {
      error_code:        { type: String },
      error_description: { type: String },
      error_source:      { type: String },
      error_step:        { type: String },
      error_reason:      { type: String },
    },

    recovered_amount: { type: Number, min: 0 },
    recovered_at:     { type: Date },

    next_action_at: { type: Date, default: undefined },

    opened_at: { type: Date, required: true, default: Date.now },
    closed_at: { type: Date },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'recovery_cases',
  }
);

// ─── Indexes ────────────────────────────────────────────────────────

// One OPEN case per (order_id, case_type) — idempotency at DB level.
// sparse: false because razorpay_order_id is always present.
RecoveryCaseSchema.index(
  { razorpay_order_id: 1, case_type: 1 },
  { unique: true }
);

// Fast look-up of all open cases (for dashboards / retry workers)
RecoveryCaseSchema.index({ status: 1, opened_at: -1 });

// Subscription-based lookup
RecoveryCaseSchema.index({ razorpay_subscription_id: 1 }, { sparse: true });

// ─── Model ──────────────────────────────────────────────────────────
export const RecoveryCase = model<IRecoveryCase>('RecoveryCase', RecoveryCaseSchema);
