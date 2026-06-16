import Redis, { RedisOptions } from 'ioredis';
import logger from './logger';
import { env, isDev } from './env';

const REDIS_TLS = env.REDIS_TLS === 'true';

// ─── Shared options factory ────────────────────────────────────────
// In dev: retryStrategy returns null immediately → no retry loop, no log spam
// In prod: exponential backoff up to 10 retries
function makeOptions(extra: Partial<RedisOptions> = {}): RedisOptions {
  return {
    lazyConnect: true,
    enableReadyCheck: false,
    maxRetriesPerRequest: null, // Required by BullMQ
    retryStrategy(times: number) {
      if (isDev) return null; // Stop retrying silently in dev
      if (times > 10) {
        logger.error('Redis max retry attempts reached — giving up');
        return null;
      }
      const delay = Math.min(times * 1000, 10_000);
      logger.warn(`Redis retry attempt ${times}, reconnecting in ${delay}ms`);
      return delay;
    },
    ...(REDIS_TLS ? { tls: {} } : {}),
    ...extra,
  };
}

// ─── Clients ───────────────────────────────────────────────────────
export const redisClient     = new Redis(env.REDIS_URL, makeOptions());
export const redisSubscriber = new Redis(env.REDIS_URL, makeOptions());

// Also export URL for BullMQ (which bundles its own ioredis internally)
export const BULL_REDIS_URL = env.REDIS_URL;
export const BULL_REDIS_TLS = REDIS_TLS;

// ─── Event listeners ───────────────────────────────────────────────
function attachListeners(client: Redis, name: string): void {
  client.on('connect',     () => logger.info(`✅ Redis [${name}] connecting...`));
  client.on('ready',       () => logger.info(`✅ Redis [${name}] ready`));
  client.on('reconnecting',() => logger.info(`🔄 Redis [${name}] reconnecting`));
  client.on('end',         () => logger.info(`Redis [${name}] connection ended`));
  client.on('close',       () => {
    if (!isDev) logger.warn(`⚠️  Redis [${name}] connection closed`);
  });
  client.on('error', (err: Error) => {
    if (!err?.message) return; // skip empty AggregateError wrappers
    if (isDev)         return; // suppress all Redis errors in dev (expected when not running)
    logger.error(`❌ Redis [${name}] error`, { error: err.message });
  });
}

attachListeners(redisClient,     'primary');
attachListeners(redisSubscriber, 'subscriber');

// ─── Connect ───────────────────────────────────────────────────────
export async function connectRedis(): Promise<void> {
  logger.info('Connecting to Redis...');
  try {
    await Promise.all([
      redisClient.connect(),
      redisSubscriber.connect(),
    ]);
    logger.info('✅ Redis connected');
  } catch {
    if (isDev) {
      logger.warn(
        '⚠️  Redis unavailable — server starting in DEGRADED mode.\n' +
        '   → Queues and caching are disabled until Redis is running.\n' +
        '   → Start Redis:  docker run -d -p 6379:6379 redis:7-alpine'
      );
      return; // non-fatal in dev
    }
    throw new Error('Redis connection failed — cannot start in production without Redis');
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
