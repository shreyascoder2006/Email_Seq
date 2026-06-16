import { Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env';
import { UserRole } from '../types';

/**
 * Mock login for development and testing.
 * The backend does not yet have a full User model or registration system,
 * but requires a JWT for protected routes. This issues a valid token
 * for any email/password combination.
 */
export const login = async (req: Request, res: Response): Promise<void> => {
  const { email } = req.body;

  // Use a hardcoded valid MongoDB ObjectId for the user
  const mockUserId = '507f1f77bcf86cd799439011';

  // Create token payload matching JwtPayload interface
  const payload = {
    userId: mockUserId,
    email: email || 'test@example.com',
    role: UserRole.USER,
  };

  // Sign the token
  const token = jwt.sign(payload, env.JWT_SECRET, {
    expiresIn: env.JWT_EXPIRES_IN as any,
  });

  res.status(200).json({
    success: true,
    message: 'Mock login successful',
    data: {
      token,
      user: {
        id: mockUserId,
        email: payload.email,
        first_name: 'Test',
        last_name: 'User',
        role: payload.role,
      },
    },
  });
};
