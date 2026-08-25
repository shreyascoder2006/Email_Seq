// ─── Must be first — validates & loads env before any other import ─
import './config/env';

import http from 'http';
import express, { Application, Request, Response, NextFunction } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import { env } from './config/env';
import { connectDB, disconnectDB } from './config/db';
import { connectRedis, disconnectRedis } from './config/redis';
import { createMailTransporter, verifyMailConnection } from './config/mailer';
import { startEmailWorker, stopEmailWorker, emailQueue } from './queues/emailQueue';
import { startScheduler, stopScheduler } from './queues/schedulerQueue';
import { startImapPoller, stopImapPoller } from './queues/imapPollerQueue';
import { requestLogger } from './middleware/requestLogger';
import { apiRateLimiter } from './middleware/rateLimiter';
import { errorHandler, notFoundHandler } from './middleware/errorHandler';
import { ensureDevUser } from './models/User';
import apiRouter from './routes';
import trackingRouter from './routes/tracking.route';
import logger from './config/logger';

// ─── Helpers (hoisted — used in app.use(helmet) below) ────────────
function isProd(): boolean {
  return env.NODE_ENV === 'production';
}

function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

// ─── Create Express app ────────────────────────────────────────────
const app: Application = express();

// Trust reverse proxy (Nginx) headers for accurate client IP and rate-limiting
app.set('trust proxy', 1);

// ─── Security middleware ───────────────────────────────────────────
app.use(
  helmet({
    contentSecurityPolicy: isProd(),
    crossOriginEmbedderPolicy: false,
  })
);

app.use(
  cors({
    origin: (origin, callback) => {
      const allowedOrigins = env.CORS_ORIGIN.split(',').map((o) => o.trim());
      // Allow requests with no origin (e.g. mobile apps, Postman, curl)
      if (!origin || allowedOrigins.includes(origin) || allowedOrigins.includes('*')) {
        callback(null, true);
      } else {
        callback(new Error(`CORS: Origin ${origin} not allowed`));
      }
    },
    credentials: env.CORS_CREDENTIALS === 'true',
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-ID'],
    exposedHeaders: ['X-Request-ID', 'RateLimit-Limit', 'RateLimit-Remaining'],
  })
);

// ─── General middleware ────────────────────────────────────────────
app.use(compression());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(requestLogger);

// ─── Request ID middleware ─────────────────────────────────────────
app.use((req: Request, res: Response, next: NextFunction) => {
  const requestId = (req.headers['x-request-id'] as string) || generateRequestId();
  req.headers['x-request-id'] = requestId;
  res.setHeader('X-Request-ID', requestId);
  next();
});

// ─── Rate limiting ─────────────────────────────────────────────────
app.use(apiRateLimiter);

// ─── Tracking Routes (No Auth, No /api prefix) ────────────────────
app.use('/', trackingRouter);

// ─── API Routes ────────────────────────────────────────────────────
app.use(env.API_PREFIX, apiRouter);

// ─── Root redirect ─────────────────────────────────────────────────
app.get('/', (_req: Request, res: Response) => {
  res.json({
    name: 'Email Sequencing Module API',
    version: '1.0.0',
    docs: `${env.API_PREFIX}/health`,
    environment: env.NODE_ENV,
  });
});

// ─── 404 Handler ──────────────────────────────────────────────────
app.use(notFoundHandler);

// ─── Global Error Handler (must be last) ──────────────────────────
app.use(errorHandler);



// ─── Graceful Shutdown ─────────────────────────────────────────────
async function gracefulShutdown(signal: string): Promise<void> {
  logger.info(`\n📴 ${signal} received — shutting down gracefully...`);

  // Stop accepting new connections
  server.close(async () => {
    logger.info('HTTP server closed');

    try {
      await Promise.all([
        stopEmailWorker(),
        stopScheduler(),
        stopImapPoller(),
        emailQueue.close(),
        disconnectDB(),
        disconnectRedis(),
      ]);
      logger.info('✅ All connections closed — process exiting');
      process.exit(0);
    } catch (err) {
      logger.error('Error during shutdown', { error: (err as Error).message });
      process.exit(1);
    }
  });

  // Force exit after 15s if graceful shutdown stalls
  setTimeout(() => {
    logger.error('💀 Forced shutdown after timeout');
    process.exit(1);
  }, 15_000);
}

// ─── Process signal handlers ───────────────────────────────────────
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('SIGINT', () => gracefulShutdown('SIGINT'));

process.on('unhandledRejection', (reason, promise) => {
  logger.error('Unhandled Promise Rejection', { reason, promise });
});

process.on('uncaughtException', (err) => {
  logger.error('Uncaught Exception — process will exit', { error: err.message, stack: err.stack });
  process.exit(1);
});

// ─── Bootstrap ────────────────────────────────────────────────────
async function bootstrap(): Promise<void> {
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  logger.info('  🚀 Email Sequencing Module — Starting up...');
  logger.info(`  Environment : ${env.NODE_ENV}`);
  logger.info(`  Port        : ${env.PORT}`);
  logger.info(`  API Prefix  : ${env.API_PREFIX}`);
  logger.info('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');

  // Connect to services
  await connectDB();
  await connectRedis();

  // ─── Dev user compatibility ─────────────────────────────────────
  // Ensures the hardcoded mock-auth dev user (507f1f77bcf86cd799439011)
  // has a User document with plan='free' before any billing endpoint
  // can reference it. No-op in production. Does not modify auth logic.
  await ensureDevUser();

  // Verify SMTP (non-blocking — warns but doesn't crash)
  createMailTransporter();
  verifyMailConnection(); // fire-and-forget

  // Start BullMQ workers & scheduler
  startEmailWorker();
  startScheduler();
  startImapPoller();

  // Start HTTP server
  server.listen(parseInt(env.PORT, 10), () => {
    logger.info(`\n✅ Server listening on http://localhost:${env.PORT}`);
    logger.info(`   Health check → http://localhost:${env.PORT}${env.API_PREFIX}/health`);
    logger.info(`   Ping         → http://localhost:${env.PORT}${env.API_PREFIX}/health/ping\n`);
  });
}

// ─── HTTP Server ───────────────────────────────────────────────────
const server = http.createServer(app);

// ─── Start ────────────────────────────────────────────────────────
bootstrap().catch((err) => {
  logger.error('💀 Fatal error during bootstrap', {
    error: (err as Error).message,
    stack: (err as Error).stack,
  });
  process.exit(1);
});

export { app };

