import { useState, useEffect, useCallback, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { useSpaceProgram } from './useSpaceProgram';
import { getPendingOrderPDA } from '@/utils/solana';
import { useWebSocket } from './useWebSocket';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface MatchedOrder {
  id: string;
  marketId: string;
  outcomeId: number;
  side: 'buy' | 'sell';
  price: number;
  size: string;
  filled: string;
  leverage: number;
  status: string;
  orderId: number; // Order ID for PDA derivation
  userPubkey: string; // User's public key for PDA derivation
  matchedWith?: {
    orderId: number;
    userPubkey: string;
  }; // The order it matched with
}

export function useMatchedOrders() {
  const { publicKey, connected } = useWallet();
  const { executeMatchedOrders, isReady, loading: programLoading } = useSpaceProgram();
  const [matchedOrders, setMatchedOrders] = useState<MatchedOrder[]>([]);
  const [loading, setLoading] = useState(false);
  const [executing, setExecuting] = useState<Set<string>>(new Set());
  const [error, setError] = useState<string | null>(null);
  
  // Use refs to access current values without causing effect re-runs
  const loadingRef = useRef(loading);
  const executingRef = useRef(executing);
  const isReadyRef = useRef(isReady);
  
  // Keep refs in sync with state
  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);
  
  useEffect(() => {
    executingRef.current = executing;
  }, [executing]);
  
  useEffect(() => {
    isReadyRef.current = isReady;
  }, [isReady]);

  // Fetch matched orders that need on-chain execution
  const fetchMatchedOrders = useCallback(async () => {
    if (!connected || !publicKey) {
      setMatchedOrders([]);
      return;
    }

    try {
      const url = `${API_URL}/api/v1/orders/user/${publicKey.toString()}/pending-execution`;
      const response = await axios.get(url);
      setMatchedOrders(response.data.orders || []);
    } catch (err: any) {
      // Only log non-404 errors to avoid console spam
      if (err.response?.status !== 404) {
        console.error('Error fetching matched orders:', err.message);
      }
      // Don't set error for polling failures - will retry
      setMatchedOrders([]);
    }
  }, [connected, publicKey]);

  // Execute a matched order pair on-chain
  // This is called automatically when orders are matched
  // The keeper (this user) executes the matched orders
  const executeMatchedOrder = useCallback(async (order: MatchedOrder) => {
    if (!connected || !publicKey || !isReady) {
      // Silently fail if wallet not connected - will retry later
      return;
    }

    if (executing.has(order.id)) {
      return; // Already executing
    }

    if (!order.matchedWith) {
      console.warn('Order missing matchedWith information:', order.id);
      return;
    }

    setExecuting(prev => new Set(prev).add(order.id));
    setError(null);

    try {
      const matchQuantity = BigInt(order.filled);
      
      if (matchQuantity <= 0) {
        throw new Error('No quantity to execute');
      }

      // Determine which order is buy and which is sell
      const buyOrderInfo = order.side === 'buy' 
        ? { orderId: order.orderId, userPubkey: new PublicKey(order.userPubkey) }
        : { orderId: order.matchedWith.orderId, userPubkey: new PublicKey(order.matchedWith.userPubkey) };
      
      const sellOrderInfo = order.side === 'sell'
        ? { orderId: order.orderId, userPubkey: new PublicKey(order.userPubkey) }
        : { orderId: order.matchedWith.orderId, userPubkey: new PublicKey(order.matchedWith.userPubkey) };

      // Derive order PDAs
      const [buyOrderPDA] = getPendingOrderPDA(buyOrderInfo.userPubkey, buyOrderInfo.orderId);
      const [sellOrderPDA] = getPendingOrderPDA(sellOrderInfo.userPubkey, sellOrderInfo.orderId);

      console.log('[MatchedOrders] Executing on-chain:', {
        buyOrderId: buyOrderInfo.orderId,
        sellOrderId: sellOrderInfo.orderId,
        matchPrice: order.price,
        matchQuantity: matchQuantity.toString(),
      });

      // Execute matched orders on-chain
      // This requires the keeper (this user) to sign
      const result = await executeMatchedOrders({
        market: order.marketId,
        buyOrder: buyOrderPDA,
        sellOrder: sellOrderPDA,
        buyOrderId: buyOrderInfo.orderId,
        sellOrderId: sellOrderInfo.orderId,
        matchPrice: order.price,
        matchQuantity: Number(matchQuantity),
      });

      console.log('[MatchedOrders] Execution successful:', result.transaction);

      // Mark order as executed in backend
      try {
        await axios.post(
          `${API_URL}/api/v1/orders/${order.id}/mark-executed`,
          {
            executedAmount: Number(matchQuantity),
          },
          {
            headers: {
              'X-Pubkey': publicKey.toString(),
            },
          }
        );
      } catch (markError) {
        console.warn('Failed to mark order as executed:', markError);
        // Continue anyway - the on-chain execution succeeded
      }

      // Refresh matched orders
      await fetchMatchedOrders();

      return result;
    } catch (err: any) {
      console.error('Error executing matched order:', err);
      setError(err.message || 'Failed to execute matched order');
      throw err;
    } finally {
      setExecuting(prev => {
        const next = new Set(prev);
        next.delete(order.id);
        return next;
      });
    }
  }, [connected, publicKey, isReady, executeMatchedOrders, executing, fetchMatchedOrders]);

  // Use WebSocket for order_match events instead of polling
  const { isConnected, subscribe, unsubscribe, onMessage } = useWebSocket();
  const matchedOrdersRef = useRef(matchedOrders);
  const fetchMatchedOrdersRef = useRef(fetchMatchedOrders);
  const executeMatchedOrderRef = useRef(executeMatchedOrder);

  // Keep refs updated
  useEffect(() => {
    matchedOrdersRef.current = matchedOrders;
    fetchMatchedOrdersRef.current = fetchMatchedOrders;
    executeMatchedOrderRef.current = executeMatchedOrder;
  }, [matchedOrders, fetchMatchedOrders, executeMatchedOrder]);

  useEffect(() => {
    if (!connected || !publicKey || !isConnected) {
      return;
    }

    const userId = publicKey.toString();

    // Subscribe to order matches for this user
    subscribe('order_matches', { userId });

    // Handle order match events
    const cleanup = onMessage('order_match', async (data: {
      market_id: string;
      outcome_id: number;
      buyOrderId: string;
      sellOrderId: string;
      price: number;
      size: number;
      user_id?: string;
    }) => {
      // Check if this match involves the user's orders using ref
      const currentOrders = matchedOrdersRef.current;
      const userOrderIds = currentOrders.map(o => o.id);
      if (userOrderIds.includes(data.buyOrderId) || userOrderIds.includes(data.sellOrderId)) {
        // Refresh matched orders when user's order is matched
        await fetchMatchedOrdersRef.current();
        
        // Auto-execute if ready - use already fetched orders instead of making another API call
        const currentOrders = matchedOrdersRef.current;
        if (currentOrders.length > 0 && isReadyRef.current && !loadingRef.current && executingRef.current.size === 0) {
          // Find the matched order in current list
          const matchedOrder = currentOrders.find(o => o.id === data.buyOrderId || o.id === data.sellOrderId);
          if (matchedOrder && !executingRef.current.has(matchedOrder.id)) {
            try {
              await new Promise(resolve => setTimeout(resolve, 1000));
              await executeMatchedOrderRef.current(matchedOrder);
            } catch (err: any) {
              console.error(`Failed to auto-execute order ${matchedOrder.id}:`, err);
            }
          }
        }
      }
    });

    return () => {
      unsubscribe('order_matches', { userId });
      cleanup();
    };
  }, [connected, publicKey?.toString(), isConnected]); // Removed all function dependencies

  // Initial fetch on mount
  useEffect(() => {
    if (connected && publicKey) {
      fetchMatchedOrders();
    }
  }, [connected, publicKey, fetchMatchedOrders]);

  // Execute all matched orders
  const executeAllMatchedOrders = useCallback(async () => {
    if (!matchedOrders.length) {
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const results = [];
      for (const order of matchedOrders) {
        try {
          const result = await executeMatchedOrder(order);
          results.push({ orderId: order.id, success: true, result });
        } catch (err: any) {
          console.error(`Failed to execute order ${order.id}:`, err);
          results.push({ orderId: order.id, success: false, error: err.message });
        }
      }

      return results;
    } catch (err: any) {
      setError(err.message || 'Failed to execute some orders');
      throw err;
    } finally {
      setLoading(false);
    }
  }, [matchedOrders, executeMatchedOrder]);

  return {
    matchedOrders,
    loading,
    executing,
    error,
    executeMatchedOrder,
    executeAllMatchedOrders,
    refresh: fetchMatchedOrders,
  };
}

