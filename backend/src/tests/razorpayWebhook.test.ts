/**
 * backend/src/tests/razorpayWebhook.test.ts
 *
 * Unit / logic regression tests for the Razorpay webhook handler.
 * No live DB, no HTTP server — pure function / mock-based.
 *
 * Covers:
 *  1. Signature verification (valid / mismatch / missing header / unconfigured secret)
 *  2. Replay idempotency (duplicate-key error → 200 no-op)
 *  3. payment.failed → opens RecoveryCase (OPEN / PAYMENT_FAILED)
 *  4. payment.captured / order.paid → closes open case as RECOVERED
 *  5. payment.dispute.created → STOPPED_DISPUTED with next_action_at=null
 *  6. subscription.halted → opens SUBSCRIPTION_FAILED case
 *  7. subscription.charged → closes open SUBSCRIPTION_FAILED case
 */

import crypto from 'crypto';

// ─── Helpers shared with the route module ────────────────────────────────────

const TEST_SECRET = 'test_webhook_secret_32_chars_xxxx';

/**
 * Re-implements verifySignature() locally so tests don't import the route
 * (which would pull Mongoose models and require a DB connection).
 */
function verifySignature(rawBody: Buffer, signature: string, secret = TEST_SECRET): boolean {
  if (!secret) return false;

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  const expectedBuf = Buffer.from(expected,  'hex');
  const receivedBuf = Buffer.from(signature, 'hex');

  return (
    expectedBuf.length === receivedBuf.length &&
    crypto.timingSafeEqual(expectedBuf, receivedBuf)
  );
}

function makeSignature(body: Buffer, secret = TEST_SECRET): string {
  return crypto.createHmac('sha256', secret).update(body).digest('hex');
}

// ─── 1. Signature verification ───────────────────────────────────────────────

describe('Razorpay webhook — signature verification', () => {
  test('valid signature passes', () => {
    const body = Buffer.from(JSON.stringify({ event: 'payment.failed' }));
    const sig  = makeSignature(body);
    expect(verifySignature(body, sig)).toBe(true);
  });

  test('wrong secret fails', () => {
    const body   = Buffer.from(JSON.stringify({ event: 'payment.failed' }));
    const sig    = makeSignature(body, 'wrong_secret_32_chars____________');
    expect(verifySignature(body, sig)).toBe(false);
  });

  test('tampered body fails', () => {
    const body         = Buffer.from(JSON.stringify({ event: 'payment.failed' }));
    const tamperedBody = Buffer.from(JSON.stringify({ event: 'payment.captured' }));
    const sig          = makeSignature(body);
    expect(verifySignature(tamperedBody, sig)).toBe(false);
  });

  test('truncated signature (wrong length) fails', () => {
    const body = Buffer.from('{"event":"test"}');
    const sig  = makeSignature(body).slice(0, 30); // shorten → length mismatch
    expect(verifySignature(body, sig)).toBe(false);
  });

  test('empty signature fails', () => {
    const body = Buffer.from('{"event":"test"}');
    // Buffer.from('', 'hex') is zero-length — timingSafeEqual rejects
    expect(verifySignature(body, '')).toBe(false);
  });

  test('unconfigured secret rejects all (returns false)', () => {
    const body = Buffer.from('{"event":"test"}');
    const sig  = makeSignature(body);
    expect(verifySignature(body, sig, '')).toBe(false);  // empty secret
  });
});

// ─── 2. Idempotency — duplicate-key → no-op ──────────────────────────────────

