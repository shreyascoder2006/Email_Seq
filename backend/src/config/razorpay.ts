/**
 * src/config/razorpay.ts
 *
 * Razorpay SDK singleton + centralized plan/pricing configuration.
 *
 * SECURITY RULES (enforced here and throughout the payment module):
 *   - RAZORPAY_KEY_SECRET must NEVER enter API responses, logs, or frontend code.
 *   - RAZORPAY_WEBHOOK_SECRET must NEVER enter API responses, logs, or frontend code.
 *   - RAZORPAY_KEY_ID may be returned to the frontend only for Checkout initialization.
 *   - RAZORPAY_MODE must remain 'test' unless explicitly changed to 'live'.
 *
 * ISOLATION RULE:
 *   This module has zero imports from the email, scheduling, Redis, or AI subsystems.
 *   Payment failures must NEVER affect existing email pipelines.
 */

import Razorpay from 'razorpay';
import { env } from './env';
import { AppError } from '../utils/AppError';

// ─── Plan Configuration (single source of truth for pricing) ──────────
// The frontend MUST NEVER determine or send the authoritative amount.
// All pricing is derived exclusively from this object on the backend.

export const PLAN_CONFIG = {
  free: {
    label:       'Free',
    amountPaise: 0,       // ₹0
    currency:    'INR',
  },
  pro: {
    label:       'Pro',
    amountPaise: 99900,   // ₹999 in paise (₹999 × 100 = 99900)
    currency:    'INR',
  },
} as const;

// Derive a union type from the config keys so validators/services stay in sync.
export type PlanId = keyof typeof PLAN_CONFIG;

// ─── Purchasable plans ────────────────────────────────────────────────
// 'free' cannot be purchased via Razorpay (amount = 0).
// Only plans in this list may be sent to create-order.
export const PURCHASABLE_PLANS: PlanId[] = ['pro'];

// ─── Razorpay mode ────────────────────────────────────────────────────
export const RAZORPAY_MODE = env.RAZORPAY_MODE; // 'test' | 'live'

// ─── Lazy singleton ───────────────────────────────────────────────────
// The instance is created on first call to getRazorpayInstance().
// This means the server boots normally even if Razorpay keys are absent;
// only billing endpoints will fail with a clear error.
let _instance: Razorpay | null = null;

/**
 * Returns the Razorpay SDK instance.
 * Throws AppError.internal() if credentials are not configured.
 *
 * NEVER log or expose env.RAZORPAY_KEY_SECRET anywhere in call sites.
 */
export function getRazorpayInstance(): Razorpay {
  if (_instance) return _instance;

  if (!env.RAZORPAY_KEY_ID || !env.RAZORPAY_KEY_SECRET) {
    throw AppError.internal(
      'Razorpay credentials are not configured. ' +
      'Set RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET in your .env file.'
    );
  }

  _instance = new Razorpay({
    key_id:     env.RAZORPAY_KEY_ID,
    key_secret: env.RAZORPAY_KEY_SECRET,
  });

  return _instance;
}

/**
 * Returns the public Key ID safe for frontend Checkout.
 * Throws if not configured.
 *
 * NOTE: Only KEY_ID is returned — never KEY_SECRET.
 */
export function getRazorpayKeyId(): string {
  if (!env.RAZORPAY_KEY_ID) {
    throw AppError.internal('RAZORPAY_KEY_ID is not configured.');
  }
  return env.RAZORPAY_KEY_ID;
}
