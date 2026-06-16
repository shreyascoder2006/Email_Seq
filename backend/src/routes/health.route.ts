import { Router, Request, Response } from 'express';
import mongoose from 'mongoose';
import { redisClient } from '../config/redis';
import { emailQueue } from '../queues/emailQueue';
import { sendSuccess } from '../utils/response';
import logger from '../config/logger';

const router = Router();

// ─── GET /api/health ───────────────────────────────────────────────
router.get('/', async (_req: Request, res: Response) => {
  const startTime = Date.now();

  // ── MongoDB status ────────────────────────────────────────────
  const mongoState = mongoose.connection.readyState;
  const mongoStatus: Record<number, string> = {
    0: 'disconnected',
    1: 'connected',
    2: 'connecting',
    3: 'disconnecting',
  };

  // ── Redis ping ────────────────────────────────────────────────
  let redisStatus = 'disconnected';
  let redisPingMs: number | null = null;
  try {
    const redisPingStart = Date.now();
    const pong = await redisClient.ping();
    redisPingMs = Date.now() - redisPingStart;
    redisStatus = pong === 'PONG' ? 'connected' : 'unknown';
  } catch (err) {
    logger.warn('Health check: Redis ping failed', { error: (err as Error).message });
  }

  // ── BullMQ queue stats ────────────────────────────────────────
  let queueStats = null;
  try {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      emailQueue.getWaitingCount(),
      emailQueue.getActiveCount(),
      emailQueue.getCompletedCount(),
      emailQueue.getFailedCount(),
      emailQueue.getDelayedCount(),
    ]);
    queueStats = { waiting, active, completed, failed, delayed };
  } catch {
    queueStats = { error: 'unavailable' };
  }

  const responseTimeMs = Date.now() - startTime;
  const isHealthy =
    mongoState === 1 && redisStatus === 'connected';

  const healthData = {
    status: isHealthy ? 'healthy' : 'degraded',
    timestamp: new Date().toISOString(),
    uptime: Math.floor(process.uptime()),
    responseTimeMs,
    version: process.env.npm_package_version || '1.0.0',
    environment: process.env.NODE_ENV || 'development',
    services: {
      mongodb: {
        status: mongoStatus[mongoState] || 'unknown',
        readyState: mongoState,
      },
      redis: {
        status: redisStatus,
        pingMs: redisPingMs,
      },
      queue: {
        name: process.env.EMAIL_QUEUE_NAME || 'email-sequence',
        stats: queueStats,
      },
    },
    memory: {
      heapUsedMB: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
      heapTotalMB: Math.round(process.memoryUsage().heapTotal / 1024 / 1024),
      rssMB: Math.round(process.memoryUsage().rss / 1024 / 1024),
    },
  };

  const statusCode = isHealthy ? 200 : 503;
  sendSuccess(res, healthData, isHealthy ? 'All systems operational' : 'Service degraded', statusCode);
});

// ─── GET /api/health/ping — Ultra-lightweight liveness probe ───────
router.get('/ping', (_req: Request, res: Response) => {
  res.status(200).json({ pong: true, ts: Date.now() });
});

export default router;
