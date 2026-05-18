import { Router } from 'express';
import { OrderService } from '../services/orderService';
import { Order } from '../models/Order';
import { Market } from '../models/Market';
import { z } from 'zod';

const router = Router();
const orderService = new OrderService();

// Default to USDC so legacy markets without the v2 columns still render.
const DEFAULT_QUOTE_DECIMALS = 6;
const DEFAULT_QUOTE_SYMBOL = 'USDC';

function formatOrderResponse(order: any) {
  const market = order.market;
  return {
    id: order.id,
    marketId: order.marketId,
    outcomeId: order.outcomeId,
    side: order.side,
    type: order.type,
    price: order.price,
    size: order.getSizeBigInt().toString(),
    filled: order.getFilledBigInt().toString(),
    avgFillPrice: order.avgFillPrice || null,
    leverage: order.leverage,
    status: order.status,
    userId: order.userId,
    orderId: order.orderId || null,
    onChainOrder: order.onChainOrder || null,
    tokenType: order.tokenType || 'yes',
    quoteMint: market?.quoteMint ?? null,
    quoteDecimals: market?.quoteDecimals ?? DEFAULT_QUOTE_DECIMALS,
    quoteSymbol: market?.quoteSymbol ?? DEFAULT_QUOTE_SYMBOL,
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
  };
}

// Schema matching frontend request format
const placeOrderSchema = z.object({
  market_id: z.string(),
  outcome_id: z.union([z.string(), z.number()]),
  side: z.enum(['yes', 'no', 'buy', 'sell']), // Support both formats
  size: z.number().positive(),
  leverage: z.number().min(1).max(10).default(1),
  price: z.number().optional(), // For limit orders
  token_type: z.enum(['yes', 'no']).optional().default('yes'), // YES or NO shares
});

