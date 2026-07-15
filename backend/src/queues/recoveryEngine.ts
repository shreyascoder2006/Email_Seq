/**
 * src/queues/recoveryEngine.ts
 *
 * Root-cause diagnosis and automatic recovery for BullMQ workers.
 *
 * Architecture decision: The watchdog runs inside the process and monitors
 * local Worker instances. In a multi-instance deployment, each process has
 * its own watchdog. This is correct — each process is responsible for
 * recovering its own Worker instances. The distributed lock in runScheduler()
 * prevents duplicate processing regardless of how many instances run.
 *
 * Recovery strategy (sequential, stops at first successful fix):
 *   1. Redis down          → log, wait — cannot recover from app level
 *   2. Worker paused       → worker.resume()
 *   3. Worker closed/null  → recreate Worker with fresh connection
 *   4. Repeatable job gone → re-register it
 *   5. All OK but stale    → force immediate tick
 *   6. > MAX_RECOVERY_ATTEMPTS in 1h → set UNHEALTHY, stop trying
 */

import logger from '../config/logger';
import redisClient from '../config/redis';
import { env } from '../config/env';
import {
  getHeartbeatAgeMs,
  getLastSchedulerTick,
  incrementRecoveryCount,
  getRecoveryCount,
  setInfraStatus,
  publishHeartbeat,
} from './infraState';

// ─── Types ─────────────────────────────────────────────────────────
export type RecoveryReason =
  | 'redis_down'
  | 'worker_paused'
  | 'worker_closed'
  | 'worker_null'
  | 'repeatable_job_missing'
  | 'heartbeat_stale'
  | 'healthy'
  | 'max_recovery_exceeded';

export interface DiagnosticReport {
  redis:          { healthy: boolean; pingMs: number | null };
  schedulerWorker: {
    exists:          boolean;
    paused:          boolean;
    closing:         boolean;
    heartbeatAgeMs:  number;
    stale:           boolean;
  };
  repeatableJob:  { exists: boolean; nextRun: string | null };
  lastTickAgeMs:  number;
  recoveryCount:  number;
  verdict:        RecoveryReason;
}

export interface RecoveryResult {
  action:  RecoveryReason;
  success: boolean;
  message: string;
}

// ─── Constants ─────────────────────────────────────────────────────
const HEARTBEAT_STALE_MS   = 60_000;   // DEGRADED if worker silent > 60s
const TICK_STALE_MS        = 15 * 60_000; // 15 min — 3× the default 5-min interval
const MAX_RECOVERY_ATTEMPTS = 5;        // After 5 failures in 1h → UNHEALTHY

// ─── Recovery Engine ───────────────────────────────────────────────
export class RecoveryEngine {
  private watchdogTimer: ReturnType<typeof setInterval> | null = null;
  private redisOfflineSince: number | null = null;

  // These are injected from schedulerQueue.ts after initialization
  private getSchedulerWorker: () => import('bullmq').Worker | null;
  private getSchedulerQueue:  () => import('bullmq').Queue  | null;
  private recreateSchedulerWorker: () => Promise<void>;
  private schedIntervalMs: number;

  constructor(opts: {
    getSchedulerWorker:      () => import('bullmq').Worker | null;
    getSchedulerQueue:       () => import('bullmq').Queue  | null;
    recreateSchedulerWorker: () => Promise<void>;
    schedIntervalMs:         number;
  }) {
    this.getSchedulerWorker      = opts.getSchedulerWorker;
    this.getSchedulerQueue       = opts.getSchedulerQueue;
    this.recreateSchedulerWorker = opts.recreateSchedulerWorker;
    this.schedIntervalMs         = opts.schedIntervalMs;
  }

  // ─── Diagnostics ─────────────────────────────────────────────────

