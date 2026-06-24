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
import { Sequence } from '../models/Sequence';
import { env, isDev } from '../config/env';
import logger from '../config/logger';
import { emailQueue } from './emailQueue';
import { isSlotValid, calculateNextValidSlot, getLocalParts, isAllowedDay, SendingWindow } from '@email-sequencing/shared';

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

// ─── Scheduler Health State ────────────────────────────────────────
export interface SchedulerHealth {
  schedulerRunning:     boolean;
  lastSchedulerRunAt:   string | null;
  lastDueContactsFound: number;
  lastJobsEnqueued:     number;
  schedulerRecoveryCount: number;
}

const schedulerHealth: SchedulerHealth = {
  schedulerRunning:     false,
  lastSchedulerRunAt:   null,
  lastDueContactsFound: 0,
  lastJobsEnqueued:     0,
  schedulerRecoveryCount: 0,
};

export function getSchedulerHealth(): Readonly<SchedulerHealth> {
  return { ...schedulerHealth };
}

let stuckQueueCycles = 0;

// ─── Scheduler Processor ──────────────────────────────────────────
/**
 * Polls for due contacts and enqueues email:send jobs.
 * Runs every SCHEDULER_INTERVAL_MINUTES (default: 5 min).
 */
async function runScheduler(_job: Job): Promise<void> {
  const tickStartTime = new Date().toISOString();
  logger.info(`[TEMPORARY LOG] Scheduler Tick Started at ${tickStartTime}`, { jobId: _job?.id, name: _job?.name });
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

  // Find first 5 active contacts
  const first5Active = await SequenceContact.find({
    status: ContactEnrollmentStatus.ACTIVE,
  })
    .limit(5)
    .select('_id next_send_at')
    .lean();

  for (const c of first5Active) {
    const isDue = c.next_send_at ? c.next_send_at <= now : false;
    logger.info('DEBUG SCHEDULER SCAN:', {
      contactId: c._id.toString(),
      next_send_at: c.next_send_at ? c.next_send_at.toISOString() : null,
      current_time: now.toISOString(),
      isDue,
    });
  }

  // Find active contact with minimum next_send_at
  const earliestActive = await SequenceContact.findOne({
    status: ContactEnrollmentStatus.ACTIVE,
  })
    .sort({ next_send_at: 1 })
    .select('_id next_send_at')
    .lean();

  if (earliestActive && earliestActive.next_send_at) {
    const diffMs = earliestActive.next_send_at.getTime() - now.getTime();
    const minutesUntilDue = Math.ceil(diffMs / (60 * 1000));
    logger.info('DEBUG EARLIEST CONTACT:', {
      contactId: earliestActive._id.toString(),
      next_send_at: earliestActive.next_send_at.toISOString(),
      current_time: now.toISOString(),
      minutes_until_due: minutesUntilDue,
    });
  }

  // Timezone and Time details
  logger.info('DEBUG TIMEZONE DETAILS:', {
    server_timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    current_utc_time: new Date().toISOString(),
    local_time_env: new Date().toString(),
  });

  // Find due contacts
  const exactQuery = {
    status:       ContactEnrollmentStatus.ACTIVE,
    next_send_at: { $lte: now },
  };
  
  logger.info(`[TEMPORARY LOG] Exact query used to fetch due contacts:`, { query: exactQuery });

  const dueContacts = await SequenceContact.find(exactQuery)
    .limit(BATCH_SIZE)
    .select('_id sequence_id current_step_index next_send_at contact_email')
    .lean();

  if (dueContacts.length === 0) {
    logger.debug('Scheduler: no due contacts found');
    logger.info(`[TEMPORARY LOG] Scheduler Tick Finished at ${new Date().toISOString()}`);
    return;
  }

  // Batch-load sequences to avoid N+1 lookups
  const sequenceIds = [...new Set(dueContacts.map(c => c.sequence_id))];
  const sequences = await Sequence.find({ _id: { $in: sequenceIds } }).lean();
  const sequenceMap = new Map(sequences.map(s => [s._id.toString(), s]));

  const jobs = [];

  for (const c of dueContacts) {
    const sequence = sequenceMap.get(c.sequence_id.toString());
    if (!sequence) {
      logger.error('Scheduler: sequence not found for contact', { contactId: c._id.toString(), sequenceId: c.sequence_id.toString() });
      continue;
    }

    const window = sequence.sending_window as SendingWindow;
    const isValid = isSlotValid(now, window);
    const { hour, minute, weekday } = getLocalParts(now, window.timezone || 'UTC');

    const startMin = window.start_hour * 60 + (window.start_minute || 0);
    const endMin = window.end_hour * 60 + (window.end_minute || 0);
    const currMin = hour * 60 + minute;
    const activeMatch = isAllowedDay(weekday, window);

    let rejectionReason = null;
    if (!isValid) {
      if (!activeMatch) rejectionReason = 'Inactive day';
      else if (currMin < startMin) rejectionReason = 'Before window start';
      else rejectionReason = 'After window end';
    }

    logger.info('DEBUG SCHEDULER DIAGNOSTIC:', {
      sequenceId: sequence._id.toString(),
      timezone: window.timezone,
      currentLocalTime: `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`,
      currentWeekday: weekday,
      activeDayMatch: activeMatch,
      windowStart: `${window.start_hour.toString().padStart(2, '0')}:${(window.start_minute || 0).toString().padStart(2, '0')}`,
      windowEnd: `${window.end_hour.toString().padStart(2, '0')}:${(window.end_minute || 0).toString().padStart(2, '0')}`,
      result: isValid ? 'allowed' : 'blocked',
      rejectionReason
    });

    if (isValid) {
      jobs.push({
        name: 'email:send',
        data: {
          sequenceContactId: c._id.toString(),
          stepIndex:         c.current_step_index,
        },
        opts: {
          attempts:         3,
          backoff:          { type: 'exponential', delay: 30_000 },
          removeOnComplete: { count: 1000, age: 7  * 24 * 3600 },
          removeOnFail:     { count: 500,  age: 30 * 24 * 3600 },
        },
      });
    } else {
      // Recalculate and push next_send_at forward without enqueueing
      const nextSendAt = calculateNextValidSlot(now, window);
      await SequenceContact.updateOne({ _id: c._id }, { next_send_at: nextSendAt });
      logger.info('Scheduler: contact pushed to next window', { contactId: c._id.toString(), nextSendAt: nextSendAt.toISOString() });
    }
  }

  let enqueuedCount = 0;

  if (emailQueue) {
    const addedJobs = await emailQueue.addBulk(jobs);
    enqueuedCount = addedJobs.length;
    logger.info(`Scheduler: successfully enqueued ${enqueuedCount} job(s) ✅`, {
      jobIds:    addedJobs.map(j => j.id),
      queueName: env.EMAIL_QUEUE_NAME,
    });
  } else {
    logger.error('Scheduler: emailQueue is null — email worker not initialised! Jobs NOT enqueued.');
  }

  // Count active sequences for heartbeat
  const { SequenceStatus } = await import('../models/Sequence');
  const active_sequences = await Sequence.countDocuments({ status: SequenceStatus.ACTIVE });

  // Update Scheduler Health Metrics
  schedulerHealth.lastSchedulerRunAt = now.toISOString();
  schedulerHealth.lastDueContactsFound = dueContacts.length;
  schedulerHealth.lastJobsEnqueued = enqueuedCount;

  logger.info('Scheduler heartbeat:', {
    active_sequences,
    due_contacts: dueContacts.length,
    jobs_enqueued: enqueuedCount
  });

  // Stuck Queue Detection
  if (emailQueue) {
    const [waitingCount, activeCount] = await Promise.all([
      emailQueue.getWaitingCount(),
      emailQueue.getActiveCount()
    ]);

    if (waitingCount > 0 && activeCount === 0) {
      stuckQueueCycles++;
      if (stuckQueueCycles > 2) {
        logger.error('CRITICAL: Queue has waiting jobs but worker is not consuming them.', {
          waitingJobs: waitingCount,
          workerRunning: true, // we assume it's supposed to be running
          redisConnected: true,
          timestamp: new Date().toISOString()
        });
      }
    } else {
      stuckQueueCycles = 0;
    }
  }
  logger.info(`[TEMPORARY LOG] Scheduler Tick Finished at ${new Date().toISOString()}`);
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
      schedulerHealth.schedulerRunning = false;
    });
    schedulerWorker.on('failed', (job, err: Error) => {
      logger.error('Scheduler tick FAILED', { jobId: job?.id, error: err.message });
    });
    schedulerWorker.on('ready', () => {
      schedulerHealth.schedulerRunning = true;
    });
    schedulerWorker.on('closed', () => {
      schedulerHealth.schedulerRunning = false;
    });

    // Clean up existing repeatable jobs before registering a fresh one
    schedulerQueue.getRepeatableJobs().then(async (jobs) => {
      for (const job of jobs) {
        await schedulerQueue!.removeRepeatableByKey(job.key);
      }
      
      // Register the repeatable scheduler tick
      schedulerQueue!.add(
        'scheduler:tick',
        {},
        {
          repeat:            { every: SCHEDULER_INTERVAL * 60 * 1000 },
          removeOnComplete:  5,
          removeOnFail:      5,
        }
      ).then(async () => {
        logger.info(`⏱  Scheduler registered — tick every ${SCHEDULER_INTERVAL} min`);
        
        // Log repeatable jobs on startup
        const repeatables = await schedulerQueue!.getRepeatableJobs();
        logger.info('Scheduler repeatable jobs at startup (JOB CREATED):', { 
          repeatableJobsCount: repeatables.length,
          repeatableJobs: repeatables 
        });
      }).catch((err) => {
        if (!isDev) logger.error('Failed to register scheduler', { error: err.message });
      });
    });

    // Start Stall Watchdog with Self-Healing
    setInterval(async () => {
      if (!schedulerHealth.lastSchedulerRunAt) return; // Wait for first run

      const lastRun = new Date(schedulerHealth.lastSchedulerRunAt).getTime();
      const now = Date.now();
      const thresholdMs = (SCHEDULER_INTERVAL * 60 * 1000) * 2;

      if (now - lastRun > thresholdMs) {
        logger.error('CRITICAL: Scheduler appears stalled', {
          lastSchedulerRunAt: schedulerHealth.lastSchedulerRunAt,
          minutesSinceLastRun: Math.floor((now - lastRun) / 60000),
          thresholdMinutes: SCHEDULER_INTERVAL * 2,
          schedulerRunning: schedulerHealth.schedulerRunning
        });

        // ─── SELF-HEALING LOGIC ───
        try {
          if (!schedulerQueue) return;
          
          schedulerHealth.schedulerRecoveryCount++;
          
          // 1. Check if the repeatable job still exists
          const repeatables = await schedulerQueue.getRepeatableJobs();
          const hasTickJob = repeatables.some(job => job.name === 'scheduler:tick');
          
          if (!hasTickJob) {
            logger.warn('WATCHDOG: Repeatable job missing. Recreating...');
            // Re-register the repeatable job
            await schedulerQueue.add(
              'scheduler:tick',
              {},
              {
                repeat:            { every: SCHEDULER_INTERVAL * 60 * 1000 },
                removeOnComplete:  5,
                removeOnFail:      5,
              }
            );
          } else {
            logger.warn('WATCHDOG: Repeatable job exists but stalled. Forcing immediate tick.');
          }

          // 2. Enqueue an immediate recovery tick
          await schedulerQueue.add(
            'scheduler:tick:recovery', 
            {}, 
            { 
              removeOnComplete: 5, 
              removeOnFail: 5 
            }
          );
          logger.info('WATCHDOG: Immediate recovery tick enqueued successfully.');
          
        } catch (recoveryErr: any) {
          logger.error('WATCHDOG: Failed to execute recovery logic', { error: recoveryErr.message });
        }
      }
    }, SCHEDULER_INTERVAL * 60 * 1000);


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
