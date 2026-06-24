import { Router } from 'express';
import multer from 'multer';
import {
  parsePreview,
  createImportList,
  listImportLists,
  getImportList,
  deleteImportList,
  enrollImportList,
  cloneImportList,
  updateImportSettings,
} from '../controllers/import.controller';
import { authenticate } from '../middleware/auth';
import { validate }     from '../middleware/validate';
import {
  ImportIdParamSchema,
  ImportEnrollParamSchema,
  UpdateImportSettingsSchema,
} from '../validators/import.validator';

const router = Router();

// Memory storage — we never write files to disk (parse from buffer directly)
const upload = multer({
  storage: multer.memoryStorage(),
  limits:  { fileSize: 20 * 1024 * 1024 }, // 20 MB max
  fileFilter: (_req, file, cb) => {
    const allowed = [
      'text/csv',
      'application/vnd.ms-excel',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/octet-stream',
    ];
    if (allowed.includes(file.mimetype) || file.originalname.match(/\.(csv|xlsx|xls)$/i)) {
      cb(null, true);
    } else {
      cb(new Error('Only CSV and XLSX files are allowed'));
    }
  },
});

// All routes require authentication
router.use(authenticate);

/**
 * POST /api/imports/parse-preview
 * Upload a CSV/XLSX and get back headers + 5-row preview + auto field mappings.
 * Nothing is persisted.
 */
router.post('/parse-preview', upload.single('file'), parsePreview);

/**
 * POST /api/imports
 * Save import list with field mappings and all contact rows.
 */
router.post('/', createImportList);

/**
 * GET /api/imports
 * List all import lists for the authenticated user.
 */
router.get('/', listImportLists);

/**
 * GET /api/imports/:id
 * Get a single import list + first 100 contacts.
 */
router.get('/:id', validate(ImportIdParamSchema, 'params'), getImportList);

/**
 * DELETE /api/imports/:id
 * Delete import list and all associated contacts.
 */
router.delete('/:id', validate(ImportIdParamSchema, 'params'), deleteImportList);

/**
 * PATCH /api/imports/:id/settings
 * Update an import list's name and description.
 */
router.patch(
  '/:id/settings',
  validate(ImportIdParamSchema, 'params'),
  validate(UpdateImportSettingsSchema, 'body'),
  updateImportSettings
);

/**
 * POST /api/imports/:id/clone
 * Clone an existing import list and its contacts.
 */
router.post('/:id/clone', validate(ImportIdParamSchema, 'params'), cloneImportList);

/**
 * POST /api/imports/:id/enroll/:sequenceId
 * Enroll all valid contacts from the import list into a sequence.
 * skip_existing = true (contacts already in sequence are skipped, not failed).
 */
router.post(
  '/:id/enroll/:sequenceId',
  validate(ImportEnrollParamSchema, 'params'),
  enrollImportList
);

export default router;
