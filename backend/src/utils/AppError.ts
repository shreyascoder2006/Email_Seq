/**
 * Operational (expected) errors — thrown deliberately in application code.
 * Separate from programmer errors (bugs) which should bubble as 500s.
 */
export class AppError extends Error {
  public readonly statusCode: number;
  public readonly isOperational: boolean;

  constructor(message: string, statusCode: number = 500) {
    super(message);
    this.statusCode = statusCode;
    this.isOperational = true;

    // Maintain proper stack trace for where our error was thrown
    Error.captureStackTrace(this, this.constructor);

    // Restore prototype chain (required for instanceof checks with TypeScript)
    Object.setPrototypeOf(this, AppError.prototype);
  }

  static badRequest(message: string): AppError {
    return new AppError(message, 400);
  }

  static unauthorized(message = 'Unauthorized'): AppError {
    return new AppError(message, 401);
  }

  static forbidden(message = 'Forbidden'): AppError {
    return new AppError(message, 403);
  }

  static notFound(resource = 'Resource'): AppError {
    return new AppError(`${resource} not found`, 404);
  }

  static conflict(message: string): AppError {
    return new AppError(message, 409);
  }

  static unprocessable(message: string): AppError {
    return new AppError(message, 422);
  }

  static tooManyRequests(message = 'Too many requests'): AppError {
    return new AppError(message, 429);
  }

  static internal(message = 'Internal server error'): AppError {
    return new AppError(message, 500);
  }
}
