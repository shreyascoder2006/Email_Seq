import { Response, NextFunction } from 'express';
import { sequenceService } from '../services/sequence.service';
import { analyticsService } from '../services/analytics.service';
import { AuthenticatedRequest } from '../types';
import {
  sendSuccess,
  sendCreated,
  sendNoContent,
  sendPaginated,
} from '../utils/response';
import { AppError } from '../utils/AppError';
import { Sequence, SendingSchedule } from '../models/Sequence';
import { calculateNextValidSlot, isAllowedWeekday, isWithinSendingWindow, toSequenceLocalTime } from '../utils/scheduling';
import { DateTime } from 'luxon';

// ─── Helper ────────────────────────────────────────────────────────
function uid(req: AuthenticatedRequest): string {
  if (!req.user?.userId) throw AppError.unauthorized();
  return req.user.userId;
}

// ════════════════════════════════════════════════════════════════
//  SEQUENCE CONTROLLERS
// ════════════════════════════════════════════════════════════════

/** GET /api/sequences */
export async function listSequences(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { sequences, total, page, totalPages } =
      await sequenceService.findAll(uid(req), req.query as any);

    sendPaginated(res, sequences, total, page, req.query.limit ? Number(req.query.limit) : 20, 'Sequences retrieved');
  } catch (err) { next(err); }
}

/** GET /api/sequences/:id */
export async function getSequence(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { sequence, steps } = await sequenceService.findWithSteps(
      uid(req),
      req.params.id
    );
    sendSuccess(res, { sequence, steps }, 'Sequence retrieved');
  } catch (err) { next(err); }
}

/** POST /api/sequences */
export async function createSequence(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const seq = await sequenceService.create(uid(req), req.body);
    sendCreated(res, seq, 'Sequence created successfully');
  } catch (err) { next(err); }
}

/** PUT /api/sequences/:id */
export async function updateSequence(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const seq = await sequenceService.update(uid(req), req.params.id, req.body);
    sendSuccess(res, seq, 'Sequence updated successfully');
  } catch (err) { next(err); }
}

/** DELETE /api/sequences/:id */
export async function deleteSequence(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await sequenceService.delete(uid(req), req.params.id);
    sendNoContent(res);
  } catch (err) { next(err); }
}

/**
 * PATCH /api/sequences/:id/status
 * State machine transition: draft→active, active→paused, etc.
 */
export async function transitionSequenceStatus(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const seq = await sequenceService.transition(
      uid(req),
      req.params.id,
      req.body
    );
    sendSuccess(res, seq, `Sequence status changed to "${seq.status}"`);
  } catch (err) { next(err); }
}

/**
 * POST /api/sequences/:id/pre-activation-check
 * Validates if the sequence is safe to activate.
 */
export async function preActivationCheck(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await sequenceService.preActivationCheck(
      uid(req),
      req.params.id
    );
    sendSuccess(res, result, 'Pre-activation check completed');
  } catch (err) { next(err); }
}

/**
 * GET /api/sequences/:id/integrity
 * Returns integrity checks for sequence steps
 */
export async function getSequenceIntegrity(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const integrity = await sequenceService.getSequenceIntegrity(
      uid(req),
      req.params.id
    );
    sendSuccess(res, integrity, 'Sequence integrity retrieved');
  } catch (err) { next(err); }
}

// ════════════════════════════════════════════════════════════════
//  STEP CONTROLLERS
// ════════════════════════════════════════════════════════════════

/** GET /api/sequences/:id/steps */
export async function listSteps(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const steps = await sequenceService.getSteps(uid(req), req.params.id);
    sendSuccess(res, steps, `${steps.length} step(s) retrieved`);
  } catch (err) { next(err); }
}

/** POST /api/sequences/:id/steps */
export async function addStep(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const step = await sequenceService.addStep(uid(req), req.params.id, req.body);
    sendCreated(res, step, 'Step added successfully');
  } catch (err) { next(err); }
}

/** PUT /api/sequences/:id/steps/:stepId */
export async function updateStep(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const step = await sequenceService.updateStep(
      uid(req),
      req.params.id,
      req.params.stepId,
      req.body
    );
    sendSuccess(res, step, 'Step updated successfully');
  } catch (err) { next(err); }
}

/** DELETE /api/sequences/:id/steps/:stepId */
export async function deleteStep(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await sequenceService.deleteStep(uid(req), req.params.id, req.params.stepId);
    sendNoContent(res);
  } catch (err) { next(err); }
}

/**
 * PATCH /api/sequences/:id/steps/reorder
 * Body: { step_ids: ["id1", "id2", ...] }
 */
export async function reorderSteps(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const steps = await sequenceService.reorderSteps(
      uid(req),
      req.params.id,
      req.body
    );
    sendSuccess(res, steps, 'Steps reordered successfully');
  } catch (err) { next(err); }
}

/**
 * PATCH /api/sequences/:id/steps/:stepId/toggle
 * Enable or disable a step without deleting it.
 */
export async function toggleStep(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const step = await sequenceService.toggleStepActive(
      uid(req),
      req.params.id,
      req.params.stepId
    );
    sendSuccess(
      res,
      step,
      `Step ${step.is_active ? 'enabled' : 'disabled'}`
    );
  } catch (err) { next(err); }
}

