import { Request, Response, NextFunction } from 'express';
import { ZodSchema, ZodError } from 'zod';
import { ApiResponse } from '../types';

type ValidationTarget = 'body' | 'query' | 'params';

/**
 * Zod validation middleware factory.
 * Usage: router.post('/route', validate(MySchema), handler)
 */
export function validate(
  schema: ZodSchema,
  target: ValidationTarget = 'body'
) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req[target]);

    if (!result.success) {
      const zodError = result.error as ZodError;
      const errors = zodError.issues.map((issue) => ({
        field: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
      }));

      const response: ApiResponse = {
        success: false,
        message: 'Validation failed',
        errors,
      };

      res.status(422).json(response);
      return;
    }

    // Replace request target with parsed (coerced + stripped) data
    req[target] = result.data;
    next();
  };
}
