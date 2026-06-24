import { Request, Response, NextFunction } from 'express';
import { ZodError } from 'zod';
import { MongooseError } from 'mongoose';
import { AppError } from '../utils/AppError';
import { ApiResponse } from '../types';
import logger from '../config/logger';
import { isDev } from '../config/env';

// ─── Global Error Handler ──────────────────────────────────────────
export function errorHandler(
  err: Error,
  req: Request,
  res: Response,
  _next: NextFunction
): void {
  // Log every error with request context
  logger.error('Unhandled error', {
    message: err.message,
    stack: isDev ? err.stack : undefined,
    method: req.method,
    path: req.path,
    ip: req.ip,
    userId: (req as any).user?.userId,
  });

  // ── AppError (operational) ──────────────────────────────────────
  if (err instanceof AppError) {
    const response: ApiResponse = {
      success: false,
      message: err.message,
      ...(err.details && { details: err.details }),
      ...(isDev && { errors: [{ stack: err.stack }] }),
    };
    res.status(err.statusCode).json(response);
    return;
  }

  // ── Zod validation error ────────────────────────────────────────
  if (err instanceof ZodError) {
    const response: ApiResponse = {
      success: false,
      message: 'Validation failed',
      errors: err.issues.map((i) => ({
        field: i.path.join('.'),
        message: i.message,
      })),
    };
    res.status(422).json(response);
    return;
  }

  // ── Mongoose duplicate key error ────────────────────────────────
  if ((err as any).code === 11000) {
    const field = Object.keys((err as any).keyValue || {})[0] || 'field';
    const response: ApiResponse = {
      success: false,
      message: `Duplicate value for ${field} — this ${field} is already taken`,
    };
    res.status(409).json(response);
    return;
  }

  // ── Mongoose validation error ───────────────────────────────────
  if (err instanceof MongooseError && err.name === 'ValidationError') {
    const errors = Object.values((err as any).errors).map((e: any) => ({
      field: e.path,
      message: e.message,
    }));
    const response: ApiResponse = {
      success: false,
      message: 'Database validation failed',
      errors,
    };
    res.status(400).json(response);
    return;
  }

  // ── JWT errors ──────────────────────────────────────────────────
  if (err.name === 'JsonWebTokenError') {
    res.status(401).json({ success: false, message: 'Invalid token' });
    return;
  }
  if (err.name === 'TokenExpiredError') {
    res.status(401).json({ success: false, message: 'Token expired' });
    return;
  }

  // ── Fallback: 500 Internal Server Error ─────────────────────────
  const response: ApiResponse = {
    success: false,
    message: isDev ? err.message : 'Internal server error',
    ...(isDev && { errors: [{ stack: err.stack }] }),
  };
  res.status(500).json(response);
}

// ─── 404 Not Found Handler ─────────────────────────────────────────
export function notFoundHandler(req: Request, res: Response): void {
  const response: ApiResponse = {
    success: false,
    message: `Route not found — ${req.method} ${req.originalUrl}`,
  };
  res.status(404).json(response);
}