  async runDiagnostics(): Promise<DiagnosticReport> {
    // 1. Redis ping
    let redisPingMs: number | null = null;
    let redisHealthy = false;
    try {
      const t0 = Date.now();
      await redisClient.ping();
      redisPingMs = Date.now() - t0;
      redisHealthy = true;
      this.redisOfflineSince = null; // Reset offline tracker
    } catch { 
      if (this.redisOfflineSince === null) {
        this.redisOfflineSince = Date.now();
      }
    }

    // 2. Worker state
    const worker  = this.getSchedulerWorker();
    const hbAge   = await getHeartbeatAgeMs('scheduler-worker');
    const isStale = hbAge > HEARTBEAT_STALE_MS;

    // 3. Repeatable job
    const queue = this.getSchedulerQueue();
    let repeatableExists = false;
    let nextRun: string | null = null;
    if (queue && redisHealthy) {
      try {
        const jobs = await queue.getRepeatableJobs();
        const tick = jobs.find(j => j.name === 'scheduler:tick');
        if (tick) {
          repeatableExists = true;
          nextRun = tick.next ? new Date(tick.next).toISOString() : null;
        }
      } catch { /* ignore */ }
    }

    // 4. Last tick age
    const lastTickStr = await getLastSchedulerTick();
    const lastTickAgeMs = lastTickStr
      ? Date.now() - new Date(lastTickStr).getTime()
      : Infinity;

    // 5. Recovery count
    const recoveryCount = await getRecoveryCount();

    // 6. Verdict
    let verdict: RecoveryReason = 'healthy';
    if (recoveryCount >= MAX_RECOVERY_ATTEMPTS) {
      verdict = 'max_recovery_exceeded';
    } else if (!redisHealthy) {
      verdict = 'redis_down';
    } else if (!worker) {
      verdict = 'worker_null';
    } else if (!!(worker?.closing)) {
      verdict = 'worker_closed';
    } else if (worker?.isPaused()) {
      verdict = 'worker_paused';
    } else if (!repeatableExists) {
      verdict = 'repeatable_job_missing';
    } else if (isStale || lastTickAgeMs > TICK_STALE_MS) {
      verdict = 'heartbeat_stale';
    }

    return {
      redis:          { healthy: redisHealthy, pingMs: redisPingMs },
      schedulerWorker: {
        exists:         !!worker,
        paused:         worker?.isPaused() ?? false,
        closing:        !!(worker?.closing),
        heartbeatAgeMs: hbAge === Infinity ? -1 : hbAge,
        stale:          isStale,
      },
      repeatableJob:  { exists: repeatableExists, nextRun },
      lastTickAgeMs:  lastTickAgeMs === Infinity ? -1 : lastTickAgeMs,
      recoveryCount,
      verdict,
    };
  }

  // ─── Recovery ────────────────────────────────────────────────────

