import { WebSocket } from 'ws';
import { getRedisClient } from '../config/redis';
import { rateLimiter } from './rateLimiter';

/**
 * Production-grade connection manager
 * Handles connection lifecycle, health monitoring, and metrics
 */

export interface ConnectionMetrics {
  totalConnections: number;
  activeSubscriptions: number;
  messagesPerSecond: number;
  averageLatency: number;
  errorRate: number;
}

export class ConnectionManager {
  private connections: Map<WebSocket, {
    id: string;
    ip: string;
    connectedAt: Date;
    lastActivity: Date;
    subscriptions: number;
    messagesSent: number;
    messagesReceived: number;
    errors: number;
  }> = new Map();
  
  private redis: ReturnType<typeof getRedisClient>;
  private serverId: string;
  private metricsInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.redis = getRedisClient();
    this.serverId = process.env.SERVER_ID || `server-${Date.now()}`;
    this.startMetricsCollection();
    this.startConnectionCleanup();
    this.cleanupOnStartup();
  }

  /**
   * Cleanup on startup - reset connection counts that might be stuck
   */
  private async cleanupOnStartup() {
    try {
      // Reset all connection count keys (they'll be recreated as connections come in)
      const keys = await this.redis.keys('ws:conn:ip:*');
      if (keys.length > 0) {
        await this.redis.del(...keys);
        console.log(`[ConnectionManager] Cleaned up ${keys.length} stale connection count keys on startup`);
      }
    } catch (error: any) {
      console.warn('[ConnectionManager] Error during startup cleanup:', error.message);
    }
  }

  /**
   * Periodic cleanup of stale connections
   */
  private startConnectionCleanup() {
    setInterval(async () => {
      try {
        const staleConnections: WebSocket[] = [];
        const now = Date.now();
        const STALE_TIMEOUT = 60000; // 1 minute

        for (const [ws, conn] of this.connections.entries()) {
          // Check if connection is closed or stale
          if (ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
            staleConnections.push(ws);
          } else if (now - conn.lastActivity.getTime() > STALE_TIMEOUT) {
            // Connection hasn't been active for a while, check if it's still alive
            if (ws.readyState !== WebSocket.OPEN) {
              staleConnections.push(ws);
            }
          }
        }

        // Clean up stale connections
        for (const ws of staleConnections) {
          await this.unregisterConnection(ws);
        }

        if (staleConnections.length > 0) {
          console.log(`[ConnectionManager] Cleaned up ${staleConnections.length} stale connections`);
        }
      } catch (error: any) {
        console.error('[ConnectionManager] Error in connection cleanup:', error.message);
      }
    }, 30000); // Run every 30 seconds
  }

  /**
   * Normalize IP address (treat IPv6 localhost as IPv4)
   */
  private normalizeIP(ip: string): string {
    // Normalize IPv6 localhost to IPv4
    if (ip === '::1' || ip === '::ffff:127.0.0.1') {
      return '127.0.0.1';
    }
    // Remove IPv6 prefix if present
    if (ip.startsWith('::ffff:')) {
      return ip.substring(7);
    }
    return ip;
  }

  /**
   * Register a new connection
   */
  async registerConnection(ws: WebSocket, ip: string): Promise<string> {
    try {
      const normalizedIP = this.normalizeIP(ip);
      const connectionId = `${this.serverId}-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
      
      // Check connection limit (with error handling for Redis failures)
      try {
        const connLimit = await rateLimiter.checkConnectionLimit(normalizedIP);
        if (!connLimit.allowed) {
          // Clean up stale connections before throwing error
          await this.cleanupStaleConnections();
          // Check again after cleanup
          const retryLimit = await rateLimiter.checkConnectionLimit(normalizedIP);
          if (!retryLimit.allowed) {
            throw new Error(`Connection limit exceeded. Max ${rateLimiter['config'].maxConnectionsPerIP} connections per IP`);
          }
        }
      } catch (rateLimitError: any) {
        // If Redis is down, allow connection but log warning
        if (rateLimitError.message?.includes('Redis') || rateLimitError.message?.includes('ECONNREFUSED')) {
          console.warn('[ConnectionManager] Redis unavailable, allowing connection without rate limiting:', rateLimitError.message);
        } else {
          throw rateLimitError;
        }
      }

      // Store connection info with normalized IP
      this.connections.set(ws, {
        id: connectionId,
        ip: normalizedIP,
        connectedAt: new Date(),
        lastActivity: new Date(),
        subscriptions: 0,
        messagesSent: 0,
        messagesReceived: 0,
        errors: 0,
      });

      // Register in Redis for multi-server support (with error handling)
      try {
        await this.redis.sadd(`ws:servers:${this.serverId}:connections`, connectionId);
        await this.redis.setex(`ws:conn:${connectionId}`, 3600, JSON.stringify({
          serverId: this.serverId,
          ip,
          connectedAt: new Date().toISOString(),
        }));
      } catch (redisError: any) {
        // If Redis fails, log but don't block connection
        console.warn('[ConnectionManager] Redis operation failed, continuing without Redis:', redisError.message);
      }

      // Note: Connection close is handled in server.ts to ensure proper cleanup order
      // Don't register close handler here to avoid duplicate cleanup

      return connectionId;
    } catch (error: any) {
      console.error('[ConnectionManager] Error registering connection:', {
        error: error.message,
        stack: error.stack,
        ip,
      });
      throw error;
    }
  }

  /**
   * Unregister a connection
   */
  async unregisterConnection(ws: WebSocket): Promise<void> {
    const conn = this.connections.get(ws);
    if (conn) {
      try {
        // Decrement connection count
        await rateLimiter.decrementConnection(conn.ip);
        
        // Remove from Redis (with error handling)
        try {
          await this.redis.srem(`ws:servers:${this.serverId}:connections`, conn.id);
          await this.redis.del(`ws:conn:${conn.id}`);
        } catch (redisError: any) {
          console.warn('[ConnectionManager] Redis error during unregister:', redisError.message);
        }
        
        this.connections.delete(ws);
      } catch (error: any) {
        console.error('[ConnectionManager] Error unregistering connection:', error.message);
        // Still remove from local map even if Redis fails
        this.connections.delete(ws);
      }
    }
  }

  /**
   * Update connection activity
   */
  updateActivity(ws: WebSocket, type: 'sent' | 'received' | 'error'): void {
    const conn = this.connections.get(ws);
    if (conn) {
      conn.lastActivity = new Date();
      if (type === 'sent') {
        conn.messagesSent++;
      } else if (type === 'received') {
        conn.messagesReceived++;
      } else if (type === 'error') {
        conn.errors++;
      }
    }
  }

  /**
   * Update subscription count
   */
  updateSubscriptions(ws: WebSocket, delta: number): void {
    const conn = this.connections.get(ws);
    if (conn) {
      conn.subscriptions = Math.max(0, conn.subscriptions + delta);
    }
  }

  /**
   * Get connection info
   */
  getConnection(ws: WebSocket) {
    return this.connections.get(ws);
  }

  /**
   * Get all connections for this server
   */
  getAllConnections(): Array<{ ws: WebSocket; info: any }> {
    return Array.from(this.connections.entries()).map(([ws, info]) => ({ ws, info }));
  }

  /**
   * Get connection metrics
   */
  getMetrics(): ConnectionMetrics {
    const connections = Array.from(this.connections.values());
    const totalConnections = connections.length;
    const activeSubscriptions = connections.reduce((sum, c) => sum + c.subscriptions, 0);
    const totalMessages = connections.reduce((sum, c) => sum + c.messagesSent + c.messagesReceived, 0);
    const totalErrors = connections.reduce((sum, c) => sum + c.errors, 0);

    return {
      totalConnections,
      activeSubscriptions,
      messagesPerSecond: 0, // Calculated by metrics collection
      averageLatency: 0, // Would need to track request/response times
      errorRate: totalConnections > 0 ? totalErrors / totalConnections : 0,
    };
  }

  /**
   * Start metrics collection
   */
  private startMetricsCollection(): void {
    this.metricsInterval = setInterval(async () => {
      const metrics = this.getMetrics();
      
      // Store metrics in Redis
      await this.redis.setex(`ws:metrics:${this.serverId}`, 60, JSON.stringify({
        ...metrics,
        timestamp: new Date().toISOString(),
      }));

      // Log metrics periodically
      if (metrics.totalConnections > 0) {
        console.log('[ConnectionManager] Metrics:', {
          connections: metrics.totalConnections,
          subscriptions: metrics.activeSubscriptions,
          errorRate: (metrics.errorRate * 100).toFixed(2) + '%',
        });
      }
    }, 10000); // Every 10 seconds
  }

  /**
   * Cleanup stale connections
   */
  async cleanupStaleConnections(): Promise<void> {
    const now = Date.now();
    const staleThreshold = 5 * 60 * 1000; // 5 minutes

    for (const [ws, conn] of this.connections.entries()) {
      const inactiveTime = now - conn.lastActivity.getTime();
      if (inactiveTime > staleThreshold) {
        console.log(`[ConnectionManager] Cleaning up stale connection: ${conn.id}`);
        ws.close();
        await this.unregisterConnection(ws);
      }
    }
  }

  /**
   * Graceful shutdown
   */
  async shutdown(): Promise<void> {
    if (this.metricsInterval) {
      clearInterval(this.metricsInterval);
    }

    // Close all connections
    for (const [ws] of this.connections.entries()) {
      ws.close();
    }

    // Cleanup Redis
    await this.redis.del(`ws:servers:${this.serverId}:connections`);
  }
}

// Singleton instance
export const connectionManager = new ConnectionManager();

