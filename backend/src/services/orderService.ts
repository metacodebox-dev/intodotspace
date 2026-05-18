import { Connection, PublicKey } from '@solana/web3.js';
import { Order } from '../models/Order';
import { OrderBookService } from './orderBookService';
import { Op } from 'sequelize';
import { wsEventEmitter } from '../websocket/server';
import { orderBookCache } from './orderBookCache';
import { notificationService } from './notificationService';
import { Market } from '../models/Market';

export class OrderService {
  private connection: Connection;
  private orderBookService: OrderBookService;

  constructor() {
    this.connection = new Connection(
      process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
      {
        commitment: 'confirmed',
        wsEndpoint: process.env.SOLANA_WS_URL,
        confirmTransactionInitialTimeout: 60000,
      }
    );
    this.orderBookService = new OrderBookService();
  }

  async placeOrder(data: {
    marketId: string;
    outcomeId: string;
    side: 'buy' | 'sell';
    type: 'market' | 'limit';
    price?: number;
    amount: number;
    leverage: number;
    pubkey?: string;
    signature?: string;
    message?: string;
    onChainOrder?: string; // On-chain pending order address
    orderId?: number; // Order ID used for on-chain order
    tokenType?: 'yes' | 'no'; // YES or NO shares
  }): Promise<Order> {
    // For market orders, get current market price
    // For market buy orders, use best ask price (worst case execution price)
    // For market sell orders, use best bid price (worst case execution price)
    // This ensures market orders have a realistic price for matching with slippage
    let orderPrice = data.price;
    if (data.type === 'market' && !orderPrice) {
      const orderBook = await this.orderBookService.getOrderBook(
        data.marketId,
        parseInt(data.outcomeId),
        1, // Only need best bid/ask
        data.tokenType
      );

      if (data.side === 'buy') {
        // Market buy: use best ask price (worst case - what we'll pay)
        if (orderBook.asks.length > 0) {
          orderPrice = orderBook.asks[0].price;
        } else {
          // No asks, use mid-price or best bid
          const marketPrice = await this.orderBookService.getMarketPrice(
            data.marketId,
            parseInt(data.outcomeId),
            data.tokenType
          );
          orderPrice = marketPrice || 5000;
        }
      } else {
        // Market sell: use best bid price (worst case - what we'll receive)
        if (orderBook.bids.length > 0) {
          orderPrice = orderBook.bids[0].price;
        } else {
          // No bids, use mid-price or best ask
          const marketPrice = await this.orderBookService.getMarketPrice(
            data.marketId,
            parseInt(data.outcomeId),
            data.tokenType
          );
          orderPrice = marketPrice || 5000;
        }
      }
    }

    if (!orderPrice) {
      throw new Error('Price is required for limit orders');
    }

    // Create order in database
    const orderData: any = {
      marketId: data.marketId,
      outcomeId: parseInt(data.outcomeId),
      side: data.side,
      type: data.type,
      price: orderPrice,
      size: data.amount.toString(), // Store as string for BigInt
      filled: '0', // Store as string for BigInt
      leverage: data.leverage,
      status: 'open',
      userId: data.pubkey || 'unknown',
      tokenType: data.tokenType || 'yes', // YES or NO shares
    };
    
    // Store on-chain order info if provided
    if (data.onChainOrder) {
      orderData.onChainOrder = data.onChainOrder;
    }
    if (data.orderId !== undefined) {
      orderData.orderId = data.orderId;
    }
    
    const order = await Order.create(orderData);
    
    console.log(`[OrderService] Order created: ${order.id}, market: ${data.marketId}, outcome: ${data.outcomeId}, type: ${data.type}`);

    // Small delay to ensure database transaction is committed
    // This ensures the orderbook query will include the newly created order
    await new Promise(resolve => setTimeout(resolve, 50));

    // Emit order placed event for automatic matching via websocket
    const { wsEventEmitter } = require('../websocket/server');
    wsEventEmitter.emit('order_placed', {
      marketId: data.marketId,
      outcomeId: parseInt(data.outcomeId),
      orderId: order.id,
    });

    // Emit orderbook update event (new order added)
    await this.emitOrderBookUpdate(data.marketId, parseInt(data.outcomeId));

    // Try to match orders - both limit and market orders should be matched
    // Market orders should be matched immediately against existing limit orders
    try {
      const matches = await this.orderBookService.matchOrders(
        data.marketId,
        parseInt(data.outcomeId)
      );

      // If matches occurred, update order status
      const updatedOrder = await Order.findByPk(order.id);
      if (updatedOrder) {
        const filledBigInt = updatedOrder.getFilledBigInt();
        const sizeBigInt = updatedOrder.getSizeBigInt();
        const previousStatus = updatedOrder.status;
        
        // Check if order was just matched (filled immediately after placement)
        // If so, don't send order_filled notification - orderMatchingService already sent trade_buy/trade_sell
        const wasJustMatched = matches.length > 0 && previousStatus === 'open' && filledBigInt >= sizeBigInt;
        
        if (filledBigInt >= sizeBigInt) {
          updatedOrder.status = 'filled';
          await updatedOrder.save();
          
          // Only send notification if order was NOT just matched (to avoid duplicate with trade notifications)
          // orderMatchingService already sends trade_buy/trade_sell notifications for immediate matches
          if (previousStatus !== 'filled' && !wasJustMatched) {
            // Fetch market title for notification - ensure we always have a market name
            Market.findOne({ where: { marketId: updatedOrder.marketId.toString() } })
              .then((market) => {
                if (market) {
                  console.log(`[OrderService] Found market: ${market.title} for marketId: ${updatedOrder.marketId}`);
                } else {
                  console.warn(`[OrderService] Market not found for marketId: ${updatedOrder.marketId}`);
                }
                const marketTitle = market?.title || `Market ${updatedOrder.marketId.slice(0, 8)}...`;
                return notificationService.notifyOrderFilled({
                  userId: updatedOrder.userId,
                  orderId: updatedOrder.id,
                  marketId: updatedOrder.marketId,
                  outcomeId: updatedOrder.outcomeId,
                  side: updatedOrder.side,
                  price: updatedOrder.price,
                  size: Number(sizeBigInt),
                  marketTitle,
                  tokenType: (updatedOrder as any).tokenType || undefined,
                });
              })
              .catch((err) => {
                console.warn('[OrderService] Failed to send order filled notification:', err);
                // Still send notification with fallback market name
                const marketTitle = `Market ${updatedOrder.marketId.slice(0, 8)}...`;
                notificationService.notifyOrderFilled({
                  userId: updatedOrder.userId,
                  orderId: updatedOrder.id,
                  marketId: updatedOrder.marketId,
                  outcomeId: updatedOrder.outcomeId,
                  side: updatedOrder.side,
                  price: updatedOrder.price,
                  size: Number(sizeBigInt),
                  marketTitle,
                  tokenType: (updatedOrder as any).tokenType || undefined,
                }).catch((notifErr) => {
                  console.error('[OrderService] Failed to send notification with fallback:', notifErr);
                });
              });
          }
        } else if (filledBigInt > 0) {
          updatedOrder.status = 'partially_filled';
          await updatedOrder.save();

          // Send notification if status changed (partial fills are always notified)
          if (previousStatus !== 'partially_filled') {
            // Fetch market title for notification - ensure we always have a market name
            Market.findOne({ where: { marketId: updatedOrder.marketId.toString() } })
              .then((market) => {
                if (market) {
                  console.log(`[OrderService] Found market: ${market.title} for marketId: ${updatedOrder.marketId}`);
                } else {
                  console.warn(`[OrderService] Market not found for marketId: ${updatedOrder.marketId}`);
                }
                const marketTitle = market?.title || `Market ${updatedOrder.marketId.slice(0, 8)}...`;
                return notificationService.notifyOrderPartiallyFilled({
                  userId: updatedOrder.userId,
                  orderId: updatedOrder.id,
                  marketId: updatedOrder.marketId,
                  outcomeId: updatedOrder.outcomeId,
                  side: updatedOrder.side,
                  price: updatedOrder.price,
                  filledSize: Number(filledBigInt),
                  totalSize: Number(sizeBigInt),
                  marketTitle,
                  tokenType: (updatedOrder as any).tokenType || undefined,
                });
              })
              .catch((err) => {
                console.warn('[OrderService] Failed to send order partially filled notification:', err);
                // Still send notification with fallback market name
                const marketTitle = `Market ${updatedOrder.marketId.slice(0, 8)}...`;
                notificationService.notifyOrderPartiallyFilled({
                  userId: updatedOrder.userId,
                  orderId: updatedOrder.id,
                  marketId: updatedOrder.marketId,
                  outcomeId: updatedOrder.outcomeId,
                  side: updatedOrder.side,
                  price: updatedOrder.price,
                  filledSize: Number(filledBigInt),
                  totalSize: Number(sizeBigInt),
                  marketTitle,
                  tokenType: (updatedOrder as any).tokenType || undefined,
                }).catch((notifErr) => {
                  console.error('[OrderService] Failed to send notification with fallback:', notifErr);
                });
              });
          }
        }
      }
      
      // Emit orderbook update after matching
      if (matches.length > 0) {
        this.emitOrderBookUpdate(data.marketId, parseInt(data.outcomeId));
      }
      
      // Return the updated order
      return updatedOrder || order;
    } catch (error) {
      console.error('[OrderService] Error matching orders:', error);
      // Continue even if matching fails
    }

    return order;
  }

