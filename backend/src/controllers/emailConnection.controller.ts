import { Request, Response, NextFunction } from 'express';
import { emailConnectionService } from '../services/emailConnection.service';
import { AuthenticatedRequest } from '../types';
import { sendSuccess, sendCreated, sendNoContent, sendPaginated } from '../utils/response';
import { AppError } from '../utils/AppError';
import logger from '../config/logger';

// ─── Helper — extract verified userId ─────────────────────────────
function getUserId(req: AuthenticatedRequest): string {
  if (!req.user?.userId) throw AppError.unauthorized();
  return req.user.userId;
}

// ─── GET /api/email-accounts ──────────────────────────────────────
export async function listEmailAccounts(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getUserId(req);
    const accounts = await emailConnectionService.findAll(userId);

    logger.debug('listEmailAccounts', { userId, count: accounts.length });
    sendSuccess(res, accounts, `${accounts.length} email account(s) found`);
  } catch (err) {
    next(err);
  }
}

// ─── GET /api/email-accounts/:id ─────────────────────────────────
export async function getEmailAccount(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getUserId(req);
    const account = await emailConnectionService.findById(userId, req.params.id);

    sendSuccess(res, account, 'Email account retrieved');
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/email-accounts ─────────────────────────────────────
export async function createEmailAccount(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getUserId(req);
    // req.body is already Zod-parsed by the validate() middleware
    const account = await emailConnectionService.create(userId, req.body);

    logger.info('Email account created via API', {
      userId,
      accountId: (account as any)._id,
      from_email: account.from_email,
    });

    sendCreated(res, account, 'Email account created successfully');
  } catch (err) {
    next(err);
  }
}

// ─── PUT /api/email-accounts/:id ─────────────────────────────────
export async function updateEmailAccount(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId  = getUserId(req);
    const account = await emailConnectionService.update(userId, req.params.id, req.body);

    logger.info('Email account updated via API', {
      userId,
      accountId: req.params.id,
    });

    sendSuccess(res, account, 'Email account updated successfully');
  } catch (err) {
    next(err);
  }
}

// ─── DELETE /api/email-accounts/:id ──────────────────────────────
export async function deleteEmailAccount(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId = getUserId(req);
    const result = await emailConnectionService.delete(userId, req.params.id);

    if (!result.success) {
      res.status(400).json({
        success: false,
        message: result.message,
        affected_sequences: result.affected_sequences
      });
      return;
    }

    logger.info('Email account deleted via API', {
      userId,
      accountId: req.params.id,
    });

    sendNoContent(res);
  } catch (err) {
    next(err);
  }
}

// ─── POST /api/email-accounts/:id/test ───────────────────────────
export async function testEmailConnection(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const userId   = getUserId(req);
    const testImap = req.body?.test_imap === true;

    logger.info('Testing email connection', {
      userId,
      connectionId: req.params.id,
      testImap,
    });

    const result = await emailConnectionService.testConnection(
      userId,
      req.params.id,
      testImap
    );

    const allOk = result.smtp.success && (!result.imap || result.imap.success);

    sendSuccess(
      res,
      result,
      allOk ? 'Connection verified successfully' : 'Connection test completed with errors',
      allOk ? 200 : 207 // 207 Multi-Status: partial success
    );
  } catch (err) {
    next(err);
  }
}
