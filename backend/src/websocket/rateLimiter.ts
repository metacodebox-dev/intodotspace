import { getRedisClient } from '../config/redis';

/**
 * Production-grade rate limiter for WebSocket connections
 * Prevents abuse and ensures fair resource usage
 */

interface RateLimitConfig {
  maxMessagesPerSecond: number;
  maxSubscriptions: number;
  maxConnectionsPerIP: number;
  windowMs: number;
}

const DEFAULT_CONFIG: RateLimitConfig = {
  maxMessagesPerSecond: 100, // Max 100 messages per second per connection
  maxSubscriptions: 50, // Max 50 subscriptions per connection
  maxConnectionsPerIP: process.env.NODE_ENV === 'production' ? 10 : 50, // Higher limit for development
  windowMs: 1000, // 1 second window
};

/**
 * Rate limiter using Redis for distributed rate limiting
 */
export class WebSocketRateLimiter {
  private redis: ReturnType<typeof getRedisClient>;
  private config: RateLimitConfig;

  constructor(config: Partial<RateLimitConfig> = {}) {
    this.redis = getRedisClient();
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Check if connection is allowed (IP-based)
   */
  async checkConnectionLimit(ip: string): Promise<{ allowed: boolean; remaining: number }> {
    try {
      const key = `ws:conn:ip:${ip}`;
      const current = await this.redis.incr(key);
      
      if (current === 1) {
        await this.redis.expire(key, 300); // Expire after 5 minutes (longer for cleanup)
      }

      // Clean up: if count is negative or too high, reset it
      if (current < 0 || current > this.config.maxConnectionsPerIP * 2) {
        await this.redis.set(key, 1);
        await this.redis.expire(key, 300);
        const remaining = Math.max(0, this.config.maxConnectionsPerIP - 1);
        return {
          allowed: true,
          remaining,
        };
      }

      const remaining = Math.max(0, this.config.maxConnectionsPerIP - current);
      return {
        allowed: current <= this.config.maxConnectionsPerIP,
        remaining,
      };
    } catch (error: any) {
      // If Redis fails, allow connection in development
      if (process.env.NODE_ENV !== 'production') {
        console.warn('[RateLimiter] Redis error, allowing connection:', error.message);
        return { allowed: true, remaining: this.config.maxConnectionsPerIP };
      }
      throw error;
    }
  }

  /**
   * Decrement connection count when connection closes
   */
  async decrementConnection(ip: string): Promise<void> {
    try {
      const key = `ws:conn:ip:${ip}`;
      const newValue = await this.redis.decr(key);
      
      // If count goes negative or to zero, clean up
      if (newValue <= 0) {
        await this.redis.del(key);
      }
    } catch (error: any) {
      // If Redis fails, just log warning
      console.warn('[RateLimiter] Error decrementing connection:', error.message);
    }
  }

  /**
   * Check if message rate limit is exceeded
   */
  async checkMessageRate(connectionId: string): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
    const key = `ws:rate:msg:${connectionId}`;
    const current = await this.redis.incr(key);
    
    if (current === 1) {
      await this.redis.expire(key, Math.ceil(this.config.windowMs / 1000));
    }

    const ttl = await this.redis.ttl(key);
    const resetAt = Date.now() + (ttl * 1000);
    const remaining = Math.max(0, this.config.maxMessagesPerSecond - current);

    return {
      allowed: current <= this.config.maxMessagesPerSecond,
      remaining,
      resetAt,
    };
  }

  /**
   * Check subscription limit
   */
  async checkSubscriptionLimit(connectionId: string, currentSubscriptions: number): Promise<{ allowed: boolean; remaining: number }> {
    const remaining = Math.max(0, this.config.maxSubscriptions - currentSubscriptions);
    return {
      allowed: currentSubscriptions < this.config.maxSubscriptions,
      remaining,
    };
  }

  /**
   * Get rate limit info for a connection
   */
  async getRateLimitInfo(connectionId: string, ip: string): Promise<{
    messages: { allowed: boolean; remaining: number; resetAt: number };
    subscriptions: { allowed: boolean; remaining: number };
    connections: { allowed: boolean; remaining: number };
  }> {
    const [messages, connections] = await Promise.all([
      this.checkMessageRate(connectionId),
      this.checkConnectionLimit(ip),
    ]);

    return {
      messages,
      subscriptions: { allowed: true, remaining: this.config.maxSubscriptions }, // Checked separately
      connections,
    };
  }
}

// Singleton instance
export const rateLimiter = new WebSocketRateLimiter();

