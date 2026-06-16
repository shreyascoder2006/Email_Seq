import { Router } from 'express';
import {
  listEmailAccounts,
  getEmailAccount,
  createEmailAccount,
  updateEmailAccount,
  deleteEmailAccount,
  testEmailConnection,
} from '../controllers/emailConnection.controller';
import { authenticate }   from '../middleware/auth';
import { validate }       from '../middleware/validate';
import {
  CreateEmailConnectionSchema,
  UpdateEmailConnectionSchema,
  TestConnectionSchema,
  IdParamSchema,
} from '../validators/emailConnection.validator';

const router = Router();

/**
 * All routes require a valid JWT.
 * The authenticate middleware populates req.user.
 */
router.use(authenticate);

// ─── Collection routes ─────────────────────────────────────────────

/**
 * @route   GET /api/email-accounts
 * @desc    List all email accounts for the authenticated user
 * @access  Private
 */
router.get('/', listEmailAccounts);

/**
 * @route   POST /api/email-accounts
 * @desc    Add a new email account (SMTP/IMAP)
 * @access  Private
 * @body    CreateEmailConnectionSchema
 */
router.post(
  '/',
  validate(CreateEmailConnectionSchema, 'body'),
  createEmailAccount
);

// ─── Item routes ───────────────────────────────────────────────────

/**
 * @route   GET /api/email-accounts/:id
 * @desc    Get a single email account by ID
 * @access  Private
 */
router.get(
  '/:id',
  validate(IdParamSchema, 'params'),
  getEmailAccount
);

/**
 * @route   PUT /api/email-accounts/:id
 * @desc    Update an email account
 * @access  Private
 * @body    UpdateEmailConnectionSchema
 */
router.put(
  '/:id',
  validate(IdParamSchema, 'params'),
  validate(UpdateEmailConnectionSchema, 'body'),
  updateEmailAccount
);

/**
 * @route   DELETE /api/email-accounts/:id
 * @desc    Delete an email account (hard delete)
 * @access  Private
 */
router.delete(
  '/:id',
  validate(IdParamSchema, 'params'),
  deleteEmailAccount
);

/**
 * @route   POST /api/email-accounts/:id/test
 * @desc    Test SMTP (and optionally IMAP) connection
 * @access  Private
 * @body    { test_imap?: boolean }
 * @returns 200 if fully OK, 207 if partial failure
 */
router.post(
  '/:id/test',
  validate(IdParamSchema, 'params'),
  validate(TestConnectionSchema, 'body'),
  testEmailConnection
);

export default router;
