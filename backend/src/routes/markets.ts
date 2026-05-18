import { Router } from 'express';
import { MarketService } from '../services/marketService';
import { marketsListCache } from '../services/marketsListCache';
import { wsEventEmitter } from '../websocket/server';
import { z } from 'zod';

const router = Router();
const marketService = new MarketService();

const createMarketSchema = z.object({
  title: z.string().min(1).max(200),
  description: z.string().min(1).max(1000),
  category: z.enum(['crypto', 'politics', 'sports', 'technology', 'economics', 'culture']),
  endDate: z.string().datetime(),
  outcomes: z.array(z.string().min(1).max(100)).min(2).max(10),
});

router.get('/', async (req, res, next) => {
  try {
    const { category, status, search, quoteSymbol, limit = 20, offset = 0 } = req.query;
    const result = await marketsListCache.getMarkets({
      category: category as string,
      status: status as string,
      search: search as string,
      quoteSymbol: quoteSymbol as string,
      limit: Math.min(Number(limit), 50),
      offset: Number(offset),
    });
    res.json({ markets: result.markets, total: result.total });
  } catch (error) {
    next(error);
  }
});

router.get('/:marketId', async (req, res, next) => {
  try {
    const market = await marketService.getMarketById(req.params.marketId);
    if (!market) {
      return res.status(404).json({ error: 'Market not found' });
    }
    res.json({ market });
  } catch (error) {
    next(error);
  }
});

router.post('/', async (req, res, next) => {
  try {
    // Extended schema that accepts both category as number or string
    const extendedSchema = z.object({
      marketAddress: z.string(),
      marketId: z.string(),
      creator: z.string(),
      title: z.string().min(1).max(200),
      description: z.string().min(1).max(1000),
      imageUrl: z.string().url().max(500).nullable().optional(), // Supabase Storage URL
      category: z.union([
        z.number().int().min(0).max(6), // Accept number (0-6, including 'other')
        z.enum(['crypto', 'politics', 'sports', 'technology', 'economics', 'culture', 'other']), // Or string enum
      ]),
      endDate: z.string().datetime(),
      outcomes: z.array(z.union([
        z.string().min(1).max(100),
        z.object({
          label: z.string().min(1).max(100),
          imageUrl: z.string().max(500).nullable().optional(),
          subtitle: z.string().max(200).nullable().optional(),
        }),
      ])).min(2).max(10),
      initialCollateral: z.string().optional(),
      quoteMint: z.string().min(32).max(44).optional(),
      quoteDecimals: z.number().int().min(0).max(18).optional(),
      quoteSymbol: z.string().min(1).max(16).optional(),
    });

    const fullData = extendedSchema.parse(req.body);
    
    // Map category to number (handle both string and number)
    const categoryMap: Record<string, number> = {
      crypto: 0,
      politics: 1,
      sports: 2,
      technology: 3,
      economics: 4,
      culture: 5,
      other: 6,
    };
    
    let categoryNumber: number;
    if (typeof fullData.category === 'number') {
      categoryNumber = fullData.category;
    } else {
      categoryNumber = categoryMap[fullData.category] ?? 0;
    }
    
    const market = await marketService.createMarket({
      marketAddress: fullData.marketAddress,
      marketId: fullData.marketId,
      creator: fullData.creator,
      title: fullData.title,
      description: fullData.description,
      imageUrl: fullData.imageUrl || null,
      category: categoryNumber,
      endDate: new Date(fullData.endDate),
      outcomes: fullData.outcomes.map((item, id) => {
        if (typeof item === 'string') {
          return { id, label: item, openInterest: '0' };
        }
        return {
          id,
          label: item.label,
          openInterest: '0',
          imageUrl: item.imageUrl || null,
          subtitle: item.subtitle || null,
        };
      }),
      initialCollateral: fullData.initialCollateral,
      quoteMint: fullData.quoteMint,
      quoteDecimals: fullData.quoteDecimals,
      quoteSymbol: fullData.quoteSymbol,
    });
    
    // Emit WebSocket event for new market
    console.log('[MarketRoutes] Emitting market_update event for new market:', market.id, market.title);
    wsEventEmitter.emit('market_update', {
      type: 'created',
      market,
      timestamp: new Date().toISOString(),
    });

    marketsListCache.invalidateAll().catch(() => {});

    res.status(201).json({ market });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    next(error);
  }
});

// New route to sync market from blockchain
router.post('/:marketAddress/sync', async (req, res, next) => {
  try {
    const market = await marketService.syncMarketFromBlockchain(req.params.marketAddress);
    if (!market) {
      return res.status(404).json({ error: 'Market not found' });
    }
    res.json({ market });
  } catch (error) {
    next(error);
  }
});

router.get('/:marketId/orderbook', async (req, res, next) => {
  try {
    const { outcomeId } = req.query;
    const orderbook = await marketService.getOrderBook(req.params.marketId, outcomeId as string);
    res.json({ orderbook });
  } catch (error) {
    next(error);
  }
});

router.post('/:marketId/resolve', async (req, res, next) => {
  try {
    const { outcomeId, resolutionSource } = req.body;
    const market = await marketService.resolveMarket(req.params.marketId, outcomeId, resolutionSource);
    
    // Emit WebSocket event for market resolution
    wsEventEmitter.emit('market_update', {
      type: 'resolved',
      market,
      timestamp: new Date().toISOString(),
    });

    marketsListCache.invalidateAll().catch(() => {});

    res.json({ market });
  } catch (error) {
    next(error);
  }
});

// Update market status from on-chain data
router.patch('/:marketAddress/status', async (req, res, next) => {
  try {
    const updateSchema = z.object({
      status: z.number().int().min(0).max(4),
      resolvedOutcome: z.number().int().min(0).nullable().optional(),
      resolutionSource: z.string().nullable().optional(),
      resolveSlot: z.string().nullable().optional(),
      challengeBond: z.string().optional(),
      challenger: z.string().nullable().optional(),
    });

    const data = updateSchema.parse(req.body);
    const market = await marketService.updateMarketStatus(req.params.marketAddress, data);
    
    if (!market) {
      return res.status(404).json({ error: 'Market not found' });
    }
    
    // Emit WebSocket event for market update
    wsEventEmitter.emit('market_update', {
      type: 'updated',
      market,
      timestamp: new Date().toISOString(),
    });

    marketsListCache.invalidateAll().catch(() => {});

    res.json({ market, message: 'Market status updated successfully' });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    next(error);
  }
});

export { router as marketRoutes };


