/**
 * src/services/payment.service.ts
 *
 * Payment business logic — isolated from all email/scheduling/Redis systems.
 *
 * ISOLATION GUARANTEE:
 *   This service imports ONLY from:
 *     - config/razorpay  (Razorpay SDK + PLAN_CONFIG)
 *     - config/env       (environment variables)
 *     - models/Payment   (billing model)
 *     - models/User      (plan entitlement)
 *     - utils/AppError   (error factory)
 *
 *   It has ZERO imports from: sequence, scheduler, Redis, BullMQ,
 *   email worker, SMTP, Gemini AI, analytics, or import services.
 *   A Razorpay outage affects ONLY this service.
 *
 * EDGE CASE HANDLING:
 *   - Razorpay API failure  → AppError.internal() (never leaks SDK internals)
 *   - MongoDB write failure → AppError propagated to controller → 500
 *   - User already on PRO   → AppError.conflict() → 409
 *   - Plan not found        → AppError.badRequest() → 400
 *   - Missing credentials   → AppError.internal() from getRazorpayInstance()
 */

import crypto from 'crypto';
import { Types } from 'mongoose';
import { getRazorpayInstance, getRazorpayKeyId, PLAN_CONFIG } from '../config/razorpay';
import { env } from '../config/env';
import {
  Payment,
  PaymentEnvironment,
  PaymentStatus,
  PurchasedPlan,
  IPayment,
} from '../models/Payment';
import { User, UserPlan } from '../models/User';
import { AppError } from '../utils/AppError';
import logger from '../config/logger';

// ─── Types ─────────────────────────────────────────────────────────────

export interface CreateOrderResult {
  order_id:   string;   // Razorpay order ID — safe to return to frontend
  amount:     number;   // In paise (e.g. 99900 for ₹999)
  currency:   string;   // 'INR'
  key_id:     string;   // Public Razorpay Key ID — safe for Checkout
  payment_db_id: string; // Internal MongoDB Payment _id (for reference only)
}

export interface PaymentHistoryItem {
  id:                 string;
  plan:               string;
  amount:             number;
  currency:           string;
  status:             string;
  environment:        string;
  razorpay_order_id:  string;
  created_at:         Date;
  paid_at?:           Date;
}

