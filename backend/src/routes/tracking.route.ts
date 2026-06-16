import { Router } from 'express';
import { trackOpen, trackClick, handleUnsubscribe } from '../controllers/tracking.controller';

const router = Router();

// These routes must be public (no authentication)
// The parameter validations are intentionally lightweight to ensure high performance

/**
 * GET /p/:messageId
 * Pixel tracking endpoint
 */
router.get('/p/:messageId', trackOpen);

/**
 * GET /r/:trackingId
 * Link click tracking endpoint
 */
router.get('/r/:trackingId', trackClick);

/**
 * GET /unsubscribe/:token
 * Unsubscribe a contact from a sequence
 */
router.get('/unsubscribe/:token', handleUnsubscribe);

export default router;
