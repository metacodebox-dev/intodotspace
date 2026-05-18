import { useState, useEffect, useCallback, useRef } from 'react';
import { useWebSocket } from './useWebSocket';
import axios from 'axios';
import { Market } from '@/types/market';
import { displayQuoteSymbol } from '@/utils/solana';

// Rewrite quoteSymbol at the API boundary so the entire UI renders "SPC"
// without touching every JSX site. Internal filter values stay "SPACE".
function withDisplaySymbol<M extends { quoteSymbol?: string }>(m: M): M {
  return m.quoteSymbol ? { ...m, quoteSymbol: displayQuoteSymbol(m.quoteSymbol) } : m;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
const ITEMS_PER_PAGE = 20;

interface UseMarketsParams {
  category?: string;
  status?: string;
  search?: string;
  /** Filter by quote token symbol, e.g. 'SPACE'. Empty/undefined shows all. */
  quoteSymbol?: string;
}

/**
 * WebSocket-enabled hook for markets list
 * Fetches initial data via REST API with search + pagination, then receives real-time updates via WebSocket
 */
export function useMarketsWebSocket(params: UseMarketsParams = {}) {
  const [markets, setMarkets] = useState<Market[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const offsetRef = useRef(0);
  const hasFetchedRef = useRef(false);
  const { isConnected, subscribe, unsubscribe, onMessage } = useWebSocket();

  // Fetch markets (initial or load more)
  const fetchMarkets = useCallback(async (loadMore = false) => {
    if (loadMore) {
      setLoadingMore(true);
    } else {
      // Only show skeleton on the very first load
      if (!hasFetchedRef.current) {
        setLoading(true);
      }
      setError(null);
      offsetRef.current = 0;
    }

    try {
      const currentOffset = loadMore ? offsetRef.current : 0;
      const response = await axios.get(`${API_URL}/api/v1/markets`, {
        params: {
          category: params.category || undefined,
          status: params.status || undefined,
          search: params.search || undefined,
          quoteSymbol: params.quoteSymbol || undefined,
          limit: ITEMS_PER_PAGE,
          offset: currentOffset,
        },
      });

      const { markets: fetched, total } = response.data;
      const newMarkets = (fetched || []).map((m: Market) => withDisplaySymbol(m));

      if (loadMore) {
        setMarkets(prev => [...prev, ...newMarkets]);
      } else {
        setMarkets(newMarkets);
      }

      offsetRef.current = currentOffset + newMarkets.length;
      setHasMore(offsetRef.current < total);
    } catch (err: any) {
      setError(err.message || 'Failed to fetch markets');
      if (!loadMore) setMarkets([]);
    } finally {
      setLoading(false);
      setLoadingMore(false);
      hasFetchedRef.current = true;
    }
  }, [params.category, params.status, params.search, params.quoteSymbol]);

  // Reset and fetch when filters/search change
  useEffect(() => {
    fetchMarkets(false);
  }, [fetchMarkets]);

  // Load more function for infinite scroll
  const loadMore = useCallback(() => {
    if (!loadingMore && hasMore) {
      fetchMarkets(true);
    }
  }, [loadingMore, hasMore, fetchMarkets]);

  // Subscribe to market updates via WebSocket
  useEffect(() => {
    if (!isConnected) return;

    subscribe('markets');

    const cleanup = onMessage('market_update', (data: {
      event_type: 'created' | 'updated' | 'resolved';
      market: Market;
      timestamp: string;
    }) => {
      setMarkets((prevMarkets) => {
        const incoming = withDisplaySymbol(data.market);
        if (data.event_type === 'created') {
          const exists = prevMarkets.some(m =>
            (m.id && incoming.id && m.id === incoming.id) ||
            (m.marketAddress && incoming.marketAddress && m.marketAddress === incoming.marketAddress)
          );
          if (exists) return prevMarkets;
          return [incoming, ...prevMarkets];
        } else if (data.event_type === 'updated' || data.event_type === 'resolved') {
          return prevMarkets.map((market) => {
            if (
              (market.id && incoming.id && market.id === incoming.id) ||
              (market.marketAddress && incoming.marketAddress && market.marketAddress === incoming.marketAddress)
            ) {
              return { ...market, ...incoming };
            }
            return market;
          });
        }
        return prevMarkets;
      });
    });

    return () => {
      unsubscribe('markets');
      cleanup();
    };
  }, [isConnected, subscribe, unsubscribe, onMessage]);

  return { markets, loading, loadingMore, error, hasMore, loadMore, refetch: () => fetchMarkets(false) };
}
