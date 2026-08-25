import { Request, Response, NextFunction } from 'express';
import { SendingLog } from '../models/SendingLog';
import { OpenLog } from '../models/OpenLog';
import { ClickLog } from '../models/ClickLog';
import { SequenceContact, ContactEnrollmentStatus, UnsubscribeSource } from '../models/SequenceContact';
import { Sequence } from '../models/Sequence';
import { AuditLog } from '../models/AuditLog';
import { enrollmentService } from '../services/enrollment.service';
import { decrypt } from '../utils/crypto';
import { verifyUnsubscribeToken } from '../utils/unsubscribeToken';
import { renderUnsubscribePage } from '../utils/unsubscribePageHtml';
import logger from '../config/logger';

// 1x1 transparent GIF buffer
const PIXEL_BUFFER = Buffer.from(
  'R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  'base64'
);

export async function trackOpen(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const { messageId } = req.params;

    // Immediately return the pixel to keep it fast
    res.set({
      'Content-Type': 'image/gif',
      'Cache-Control': 'no-cache, no-store, must-revalidate',
      Pragma: 'no-cache',
      Expires: '0',
    });
    res.status(200).send(PIXEL_BUFFER);

    // Process asynchronously
    setImmediate(async () => {
      try {
        // URL param arrives WITHOUT angle brackets; SendingLog stores WITH them.
        // e.g. param: "abc@gmail.com" → stored: "<abc@gmail.com>"
        const normalizedId = messageId.startsWith('<') ? messageId : `<${messageId}>`;
        const sendingLog = await SendingLog.findOne({ message_id: normalizedId }).lean();
        if (!sendingLog) return; // Silent ignore

        const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
        const userAgent = req.headers['user-agent'] || '';

        // Check if opened in the last hour from same IP
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
        const recentOpen = await OpenLog.findOne({
          sending_log_id: sendingLog._id,
          ip_address: ip as string,
          opened_at: { $gte: oneHourAgo },
        }).lean();

        if (recentOpen) {
          // Increment count but don't consider it a "new" distinct open
          await OpenLog.updateOne({ _id: recentOpen._id }, { $inc: { open_count: 1 } });
          return;
        }

        // Check if it's the very first open
        const existingOpen = await OpenLog.exists({ sending_log_id: sendingLog._id });
        const isFirstOpen = !existingOpen;

        // Create new OpenLog
        await OpenLog.create({
          sequence_id: sendingLog.sequence_id,
          sequence_contact_id: sendingLog.sequence_contact_id,
          sending_log_id: sendingLog._id,
          user_id: sendingLog.user_id,
          contact_email: sendingLog.to_email,
          step_index: sendingLog.step_index,
          is_first_open: isFirstOpen,
          open_count: 1,
          user_agent: userAgent,
          ip_address: ip as string,
        });

        if (isFirstOpen) {
          await SequenceContact.updateOne(
            { _id: sendingLog.sequence_contact_id },
            { has_opened: true }
          );
          // Update sequence stats
          await Sequence.updateOne(
            { _id: sendingLog.sequence_id },
            { $inc: { 'stats.total_opens': 1 } }
          );
        }

        logger.debug('Email open tracked', { messageId });
      } catch (err) {
        logger.error('Error processing email open', { error: (err as Error).message, messageId });
      }
    });
  } catch (err) {
    // If something throws synchronously before the res.send, send pixel anyway
    if (!res.headersSent) {
      res.set('Content-Type', 'image/gif');
      res.status(200).send(PIXEL_BUFFER);
    }
  }
}

