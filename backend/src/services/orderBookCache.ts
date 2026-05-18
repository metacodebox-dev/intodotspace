import { getRedisClient } from '../config/redis';
import { OrderBookService, OrderBook } from './orderBookService';

/**
 * Production-grade caching layer for orderbook data
 * Reduces database load and improves response times
 */

const CACHE_TTL = 1; // 1 second cache (orderbook changes frequently)
const CACHE_PREFIX = 'orderbook:';

export class OrderBookCache {
  private redis: ReturnType<typeof getRedisClient>;
  private orderBookService: OrderBookService;
  private memoryCache: Map<string, { data: OrderBook; expiresAt: number }> = new Map();
  private memoryCacheTTL = 500; // 500ms memory cache

  constructor() {
    this.redis = getRedisClient();
    this.orderBookService = new OrderBookService();
  }

  /**
   * Get orderbook with caching
   */
  async getOrderBook(marketId: string, outcomeId: number, depth: number = 100, forceFresh: boolean = false, tokenType?: 'yes' | 'no'): Promise<OrderBook> {
    const cacheKey = `${CACHE_PREFIX}${marketId}:${outcomeId}:${depth}${tokenType ? ':' + tokenType : ''}`;

    // If forceFresh is true, skip cache and fetch directly from database
    if (forceFresh) {
      console.log(`[OrderBookCache] Force fresh fetch for ${marketId}:${outcomeId}${tokenType ? ':' + tokenType : ''}`);
      const orderBook = await this.orderBookService.getOrderBook(marketId, outcomeId, depth, tokenType);

      // Update caches with fresh data
      try {
        await this.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(orderBook));
      } catch (error) {
        console.error('[OrderBookCache] Redis set error:', error);
      }

      this.memoryCache.set(cacheKey, {
        data: orderBook,
        expiresAt: Date.now() + this.memoryCacheTTL,
      });

      return orderBook;
    }

    // Check memory cache first (fastest)
    const memoryCached = this.memoryCache.get(cacheKey);
    if (memoryCached && memoryCached.expiresAt > Date.now()) {
      return memoryCached.data;
    }

    // Check Redis cache
    try {
      const cached = await this.redis.get(cacheKey);
      if (cached) {
        const orderBook = JSON.parse(cached) as OrderBook;

        // Store in memory cache
        this.memoryCache.set(cacheKey, {
          data: orderBook,
          expiresAt: Date.now() + this.memoryCacheTTL,
        });

        return orderBook;
      }
    } catch (error) {
      console.error('[OrderBookCache] Redis cache error:', error);
    }

    // Cache miss - fetch from database
    const orderBook = await this.orderBookService.getOrderBook(marketId, outcomeId, depth, tokenType);

    // Store in both caches
    try {
      await this.redis.setex(cacheKey, CACHE_TTL, JSON.stringify(orderBook));
    } catch (error) {
      console.error('[OrderBookCache] Redis set error:', error);
    }

    this.memoryCache.set(cacheKey, {
      data: orderBook,
      expiresAt: Date.now() + this.memoryCacheTTL,
    });

    return orderBook;
  }

  /**
   * Invalidate cache for a market/outcome
   */
  async invalidate(marketId: string, outcomeId: number, depth: number = 20): Promise<void> {
    const cacheKey = `${CACHE_PREFIX}${marketId}:${outcomeId}:${depth}`;

    // Remove from memory cache
    this.memoryCache.delete(cacheKey);

    // Remove from Redis
    try {
      await this.redis.del(cacheKey);
    } catch (error) {
      console.error('[OrderBookCache] Redis delete error:', error);
    }
  }

  /**
   * Invalidate all caches for a market
   */
  async invalidateMarket(marketId: string): Promise<void> {
    // Remove from memory cache
    for (const key of this.memoryCache.keys()) {
      if (key.startsWith(`${CACHE_PREFIX}${marketId}:`)) {
        this.memoryCache.delete(key);
      }
    }

    // Remove from Redis (pattern matching)
    try {
      const keys = await this.redis.keys(`${CACHE_PREFIX}${marketId}:*`);
      if (keys.length > 0) {
        await this.redis.del(...keys);
      }
    } catch (error) {
      console.error('[OrderBookCache] Redis pattern delete error:', error);
    }
  }

  /**
   * Cleanup expired memory cache entries
   */
  cleanup(): void {
    const now = Date.now();
    for (const [key, value] of this.memoryCache.entries()) {
      if (value.expiresAt <= now) {
        this.memoryCache.delete(key);
      }
    }
  }
}

// Singleton instance
export const orderBookCache = new OrderBookCache();

// Cleanup memory cache every 5 seconds
setInterval(() => {
  orderBookCache.cleanup();
}, 5000);

