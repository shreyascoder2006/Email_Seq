import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from '../types';
import { sendSuccess } from '../utils/response';
import { AppError } from '../utils/AppError';
import { GenerateEmailSchema } from '../validators/ai.validator';
import { AIEmailService } from '../services/ai/ai.service';
import logger from '../config/logger';

// Instantiate service once for reuse
const aiEmailService = new AIEmailService();

export const generateEmail = async (req: AuthenticatedRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    // 1. Validate request body against schema
    const validationResult = GenerateEmailSchema.safeParse(req.body);
    
    if (!validationResult.success) {
      // Return 400 with first validation error message
      throw new AppError(validationResult.error.issues[0].message, 400);
    }

    // 2. Call Service
    const generatedContent = await aiEmailService.generateEmail(validationResult.data);

    // 3. Send successful response
    sendSuccess(res, generatedContent, 'Email generated successfully');
  } catch (err: any) {
    logger.error('AI Controller Error', { error: err.message, stack: err.stack });
    next(err);
  }
};
