import { Router, Request, Response, NextFunction } from 'express';
import { authService } from '../services/authService';
import { z } from 'zod';

const router = Router();

// Validation schemas
const nonceRequestSchema = z.object({
  walletAddress: z.string().min(32).max(44),
});

const verifyRequestSchema = z.object({
  walletAddress: z.string().min(32).max(44),
  message: z.string().min(1),
  signature: z.string().min(1),
  nonce: z.string().min(1),
});

/**
 * POST /auth/nonce
 * Request a nonce for SIWS authentication
 */
router.post('/nonce', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validation = nonceRequestSchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid wallet address',
          details: validation.error.errors,
        },
      });
    }

    const { walletAddress } = validation.data;
    const nonce = await authService.generateNonce(walletAddress);
    
    // Get origin from request headers
    const origin = req.get('origin') || req.get('host') || 'localhost:3000';
    const protocol = req.secure ? 'https' : 'http';
    const domain = origin.replace(/^https?:\/\//, '');
    const uri = `${protocol}://${origin}`;

    // Create the SIWS message
    const message = authService.createSIWSMessage({
      domain,
      address: walletAddress,
      nonce,
      uri,
      statement: 'Sign in to Space Prediction Market',
      chainId: process.env.SOLANA_NETWORK || 'devnet',
    });

    res.json({
      nonce,
      message,
      expiresIn: 300, // 5 minutes
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /auth/verify
 * Verify a signed SIWS message and return JWT token
 */
router.post('/verify', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validation = verifyRequestSchema.safeParse(req.body);
    
    if (!validation.success) {
      return res.status(400).json({
        error: {
          code: 'INVALID_REQUEST',
          message: 'Invalid request body',
          details: validation.error.errors,
        },
      });
    }

    const { walletAddress, message, signature, nonce } = validation.data;

    // Verify the signature
    const isValid = await authService.verifySignature({
      walletAddress,
      message,
      signature,
      nonce,
    });

    if (!isValid) {
      return res.status(401).json({
        error: {
          code: 'INVALID_SIGNATURE',
          message: 'Signature verification failed',
        },
      });
    }

    // Generate JWT token
    const token = authService.generateToken(walletAddress);

    // Store session
    await authService.createSession(token, walletAddress);

    res.json({
      success: true,
      token,
      user: {
        walletAddress,
      },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /auth/logout
 * Invalidate the current session
 */
router.post('/logout', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (authHeader && authHeader.startsWith('Bearer ')) {
      const token = authHeader.substring(7);
      await authService.invalidateSession(token);
    }

    res.json({
      success: true,
      message: 'Logged out successfully',
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /auth/me
 * Get current authenticated user
 */
router.get('/me', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'No authentication token provided',
        },
      });
    }

    const token = authHeader.substring(7);
    const user = authService.getUserFromToken(token);

    if (!user) {
      return res.status(401).json({
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid or expired token',
        },
      });
    }

    // Check if session is still valid
    if (!(await authService.isSessionValid(token))) {
      return res.status(401).json({
        error: {
          code: 'SESSION_EXPIRED',
          message: 'Session has expired',
        },
      });
    }

    res.json({
      authenticated: true,
      user,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /auth/refresh
 * Refresh the JWT token
 */
router.post('/refresh', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const authHeader = req.headers.authorization;
    
    if (!authHeader || !authHeader.startsWith('Bearer ')) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'No authentication token provided',
        },
      });
    }

    const oldToken = authHeader.substring(7);
    const user = authService.getUserFromToken(oldToken);

    if (!user) {
      return res.status(401).json({
        error: {
          code: 'INVALID_TOKEN',
          message: 'Invalid or expired token',
        },
      });
    }

    // Invalidate old session
    await authService.invalidateSession(oldToken);

    // Generate new token
    const newToken = authService.generateToken(user.walletAddress);
    await authService.createSession(newToken, user.walletAddress);

    res.json({
      success: true,
      token: newToken,
      user,
    });
  } catch (error) {
    next(error);
  }
});

export { router as authRoutes };
