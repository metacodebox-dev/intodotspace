import { Order } from '../models/Order';
import { Op } from 'sequelize';

export interface OrderBookLevel {
  price: number; // Basis points
  size: number; // Total size at this price level
  orders: number; // Number of orders at this price
}

export interface OrderBook {
  bids: OrderBookLevel[]; // Buy orders (sorted descending by price)
  asks: OrderBookLevel[]; // Sell orders (sorted ascending by price)
  lastPrice?: number; // Last traded price
  spread?: number; // Spread in basis points
}

export class OrderBookService {
  /**
   * Get order book for a market and outcome
   * Production-optimized with efficient queries and indexing
   */
  async getOrderBook(marketId: string, outcomeId: number, depth: number = 100, tokenType?: 'yes' | 'no'): Promise<OrderBook> {
    const openStatuses = ['open', 'partially_filled', 'pending'];

    // Build where clause - optionally filter by tokenType for YES/NO order book separation
    const baseWhere: any = {
      marketId,
      outcomeId,
      status: { [Op.in]: openStatuses },
      type: 'limit', // Only limit orders in order book
    };
    if (tokenType) {
      baseWhere.tokenType = tokenType;
    }

    // Use Promise.all for parallel queries (faster)
    const [bids, asks] = await Promise.all([
      // Get buy orders (bids) - sorted by price descending
      Order.findAll({
        where: { ...baseWhere, side: 'buy' },
        order: [['price', 'DESC'], ['createdAt', 'ASC']], // Price first, then FIFO
        limit: depth * 10, // Get more to aggregate
        attributes: ['price', 'size', 'filled', 'id'], // Only fetch needed fields
      }),
      // Get sell orders (asks) - sorted by price ascending
      Order.findAll({
        where: { ...baseWhere, side: 'sell' },
        order: [['price', 'ASC'], ['createdAt', 'ASC']], // Price first, then FIFO
        limit: depth * 10, // Get more to aggregate
        attributes: ['price', 'size', 'filled', 'id'], // Only fetch needed fields
      }),
    ]);

    // Aggregate bids by price level (descending - highest first)
    const bidLevels = this.aggregateByPrice(bids, depth, 'desc');
    
    // Aggregate asks by price level (ascending - lowest first)
    const askLevels = this.aggregateByPrice(asks, depth, 'asc');

    // Calculate spread
    const spread = bidLevels.length > 0 && askLevels.length > 0
      ? askLevels[0].price - bidLevels[0].price
      : undefined;

    // Get last traded price (from filled orders), filtered by tokenType if provided
    const lastOrderWhere: any = {
      marketId,
      outcomeId,
      status: 'filled',
    };
    if (tokenType) {
      lastOrderWhere.tokenType = tokenType;
    }
    const lastOrder = await Order.findOne({
      where: lastOrderWhere,
      order: [['updatedAt', 'DESC']],
    });

    // Use avgFillPrice (actual execution price) when available.
    // For market sell orders (leveraged close), order.price = min_price (e.g. 1¢) which is NOT
    // the actual fill price. avgFillPrice is set by the keeper to the real execution price.
    // If avgFillPrice is not available, only use order.price for buy orders (where price = bid price).
    // For sell orders without avgFillPrice, skip — the mid-price fallback is more accurate.
    let lastPrice: number | undefined;
    if (lastOrder) {
      const avgFill = (lastOrder as any).avgFillPrice;
      if (avgFill && avgFill > 0) {
        lastPrice = avgFill;
      } else if (lastOrder.side === 'buy') {
        lastPrice = lastOrder.price;
      }
      // else: sell order without avgFillPrice — skip, let mid-price handle it
    }

    return {
      bids: bidLevels,
      asks: askLevels,
      lastPrice,
      spread,
    };
  }

  /**
   * Aggregate orders by price level
   */
  private aggregateByPrice(orders: Order[], maxLevels: number, sortOrder: 'asc' | 'desc' = 'desc'): OrderBookLevel[] {
    const priceMap = new Map<number, { size: number; orders: number }>();

    for (const order of orders) {
      const remaining = order.getSizeBigInt() - order.getFilledBigInt();
      if (remaining > 0) {
        const existing = priceMap.get(order.price) || { size: 0, orders: 0 };
        priceMap.set(order.price, {
          size: existing.size + Number(remaining),
          orders: existing.orders + 1,
        });
      }
    }

    // Convert to array and sort
    const levels: OrderBookLevel[] = Array.from(priceMap.entries())
      .map(([price, data]) => ({
        price,
        size: data.size,
        orders: data.orders,
      }))
      .sort((a, b) => {
        // Sort based on direction: desc for bids (highest first), asc for asks (lowest first)
        return sortOrder === 'desc' ? b.price - a.price : a.price - b.price;
      })
      .slice(0, maxLevels);

    return levels;
  }

