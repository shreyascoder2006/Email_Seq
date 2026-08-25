/**
 * src/routes/razorpayWebhook.route.ts
 *
 * POST /api/webhooks/razorpay
 *
 * ── Registration requirement ────────────────────────────────────────
 *   This router MUST be mounted in server.ts BEFORE express.json().
 *   express.raw({ type: 'application/json' }) is applied per-route so
 *   req.body is a Buffer — the raw bytes needed for HMAC verification.
 *   If express.json() runs first, req.body is already a parsed object
 *   and the signature check will always fail.
 *
 * ── Security model ──────────────────────────────────────────────────
 *   1. HMAC-SHA256 of the raw body using RAZORPAY_WEBHOOK_SECRET
 *   2. Compared with crypto.timingSafeEqual (prevents timing attacks)
 *   3. Any mismatch → 400 + warn log.  No DB writes on unverified payloads.
 *   4. Not behind the authenticate middleware — Razorpay has no JWT.
 *
 * ── Idempotency ─────────────────────────────────────────────────────
 *   Every delivered event has a globally-unique `event.id`.
 *   We insert a WebhookEvent document on first delivery.
 *   A duplicate-key error on insert = replay → 200 no-op immediately.
 *   No application-level "have-I-seen-this?" query is needed.
 *
 * ── Response contract ───────────────────────────────────────────────
 *   Always return 200 quickly (even on business-logic error) — Razorpay
 *   retries any non-2xx response with exponential back-off.  Errors are
 *   logged but swallowed after the 200 is sent.
 *
 * ── Event handling ──────────────────────────────────────────────────
 *   payment.failed          → open RecoveryCase (PAYMENT_FAILED)
 *   payment.captured        → close open case as RECOVERED
 *   order.paid              → close open case as RECOVERED
 *   subscription.halted     → open RecoveryCase (SUBSCRIPTION_FAILED)
 *   subscription.charged    → close matching case as RECOVERED
 *   payment.dispute.created → hard-stop: STOPPED_DISPUTED, next_action_at=null
 *
 * ── Isolation guarantee ─────────────────────────────────────────────
 *   No imports from: email worker, BullMQ, Redis, SMTP, scheduler,
 *   analytics, or sequence subsystems.  This module only writes
 *   RecoveryCase and WebhookEvent documents.
 */

import { Router, Request, Response } from 'express';
import express from 'express';
import crypto from 'crypto';
import { env } from '../config/env';
import logger from '../config/logger';
import { RecoveryCase, RecoveryCaseType, RecoveryCaseStatus } from '../models/RecoveryCase';
import { WebhookEvent } from '../models/WebhookEvent';

const router = Router();

// ─── Typed payload helpers ────────────────────────────────────────────────────

interface RazorpayPaymentFailedPayload {
  payment?: {
    entity?: {
      order_id?:          string;
      amount?:            number;
      error_code?:        string;
      error_description?: string;
      error_source?:      string;
      error_step?:        string;
      error_reason?:      string;
    };
  };
}

interface RazorpayOrderPaidPayload {
  order?: { entity?: { id?: string; amount_paid?: number } };
  payment?: { entity?: { order_id?: string; amount?: number } };
}

interface RazorpayPaymentCapturedPayload {
  payment?: { entity?: { order_id?: string; amount?: number } };
}

interface RazorpaySubscriptionPayload {
  subscription?: {
    entity?: { id?: string; plan_id?: string };
  };
  // charged event carries payment details
  payment?: { entity?: { order_id?: string; amount?: number } };
}

interface RazorpayDisputePayload {
  dispute?: {
    entity?: {
      payment_id?: string;
      order_id?:   string;
    };
  };
}

// ─── Signature verification ───────────────────────────────────────────────────

/**
 * Verifies the X-Razorpay-Signature header against the raw body.
 * Returns true only if the HMAC-SHA256 matches and the secret is configured.
 */
