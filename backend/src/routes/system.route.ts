/**
 * src/routes/system.route.ts
 *
 * System health and control API.
 *
 * Endpoints:
 *   GET  /api/system/health   — Read-only health report (JWT protected)
 *   GET  /api/system/workers  — Detailed worker & queue metrics (JWT protected)
 *   POST /api/system/recover  — Force recovery (JWT protected)
 *   POST /api/system/tick     — Force immediate scheduler tick (JWT protected)
 *   POST /api/system/rebuild-queue — Rebuild BullMQ queue from Mongo (JWT protected)
 */

import { Router, Request, Response } from 'express';
import { authenticate as authenticateToken } from '../middleware/auth';
import logger from '../config/logger';
import redisClient from '../config/redis';
import {
  getHeartbeat,
  getHeartbeatAgeMs,
  getLastSchedulerTick,
  getRecoveryCount,
  getInfraStatus,
} from '../queues/infraState';
import { getRecoveryEngine } from '../queues/recoveryEngine';
import { getSchedulerQueue } from '../queues/schedulerQueue';

const router = Router();

// All system routes require authentication
router.use(authenticateToken);

// ─── GET /api/system/health ────────────────────────────────────────
router.get('/health', async (req: Request, res: Response) => {
  try {
    // 1. Redis ping
    let redisPingMs: number | null = null;
    let redisHealthy = false;
    try {
      const t0 = Date.now();
      await redisClient.ping();
      redisPingMs = Date.now() - t0;
      redisHealthy = true;
    } catch { /* redis down */ }

    // 2. Heartbeats
    const [schedulerHb, emailHb] = await Promise.all([
      getHeartbeat('scheduler-worker'),
      getHeartbeat('email-worker'),
    ]);
    const [schedulerHbAgeMs, emailHbAgeMs] = await Promise.all([
      getHeartbeatAgeMs('scheduler-worker'),
      getHeartbeatAgeMs('email-worker'),
    ]);

    // 3. Scheduler tick
    const lastTick = await getLastSchedulerTick();
    const lastTickAgeMs = lastTick
      ? Date.now() - new Date(lastTick).getTime()
      : null;

    // 4. Recovery state
    const [recoveryCount, infraStatus] = await Promise.all([
      getRecoveryCount(),
      getInfraStatus(),
    ]);

    // 5. Queue depths
    const schedulerQueue = getSchedulerQueue();
    let queueDepths = null;
    if (schedulerQueue && redisHealthy) {
      try {
        const [waiting, active, delayed, failed, completed] = await Promise.all([
          schedulerQueue.getWaitingCount(),
          schedulerQueue.getActiveCount(),
          schedulerQueue.getDelayedCount(),
          schedulerQueue.getFailedCount(),
          schedulerQueue.getCompletedCount(),
        ]);
        const repeatableJobs = await schedulerQueue.getRepeatableJobs();
        queueDepths = {
          waiting, active, delayed, failed, completed,
          repeatableJobsCount: repeatableJobs.length,
          nextTick: repeatableJobs[0]?.next
            ? new Date(repeatableJobs[0].next).toISOString()
            : null,
        };
      } catch { /* ignore */ }
    }

    // 6. Recovery engine diagnostics (if available)
    const engine = getRecoveryEngine();
    let diagnostics = null;
    if (engine && redisHealthy) {
      try {
        diagnostics = await engine.getDiagnosticReport();
      } catch { /* ignore */ }
    }

    // 7. Compute overall status
    const DEGRADED_THRESHOLD_MS  = 60_000;  // heartbeat silent > 60s → degraded
    const UNHEALTHY_THRESHOLD_MS = 300_000; // heartbeat silent > 5min → unhealthy

    const schedulerStale = schedulerHbAgeMs > DEGRADED_THRESHOLD_MS;
    const schedulerDead  = schedulerHbAgeMs > UNHEALTHY_THRESHOLD_MS;

    let overallStatus: 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';
    if (!redisHealthy || schedulerDead || infraStatus === 'UNHEALTHY') {
      overallStatus = 'UNHEALTHY';
    } else if (schedulerStale || infraStatus === 'DEGRADED' || recoveryCount > 0) {
      overallStatus = 'DEGRADED';
    } else {
      overallStatus = 'HEALTHY';
    }

    return res.json({
      status:    overallStatus,
      timestamp: new Date().toISOString(),
      redis: {
        healthy: redisHealthy,
        pingMs:  redisPingMs,
      },
      schedulerWorker: {
        heartbeat:      schedulerHb,
        heartbeatAgeMs: schedulerHbAgeMs === Infinity ? null : schedulerHbAgeMs,
        stale:          schedulerStale,
      },
      emailWorker: {
        heartbeat:      emailHb,
        heartbeatAgeMs: emailHbAgeMs === Infinity ? null : emailHbAgeMs,
      },
      scheduler: {
        lastTick,
        lastTickAgeMs,
        queueDepths,
        recoveryCount,
        infraStatus,
      },
      diagnostics,
    });
  } catch (err) {
    logger.error('[SYSTEM] Health check failed', { error: (err as Error).message });
    return res.status(500).json({ error: 'Health check failed', details: (err as Error).message });
  }
});

