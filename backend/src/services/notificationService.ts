import { Notification, NotificationType, NotificationPriority } from '../models/Notification';
import { Market } from '../models/Market';
import { getRedisClient } from '../config/redis';
import { wsEventEmitter, broadcastToUser } from '../websocket/server';
import { logger } from '../utils/logger';
import { Op } from 'sequelize';
import { sequelize } from '../config/database';
import { v4 as uuidv4 } from 'uuid';

/**
 * Notification Service - Enterprise-grade notification system
 * 
 * Features:
 * - Redis queue for reliability and scalability
 * - Batching for high-throughput scenarios
 * - WebSocket real-time delivery
 * - Database persistence
 * - Priority-based processing
 * - Rate limiting protection
 */
export class NotificationService {
  private redis: ReturnType<typeof getRedisClient>;
  private batchProcessor: NodeJS.Timeout | null = null;
  private batchQueue: Array<{
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    data?: Record<string, any>;
    priority: NotificationPriority;
  }> = [];
  private readonly BATCH_SIZE = 100;
  private readonly BATCH_INTERVAL_MS = 1000; // Process batches every 1 second
  private readonly MAX_QUEUE_SIZE = 10000; // Prevent memory overflow

  /**
   * Convert lamport amount to human-readable share count
   * USDC uses 6 decimals, so 1,000,000 lamports = 1 share
   */
  private formatShares(lamports: number): string {
    const shares = lamports / 1e6;
    return shares.toLocaleString(undefined, { maximumFractionDigits: 0 });
  }

  constructor() {
    this.redis = getRedisClient();
    this.startBatchProcessor();
  }

  /**
   * Create and send a notification
   * This is the main entry point for creating notifications
   */
  async createNotification(params: {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    data?: Record<string, any>;
    priority?: NotificationPriority;
    sendImmediately?: boolean;
  }): Promise<Notification> {
    const {
      userId,
      type,
      title,
      message,
      data = {},
      priority = this.getDefaultPriority(type),
      sendImmediately = false,
    } = params;

    // For high-priority or immediate notifications, process right away
    if (sendImmediately || priority === 'urgent' || priority === 'high') {
      return this.processNotification({
        userId,
        type,
        title,
        message,
        data,
        priority,
      });
    }

    // For normal/low priority, add to batch queue
    if (this.batchQueue.length >= this.MAX_QUEUE_SIZE) {
      logger.warn('[NotificationService] Batch queue full, processing immediately');
      return this.processNotification({
        userId,
        type,
        title,
        message,
        data,
        priority,
      });
    }

    this.batchQueue.push({
      userId,
      type,
      title,
      message,
      data,
      priority,
    });

    // Return a placeholder notification (will be created in batch)
    // In production, you might want to return a promise that resolves when processed
    return Notification.build({
      userId,
      type,
      title,
      message,
      data,
      priority,
      read: false,
    } as any);
  }

