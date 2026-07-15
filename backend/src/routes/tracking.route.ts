import { Router } from 'express';
import {
  trackOpen,
  trackClick,
  handleUnsubscribeGet,
  handleUnsubscribePost,
  handleUnsubscribeLegacy,
} from '../controllers/tracking.controller';
import { unsubscribeRateLimiter } from '../middleware/rateLimiter';

const router = Router();

// These routes must be public (no authentication)

/**
 * GET /p/:messageId
 * Tracking pixel endpoint — returns 1x1 GIF, processes open asynchronously
 */
router.get('/p/:messageId', trackOpen);

/**
 * GET /r/:trackingId
 * Link click tracking endpoint — redirects to original URL
 */
router.get('/r/:trackingId', trackClick);

/**
 * GET /api/unsubscribe/:token  (RFC 2369)
 * Confirms unsubscription and serves a branded HTML page.
 * Rate-limited to prevent token enumeration.
 */
router.get('/api/unsubscribe/:token', unsubscribeRateLimiter, handleUnsubscribeGet);

/**
 * POST /api/unsubscribe/:token  (RFC 8058 One-Click)
 * Machine-triggered by Gmail / Apple Mail. Validates body, returns 204.
 * Rate-limited identically to GET.
 */
router.post('/api/unsubscribe/:token', unsubscribeRateLimiter, handleUnsubscribePost);

/**
 * GET /unsubscribe/:token  (legacy AES tokens — backward compat)
 * Handles tokens from emails sent before the HMAC migration.
 * Shows success page regardless of token validity (privacy).
 */
router.get('/unsubscribe/:token', handleUnsubscribeLegacy);

export default router;
