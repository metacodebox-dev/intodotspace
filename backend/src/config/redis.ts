import Redis from 'ioredis';

/**
 * Redis client for shared state across multiple server instances
 * Used for WebSocket connection management, rate limiting, and caching
 */
let redisClient: Redis | null = null;

export function getRedisClient(): Redis {
  if (!redisClient) {
    const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
    
    console.log('[Redis] Connecting to Redis...');
    console.log('[Redis] URL:', redisUrl.replace(/:[^:@]+@/, ':****@')); // Hide password in logs
    
    redisClient = new Redis(redisUrl, {
      maxRetriesPerRequest: 3,
      retryStrategy: (times) => {
        const delay = Math.min(times * 50, 2000);
        console.log(`[Redis] Retrying connection (attempt ${times}) in ${delay}ms...`);
        return delay;
      },
      reconnectOnError: (err) => {
        const targetError = 'READONLY';
        if (err.message.includes(targetError)) {
          console.log('[Redis] READONLY error detected, reconnecting...');
          return true; // Reconnect on READONLY error
        }
        return false;
      },
      // Connection pool settings for high throughput
      enableReadyCheck: true,
      enableOfflineQueue: false, // Don't queue commands when disconnected
      lazyConnect: false,
      // Production settings for Railway/cloud Redis
      connectTimeout: 10000, // 10 second connection timeout
      commandTimeout: 5000, // 5 second command timeout
      keepAlive: 30000, // 30 second keepalive
    });

    redisClient.on('error', (err) => {
      console.error('[Redis] Connection error:', err);
    });

    redisClient.on('connect', () => {
      console.log('[Redis] Connected');
    });

    redisClient.on('ready', () => {
      console.log('[Redis] Ready');
    });

    redisClient.on('close', () => {
      console.log('[Redis] Connection closed');
    });
  }

  return redisClient;
}

/**
 * Gracefully close Redis connection
 */
export async function closeRedis(): Promise<void> {
  if (redisClient) {
    await redisClient.quit();
    redisClient = null;
  }
}

