import { Router, Request, Response, NextFunction } from 'express';
import { commentService } from '../services/commentService';
import { authService } from '../services/authService';
import { z } from 'zod';
import { Market } from '../models/Market';

const router = Router();

// Extract wallet from token (optional - returns null if not authenticated)
const optionalAuth = (req: Request, _res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (authHeader?.startsWith('Bearer ')) {
    const token = authHeader.substring(7);
    const user = authService.getUserFromToken(token);
    if (user && authService.isSessionValid(token)) {
      (req as any).walletAddress = user.walletAddress;
    }
  }
  next();
};

const requireAuth = (req: Request, res: Response, next: NextFunction) => {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'No authentication token provided' } });
  }
  const token = authHeader.substring(7);
  const user = authService.getUserFromToken(token);
  if (!user || !authService.isSessionValid(token)) {
    return res.status(401).json({ error: { code: 'INVALID_TOKEN', message: 'Invalid or expired token' } });
  }
  (req as any).walletAddress = user.walletAddress;
  next();
};

const createCommentSchema = z.object({
  text: z.string().min(1).max(500),
});

const paginationSchema = z.object({
  limit: z.coerce.number().min(1).max(100).optional().default(50),
  offset: z.coerce.number().min(0).optional().default(0),
});

/**
 * Cache for market address → database ID lookups.
 * Avoids repeated DB queries for the same market address.
 */
const marketIdCache = new Map<string, { id: number; expires: number }>();
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Resolve a market identifier (numeric ID or market address) to a numeric database ID.
 * Only treats the param as numeric if it is purely digits (prevents parseInt parsing
 * leading digits from base58 addresses like "7GXD..." → 7).
 */
async function resolveMarketId(param: string): Promise<number | null> {
  // Only treat as numeric if the entire string is digits
  if (/^\d+$/.test(param)) {
    const numericId = parseInt(param, 10);
    // Validate the market actually exists
    const market = await Market.findOne({
      where: { id: numericId },
      attributes: ['id'],
    });
    return market ? market.id : null;
  }

  // Treat as market address — check in-memory cache first
  const cached = marketIdCache.get(param);
  if (cached && cached.expires > Date.now()) {
    return cached.id;
  }

  const market = await Market.findOne({
    where: { marketAddress: param },
    attributes: ['id'],
  });

  if (market) {
    marketIdCache.set(param, { id: market.id, expires: Date.now() + CACHE_TTL });
    return market.id;
  }

  return null;
}


/**
 * GET /comments/:marketId
 * Get comments for a market
 */
router.get('/:marketId', optionalAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const marketId = await resolveMarketId(req.params.marketId);
    if (marketId === null) {
      return res.status(400).json({ error: { code: 'INVALID_MARKET_ID', message: 'Invalid market ID' } });
    }

    const { limit, offset } = paginationSchema.parse(req.query);
    const wallet = (req as any).walletAddress || null;
    const result = await commentService.getComments(marketId, wallet, limit, offset);

    res.json({ success: true, data: result });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /comments/:marketId
 * Create a comment on a market
 */
router.post('/:marketId', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const marketId = await resolveMarketId(req.params.marketId);
    if (marketId === null) {
      return res.status(400).json({ error: { code: 'INVALID_MARKET_ID', message: 'Invalid market ID' } });
    }

    const validation = createCommentSchema.safeParse(req.body);
    if (!validation.success) {
      return res.status(400).json({ error: { code: 'INVALID_REQUEST', message: 'Comment text is required (max 500 chars)' } });
    }

    const wallet = (req as any).walletAddress;
    const comment = await commentService.createComment(marketId, wallet, validation.data.text);

    res.status(201).json({ success: true, data: comment });
  } catch (error) {
    next(error);
  }
});

/**
 * DELETE /comments/:commentId
 * Delete own comment
 */
router.delete('/:commentId', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const commentId = parseInt(req.params.commentId);
    if (isNaN(commentId)) {
      return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid comment ID' } });
    }

    const wallet = (req as any).walletAddress;
    const deleted = await commentService.deleteComment(commentId, wallet);

    if (!deleted) {
      return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Comment not found or not yours' } });
    }

    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /comments/:commentId/star
 * Star a comment
 */
router.post('/:commentId/star', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const commentId = parseInt(req.params.commentId);
    if (isNaN(commentId)) {
      return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid comment ID' } });
    }

    const wallet = (req as any).walletAddress;
    const result = await commentService.starComment(commentId, wallet);

    if (!result.success) {
      return res.status(400).json({ error: { code: 'STAR_FAILED', message: 'Already starred or comment not found' } });
    }

    res.json({ success: true, stars: result.stars });
  } catch (error) {
    next(error);
  }
});

/**
 * POST /comments/:commentId/report
 * Report a comment
 */
router.post('/:commentId/report', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const commentId = parseInt(req.params.commentId);
    if (isNaN(commentId)) {
      return res.status(400).json({ error: { code: 'INVALID_ID', message: 'Invalid comment ID' } });
    }

    const wallet = (req as any).walletAddress;
    const result = await commentService.reportComment(commentId, wallet);

    if (!result.success) {
      return res.status(400).json({ error: { code: 'REPORT_FAILED', message: 'Already reported or comment not found' } });
    }

    res.json({ success: true, deleted: result.deleted });
  } catch (error) {
    next(error);
  }
});

export { router as commentRoutes };
