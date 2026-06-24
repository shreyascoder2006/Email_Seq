import { Response, NextFunction } from 'express';
import { analyticsService } from '../services/analytics.service';
import { AuthenticatedRequest } from '../types';
import { sendSuccess } from '../utils/response';
import { AppError } from '../utils/AppError';

function getUserId(req: AuthenticatedRequest): string {
  if (!req.user?.userId) throw AppError.unauthorized();
  return req.user.userId;
}

export async function getOverview(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getUserId(req);
    const metrics = await analyticsService.getOverviewMetrics(userId);
    sendSuccess(res, metrics, 'Overview metrics retrieved successfully');
  } catch (err) {
    next(err);
  }
}

export async function getTimeseries(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getUserId(req);
    const timeseries = await analyticsService.getTimeseries(userId);
    sendSuccess(res, timeseries, 'Timeseries data retrieved successfully');
  } catch (err) {
    next(err);
  }
}

export async function getSequences(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getUserId(req);
    const data = await analyticsService.getSequenceAnalytics(userId);
    sendSuccess(res, data, 'Sequence analytics retrieved successfully');
  } catch (err) {
    next(err);
  }
}

export async function getActivity(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getUserId(req);
    const data = await analyticsService.getRecentActivity(userId);
    sendSuccess(res, data, 'Recent activity retrieved successfully');
  } catch (err) {
    next(err);
  }
}

export async function getSenders(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getUserId(req);
    const data = await analyticsService.getSenderAnalytics(userId);
    sendSuccess(res, data, 'Sender analytics retrieved successfully');
  } catch (err) {
    next(err);
  }
}
