/**
 * src/queues/schedulerQueue.ts
 *
 * The Scheduler is responsible for:
 * 1. Running a repeatable BullMQ job every 5 minutes (configurable)
 * 2. The job scans SequenceContact for due contacts: { status: 'active', next_send_at: { $lte: now } }
 * 3. For each due contact, adds an idempotent email:send job to the emailQueue
 *    with jobId = "email-send-{contactId}-{stepIndex}" (prevents duplicates)
 *
 * Idempotency guarantees:
 * - BullMQ deduplicates by jobId — if job already exists in waiting/active, re-add is a no-op
 * - The email processor re-fetches and re-validates before sending
 * - The scheduler runs under a Redis distributed lock to prevent concurrent runs in multi-instance
 */

import { Queue, Worker, Job, QueueEvents } from 'bullmq';
import { BULL_REDIS_URL, BULL_REDIS_TLS } from '../config/redis';
import { SequenceContact, ContactEnrollmentStatus } from '../models/SequenceContact';
import { Sequence } from '../models/Sequence';
import { env } from '../config/env';
import logger from '../config/logger';
import { emailQueue } from './emailQueue';
import {
  publishHeartbeat,
  acquireSchedulerLock,
  releaseSchedulerLock,
  recordSchedulerTick,
} from './infraState';
import { RecoveryEngine, setRecoveryEngine } from './recoveryEngine';
import {
  calculateNextValidSlot,
  toSequenceLocalTime,
  isAllowedWeekday,
  isWithinSendingWindow,
  SchedulerDecision
} from '../utils/scheduling';
import { SendingWindow, SendingSchedule } from '../models/Sequence';
import { DateTime } from 'luxon';

// ─── Queue names ───────────────────────────────────────────────────
const SCHEDULER_QUEUE_NAME = 'sequence-scheduler';
const EMAIL_QUEUE_NAME     = env.EMAIL_QUEUE_NAME;
const SCHEDULER_INTERVAL   = parseInt(env.SCHEDULER_INTERVAL_MINUTES ?? '15', 10);
const BATCH_SIZE           = parseInt(env.SCHEDULER_BATCH_SIZE ?? '50', 10);

