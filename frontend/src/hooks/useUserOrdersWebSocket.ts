import { useState, useEffect, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWebSocket } from './useWebSocket';
import axios from 'axios';
import { displayQuoteSymbol } from '@/utils/solana';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export interface UserOrder {
  id: string;
  marketId: string;
  outcomeId: number;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  price: number;
  size: string;
  filled: string;
  avgFillPrice: number | null;
  leverage: number;
  status: 'pending' | 'open' | 'partially_filled' | 'filled' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  orderId?: number | null;
  onChainOrder?: string | null;
  tokenType?: 'yes' | 'no' | null;
  // Quote-token metadata wired through the orders API so cross-market lists
  // can render the correct symbol/decimals without extra lookups.
  quoteMint?: string | null;
  quoteDecimals?: number;
  quoteSymbol?: string;
}

/**
 * Hook to get real-time user order updates via WebSocket
 * Replaces polling-based order fetching
 * Fetches ALL orders once, filtering should be done client-side
 */
export function useUserOrdersWebSocket() {
  const { publicKey, connected } = useWallet();
  const { isConnected, subscribe, unsubscribe, onMessage } = useWebSocket();
  const [orders, setOrders] = useState<UserOrder[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [hasFetched, setHasFetched] = useState(false);

  // Memoize publicKey string to avoid unnecessary re-renders
  const userId = useMemo(() => publicKey?.toString() || null, [publicKey]);

  // Initial fetch via REST API - only once per user connection
  useEffect(() => {
    if (!connected || !userId || hasFetched) {
      if (!connected || !userId) {
        setOrders([]);
        setLoading(false);
        setHasFetched(false);
      }
      return;
    }

    let cancelled = false;

    const fetchOrders = async () => {
      try {
        setLoading(true);
        const url = `${API_URL}/api/v1/orders/user/${userId}`;
        // Fetch ALL orders - no status filter to avoid multiple requests
        const response = await axios.get(url);
        
        if (!cancelled) {
          // Rewrite quote symbol for UI display (SPACE → SPC).
          const fetched: UserOrder[] = (response.data.orders || []).map((o: UserOrder) =>
            o.quoteSymbol ? { ...o, quoteSymbol: displayQuoteSymbol(o.quoteSymbol) } : o
          );
          setOrders(fetched);
          setLoading(false);
          setError(null);
          setHasFetched(true);
        }
      } catch (err: any) {
        if (!cancelled) {
          console.error('Error fetching user orders:', err);
          setError(err instanceof Error ? err : new Error('Failed to fetch orders'));
          setLoading(false);
          setHasFetched(true);
        }
      }
    };

    fetchOrders();

    return () => {
      cancelled = true;
    };
  }, [connected, userId, hasFetched]);

  // Subscribe to WebSocket updates
  useEffect(() => {
    if (!connected || !userId || !isConnected) {
      return;
    }

    // Subscribe to user orders channel
    subscribe('user_orders', { userId });

    // Handle order updates
    const cleanup = onMessage('order_update', (data: {
      order_id: string;
      status: string;
      filled_size: string;
      remaining_size: string;
      avg_fill_price?: number | null;
      user_id?: string;
    }) => {
      if (data.user_id === userId || !data.user_id) {
        // Update order in state
        setOrders((prevOrders) => {
          // Check if order exists, update it, or add if new
          const existingIndex = prevOrders.findIndex(o => o.id === data.order_id);

          if (existingIndex >= 0) {
            // Update existing order
            const updated = [...prevOrders];
            updated[existingIndex] = {
              ...updated[existingIndex],
              status: data.status as any,
              filled: data.filled_size || updated[existingIndex].filled,
              avgFillPrice: data.avg_fill_price ?? updated[existingIndex].avgFillPrice,
            };
            return updated;
          }
          // Order not found in state - trigger a full refetch
          setHasFetched(false);
          return prevOrders;
        });
      }
    });

    return () => {
      unsubscribe('user_orders', { userId });
      cleanup();
    };
  }, [connected, userId, isConnected]); // Removed subscribe, unsubscribe, onMessage from deps

  return { orders, loading, error, refetch: () => {
    setHasFetched(false);
    setLoading(true);
  } };
}

