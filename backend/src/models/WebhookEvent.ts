/**
 * src/models/WebhookEvent.ts
 *
 * Idempotency store for inbound webhook events.
 *
 * PATTERN (mirrors Payment.ts § IDEMPOTENCY):
 *   event_id has a unique index.  The first delivery inserts a document;
 *   every subsequent replay hits a duplicate-key error, which the handler
 *   catches and converts to a silent no-op.  No application-level
 *   "have-I-seen-this?" query is needed.
 *
 * SCOPE:
 *   Currently used only for Razorpay webhooks.  The `source` field
 *   reserves the collection for future webhook providers (Stripe, etc.)
 *   without a schema migration.
 *
 * TTL:
 *   Documents auto-expire after 90 days — long enough to cover any
 *   realistic replay window, short enough to keep the collection small.
 */

import { Schema, model, Document } from 'mongoose';

export interface IWebhookEvent extends Document {
  source:    string;   // e.g. 'razorpay'
  event_id:  string;   // Razorpay event.id (globally unique per delivery)
  event_type: string;  // e.g. 'payment.failed'
  received_at: Date;
  expires_at:  Date;
}

const WebhookEventSchema = new Schema<IWebhookEvent>(
  {
    source:     { type: String, required: true, trim: true },
    event_id:   { type: String, required: true, trim: true },
    event_type: { type: String, required: true, trim: true },
    received_at: { type: Date, required: true, default: Date.now },
    // TTL index — auto-delete after 90 days
    expires_at: {
      type:    Date,
      default: () => new Date(Date.now() + 90 * 24 * 60 * 60 * 1000),
      index:   { expireAfterSeconds: 0 },
    },
  },
  {
    timestamps: false,
    collection: 'webhook_events',
  }
);

// ─── Indexes ────────────────────────────────────────────────────────

// Primary idempotency guard — unique per provider per event delivery.
// A duplicate-key error on insert = replay detected → silent no-op.
WebhookEventSchema.index({ source: 1, event_id: 1 }, { unique: true });

// ─── Model ──────────────────────────────────────────────────────────
export const WebhookEvent = model<IWebhookEvent>('WebhookEvent', WebhookEventSchema);
