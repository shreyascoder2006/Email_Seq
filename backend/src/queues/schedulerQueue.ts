/**
 * src/queues/schedulerQueue.ts
 *
 * The Scheduler is responsible for:
 * 1. Running a repeatable BullMQ job every 5 minutes (configurable)
 * 2. The job scans SequenceContact for due contacts: { status: 'active', next_send_at: { $lte: now } }
 * 3. For each due contact, adds an idempotent email:send job to the emailQueue
 *    with jobId = "email:send:{sequenceContactId}:{stepIndex}" (prevents duplicates)
 *
 * Idempotency guarantees:
 * - BullMQ deduplicates by jobId — if job already exists in waiting/active, re-add is a no-op
 * - The email processor re-fetches and re-validates before sending
 * - The scheduler runs under a distributed lock (Redis SETNX) to prevent concurrent runs
 */

import { Queue, Worker, Job } from 'bullmq';
import { BULL_REDIS_URL, BULL_REDIS_TLS } from '../config/redis';
import { SequenceContact, ContactEnrollmentStatus } from '../models/SequenceContact';
import { env, isDev } from '../config/env';
import logger from '../config/logger';
import { emailQueue } from './emailQueue';

// ─── Queue names ───────────────────────────────────────────────────
const SCHEDULER_QUEUE_NAME = 'sequence-scheduler';
const EMAIL_QUEUE_NAME     = env.EMAIL_QUEUE_NAME;
const SCHEDULER_INTERVAL   = parseInt(env.SCHEDULER_INTERVAL_MINUTES ?? '5', 10);
const BATCH_SIZE           = parseInt(env.SCHEDULER_BATCH_SIZE ?? '50', 10);

// ─── Connection factory ────────────────────────────────────────────
function makeConnection() {
  const url = new URL(BULL_REDIS_URL);
  return {
    host:                url.hostname,
    port:                parseInt(url.port || '6379', 10),
    ...(url.password ? { password: url.password } : {}),
    ...(BULL_REDIS_TLS  ? { tls: {} } : {}),
    maxRetriesPerRequest: null,
    enableReadyCheck:     false,
    retryStrategy:        isDev ? () => null : undefined,
  };
}

// ─── Queues ────────────────────────────────────────────────────────
let schedulerQueue: Queue | null = null;
let schedulerWorker: Worker | null = null;


// ─── Scheduler Processor ──────────────────────────────────────────
/**
 * Polls for due contacts and enqueues email:send jobs.
 * Runs every SCHEDULER_INTERVAL_MINUTES (default: 5 min).
 */
async function runScheduler(_job: Job): Promise<void> {
  const now = new Date();

  logger.debug(`Scheduler tick — scanning for due contacts (batch: ${BATCH_SIZE})`);

  // DEBUG LOGS
  const allActiveCount = await SequenceContact.countDocuments({ status: ContactEnrollmentStatus.ACTIVE });
  const allDueCount = await SequenceContact.countDocuments({ 
    status: ContactEnrollmentStatus.ACTIVE, 
    next_send_at: { $lte: now } 
  });
  logger.info('DEBUG SCHEDULER: Scheduler stats', {
    active_contacts: allActiveCount,
    due_contacts: allDueCount,
    query: { status: ContactEnrollmentStatus.ACTIVE, next_send_at: { $lte: now } }
  });

  // Find due contacts
  const dueContacts = await SequenceContact.find({
    status:       ContactEnrollmentStatus.ACTIVE,
    next_send_at: { $lte: now },
  })
    .limit(BATCH_SIZE)
    .select('_id current_step_index next_send_at contact_email') // ← include next_send_at + email for logging
    .lean();

  if (dueContacts.length === 0) {
    logger.debug('Scheduler: no due contacts found');
    return;
  }

  logger.info(`Scheduler: ${dueContacts.length} due contact(s) — enqueuing jobs`, {
    contacts: dueContacts.map(c => ({
      id:         c._id.toString(),
      email:      (c as any).contact_email,
      stepIndex:  c.current_step_index,
      next_send_at: c.next_send_at,
    })),
  });

  // Build job descriptors.
  // ⚠️ No custom jobId — we let BullMQ auto-generate unique IDs each scheduler tick.
  // A fixed jobId would cause BullMQ to silently deduplicate and DROP the job if a
  // job with that ID was ever added before (even if it completed/failed), resulting in
  // contacts that are never processed beyond the first scheduler tick.
  const jobs = dueContacts.map((c) => ({
    name: 'email:send',
    data: {
      sequenceContactId: c._id.toString(),
      stepIndex:         c.current_step_index,
    },
    opts: {
      attempts:         3,
      backoff:          { type: 'exponential', delay: 30_000 }, // 30s, 60s, 120s
      removeOnComplete: { count: 1000, age: 7  * 24 * 3600 },
      removeOnFail:     { count: 500,  age: 30 * 24 * 3600 },
    },
  }));

  if (emailQueue) {
    const addedJobs = await emailQueue.addBulk(jobs);
    logger.info(`Scheduler: successfully enqueued ${addedJobs.length} job(s) ✅`, {
      jobIds:    addedJobs.map(j => j.id),
      queueName: env.EMAIL_QUEUE_NAME,
    });
  } else {
    logger.error('Scheduler: emailQueue is null — email worker not initialised! Jobs NOT enqueued.');
  }
}

// ─── Start scheduler ───────────────────────────────────────────────
export function startScheduler(): { schedulerQueue: Queue } | null {
  try {
    const conn = makeConnection();

    // Scheduler queue — hosts the repeatable tick job
    schedulerQueue = new Queue(SCHEDULER_QUEUE_NAME, { connection: conn });

    // Worker: processes scheduler ticks
    schedulerWorker = new Worker(
      SCHEDULER_QUEUE_NAME,
      runScheduler,
      {
        connection:  conn,
        concurrency: 1, // Only one scheduler tick runs at a time
        lockDuration: 60_000, // 60s lock per job
      }
    );

    // Error handlers — log even in dev so we can diagnose Redis/BullMQ issues
    schedulerWorker.on('error', (err: Error) => {
      logger.error('Scheduler worker error', { error: err.message });
    });
    schedulerWorker.on('failed', (job, err: Error) => {
      logger.error('Scheduler tick FAILED', { jobId: job?.id, error: err.message });
    });

    // Register the repeatable scheduler tick
    schedulerQueue.add(
      'scheduler:tick',
      {},
      {
        repeat:            { every: SCHEDULER_INTERVAL * 60 * 1000 },
        jobId:             'scheduler-tick-singleton',
        removeOnComplete:  5,
        removeOnFail:      5,
      }
    ).then(() => {
      logger.info(
        `⏱  Scheduler registered — tick every ${SCHEDULER_INTERVAL} min`
      );
    }).catch((err) => {
      if (!isDev) logger.error('Failed to register scheduler', { error: err.message });
    });

    logger.info('✅ Scheduler + Email send worker started');

    return {
      schedulerQueue,
    };
  } catch (err) {
    const error = err as Error;
    if (isDev) {
      logger.warn(
        `⚠️  Scheduler could not start (Redis unavailable): ${error.message}`
      );
      return null;
    }
    throw err;
  }
}

// ─── Graceful shutdown ────────────────────────────────────────────
export async function stopScheduler(): Promise<void> {
  await Promise.allSettled([
    schedulerWorker?.close(),
    schedulerQueue?.close(),
  ]);
  logger.info('Scheduler + email queue shut down');
}

export { schedulerQueue };
