import { useEffect, useRef, useState, useCallback } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { wsManager } from './websocketManager';

export interface OrderBookUpdate {
  market_id: string;
  outcome_id: number;
  orderBook: {
    bids: Array<{ price: number; size: number; orders: number }>;
    asks: Array<{ price: number; size: number; orders: number }>;
    lastPrice?: number;
    spread?: number;
  };
  timestamp: string;
}

export interface OrderMatchEvent {
  market_id: string;
  outcome_id: number;
  buyOrderId: string;
  sellOrderId: string;
  price: number;
  size: number;
  timestamp: string;
}

export interface TradeEvent {
  market_id: string;
  outcome_id: number;
  side: 'buy' | 'sell';
  price: number;
  size: number;
  timestamp: string;
}

export interface LiquidationEvent {
  market_id: string;
  outcome_id: number;
  user_id: string;
  position_id: string;
  liquidation_price: number;
  current_price: number;
  equity: string;
  timestamp: string;
}

export interface MarketPriceUpdate {
  market_id: string;
  outcome_id: number;
  price: number;
  timestamp: string;
}

export interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

/**
 * React hook for WebSocket connection to backend
 * Uses singleton WebSocketManager to ensure only ONE connection
 */
export function useWebSocket() {
  const { publicKey, connected } = useWallet();
  const [isConnected, setIsConnected] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Connect using singleton manager
  useEffect(() => {
    // Always connect immediately (don't wait for wallet)
    // This ensures WebSocket is available for public data (orderbooks, market updates)
    console.log('[useWebSocket] Initializing WebSocket connection...', {
      walletConnected: connected,
      hasPublicKey: !!publicKey,
    });
    
    // Connect immediately - wallet can be added later
    wsManager.connect();

    // Update connection state
    const updateConnection = () => {
      setIsConnected(wsManager.getIsConnected());
    };

    // Register callbacks
    const cleanupConnect = wsManager.onConnect(() => {
      setIsConnected(true);
      setError(null);
    });

    const cleanupDisconnect = wsManager.onDisconnect(() => {
      setIsConnected(false);
    });

    const cleanupError = wsManager.onError((errorMsg) => {
      setError(errorMsg);
    });

    // Initial state
    setIsConnected(wsManager.getIsConnected());

    return () => {
      cleanupConnect();
      cleanupDisconnect();
      cleanupError();
    };
  }, []); // Empty deps - connect once on mount, wallet auth happens separately

  // Re-authenticate when publicKey becomes available
  useEffect(() => {
    if (publicKey && isConnected) {
      console.log('[useWebSocket] Wallet connected, authenticating WebSocket...', publicKey.toString().slice(0, 8) + '...');
      // Reconnect with publicKey for authentication
      wsManager.connect(publicKey.toString());
    }
  }, [publicKey, isConnected]);

  // Subscribe to a channel
  const subscribe = useCallback((
    channel: string,
    options?: {
      marketId?: string;
      outcomeId?: number;
      userId?: string;
      tokenType?: 'yes' | 'no';
    }
  ) => {
    wsManager.subscribe(channel, options);
  }, []);

  // Unsubscribe from a channel
  const unsubscribe = useCallback((
    channel: string,
    options?: {
      marketId?: string;
      outcomeId?: number;
      userId?: string;
      tokenType?: 'yes' | 'no';
    }
  ) => {
    wsManager.unsubscribe(channel, options);
  }, []);

  // Register a message handler
  const onMessage = useCallback((type: string, handler: (data: any) => void) => {
    return wsManager.onMessage(type, handler);
  }, []);

  const disconnect = useCallback(() => {
    // Don't disconnect the shared connection, just clear local state
    setIsConnected(false);
  }, []);

  return {
    ws: null, // Not exposed anymore since it's managed by singleton
    isConnected,
    error,
    subscribe,
    unsubscribe,
    onMessage,
    disconnect,
  };
}

