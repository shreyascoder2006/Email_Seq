import { Router } from 'express';
import { googleAuth, googleCallback, microsoftAuth, microsoftCallback } from '../controllers/oauth.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

// Init requires auth because we need user_id in 'state'
router.get('/google/auth', authenticate, googleAuth);
// Callback does NOT use authenticate middleware because Google redirects back with code
// The user context is extracted from 'state' which contains the userId.
// (In production, 'state' should be a signed JWT to prevent CSRF, but for now we pass userId directly)
router.get('/google/callback', googleCallback);

router.get('/microsoft/auth', authenticate, microsoftAuth);
router.get('/microsoft/callback', microsoftCallback);

export default router;