  /**
   * Process a single notification (save to DB, send via WebSocket, queue in Redis)
   */
  private async processNotification(params: {
    userId: string;
    type: NotificationType;
    title: string;
    message: string;
    data?: Record<string, any>;
    priority: NotificationPriority;
  }): Promise<Notification> {
    try {
      // Check for duplicate notification (same user, type, orderId within last 30 seconds)
      // This prevents duplicate notifications from being created in the database
      if (params.data?.orderId) {
        const tenSecondsAgo = new Date(Date.now() - 30000); // Last 30 seconds
        
        // Find recent notifications of the same type for this user
        const recentNotifications = await Notification.findAll({
          where: {
            userId: params.userId,
            type: params.type,
            createdAt: {
              [Op.gte]: tenSecondsAgo,
            },
          },
          order: [['createdAt', 'DESC']],
          limit: 10, // Check last 10 notifications
        });

        // Check if any of them have the same orderId
        for (const existing of recentNotifications) {
          const existingOrderId = existing.data?.orderId;
          const newOrderId = params.data.orderId;
          
          if (existingOrderId && existingOrderId === newOrderId) {
            logger.info(`[NotificationService] Duplicate notification prevented for orderId: ${newOrderId}, userId: ${params.userId}, existingId: ${existing.id}`);
            // Return existing notification instead of creating a new one
            // Don't send via WebSocket again - it's a duplicate
            return existing;
          }
        }
      }

      // 1. Save to database
      // Explicitly set createdAt to current time to ensure accuracy
      // Use Date.now() to get precise timestamp, then convert to Date
      const now = new Date();
      const nowTimestamp = now.getTime();
      
      // Create notification using raw SQL to ensure our timestamp is used
      // This bypasses Sequelize defaults and database CURRENT_TIMESTAMP
      const notificationId = uuidv4();
      const createdAtISO = now.toISOString();
      
      // Insert directly with explicit timestamp
      await sequelize.query(`
        INSERT INTO notifications (id, user_id, type, title, message, data, priority, read, created_at, updated_at)
        VALUES (:id, :userId, :type, :title, :message, :data::jsonb, :priority, :read, :createdAt::timestamp, :updatedAt::timestamp)
      `, {
        replacements: {
          id: notificationId,
          userId: params.userId,
          type: params.type,
          title: params.title,
          message: params.message,
          data: JSON.stringify(params.data || {}),
          priority: params.priority,
          read: false,
          createdAt: createdAtISO,
          updatedAt: createdAtISO,
        },
      });
      
      // Fetch the created notification using Sequelize model
      const notification = await Notification.findByPk(notificationId);
      
      if (!notification) {
        throw new Error('Failed to create notification');
      }
      
      // Verify the timestamp was saved correctly
      const savedTimestamp = notification.createdAt.getTime();
      const diffMs = savedTimestamp - nowTimestamp;
      const diffSeconds = Math.floor(diffMs / 1000);
      
      // Log the created timestamp for debugging
      logger.info(`[NotificationService] Created notification:`, {
        notificationId: notification.id,
        type: params.type,
        requestedTime: now.toISOString(),
        savedCreatedAt: notification.createdAt.toISOString(),
        diffMs,
        diffSeconds,
        warning: Math.abs(diffSeconds) > 1 ? `Timestamp mismatch: ${diffSeconds} seconds difference!` : 'OK'
      });
      
      // If there's a significant difference, log a warning
      if (Math.abs(diffSeconds) > 1) {
        logger.warn(`[NotificationService] Timestamp mismatch detected! Server time: ${now.toISOString()}, Saved: ${notification.createdAt.toISOString()}, Diff: ${diffSeconds}s`);
      }

      // 2. Add to Redis queue for cross-server delivery (if needed)
      try {
        await this.redis.lpush(
          `notifications:queue:${params.userId}`,
          JSON.stringify({
            id: notification.id,
            type: params.type,
            title: params.title,
            message: params.message,
            data: params.data,
            priority: params.priority,
            createdAt: notification.createdAt.toISOString(),
          })
        );
        // Keep queue size manageable (last 100 notifications per user)
        await this.redis.ltrim(`notifications:queue:${params.userId}`, 0, 99);
      } catch (redisError) {
        // Redis failure shouldn't block notification creation
        logger.warn('[NotificationService] Redis queue error (non-critical):', redisError);
      }

      // 3. Send via WebSocket in real-time
      try {
        const wsMessage = {
          type: 'notification',
          notification: {
            id: notification.id,
            type: params.type,
            title: params.title,
            message: params.message,
            data: params.data || {},
            priority: params.priority,
            read: false,
            createdAt: notification.createdAt.toISOString(),
          },
          timestamp: new Date().toISOString(),
        };
        
        logger.info(`[NotificationService] Broadcasting notification to user ${params.userId}:`, {
          notificationId: notification.id,
          type: params.type,
          title: params.title,
        });
        
        broadcastToUser(params.userId, wsMessage);
      } catch (wsError) {
        // WebSocket failure shouldn't block notification creation
        logger.warn('[NotificationService] WebSocket broadcast error (non-critical):', wsError);
      }

      // 4. Emit event for other services to listen to
      wsEventEmitter.emit('notification_created', {
        userId: params.userId,
        notificationId: notification.id,
        type: params.type,
      });

      return notification;
    } catch (error: any) {
      logger.error('[NotificationService] Error creating notification:', error);
      throw error;
    }
  }

  /**
   * Process batch of notifications
   */
  private async processBatch() {
    if (this.batchQueue.length === 0) {
      return;
    }

    const batch = this.batchQueue.splice(0, this.BATCH_SIZE);
    
    try {
      // Process in parallel with concurrency limit
      const BATCH_CONCURRENCY = 50; // Process 50 at a time
      const chunks: typeof batch[] = [];
      for (let i = 0; i < batch.length; i += BATCH_CONCURRENCY) {
        chunks.push(batch.slice(i, i + BATCH_CONCURRENCY));
      }

      for (const chunk of chunks) {
        await Promise.allSettled(
          chunk.map((item) =>
            this.processNotification(item).catch((error) => {
              logger.error('[NotificationService] Batch processing error:', error);
              return null;
            })
          )
        );
      }

      logger.debug(`[NotificationService] Processed batch of ${batch.length} notifications`);
    } catch (error) {
      logger.error('[NotificationService] Batch processing error:', error);
    }
  }

