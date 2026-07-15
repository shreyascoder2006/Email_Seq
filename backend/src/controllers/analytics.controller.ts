import { Response, NextFunction } from 'express';
import { analyticsService } from '../services/analytics.service';
import { AuthenticatedRequest } from '../types';
import { sendSuccess } from '../utils/response';
import { AppError } from '../utils/AppError';
import type { AnalyticsFilterInput, RecipientFilterInput, SenderFilterInput } from '../services/analytics.filters';

function getUserId(req: AuthenticatedRequest): string {
  if (!req.user?.userId) throw AppError.unauthorized();
  return req.user.userId;
}

/** Parse common analytics query params into AnalyticsFilterInput */
function parseAnalyticsFilter(req: AuthenticatedRequest): AnalyticsFilterInput {
  const q = req.query as Record<string, string>;
  return {
    from:       q.from       || undefined,
    to:         q.to         || undefined,
    senderId:   q.senderId   || undefined,
    sequenceId: q.sequenceId || undefined,
    status:     q.status     || undefined,
  };
}

/** Parse recipient-specific query params */
function parseRecipientFilter(req: AuthenticatedRequest): RecipientFilterInput {
  const q = req.query as Record<string, string>;
  return {
    search:      q.search   || undefined,
    status:      q.status   || undefined,
    currentStep: q.currentStep !== undefined ? parseInt(q.currentStep, 10) : undefined,
    sortBy:      (q.sortBy as RecipientFilterInput['sortBy']) || undefined,
    sortDir:     (q.sortDir as 'asc' | 'desc') || undefined,
    page:        q.page  ? parseInt(q.page,  10) : undefined,
    limit:       q.limit ? parseInt(q.limit, 10) : undefined,
  };
}

/** Parse sender-specific query params */
function parseSenderFilter(req: AuthenticatedRequest): SenderFilterInput {
  const q = req.query as Record<string, string>;
  return {
    health: q.health || undefined,
    status: q.status || undefined,
    search: q.search || undefined,
  };
}

// ─── Legacy endpoints (preserved, backward-compatible) ────────────────────────

export async function getOverview(
  req: AuthenticatedRequest, res: Response, next: NextFunction
): Promise<void> {
  try {
    const filter = parseAnalyticsFilter(req);
    sendSuccess(res, await analyticsService.getOverviewMetrics(getUserId(req), filter), 'Overview metrics retrieved');
  } catch (err) { next(err); }
}

export async function getTimeseries(
  req: AuthenticatedRequest, res: Response, next: NextFunction
): Promise<void> {
  try {
    const filter = parseAnalyticsFilter(req);
    sendSuccess(res, await analyticsService.getTimeseries(getUserId(req), filter), 'Timeseries data retrieved');
  } catch (err) { next(err); }
}

export async function getSequences(
  req: AuthenticatedRequest, res: Response, next: NextFunction
): Promise<void> {
  try {
    sendSuccess(res, await analyticsService.getSequenceAnalytics(getUserId(req)), 'Sequence analytics retrieved');
  } catch (err) { next(err); }
}

export async function getActivity(
  req: AuthenticatedRequest, res: Response, next: NextFunction
): Promise<void> {
  try {
    const userId = getUserId(req);
    const limit      = req.query.limit      ? parseInt(req.query.limit as string, 10)      : undefined;
    const sequenceId = req.query.sequenceId ? String(req.query.sequenceId) : undefined;
    sendSuccess(res, await analyticsService.getRecentActivity(userId, { limit, sequenceId }), 'Activity retrieved');
  } catch (err) { next(err); }
}

export async function getSenders(
  req: AuthenticatedRequest, res: Response, next: NextFunction
): Promise<void> {
  try {
    const filter = parseSenderFilter(req);
    sendSuccess(res, await analyticsService.getSenderAnalytics(getUserId(req), filter), 'Sender analytics retrieved');
  } catch (err) { next(err); }
}

// ─── Canonical endpoints ──────────────────────────────────────────────────────

/**
 * GET /api/analytics/dashboard
 * Supports: ?from=&to=&senderId=&sequenceId=&status=
 */
export async function getDashboard(
  req: AuthenticatedRequest, res: Response, next: NextFunction
): Promise<void> {
  try {
    const filter = parseAnalyticsFilter(req);
    sendSuccess(res, await analyticsService.getEnhancedDashboard(getUserId(req), filter), 'Dashboard retrieved');
  } catch (err) { next(err); }
}

/**
 * GET /api/analytics/sequences/:sequenceId
 * Supports: ?from=&to=&stepIndex=&recipientStatus=
 */
export async function getFullSequence(
  req: AuthenticatedRequest, res: Response, next: NextFunction
): Promise<void> {
  try {
    sendSuccess(res,
      await analyticsService.getFullSequenceAnalytics(req.params.sequenceId, getUserId(req)),
      'Sequence analytics retrieved'
    );
  } catch (err) { next(err); }
}

/**
 * GET /api/analytics/sequences/:sequenceId/metrics
 */
export async function getSequenceMetrics(
  req: AuthenticatedRequest, res: Response, next: NextFunction
): Promise<void> {
  try {
    sendSuccess(res,
      await analyticsService.getSequenceMetrics(req.params.sequenceId, getUserId(req)),
      'Sequence metrics retrieved'
    );
  } catch (err) { next(err); }
}

/**
 * GET /api/analytics/sequences/:sequenceId/recipients
 * Supports: ?page=&limit=&search=&status=&currentStep=&sortBy=&sortDir=
 */
export async function getRecipientMetrics(
  req: AuthenticatedRequest, res: Response, next: NextFunction
): Promise<void> {
  try {
    const opts = parseRecipientFilter(req);
    sendSuccess(res,
      await analyticsService.getRecipientMetrics(req.params.sequenceId, getUserId(req), opts),
      'Recipient metrics retrieved'
    );
  } catch (err) { next(err); }
}
