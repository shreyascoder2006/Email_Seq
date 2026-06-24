import { Response, NextFunction } from 'express';
import { enrollmentService } from '../services/enrollment.service';
import { AuthenticatedRequest } from '../types';
import { sendSuccess, sendCreated, sendPaginated } from '../utils/response';
import { AppError } from '../utils/AppError';

function uid(req: AuthenticatedRequest): string {
  if (!req.user?.userId) throw AppError.unauthorized();
  return req.user.userId;
}

// ─── POST /api/sequences/:id/enroll ──────────────────────────────
export async function enrollContacts(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await enrollmentService.enroll(
      uid(req),
      req.params.id,
      req.body
    );

    const statusCode = result.failed > 0 ? 207 : 201;
    res.status(statusCode).json({
      success: true,
      message: `Enrolled ${result.enrolled} contact(s). Skipped: ${result.skipped}. Failed: ${result.failed}.`,
      data: {
        enrolled:  result.enrolled,
        skipped:   result.skipped,
        failed:    result.failed,
        errors:    result.errors,
        contacts:  result.contacts,
        isOutsideWindow: result.isOutsideWindow,
        nextAvailableWindow: result.nextAvailableWindow,
      },
    });
  } catch (err) { next(err); }
}

// ─── GET /api/sequences/:id/contacts ─────────────────────────────
export async function listEnrolledContacts(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const { contacts, total, page, totalPages } =
      await enrollmentService.listContacts(uid(req), req.params.id, req.query as any);

    sendPaginated(
      res,
      contacts,
      total,
      page,
      req.query.limit ? Number(req.query.limit) : 50,
      'Contacts retrieved'
    );
  } catch (err) { next(err); }
}

// ─── PATCH /api/sequences/:id/contacts/:contactId ────────────────
export async function patchEnrolledContact(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const contact = await enrollmentService.patchContactStatus(
      uid(req),
      req.params.id,
      req.params.contactId,
      req.body
    );
    sendSuccess(
      res,
      contact,
      `Contact ${contact.status === 'paused' ? 'paused' : 'resumed'} successfully`
    );
  } catch (err) { next(err); }
}

// ─── POST /api/sequences/:id/contacts/bulk-delete ─────────────────
export async function bulkDeleteContacts(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await enrollmentService.bulkDelete(
      uid(req),
      req.params.id,
      req.body
    );
    sendSuccess(res, result, `Successfully deleted ${result.deleted} contacts`);
  } catch (err) { next(err); }
}

// ─── PATCH /api/sequences/:id/contacts/pause ─────────────────────
export async function bulkPauseContacts(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await enrollmentService.bulkPause(
      uid(req),
      req.params.id,
      req.body
    );
    sendSuccess(res, result, `Successfully paused ${result.paused} contacts`);
  } catch (err) { next(err); }
}

// ─── PATCH /api/sequences/:id/contacts/resume ────────────────────
export async function bulkResumeContacts(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await enrollmentService.bulkResume(
      uid(req),
      req.params.id,
      req.body
    );
    sendSuccess(res, result, `Successfully resumed ${result.resumed} contacts`);
  } catch (err) { next(err); }
}

// ─── PATCH /api/sequences/:id/contacts/skip ──────────────────────
export async function bulkSkipContacts(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await enrollmentService.bulkSkip(
      uid(req),
      req.params.id,
      req.body
    );
    sendSuccess(res, result, `Successfully skipped ${result.skipped} contacts`);
  } catch (err) { next(err); }
}
