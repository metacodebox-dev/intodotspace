import { Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { EventEmitter } from 'events';
import { OrderBookService, OrderBook } from '../services/orderBookService';
import { PositionService, PositionData } from '../services/positionService';
import { connectionManager } from './connectionManager';
import { rateLimiter } from './rateLimiter';
import { orderBookCache } from '../services/orderBookCache';

/**
 * WebSocket Server for real-time market data, orderbook, and liquidation updates
 * Replaces polling with event-driven architecture
 */

export interface Subscription {
  channel: string;
  marketId?: string;
  outcomeId?: number;
  userId?: string;
  tokenType?: 'yes' | 'no';
}

export interface ClientConnection {
  ws: WebSocket;
  subscriptions: Map<string, Subscription>;
  userId?: string;
  pubkey?: string;
  connectedAt: Date;
  lastPing: Date;
}

export interface OrderBookUpdate {
  marketId: string;
  outcomeId: number;
  orderBook: OrderBook;
}

export interface OrderMatchEvent {
  marketId: string;
  outcomeId: number;
  buyOrderId: string;
  sellOrderId: string;
  price: number;
  size: number;
  timestamp: string;
}

export interface LiquidationEvent {
  marketId: string;
  outcomeId: number;
  userId: string;
  positionId: string;
  liquidationPrice: number;
  currentPrice: number;
  equity: string;
  timestamp: string;
}

export interface TradeEvent {
  marketId: string;
  outcomeId: number;
  side: 'buy' | 'sell';
  price: number;
  size: number;
  timestamp: string;
}

export interface MarketEvent {
  type: 'created' | 'updated' | 'resolved';
  market: any; // Market data object
  timestamp: string;
}

// Global event emitter for broadcasting events
export const wsEventEmitter = new EventEmitter();

// Connection management
const connections = new Map<WebSocket, ClientConnection>();

// Subscription tracking (for efficient broadcasting)
const subscriptionsByChannel = new Map<string, Set<WebSocket>>();

let wss: WebSocketServer | null = null;

/**
 * Initialize WebSocket server
 */
export function setupWebSocket(server: Server) {
  wss = new WebSocketServer({
    server,
    path: '/ws',
    // Allow all origins in development, restrict in production
    verifyClient: (info: any) => {
      const origin = info.origin;
      const originHeader = info.req.headers.origin;
      
      console.log('[WebSocket] verifyClient called:', {
        origin,
        originHeader,
        url: info.req.url,
        method: info.req.method,
      });
      
      // In development, allow all origins
      if (process.env.NODE_ENV !== 'production') {
        console.log('[WebSocket] Development mode - allowing all origins');
        return true;
      }
      
      // In production, check against allowed origins
      const allowedOrigins = [
        'http://localhost:3000',
        'https://prediction-frontend-lilac.vercel.app',
        process.env.FRONTEND_URL,
      ].filter(Boolean);
      
      // If no origin header, allow (some clients like Postman don't send it)
      if (!origin && !originHeader) {
        console.log('[WebSocket] No origin header - allowing connection (Postman/curl)');
        return true;
      }
      
      const checkOrigin = origin || originHeader || '';
      const normalizedOrigin = checkOrigin.replace(/\/$/, '');
      
      // Check if origin matches any allowed origin
      const isAllowed = allowedOrigins.some(allowed => {
        const normalizedAllowed = (allowed || '').replace(/\/$/, '');
        return normalizedOrigin === normalizedAllowed || normalizedOrigin.includes(normalizedAllowed);
      });
      
      if (isAllowed) {
        console.log('[WebSocket] Origin allowed:', normalizedOrigin);
        return true;
      }
      
      console.warn('[WebSocket] Origin NOT allowed:', normalizedOrigin);
      console.warn('[WebSocket] Allowed origins:', allowedOrigins);
      console.warn('[WebSocket] FRONTEND_URL env:', process.env.FRONTEND_URL);
      return false;
    },
  });

  // Handle WebSocket server errors
  wss.on('error', (error) => {
    console.error('[WebSocket] Server error:', error);
  });

  wss.on('connection', async (ws: WebSocket, req) => {
    // Get client IP
    const ip = req.socket.remoteAddress || 
               (req.headers['x-forwarded-for'] as string)?.split(',')[0]?.trim() || 
               'unknown';

    // Log connection attempt with origin
    const origin = req.headers.origin || 'no-origin';
    console.log('[WebSocket] ✅ Connection ESTABLISHED:', {
      ip,
      origin,
      userAgent: req.headers['user-agent'],
      url: req.url,
      headers: {
        'x-forwarded-for': req.headers['x-forwarded-for'],
        'x-forwarded-proto': req.headers['x-forwarded-proto'],
        'host': req.headers['host'],
      },
    });

    try {
      // Register connection with rate limiting
      let connectionId: string;
      try {
        connectionId = await connectionManager.registerConnection(ws, ip);
      } catch (rateLimitError: any) {
        // If rate limit exceeded, close connection
        sendError(ws, 'CONNECTION_LIMIT_EXCEEDED', rateLimitError.message || 'Connection limit exceeded');
        ws.close(1008, 'Connection limit exceeded');
        return;
      }
      
      const connection: ClientConnection = {
        ws,
        subscriptions: new Map(),
        connectedAt: new Date(),
        lastPing: new Date(),
      };
      connections.set(ws, connection);

      // Send welcome message
      sendMessage(ws, {
        type: 'connected',
        timestamp: new Date().toISOString(),
        message: 'Connected to Space Prediction Markets WebSocket',
        connectionId,
      });

      // Handle messages with rate limiting
      ws.on('message', async (message: Buffer) => {
        try {
          const rawMessage = message.toString();
          
          // Check rate limit
          const rateLimit = await rateLimiter.checkMessageRate(connectionId);
          if (!rateLimit.allowed) {
            console.warn(`[WebSocket] Rate limit exceeded for connection ${connectionId}`);
            sendError(ws, 'RATE_LIMIT_EXCEEDED', 
              `Rate limit exceeded. ${rateLimit.remaining} messages remaining. Resets at ${new Date(rateLimit.resetAt).toISOString()}`);
            connectionManager.updateActivity(ws, 'error');
            return;
          }

          const data = JSON.parse(rawMessage);
          // Log all messages except ping/pong for debugging
          if (data.type !== 'ping' && data.type !== 'pong') {
            console.log(`[WebSocket] Received message:`, JSON.stringify(data));
            console.log(`[WebSocket] Connection exists in map:`, connections.has(ws));
          }
          connectionManager.updateActivity(ws, 'received');
          await handleMessage(ws, data);
        } catch (error: any) {
          console.error('[WebSocket] Error processing message:', error.message);
          connectionManager.updateActivity(ws, 'error');
          sendError(ws, 'INVALID_MESSAGE', `Invalid message format: ${error.message}`);
        }
      });

    // Handle close - ensure cleanup happens
    ws.on('close', async () => {
      try {
        await connectionManager.unregisterConnection(ws);
      } catch (error: any) {
        console.error('[WebSocket] Error during close cleanup:', error.message);
      }
      cleanupConnection(ws);
    });

    // Handle errors
    ws.on('error', async (error) => {
      console.error('[WebSocket] Connection error:', error);
      try {
        connectionManager.updateActivity(ws, 'error');
        await connectionManager.unregisterConnection(ws);
      } catch (cleanupError: any) {
        console.error('[WebSocket] Error during error cleanup:', cleanupError.message);
      }
      cleanupConnection(ws);
    });

    // Ping/pong for keepalive
    const pingInterval = setInterval(() => {
      if (ws.readyState === WebSocket.OPEN) {
        connection.lastPing = new Date();
        sendMessage(ws, { type: 'ping', timestamp: new Date().toISOString() });
      } else {
        clearInterval(pingInterval);
      }
    }, 30000); // Ping every 30 seconds

    ws.on('close', () => {
      clearInterval(pingInterval);
    });
    } catch (error: any) {
      // Handle connection registration errors
      console.error('[WebSocket] Connection registration error:', error);
      try {
        sendError(ws, 'CONNECTION_ERROR', 'Failed to register connection');
        ws.close(1011, 'Internal server error');
      } catch (closeError) {
        // Connection already closed or invalid
      }
    }
  });

  // Listen to events from services
  setupEventListeners();

  console.log('[WebSocket] Server initialized on /ws');
}

/**
 * Handle incoming WebSocket messages
 */
async function handleMessage(ws: WebSocket, data: any) {
  console.log(`[WebSocket] handleMessage called with type: ${data.type}`, JSON.stringify(data));
  console.log(`[WebSocket] Total connections in map: ${connections.size}`);
  
  const connection = connections.get(ws);
  if (!connection) {
    console.error('[WebSocket] Connection not found in connections map!');
    console.error('[WebSocket] Available connection keys:', Array.from(connections.keys()).map(k => k.readyState));
    console.error('[WebSocket] Current ws readyState:', ws.readyState);
    return;
  }

  console.log(`[WebSocket] handleMessage processing: ${data.type}`, data.channel ? `channel: ${data.channel}` : '');

  switch (data.type) {
    case 'ping':
      sendMessage(ws, { type: 'pong', timestamp: new Date().toISOString() });
      break;

    case 'pong':
      // Acknowledge pong from client (keepalive)
      connection.lastPing = new Date();
      break;

    case 'subscribe':
      console.log('[WebSocket] Routing subscribe message to handleSubscribe');
      await handleSubscribe(ws, data);
      break;

    case 'unsubscribe':
      await handleUnsubscribe(ws, data);
      break;

    case 'auth':
      await handleAuth(ws, data);
      break;

    default:
      console.warn(`[WebSocket] Unknown message type: ${data.type}`);
      sendError(ws, 'INVALID_MESSAGE_TYPE', `Unknown message type: ${data.type}`);
  }
}

/**
 * Handle subscription request
 */
async function handleSubscribe(ws: WebSocket, data: any) {
  console.log('[WebSocket] handleSubscribe called:', { channel: data.channel, market_id: data.market_id, outcome_id: data.outcome_id, user_id: data.user_id });
  
  const connection = connections.get(ws);
  if (!connection) {
    console.error('[WebSocket] Connection not found in connections map');
    return;
  }

  const connInfo = connectionManager.getConnection(ws);
  if (!connInfo) {
    console.error('[WebSocket] Connection not found in connectionManager');
    return sendError(ws, 'CONNECTION_NOT_FOUND', 'Connection not registered');
  }

  // Check subscription limits with rate limiter
  const subLimit = await rateLimiter.checkSubscriptionLimit(
    connInfo.id,
    connection.subscriptions.size
  );
  if (!subLimit.allowed) {
    console.warn('[WebSocket] Subscription limit exceeded');
    return sendError(ws, 'SUBSCRIPTION_LIMIT', 
      `Maximum ${rateLimiter['config'].maxSubscriptions} subscriptions per connection. ${subLimit.remaining} remaining.`);
  }

  const subscription: Subscription = {
    channel: data.channel,
    marketId: data.market_id,
    outcomeId: data.outcome_id,
    userId: data.user_id || connection.userId,
    tokenType: data.token_type || data.tokenType,
  };

  console.log('[WebSocket] Created subscription object:', subscription);

  // Validate subscription
  const validation = validateSubscription(subscription);
  if (!validation.valid) {
    console.error('[WebSocket] Subscription validation failed:', validation);
    return sendError(ws, validation.code || 'INVALID_SUBSCRIPTION', validation.message || 'Invalid subscription');
  }

  console.log('[WebSocket] Subscription validation passed');

  // Create subscription key
  const key = createSubscriptionKey(subscription);
  connection.subscriptions.set(key, subscription);
  
  // Update connection manager
  connectionManager.updateSubscriptions(ws, 1);

  // Track subscription for efficient broadcasting
  const channelKey = createChannelKey(subscription);
  if (!subscriptionsByChannel.has(channelKey)) {
    subscriptionsByChannel.set(channelKey, new Set());
  }
  subscriptionsByChannel.get(channelKey)!.add(ws);
  
  console.log(`[WebSocket] Subscription added: ${channelKey}, total subscribers: ${subscriptionsByChannel.get(channelKey)!.size}`);
  console.log(`[WebSocket] All active channels now:`, Array.from(subscriptionsByChannel.keys()));
  console.log(`[WebSocket] Channel '${channelKey}' has ${subscriptionsByChannel.get(channelKey)!.size} subscriber(s)`);

  // Send confirmation
  const confirmMessage = {
    type: 'subscribed',
    channel: subscription.channel,
    market_id: subscription.marketId,
    outcome_id: subscription.outcomeId,
    timestamp: new Date().toISOString(),
  };
  console.log('[WebSocket] Sending subscription confirmation:', confirmMessage);
  sendMessage(ws, confirmMessage);

  // Send initial data for orderbook subscriptions
  if (subscription.channel === 'orderbook' && subscription.marketId && subscription.outcomeId !== undefined) {
    try {
      console.log('[WebSocket] Sending initial orderbook for subscription:', {
        marketId: subscription.marketId,
        outcomeId: subscription.outcomeId,
        tokenType: subscription.tokenType,
      });

      // Use cached orderbook for better performance (with tokenType filter)
      const orderBook = await orderBookCache.getOrderBook(
        subscription.marketId,
        subscription.outcomeId,
        100,
        false,
        subscription.tokenType
      );

      console.log('[WebSocket] Initial orderbook fetched:', {
        bids: orderBook.bids.length,
        asks: orderBook.asks.length,
        lastPrice: orderBook.lastPrice,
        spread: orderBook.spread,
        tokenType: subscription.tokenType,
      });

      // Send initial orderbook immediately
      sendMessage(ws, {
        type: 'orderbook_update',
        market_id: subscription.marketId,
        outcome_id: subscription.outcomeId,
        token_type: subscription.tokenType,
        orderBook,
        timestamp: new Date().toISOString(),
      });
      connectionManager.updateActivity(ws, 'sent');
      console.log('[WebSocket] Initial orderbook sent to client');
    } catch (error: any) {
      console.error('[WebSocket] Error sending initial orderbook:', error);
      console.error('[WebSocket] Error details:', {
        message: error.message,
        stack: error.stack,
        marketId: subscription.marketId,
        outcomeId: subscription.outcomeId,
      });
      connectionManager.updateActivity(ws, 'error');
      // Send error to client
      sendError(ws, 'ORDERBOOK_FETCH_ERROR', `Failed to fetch initial orderbook: ${error.message}`);
    }
  }
}

/**
 * Handle unsubscribe request
 */
async function handleUnsubscribe(ws: WebSocket, data: any) {
  const connection = connections.get(ws);
  if (!connection) return;

  const subscription: Subscription = {
    channel: data.channel,
    marketId: data.market_id,
    outcomeId: data.outcome_id,
    userId: data.user_id,
  };

  const key = createSubscriptionKey(subscription);
  connection.subscriptions.delete(key);
  
  // Update connection manager
  connectionManager.updateSubscriptions(ws, -1);

  // Remove from channel tracking
  const channelKey = createChannelKey(subscription);
  const channelSubs = subscriptionsByChannel.get(channelKey);
  if (channelSubs) {
    channelSubs.delete(ws);
    if (channelSubs.size === 0) {
      subscriptionsByChannel.delete(channelKey);
    }
  }

  sendMessage(ws, {
    type: 'unsubscribed',
    channel: subscription.channel,
    market_id: subscription.marketId,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Handle authentication
 */
async function handleAuth(ws: WebSocket, data: any) {
  const connection = connections.get(ws);
  if (!connection) return;

  // For now, accept pubkey as authentication
  // In production, implement proper JWT or API key validation
  if (data.pubkey) {
    connection.pubkey = data.pubkey;
    connection.userId = data.pubkey; // Use pubkey as userId for now
    sendMessage(ws, {
      type: 'auth_success',
      timestamp: new Date().toISOString(),
    });
  } else {
    sendError(ws, 'INVALID_AUTH', 'Missing pubkey');
  }
}

/**
 * Validate subscription
 */
function validateSubscription(sub: Subscription): {
  valid: boolean;
  code?: string;
  message?: string;
} {
  const validChannels = [
    'orderbook',
    'trades',
    'order_matches',
    'liquidations',
    'user_orders',
    'user_positions',
    'market_price',
    'markets',
    'notifications',
  ];

  if (!validChannels.includes(sub.channel)) {
    return {
      valid: false,
      code: 'INVALID_CHANNEL',
      message: `Invalid channel. Valid channels: ${validChannels.join(', ')}`,
    };
  }

  // Channel-specific validation
  if (['orderbook', 'trades', 'order_matches', 'market_price'].includes(sub.channel)) {
    if (!sub.marketId) {
      return {
        valid: false,
        code: 'INVALID_SUBSCRIPTION',
        message: 'market_id required for this channel',
      };
    }
    if (sub.channel === 'orderbook' && sub.outcomeId === undefined) {
      return {
        valid: false,
        code: 'INVALID_SUBSCRIPTION',
        message: 'outcome_id required for orderbook channel',
      };
    }
  }

  if (['user_orders', 'user_positions', 'notifications'].includes(sub.channel)) {
    if (!sub.userId) {
      return {
        valid: false,
        code: 'UNAUTHORIZED',
        message: 'User authentication required for user-specific channels',
      };
    }
  }

  return { valid: true };
}

/**
 * Create subscription key
 */
function createSubscriptionKey(sub: Subscription): string {
  return `${sub.channel}:${sub.marketId || ''}:${sub.outcomeId ?? ''}:${sub.userId || ''}:${sub.tokenType || ''}`;
}

/**
 * Create channel key for broadcasting
 */
function createChannelKey(sub: Subscription): string {
  // For 'markets' channel, use just the channel name (no marketId/outcomeId)
  if (sub.channel === 'markets') {
    return 'markets';
  }
  // For orderbook with tokenType, include it in the key
  if (sub.channel === 'orderbook' && sub.tokenType) {
    return `${sub.channel}:${sub.marketId || ''}:${sub.outcomeId ?? ''}:${sub.tokenType}`;
  }
  return `${sub.channel}:${sub.marketId || ''}:${sub.outcomeId ?? ''}`;
}

/**
 * Send message to WebSocket client
 */
function sendMessage(ws: WebSocket, data: any) {
  if (ws.readyState === WebSocket.OPEN) {
    try {
      ws.send(JSON.stringify(data, (_key, value) =>
        typeof value === 'bigint' ? value.toString() : value
      ));
    } catch (error) {
      console.error('[WebSocket] Error sending message:', error);
    }
  }
}

/**
 * Send error message
 */
function sendError(ws: WebSocket, code: string, message: string) {
  sendMessage(ws, {
    type: 'error',
    code,
    message,
    timestamp: new Date().toISOString(),
  });
}

/**
 * Cleanup connection
 */
function cleanupConnection(ws: WebSocket) {
  const connection = connections.get(ws);
  if (connection) {
    // Remove all subscriptions
    for (const [key, sub] of connection.subscriptions.entries()) {
      const channelKey = createChannelKey(sub);
      const channelSubs = subscriptionsByChannel.get(channelKey);
      if (channelSubs) {
        channelSubs.delete(ws);
        if (channelSubs.size === 0) {
          subscriptionsByChannel.delete(channelKey);
        }
      }
    }
    connections.delete(ws);
  }
}

/**
 * Setup event listeners for broadcasting
 */
function setupEventListeners() {
  // Import OrderMatchingService for automatic matching
  let orderMatchingService: any = null;
  try {
    const { OrderMatchingService } = require('../services/orderMatchingService');
    orderMatchingService = new OrderMatchingService();
  } catch (error) {
    console.warn('[WebSocket] OrderMatchingService not available for automatic matching');
  }

  // Automatic matching when orders are placed
  wsEventEmitter.on('order_placed', async (data: { marketId: string; outcomeId: number; orderId: string }) => {
    if (!orderMatchingService) return;
    
    try {
      console.log(`[WebSocket] Order placed, triggering automatic matching for market ${data.marketId}, outcome ${data.outcomeId}`);
      // Trigger matching with a small delay to ensure order is committed to DB
      setTimeout(async () => {
        try {
          await orderMatchingService.matchMarketOrders(data.marketId, data.outcomeId);
        } catch (error) {
          console.error('[WebSocket] Error in automatic matching:', error);
        }
      }, 100);
    } catch (error) {
      console.error('[WebSocket] Error setting up automatic matching:', error);
    }
  });

  // Orderbook updates
  wsEventEmitter.on('orderbook_update', async (update: OrderBookUpdate) => {
    const timestamp = new Date().toISOString();

    // Broadcast to unfiltered subscribers (no tokenType)
    const channelKey = `orderbook:${update.marketId}:${update.outcomeId}`;
    const subscribers = subscriptionsByChannel.get(channelKey);
    const subscriberCount = subscribers?.size || 0;
    if (subscriberCount > 0) {
      console.log(`[WebSocket] Broadcasting orderbook update to ${subscriberCount} subscriber(s) for ${channelKey}`);
      broadcastToChannel('orderbook', update.marketId, update.outcomeId, {
        type: 'orderbook_update',
        market_id: update.marketId,
        outcome_id: update.outcomeId,
        orderBook: update.orderBook,
        timestamp,
      });
    }

    // Broadcast to tokenType-filtered subscribers (yes/no)
    for (const tokenType of ['yes', 'no'] as const) {
      const filteredKey = `orderbook:${update.marketId}:${update.outcomeId}:${tokenType}`;
      const filteredSubs = subscriptionsByChannel.get(filteredKey);
      if (filteredSubs && filteredSubs.size > 0) {
        try {
          // Re-fetch order book filtered by tokenType
          const filteredOrderBook = await orderBookCache.getOrderBook(
            update.marketId, update.outcomeId, 100, true, tokenType
          );
          console.log(`[WebSocket] Broadcasting filtered orderbook (${tokenType}) to ${filteredSubs.size} subscriber(s)`);
          // Broadcast directly to the filtered channel subscribers
          filteredSubs.forEach((ws) => {
            try {
              sendMessage(ws, {
                type: 'orderbook_update',
                market_id: update.marketId,
                outcome_id: update.outcomeId,
                token_type: tokenType,
                orderBook: filteredOrderBook,
                timestamp,
              });
              connectionManager.updateActivity(ws, 'sent');
            } catch (error) {
              console.error('[WebSocket] Error broadcasting filtered orderbook:', error);
              connectionManager.updateActivity(ws, 'error');
            }
          });
        } catch (error) {
          console.error(`[WebSocket] Error fetching filtered orderbook (${tokenType}):`, error);
        }
      }
    }
  });

  // Order matches
  wsEventEmitter.on('order_match', (event: OrderMatchEvent) => {
    broadcastToChannel('order_matches', event.marketId, event.outcomeId, {
      type: 'order_match',
      ...event,
    });
  });

  // Trades
  wsEventEmitter.on('trade', (event: TradeEvent) => {
    broadcastToChannel('trades', event.marketId, event.outcomeId, {
      type: 'trade',
      ...event,
    });
  });

  // Liquidations
  wsEventEmitter.on('liquidation', (event: LiquidationEvent) => {
    // Broadcast to liquidation channel
    broadcastToChannel('liquidations', event.marketId, event.outcomeId, {
      type: 'liquidation',
      ...event,
    });

    // Also send to specific user if connected
    broadcastToUser(event.userId, {
      type: 'liquidation',
      ...event,
    });
  });

  // Market price updates
  wsEventEmitter.on('market_price', (data: { marketId: string; outcomeId: number; price: number }) => {
    broadcastToChannel('market_price', data.marketId, data.outcomeId, {
      type: 'market_price',
      market_id: data.marketId,
      outcome_id: data.outcomeId,
      price: data.price,
      timestamp: new Date().toISOString(),
    });
  });

  // Market updates (created, updated, resolved)
  wsEventEmitter.on('market_update', (event: MarketEvent) => {
    // Broadcast to all subscribers of 'markets' channel
    const channelKey = 'markets';
    const subscribers = subscriptionsByChannel.get(channelKey);
    
    console.log(`[WebSocket] market_update event received: type=${event.type}, subscribers=${subscribers?.size || 0}`);
    console.log(`[WebSocket] Available channels:`, Array.from(subscriptionsByChannel.keys()));
    
    if (subscribers && subscribers.size > 0) {
      console.log(`[WebSocket] Broadcasting market update to ${subscribers.size} subscriber(s)`);
      subscribers.forEach((ws) => {
        try {
          const message = {
            type: 'market_update',
            event_type: event.type,
            market: event.market,
            timestamp: event.timestamp,
          };
          console.log(`[WebSocket] Sending market_update to subscriber:`, message);
          sendMessage(ws, message);
          connectionManager.updateActivity(ws, 'sent');
        } catch (error) {
          console.error('[WebSocket] Error broadcasting market update:', error);
          connectionManager.updateActivity(ws, 'error');
        }
      });
    } else {
      console.warn(`[WebSocket] No subscribers found for 'markets' channel!`);
    }
  });

  // User-specific order updates (after match execution by keeper)
  wsEventEmitter.on('user_order_update', (data: { userId: string; orderId: string; status: string; filledSize: string; avgFillPrice?: number | null }) => {
    broadcastToUser(data.userId, {
      type: 'order_update',
      order_id: data.orderId,
      status: data.status,
      filled_size: data.filledSize,
      avg_fill_price: data.avgFillPrice ?? null,
      user_id: data.userId,
    });
  });

  // User-specific position updates (after match execution by keeper)
  wsEventEmitter.on('user_position_update', (data: { userId: string; marketId: string }) => {
    broadcastToUser(data.userId, {
      type: 'position_update',
      action: 'refetch',
      user_id: data.userId,
      market_id: data.marketId,
    });
  });
}

/**
 * Broadcast message to all subscribers of a channel
 * Production-optimized with batching and connection tracking
 */
function broadcastToChannel(
  channel: string,
  marketId: string | undefined,
  outcomeId: number | undefined,
  message: any
) {
  const channelKey = `${channel}:${marketId || ''}:${outcomeId ?? ''}`;
  const subscribers = subscriptionsByChannel.get(channelKey);
  if (subscribers && subscribers.size > 0) {
    const subscriberCount = subscribers.size;
    
    // Send to all subscribers with connection tracking
    subscribers.forEach((ws) => {
      try {
        sendMessage(ws, message);
        connectionManager.updateActivity(ws, 'sent');
      } catch (error) {
        console.error('[WebSocket] Error broadcasting to subscriber:', error);
        connectionManager.updateActivity(ws, 'error');
      }
    });
  }
}

/**
 * Broadcast message to specific user
 */
export function broadcastToUser(userId: string, message: any) {
  let sent = false;
  connections.forEach((connection, ws) => {
    if (connection.userId === userId || connection.pubkey === userId) {
      // Check if user is subscribed to user-specific channels
      let hasSubscription = false;
      for (const sub of connection.subscriptions.values()) {
        if (sub.channel === 'user_orders' || sub.channel === 'user_positions' || sub.channel === 'notifications') {
          if (sub.userId === userId || connection.userId === userId || connection.pubkey === userId || !sub.userId) {
            hasSubscription = true;
            break;
          }
        }
      }
      
      // For notifications, always send if user matches (even without explicit subscription)
      // This ensures notifications are delivered
      if (message.type === 'notification' || hasSubscription) {
        sendMessage(ws, message);
        sent = true;
        console.log(`[WebSocket] Sent notification to user ${userId}, connection: ${connection.userId || connection.pubkey}, type: ${message.notification?.type}`);
      }
    }
  });
  
  if (!sent && message.type === 'notification') {
    console.warn(`[WebSocket] Notification not sent - no active connection for user ${userId}`);
  }
}

/**
 * Broadcast to all connections (for system-wide events)
 */
export function broadcastToAll(message: any) {
  connections.forEach((connection, ws) => {
    sendMessage(ws, message);
  });
}

/**
 * Get connection stats
 */
export function getConnectionStats() {
  return {
    totalConnections: connections.size,
    totalSubscriptions: Array.from(connections.values()).reduce(
      (sum, conn) => sum + conn.subscriptions.size,
      0
    ),
    channels: Array.from(subscriptionsByChannel.keys()),
  };
}

