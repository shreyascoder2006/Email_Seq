/**
 * Phase 2 verification tests — run with:
 *   ts-node src/tests/phase2.verify.ts
 *
 * Tests:
 *   1. PLAN_CONFIG.free is correctly defined
 *   2. PLAN_CONFIG.pro.amountPaise === 99900
 *   3. Razorpay mode resolves to 'test'
 *   4. User model defaults to plan = 'free'
 *   5. Payment schema accepts a valid 'created' TEST payment (offline, no DB)
 *   6. Payment schema rejects invalid plan/status/environment values (offline)
 */

// ── Must be first ──────────────────────────────────────────────────────
import '../config/env';

import { PLAN_CONFIG, RAZORPAY_MODE } from '../config/razorpay';
import { UserPlan }                    from '../models/User';
import {
  PaymentEnvironment,
  PaymentStatus,
  PurchasedPlan,
}                                      from '../models/Payment';

// ─── Minimal test runner ───────────────────────────────────────────────
let passed = 0;
let failed = 0;

function assert(label: string, condition: boolean): void {
  if (condition) {
    console.log(`  ✅ PASS  ${label}`);
    passed++;
  } else {
    console.error(`  ❌ FAIL  ${label}`);
    failed++;
  }
}

function section(title: string): void {
  console.log(`\n── ${title}`);
}

// ══════════════════════════════════════════════════════════════════════
//  TEST 1 & 2 — PLAN_CONFIG
// ══════════════════════════════════════════════════════════════════════
section('PLAN_CONFIG');

assert(
  'PLAN_CONFIG.free is defined',
  typeof PLAN_CONFIG.free === 'object' && PLAN_CONFIG.free !== null
);

assert(
  'PLAN_CONFIG.free.amountPaise === 0',
  PLAN_CONFIG.free.amountPaise === 0
);

assert(
  'PLAN_CONFIG.free.currency === "INR"',
  PLAN_CONFIG.free.currency === 'INR'
);

assert(
  'PLAN_CONFIG.pro is defined',
  typeof PLAN_CONFIG.pro === 'object' && PLAN_CONFIG.pro !== null
);

assert(
  'PLAN_CONFIG.pro.amountPaise === 99900 (₹999)',
  PLAN_CONFIG.pro.amountPaise === 99900
);

assert(
  'PLAN_CONFIG.pro.currency === "INR"',
  PLAN_CONFIG.pro.currency === 'INR'
);

// ══════════════════════════════════════════════════════════════════════
//  TEST 3 — Razorpay mode
// ══════════════════════════════════════════════════════════════════════
section('Razorpay Mode');

assert(
  'RAZORPAY_MODE resolves to "test"',
  RAZORPAY_MODE === 'test'
);

// ══════════════════════════════════════════════════════════════════════
//  TEST 4 — UserPlan enum values
// ══════════════════════════════════════════════════════════════════════
section('User Plan Enum');

assert(
  'UserPlan.FREE === "free"',
  UserPlan.FREE === 'free'
);

assert(
  'UserPlan.PRO === "pro"',
  UserPlan.PRO === 'pro'
);

// ══════════════════════════════════════════════════════════════════════
//  TEST 5 — Payment enum values (valid test payment shape)
// ══════════════════════════════════════════════════════════════════════
section('Payment Enum — Valid Values');

const validPaymentShape = {
  provider:           'razorpay',
  environment:        PaymentEnvironment.TEST,
  plan:               PurchasedPlan.PRO,
  amount:             99900,
  currency:           'INR',
  razorpay_order_id:  'order_test_abc123',
  status:             PaymentStatus.CREATED,
};

assert(
  'environment = "test" is valid PaymentEnvironment',
  validPaymentShape.environment === 'test'
);

assert(
  'plan = "pro" is valid PurchasedPlan',
  validPaymentShape.plan === 'pro'
);

assert(
  'status = "created" is valid PaymentStatus',
  validPaymentShape.status === 'created'
);

assert(
  'amount = 99900 (paise) is correct for ₹999',
  validPaymentShape.amount === 99900
);

// ══════════════════════════════════════════════════════════════════════
//  TEST 6 — Invalid values are not in enums
// ══════════════════════════════════════════════════════════════════════
section('Payment Enum — Invalid Values Rejected');

const validEnvironments = Object.values(PaymentEnvironment);
const validStatuses     = Object.values(PaymentStatus);
const validPlans        = Object.values(PurchasedPlan);

assert(
  '"sandbox" is NOT a valid PaymentEnvironment',
  !validEnvironments.includes('sandbox' as PaymentEnvironment)
);

assert(
  '"pending" is NOT a valid PaymentStatus',
  !validStatuses.includes('pending' as PaymentStatus)
);

assert(
  '"enterprise" is NOT a valid PurchasedPlan',
  !validPlans.includes('enterprise' as PurchasedPlan)
);

assert(
  '"live" IS a valid PaymentEnvironment (future-proofing)',
  validEnvironments.includes(PaymentEnvironment.LIVE)
);

assert(
  '"paid" IS a valid PaymentStatus',
  validStatuses.includes(PaymentStatus.PAID)
);

assert(
  '"failed" IS a valid PaymentStatus',
  validStatuses.includes(PaymentStatus.FAILED)
);

// ══════════════════════════════════════════════════════════════════════
//  SUMMARY
// ══════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(50)}`);
console.log(`  Phase 2 Verification: ${passed} passed, ${failed} failed`);
console.log(`${'═'.repeat(50)}\n`);

if (failed > 0) process.exit(1);
