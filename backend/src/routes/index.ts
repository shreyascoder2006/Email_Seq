import { Router } from 'express';
import healthRouter        from './health.route';
import emailAccountsRouter from './emailConnection.route';
import sequenceRouter      from './sequence.route';
import authRouter          from './auth.route';
import templateRouter      from './template.route';
import debugRouter         from './debug.route';
import importRouter        from './import.route';
import analyticsRouter     from './analytics.route';
import oauthRouter         from './oauth.route';

const router = Router();

// ─── Mounted routes ────────────────────────────────────────────────
router.use('/auth',           authRouter);
router.use('/health',         healthRouter);
router.use('/email-accounts', emailAccountsRouter);
router.use('/sequences',      sequenceRouter);
router.use('/templates',      templateRouter);
router.use('/debug',          debugRouter);
router.use('/imports',        importRouter);
router.use('/analytics',      analyticsRouter);
router.use('/oauth',          oauthRouter);

// TODO: Mount as features are built:
// router.use('/auth',      authRateLimiter, authRouter);
// router.use('/contacts',  authenticate, contactRouter);
// router.use('/emails',    authenticate, emailRateLimiter, emailRouter);

export default router;

