import Redis, { RedisOptions } from 'ioredis';
import logger from './logger';
import { env, isDev } from './env';

const REDIS_TLS = env.REDIS_TLS === 'true';

// ─── IPv6 guard ────────────────────────────────────────────────────
// Node resolves `localhost` to ::1 (IPv6) first on Windows.
// Memurai (and most local Redis instances) bind only to 127.0.0.1.
// Forcing 127.0.0.1 avoids ECONNREFUSED on ::1.
function resolveHost(raw: string): string {
  return raw === 'localhost' ? '127.0.0.1' : raw;
}

// Parse REDIS_URL once so all clients share the same resolved coordinates
const _parsedUrl      = new URL(env.REDIS_URL);
export const REDIS_HOST     = resolveHost(_parsedUrl.hostname);
export const REDIS_PORT     = parseInt(_parsedUrl.port || '6379', 10);
export const REDIS_PASSWORD = _parsedUrl.password || undefined;

// Also export URL for BullMQ makeConnection() helpers (they parse it themselves)
export const BULL_REDIS_URL = env.REDIS_URL;
export const BULL_REDIS_TLS = REDIS_TLS;

// ─── Shared options factory ────────────────────────────────────────
// retryStrategy retries with exponential backoff in ALL environments so
// connections recover automatically when Memurai comes back online.
// Previously `isDev → return null` permanently killed the ioredis
// connection on first failure, meaning no recovery was ever possible.
function makeOptions(name: string, extra: Partial<RedisOptions> = {}): RedisOptions {
  return {
    host:                 REDIS_HOST,
    port:                 REDIS_PORT,
    ...(REDIS_PASSWORD ? { password: REDIS_PASSWORD } : {}),
    lazyConnect:          true,
    enableReadyCheck:     false,
    maxRetriesPerRequest: null, // Required by BullMQ
    retryStrategy(times: number) {
      const maxAttempts = isDev ? Infinity : 10; // in prod give up after 10
      if (!isDev && times > maxAttempts) {
        logger.error(`Redis [${name}] max retry attempts reached — giving up`);
        return null;
      }
      const delay = Math.min(times * 500, 30_000);
      logger.warn(`Redis [${name}] reconnect attempt #${times} in ${delay}ms`, {
        host: REDIS_HOST,
        port: REDIS_PORT,
      });
      return delay;
    },
    ...(REDIS_TLS ? { tls: {} } : {}),
    ...extra,
  };
}

// ─── Clients ───────────────────────────────────────────────────────
export const redisClient     = new Redis(makeOptions('primary'));
export const redisSubscriber = new Redis(makeOptions('subscriber'));

// ─── Event listeners ───────────────────────────────────────────────
function attachListeners(client: Redis, name: string): void {
  client.on('connect',      () => logger.info(`✅ Redis [${name}] connecting to ${REDIS_HOST}:${REDIS_PORT}`));
  client.on('ready',        () => logger.info(`✅ Redis [${name}] ready`));
  client.on('reconnecting', () => logger.warn(`🔄 Redis [${name}] reconnecting...`, { host: REDIS_HOST, port: REDIS_PORT }));
  client.on('end',          () => logger.warn(`Redis [${name}] connection ended`));
  client.on('close',        () => logger.warn(`⚠️  Redis [${name}] connection closed`));
  client.on('error', (err: unknown) => {
    // AggregateError wraps multiple errors — log each sub-error for clarity
    const aggregateErr = err as { errors?: Error[]; message?: string; name?: string };
    if (Array.isArray(aggregateErr?.errors)) {
      aggregateErr.errors.forEach((sub: Error, i: number) => {
        logger.error(`❌ Redis [${name}] AggregateError[${i}]`, {
          name:    sub.name,
          message: sub.message,
          code:    (sub as NodeJS.ErrnoException).code,
          host:    REDIS_HOST,
          port:    REDIS_PORT,
          status:  client.status,
        });
      });
      return;
    }
    const e = err as NodeJS.ErrnoException;
    if (!e?.message) return;
    logger.error(`❌ Redis [${name}] error`, {
      name:    e.name,
      message: e.message,
      code:    e.code,
      host:    REDIS_HOST,
      port:    REDIS_PORT,
      status:  client.status,
    });
  });
}

attachListeners(redisClient,     'primary');
attachListeners(redisSubscriber, 'subscriber');

// ─── Connect ───────────────────────────────────────────────────────
export async function connectRedis(): Promise<void> {
  logger.info(`Connecting to Redis at ${REDIS_HOST}:${REDIS_PORT}...`);
  try {
    await Promise.all([
      redisClient.connect(),
      redisSubscriber.connect(),
    ]);
    logger.info('✅ Redis connected');
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    logger.warn('Redis initial connection failed', {
      name:    e.name,
      message: e.message,
      code:    e.code,
      host:    REDIS_HOST,
      port:    REDIS_PORT,
    });
    if (isDev) {
      logger.warn(
        '⚠️  Redis unavailable — server starting in DEGRADED mode.\n' +
        '   → Queues are disabled until Redis/Memurai is running.\n' +
        '   → Start Memurai: Start-Service Memurai\n' +
        '   → Or Docker:     docker run -d -p 6379:6379 redis:7-alpine'
      );
      return; // non-fatal in dev — retryStrategy will reconnect automatically
    }
    throw new Error(
      `Redis connection failed (${e.code ?? e.message}) at ${REDIS_HOST}:${REDIS_PORT} — cannot start in production`
    );
  }
}

// ─── Disconnect ────────────────────────────────────────────────────
export async function disconnectRedis(): Promise<void> {
  try {
    await Promise.all([redisClient.quit(), redisSubscriber.quit()]);
    logger.info('Redis disconnected gracefully');
  } catch {
    // Safe to ignore shutdown errors
  }
}

export default redisClient;
