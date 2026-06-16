import { Response, NextFunction } from 'express';
import { sequenceService } from '../services/sequence.service';
import { AuthenticatedRequest } from '../types';
import {
  sendSuccess,
  sendCreated,
  sendNoContent,
  sendPaginated,
} from '../utils/response';
import { AppError } from '../utils/AppError';
import { Sequence } from '../models/Sequence';

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
    const seq = await Sequence.findOne({ _id: req.params.id, user_id: uid(req) })
      .select('stats')
      .lean();

    if (!seq) {
      throw AppError.notFound('Sequence');
    }

    sendSuccess(res, seq.stats || {}, 'Sequence stats retrieved');
  } catch (err) {
    next(err);
  }
}
