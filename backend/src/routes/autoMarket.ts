import { Router, Request, Response } from 'express';
import { z } from 'zod';
import { binancePriceService } from '../services/binancePriceService';
import { autoMarketSchedulerService } from '../services/autoMarketSchedulerService';
import { autoMarketKeeperService } from '../services/autoMarketKeeperService';
import { requireAuth } from '../middleware/authMiddleware';
import { requireAdmin } from '../middleware/adminMiddleware';
import { Market } from '../models/Market';
import { Op } from 'sequelize';

const router = Router();

/** GET /api/auto-market/prices — current Binance prices */
router.get('/prices', (_req: Request, res: Response) => {
  const prices = binancePriceService.getAllPrices();
  res.json({ prices });
});

/** GET /api/auto-market/prices/:symbol — single symbol price */
router.get('/prices/:symbol', (req: Request, res: Response) => {
  const data = binancePriceService.getPrice(req.params.symbol.toLowerCase());
  if (!data) return res.status(404).json({ error: 'Price not available or stale' });
  res.json(data);
});

/** GET /api/auto-market/markets — list auto-created markets */
router.get('/markets', async (req: Request, res: Response) => {
  try {
    const { status, symbol, timeframe } = req.query;
    const where: any = { autoResolve: true };
    if (status !== undefined) where.status = parseInt(status as string);
    if (symbol) where.priceFeed = (symbol as string).toLowerCase();
    if (timeframe) where.timeframeSecs = parseInt(timeframe as string);

    const markets = await Market.findAll({
      where,
      order: [['createdAt', 'DESC']],
      limit: 50,
    });
    res.json({ markets });
  } catch (e: any) {
    res.status(500).json({ error: e.message });
  }
});

const createSeededSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(1000),
  category: z.number().int().min(0).max(9),
  /** Unix seconds when the market ends. */
  endDate: z.number().int().positive(),
  outcomes: z.array(z.string().min(1).max(100)).min(2).max(10),
  resolutionType: z.number().int().min(0).max(2).default(1),
  /** Human-readable quote amount to seed the market vault with. */
  initialCollateral: z.number().positive(),
  quoteToken: z.enum(['USDC', 'SPACE']).default('USDC'),
});

/**
 * POST /api/auto-market/create-seeded — admin-triggered on-demand market
 * creation with orderbook seeding. Uses the auto-keeper's wallet; picks
 * quote token by `quoteToken` ('USDC' | 'SPACE').
 */
router.post(
  '/create-seeded',
  requireAuth,
  requireAdmin,
  async (req: Request, res: Response, next) => {
    try {
      const data = createSeededSchema.parse(req.body);

      if (!autoMarketKeeperService.isReady) {
        const ok = await autoMarketKeeperService.initialize();
        if (!ok) {
          return res.status(503).json({
            error: { code: 'KEEPER_UNAVAILABLE', message: 'Auto keeper not initialized' },
          });
        }
      }

      const { marketPDA, seedOrderIds } = await autoMarketKeeperService.createAndSeedMarket({
        title: data.title,
        description: data.description,
        category: data.category,
        endDate: data.endDate,
        outcomes: data.outcomes,
        resolutionType: data.resolutionType,
        initialCollateral: data.initialCollateral,
        quoteToken: data.quoteToken,
      });

      res.json({
        success: true,
        data: {
          marketPDA: marketPDA.toBase58(),
          seedOrderIds,
          quoteToken: data.quoteToken,
        },
      });
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        return res.status(400).json({
          error: { code: 'VALIDATION_ERROR', message: 'Invalid input', details: error.errors },
        });
      }
      next(error);
    }
  },
);

/** POST /api/auto-market/scheduler/start — start the scheduler (admin) */
router.post('/scheduler/start', (_req: Request, res: Response) => {
  autoMarketSchedulerService.start();
  res.json({ status: 'started' });
});

/** POST /api/auto-market/scheduler/stop — stop the scheduler (admin) */
router.post('/scheduler/stop', (_req: Request, res: Response) => {
  autoMarketSchedulerService.stop();
  res.json({ status: 'stopped' });
});

export const autoMarketRoutes = router;