  async getOrderById(orderId: string): Promise<Order | null> {
    return await Order.findByPk(orderId);
  }

  /**
   * Update order filled amount after on-chain execution
   * This syncs the database order with actual on-chain trades
   */
  async updateOrderFilled(orderId: string, filledAmount: number): Promise<Order | null> {
    try {
      const order = await Order.findByPk(orderId);
      if (!order) return null;

      const currentFilled = order.getFilledBigInt();
      const newFilled = currentFilled + BigInt(filledAmount);
      const totalSize = order.getSizeBigInt();

      order.setDataValue('filled', newFilled.toString());

      // Update status
      const previousStatus = order.status;
      if (newFilled >= totalSize) {
        order.status = 'filled';
      } else if (newFilled > 0) {
        order.status = 'partially_filled';
      }

      await order.save();
      
      // Send notifications if status changed
      if (previousStatus !== order.status) {
        // Fetch market title for notification - ensure we always have a market name
        const marketPromise = Market.findOne({ where: { marketId: order.marketId.toString() } })
          .then((market) => {
            if (!market) {
              console.warn(`[OrderService] Market not found for marketId: ${order.marketId}`);
            } else {
              console.log(`[OrderService] Found market: ${market.title} for marketId: ${order.marketId}`);
            }
            return market;
          })
          .catch((err) => {
            console.error(`[OrderService] Error fetching market ${order.marketId}:`, err);
            return null;
          });
        
        if (order.status === 'filled') {
          marketPromise.then((market) => {
            const marketTitle = market?.title || `Market ${order.marketId.slice(0, 8)}...`;
            return notificationService.notifyOrderFilled({
              userId: order.userId,
              orderId: order.id,
              marketId: order.marketId,
              outcomeId: order.outcomeId,
              side: order.side,
              price: order.price,
              size: Number(totalSize),
              marketTitle,
              tokenType: (order as any).tokenType || undefined,
            });
          }).catch((err) => {
            console.warn('[OrderService] Failed to send order filled notification:', err);
            // Still send notification with fallback market name
            const marketTitle = `Market ${order.marketId.slice(0, 8)}...`;
            notificationService.notifyOrderFilled({
              userId: order.userId,
              orderId: order.id,
              marketId: order.marketId,
              outcomeId: order.outcomeId,
              side: order.side,
              price: order.price,
              size: Number(totalSize),
              marketTitle,
              tokenType: (order as any).tokenType || undefined,
            }).catch((notifErr) => {
              console.error('[OrderService] Failed to send notification with fallback:', notifErr);
            });
          });
        } else if (order.status === 'partially_filled') {
          marketPromise.then((market) => {
            const marketTitle = market?.title || `Market ${order.marketId.slice(0, 8)}...`;
            return notificationService.notifyOrderPartiallyFilled({
              userId: order.userId,
              orderId: order.id,
              marketId: order.marketId,
              outcomeId: order.outcomeId,
              side: order.side,
              price: order.price,
              filledSize: Number(newFilled),
              totalSize: Number(totalSize),
              marketTitle,
              tokenType: (order as any).tokenType || undefined,
            });
          }).catch((err) => {
            console.warn('[OrderService] Failed to send order partially filled notification:', err);
            // Still send notification with fallback market name
            const marketTitle = `Market ${order.marketId.slice(0, 8)}...`;
            notificationService.notifyOrderPartiallyFilled({
              userId: order.userId,
              orderId: order.id,
              marketId: order.marketId,
              outcomeId: order.outcomeId,
              side: order.side,
              price: order.price,
              filledSize: Number(newFilled),
              totalSize: Number(totalSize),
              marketTitle,
              tokenType: (order as any).tokenType || undefined,
            }).catch((notifErr) => {
              console.error('[OrderService] Failed to send notification with fallback:', notifErr);
            });
          });
        }
      }
      
      // Emit orderbook update event
      this.emitOrderBookUpdate(order.marketId, order.outcomeId);
      
      return order;
    } catch (error) {
      // Logs disabled - check keeper service logs for execution details
      return null;
    }
  }

