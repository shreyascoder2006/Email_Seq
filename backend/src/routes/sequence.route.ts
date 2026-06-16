import { Router } from 'express';
import {
  listSequences,
  getSequence,
  createSequence,
  updateSequence,
  deleteSequence,
  transitionSequenceStatus,
  listSteps,
  addStep,
  updateStep,
  deleteStep,
  reorderSteps,
  toggleStep,
  getSequenceStats,
} from '../controllers/sequence.controller';
import {
  enrollContacts,
  listEnrolledContacts,
  patchEnrolledContact,
} from '../controllers/enrollment.controller';
import { authenticate }  from '../middleware/auth';
import { validate }      from '../middleware/validate';
import {
  CreateSequenceSchema,
  UpdateSequenceSchema,
  TransitionStatusSchema,
  ListSequenceQuerySchema,
  CreateStepSchema,
  UpdateStepSchema,
  ReorderStepsSchema,
  IdParamSchema,
  SequenceAndStepParamSchema,
} from '../validators/sequence.validator';
import {
  EnrollContactsSchema,
  ListContactsQuerySchema,
  PatchContactStatusSchema,
  ContactParamSchema,
} from '../validators/enrollment.validator';

const router = Router();

// All routes require a valid JWT
router.use(authenticate);

// ════════════════════════════════════════════════════════════════
//  SEQUENCE COLLECTION ROUTES
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/sequences
 * Query: ?status=active&page=1&limit=20&search=foo&sort_by=name&sort_order=asc
 */
router.get(
  '/',
  validate(ListSequenceQuerySchema, 'query'),
  listSequences
);

/**
 * POST /api/sequences
 * Create a new sequence (status = draft)
 *
 * @example
 * {
 *   "name": "SaaS Founders Outreach",
 *   "email_connection_id": "664abc...",
 *   "sending_window": { "timezone": "Asia/Kolkata", "start_hour": 9, "end_hour": 18 },
 *   "stop_on_reply": true,
 *   "track_opens": true,
 *   "track_clicks": true
 * }
 */
router.post(
  '/',
  validate(CreateSequenceSchema, 'body'),
  createSequence
);

// ════════════════════════════════════════════════════════════════
//  SEQUENCE ITEM ROUTES
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/sequences/:id/stats
 * Returns the aggregated stats for the sequence
 */
router.get(
  '/:id/stats',
  validate(IdParamSchema, 'params'),
  getSequenceStats
);

/**
 * GET /api/sequences/:id
 * Returns { sequence, steps } in one call
 */
router.get(
  '/:id',
  validate(IdParamSchema, 'params'),
  getSequence
);

/**
 * PUT /api/sequences/:id
 * Update metadata (name, description, sending_window, etc.)
 * Not allowed when status = active | archived | completed
 */
router.put(
  '/:id',
  validate(IdParamSchema, 'params'),
  validate(UpdateSequenceSchema, 'body'),
  updateSequence
);

/**
 * DELETE /api/sequences/:id
 * Hard delete sequence + all its steps.
 * Not allowed when status = active
 */
router.delete(
  '/:id',
  validate(IdParamSchema, 'params'),
  deleteSequence
);

/**
 * PATCH /api/sequences/:id/status
 * State machine transition
 *
 * Valid transitions:
 *   draft  → active    (requires ≥1 email step + active email connection)
 *   draft  → archived
 *   active → paused
 *   active → archived
 *   paused → active
 *   paused → archived
 *
 * @example { "status": "active" }
 */
router.patch(
  '/:id/status',
  validate(IdParamSchema, 'params'),
  validate(TransitionStatusSchema, 'body'),
  transitionSequenceStatus
);

// ════════════════════════════════════════════════════════════════
//  STEP ROUTES  (/api/sequences/:id/steps/...)
// ════════════════════════════════════════════════════════════════

/**
 * GET /api/sequences/:id/steps
 * Returns all steps sorted by step_index ascending
 */
router.get(
  '/:id/steps',
  validate(IdParamSchema, 'params'),
  listSteps
);

/**
 * POST /api/sequences/:id/steps
 * Add a new step (appended to end)
 * Not allowed when status = active | archived | completed
 *
 * @example Email step:
 * {
 *   "type": "email",
 *   "template_id": "664abc...",
 *   "delay_days": 0,
 *   "delay_hours": 0,
 *   "track_opens": true
 * }
 *
 * @example Wait/Delay step:
 * {
 *   "type": "wait",
 *   "delay_days": 3,
 *   "delay_hours": 0
 * }
 *
 * @example Condition step:
 * {
 *   "type": "condition",
 *   "delay_days": 0,
 *   "condition": {
 *     "type": "opened_email",
 *     "true_next_step_index": 3,
 *     "false_next_step_index": 4
 *   }
 * }
 */
router.post(
  '/:id/steps',
  validate(IdParamSchema, 'params'),
  validate(CreateStepSchema, 'body'),
  addStep
);

/**
 * PATCH /api/sequences/:id/steps/reorder
 * Reorder all steps by supplying the full ordered array of step IDs
 * Must include ALL step IDs for the sequence
 *
 * @example { "step_ids": ["stepId1", "stepId3", "stepId2"] }
 */
router.patch(
  '/:id/steps/reorder',
  validate(IdParamSchema, 'params'),
  validate(ReorderStepsSchema, 'body'),
  reorderSteps
);

/**
 * PUT /api/sequences/:id/steps/:stepId
 * Update an existing step
 * Type cannot be changed — delete and re-add instead
 */
router.put(
  '/:id/steps/:stepId',
  validate(SequenceAndStepParamSchema, 'params'),
  validate(UpdateStepSchema, 'body'),
  updateStep
);

/**
 * DELETE /api/sequences/:id/steps/:stepId
 * Delete a step and compact step_index values
 */
router.delete(
  '/:id/steps/:stepId',
  validate(SequenceAndStepParamSchema, 'params'),
  deleteStep
);

/**
 * PATCH /api/sequences/:id/steps/:stepId/toggle
 * Enable or disable a step without deleting it
 * Disabled steps are skipped by the scheduler
 */
router.patch(
  '/:id/steps/:stepId/toggle',
  validate(SequenceAndStepParamSchema, 'params'),
  toggleStep
);

// ════════════════════════════════════════════════════════════════
//  ENROLLMENT & CONTACT ROUTES (/api/sequences/:id/contacts...)
// ════════════════════════════════════════════════════════════════

/**
 * POST /api/sequences/:id/enroll
 * Bulk enroll contacts into the sequence.
 */
router.post(
  '/:id/enroll',
  validate(IdParamSchema, 'params'),
  validate(EnrollContactsSchema, 'body'),
  enrollContacts
);

/**
 * GET /api/sequences/:id/contacts
 * List enrolled contacts with optional status filter.
 */
router.get(
  '/:id/contacts',
  validate(IdParamSchema, 'params'),
  validate(ListContactsQuerySchema, 'query'),
  listEnrolledContacts
);

/**
 * PATCH /api/sequences/:id/contacts/:contactId
 * Pause or resume a contact's enrollment.
 */
router.patch(
  '/:id/contacts/:contactId',
  validate(ContactParamSchema, 'params'),
  validate(PatchContactStatusSchema, 'body'),
  patchEnrolledContact
);

export default router;
