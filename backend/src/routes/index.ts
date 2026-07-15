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
import systemRouter        from './system.route';
import redisDiagRouter     from './redis-diagnostics.route';

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
router.use('/system',         systemRouter);
// Development diagnostics — unauthenticated for easy curl access
router.use('/system/redis-diagnostics', redisDiagRouter);

export default router;

