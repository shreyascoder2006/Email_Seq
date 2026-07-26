import { Router } from 'express';
import { generateEmail } from '../controllers/ai.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

router.use(authenticate);

router.post('/generate-email', generateEmail);

export default router;
