import { Request, Response, NextFunction } from 'express';
import { authService, AuthPayload } from '../services/authService';

// Extend Express Request to include user
declare global {
  namespace Express {
    interface Request {
      user?: {
        walletAddress: string;
      };
      token?: string;
    }
  }
}

/**
 * Middleware to require authentication
 * Verifies JWT token and adds user to request
 */
export const requireAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
    }

    if (!authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: {
          code: 'INVALID_AUTH_FORMAT',
          message: 'Invalid authorization format. Use: Bearer <token>',
        },
      });
    }

    const token = authHeader.substring(7);

    // Verify token
    const payload = authService.verifyToken(token);

    if (!payload) {
      return res.status(401).json({
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid or expired token',
        },
      });
    }

    // Check session validity
    if (!(await authService.isSessionValid(token))) {
      return res.status(401).json({
        error: {
          code: 'SESSION_EXPIRED',
          message: 'Session has expired. Please sign in again.',
        },
      });
    }

    // Add user to request
    req.user = {
      walletAddress: payload.walletAddress,
    };
    req.token = token;

    next();
  } catch (error) {
    return res.status(401).json({
      error: {
        code: 'AUTH_ERROR',
        message: 'Authentication failed',
      },
    });
  }
};

/**
 * Optional authentication middleware
 * Adds user to request if valid token is present, but doesn't require it
 */
export const optionalAuth = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return next();
    }

    const token = authHeader.substring(7);
    const payload = authService.verifyToken(token);

    if (payload && (await authService.isSessionValid(token))) {
      req.user = {
        walletAddress: payload.walletAddress,
      };
      req.token = token;
    }

    next();
  } catch (error) {
    // Don't fail, just continue without user
    next();
  }
};

/**
 * Middleware to check if user owns the resource
 * Must be used after requireAuth
 */
export const requireOwnership = (walletParamName: string = 'walletAddress') => {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
    }

    const resourceWallet = req.params[walletParamName] || req.body[walletParamName];

    if (!resourceWallet) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Wallet address not provided',
        },
      });
    }

    if (req.user.walletAddress.toLowerCase() !== resourceWallet.toLowerCase()) {
      return res.status(403).json({
        error: {
          code: 'FORBIDDEN',
          message: 'You do not have permission to access this resource',
        },
      });
    }

    next();
  };
};
