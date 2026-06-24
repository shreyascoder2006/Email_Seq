import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { importService } from '../services/import.service';
import { sendSuccess, sendCreated } from '../utils/response';
import { AppError } from '../utils/AppError';
import {
  CreateImportListSchema,
  EnrollImportListSchema,
  UpdateImportSettingsSchema,
} from '../validators/import.validator';

function uid(req: AuthenticatedRequest): string {
  if (!req.user?.userId) throw AppError.unauthorized();
  return req.user.userId;
}

// ─── POST /api/imports/parse-preview ─────────────────────────────
/**
 * Upload a file and receive headers + 5-row preview + auto-mapped fields.
 * Does NOT persist anything — purely for the mapping UI.
 */
export async function parsePreview(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const file = (req as any).file;
    if (!file) throw AppError.badRequest('No file uploaded');

    const result = importService.parseForPreview(file.buffer, file.mimetype);

    sendSuccess(res, result, 'File parsed successfully');
  } catch (err) { next(err); }
}

// ─── POST /api/imports ────────────────────────────────────────────
/**
 * Save the import list with field mappings + all contact rows.
 * Returns import summary (total, valid, duplicates, errors).
 */
export async function createImportList(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const dto = CreateImportListSchema.parse(req.body);
    const result = await importService.saveImportList(uid(req), dto);

    res.status(201).json({
      success: true,
      message: `Import complete. ${result.valid} valid, ${result.duplicates} duplicates, ${result.errors} errors.`,
      data: {
        import_list:   result.import_list,
        total:         result.total,
        valid:         result.valid,
        duplicates:    result.duplicates,
        errors:        result.errors,
        error_details: result.error_details,
      },
    });
  } catch (err) { next(err); }
}

// ─── GET /api/imports ─────────────────────────────────────────────
export async function listImportLists(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const lists = await importService.listImportLists(uid(req));
    sendSuccess(res, lists, 'Import lists retrieved');
  } catch (err) { next(err); }
}

// ─── GET /api/imports/:id ─────────────────────────────────────────
export async function getImportList(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await importService.getImportList(uid(req), req.params.id);
    sendSuccess(res, data, 'Import list retrieved');
  } catch (err) { next(err); }
}

// ─── DELETE /api/imports/:id ──────────────────────────────────────
export async function deleteImportList(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await importService.deleteImportList(uid(req), req.params.id);
    sendSuccess(res, null, 'Import list deleted');
  } catch (err) { next(err); }
}

// ─── PATCH /api/imports/:id/settings ──────────────────────────────
export async function updateImportSettings(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const dto = UpdateImportSettingsSchema.parse(req.body);
    const result = await importService.updateSettings(uid(req), req.params.id, dto);
    sendSuccess(res, result, 'Import list settings updated');
  } catch (err) { next(err); }
}

// ─── POST /api/imports/:id/clone ──────────────────────────────────
export async function cloneImportList(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await importService.cloneList(uid(req), req.params.id);
    res.status(201).json({
      success: true,
      message: `Import list cloned. Copied ${result.copied_count} contacts.`,
      data: result,
    });
  } catch (err) { next(err); }
}

// ─── POST /api/imports/:id/enroll/:sequenceId ─────────────────────
export async function enrollImportList(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const dto = EnrollImportListSchema.parse(req.body);
    const result = await importService.enrollList(
      uid(req),
      req.params.id,
      req.params.sequenceId,
      dto
    );

    const statusCode = result.failed > 0 ? 207 : 200;
    res.status(statusCode).json({
      success: true,
      message: `Enrolled ${result.enrolled}, skipped ${result.skipped}, failed ${result.failed}.`,
      data: result,
    });
  } catch (err) { next(err); }
}