  /**
   * Start batch processor
   */
  private startBatchProcessor() {
    if (this.batchProcessor) {
      clearInterval(this.batchProcessor);
    }

    this.batchProcessor = setInterval(() => {
      this.processBatch();
    }, this.BATCH_INTERVAL_MS);
  }

  /**
   * Stop batch processor
   */
  stopBatchProcessor() {
    if (this.batchProcessor) {
      clearInterval(this.batchProcessor);
      this.batchProcessor = null;
    }
    // Process remaining items
    this.processBatch();
  }

  /**
   * Get default priority for notification type
   */
  private getDefaultPriority(type: NotificationType): NotificationPriority {
    switch (type) {
      case 'liquidation':
      case 'liquidation_warning':
        return 'urgent';
      case 'trade_buy':
      case 'trade_sell':
      case 'order_filled':
        return 'high';
      case 'order_partially_filled':
      case 'position_closed':
        return 'normal';
      case 'order_cancelled':
      case 'market_resolved':
        return 'low';
      default:
        return 'normal';
    }
  }

  /**
   * Get outcome label from market data. Falls back to 'Outcome N' if not found.
   */
  private async getOutcomeLabel(marketId: string, outcomeId: number): Promise<string> {
    try {
      const market = await Market.findOne({
        where: { marketAddress: marketId },
        attributes: ['outcomes'],
      });
      if (!market) {
        // Try by marketId field
        const marketById = await Market.findOne({
          where: { marketId: marketId },
          attributes: ['outcomes'],
        });
        if (marketById) {
          const outcomes = JSON.parse(marketById.outcomes);
          return outcomes[outcomeId]?.label || `Outcome ${outcomeId}`;
        }
      } else {
        const outcomes = JSON.parse(market.outcomes);
        return outcomes[outcomeId]?.label || `Outcome ${outcomeId}`;
      }
    } catch (error) {
      // Ignore errors, use fallback
    }
    return outcomeId === 0 ? 'YES' : outcomeId === 1 ? 'NO' : `Outcome ${outcomeId}`;
  }

  /**
   * Create trade buy notification
   */
  async notifyTradeBuy(params: {
    userId: string;
    marketId: string;
    outcomeId: number;
    price: number;
    size: number;
    orderId?: string;
    transactionHash?: string;
    marketTitle?: string;
    tokenType?: 'yes' | 'no';
  }): Promise<Notification> {
    const priceCents = Math.round(params.price / 100);
    const shares = this.formatShares(params.size);
    const outcome = await this.getOutcomeLabel(params.marketId, params.outcomeId);
    const tokenLabel = params.tokenType ? ` ${params.tokenType.toUpperCase()}` : '';
    const marketInfo = params.marketTitle ? ` on "${params.marketTitle}"` : '';

    return this.createNotification({
      userId: params.userId,
      type: 'trade_buy',
      title: 'Trade Executed - Buy',
      message: `Your buy order for ${shares}${tokenLabel} ${outcome} shares${marketInfo} has been executed at ${priceCents}¢`,
      data: {
        marketId: params.marketId,
        outcomeId: params.outcomeId,
        price: params.price,
        size: params.size,
        orderId: params.orderId,
        transactionHash: params.transactionHash,
        marketTitle: params.marketTitle,
        side: 'buy',
        tokenType: params.tokenType,
      },
      priority: 'high',
      sendImmediately: true,
    });
  }

  /**
   * Create trade sell notification
   */
  async notifyTradeSell(params: {
    userId: string;
    marketId: string;
    outcomeId: number;
    price: number;
    size: number;
    orderId?: string;
    transactionHash?: string;
    marketTitle?: string;
    tokenType?: 'yes' | 'no';
  }): Promise<Notification> {
    const priceCents = Math.round(params.price / 100);
    const shares = this.formatShares(params.size);
    const outcome = await this.getOutcomeLabel(params.marketId, params.outcomeId);
    const tokenLabel = params.tokenType ? ` ${params.tokenType.toUpperCase()}` : '';
    const marketInfo = params.marketTitle ? ` on "${params.marketTitle}"` : '';

    return this.createNotification({
      userId: params.userId,
      type: 'trade_sell',
      title: 'Trade Executed - Sell',
      message: `Your sell order for ${shares}${tokenLabel} ${outcome} shares${marketInfo} has been executed at ${priceCents}¢`,
      data: {
        marketId: params.marketId,
        outcomeId: params.outcomeId,
        price: params.price,
        size: params.size,
        orderId: params.orderId,
        transactionHash: params.transactionHash,
        marketTitle: params.marketTitle,
        side: 'sell',
        tokenType: params.tokenType,
      },
      priority: 'high',
      sendImmediately: true,
    });
  }

