# WebSocket API Implementation Guide

Complete implementation guide for Space Prediction Markets WebSocket API based on [Space WebSocket Documentation](https://docs.into.space/en/api/websocket).

## Overview

Real-time WebSocket feeds for market data, orderbook updates, trades, and user-specific updates.

## Implementation

### WebSocket Server Setup (`backend/src/websocket/index.ts`)

```typescript
import { Server } from 'http';
import { WebSocketServer, WebSocket } from 'ws';
import { MarketService } from '../services/marketService';
import { OrderbookService } from '../services/orderbookService';
import { TradeService } from '../services/tradeService';

interface Subscription {
  channel: string;
  marketId?: string;
  outcomeId?: number;
  side?: 'yes' | 'no';
  user?: string;
}

interface ClientConnection {
  ws: WebSocket;
  subscriptions: Map<string, Subscription>;
  apiKey?: string;
  userId?: string;
}

const connections = new Map<WebSocket, ClientConnection>();

export function setupWebSocket(server: Server) {
  const wss = new WebSocketServer({
    server,
    path: '/ws',
  });

  wss.on('connection', (ws: WebSocket) => {
    const connection: ClientConnection = {
      ws,
      subscriptions: new Map(),
    };
    connections.set(ws, connection);

    ws.on('message', async (message: Buffer) => {
      try {
        const data = JSON.parse(message.toString());
        await handleMessage(ws, data);
      } catch (error) {
        sendError(ws, 'INVALID_MESSAGE', 'Invalid message format');
      }
    });

    ws.on('close', () => {
      connections.delete(ws);
    });

    ws.on('error', (error) => {
      console.error('WebSocket error:', error);
      connections.delete(ws);
    });

    // Send welcome message
    sendMessage(ws, {
      type: 'connected',
      timestamp: new Date().toISOString(),
    });
  });

  // Start broadcasting updates
  startBroadcasting();
}

async function handleMessage(ws: WebSocket, data: any) {
  const connection = connections.get(ws);
  if (!connection) return;

  switch (data.type) {
    case 'auth':
      await handleAuth(ws, data);
      break;
    case 'subscribe':
      await handleSubscribe(ws, data);
      break;
    case 'unsubscribe':
      await handleUnsubscribe(ws, data);
      break;
    case 'ping':
      sendMessage(ws, { type: 'pong', timestamp: new Date().toISOString() });
      break;
    default:
      sendError(ws, 'INVALID_MESSAGE_TYPE', 'Unknown message type');
  }
}

async function handleAuth(ws: WebSocket, data: any) {
  const connection = connections.get(ws);
  if (!connection) return;

  if (data.api_key) {
    // Validate API key
    const user = await validateApiKey(data.api_key);
    if (user) {
      connection.apiKey = data.api_key;
      connection.userId = user.id;
      sendMessage(ws, {
        type: 'auth_success',
        timestamp: new Date().toISOString(),
      });
    } else {
      sendError(ws, 'INVALID_API_KEY', 'Invalid API key');
    }
  } else {
    sendError(ws, 'INVALID_AUTH', 'Missing api_key');
  }
}

async function handleSubscribe(ws: WebSocket, data: any) {
  const connection = connections.get(ws);
  if (!connection) return;

  // Check subscription limits
  if (connection.subscriptions.size >= 10) {
    return sendError(ws, 'SUBSCRIPTION_LIMIT', 'Maximum 10 subscriptions per connection');
  }

  const subscription: Subscription = {
    channel: data.channel,
    marketId: data.market_id,
    outcomeId: data.outcome_id,
    side: data.side,
    user: data.user,
  };

  // Validate subscription
  const validation = validateSubscription(subscription);
  if (!validation.valid) {
    return sendError(ws, validation.code, validation.message);
  }

  // Create subscription key
  const key = createSubscriptionKey(subscription);
  connection.subscriptions.set(key, subscription);

  sendMessage(ws, {
    type: 'subscribed',
    channel: data.channel,
    market_id: data.market_id,
    timestamp: new Date().toISOString(),
  });
}

async function handleUnsubscribe(ws: WebSocket, data: any) {
  const connection = connections.get(ws);
  if (!connection) return;

  const subscription: Subscription = {
    channel: data.channel,
    marketId: data.market_id,
    outcomeId: data.outcome_id,
    side: data.side,
    user: data.user,
  };

  const key = createSubscriptionKey(subscription);
  connection.subscriptions.delete(key);

  sendMessage(ws, {
    type: 'unsubscribed',
    channel: data.channel,
    market_id: data.market_id,
    timestamp: new Date().toISOString(),
  });
}

function validateSubscription(sub: Subscription): {
  valid: boolean;
  code?: string;
  message?: string;
} {
  // Validate channel
  const validChannels = ['market', 'orderbook', 'trades', 'user_orders', 'user_positions'];
  if (!validChannels.includes(sub.channel)) {
    return {
      valid: false,
      code: 'INVALID_CHANNEL',
      message: 'Invalid channel',
    };
  }

  // Channel-specific validation
  if (sub.channel === 'orderbook' || sub.channel === 'trades') {
    if (!sub.marketId) {
      return {
        valid: false,
        code: 'INVALID_SUBSCRIPTION',
        message: 'market_id required for orderbook and trades',
      };
    }
    if (sub.channel === 'orderbook' && !sub.outcomeId) {
      return {
        valid: false,
        code: 'INVALID_SUBSCRIPTION',
        message: 'outcome_id required for orderbook',
      };
    }
  }

  if (sub.channel === 'user_orders' || sub.channel === 'user_positions') {
    if (!sub.user && !connections.get(ws as any)?.userId) {
      return {
        valid: false,
        code: 'UNAUTHORIZED',
        message: 'User authentication required',
      };
    }
  }

  return { valid: true };
}

function createSubscriptionKey(sub: Subscription): string {
  return `${sub.channel}:${sub.marketId || ''}:${sub.outcomeId ?? ''}:${sub.side || ''}:${sub.user || ''}`;
}

function sendMessage(ws: WebSocket, data: any) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

function sendError(ws: WebSocket, code: string, message: string) {
  sendMessage(ws, {
    type: 'error',
    code,
    message,
    timestamp: new Date().toISOString(),
  });
}

// Broadcasting functions
function startBroadcasting() {
  // Broadcast market updates every 1 second
  setInterval(() => {
    broadcastMarketUpdates();
  }, 1000);

  // Broadcast orderbook updates every 500ms
  setInterval(() => {
    broadcastOrderbookUpdates();
  }, 500);

  // Broadcast trades immediately (triggered by trade events)
  // TradeService.onTrade((trade) => broadcastTrade(trade));
}

async function broadcastMarketUpdates() {
  const marketService = new MarketService();
  
  for (const [ws, connection] of connections.entries()) {
    for (const [key, sub] of connection.subscriptions.entries()) {
      if (sub.channel === 'market' && sub.marketId) {
        try {
          const market = await marketService.getMarketById(sub.marketId);
          if (market) {
            sendMessage(ws, {
              type: 'market_update',
              market_id: sub.marketId,
              data: {
                outcomes: market.outcomes,
                total_volume: market.total_volume,
                total_liquidity: market.total_liquidity,
              },
              timestamp: new Date().toISOString(),
            });
          }
        } catch (error) {
          console.error('Error broadcasting market update:', error);
        }
      }
    }
  }
}

async function broadcastOrderbookUpdates() {
  const orderbookService = new OrderbookService();
  
  for (const [ws, connection] of connections.entries()) {
    for (const [key, sub] of connection.subscriptions.entries()) {
      if (sub.channel === 'orderbook' && sub.marketId && sub.outcomeId !== undefined) {
        try {
          const orderbook = await orderbookService.getOrderbook({
            marketId: sub.marketId,
            outcomeId: sub.outcomeId,
            side: sub.side,
            depth: 20,
          });

          sendMessage(ws, {
            type: 'orderbook_update',
            market_id: sub.marketId,
            outcome_id: sub.outcomeId,
            side: sub.side,
            bids: orderbook.bids,
            asks: orderbook.asks,
            last_price: orderbook.last_price,
            timestamp: new Date().toISOString(),
          });
        } catch (error) {
          console.error('Error broadcasting orderbook update:', error);
        }
      }
    }
  }
}

export function broadcastTrade(trade: any) {
  for (const [ws, connection] of connections.entries()) {
    for (const [key, sub] of connection.subscriptions.entries()) {
      if (
        sub.channel === 'trades' &&
        sub.marketId === trade.market_id &&
        (sub.outcomeId === undefined || sub.outcomeId === trade.outcome_id)
      ) {
        sendMessage(ws, {
          type: 'trade',
          ...trade,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }
}

export function broadcastOrderUpdate(order: any) {
  for (const [ws, connection] of connections.entries()) {
    for (const [key, sub] of connection.subscriptions.entries()) {
      if (
        sub.channel === 'user_orders' &&
        (sub.user === order.user || connection.userId === order.user)
      ) {
        sendMessage(ws, {
          type: 'order_update',
          order_id: order.order_id,
          status: order.status,
          filled_size: order.filled_size,
          remaining_size: order.remaining_size,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }
}

export function broadcastPositionUpdate(position: any) {
  for (const [ws, connection] of connections.entries()) {
    for (const [key, sub] of connection.subscriptions.entries()) {
      if (
        sub.channel === 'user_positions' &&
        (sub.user === position.user || connection.userId === position.user)
      ) {
        sendMessage(ws, {
          type: 'position_update',
          position_id: position.position_id,
          shares: position.shares,
          current_price: position.current_price,
          unrealized_pnl: position.unrealized_pnl,
          timestamp: new Date().toISOString(),
        });
      }
    }
  }
}

async function validateApiKey(apiKey: string): Promise<any> {
  // Implement API key validation
  // Return user object if valid
  return null;
}
```

## Usage Examples

### JavaScript/TypeScript Client

```typescript
class SpaceWebSocket {
  private ws: WebSocket;
  private subscriptions: Set<string> = new Set();

  constructor(url: string) {
    this.ws = new WebSocket(url);
    this.setupHandlers();
  }

  private setupHandlers() {
    this.ws.onopen = () => {
      console.log('Connected to Space WebSocket');
    };

    this.ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      this.handleMessage(data);
    };

    this.ws.onerror = (error) => {
      console.error('WebSocket error:', error);
    };

    this.ws.onclose = () => {
      console.log('Disconnected from Space WebSocket');
      // Implement reconnection logic
    };
  }

  private handleMessage(data: any) {
    switch (data.type) {
      case 'connected':
        console.log('Connected:', data);
        break;
      case 'market_update':
        this.onMarketUpdate(data);
        break;
      case 'orderbook_update':
        this.onOrderbookUpdate(data);
        break;
      case 'trade':
        this.onTrade(data);
        break;
      case 'order_update':
        this.onOrderUpdate(data);
        break;
      case 'position_update':
        this.onPositionUpdate(data);
        break;
      case 'error':
        console.error('WebSocket error:', data);
        break;
    }
  }

  authenticate(apiKey: string) {
    this.send({
      type: 'auth',
      api_key: apiKey,
    });
  }

  subscribeMarket(marketId: string) {
    this.send({
      type: 'subscribe',
      channel: 'market',
      market_id: marketId,
    });
    this.subscriptions.add(`market:${marketId}`);
  }

  subscribeOrderbook(marketId: string, outcomeId: number, side?: 'yes' | 'no') {
    this.send({
      type: 'subscribe',
      channel: 'orderbook',
      market_id: marketId,
      outcome_id: outcomeId,
      side,
    });
    this.subscriptions.add(`orderbook:${marketId}:${outcomeId}:${side || ''}`);
  }

  subscribeTrades(marketId: string, outcomeId?: number) {
    this.send({
      type: 'subscribe',
      channel: 'trades',
      market_id: marketId,
      outcome_id: outcomeId,
    });
    this.subscriptions.add(`trades:${marketId}:${outcomeId || ''}`);
  }

  subscribeUserOrders(userPubkey: string) {
    this.send({
      type: 'subscribe',
      channel: 'user_orders',
      user: userPubkey,
    });
    this.subscriptions.add(`user_orders:${userPubkey}`);
  }

  subscribeUserPositions(userPubkey: string) {
    this.send({
      type: 'subscribe',
      channel: 'user_positions',
      user: userPubkey,
    });
    this.subscriptions.add(`user_positions:${userPubkey}`);
  }

  unsubscribe(channel: string, marketId?: string) {
    this.send({
      type: 'unsubscribe',
      channel,
      market_id: marketId,
    });
    this.subscriptions.delete(`${channel}:${marketId || ''}`);
  }

  private send(data: any) {
    if (this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(data));
    }
  }

  // Event handlers (override in your implementation)
  onMarketUpdate(data: any) {}
  onOrderbookUpdate(data: any) {}
  onTrade(data: any) {}
  onOrderUpdate(data: any) {}
  onPositionUpdate(data: any) {}
}

// Usage
const ws = new SpaceWebSocket('wss://api.space.markets/ws');

ws.onMarketUpdate = (data) => {
  console.log('Market updated:', data);
  // Update UI
};

ws.onOrderbookUpdate = (data) => {
  console.log('Orderbook updated:', data);
  // Update orderbook UI
};

ws.onTrade = (data) => {
  console.log('New trade:', data);
  // Update trades list
};

// Subscribe to updates
ws.subscribeMarket('market_abc123');
ws.subscribeOrderbook('market_abc123', 0, 'yes');
ws.subscribeTrades('market_abc123', 0);
```

### React Hook Example

```typescript
import { useEffect, useRef, useState } from 'react';

export function useSpaceWebSocket(url: string) {
  const [connected, setConnected] = useState(false);
  const [marketData, setMarketData] = useState<any>(null);
  const [orderbook, setOrderbook] = useState<any>(null);
  const [trades, setTrades] = useState<any[]>([]);
  const wsRef = useRef<SpaceWebSocket | null>(null);

  useEffect(() => {
    const ws = new SpaceWebSocket(url);
    wsRef.current = ws;

    ws.onMarketUpdate = (data) => {
      setMarketData(data);
    };

    ws.onOrderbookUpdate = (data) => {
      setOrderbook(data);
    };

    ws.onTrade = (data) => {
      setTrades((prev) => [data, ...prev].slice(0, 100));
    };

    return () => {
      ws.ws.close();
    };
  }, [url]);

  const subscribeMarket = (marketId: string) => {
    wsRef.current?.subscribeMarket(marketId);
  };

  const subscribeOrderbook = (marketId: string, outcomeId: number, side?: 'yes' | 'no') => {
    wsRef.current?.subscribeOrderbook(marketId, outcomeId, side);
  };

  return {
    connected,
    marketData,
    orderbook,
    trades,
    subscribeMarket,
    subscribeOrderbook,
  };
}
```

## Implementation Checklist

### WebSocket Server
- [ ] Setup WebSocket server
- [ ] Implement authentication
- [ ] Implement subscription management
- [ ] Implement broadcasting
- [ ] Add reconnection handling
- [ ] Add rate limiting per connection
- [ ] Add subscription limits

### Channels
- [ ] Market updates channel
- [ ] Orderbook updates channel
- [ ] Trades channel
- [ ] User orders channel
- [ ] User positions channel

### Client Libraries
- [ ] JavaScript/TypeScript client
- [ ] React hooks
- [ ] Vue composables
- [ ] Python client
- [ ] Documentation

### Testing
- [ ] Unit tests
- [ ] Integration tests
- [ ] Load testing
- [ ] Connection stability tests

---

**References:**
- [Space WebSocket API Documentation](https://docs.into.space/en/api/websocket)
- [Space REST API Documentation](https://docs.into.space/en/api/rest)





