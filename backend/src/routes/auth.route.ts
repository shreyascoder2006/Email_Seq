import { Router } from 'express';
import { login } from '../controllers/auth.controller';

const router = Router();

// Public route for development mock login
router.post('/login', login);

export default router;