  /**
   * Create order filled notification
   */
  async notifyOrderFilled(params: {
    userId: string;
    orderId: string;
    marketId: string;
    outcomeId: number;
    side: 'buy' | 'sell';
    price: number;
    size: number;
    marketTitle?: string;
    tokenType?: 'yes' | 'no';
  }): Promise<Notification> {
    const priceCents = Math.round(params.price / 100);
    const shares = this.formatShares(params.size);
    const outcome = await this.getOutcomeLabel(params.marketId, params.outcomeId);
    const tokenLabel = params.tokenType ? ` ${params.tokenType.toUpperCase()}` : '';
    const marketInfo = params.marketTitle ? ` on "${params.marketTitle}"` : '';

    return this.createNotification({
      userId: params.userId,
      type: 'order_filled',
      title: 'Order Filled',
      message: `Your ${params.side} order for ${shares}${tokenLabel} ${outcome} shares${marketInfo} has been filled at ${priceCents}¢`,
      data: {
        orderId: params.orderId,
        marketId: params.marketId,
        outcomeId: params.outcomeId,
        side: params.side,
        price: params.price,
        size: params.size,
        marketTitle: params.marketTitle,
        tokenType: params.tokenType,
      },
      priority: 'high',
    });
  }

  /**
   * Create order partially filled notification
   */
  async notifyOrderPartiallyFilled(params: {
    userId: string;
    orderId: string;
    marketId: string;
    outcomeId: number;
    side: 'buy' | 'sell';
    price: number;
    filledSize: number;
    totalSize: number;
    marketTitle?: string;
    tokenType?: 'yes' | 'no';
  }): Promise<Notification> {
    const fillPercentage = ((params.filledSize / params.totalSize) * 100).toFixed(1);
    const priceCents = Math.round(params.price / 100);
    const filledShares = this.formatShares(params.filledSize);
    const totalShares = this.formatShares(params.totalSize);
    const outcome = await this.getOutcomeLabel(params.marketId, params.outcomeId);
    const tokenLabel = params.tokenType ? ` ${params.tokenType.toUpperCase()}` : '';
    const marketInfo = params.marketTitle ? ` on "${params.marketTitle}"` : '';

    return this.createNotification({
      userId: params.userId,
      type: 'order_partially_filled',
      title: 'Order Partially Filled',
      message: `Your ${params.side} order for ${totalShares}${tokenLabel} ${outcome} shares${marketInfo} was ${fillPercentage}% filled (${filledShares}/${totalShares}) at ${priceCents}¢`,
      data: {
        orderId: params.orderId,
        marketId: params.marketId,
        outcomeId: params.outcomeId,
        side: params.side,
        price: params.price,
        filledSize: params.filledSize,
        totalSize: params.totalSize,
        marketTitle: params.marketTitle,
        tokenType: params.tokenType,
      },
      priority: 'normal',
    });
  }

  /**
   * Get notifications for a user
   */
  async getUserNotifications(params: {
    userId: string;
    limit?: number;
    offset?: number;
    unreadOnly?: boolean;
    type?: NotificationType;
  }): Promise<{ notifications: Notification[]; total: number }> {
    const { userId, limit = 50, offset = 0, unreadOnly = false, type } = params;

    const where: any = { userId };
    if (unreadOnly) {
      where.read = false;
    }
    if (type) {
      where.type = type;
    }

    const { count, rows } = await Notification.findAndCountAll({
      where,
      order: [['createdAt', 'DESC']],
      limit,
      offset,
    });

    return {
      notifications: rows,
      total: count,
    };
  }

  /**
   * Mark notification as read
   */
  async markAsRead(notificationId: string, userId: string): Promise<Notification> {
    const notification = await Notification.findOne({
      where: { id: notificationId, userId },
    });

    if (!notification) {
      throw new Error('Notification not found');
    }

    notification.read = true;
    notification.readAt = new Date();
    await notification.save();

    return notification;
  }

  /**
   * Mark all notifications as read for a user
   */
  async markAllAsRead(userId: string): Promise<number> {
    const [count] = await Notification.update(
      {
        read: true,
        readAt: new Date(),
      },
      {
        where: {
          userId,
          read: false,
        },
      }
    );

    return count;
  }

  /**
   * Get unread count for a user
   */
  async getUnreadCount(userId: string): Promise<number> {
    return Notification.count({
      where: {
        userId,
        read: false,
      },
    });
  }

  /**
   * Delete notification
   */
  async deleteNotification(notificationId: string, userId: string): Promise<boolean> {
    const deleted = await Notification.destroy({
      where: { id: notificationId, userId },
    });

    return deleted > 0;
  }
}

// Export singleton instance
export const notificationService = new NotificationService();