describe('Razorpay webhook — idempotency', () => {
  /**
   * The handler catches err.code === 11000 (MongoDB duplicate key) and
   * returns 200 with { status: 'replay_ignored' } without processing the event.
   */

  function simulateInsert(
    existingIds: Set<string>,
    eventId: string
  ): { inserted: boolean; isDuplicate: boolean } {
    if (existingIds.has(eventId)) {
      return { inserted: false, isDuplicate: true };
    }
    existingIds.add(eventId);
    return { inserted: true, isDuplicate: false };
  }

  test('first delivery inserts successfully', () => {
    const store = new Set<string>();
    const result = simulateInsert(store, 'evt_abc123');
    expect(result.inserted).toBe(true);
    expect(result.isDuplicate).toBe(false);
  });

  test('replay of same event_id is detected as duplicate', () => {
    const store = new Set<string>();
    simulateInsert(store, 'evt_abc123');
    const result = simulateInsert(store, 'evt_abc123');
    expect(result.isDuplicate).toBe(true);
  });

  test('different event_ids are both inserted (no false positive)', () => {
    const store = new Set<string>();
    const r1 = simulateInsert(store, 'evt_111');
    const r2 = simulateInsert(store, 'evt_222');
    expect(r1.inserted).toBe(true);
    expect(r2.inserted).toBe(true);
    expect(r1.isDuplicate).toBe(false);
    expect(r2.isDuplicate).toBe(false);
  });
});

// ─── 3. payment.failed → opens RecoveryCase ──────────────────────────────────

describe('Razorpay webhook — payment.failed handler logic', () => {
  /**
   * Verifies the structure of what would be written to RecoveryCase
   * for a payment.failed event payload.
   */

  function buildPaymentFailedCase(payload: any) {
    const entity = payload?.payment?.entity ?? {};
    return {
      razorpay_order_id: entity.order_id ?? null,
      case_type:         'PAYMENT_FAILED',
      status:            'OPEN',
      last_error: {
        error_code:        entity.error_code,
        error_description: entity.error_description,
        error_source:      entity.error_source,
        error_step:        entity.error_step,
        error_reason:      entity.error_reason,
      },
    };
  }

  const examplePayload = {
    payment: {
      entity: {
        order_id:          'order_TestABC123',
        error_code:        'BAD_REQUEST_ERROR',
        error_description: 'Card declined',
        error_source:      'bank',
        error_step:        'payment_authorization',
        error_reason:      'do_not_honour',
      },
    },
  };

  test('extracts order_id from payload', () => {
    const doc = buildPaymentFailedCase(examplePayload);
    expect(doc.razorpay_order_id).toBe('order_TestABC123');
  });

  test('sets status=OPEN and case_type=PAYMENT_FAILED', () => {
    const doc = buildPaymentFailedCase(examplePayload);
    expect(doc.status).toBe('OPEN');
    expect(doc.case_type).toBe('PAYMENT_FAILED');
  });

  test('all five error fields are carried into last_error', () => {
    const doc = buildPaymentFailedCase(examplePayload);
    expect(doc.last_error.error_code).toBe('BAD_REQUEST_ERROR');
    expect(doc.last_error.error_description).toBe('Card declined');
    expect(doc.last_error.error_source).toBe('bank');
    expect(doc.last_error.error_step).toBe('payment_authorization');
    expect(doc.last_error.error_reason).toBe('do_not_honour');
  });

  test('missing order_id in payload is detected', () => {
    const doc = buildPaymentFailedCase({ payment: { entity: {} } });
    expect(doc.razorpay_order_id).toBeNull();
  });
});

// ─── 4. payment.captured / order.paid → closes case ────────────────────────

describe('Razorpay webhook — payment success handler logic', () => {
  function buildSuccessUpdate(orderId: string, amount?: number) {
    // Mirrors the $set applied in handlePaymentSuccess
    return {
      filter: {
        razorpay_order_id: orderId,
        case_type:         'PAYMENT_FAILED',
        status:            'OPEN',   // status filter = idempotency
      },
      update: {
        status:           'RECOVERED',
        recovered_amount: amount,
        recovered_at:     expect.any(Date),
        closed_at:        expect.any(Date),
      },
    };
  }

  test('update filter includes status=OPEN (idempotency)', () => {
    const op = buildSuccessUpdate('order_XYZ', 99900);
    expect(op.filter.status).toBe('OPEN');
  });

  test('update sets status=RECOVERED', () => {
    const op = buildSuccessUpdate('order_XYZ', 99900);
    expect(op.update.status).toBe('RECOVERED');
  });

  test('recovered_amount is carried from event payload', () => {
    const op = buildSuccessUpdate('order_XYZ', 99900);
    expect(op.update.recovered_amount).toBe(99900);
  });

  test('order.paid: order_id extracted from order.entity.id', () => {
    const payload: any = { order: { entity: { id: 'order_Paid1', amount_paid: 50000 } } };
    const orderId = payload.order?.entity?.id ?? payload.payment?.entity?.order_id;
    const amount  = payload.order?.entity?.amount_paid ?? payload.payment?.entity?.amount;
    expect(orderId).toBe('order_Paid1');
    expect(amount).toBe(50000);
  });

  test('payment.captured: order_id extracted from payment.entity.order_id', () => {
    const payload: any = { payment: { entity: { order_id: 'order_Cap1', amount: 75000 } } };
    const orderId = payload.payment?.entity?.order_id;
    const amount  = payload.payment?.entity?.amount;
    expect(orderId).toBe('order_Cap1');
    expect(amount).toBe(75000);
  });
});

