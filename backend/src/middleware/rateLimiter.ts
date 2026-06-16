import rateLimit from 'express-rate-limit';
import { Request, Response } from 'express';
import { env } from '../config/env';
import { ApiResponse } from '../types';

const windowMs = parseInt(env.RATE_LIMIT_WINDOW_MS, 10);
const max = parseInt(env.RATE_LIMIT_MAX_REQUESTS, 10);

// ─── Default API rate limiter ──────────────────────────────────────
export const apiRateLimiter = rateLimit({
  windowMs,
  max,
  standardHeaders: true, // RateLimit-* headers
  legacyHeaders: false,
  message: (_req: Request, res: Response) => {
    const response: ApiResponse = {
      success: false,
      message: `Too many requests — please try again after ${Math.ceil(windowMs / 60000)} minutes`,
    };
    res.status(429).json(response);
  },
  skip: (req) => req.path === '/api/health', // Don't rate-limit health checks
});

// ─── Strict limiter for auth routes ───────────────────────────────
export const authRateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 10,                   // 10 attempts
  standardHeaders: true,
  legacyHeaders: false,
  message: (_req: Request, res: Response) => {
    const response: ApiResponse = {
      success: false,
      message: 'Too many authentication attempts — please wait 15 minutes before trying again',
    };
    res.status(429).json(response);
  },
});

// ─── Email sending limiter ─────────────────────────────────────────
export const emailRateLimiter = rateLimit({
  windowMs: 60 * 60 * 1000, // 1 hour
  max: 50,                   // 50 sends per hour
  standardHeaders: true,
  legacyHeaders: false,
  message: (_req: Request, res: Response) => {
    const response: ApiResponse = {
      success: false,
      message: 'Email send limit reached — please wait before sending more emails',
    };
    res.status(429).json(response);
  },
});
