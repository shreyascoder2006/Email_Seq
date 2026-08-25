/**
 * src/controllers/payment.controller.ts
 *
 * HTTP handlers for payment endpoints.
 * Delegates all business logic to payment.service.ts.
 *
 * Follows the exact same pattern as sequence.controller.ts:
 *   - uid() helper extracts userId from JWT payload
 *   - try/catch/next(err) for every handler
 *   - sendSuccess / sendCreated for responses
 */

import { Response, NextFunction } from 'express';
import { AuthenticatedRequest }   from '../types';
import { AppError }               from '../utils/AppError';
import { sendSuccess, sendCreated } from '../utils/response';
import {
  createOrder,
  getPaymentHistory,
  getCurrentPlan,
  verifyPayment,
} from '../services/payment.service';

// ─── Helper (identical pattern to sequence.controller.ts) ──────────────
function uid(req: AuthenticatedRequest): string {
  if (!req.user?.userId) throw AppError.unauthorized();
  return req.user.userId;
}

// ═══════════════════════════════════════════════════════════════════════
//  POST /api/payments/create-order
//
//  Request body (Zod-validated before reaching here):
//    { plan: 'pro' }
//
//  Response:
//    { order_id, amount, currency, key_id, payment_db_id }
//
//  SECURITY: key_id (public) is returned. KEY_SECRET is NEVER returned.
//  SECURITY: amount is set by backend from PLAN_CONFIG, never from request.
//  SECURITY: User.plan is NOT updated here — only after /verify succeeds.
// ═══════════════════════════════════════════════════════════════════════
export async function createOrderController(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await createOrder(uid(req), req.body.plan);
    sendCreated(res, result, 'Order created — proceed to checkout');
  } catch (err) {
    next(err);
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  GET /api/payments/history
//  Returns the authenticated user's payment history (last 50 records).
// ═══════════════════════════════════════════════════════════════════════
export async function getPaymentHistoryController(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const history = await getPaymentHistory(uid(req));
    sendSuccess(res, history, `${history.length} payment record(s) retrieved`);
  } catch (err) {
    next(err);
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  POST /api/payments/verify
//
//  Receives the three fields from Razorpay Checkout success callback.
//  Delegates HMAC-SHA256 verification entirely to payment.service.
//  NEVER updates plan state without passing service verification.
//
//  Request:  { razorpay_order_id, razorpay_payment_id, razorpay_signature }
//  Response: { plan, plan_started_at }
// ═══════════════════════════════════════════════════════════════════════
export async function verifyPaymentController(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await verifyPayment(uid(req), {
      razorpay_order_id:   req.body.razorpay_order_id,
      razorpay_payment_id: req.body.razorpay_payment_id,
      razorpay_signature:  req.body.razorpay_signature,
    });
    sendSuccess(res, result, `PRO plan activated`);
  } catch (err) {
    next(err);
  }
}

// ═══════════════════════════════════════════════════════════════════════
//  GET /api/payments/plan
//  Returns the authenticated user's current plan and entitlement state.
// ═══════════════════════════════════════════════════════════════════════
export async function getCurrentPlanController(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const planData = await getCurrentPlan(uid(req));
    sendSuccess(res, planData, 'Current plan retrieved');
  } catch (err) {
    next(err);
  }
}
