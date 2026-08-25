/**
 * src/validators/payment.validator.ts
 *
 * Zod schemas for payment endpoints.
 *
 * SECURITY NOTE:
 *   The create-order schema deliberately does NOT include an `amount` field.
 *   The frontend MUST NOT determine pricing. The backend derives the
 *   authoritative amount from PLAN_CONFIG in payment.service.ts.
 */

import { z } from 'zod';

// ─── POST /api/payments/create-order ──────────────────────────────────
// Frontend sends only the plan name. Backend derives the price.
export const CreateOrderSchema = z.object({
  plan: z.enum(['pro'], {
    required_error: 'plan is required',
    invalid_type_error: 'plan must be one of: pro',
  }).describe('The plan to purchase. Must be a paid plan ("free" cannot be purchased).'),
});

export type CreateOrderDto = z.infer<typeof CreateOrderSchema>;

// ─── POST /api/payments/verify ────────────────────────────────────────
// Three fields returned by Razorpay Checkout on success.
// The backend verifies the HMAC-SHA256 signature before trusting anything.
export const VerifyPaymentSchema = z.object({
  razorpay_order_id: z
    .string({ required_error: 'razorpay_order_id is required' })
    .min(1)
    .trim(),

  razorpay_payment_id: z
    .string({ required_error: 'razorpay_payment_id is required' })
    .min(1)
    .trim(),

  razorpay_signature: z
    .string({ required_error: 'razorpay_signature is required' })
    .min(1)
    .trim(),
});

export type VerifyPaymentDto = z.infer<typeof VerifyPaymentSchema>;
