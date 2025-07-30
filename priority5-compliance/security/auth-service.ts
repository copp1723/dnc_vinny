
import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';
import { DatabaseService } from '../services/database-service';
import { securityConfig } from '../config/security-config';
import { z } from 'zod';

const db = new DatabaseService();

export interface AuthenticatedUser {
  id: string;
  email: string;
  name: string;
  role: 'ADMIN' | 'OPERATOR' | 'VIEWER';
  dealershipAccess?: string[];
}

export interface AuthenticatedRequest extends Request {
  user?: AuthenticatedUser;
}

// JWT payload validation schema
const jwtPayloadSchema = z.object({
  userId: z.string(),
  email: z.string().email(),
  role: z.enum(['ADMIN', 'OPERATOR', 'VIEWER']),
  dealershipAccess: z.array(z.string()).optional(),
  iat: z.number(),
  exp: z.number(),
});

export class AuthService {
  generateToken(user: AuthenticatedUser): string {
    const payload = {
      userId: user.id,
      email: user.email,
      role: user.role,
      dealershipAccess: user.dealershipAccess || [],
    };

    return jwt.sign(
      payload,
      securityConfig.jwt.secret,
      {
        expiresIn: securityConfig.jwt.expiresIn,
        issuer: securityConfig.jwt.issuer,
        algorithm: securityConfig.jwt.algorithm,
      }
    );
  }

  verifyToken(token: string): AuthenticatedUser | null {
    try {
      const decoded = jwt.verify(token, securityConfig.jwt.secret, {
        issuer: securityConfig.jwt.issuer,
        algorithms: [securityConfig.jwt.algorithm],
      });

      // Validate the payload structure
      const validatedPayload = jwtPayloadSchema.parse(decoded);

      return {
        id: validatedPayload.userId,
        email: validatedPayload.email,
        name: '', // Name will be fetched from database if needed
        role: validatedPayload.role,
        dealershipAccess: validatedPayload.dealershipAccess,
      };
    } catch (error) {
      if (error instanceof jwt.JsonWebTokenError) {
        console.warn('JWT verification failed:', error.message);
      } else if (error instanceof z.ZodError) {
        console.warn('JWT payload validation failed:', error.errors);
      }
      return null;
    }
  }

  async login(email: string, password: string, ipAddress?: string, userAgent?: string) {
    try {
      const user = await db.validateUserPassword(email, password);
      if (!user) {
        await db.logAction({
          action: 'LOGIN_FAILED',
          details: { email, reason: 'Invalid credentials' },
          ipAddress,
          userAgent
        });
        return { success: false, error: 'Invalid credentials' };
      }

      const authenticatedUser: AuthenticatedUser = {
        id: user.id,
        email: user.email,
        name: user.name,
        role: user.role
      };

      const token = this.generateToken(authenticatedUser);

      await db.logAction({
        userId: user.id,
        action: 'LOGIN_SUCCESS',
        details: { email },
        ipAddress,
        userAgent
      });

      return {
        success: true,
        token,
        user: authenticatedUser,
        expiresIn: JWT_EXPIRES_IN
      };
    } catch (error) {
      console.error('Login error:', error);
      return { success: false, error: 'Internal server error' };
    }
  }
}

export const authMiddleware = async (
  req: AuthenticatedRequest,
  res: Response, 
  next: NextFunction
) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({ error: 'Access token required' });
    }

    const token = authHeader.substring(7);
    const authService = new AuthService();
    const user = authService.verifyToken(token);

    if (!user) {
      return res.status(401).json({ error: 'Invalid or expired token' });
    }

    req.user = user;
    next();
  } catch (error) {
    console.error('Auth middleware error:', error);
    res.status(500).json({ error: 'Internal server error' });
  }
};

export const requireRole = (roles: string[]) => {
  return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({ error: 'Authentication required' });
    }

    if (!roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' });
    }

    next();
  };
};
