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

// ─── PATCH /api/sequences/:id/contacts/remove ────────────────────
export async function bulkRemoveContacts(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await enrollmentService.bulkRemove(uid(req), req.params.id, req.body);
    sendSuccess(res, result, `Successfully removed ${result.removed} contacts`);
  } catch (err) { next(err); }
}

// ─── PATCH /api/sequences/:id/contacts/reenroll ──────────────────
export async function bulkReenrollContacts(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await enrollmentService.bulkReenroll(uid(req), req.params.id, req.body);
    sendSuccess(res, result, `Successfully re-enrolled ${result.reenrolled} contacts`);
  } catch (err) { next(err); }
}

// ─── GET /api/sequences/:id/contacts/export ──────────────────────
export async function exportContacts(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const rows = await enrollmentService.exportContacts(uid(req), req.params.id, req.query as any);
    const headers = ['Email','First Name','Last Name','Company','Status','Current Step','Enrolled At','Last Activity'];
    const csv = [
      headers.join(','),
      ...rows.map(r => [
        r.contact_email, r.contact_first_name, r.contact_last_name ?? '',
        r.contact_company ?? '', r.status, r.current_step_index,
        r.enrolled_at ? new Date(r.enrolled_at).toISOString() : '',
        r.last_activity_at ? new Date(r.last_activity_at).toISOString() : '',
      ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(',')),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', `attachment; filename="recipients-${req.params.id}.csv"`);
    res.status(200).send(csv);
  } catch (err) { next(err); }
}

