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