  /**
   * Emit orderbook update event
   */
  private async emitOrderBookUpdate(marketId: string, outcomeId: number) {
    try {
      console.log(`[OrderService] Emitting orderbook update for market ${marketId}, outcome ${outcomeId}`);
      
      // Invalidate cache first to ensure fresh data
      await orderBookCache.invalidate(marketId, outcomeId, 20);
      
      // Small delay to ensure database consistency (orders are committed)
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Fetch fresh orderbook (force fresh to bypass all caches)
      const orderBook = await orderBookCache.getOrderBook(marketId, outcomeId, 20, true);
      
      console.log(`[OrderService] Orderbook fetched: ${orderBook.bids.length} bids, ${orderBook.asks.length} asks`);
      
      // Emit WebSocket event
      wsEventEmitter.emit('orderbook_update', {
        marketId,
        outcomeId,
        orderBook,
      });
      
      // Also emit market price update
      const price = await this.orderBookService.getMarketPrice(marketId, outcomeId);
      if (price !== null) {
        wsEventEmitter.emit('market_price', {
          marketId,
          outcomeId,
          price,
        });
      }
    } catch (error) {
      console.error('[OrderService] Error emitting orderbook update:', error);
    }
  }

  async cancelOrder(orderId: string, userId?: string): Promise<{ order: Order; unlockedAmount: bigint }> {
    const order = await Order.findByPk(orderId);
    if (!order) {
      throw new Error('Order not found');
    }

    // Verify user owns the order
    if (userId && order.userId !== userId) {
      throw new Error('Unauthorized: You can only cancel your own orders');
    }

    if (order.status === 'filled') {
      throw new Error('Cannot cancel filled order');
    }

    // Calculate unlocked amount (remaining unfilled portion)
    const totalSize = order.getSizeBigInt();
    const filled = order.getFilledBigInt();
    const unlockedAmount = totalSize - filled;

    // Update order status
    order.status = 'cancelled';
    await order.save();

    // Emit orderbook update event
    this.emitOrderBookUpdate(order.marketId, order.outcomeId);

    return { order, unlockedAmount };
  }