export async function trackClick(req: Request, res: Response, next: NextFunction): Promise<void> {
  const fallbackUrl = process.env.FRONTEND_URL || 'https://google.com';

  try {
    const { trackingId } = req.params;

    // Fast lookup
    const clickLog = await ClickLog.findOne({ tracking_id: trackingId });

    if (!clickLog) {
      res.redirect(301, fallbackUrl);
      return;
    }

    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
    const userAgent = req.headers['user-agent'] || '';

    // Immediately redirect the user
    res.redirect(301, clickLog.original_url);

    // Process update asynchronously
    setImmediate(async () => {
      try {
        // is_first_click starts false at pre-creation; true means "has been clicked".
        const isFirstClick = !clickLog.is_first_click;

        await ClickLog.updateOne(
          { _id: clickLog._id },
          {
            $set: {
              // Mark as first-clicked so analytics { is_first_click: true } works.
              is_first_click: true,
              // Record the actual click time (pre-creation default would be wrong).
              clicked_at: new Date(),
              user_agent: userAgent,
              ip_address: ip as string,
            },
            $inc: { click_count: 1 },
          }
        );

        if (isFirstClick) {
          await SequenceContact.updateOne(
            { _id: clickLog.sequence_contact_id },
            { has_clicked: true }
          );
          // Update sequence stats
          await Sequence.updateOne(
            { _id: clickLog.sequence_id },
            { $inc: { 'stats.total_clicks': 1 } }
          );
        }

        logger.debug('Email click tracked', { trackingId, originalUrl: clickLog.original_url });
      } catch (err) {
        logger.error('Error processing email click', { error: (err as Error).message, trackingId });
      }
    });
  } catch (err) {
    if (!res.headersSent) {
      res.redirect(301, fallbackUrl);
    }
  }
}

// ─── Shared unsubscribe logic ──────────────────────────────────────
/**
 * Atomically marks a contact as unsubscribed.
 * Returns 'success' on first unsubscribe, 'already' if already unsubscribed,
 * 'invalid' if the token is bad or contact not found.
 *
 * Race-condition safe: the findOneAndUpdate condition { status: { $ne: UNSUBSCRIBED } }
 * guarantees only one concurrent request wins. The sequence stat increment only runs
 * if we were the first (updated is non-null).
 *
 * BullMQ integration: schedule_version is incremented atomically, which causes any
 * pending delayed jobs to be silently discarded by the worker's version check at
 * processEmailSend() line 217. No explicit BullMQ job removal is needed.
 */
async function performUnsubscribe(
  token: string,
  opts: { ip?: string; userAgent?: string }
): Promise<'success' | 'already' | 'invalid'> {
  const decoded = verifyUnsubscribeToken(token);
  if (!decoded) return 'invalid';

  const { contactId } = decoded;

  // Atomic conditional write — only succeeds if not already unsubscribed
  const updated = await SequenceContact.findOneAndUpdate(
    { _id: contactId, status: { $ne: ContactEnrollmentStatus.UNSUBSCRIBED } },
    {
      $set: {
        status: ContactEnrollmentStatus.UNSUBSCRIBED,
        unsubscribed_at: new Date(),
        unsubscribe_source: UnsubscribeSource.LINK,
        next_send_at: null,   // removes from scheduler sweep
        sending_locked: false,  // release any stale lock
        current_job_id: null,
        ...(opts.ip ? { unsubscribe_ip: opts.ip } : {}),
        ...(opts.userAgent ? { unsubscribe_user_agent: opts.userAgent } : {}),
      },
      // Increment schedule_version to invalidate pending BullMQ delayed jobs —
      // the worker discards jobs whose scheduleVersion doesn't match.
      $inc: { schedule_version: 1 },
    },
    { new: true }
  );

  if (!updated) {
    // Distinguish "already unsubscribed" from "not found"
    const existing = await SequenceContact
      .findById(contactId)
      .select('status')
      .lean();
    if (!existing) return 'invalid';
    if (existing.status === ContactEnrollmentStatus.UNSUBSCRIBED) return 'already';
    return 'invalid';
  }

  // Increment sequence unsubscribe counter — only when we win the race
  Sequence.updateOne(
    { _id: updated.sequence_id },
    { $inc: { 'stats.unsubscribed': 1 } }
  ).catch(err => logger.error('Failed to increment stats.unsubscribed', { error: err.message }));

  // Audit log — use fixed defaults for fields that don't apply to automated events
  AuditLog.create({
    user_id: updated.user_id,
    sequence_id: updated.sequence_id,
    action_type: 'contact_unsubscribed',
    browser_timezone: 'UTC',
    affected_contacts_count: 1,
    details: {
      contact_id: contactId,
      source: UnsubscribeSource.LINK,
      unsubscribed_at: updated.unsubscribed_at,
      ip: opts.ip ?? null,
      user_agent: opts.userAgent ?? null,
    },
  }).catch(err => logger.error('Failed to write unsubscribe audit log', { error: err.message }));

  logger.info('Contact unsubscribed via link', {
    contactId,
    sequenceId: updated.sequence_id.toString(),
    ip: opts.ip,
  });

  return 'success';
}

