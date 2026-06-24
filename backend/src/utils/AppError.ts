/**
 * Operational (expected) errors — thrown deliberately in application code.
 * Separate from programmer errors (bugs) which should bubble as 500s.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;
  public readonly details?: any;

  constructor(message: string, statusCode: number = 500, details?: any) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;
    this.details = details;

    // Maintain proper stack trace for where our error was thrown
    Error.captureStackTrace(this, this.constructor);

    // Restore prototype chain (required for instanceof checks with TypeScript)
    Object.setPrototypeOf(this, AppError.prototype);
  }

  static badRequest(message: string, details?: any): AppError {
    return new AppError(message, 400, details);
  }

  static unauthorized(message = 'Unauthorized', details?: any): AppError {
    return new AppError(message, 401, details);
  }

  static forbidden(message = 'Forbidden', details?: any): AppError {
    return new AppError(message, 403, details);
  }

  static notFound(resource = 'Resource', details?: any): AppError {
    return new AppError(`${resource} not found`, 404, details);
  }

  static conflict(message: string, details?: any): AppError {
    return new AppError(message, 409, details);
  }

  static unprocessable(message: string, details?: any): AppError {
    return new AppError(message, 422, details);
  }

  static tooManyRequests(message = 'Too many requests', details?: any): AppError {
    return new AppError(message, 429, details);
  }

  static internal(message = 'Internal server error', details?: any): AppError {
    return new AppError(message, 500, details);
  }
}