// ─── Connection factory ────────────────────────────────────────────
// CRITICAL: Every BullMQ instance (Queue, Worker, QueueEvents) MUST
// receive its own independent connection object. Sharing causes the
// Worker's blocking-poll client to collide and silently stop consuming.
function makeConnection(label: string) {
  const url = new URL(BULL_REDIS_URL);
  const conn = {
    host:                url.hostname,
    port:                parseInt(url.port || '6379', 10),
    ...(url.password ? { password: url.password } : {}),
    ...(BULL_REDIS_TLS  ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
    enableReadyCheck:     false,
    retryStrategy: (times: number) => {
      if (times > 5) {
        logger.warn(`[SCHEDULER-CONN:${label}] Redis retry #${times} — giving up`);
        return null;
      }
      const delay = Math.min(times * 500, 2_000);
      logger.warn(`[SCHEDULER-CONN:${label}] Redis retry #${times}, reconnecting in ${delay}ms`);
      return delay;
    },
  };
  logger.debug(`[SCHEDULER] Creating dedicated Redis connection for: ${label}`);
  return conn;
}

// ─── Module-level instances ────────────────────────────────────────
let schedulerQueue:       Queue       | null = null;
let schedulerWorker:      Worker      | null = null;
let schedulerQueueEvents: QueueEvents | null = null;

// ─── Scheduler Health State (in-process snapshot) ─────────────────
// Full cross-instance state is stored in Redis via infraState.ts
export interface SchedulerHealth {
  schedulerRunning:       boolean;
  lastSchedulerRunAt:     string | null;
  lastDueContactsFound:   number;
  lastJobsEnqueued:       number;
  schedulerRecoveryCount: number;
}

const schedulerHealth: SchedulerHealth = {
  schedulerRunning:       false,
  lastSchedulerRunAt:     null,
  lastDueContactsFound:   0,
  lastJobsEnqueued:       0,
  schedulerRecoveryCount: 0,
};

export function getSchedulerHealth(): Readonly<SchedulerHealth> {
  return { ...schedulerHealth };
}

// ─── Scheduler Processor ──────────────────────────────────────────
/**
 * Polls for due contacts and enqueues email:send jobs.
 * Runs every SCHEDULER_INTERVAL_MINUTES (default: 5 min).
 * Protected by a Redis distributed lock to prevent concurrent execution.
 */
export async function runScheduler(_job?: Job): Promise<void> {
  const isImmediate   = _job?.name === 'scheduler:tick:immediate';
  const tickSource    = isImmediate ? 'activation_immediate' : 'periodic';
  const sequenceScope = (_job?.data as any)?.sequenceId as string | undefined;
  const correlationId = (_job?.data as any)?.correlationId as string | undefined;

  logger.info('[SCHEDULER] Tick started', {
    jobId:         _job?.id ?? '(none)',
    jobName:       _job?.name ?? '(none)',
    tickSource,
    sequenceScope: sequenceScope ?? 'global',
    correlationId: correlationId ?? '(none)',
  });

  const now = new Date();

  // ── Distributed lock ──────────────────────────────────────────────
  // Prevents two Node.js processes from running the scheduler body
  // simultaneously (multi-instance / PM2 cluster / Kubernetes).
  const lockAcquired = await acquireSchedulerLock();
  if (!lockAcquired) {
    logger.info('[SCHEDULER] Skipping tick — another instance holds the distributed lock');
    return;
  }

  try {
    // ── Contact query (Reconciliation Sweep) ───────────────────────
    // Find contacts that are active, not locked, and whose next_send_at is in the past.
    const contactQuery: Record<string, unknown> = { 
      status: ContactEnrollmentStatus.ACTIVE,
      next_send_at: { $lte: now },
      sending_locked: false
    };
    if (sequenceScope) contactQuery.sequence_id = sequenceScope;

    const missedContacts = await SequenceContact.find(contactQuery)
      .sort({ next_send_at: 1 })
      .limit(BATCH_SIZE)
      .select('_id sequence_id current_step_index next_send_at contact_email')
      .lean();

    if (missedContacts.length === 0) {
      logger.debug('[SCHEDULER] No missed contacts found in this sweep');
      await recordSchedulerTick();
      return;
    }

    // ── Re-enqueue missed jobs ─────────────────────────────────────────
    const { enqueueEmailJob } = await import('./emailQueue');
    let enqueuedCount = 0;

    for (const c of missedContacts) {
      if (c.next_send_at) {
        try {
          await enqueueEmailJob(
            c._id.toString(),
            c.current_step_index,
            c.next_send_at,
            c.sequence_id.toString(),
            tickSource === 'periodic' ? 'reconciliation_sweep' : tickSource
          );
          enqueuedCount++;
        } catch (err: any) {
          logger.error('[SCHEDULER] Failed to re-enqueue missed job', {
            contactId: c._id.toString(),
            error: err.message
          });
        }
      }
    }

    // ── Update health state ──────────────────────────────────────────
    schedulerHealth.lastSchedulerRunAt   = now.toISOString();
    schedulerHealth.lastDueContactsFound  = missedContacts.length;
    schedulerHealth.lastJobsEnqueued      = enqueuedCount;

    // Persist to Redis — survives restarts, visible across all instances
    await recordSchedulerTick();
    await publishHeartbeat('scheduler-worker', {
      lastJobStarted:   now.toISOString(),
      lastJobCompleted: new Date().toISOString(),
      lastJobFailed:    null,
      extra: { contacts_evaluated: missedContacts.length, jobs_enqueued: enqueuedCount, tickSource },
    });

    logger.info('[SCHEDULER] Tick complete', {
      tickSource,
      sequenceScope:      sequenceScope ?? 'global',
      contacts_evaluated: missedContacts.length,
      jobs_enqueued:      enqueuedCount,
      durationMs:         Date.now() - now.getTime(),
    });

  } finally {
    await releaseSchedulerLock();
  }
}

// ─── Reusable worker lifecycle listener attachment ─────────────────
// Extracted so the RecoveryEngine can re-attach listeners after
// recreating a Worker instance without duplicating code.
function attachWorkerListeners(worker: Worker): void {
  worker.on('ready', () => {
    schedulerHealth.schedulerRunning = true;
    logger.info('✅ [SCHEDULER-WORKER] Worker READY', {
      queueName: SCHEDULER_QUEUE_NAME,
      timestamp: new Date().toISOString(),
    });
    worker.client.then((client) => {
      (client as any).ping().then((res: string) => {
        logger.info('[SCHEDULER-WORKER] Redis health check PASSED', { pingResponse: res });
      }).catch((err: Error) => {
        logger.error('[SCHEDULER-WORKER] Redis health check FAILED', { error: err.message });
      });
    }).catch((err: Error) => {
      logger.error('[SCHEDULER-WORKER] Could not retrieve Redis client', { error: err.message });
    });
  });

  worker.on('active', (job) => {
    logger.info('▶️  [SCHEDULER-WORKER] Job ACTIVE', {
      jobId: job.id, jobName: job.name, attempt: job.attemptsMade + 1,
    });
  });

  worker.on('completed', (job) => {
    logger.info('✅ [SCHEDULER-WORKER] Job COMPLETED', { jobId: job.id });
  });

  worker.on('failed', (job, err: Error) => {
    logger.error('❌ [SCHEDULER-WORKER] Job FAILED', { jobId: job?.id, error: err.message });
    publishHeartbeat('scheduler-worker', {
      lastJobStarted:   null,
      lastJobCompleted: null,
      lastJobFailed:    new Date().toISOString(),
      extra: { jobId: job?.id, error: err.message },
    }).catch(() => {});
  });

  worker.on('stalled', (jobId: string) => {
    logger.warn('⚠️  [SCHEDULER-WORKER] Job STALLED', { jobId });
  });

  worker.on('error', (err: Error) => {
    logger.error('💥 [SCHEDULER-WORKER] Worker error', { error: err.message });
    schedulerHealth.schedulerRunning = false;
  });

  worker.on('closed', () => {
    schedulerHealth.schedulerRunning = false;
    logger.warn('[SCHEDULER-WORKER] Worker CLOSED');
  });
}

// ─── Start scheduler ───────────────────────────────────────────────
export function startScheduler(): { schedulerQueue: Queue } | null {
  try {
    logger.info('[SCHEDULER] startScheduler() called — beginning setup', {
      queueName:       SCHEDULER_QUEUE_NAME,
      intervalMinutes: SCHEDULER_INTERVAL,
      batchSize:       BATCH_SIZE,
    });

    // Each BullMQ instance gets its OWN dedicated connection.
    // Sharing causes the Worker's poll client to collide with Queue's
    // command client, silently preventing the Worker from consuming jobs.
    const queueConn       = makeConnection('scheduler-queue');
    const workerConn      = makeConnection('scheduler-worker');
    const queueEventsConn = makeConnection('scheduler-queueevents');

    // ── Queue ──────────────────────────────────────────────────────
    schedulerQueue = new Queue(SCHEDULER_QUEUE_NAME, { connection: queueConn });
    logger.info('[SCHEDULER] Queue instance created', { queueName: SCHEDULER_QUEUE_NAME });

    // ── Worker ──────────────────────────────────────────────────────
    schedulerWorker = new Worker(
      SCHEDULER_QUEUE_NAME,
      runScheduler,
      {
        connection:   workerConn,
        concurrency:  1,
        lockDuration: 60_000,
      }
    );
    logger.info('[SCHEDULER] Worker instance created — attaching lifecycle listeners');
    attachWorkerListeners(schedulerWorker);

    // ── QueueEvents ─────────────────────────────────────────────────
    schedulerQueueEvents = new QueueEvents(SCHEDULER_QUEUE_NAME, { connection: queueEventsConn });
    schedulerQueueEvents.on('failed', ({ jobId, failedReason }) => {
      logger.error('[SCHEDULER-QUEUEEVENTS] Job failed', { jobId, failedReason });
    });
    schedulerQueueEvents.on('stalled', ({ jobId }) => {
      logger.warn('[SCHEDULER-QUEUEEVENTS] Job stalled', { jobId });
    });
    schedulerQueueEvents.on('error', (err: Error) => {
      logger.error('[SCHEDULER-QUEUEEVENTS] QueueEvents error', { error: err.message });
    });

    // ── Repeatable job registration ──────────────────────────────────
    // Remove any stale repeatable jobs before registering a fresh one
    schedulerQueue.getRepeatableJobs().then(async (existing) => {
      for (const job of existing) {
        await schedulerQueue!.removeRepeatableByKey(job.key);
      }
      await schedulerQueue!.add(
        'scheduler:tick',
        {},
        {
          repeat:           { every: SCHEDULER_INTERVAL * 60 * 1000 },
          removeOnComplete: 5,
          removeOnFail:     5,
        }
      );
      logger.info(`⏱  Scheduler registered — tick every ${SCHEDULER_INTERVAL} min`);
    }).catch((err: Error) => {
      logger.error('[SCHEDULER] Failed to register repeatable job', { error: err.message });
    });

    // ── Recovery Engine + Watchdog ───────────────────────────────────
    // Replaces the old ad-hoc setInterval watchdog.
    // The engine diagnoses root cause before applying any recovery action.
    const engine = new RecoveryEngine({
      getSchedulerWorker: () => schedulerWorker,
      getSchedulerQueue:  () => schedulerQueue,
      recreateSchedulerWorker: async () => {
        try { await schedulerWorker?.close(); } catch { /* ignore */ }
        const freshConn = makeConnection('scheduler-worker-recreated');
        schedulerWorker = new Worker(
          SCHEDULER_QUEUE_NAME,
          runScheduler,
          { connection: freshConn, concurrency: 1, lockDuration: 60_000 }
        );
        attachWorkerListeners(schedulerWorker);
        logger.info('[RECOVERY] Fresh Scheduler Worker created');
      },
      schedIntervalMs: SCHEDULER_INTERVAL * 60 * 1000,
    });
    setRecoveryEngine(engine);
    engine.startWatchdog();

    logger.info('✅ Scheduler started');
    return { schedulerQueue };

  } catch (err) {
    const error = err as Error;
    if (env.NODE_ENV === 'development') {
      logger.warn(`⚠️  Scheduler could not start (Redis unavailable): ${error.message}`);
      return null;
    }
    throw err;
  }
}

// ─── Graceful shutdown ────────────────────────────────────────────
export async function stopScheduler(): Promise<void> {
  // Stop the watchdog first to prevent new recovery ticks
  const { getRecoveryEngine } = await import('./recoveryEngine');
  getRecoveryEngine()?.stopWatchdog();

  // Workers must close before QueueEvents (they emit events while closing)
  await Promise.allSettled([schedulerWorker?.close()]);
  await Promise.allSettled([
    schedulerQueueEvents?.close(),
    schedulerQueue?.close(),
  ]);
  logger.info('Scheduler shut down cleanly');
}

/**
 * Returns the live schedulerQueue instance.
 * Use this instead of the raw `schedulerQueue` export because
 * in CommonJS the exported `let` value is a snapshot (null until startScheduler runs).
 */
export function getSchedulerQueue(): Queue | null {
  return schedulerQueue;
}

export { schedulerQueue };