// ─── POST /api/system/recover ──────────────────────────────────────
router.post('/recover', async (req: Request, res: Response) => {
  try {
    const engine = getRecoveryEngine();
    if (!engine) {
      return res.status(503).json({ error: 'Recovery engine not initialized' });
    }
    const result = await engine.recoverScheduler();
    logger.info('[SYSTEM] Manual recovery triggered', { result });
    return res.json({ success: result.success, action: result.action, message: result.message });
  } catch (err) {
    logger.error('[SYSTEM] Manual recovery failed', { error: (err as Error).message });
    return res.status(500).json({ error: 'Recovery failed', details: (err as Error).message });
  }
});

// ─── POST /api/system/tick ─────────────────────────────────────────
router.post('/tick', async (req: Request, res: Response) => {
  try {
    const queue = getSchedulerQueue();
    if (!queue) {
      return res.status(503).json({ error: 'Scheduler queue not initialized' });
    }
    const job = await queue.add(
      'scheduler:tick:manual',
      { triggeredBy: (req as any).user?.id ?? 'unknown', correlationId: `manual-${Date.now()}` },
      { removeOnComplete: 5, removeOnFail: 5 }
    );
    logger.info('[SYSTEM] Manual scheduler tick enqueued', { jobId: job.id });
    return res.json({ success: true, jobId: job.id, message: 'Manual tick enqueued' });
  } catch (err) {
    logger.error('[SYSTEM] Manual tick failed', { error: (err as Error).message });
    return res.status(500).json({ error: 'Failed to enqueue tick', details: (err as Error).message });
  }
});

// ─── GET /api/system/workers ───────────────────────────────────────
router.get('/workers', async (req: Request, res: Response) => {
  try {
    const schedulerQueue = getSchedulerQueue();
    const { emailQueue, getWorkerHealth } = await import('../queues/emailQueue');
    const { getSchedulerHealth } = await import('../queues/schedulerQueue');

    let schedulerQueueDepths = null;
    let emailQueueDepths = null;

    if (schedulerQueue) {
      const [waiting, active, delayed, failed, completed] = await Promise.all([
        schedulerQueue.getWaitingCount(),
        schedulerQueue.getActiveCount(),
        schedulerQueue.getDelayedCount(),
        schedulerQueue.getFailedCount(),
        schedulerQueue.getCompletedCount(),
      ]);
      schedulerQueueDepths = { waiting, active, delayed, failed, completed };
    }

    if (emailQueue) {
      const [waiting, active, delayed, failed, completed] = await Promise.all([
        emailQueue.getWaitingCount(),
        emailQueue.getActiveCount(),
        emailQueue.getDelayedCount(),
        emailQueue.getFailedCount(),
        emailQueue.getCompletedCount(),
      ]);
      emailQueueDepths = { waiting, active, delayed, failed, completed };
    }

    return res.json({
      timestamp: new Date().toISOString(),
      schedulerWorker: getSchedulerHealth(),
      emailWorker: getWorkerHealth(),
      schedulerQueue: schedulerQueueDepths,
      emailQueue: emailQueueDepths,
    });
  } catch (err) {
    logger.error('[SYSTEM] Workers metrics failed', { error: (err as Error).message });
    return res.status(500).json({ error: 'Workers metrics failed', details: (err as Error).message });
  }
});

// ─── POST /api/system/rebuild-queue ────────────────────────────────
router.post('/rebuild-queue', async (req: Request, res: Response) => {
  try {
    const { emailQueue, enqueueEmailJob } = await import('../queues/emailQueue');
    const { SequenceContact, ContactEnrollmentStatus } = await import('../models/SequenceContact');

    if (!emailQueue) {
      return res.status(503).json({ error: 'Email queue not initialized' });
    }

    logger.info('[SYSTEM] Starting Queue Rebuild process...');

    // 1. Delete all waiting/delayed jobs
    await emailQueue.obliterate({ force: true });
    logger.info('[SYSTEM] Queue obliterated');

    // 2. Scan Mongo for active contacts with next_send_at
    const activeContacts = await SequenceContact.find({
      status: ContactEnrollmentStatus.ACTIVE,
      next_send_at: { $ne: null }
    }).select('_id current_step_index next_send_at sequence_id').lean();

    // 3. Re-enqueue delayed jobs
    let enqueued = 0;
    for (const c of activeContacts) {
      if (c.next_send_at) {
        await enqueueEmailJob(
          c._id.toString(),
          c.current_step_index,
          c.next_send_at,
          c.sequence_id.toString(),
          'rebuild-queue'
        );
        enqueued++;
      }
    }

    logger.info(`[SYSTEM] Queue Rebuild complete. Enqueued ${enqueued} jobs.`);
    return res.json({ success: true, message: 'Queue rebuilt successfully', enqueuedCount: enqueued });
  } catch (err) {
    logger.error('[SYSTEM] Queue rebuild failed', { error: (err as Error).message });
    return res.status(500).json({ error: 'Queue rebuild failed', details: (err as Error).message });
  }
});

export default router;