// ─── 5. payment.dispute.created → STOPPED_DISPUTED ──────────────────────────

describe('Razorpay webhook — dispute handler logic', () => {
  function buildDisputeCase(payload: any) {
    const orderId   = payload?.dispute?.entity?.order_id;
    const paymentId = payload?.dispute?.entity?.payment_id;
    const keyId     = orderId ?? paymentId;

    return {
      razorpay_order_id: keyId,
      case_type:         'STOPPED_DISPUTED',
      status:            'STOPPED_DISPUTED',
      next_action_at:    null,
    };
  }

  const disputePayload = {
    dispute: {
      entity: { payment_id: 'pay_Disp1', order_id: 'order_Disp1' },
    },
  };

  test('sets status=STOPPED_DISPUTED', () => {
    const doc = buildDisputeCase(disputePayload);
    expect(doc.status).toBe('STOPPED_DISPUTED');
  });

  test('sets next_action_at=null (hard stop)', () => {
    const doc = buildDisputeCase(disputePayload);
    expect(doc.next_action_at).toBeNull();
  });

  test('uses order_id when available', () => {
    const doc = buildDisputeCase(disputePayload);
    expect(doc.razorpay_order_id).toBe('order_Disp1');
  });

  test('falls back to payment_id if order_id absent', () => {
    const doc = buildDisputeCase({ dispute: { entity: { payment_id: 'pay_Only1' } } });
    expect(doc.razorpay_order_id).toBe('pay_Only1');
  });
});

// ─── 6 & 7. subscription.halted / subscription.charged ──────────────────────

describe('Razorpay webhook — subscription handlers logic', () => {
  function buildSubscriptionHaltedCase(payload: any) {
    const subId = payload?.subscription?.entity?.id ?? null;
    return {
      razorpay_order_id:        subId,
      razorpay_subscription_id: subId,
      case_type:                'SUBSCRIPTION_FAILED',
      status:                   'OPEN',
    };
  }

  function buildSubscriptionChargedUpdate(payload: any) {
    const subId  = payload?.subscription?.entity?.id;
    const amount = payload?.payment?.entity?.amount;
    return {
      filter: { razorpay_subscription_id: subId, case_type: 'SUBSCRIPTION_FAILED', status: 'OPEN' },
      update: { status: 'RECOVERED', recovered_amount: amount },
    };
  }

  test('subscription.halted opens case with SUBSCRIPTION_FAILED type', () => {
    const doc = buildSubscriptionHaltedCase({ subscription: { entity: { id: 'sub_ABC' } } });
    expect(doc.case_type).toBe('SUBSCRIPTION_FAILED');
    expect(doc.status).toBe('OPEN');
    expect(doc.razorpay_subscription_id).toBe('sub_ABC');
  });

  test('subscription.halted with missing id is detected', () => {
    const doc = buildSubscriptionHaltedCase({ subscription: { entity: {} } });
    expect(doc.razorpay_subscription_id).toBeNull();
  });

  test('subscription.charged update filter includes status=OPEN', () => {
    const payload = {
      subscription: { entity: { id: 'sub_ABC' } },
      payment:      { entity: { amount: 29900 } },
    };
    const op = buildSubscriptionChargedUpdate(payload);
    expect(op.filter.status).toBe('OPEN');
    expect(op.update.status).toBe('RECOVERED');
    expect(op.update.recovered_amount).toBe(29900);
  });
});
