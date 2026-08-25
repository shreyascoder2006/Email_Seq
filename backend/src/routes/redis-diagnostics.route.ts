/**
 * src/routes/redis-diagnostics.route.ts
 *
 * GET /api/system/redis-diagnostics
 *
 * Development / debugging endpoint.
 * Returns a complete snapshot of Redis connectivity state for every
 * BullMQ component in the system.  Call this when investigating
 * ECONNREFUSED or queue stall issues without restarting the process.
 *
 * NOT PROTECTED by auth — add authenticateToken middleware for staging/prod.
 */

import { Router, Request, Response } from 'express';
import Redis from 'ioredis';
import { redisClient, redisSubscriber, REDIS_HOST, REDIS_PORT } from '../config/redis';
import { emailQueue, getWorkerHealth } from '../queues/emailQueue';
import { getSchedulerQueue, getSchedulerHealth } from '../queues/schedulerQueue';
import { getWorkerWatchdog } from '../queues/workerWatchdog';
import logger from '../config/logger';

const router = Router();

// ─── Helper: safe ioredis status snapshot ─────────────────────────
function clientSnapshot(label: string, client: Redis | null) {
  if (!client) return { label, status: 'not_initialized' };
  return {
    label,
    status: client.status,
    connected: client.status === 'ready',
    reconnecting: client.status === 'reconnecting',
    ended: client.status === 'end',
  };
}

// ─── GET /api/system/redis-diagnostics ────────────────────────────
router.get('/', async (_req: Request, res: Response) => {
  const start = Date.now();
  logger.info('[REDIS-DIAG] Diagnostic endpoint called');

  // 1. Redis ping
  let pingMs: number | null = null;
  let redisStatus = redisClient.status;
  try {
    const t0 = Date.now();
    await redisClient.ping();
    pingMs = Date.now() - t0;
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    logger.warn('[REDIS-DIAG] Redis ping failed', { code: e.code, message: e.message });
  }

  // 2. Primary + subscriber client state
  const primarySnapshot = clientSnapshot('primary', redisClient as any);
  const subscriberSnapshot = clientSnapshot('subscriber', redisSubscriber as any);

  // 3. BullMQ queue/worker snapshots
  const schedulerQueue = getSchedulerQueue();
  const workerHealth = getWorkerHealth();
  const schedulerHealth = getSchedulerHealth();

  // 4. Worker watchdog diagnostics (if Redis is up enough to query)
  let watchdogDiag: Record<string, unknown> | null = null;
  try {
    const watchdog = getWorkerWatchdog();
    if (watchdog && pingMs !== null) {
      watchdogDiag = await watchdog.getDiagnosticReport() as any;
    }
  } catch { /* ignore */ }

  // 5. Queue depths (best-effort)
  let emailQueueDepths: Record<string, number> | null = null;
  let schedulerQueueDepths: Record<string, number> | null = null;

  if (pingMs !== null) {
    try {
      const [ew, ea, ed, ef, ec] = await Promise.all([
        emailQueue.getWaitingCount(),
        emailQueue.getActiveCount(),
        emailQueue.getDelayedCount(),
        emailQueue.getFailedCount(),
        emailQueue.getCompletedCount(),
      ]);
      emailQueueDepths = { waiting: ew, active: ea, delayed: ed, failed: ef, completed: ec };
    } catch { /* ignore */ }

    if (schedulerQueue) {
      try {
        const [sw, sa, sd, sf, sc] = await Promise.all([
          schedulerQueue.getWaitingCount(),
          schedulerQueue.getActiveCount(),
          schedulerQueue.getDelayedCount(),
          schedulerQueue.getFailedCount(),
          schedulerQueue.getCompletedCount(),
        ]);
        schedulerQueueDepths = { waiting: sw, active: sa, delayed: sd, failed: sf, completed: sc };
      } catch { /* ignore */ }
    }
  }

  const elapsed = Date.now() - start;

  return res.json({
    generatedAt: new Date().toISOString(),
    diagnosticMs: elapsed,

    redis: {
      host: REDIS_HOST,
      port: REDIS_PORT,
      status: redisStatus,
      pingMs,
      reachable: pingMs !== null,
      clients: {
        primary: primarySnapshot,
        subscriber: subscriberSnapshot,
      },
    },

    bullmq: {
      emailQueue: {
        name: 'email-sequence',
        depths: emailQueueDepths,
        workerHealth: {
          workerRunning: workerHealth.workerRunning,
          workerClosed: workerHealth.workerClosed,
          redisConnected: workerHealth.redisConnected,
          lastJobProcessedAt: workerHealth.lastJobProcessedAt,
          lastSuccessfulEmailSentAt: workerHealth.lastSuccessfulEmailSentAt,
        },
      },
      schedulerQueue: {
        name: 'sequence-scheduler',
        depths: schedulerQueueDepths,
        schedulerHealth: {
          schedulerRunning: schedulerHealth.schedulerRunning,
          lastSchedulerRunAt: schedulerHealth.lastSchedulerRunAt,
          lastDueContactsFound: schedulerHealth.lastDueContactsFound,
          lastJobsEnqueued: schedulerHealth.lastJobsEnqueued,
          recoveryCount: schedulerHealth.schedulerRecoveryCount,
        },
      },
    },

    workerWatchdog: watchdogDiag,
    recoveryEngine: watchdogDiag,
  });
});

export default router;
