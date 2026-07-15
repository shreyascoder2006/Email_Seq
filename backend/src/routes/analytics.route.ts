import { Router } from 'express';
import {
  getOverview,
  getTimeseries,
  getSequences,
  getActivity,
  getSenders,
  getDashboard,
  getFullSequence,
  getSequenceMetrics,
  getRecipientMetrics,
} from '../controllers/analytics.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

// ── Legacy / existing endpoints (preserved for backward compat) ─────────
router.get('/overview',   getOverview);
router.get('/timeseries', getTimeseries);
router.get('/sequences',  getSequences);
// GET /api/analytics/activity?limit=50&sequenceId=<id>
router.get('/activity',   getActivity);
router.get('/senders',    getSenders);

// ── Enterprise canonical endpoints ───────────────────────────────────────
// GET /api/analytics/dashboard
// Single-call: overview KPIs + timeseries + trends + top sequences + top senders + health + activity
router.get('/dashboard', getDashboard);

// GET /api/analytics/sequences/:sequenceId
// Full sequence analytics page (KPIs, step breakdown, funnel, daily trend, activity feed)
router.get('/sequences/:sequenceId', getFullSequence);

// GET /api/analytics/sequences/:sequenceId/metrics
// Lightweight KPI-only metrics for a sequence
router.get('/sequences/:sequenceId/metrics', getSequenceMetrics);

// GET /api/analytics/sequences/:sequenceId/recipients?page=1&limit=100
// Paginated per-recipient engagement data
router.get('/sequences/:sequenceId/recipients', getRecipientMetrics);

export default router;
