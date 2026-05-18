import { useState, useEffect } from 'react';
import { useWebSocket } from './useWebSocket';
import { OrderBookUpdate } from './useWebSocket';

export interface OrderBookLevel {
  price: number;
  size: number;
  orders: number;
}

export interface OrderBook {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  lastPrice?: number;
  spread?: number;
}

/**
 * Hook to get real-time orderbook updates via WebSocket
 * Replaces the polling-based useOrderBook hook
 */
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export function useOrderBookWebSocket(marketId: string, outcomeId: number, depth: number = 100, tokenType?: 'yes' | 'no') {
  const { isConnected, subscribe, unsubscribe, onMessage } = useWebSocket();
  const [orderBook, setOrderBook] = useState<OrderBook | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [initialFetchDone, setInitialFetchDone] = useState(false);

  // Reset state when tokenType changes
  useEffect(() => {
    setOrderBook(null);
    setLoading(true);
    setInitialFetchDone(false);
  }, [tokenType]);

  // Fallback: Fetch initial orderbook via REST API if WebSocket doesn't provide it
  useEffect(() => {
    if (!marketId || outcomeId === undefined) {
      return;
    }

    // Fetch initial orderbook via REST API as fallback
    const fetchInitialOrderBook = async () => {
      try {
        const params: any = { depth };
        if (tokenType) {
          params.tokenType = tokenType;
        }
        const response = await axios.get(`${API_URL}/api/v1/orderbook/${marketId}/${outcomeId}`, {
          params,
        });

        const orderBookData = response.data.orderBook || response.data;
        if (orderBookData) {
          setOrderBook({
            bids: Array.isArray(orderBookData.bids) ? orderBookData.bids : [],
            asks: Array.isArray(orderBookData.asks) ? orderBookData.asks : [],
            lastPrice: orderBookData.lastPrice,
            spread: orderBookData.spread,
          });
          setLoading(false);
          setInitialFetchDone(true);
          console.log('[useOrderBookWebSocket] Initial orderbook fetched via REST API', { tokenType });
        }
      } catch (err) {
        console.error('[useOrderBookWebSocket] Error fetching initial orderbook:', err);
        setError(err instanceof Error ? err : new Error('Failed to fetch orderbook'));
        setLoading(false);
      }
    };

    // Fetch immediately, then WebSocket will update it
    fetchInitialOrderBook();
  }, [marketId, outcomeId, depth, tokenType]);

  useEffect(() => {
    if (!marketId || outcomeId === undefined || !isConnected) {
      return;
    }

    // Subscribe to orderbook updates (include tokenType for filtered subscriptions)
    subscribe('orderbook', { marketId, outcomeId, tokenType });

    // Handle orderbook updates
    const cleanup = onMessage('orderbook_update', (data: OrderBookUpdate) => {
      if (data.market_id === marketId && data.outcome_id === outcomeId
          && (!tokenType || (data as any).token_type === tokenType)) {
        setOrderBook({
          bids: Array.isArray(data.orderBook.bids) ? data.orderBook.bids : [],
          asks: Array.isArray(data.orderBook.asks) ? data.orderBook.asks : [],
          lastPrice: data.orderBook.lastPrice,
          spread: data.orderBook.spread,
        });
        setLoading(false);
        setError(null);
      }
    });

    return () => {
      unsubscribe('orderbook', { marketId, outcomeId, tokenType });
      cleanup();
    };
  }, [marketId, outcomeId, isConnected, tokenType]); // Removed subscribe, unsubscribe, onMessage from deps

  return { orderBook, loading, error };
}

/**
 * Hook to get real-time market price updates via WebSocket
 * Fetches initial price from API, then updates via WebSocket
 */
export function useMarketPriceWebSocket(marketId: string, outcomeId: number) {
  const { isConnected, subscribe, unsubscribe, onMessage } = useWebSocket();
  const [price, setPrice] = useState<number | null>(null);
  const [loading, setLoading] = useState(true);
  const [initialFetchDone, setInitialFetchDone] = useState(false);

  // Fetch initial price from API (fallback before WebSocket connects)
  useEffect(() => {
    if (!marketId || outcomeId === undefined || initialFetchDone) {
      return;
    }

    const fetchInitialPrice = async () => {
      try {
        const response = await axios.get(`${API_URL}/api/v1/orderbook/${marketId}/${outcomeId}/price`);
        if (response.data.price !== null && response.data.price !== undefined) {
          setPrice(response.data.price);
          setLoading(false);
          setInitialFetchDone(true);
          console.log('[useMarketPriceWebSocket] Initial price fetched via REST API:', response.data.price);
        }
      } catch (err) {
        console.error('[useMarketPriceWebSocket] Error fetching initial price:', err);
        // Don't set loading to false on error - let WebSocket handle it
      }
    };

    fetchInitialPrice();
  }, [marketId, outcomeId, initialFetchDone]);

  useEffect(() => {
    if (!marketId || outcomeId === undefined || !isConnected) {
      return;
    }

    // Subscribe to market price updates
    subscribe('market_price', { marketId, outcomeId });

    // Handle price updates
    const cleanup = onMessage('market_price', (data: { market_id: string; outcome_id: number; price: number }) => {
      if (data.market_id === marketId && data.outcome_id === outcomeId) {
        setPrice(data.price);
        setLoading(false);
      }
    });

    return () => {
      unsubscribe('market_price', { marketId, outcomeId });
      cleanup();
    };
  }, [marketId, outcomeId, isConnected]); // Removed subscribe, unsubscribe, onMessage from deps

  return { price, loading };
}

