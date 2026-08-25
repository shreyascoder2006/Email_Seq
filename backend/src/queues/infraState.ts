/**
 * src/queues/infraState.ts
 *
 * Redis-backed infrastructure state store.
 *
 * Replaces all in-memory worker health objects with Redis keys so that
 * state is visible across multiple Node.js instances (PM2, Docker, K8s).
 *
 * Keys (all namespaced under `esm:` = email sequencing module):
 *   esm:heartbeat:{name}         → JSON blob, TTL 60 s (refreshed every ~10 s)
 *   esm:lock:scheduler           → instanceId string, TTL 55 s (distributed mutex)
 *   esm:scheduler:last_tick      → ISO timestamp, no TTL
 *   esm:scheduler:recovery_count → integer, TTL 3600 s
 *   esm:scheduler:status         → "HEALTHY" | "DEGRADED" | "UNHEALTHY", no TTL
 */

import redisClient from '../config/redis';
import logger from '../config/logger';
import { v4 as uuidv4 } from 'uuid';
import os from 'os';

// ─── Constants ─────────────────────────────────────────────────────
const NS = 'esm';
const HEARTBEAT_TTL_S  = 60;   // Keys expire after 60 s if not refreshed
const LOCK_TTL_MS      = 55_000; // Distributed lock TTL (< scheduler interval)
const WATCHDOG_TTL_S   = 3600;  // Reset watchdog attempts after 1 hour

// Unique ID for this process instance (used in distributed lock)
export const INSTANCE_ID = `${os.hostname()}-${process.pid}-${uuidv4().slice(0, 8)}`;

// ─── Types ─────────────────────────────────────────────────────────
export interface HeartbeatData {
  name:              string;
  instanceId:        string;
  timestamp:         string;
  lastJobStarted:    string | null;
  lastJobCompleted:  string | null;
  lastJobFailed:     string | null;
  extra?:            Record<string, unknown>;
}

export type InfraStatus = 'HEALTHY' | 'DEGRADED' | 'UNHEALTHY';

// ─── Heartbeat ─────────────────────────────────────────────────────

/**
 * Publish a heartbeat for a named worker. Called every ~10 s from
 * the worker's `active` / `completed` / `failed` lifecycle events.
 * Stored in Redis with a TTL so stale heartbeats expire automatically.
 */
export async function publishHeartbeat(name: string, data: Omit<HeartbeatData, 'name' | 'instanceId' | 'timestamp'>): Promise<void> {
  try {
    const payload: HeartbeatData = {
      name,
      instanceId: INSTANCE_ID,
      timestamp:  new Date().toISOString(),
      ...data,
    };
    await redisClient.set(
      `${NS}:heartbeat:${name}`,
      JSON.stringify(payload),
      'EX', HEARTBEAT_TTL_S
    );
  } catch (err) {
    // Non-fatal: heartbeat failure must never crash the worker
    logger.warn(`[INFRA-STATE] Failed to publish heartbeat for ${name}`, {
      error: (err as Error).message,
    });
  }
}

/**
 * Read the latest heartbeat for a named worker.
 * Returns null if the key has expired (worker has been silent for > 60 s).
 */
export async function getHeartbeat(name: string): Promise<HeartbeatData | null> {
  try {
    const raw = await redisClient.get(`${NS}:heartbeat:${name}`);
    if (!raw) return null;
    return JSON.parse(raw) as HeartbeatData;
  } catch {
    return null;
  }
}

/**
 * Returns milliseconds since the last heartbeat, or Infinity if no heartbeat exists.
 */
export async function getHeartbeatAgeMs(name: string): Promise<number> {
  const hb = await getHeartbeat(name);
  if (!hb) return Infinity;
  return Date.now() - new Date(hb.timestamp).getTime();
}

/**
 * Returns true if the heartbeat is older than thresholdMs.
 */
export async function isHeartbeatStale(name: string, thresholdMs: number): Promise<boolean> {
  const age = await getHeartbeatAgeMs(name);
  return age > thresholdMs;
}

