import Redis, { RedisOptions } from 'ioredis';
import logger from './logger';
import { env, isDev } from './env';

const REDIS_TLS = env.REDIS_TLS === 'true';

// ─── IPv6 guard ────────────────────────────────────────────────────
function resolveHost(raw: string): string {
  return raw === 'localhost' ? '127.0.0.1' : raw;
}

const _parsedUrl      = new URL(env.REDIS_URL);
export const REDIS_HOST     = resolveHost(_parsedUrl.hostname);
export const REDIS_PORT     = parseInt(_parsedUrl.port || '6379', 10);
export const REDIS_PASSWORD = _parsedUrl.password || undefined;

export const BULL_REDIS_URL = env.REDIS_URL;
export const BULL_REDIS_TLS = REDIS_TLS;

// ─── Shared options factory ────────────────────────────────────────
let lastRetryLog = 0;

function makeOptions(name: string, extra: Partial<RedisOptions> = {}): RedisOptions {
  return {
    host:                 REDIS_HOST,
    port:                 REDIS_PORT,
    ...(REDIS_PASSWORD ? { password: REDIS_PASSWORD } : {}),
    lazyConnect:          true,
    enableReadyCheck:     false,
    maxRetriesPerRequest: null,
    retryStrategy(times: number) {
      const maxAttempts = isDev ? Infinity : 10;
      if (!isDev && times > maxAttempts) {
        logger.error(`Redis [${name}] max retry attempts reached`);
        return null;
      }
      const delay = Math.min(times * 500, 30_000);
      
      const now = Date.now();
      if (now - lastRetryLog > 5000) {
        logger.warn(`Redis [${name}] reconnect attempt #${times} in ${delay}ms`);
        lastRetryLog = now;
      }
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
  let isLost = false;

  client.on('connect',      () => logger.info(`✅ Redis [${name}] connecting`));
  client.on('ready',        () => {
    if (isLost) logger.info(`✅ Redis [${name}] connection restored`);
    isLost = false;
    logger.info(`✅ Redis [${name}] ready`);
  });
  client.on('reconnecting', () => {
    isLost = true;
    logger.warn(`🔄 Redis [${name}] reconnecting...`);
  });
  client.on('close',        () => {
    if (!isLost) logger.warn(`⚠️  Redis [${name}] connection closed`);
  });
  client.on('error', (err: unknown) => {
    const e = err as any;
    logger.error(`❌ Redis [${name}] error: ${e.message}`, { code: e.code });
  });
}

attachListeners(redisClient,     'primary');
attachListeners(redisSubscriber, 'subscriber');

// ─── Helpers ───────────────────────────────────────────────────────
export async function redisWithTimeout<T>(operation: Promise<T>, timeoutMs = 5000): Promise<T> {
  let timer: NodeJS.Timeout;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error('Redis operation timed out')), timeoutMs);
  });
  return Promise.race([operation, timeout]).finally(() => clearTimeout(timer)) as Promise<T>;
}

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
        '   → Queues are disabled until Redis/Memurai is running.'
      );
      return;
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