function verifySignature(rawBody: Buffer, signature: string): boolean {
  const secret = env.RAZORPAY_WEBHOOK_SECRET;
  if (!secret) {
    // If the secret is not configured, refuse all webhooks — do not silently pass.
    logger.error('[webhook] RAZORPAY_WEBHOOK_SECRET is not configured; rejecting all webhooks');
    return false;
  }

  const expected = crypto
    .createHmac('sha256', secret)
    .update(rawBody)
    .digest('hex');

  // timingSafeEqual requires equal-length Buffers; unequal lengths = instant fail.
  const expectedBuf = Buffer.from(expected, 'hex');
  const receivedBuf = Buffer.from(signature,  'hex');

  return (
    expectedBuf.length === receivedBuf.length &&
    crypto.timingSafeEqual(expectedBuf, receivedBuf)
  );
}

// ─── Event handlers ───────────────────────────────────────────────────────────

/**
 * payment.failed
 * Opens a PAYMENT_FAILED RecoveryCase carrying full Razorpay error context.
 * Uses findOneAndUpdate with upsert so a duplicate webhook becomes a no-op.
 */
async function handlePaymentFailed(payload: RazorpayPaymentFailedPayload): Promise<void> {
  const entity    = payload.payment?.entity;
  const order_id  = entity?.order_id;

  if (!order_id) {
    logger.warn('[webhook] payment.failed: missing order_id in payload');
    return;
  }

  // Status-filtered upsert — mirrors Payment.ts idempotency pattern:
  // If an OPEN case already exists, the $setOnInsert is a no-op.
  await RecoveryCase.findOneAndUpdate(
    { razorpay_order_id: order_id, case_type: RecoveryCaseType.PAYMENT_FAILED },
    {
      $setOnInsert: {
        razorpay_order_id: order_id,
        case_type:         RecoveryCaseType.PAYMENT_FAILED,
        status:            RecoveryCaseStatus.OPEN,
        opened_at:         new Date(),
        last_error: {
          error_code:        entity?.error_code,
          error_description: entity?.error_description,
          error_source:      entity?.error_source,
          error_step:        entity?.error_step,
          error_reason:      entity?.error_reason,
        },
      },
    },
    { upsert: true, new: false }
  );

  logger.info('[webhook] payment.failed: RecoveryCase opened', {
    order_id,
    error_code:   entity?.error_code,
    error_reason: entity?.error_reason,
  });
}

/**
 * order.paid  /  payment.captured
 * Closes any open PAYMENT_FAILED case for this order as RECOVERED.
 * The status filter { status: OPEN } makes this a no-op if already closed.
 */
async function handlePaymentSuccess(orderId: string, amount?: number): Promise<void> {
  if (!orderId) {
    logger.warn('[webhook] payment success: missing order_id');
    return;
  }

  const now = new Date();
  const result = await RecoveryCase.findOneAndUpdate(
    {
      razorpay_order_id: orderId,
      case_type:         RecoveryCaseType.PAYMENT_FAILED,
      status:            RecoveryCaseStatus.OPEN,
    },
    {
      $set: {
        status:           RecoveryCaseStatus.RECOVERED,
        recovered_amount: amount,
        recovered_at:     now,
        closed_at:        now,
      },
    }
  );

  if (result) {
    logger.info('[webhook] order/payment success: RecoveryCase closed as RECOVERED', {
      order_id:         orderId,
      recovered_amount: amount,
    });
  }
}

/**
 * subscription.halted
 * Opens a SUBSCRIPTION_FAILED RecoveryCase.
 * Keyed on the subscription id (stored as razorpay_order_id for schema reuse,
 * with razorpay_subscription_id carrying the canonical ID).
 */
