import { Router } from 'express';
import { OrderBookService } from '../services/orderBookService';
import { OrderMatchingService } from '../services/orderMatchingService';

const router = Router();
const orderBookService = new OrderBookService();
const orderMatchingService = new OrderMatchingService();

// GET /api/v1/orderbook/:marketId/:outcomeId - Get order book
// Optional query param: tokenType=yes|no (filters YES or NO order book)
router.get('/:marketId/:outcomeId', async (req, res, next) => {
  try {
    const { marketId, outcomeId } = req.params;
    const depth = parseInt(req.query.depth as string) || 100;
    const tokenType = req.query.tokenType as 'yes' | 'no' | undefined;

    const orderBook = await orderBookService.getOrderBook(
      marketId,
      parseInt(outcomeId),
      depth,
      tokenType
    );

    res.json({ orderBook });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/orderbook/:marketId/:outcomeId/price - Get current market price
router.get('/:marketId/:outcomeId/price', async (req, res, next) => {
  try {
    const { marketId, outcomeId } = req.params;
    const tokenType = req.query.tokenType as 'yes' | 'no' | undefined;

    const price = await orderBookService.getMarketPrice(
      marketId,
      parseInt(outcomeId),
      tokenType
    );

    res.json({ price });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/orderbook/:marketId/:outcomeId/match - Manually trigger order matching
router.post('/:marketId/:outcomeId/match', async (req, res, next) => {
  try {
    const { marketId, outcomeId } = req.params;

    const matches = await orderMatchingService.matchMarketOrders(
      marketId,
      parseInt(outcomeId)
    );

    res.json({ 
      success: true, 
      matches: matches.length,
      message: `Matched ${matches.length} order pairs` 
    });
  } catch (error) {
    next(error);
  }
});

export { router as orderBookRoutes };