  async getUserOrders(
    userId: string,
    statuses?: string[],
    options?: { limit?: number; offset?: number }
  ): Promise<{ orders: Order[]; total: number }> {
    const where: any = { userId };

    if (statuses && statuses.length > 0) {
      where.status = { [Op.in]: statuses };
    }

    const { count, rows } = await Order.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      include: [{
        model: Market,
        as: 'market',
        attributes: ['marketAddress', 'quoteMint', 'quoteDecimals', 'quoteSymbol'],
        required: false,
      }],
      ...(options?.limit !== undefined && { limit: options.limit }),
      ...(options?.offset !== undefined && { offset: options.offset }),
    });

    return { orders: rows, total: count };
  }

  /**
   * Get orders that are matched (partially_filled or filled) but need on-chain execution
   * These are limit orders that have been matched in the order book but not yet executed on-chain
   */
  async getPendingExecutionOrders(userId: string): Promise<Order[]> {
    return await Order.findAll({
      where: {
        userId,
        type: 'limit',
        status: { [Op.in]: ['partially_filled', 'filled'] },
      },
      order: [['updatedAt', 'DESC']],
      include: [{
        model: Market,
        as: 'market',
        attributes: ['marketAddress', 'quoteMint', 'quoteDecimals', 'quoteSymbol'],
        required: false,
      }],
    });
  }

  /**
   * Mark an order as executed on-chain
   * This updates the order to reflect that the matched portion has been executed on-chain
   */
  async markOrderExecuted(orderId: string, userId: string, executedAmount: number): Promise<Order | null> {
    try {
      const order = await Order.findByPk(orderId);
      if (!order || order.userId !== userId) {
        return null;
      }

      // Update the order - the executed amount should match the filled amount
      // This is mainly for tracking purposes
      // The actual on-chain execution happens in the frontend
      
      return order;
    } catch (error) {
      // Logs disabled - check keeper service logs for execution details
      return null;
    }
  }
}