// ─── GET /api/sequences/:id/stats ─────────────────────────────────
export async function getSequenceStats(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    // Delegate entirely to analyticsService — single source of truth for metrics
    const metrics = await analyticsService.getSequenceMetrics(
      req.params.id,
      uid(req)
    );
    sendSuccess(res, metrics, 'Sequence stats retrieved');
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/sequences/schedule-preview ─────────────────────────
export async function previewSchedule(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const {
      timezone,
      launch_date,
      active_days,
      start_hour,
      start_minute,
      end_hour,
      end_minute,
      daily_cap
    } = req.body;

    if (!timezone || !Array.isArray(active_days)) {
      throw AppError.badRequest('Missing or invalid parameters for schedule preview');
    }

    const window = {
      timezone,
      schedule: SendingSchedule.CUSTOM,
      custom_days: active_days,
      start_hour: Number(start_hour),
      start_minute: Number(start_minute),
      end_hour: Number(end_hour),
      end_minute: Number(end_minute)
    };

    const now = new Date();
    let isLaunchAllowed = false;
    let reason = '';
    
    // Exact same check as runScheduler
    const launchDateObj = launch_date ? new Date(launch_date) : now;
    
    // calculateNextValidSlot determines the exact slot
    const nextAvailableSlot = calculateNextValidSlot(now, window, launchDateObj);
    
    // Now determine if it's "now" vs "future"
    const localNow = toSequenceLocalTime(now, window.timezone);
    const startMin = window.start_hour * 60 + window.start_minute;
    const endMin = window.end_hour * 60 + window.end_minute;
    const currMin = localNow.hour * 60 + localNow.minute;

    const isDayValid = isAllowedWeekday(localNow.weekday, window);
    const isTimeValid = isWithinSendingWindow(localNow, window);
    let isPastLaunch = true;
    if (launchDateObj) {
      const launchDt = toSequenceLocalTime(launchDateObj, window.timezone);
      if (localNow < launchDt) isPastLaunch = false;
    }

    if (!isPastLaunch) {
      reason = 'Launch date has not arrived yet.';
    } else if (!isDayValid) {
      reason = `Current weekday (${localNow.weekdayLong}) is not allowed.`;
    } else if (!isTimeValid) {
      if (currMin < startMin) reason = `Current local time ${localNow.toFormat('HH:mm')} is before window start.`;
      else reason = `Current local time ${localNow.toFormat('HH:mm')} is after window end.`;
    } else {
      reason = 'Inside valid window, correct day, and past launch date.';
      isLaunchAllowed = true;
    }

    // Format the response with Luxon
    const nextDt = DateTime.fromJSDate(nextAvailableSlot).setZone(timezone);
    const timezoneAbbreviation = nextDt.toFormat('ZZZZ'); // e.g., EDT, IST
    
    // Relative time string (e.g. "In 14 minutes", "Tomorrow", etc.)
    const diff = nextDt.diff(DateTime.local(), ['days', 'hours', 'minutes']).toObject();
    let relativeTime = '';
    if (isLaunchAllowed && nextDt.toMillis() <= DateTime.now().toMillis()) {
      relativeTime = '(Ready to send immediately)';
    } else if (diff.days && diff.days > 0) {
      relativeTime = `(In ${diff.days} day${diff.days > 1 ? 's' : ''})`;
    } else if (diff.hours && diff.hours > 0) {
      relativeTime = `(In ${diff.hours} hour${diff.hours > 1 ? 's' : ''} and ${Math.round(diff.minutes || 0)} minutes)`;
    } else {
      relativeTime = `(In ${Math.round(diff.minutes || 0)} minutes)`;
    }

    sendSuccess(res, {
      nextAvailableSlotUtc: nextAvailableSlot.toISOString(),
      nextAvailableSlotLocal: nextDt.toISO(),
      timezone,
      timezoneAbbreviation,
      relativeTime,
      reason,
      isLaunchAllowed
    }, 'Schedule preview computed');

  } catch (err) {
    next(err);
  }
}

/** POST /api/sequences/:id/reschedule */
export async function rescheduleCampaign(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { contact_ids, action, launch_date, start_hour, start_minute, end_hour, end_minute, browser_timezone } = req.body;
    
    if (!contact_ids || !Array.isArray(contact_ids) || contact_ids.length === 0) {
      throw new AppError('contact_ids array is required', 400);
    }
    if (!action || !['immediately', 'today', 'tomorrow', 'custom'].includes(action)) {
      throw new AppError('valid action is required', 400);
    }
    if (!browser_timezone) {
      throw new AppError('browser_timezone is required', 400);
    }

    const { enrollmentService } = await import('../services/enrollment.service');

    const result = await enrollmentService.rescheduleContacts(
      uid(req),
      req.params.id,
      contact_ids,
      {
        action,
        launch_date,
        start_hour,
        start_minute,
        end_hour,
        end_minute,
        browser_timezone
      }
    );

    sendSuccess(res, result, 'Campaign rescheduled successfully');
  } catch (err) {
    next(err);
  }
}
