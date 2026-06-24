import { Router } from 'express';
import { getOverview, getTimeseries, getSequences, getActivity, getSenders } from '../controllers/analytics.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.get('/overview',   getOverview);
router.get('/timeseries', getTimeseries);
router.get('/sequences',  getSequences);
router.get('/activity',   getActivity);
router.get('/senders',    getSenders);

export default router;