// POST /api/v1/orders/market - Market order
// Market orders accept USDC amount and calculate quantity based on market price
// The actual trade happens on-chain, then we store it in the database
router.post('/market', async (req, res, next) => {
  try {
    const data = placeOrderSchema.extend({
      price: z.number().optional(), // Execution price (optional, will be calculated if not provided)
      on_chain_order: z.string().min(1, 'on_chain_order is required for market orders'), // On-chain pending order PDA address (required)
      order_id: z.number().positive('order_id is required for market orders'), // On-chain order ID (required)
    }).parse(req.body);
    
    // Get optional authentication headers (for tracking)
    const signature = req.headers.authorization?.replace('Bearer ', '');
    const pubkey = req.headers['x-pubkey'] as string;
    const message = req.headers['x-message'] as string;
    
    // Convert side format: 'yes'/'no' -> 'buy'/'sell'
    const side = data.side === 'yes' || data.side === 'buy' ? 'buy' : 'sell';
    
    const order = await orderService.placeOrder({
      marketId: data.market_id,
      outcomeId: data.outcome_id.toString(),
      side,
      type: 'market',
      amount: data.size,
      leverage: data.leverage,
      price: data.price, // Execution price (calculated from market price + slippage)
      pubkey: pubkey || 'unknown',
      signature: signature || '',
      message: message || '',
      onChainOrder: data.on_chain_order,
      orderId: data.order_id,
      tokenType: data.token_type || 'yes',
    });

    res.status(201).json({
      order_id: order.id,
      order: formatOrderResponse(order)
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    next(error);
  }
});

// POST /api/v1/orders/limit - Limit order
// Note: This is for tracking purposes only. The actual trade happens on-chain.
// Authentication headers are optional since the trade is already executed on-chain.
router.post('/limit', async (req, res, next) => {
  try {
    const data = placeOrderSchema.extend({
      price: z.number().positive(), // Required for limit orders
    }).parse(req.body);
    
    // Get optional authentication headers (for tracking)
    const signature = req.headers.authorization?.replace('Bearer ', '');
    const pubkey = req.headers['x-pubkey'] as string;
    const message = req.headers['x-message'] as string;
    
    // Convert side format: 'yes'/'no' -> 'buy'/'sell'
    const side = data.side === 'yes' || data.side === 'buy' ? 'buy' : 'sell';
    
    // For limit orders, create order and try to match immediately
    // Check if on-chain order address was provided (from frontend)
    const onChainOrder = req.body.on_chain_order as string | undefined;
    const orderId = req.body.order_id as number | undefined;
    
    const order = await orderService.placeOrder({
      marketId: data.market_id,
      outcomeId: data.outcome_id.toString(),
      side,
      type: 'limit',
      price: data.price,
      amount: data.size,
      leverage: data.leverage,
      pubkey: pubkey || 'unknown',
      signature: signature || '',
      message: message || '',
      onChainOrder,
      orderId,
      tokenType: data.token_type || 'yes',
    });
    
    // Fetch the updated order after matching
    const updatedOrder = await orderService.getOrderById(order.id);
    const finalOrder = updatedOrder || order;
    
    res.status(201).json({ 
      order_id: finalOrder.id, 
      order: formatOrderResponse(finalOrder),
      message: 'Limit order created. It will be executed when matched with an opposite order.'
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    next(error);
  }
});

// Legacy route for backward compatibility
router.post('/', async (req, res, next) => {
  try {
    const legacySchema = z.object({
      marketId: z.string(),
      outcomeId: z.string(),
      side: z.enum(['buy', 'sell']),
      type: z.enum(['market', 'limit']),
      price: z.number().optional(),
      amount: z.number().positive(),
      leverage: z.number().min(1).max(10).default(1),
    });
    
    const data = legacySchema.parse(req.body);
    const order = await orderService.placeOrder({
      ...data,
      pubkey: req.headers['x-pubkey'] as string,
      signature: req.headers.authorization?.replace('Bearer ', ''),
      message: req.headers['x-message'] as string,
    });
    res.status(201).json({ order });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    next(error);
  }
});

router.get('/:orderId', async (req, res, next) => {
  try {
    const order = await orderService.getOrderById(req.params.orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    res.json({ order: formatOrderResponse(order) });
  } catch (error) {
    next(error);
  }
});

router.delete('/:orderId', async (req, res, next) => {
  try {
    const pubkey = req.headers['x-pubkey'] as string;
    const { order, unlockedAmount } = await orderService.cancelOrder(req.params.orderId, pubkey);
    
    res.json({ 
      success: true,
      order: formatOrderResponse(order),
      unlockedAmount: unlockedAmount.toString(),
      message: `Order cancelled. Unlock ${(Number(unlockedAmount) / 1e6).toFixed(2)} USDC margin on-chain.`
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/orders/user/:pubkey
// Get all orders for a user, optionally filtered by status
// Supports pagination: ?limit=50&offset=0
router.get('/user/:pubkey', async (req, res, next) => {
  try {
    const pubkey = req.params.pubkey;
    const { status, limit: limitParam, offset: offsetParam } = req.query;

    const statusArray = status
      ? (Array.isArray(status) ? status : [status]) as string[]
      : undefined;

    const limit = limitParam ? Math.min(parseInt(limitParam as string) || 50, 100) : undefined;
    const offset = offsetParam ? parseInt(offsetParam as string) || 0 : undefined;

    const paginationOpts = limit !== undefined || offset !== undefined
      ? { limit, offset }
      : undefined;

    const { orders, total } = await orderService.getUserOrders(pubkey, statusArray, paginationOpts);

    res.json({
      orders: orders.map(formatOrderResponse),
      ...(paginationOpts && {
        pagination: {
          total,
          limit: limit || 50,
          offset: offset || 0,
          hasMore: (offset || 0) + (limit || 50) < total,
        },
      }),
    });
  } catch (error) {
    next(error);
  }
});

// GET /api/v1/orders/user/:pubkey/pending-execution
// Get orders that are matched but not yet executed on-chain
router.get('/user/:pubkey/pending-execution', async (req, res, next) => {
  try {
    const pubkey = req.params.pubkey;
    const orders = await orderService.getPendingExecutionOrders(pubkey);
    
    res.json({ 
      orders: orders.map(formatOrderResponse)
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/orders/:orderId/mark-executed
// Mark an order as executed on-chain
router.post('/:orderId/mark-executed', async (req, res, next) => {
  try {
    const pubkey = req.headers['x-pubkey'] as string;
    const { executedAmount } = req.body;
    
    const order = await orderService.markOrderExecuted(req.params.orderId, pubkey, executedAmount);
    
    if (!order) {
      return res.status(404).json({ error: 'Order not found or unauthorized' });
    }
    
    res.json({ 
      success: true,
      order: formatOrderResponse(order),
      message: 'Order marked as executed on-chain'
    });
  } catch (error) {
    next(error);
  }
});

// POST /api/v1/orders/:orderId/update-onchain
// Update an existing order with on-chain order data (for orders that were created without it)
router.post('/:orderId/update-onchain', async (req, res, next) => {
  try {
    const pubkey = req.headers['x-pubkey'] as string;
    const { on_chain_order, order_id } = z.object({
      on_chain_order: z.string().min(1),
      order_id: z.number().positive(),
    }).parse(req.body);
    
    const order = await orderService.getOrderById(req.params.orderId);
    if (!order) {
      return res.status(404).json({ error: 'Order not found' });
    }
    
    // Verify ownership
    if (order.userId !== pubkey) {
      return res.status(403).json({ error: 'Unauthorized' });
    }
    
    // Update order with on-chain data
    await Order.update(
      {
        onChainOrder: on_chain_order,
        orderId: order_id,
      },
      {
        where: { id: req.params.orderId },
      }
    );
    
    // Fetch updated order
    const updatedOrder = await orderService.getOrderById(req.params.orderId);
    
    res.json({
      success: true,
      order: formatOrderResponse(updatedOrder!),
      message: 'Order updated with on-chain data'
    });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: 'Validation error', details: error.errors });
    }
    next(error);
  }
});

export { router as orderRoutes };


