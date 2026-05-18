import { Request, Response, NextFunction } from 'express';

/**
 * Get admin wallet addresses from environment variable
 * Format: ADMIN_WALLETS=wallet1,wallet2,wallet3
 */
function getAdminWallets(): string[] {
  const env = process.env.ADMIN_WALLETS || '';
  return env.split(',').map(w => w.trim()).filter(Boolean);
}

/**
 * Middleware to require admin access
 * Must be chained AFTER requireAuth
 */
export const requireAdmin = (req: Request, res: Response, next: NextFunction) => {
  if (!req.user) {
    return res.status(401).json({
      error: {
        code: 'UNAUTHORIZED',
        message: 'Authentication required',
      },
    });
  }

  const adminWallets = getAdminWallets();

  if (adminWallets.length === 0) {
    console.warn('[AdminMiddleware] ADMIN_WALLETS env var not set');
    return res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: 'Admin access not configured',
      },
    });
  }

  if (!adminWallets.includes(req.user.walletAddress)) {
    return res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message: 'Admin access required',
      },
    });
  }

  next();
};