  async recoverScheduler(): Promise<RecoveryResult> {
    const report = await this.runDiagnostics();

    logger.warn('[RECOVERY] Scheduler stall detected — running diagnosis', {
      verdict:        report.verdict,
      recoveryCount:  report.recoveryCount,
      lastTickAgeMs:  report.lastTickAgeMs,
      heartbeatAgeMs: report.schedulerWorker.heartbeatAgeMs,
    });

    if (report.verdict === 'max_recovery_exceeded') {
      logger.error('[RECOVERY] Max recovery attempts exceeded — entering UNHEALTHY mode', {
        recoveryCount: report.recoveryCount,
      });
      await setInfraStatus('UNHEALTHY');
      return { action: 'max_recovery_exceeded', success: false, message: 'Max recovery attempts reached. Manual intervention required.' };
    }

    if (report.verdict === 'healthy') {
      return { action: 'healthy', success: true, message: 'Scheduler is healthy — no recovery needed.' };
    }

    const count = await incrementRecoveryCount();
    logger.warn(`[RECOVERY] Recovery attempt #${count}`, { verdict: report.verdict });
    await setInfraStatus(count >= MAX_RECOVERY_ATTEMPTS ? 'UNHEALTHY' : 'DEGRADED');

    try {
      switch (report.verdict) {
        case 'redis_down':
          const maxOfflineMs = parseInt(env.QUEUE_MAX_OFFLINE_MS, 10);
          const offlineDurationMs = this.redisOfflineSince ? Date.now() - this.redisOfflineSince : 0;
          
          if (offlineDurationMs > maxOfflineMs) {
            logger.error(`[RECOVERY] Redis has been offline for ${Math.round(offlineDurationMs / 1000)}s (exceeds ${maxOfflineMs}ms). Restarting process to trigger fresh recovery.`);
            process.exit(1);
          }
          
          logger.warn(`[RECOVERY] Redis is down (offline for ${Math.round(offlineDurationMs / 1000)}s) — cannot recover from app level. Waiting for reconnect.`);
          return { action: 'redis_down', success: false, message: 'Redis unavailable. Recovery deferred until Redis reconnects.' };

        case 'worker_paused': {
          const worker = this.getSchedulerWorker();
          if (worker) await worker.resume();
          logger.info('[RECOVERY] Scheduler Worker resumed from paused state.');
          return { action: 'worker_paused', success: true, message: 'Worker resumed.' };
        }

        case 'worker_null':
        case 'worker_closed': {
          await this.recreateSchedulerWorker();
          logger.info('[RECOVERY] Scheduler Worker recreated with fresh Redis connection.');
          return { action: report.verdict, success: true, message: 'Worker recreated.' };
        }

        case 'repeatable_job_missing': {
          const queue = this.getSchedulerQueue();
          if (queue) {
            await queue.add('scheduler:tick', {}, {
              repeat:           { every: this.schedIntervalMs },
              removeOnComplete: 5,
              removeOnFail:     5,
            });
            logger.info('[RECOVERY] Repeatable scheduler job re-registered.');
          }
          return { action: 'repeatable_job_missing', success: true, message: 'Repeatable job re-registered.' };
        }

        case 'heartbeat_stale': {
          const queue = this.getSchedulerQueue();
          if (queue) {
            await queue.add('scheduler:tick:recovery', {}, { removeOnComplete: 5, removeOnFail: 5 });
            logger.info('[RECOVERY] Immediate recovery tick enqueued (worker alive but idle).');
          }
          return { action: 'heartbeat_stale', success: true, message: 'Recovery tick enqueued.' };
        }
      }
    } catch (err) {
      logger.error('[RECOVERY] Recovery action failed', {
        verdict: report.verdict,
        error:   (err as Error).message,
      });
      return { action: report.verdict, success: false, message: (err as Error).message };
    }

    return { action: 'healthy', success: true, message: 'No action taken.' };
  }

  // ─── Watchdog ────────────────────────────────────────────────────

  /**
   * Start the stall watchdog. Fires at 1.5× the scheduler interval to
   * detect a missed tick. Replaces the ad-hoc setInterval in schedulerQueue.ts.
   */
  startWatchdog(): void {
    if (this.watchdogTimer) return; // already running

    const watchdogIntervalMs = this.schedIntervalMs * 1.5;
    logger.info('[RECOVERY] Watchdog started', {
      checkIntervalMs: watchdogIntervalMs,
      tickStaleAfterMs: TICK_STALE_MS,
    });

    this.watchdogTimer = setInterval(async () => {
      try {
        const report = await this.runDiagnostics();
        if (report.verdict === 'healthy') return; // All good — no log noise

        const result = await this.recoverScheduler();
        logger.warn('[RECOVERY] Watchdog triggered recovery', {
          verdict: report.verdict,
          action:  result.action,
          success: result.success,
        });
      } catch (err) {
        logger.error('[RECOVERY] Watchdog internal error', { error: (err as Error).message });
      }
    }, watchdogIntervalMs);
  }

  stopWatchdog(): void {
    if (this.watchdogTimer) {
      clearInterval(this.watchdogTimer);
      this.watchdogTimer = null;
      logger.info('[RECOVERY] Watchdog stopped');
    }
  }

  /**
   * Public diagnostics accessor for the health API.
   */
  async getDiagnosticReport(): Promise<DiagnosticReport> {
    return this.runDiagnostics();
  }
}

// Singleton instance, initialized by schedulerQueue.ts
let recoveryEngine: RecoveryEngine | null = null;

export function setRecoveryEngine(engine: RecoveryEngine): void {
  recoveryEngine = engine;
}

export function getRecoveryEngine(): RecoveryEngine | null {
  return recoveryEngine;
}