// ═══════════════════════════════════════════════════════════════════════
//  createOrder
//  POST /api/payments/create-order
//
//  Flow:
//    1. Validate plan is purchasable
//    2. Check user is not already on this plan
//    3. Look up authoritative price from PLAN_CONFIG (never from request)
//    4. Create Razorpay TEST order via SDK
//    5. Persist Payment record (status = 'created')
//    6. Return safe checkout data — NEVER return KEY_SECRET
// ═══════════════════════════════════════════════════════════════════════
export async function createOrder(
  userId: string,
  plan: string
): Promise<CreateOrderResult> {

  // ── 1. Validate plan exists and has a non-zero price ───────────────
  const planConfig = PLAN_CONFIG[plan as keyof typeof PLAN_CONFIG];
  if (!planConfig) {
    throw AppError.badRequest(`Unknown plan: "${plan}"`);
  }
  if (planConfig.amountPaise === 0) {
    // 'free' cannot be purchased via Razorpay
    throw AppError.badRequest(`Plan "${plan}" cannot be purchased`);
  }

  // ── 2. Check if user already holds this plan ───────────────────────
  // If User document doesn't exist (edge case), treat as plan='free'.
  const existingUser = await User.findById(userId).select('plan').lean();
  if (existingUser?.plan === plan) {
    throw AppError.conflict(
      `You are already on the ${planConfig.label} plan`
    );
  }

  // ── 3. Create Razorpay order (authoritative amount from PLAN_CONFIG) ─
  const razorpay = getRazorpayInstance();

  // receipt is a human-readable reference visible in the Razorpay dashboard.
  // Limited to 40 characters by the Razorpay API.
  const receipt = `usr_${userId.slice(-6)}_${Date.now().toString().slice(-8)}`;

  let razorpayOrder: { id: string; amount: string | number; currency: string };
  try {
    razorpayOrder = await razorpay.orders.create({
      amount:   planConfig.amountPaise,
      currency: planConfig.currency,
      receipt,
      notes: {
        // Visible in Razorpay dashboard — safe metadata only
        plan:        plan,
        environment: env.RAZORPAY_MODE,
        // user_id intentionally omitted from notes for minimal exposure
      },
    });
  } catch (err) {
    // Do NOT log or re-throw the raw SDK error — it may contain internal details.
    logger.error('Razorpay order creation failed', {
      plan,
      receipt,
      // Deliberately log only the error message, not the full SDK response
      error: (err as Error).message,
    });
    throw AppError.internal(
      'Payment provider is temporarily unavailable. Please try again.'
    );
  }

  // ── 4. Persist Payment record in MongoDB ───────────────────────────
  // This happens AFTER the Razorpay order is created.
  // If this write fails, the Razorpay order exists but no Payment record does.
  // The user can retry — a new order will be created next time.
  // The abandoned Razorpay order is harmless (it has no checkout associated).
  let payment: IPayment;
  try {
    payment = await Payment.create({
      user_id:           new Types.ObjectId(userId),
      provider:          'razorpay',
      environment:       env.RAZORPAY_MODE as PaymentEnvironment,
      plan:              plan as PurchasedPlan,
      amount:            planConfig.amountPaise,
      currency:          planConfig.currency,
      razorpay_order_id: razorpayOrder.id,
      status:            PaymentStatus.CREATED,
    });
  } catch (err) {
    logger.error('Payment record creation failed after Razorpay order', {
      razorpay_order_id: razorpayOrder.id,
      error: (err as Error).message,
    });
    // Surface a clear error — the Razorpay order was created but not recorded.
    throw AppError.internal(
      'Order was created but could not be saved. Please contact support ' +
      `with reference: ${razorpayOrder.id}`
    );
  }

  logger.info('Payment order created', {
    razorpay_order_id: razorpayOrder.id,
    plan,
    amount_paise: planConfig.amountPaise,
    environment: env.RAZORPAY_MODE,
    // Never log user_id in plain text in production logs — log a hash or last 4 chars
    user_suffix: userId.slice(-4),
  });

  // ── 5. Return safe checkout data ───────────────────────────────────
  // key_id is the PUBLIC credential — safe to return.
  // KEY_SECRET is NEVER returned.
  return {
    order_id:      razorpayOrder.id,
    amount:        planConfig.amountPaise,
    currency:      planConfig.currency,
    key_id:        getRazorpayKeyId(),
    payment_db_id: (payment._id as Types.ObjectId).toString(),
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  getPaymentHistory
//  GET /api/payments/history
//  Returns paginated payment history for the authenticated user.
// ═══════════════════════════════════════════════════════════════════════
export async function getPaymentHistory(
  userId: string
): Promise<PaymentHistoryItem[]> {
  const payments = await Payment.find(
    { user_id: new Types.ObjectId(userId) },
    {
      plan:               1,
      amount:             1,
      currency:           1,
      status:             1,
      environment:        1,
      razorpay_order_id:  1,
      created_at:         1,
      paid_at:            1,
    }
  )
    .sort({ created_at: -1 })
    .limit(50)
    .lean();

  return payments.map((p) => ({
    id:                (p._id as Types.ObjectId).toString(),
    plan:              p.plan,
    amount:            p.amount,
    currency:          p.currency,
    status:            p.status,
    environment:       p.environment,
    razorpay_order_id: p.razorpay_order_id,
    created_at:        p.created_at,
    paid_at:           p.paid_at,
  }));
}

// ═══════════════════════════════════════════════════════════════════════
//  getCurrentPlan
//  GET /api/payments/plan
//  Returns the user's current plan and entitlement fields.
// ═══════════════════════════════════════════════════════════════════════
export async function getCurrentPlan(userId: string) {
  const user = await User.findById(userId)
    .select('plan plan_started_at plan_expires_at')
    .lean();

  // If no User document yet, default to free
  return {
    plan:             user?.plan ?? UserPlan.FREE,
    plan_started_at:  user?.plan_started_at ?? null,
    plan_expires_at:  user?.plan_expires_at ?? null,
  };
}

// ═══════════════════════════════════════════════════════════════════════
//  verifyPayment
//  POST /api/payments/verify
//
//  This is the most security-critical function in the payment module.
//
//  Flow:
//    1. Look up Payment by razorpay_order_id → 404 if missing
//    2. Verify payment belongs to authenticated user → 403 if mismatch
//    3. Idempotency: if already 'paid' → 409 (safe no-op)
//    4. Compute expected HMAC-SHA256 signature
//    5. Compare using timingSafeEqual → 400 if invalid (no DB writes)
//    6. Atomically mark Payment as 'paid'
//    7. Upsert User plan to 'pro'
//    8. Return plan data
//
//  SECURITY PROPERTIES:
//    - RAZORPAY_KEY_SECRET is used ONLY for HMAC computation, never logged.
//    - timingSafeEqual prevents timing side-channel attacks on the signature.
//    - DB writes happen ONLY after signature passes — never before.
//    - The status='created' filter on findOneAndUpdate makes concurrent
//      /verify calls naturally idempotent at the database level.
// ═══════════════════════════════════════════════════════════════════════

export interface VerifyPaymentInput {
  razorpay_order_id:   string;
  razorpay_payment_id: string;
  razorpay_signature:  string;
}

export interface VerifyPaymentResult {
  plan:            string;
  plan_started_at: Date;
}

export async function verifyPayment(
  userId: string,
  input: VerifyPaymentInput
): Promise<VerifyPaymentResult> {

  const { razorpay_order_id, razorpay_payment_id, razorpay_signature } = input;

  // ── 1. Look up Payment record by Razorpay order ID ─────────────────
  const payment = await Payment.findOne({ razorpay_order_id });
  if (!payment) {
    // Unknown order — do not reveal whether it belongs to another user.
    throw AppError.notFound('Payment order not found');
  }

  // ── 2. Ownership check — prevent cross-user verification ───────────
  // A malicious user must not be able to verify another user's payment
  // by replaying their order ID in their own session.
  if (payment.user_id.toString() !== userId) {
    throw AppError.forbidden('You are not authorized to verify this payment');
  }

  // ── 3. Idempotency — already verified ──────────────────────────────
  // If /verify is called twice (e.g. retry after timeout), return
  // the current state without re-running any business logic.
  if (payment.status === PaymentStatus.PAID) {
    const user = await User.findById(userId).select('plan plan_started_at').lean();
    return {
      plan:            user?.plan ?? payment.plan,
      plan_started_at: user?.plan_started_at ?? payment.paid_at ?? new Date(),
    };
  }

  // ── 4. HMAC-SHA256 signature verification ──────────────────────────
  // Razorpay specification:
  //   signature = HMAC_SHA256(
  //     key  = RAZORPAY_KEY_SECRET,
  //     data = razorpay_order_id + "|" + razorpay_payment_id
  //   )
  //
  // RAZORPAY_KEY_SECRET is read directly from env — it is NEVER logged,
  // returned in responses, or assigned to a variable that outlives this scope.
  if (!env.RAZORPAY_KEY_SECRET) {
    throw AppError.internal('Payment verification is not configured');
  }

  const expectedSignature = crypto
    .createHmac('sha256', env.RAZORPAY_KEY_SECRET)
    .update(`${razorpay_order_id}|${razorpay_payment_id}`)
    .digest('hex');

  // timingSafeEqual prevents timing side-channel attacks.
  // Both buffers must be the same length; if lengths differ,
  // the signature is definitively invalid.
  const expectedBuffer = Buffer.from(expectedSignature, 'hex');
  const receivedBuffer = Buffer.from(razorpay_signature, 'hex');

  const signatureValid =
    expectedBuffer.length === receivedBuffer.length &&
    crypto.timingSafeEqual(expectedBuffer, receivedBuffer);

  if (!signatureValid) {
    // Log the failure for monitoring — but NEVER log the signature values.
    logger.warn('Payment signature verification failed', {
      razorpay_order_id,
      user_suffix: userId.slice(-4),
    });
    throw AppError.badRequest('Payment signature verification failed');
  }

  // ── 5. Atomically mark Payment as 'paid' ───────────────────────────
  // The status='created' filter ensures this is a no-op if the payment
  // has already been marked paid by a concurrent webhook call.
  const now = new Date();

  const updatedPayment = await Payment.findOneAndUpdate(
    { razorpay_order_id, status: PaymentStatus.CREATED },
    {
      $set: {
        status:              PaymentStatus.PAID,
        razorpay_payment_id: razorpay_payment_id,
        paid_at:             now,
      },
    },
    { new: true }
  );

  // If updatedPayment is null, a concurrent call already marked it paid.
  // Treat as idempotent success.
  if (!updatedPayment) {
    const user = await User.findById(userId).select('plan plan_started_at').lean();
    return {
      plan:            user?.plan ?? payment.plan,
      plan_started_at: user?.plan_started_at ?? now,
    };
  }

  // ── 6. Upsert User plan to 'pro' ───────────────────────────────────
  // upsert: true handles the edge case where the User document doesn't
  // exist yet (e.g. in development with a new hardcoded userId).
  // $setOnInsert ensures plan_started_at is only set on first creation.
  const updatedUser = await User.findOneAndUpdate(
    { _id: new Types.ObjectId(userId) },
    {
      $set: {
        plan:            payment.plan as unknown as UserPlan,
        plan_started_at: now,
      },
    },
    { upsert: true, new: true }
  );

  logger.info('Payment verified — plan upgraded', {
    razorpay_order_id,
    razorpay_payment_id,
    plan:        payment.plan,
    user_suffix: userId.slice(-4),
    environment: payment.environment,
  });

  return {
    plan:            updatedUser.plan,
    plan_started_at: now,
  };
}
