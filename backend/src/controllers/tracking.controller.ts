import { Request, Response, NextFunction } from 'express';
import { SendingLog } from '../models/SendingLog';
import { OpenLog } from '../models/OpenLog';
import { ClickLog } from '../models/ClickLog';
import { SequenceContact } from '../models/SequenceContact';
import { Sequence } from '../models/Sequence';
import { enrollmentService } from '../services/enrollment.service';
import { decrypt } from '../utils/crypto';
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
        const sendingLog = await SendingLog.findOne({ message_id: messageId }).lean();
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
          sequence_id:         sendingLog.sequence_id,
          sequence_contact_id: sendingLog.sequence_contact_id,
          sending_log_id:      sendingLog._id,
          user_id:             sendingLog.user_id,
          contact_email:       sendingLog.to_email,
          step_index:          sendingLog.step_index,
          is_first_open:       isFirstOpen,
          open_count:          1,
          user_agent:          userAgent,
          ip_address:          ip as string,
        });

        if (isFirstOpen) {
          await SequenceContact.updateOne(
            { _id: sendingLog.sequence_contact_id },
            { has_opened: true }
          );
          // Update sequence stats
          await Sequence.updateOne(
            { _id: sendingLog.sequence_id },
            { $inc: { 'stats.opens': 1 } }
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
        const isFirstClick = clickLog.click_count === 0;

        await ClickLog.updateOne(
          { _id: clickLog._id },
          {
            $set: {
              is_first_click: false,
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
            { $inc: { 'stats.clicks': 1 } }
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

const unsubscribeHtml = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Unsubscribed</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      justify-content: center;
      align-items: center;
      height: 100vh;
      margin: 0;
      background-color: #f9fafb;
      color: #111827;
    }
    .container {
      text-align: center;
      padding: 40px;
      background: white;
      border-radius: 12px;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1), 0 2px 4px -1px rgba(0, 0, 0, 0.06);
      max-width: 400px;
      width: 90%;
    }
    .icon {
      font-size: 48px;
      margin-bottom: 16px;
    }
    h1 {
      font-size: 24px;
      margin-bottom: 8px;
    }
    p {
      color: #6b7280;
      font-size: 16px;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="icon">✅</div>
    <h1>Unsubscribed successfully</h1>
    <p>You have been removed from this sequence and will not receive further emails.</p>
  </div>
</body>
</html>
`;

export async function handleUnsubscribe(req: Request, res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.params.token;
    if (!token) {
      res.status(200).send(unsubscribeHtml);
      return;
    }

    try {
      const decoded = decodeURIComponent(token);
      const contactId = decrypt(decoded);

      // Perform unsubscribe asynchronously so the user gets the page immediately
      setImmediate(async () => {
        try {
          await enrollmentService.unsubscribeContact(contactId);
        } catch (err) {
          logger.error('Error during async unsubscribe', { error: (err as Error).message, contactId });
        }
      });
      
    } catch (err) {
      logger.warn('Invalid unsubscribe token received', { token });
      // Still return the success page for privacy / good UX
    }

    res.status(200).send(unsubscribeHtml);

  } catch (err) {
    logger.error('Error in handleUnsubscribe', { error: (err as Error).message });
    res.status(200).send(unsubscribeHtml);
  }
}