// ─── Distributed Lock ───────────────────────────────────────────────

/**
 * Acquire the scheduler distributed lock using Redis SET NX PX.
 * Returns true if the lock was acquired (this instance should proceed).
 * Returns false if another instance holds the lock (skip this tick).
 *
 * This prevents two Node.js processes from running runScheduler()
 * simultaneously, which would cause duplicate DB writes.
 */
export async function acquireSchedulerLock(): Promise<boolean> {
  try {
    // Use the options-object overload: set(key, value, { nx: true, px: ms })
    // The positional overload (set key val NX PX ms) fails strict TS due to enum ordering.
    const result = await (redisClient as any).call(
      'SET', `${NS}:lock:scheduler`, INSTANCE_ID, 'NX', 'PX', String(LOCK_TTL_MS)
    );
    return result === 'OK';
  } catch (err) {
    logger.warn('[INFRA-STATE] Failed to acquire scheduler lock — skipping tick', {
      error: (err as Error).message,
    });
    return false;
  }
}

/**
 * Release the scheduler lock — only if we still own it.
 * Uses a Lua script for atomic check-and-delete (prevents releasing
 * another instance's lock if ours expired and was re-acquired).
 */
export async function releaseSchedulerLock(): Promise<void> {
  const luaScript = `
    if redis.call('get', KEYS[1]) == ARGV[1] then
      return redis.call('del', KEYS[1])
    else
      return 0
    end
  `;
  try {
    await (redisClient as any).eval(luaScript, 1, `${NS}:lock:scheduler`, INSTANCE_ID);
  } catch (err) {
    logger.warn('[INFRA-STATE] Failed to release scheduler lock', {
      error: (err as Error).message,
    });
  }
}

// ─── Scheduler Tick State ───────────────────────────────────────────

/**
 * Record the timestamp of a successful scheduler tick.
 * Stored without TTL — persists across restarts.
 */
export async function recordSchedulerTick(): Promise<void> {
  try {
    await redisClient.set(`${NS}:scheduler:last_tick`, new Date().toISOString());
  } catch (err) {
    logger.warn('[INFRA-STATE] Failed to record scheduler tick', { error: (err as Error).message });
  }
}

/**
 * Get the timestamp of the last successful scheduler tick.
 */
export async function getLastSchedulerTick(): Promise<string | null> {
  try {
    return await redisClient.get(`${NS}:scheduler:last_tick`);
  } catch {
    return null;
  }
}

// ─── Watchdog Attempts ───────────────────────────────────────────────

/**
 * Increment the scheduler watchdog attempt counter.
 * Counter resets automatically after WATCHDOG_TTL_S seconds (1 hour).
 * Returns the new count.
 */
export async function incrementWatchdogAttempts(): Promise<number> {
  try {
    const key = `${NS}:scheduler:watchdog_attempts`;
    const count = await redisClient.incr(key);
    if (count === 1) {
      // Set TTL only on first increment (so it resets after 1 hour of quiet)
      await redisClient.expire(key, WATCHDOG_TTL_S);
    }
    return count;
  } catch {
    return 0;
  }
}

/**
 * Get the current watchdog attempt count.
 */
export async function getWatchdogAttempts(): Promise<number> {
  try {
    const val = await redisClient.get(`${NS}:scheduler:watchdog_attempts`);
    return val ? parseInt(val, 10) : 0;
  } catch {
    return 0;
  }
}

// ─── Overall Infra Status ───────────────────────────────────────────

/**
 * Set the overall infrastructure status. Persists in Redis.
 */
export async function setInfraStatus(status: InfraStatus): Promise<void> {
  try {
    await redisClient.set(`${NS}:scheduler:status`, status);
  } catch {
    // Non-fatal
  }
}

/**
 * Get the overall infrastructure status.
 */
export async function getInfraStatus(): Promise<InfraStatus> {
  try {
    const val = await redisClient.get(`${NS}:scheduler:status`);
    return (val as InfraStatus) ?? 'HEALTHY';
  } catch {
    return 'HEALTHY';
  }
}