// ─── GET /api/unsubscribe/:token ───────────────────────────────────
/**
 * Handles a user clicking the unsubscribe link in an email.
 * Performs the atomic unsubscribe and returns a branded HTML confirmation page.
 * Always returns 200 with HTML regardless of token validity (privacy).
 */
export async function handleUnsubscribeGet(
  req: Request,
  res: Response,
  _next: NextFunction
): Promise<void> {
  try {
    const { token } = req.params;
    const ip = (req.headers['x-forwarded-for'] as string | undefined)
      ?? req.socket.remoteAddress
      ?? '';
    const userAgent = req.headers['user-agent'] ?? '';

    const result = await performUnsubscribe(token, { ip, userAgent });

    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(
      renderUnsubscribePage({ alreadyUnsubscribed: result === 'already' })
    );
  } catch (err) {
    logger.error('handleUnsubscribeGet error', { error: (err as Error).message });
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(renderUnsubscribePage({}));
  }
}

// ─── POST /api/unsubscribe/:token ──────────────────────────────────
/**
 * RFC 8058 One-Click Unsubscribe endpoint.
 * Mail clients (Gmail, Apple Mail) POST here with:
 *   Content-Type: application/x-www-form-urlencoded
 *   Body: List-Unsubscribe=One-Click
 *
 * Returns 204 No Content on success (as required by RFC 8058).
 */
export async function handleUnsubscribePost(
  req: Request,
  res: Response,
  _next: NextFunction
): Promise<void> {
  try {
    const { token } = req.params;

    // RFC 8058 §3.1: the POST body MUST contain "List-Unsubscribe=One-Click"
    // express.urlencoded() (already in server.ts) parses this body automatically
    const body = req.body as Record<string, string>;
    if (body['List-Unsubscribe'] !== 'One-Click') {
      res.status(400).json({ error: 'Invalid request body — expected List-Unsubscribe=One-Click' });
      return;
    }

    const ip = (req.headers['x-forwarded-for'] as string | undefined)
      ?? req.socket.remoteAddress
      ?? '';
    const userAgent = req.headers['user-agent'] ?? '';

    await performUnsubscribe(token, { ip, userAgent });

    // RFC 8058 §3.2: respond with 204 No Content — no body
    res.status(204).send();
  } catch (err) {
    logger.error('handleUnsubscribePost error', { error: (err as Error).message });
    res.status(500).send();
  }
}

// ─── GET /unsubscribe/:token (legacy) ─────────────────────────────
/**
 * Backward-compatibility handler for old AES-encrypted tokens already sent in emails.
 * Attempts to decrypt with the old scheme; shows success page regardless (privacy).
 */
export async function handleUnsubscribeLegacy(
  req: Request,
  res: Response,
  _next: NextFunction
): Promise<void> {
  try {
    const { token } = req.params;
    if (token) {
      try {
        const decoded = decodeURIComponent(token);
        const contactId = decrypt(decoded);
        await enrollmentService.unsubscribeContact(contactId, UnsubscribeSource.LINK);
      } catch {
        // Invalid legacy token — show success page regardless (privacy)
      }
    }
  } catch { /* swallow */ }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.status(200).send(renderUnsubscribePage({}));
}
