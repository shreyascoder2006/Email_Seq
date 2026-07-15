import { z } from 'zod';
import dotenv from 'dotenv';
import path from 'path';

// Load .env from backend root
dotenv.config({ path: path.resolve(process.cwd(), '.env') });

// ─── Schema ───────────────────────────────────────────────────────
const envSchema = z.object({
  // Server
  PORT: z.string().default('5000'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  API_PREFIX: z.string().default('/api'),
  APP_BASE_URL: z.string().url().default('http://localhost:5000'),

  // MongoDB
  MONGO_URI: z.string().min(1, 'MONGO_URI is required'),
  MONGO_MAX_POOL_SIZE: z.string().default('10'),

  // Redis
  REDIS_URL: z.string().min(1, 'REDIS_URL is required'),
  REDIS_TLS: z.string().default('false'),

  // JWT
  JWT_SECRET: z.string().min(32, 'JWT_SECRET must be at least 32 characters'),
  JWT_EXPIRES_IN: z.string().default('7d'),
  JWT_REFRESH_SECRET: z.string().min(32, 'JWT_REFRESH_SECRET must be at least 32 characters'),
  JWT_REFRESH_EXPIRES_IN: z.string().default('30d'),

  // Unsubscribe token signing secret (optional — falls back to JWT_SECRET)
  UNSUBSCRIBE_SECRET: z.string().min(32).optional(),

  // Encryption
  ENCRYPTION_KEY: z.string().length(32, 'ENCRYPTION_KEY must be exactly 32 characters'),

  // SMTP
  SMTP_HOST: z.string().default('smtp.gmail.com'),
  SMTP_PORT: z.string().default('587'),
  SMTP_SECURE: z.string().default('false'),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  SMTP_FROM_NAME: z.string().default('Email Sequencing'),
  SMTP_FROM_EMAIL: z.string().email().optional(),

  // Queue
  QUEUE_CONCURRENCY: z.string().default('5'),
  EMAIL_QUEUE_NAME: z.string().default('email-sequence'),
  RETRY_ATTEMPTS: z.string().default('3'),
  RETRY_BACKOFF_DELAY: z.string().default('5000'),

  // Scheduler
  SCHEDULER_INTERVAL_MINUTES: z.string().default('5'),
  SCHEDULER_BATCH_SIZE: z.string().default('50'),
  QUEUE_MAX_OFFLINE_MS: z.string().default('180000'), // 3 minutes

  // Rate Limiting
  RATE_LIMIT_WINDOW_MS: z.string().default('900000'),
  RATE_LIMIT_MAX_REQUESTS: z.string().default('500'),

  // CORS
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  CORS_CREDENTIALS: z.string().default('true'),

  // OAuth
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  GOOGLE_REDIRECT_URI: z.string().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_REDIRECT_URI: z.string().optional(),

  // Logging
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly']).default('debug'),
  LOG_DIR: z.string().default('logs'),

  // Frontend
  FRONTEND_URL: z.string().default('http://localhost:5173'),
});

// ─── Parse & validate ─────────────────────────────────────────────
const _parsed = envSchema.safeParse(process.env);

if (!_parsed.success) {
  console.error('\n❌ Invalid environment variables:\n');
  _parsed.error.issues.forEach((issue) => {
    console.error(`  • ${issue.path.join('.')}: ${issue.message}`);
  });
  console.error('\nPlease check your .env file against .env.example\n');
  process.exit(1);
}

export const env = _parsed.data;

// ─── Derived helpers ──────────────────────────────────────────────
export const isDev = env.NODE_ENV === 'development';
export const isProd = env.NODE_ENV === 'production';
export const isTest = env.NODE_ENV === 'test';
