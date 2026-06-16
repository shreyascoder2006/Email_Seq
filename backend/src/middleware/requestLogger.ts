import morgan, { StreamOptions } from 'morgan';
import logger from '../config/logger';
import { isDev } from '../config/env';

// ─── Pipe morgan output through Winston ───────────────────────────
const stream: StreamOptions = {
  write: (message: string) => {
    logger.http(message.trim());
  },
};

// ─── Skip logging for health checks (reduce noise) ─────────────────
const skip = (_req: any) => {
  const path: string = _req.path || '';
  return path === '/api/health';
};

// ─── Format: verbose in dev, combined in production ─────────────────
const format = isDev
  ? ':method :url :status :res[content-length]B - :response-time ms'
  : 'combined';

export const requestLogger = morgan(format, { stream, skip });
