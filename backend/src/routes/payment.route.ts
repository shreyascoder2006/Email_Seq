/**
 * src/routes/payment.route.ts
 *
 * Payment router — mounted at /api/payments
 *
 * IMPORTANT: The webhook endpoint (POST /webhook) is intentionally NOT
 * defined here. Razorpay webhooks require the raw request body for HMAC
 * signature verification. The webhook route must be registered in server.ts
 * BEFORE express.json() is applied, using express.raw({ type: 'application/json' }).
 * It will be added in Phase 7.
 *
 * All routes here require authentication (JWT).
 */

import { Router } from 'express';
import { authenticate }           from '../middleware/auth';
import { validate }               from '../middleware/validate';
import { CreateOrderSchema, VerifyPaymentSchema } from '../validators/payment.validator';
import {
  createOrderController,
  getPaymentHistoryController,
  getCurrentPlanController,
  verifyPaymentController,
} from '../controllers/payment.controller';

const router = Router();

// ─── All payment routes require a valid JWT ────────────────────────────
router.use(authenticate);

// ─── Routes ────────────────────────────────────────────────────────────

/**
 * POST /api/payments/create-order
 *
 * Creates a Razorpay TEST order and a Payment record (status=created).
 * User.plan is NOT updated at this point — only after /verify succeeds.
 *
 * Request:  { plan: 'pro' }
 * Response: { order_id, amount, currency, key_id, payment_db_id }
 */
router.post(
  '/create-order',
  validate(CreateOrderSchema),
  createOrderController
);

/**
 * POST /api/payments/verify
 *
 * Receives the three Razorpay Checkout success fields.
 * Backend verifies HMAC-SHA256 signature before updating plan.
 * This is the ONLY path that upgrades User.plan — never the frontend alone.
 *
 * Request:  { razorpay_order_id, razorpay_payment_id, razorpay_signature }
 * Response: { plan, plan_started_at }
 */
router.post(
  '/verify',
  validate(VerifyPaymentSchema),
  verifyPaymentController
);

/**
 * GET /api/payments/plan
 *
 * Returns the authenticated user's current plan + entitlement fields.
 * Used by the frontend to render the billing page and guard features.
 */
router.get('/plan', getCurrentPlanController);

/**
 * GET /api/payments/history
 *
 * Returns the authenticated user's payment history (last 50 records).
 */
router.get('/history', getPaymentHistoryController);

export default router;
