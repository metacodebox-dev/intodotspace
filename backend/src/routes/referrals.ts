import { Router, Request, Response, NextFunction } from 'express';
import { referralService } from '../services/referralService';
import { authService } from '../services/authService';
import { z } from 'zod';

const router = Router();

// Middleware to extract wallet address from token
const authenticateRequest = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({
      error: { code: 'UNAUTHORIZED', message: 'No authentication token provided' },
    });
  }

  const token = authHeader.substring(7);
  const user = authService.getUserFromToken(token);

  if (!user || !authService.isSessionValid(token)) {
    return res.status(401).json({
      error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' },
    });
  }

  (req as any).walletAddress = user.walletAddress;
  next();
};

// Validation schemas
const applyReferralSchema = z.object({
  referralCode: z.string().min(4).max(16),
});

const paginationSchema = z.object({
  limit: z.coerce.number().min(1).max(100).optional().default(20),
  offset: z.coerce.number().min(0).optional().default(0),
});

/**
 * GET /referrals/points
 * Get current user's points and level info
 */
router.get('/points', authenticateRequest, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const walletAddress = (req as any).walletAddress;
    const pointsInfo = await referralService.getOrCreateUserPoints(walletAddress);
    const rank = await referralService.getUserRank(walletAddress);

    res.json({
      success: true,
      data: { ...pointsInfo, rank },
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /referrals/stats
 * Get user's referral statistics
 */
router.get('/stats', authenticateRequest, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const walletAddress = (req as any).walletAddress;
    const validation = paginationSchema.safeParse(req.query);
    
    const { limit, offset } = validation.success ? validation.data : { limit: 20, offset: 0 };
    const stats = await referralService.getReferralStats(walletAddress, limit, offset);

    res.json({
      success: true,
      data: stats,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /referrals/apply
 * Apply a referral code
 */
router.post('/apply', authenticateRequest, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const walletAddress = (req as any).walletAddress;
    const validation = applyReferralSchema.safeParse(req.body);

    if (!validation.success) {
      return res.status(400).json({
        error: { code: 'INVALID_REQUEST', message: 'Invalid referral code format' },
      });
    }

    const { referralCode } = validation.data;
    const result = await referralService.applyReferralCode(walletAddress, referralCode);

    if (!result.success) {
      return res.status(400).json({
        error: { code: 'REFERRAL_FAILED', message: result.message },
      });
    }

    res.json({
      success: true,
      message: result.message,
      pointsEarned: result.pointsEarned,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /referrals/dismiss
 * Mark user as not new (dismiss referral modal)
 */
router.post('/dismiss', authenticateRequest, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const walletAddress = (req as any).walletAddress;
    await referralService.markUserAsNotNew(walletAddress);

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /referrals/daily-bonus
 * Claim daily login bonus
 */
router.post('/daily-bonus', authenticateRequest, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const walletAddress = (req as any).walletAddress;
    const result = await referralService.claimDailyBonus(walletAddress);

    if (!result.success) {
      return res.status(400).json({
        error: { code: 'BONUS_FAILED', message: result.message },
      });
    }

    res.json({
      success: true,
      points: result.points,
      message: result.message,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /referrals/validate/:code
 * Validate a referral code (public endpoint)
 */
router.get('/validate/:code', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const { code } = req.params;
    const result = await referralService.validateReferralCode(code);

    res.json({
      success: true,
      valid: result.valid,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /referrals/leaderboard
 * Get points leaderboard
 */
router.get('/leaderboard', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const validation = paginationSchema.safeParse(req.query);
    const { limit, offset } = validation.success ? validation.data : { limit: 100, offset: 0 };
    
    const leaderboard = await referralService.getLeaderboard(limit, offset);

    res.json({
      success: true,
      data: leaderboard,
    });
  } catch (error) {
    next(error);
  }
});

/**
 * GET /referrals/config
 * Get points and level configuration (public)
 */
router.get('/config', async (req: Request, res: Response, next: NextFunction) => {
  try {
    res.json({
      success: true,
      levels: referralService.getLevelThresholds(),
      points: referralService.getPointsConfig(),
    });
  } catch (error) {
    next(error);
  }
});

export { router as referralRoutes };
