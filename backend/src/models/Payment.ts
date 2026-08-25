/**
 * src/models/Payment.ts
 *
 * Payment record model — stores the full lifecycle of a Razorpay transaction.
 *
 * SECURITY RULES:
 *   - razorpay_signature is intentionally NOT stored. It is used transiently
 *     for verification only and discarded immediately. Storing it serves no
 *     purpose and adds unnecessary exposure.
 *   - No card numbers, CVV, bank credentials, or account details are stored.
 *   - The Razorpay order/payment IDs are safe identifiers (not secrets).
 *
 * ISOLATION:
 *   This model has zero dependencies on sequence, scheduling, Redis, or email
 *   subsystems. Payment failures are entirely contained here.
 *
 * IDEMPOTENCY:
 *   razorpay_order_id has a unique index.
 *   razorpay_payment_id has a unique sparse index.
 *   Update operations always include a status filter (e.g. { status: 'created' })
 *   so duplicate webhook/verify calls become no-ops at the database level.
 */

import { Schema, model, Document, Types } from 'mongoose';

// ─── Enums ─────────────────────────────────────────────────────────────
export enum PaymentProvider {
  RAZORPAY = 'razorpay',
}

export enum PaymentEnvironment {
  TEST = 'test',
  LIVE = 'live',
}

export enum PaymentStatus {
  CREATED = 'created',   // Razorpay order created; checkout not yet completed
  PAID    = 'paid',      // Signature verified; entitlement granted
  FAILED  = 'failed',    // Payment failed or was cancelled
}

export enum PurchasedPlan {
  PRO = 'pro',
  // Future paid plans can be added here without model migration
}

// ─── TypeScript Interface ───────────────────────────────────────────────
export interface IPayment extends Document {
  // Ownership
  user_id: Types.ObjectId;  // ref: 'User'

  // Provider metadata
  provider:    PaymentProvider;     // always 'razorpay' for now
  environment: PaymentEnvironment;  // 'test' | 'live'

  // What was purchased
  plan:     PurchasedPlan;  // the plan being upgraded to (e.g. 'pro')
  amount:   number;         // in smallest currency unit (paise for INR)
  currency: string;         // 'INR'

  // Razorpay identifiers (NOT secrets)
  razorpay_order_id:    string;   // created before checkout; always present
  razorpay_payment_id?: string;   // returned by checkout on success

  // Lifecycle
  status:     PaymentStatus;
  created_at: Date;
  paid_at?:   Date;  // set only when status transitions to 'paid'
}

// ─── Schema ────────────────────────────────────────────────────────────
const PaymentSchema = new Schema<IPayment>(
  {
    user_id: {
      type:     Schema.Types.ObjectId,
      ref:      'User',
      required: true,
    },

    provider: {
      type:     String,
      enum:     Object.values(PaymentProvider),
      default:  PaymentProvider.RAZORPAY,
      required: true,
    },

    environment: {
      type:     String,
      enum:     Object.values(PaymentEnvironment),
      required: true,
    },

    plan: {
      type:     String,
      enum:     Object.values(PurchasedPlan),
      required: true,
    },

    amount: {
      type:     Number,
      required: true,
      min:      0,
    },

    currency: {
      type:      String,
      required:  true,
      uppercase: true,
      trim:      true,
      default:   'INR',
    },

    razorpay_order_id: {
      type:     String,
      required: true,
      trim:     true,
    },

    razorpay_payment_id: {
      type:  String,
      trim:  true,
      // sparse = index skips documents where this field is absent (i.e. status='created')
    },

    status: {
      type:    String,
      enum:    Object.values(PaymentStatus),
      default: PaymentStatus.CREATED,
    },

    // Stored explicitly — not relying on updatedAt — for query clarity.
    paid_at: {
      type: Date,
    },
  },
  {
    timestamps: { createdAt: 'created_at', updatedAt: 'updated_at' },
    collection: 'payments',
  }
);

// ─── Indexes ───────────────────────────────────────────────────────────

// Primary lookup for verify + webhook idempotency — must be unique.
// Every payment flow begins with an order_id, so this is always present.
PaymentSchema.index({ razorpay_order_id: 1 }, { unique: true });

// Secondary lookup after Checkout success.
// sparse: true means the index skips documents where razorpay_payment_id is absent
// (i.e. status='created' records before checkout completes).
PaymentSchema.index({ razorpay_payment_id: 1 }, { unique: true, sparse: true });

// Payment history query: all payments for a user, sorted by most recent.
PaymentSchema.index({ user_id: 1, created_at: -1 });

// ─── Model ─────────────────────────────────────────────────────────────
export const Payment = model<IPayment>('Payment', PaymentSchema);