async function handleSubscriptionHalted(payload: RazorpaySubscriptionPayload): Promise<void> {
  const subId = payload.subscription?.entity?.id;

  if (!subId) {
    logger.warn('[webhook] subscription.halted: missing subscription id');
    return;
  }

  await RecoveryCase.findOneAndUpdate(
    {
      razorpay_subscription_id: subId,
      case_type:                RecoveryCaseType.SUBSCRIPTION_FAILED,
    },
    {
      $setOnInsert: {
        razorpay_order_id:        subId,   // reuse field; no FK violation
        razorpay_subscription_id: subId,
        case_type:                RecoveryCaseType.SUBSCRIPTION_FAILED,
        status:                   RecoveryCaseStatus.OPEN,
        opened_at:                new Date(),
      },
    },
    { upsert: true, new: false }
  );

  logger.info('[webhook] subscription.halted: RecoveryCase opened', { sub_id: subId });
}

/**
 * subscription.charged
 * Closes any open SUBSCRIPTION_FAILED case as RECOVERED.
 */
async function handleSubscriptionCharged(payload: RazorpaySubscriptionPayload): Promise<void> {
  const subId  = payload.subscription?.entity?.id;
  const amount = payload.payment?.entity?.amount;

  if (!subId) {
    logger.warn('[webhook] subscription.charged: missing subscription id');
    return;
  }

  const now = new Date();
  const result = await RecoveryCase.findOneAndUpdate(
    {
      razorpay_subscription_id: subId,
      case_type:                RecoveryCaseType.SUBSCRIPTION_FAILED,
      status:                   RecoveryCaseStatus.OPEN,
    },
    {
      $set: {
        status:           RecoveryCaseStatus.RECOVERED,
        recovered_amount: amount,
        recovered_at:     now,
        closed_at:        now,
      },
    }
  );

  if (result) {
    logger.info('[webhook] subscription.charged: RecoveryCase closed as RECOVERED', {
      sub_id: subId,
      recovered_amount: amount,
    });
  }
}

/**
 * payment.dispute.created
 * Hard stop: creates a STOPPED_DISPUTED case with next_action_at=null.
 * next_action_at=null signals the scheduler to not retry this order.
 */
async function handleDisputeCreated(payload: RazorpayDisputePayload): Promise<void> {
  const orderId   = payload.dispute?.entity?.order_id;
  const paymentId = payload.dispute?.entity?.payment_id;

  if (!orderId && !paymentId) {
    logger.warn('[webhook] payment.dispute.created: missing order_id and payment_id');
    return;
  }

  const keyId = orderId ?? paymentId!;

  await RecoveryCase.findOneAndUpdate(
    {
      razorpay_order_id: keyId,
      case_type:         RecoveryCaseType.STOPPED_DISPUTED,
    },
    {
      $setOnInsert: {
        razorpay_order_id: keyId,
        case_type:         RecoveryCaseType.STOPPED_DISPUTED,
        status:            RecoveryCaseStatus.STOPPED_DISPUTED,
        opened_at:         new Date(),
        next_action_at:    null,   // hard stop — scheduler must not retry
      },
    },
    { upsert: true, new: false }
  );

  logger.warn('[webhook] payment.dispute.created: RecoveryCase opened as STOPPED_DISPUTED', {
    order_id:   orderId,
    payment_id: paymentId,
  });
}

// ─── Route ────────────────────────────────────────────────────────────────────

/**
 * POST /api/webhooks/razorpay
 *
 * express.raw() is applied here (not globally) so only this route sees the
 * raw Buffer.  All other routes continue to use express.json().
 */