  /**
   * Calculate current market price from order book
   * Priority: 1) Mid-price of bids/asks, 2) Best bid/ask, 3) Last traded price, 4) Default 50%
   * When active orders exist, they reflect current market state better than old trades.
   */
  async getMarketPrice(marketId: string, outcomeId: number, tokenType?: 'yes' | 'no'): Promise<number | null> {
    const orderBook = await this.getOrderBook(marketId, outcomeId, 1, tokenType);

    // Ensure bids are sorted descending (highest first) and asks ascending (lowest first)
    const sortedBids = [...orderBook.bids].sort((a, b) => b.price - a.price);
    const sortedAsks = [...orderBook.asks].sort((a, b) => a.price - b.price);

    // Priority 1: Mid-price when both bids and asks exist
    if (sortedBids.length > 0 && sortedAsks.length > 0) {
      const bestBid = sortedBids[0].price;
      const bestAsk = sortedAsks[0].price;
      return Math.floor((bestBid + bestAsk) / 2);
    }

    // Priority 2: Best bid if only bids exist
    if (sortedBids.length > 0) {
      return sortedBids[0].price;
    }

    // Priority 3: Best ask if only asks exist
    if (sortedAsks.length > 0) {
      return sortedAsks[0].price;
    }

    // Priority 4: Last traded price (fallback when no active orders)
    if (orderBook.lastPrice) {
      return orderBook.lastPrice;
    }

    // Default to 50% if no orders or trades
    return 5000;
  }

  /**
   * Match orders and return matches
   */
  async matchOrders(marketId: string, outcomeId: number): Promise<Array<{
    buyOrder: Order;
    sellOrder: Order;
    price: number;
    size: number;
  }>> {
    const matches: Array<{
      buyOrder: Order;
      sellOrder: Order;
      price: number;
      size: number;
    }> = [];

    // Get open buy orders (sorted by price descending, time ascending)
    const buyOrders = await Order.findAll({
      where: {
        marketId,
        outcomeId,
        side: 'buy',
        status: { [Op.in]: ['open', 'partially_filled', 'pending'] },
      },
      order: [
        ['price', 'DESC'], // Best price first
        ['createdAt', 'ASC'], // Oldest first (FIFO)
      ],
    });

    // Get open sell orders (sorted by price ascending, time ascending)
    const sellOrders = await Order.findAll({
      where: {
        marketId,
        outcomeId,
        side: 'sell',
        status: { [Op.in]: ['open', 'partially_filled', 'pending'] },
      },
      order: [
        ['price', 'ASC'], // Best price first
        ['createdAt', 'ASC'], // Oldest first (FIFO)
      ],
    });

    // Helper to get effective tokenType (default 'yes' for orders without it)
    const getTokenType = (order: Order): string => (order as any).tokenType || 'yes';

    // Match orders
    // Default slippage tolerance for market orders: 5% (0.05)
    const MARKET_ORDER_SLIPPAGE = 0.05;
    
    for (const buyOrder of buyOrders) {
      const buyRemaining = buyOrder.getSizeBigInt() - buyOrder.getFilledBigInt();
      if (buyRemaining <= 0) continue;

      for (const sellOrder of sellOrders) {
        const sellRemaining = sellOrder.getSizeBigInt() - sellOrder.getFilledBigInt();
        if (sellRemaining <= 0) continue;

        // Only match orders with the same tokenType (YES with YES, NO with NO)
        if (getTokenType(buyOrder) !== getTokenType(sellOrder)) continue;

        // Determine if orders can match
        let canMatch = false;
        let matchPrice: number = 0;
        
        if (buyOrder.type === 'market' && sellOrder.type === 'market') {
          // Both market orders - match at sell order price (conservative)
          canMatch = true;
          matchPrice = sellOrder.price;
        } else if (buyOrder.type === 'market') {
          // Market buy vs limit sell
          // Market buy should match if sell price is within slippage tolerance
          // Market buy at price P can match sell orders up to P * (1 + slippage)
          // Convert to basis points: P * (1 + 0.15) = P * 1.15 = P + (P * 0.15)
          const slippageBps = Math.floor(buyOrder.price * MARKET_ORDER_SLIPPAGE);
          const maxAcceptablePrice = Math.min(10000, buyOrder.price + slippageBps);
          if (sellOrder.price <= maxAcceptablePrice) {
            canMatch = true;
            matchPrice = sellOrder.price; // Match at maker's (limit sell) price
          }
        } else if (sellOrder.type === 'market') {
          // Limit buy vs market sell
          // Market sell should match if buy price is within slippage tolerance
          // Market sell at price P can match buy orders down to P * (1 - slippage)
          // Convert to basis points: P * (1 - 0.15) = P * 0.85 = P - (P * 0.15)
          const slippageBps = Math.floor(sellOrder.price * MARKET_ORDER_SLIPPAGE);
          const minAcceptablePrice = Math.max(0, sellOrder.price - slippageBps);
          if (buyOrder.price >= minAcceptablePrice) {
            canMatch = true;
            matchPrice = buyOrder.price; // Match at maker's (limit buy) price
          }
        } else {
          // Both limit orders - standard matching (buy price >= sell price)
          if (buyOrder.price >= sellOrder.price) {
            canMatch = true;
            matchPrice = sellOrder.price; // Match at maker's (limit sell) price
          }
        }
        
        if (canMatch) {
          const matchSize = buyRemaining < sellRemaining ? buyRemaining : sellRemaining;

          matches.push({
            buyOrder,
            sellOrder,
            price: matchPrice,
            size: Number(matchSize),
          });

          // DO NOT update DB here - just find matches
          // The keeper service will update DB after successful on-chain execution
          // This ensures orders only update in DB after on-chain execution

          // Break after finding match (keeper will handle execution)
          break;
        }
      }
    }

    return matches;
  }
}