router.post(
  '/api/webhooks/razorpay',
  express.raw({ type: 'application/json' }),
  async (req: Request, res: Response): Promise<void> => {
    // ── 1. Signature verification (synchronous — must precede 200) ────
    const signature = req.headers['x-razorpay-signature'] as string | undefined;

    if (!signature) {
      logger.warn('[webhook] Missing X-Razorpay-Signature header');
      res.status(400).json({ error: 'Missing signature' });
      return;
    }

    if (!Buffer.isBuffer(req.body)) {
      // Misconfiguration: express.json() ran first — raw body is gone.
      logger.error('[webhook] req.body is not a Buffer — webhook route registered AFTER express.json()');
      res.status(500).json({ error: 'Server misconfiguration' });
      return;
    }

    if (!verifySignature(req.body, signature)) {
      logger.warn('[webhook] Signature mismatch — possible spoofed request', {
        ip: req.ip,
        ua: req.headers['user-agent'],
      });
      res.status(400).json({ error: 'Invalid signature' });
      return;
    }

    // ── 2. Parse body (safe to do now — signature verified) ───────────
    let event: { id?: string; event?: string; payload?: any };
    try {
      event = JSON.parse(req.body.toString('utf8'));
    } catch {
      logger.warn('[webhook] Failed to parse JSON body after signature verification');
      res.status(400).json({ error: 'Invalid JSON body' });
      return;
    }

    const eventId   = event.id   ?? '';
    const eventType = event.event ?? '';

    if (!eventId || !eventType) {
      logger.warn('[webhook] event missing id or event type', { eventId, eventType });
      res.status(400).json({ error: 'Malformed event' });
      return;
    }

    // ── 3. Idempotency: record event, detect replay ───────────────────
    try {
      await WebhookEvent.create({
        source:      'razorpay',
        event_id:    eventId,
        event_type:  eventType,
        received_at: new Date(),
      });
    } catch (err: any) {
      // MongoDB duplicate-key error (code 11000) = already processed.
      if (err?.code === 11000) {
        logger.debug('[webhook] Replay detected — returning 200 no-op', {
          event_id:   eventId,
          event_type: eventType,
        });
        res.status(200).json({ status: 'replay_ignored' });
        return;
      }
      // Any other DB error: log and fall through to 200 so Razorpay
      // does not hammer us with retries (the error is ours, not theirs).
      logger.error('[webhook] WebhookEvent.create failed (non-duplicate)', {
        event_id:   eventId,
        event_type: eventType,
        error:      err.message,
      });
    }

    // ── 4. Acknowledge immediately — Razorpay retries on non-2xx ─────
    res.status(200).json({ status: 'ok' });

    // ── 5. Process asynchronously (after 200 is flushed) ─────────────
    setImmediate(async () => {
      try {
        const payload = event.payload ?? {};

        switch (eventType) {
          case 'payment.failed':
            await handlePaymentFailed(payload as RazorpayPaymentFailedPayload);
            break;

          case 'order.paid': {
            const op = payload as RazorpayOrderPaidPayload;
            const orderId = op.order?.entity?.id ?? op.payment?.entity?.order_id;
            const amount  = op.order?.entity?.amount_paid ?? op.payment?.entity?.amount;
            await handlePaymentSuccess(orderId ?? '', amount);
            break;
          }

          case 'payment.captured': {
            const cp = payload as RazorpayPaymentCapturedPayload;
            const orderId = cp.payment?.entity?.order_id;
            const amount  = cp.payment?.entity?.amount;
            await handlePaymentSuccess(orderId ?? '', amount);
            break;
          }

          case 'subscription.halted':
            await handleSubscriptionHalted(payload as RazorpaySubscriptionPayload);
            break;

          case 'subscription.charged':
            await handleSubscriptionCharged(payload as RazorpaySubscriptionPayload);
            break;

          case 'payment.dispute.created':
            await handleDisputeCreated(payload as RazorpayDisputePayload);
            break;

          default:
            logger.debug('[webhook] Unhandled event type (ignored)', { event_type: eventType });
        }
      } catch (err) {
        // Never crash the process — Razorpay already got its 200.
        logger.error('[webhook] Async processing error', {
          event_id:   eventId,
          event_type: eventType,
          error:      (err as Error).message,
        });
      }
    });
  }
);

export default router;
