import { useEffect, useRef } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useSpaceProgram } from './useSpaceProgram';
import { useMatchedOrders } from './useMatchedOrders';

/**
 * Hook that automatically executes matched orders in the background
 * This runs silently without user interaction once wallet is connected
 * Users already approved margin locking when placing orders, so execution is safe
 */
export function useAutoExecuteOrders() {
  const { connected, publicKey } = useWallet();
  const { isReady } = useSpaceProgram();
  const { matchedOrders, executeMatchedOrder, executing } = useMatchedOrders();
  const executedOrdersRef = useRef<Set<string>>(new Set());
  const executionQueueRef = useRef<Array<{ orderId: string; timestamp: number }>>([]);
  
  // Use refs to access current values without causing effect re-runs
  const matchedOrdersRef = useRef(matchedOrders);
  const executingRef = useRef(executing);
  const executeMatchedOrderRef = useRef(executeMatchedOrder);
  const isReadyRef = useRef(isReady);
  
  // Keep refs in sync with state
  useEffect(() => {
    matchedOrdersRef.current = matchedOrders;
  }, [matchedOrders]);
  
  useEffect(() => {
    executingRef.current = executing;
  }, [executing]);
  
  useEffect(() => {
    executeMatchedOrderRef.current = executeMatchedOrder;
  }, [executeMatchedOrder]);
  
  useEffect(() => {
    isReadyRef.current = isReady;
  }, [isReady]);

  useEffect(() => {
    if (!connected || !publicKey || !isReadyRef.current || matchedOrdersRef.current.length === 0) {
      return;
    }

    // Process execution queue
    const processQueue = async () => {
      // Filter out already executed orders
      const pendingOrders = matchedOrdersRef.current.filter(
        (order) => !executedOrdersRef.current.has(order.id) && !executingRef.current.has(order.id)
      );

      if (pendingOrders.length === 0) {
        return;
      }

      console.log(`[AutoExecute] Executing ${pendingOrders.length} matched order(s)`);

      for (const order of pendingOrders) {
        if (executionQueueRef.current.some((q) => q.orderId === order.id)) {
          continue;
        }

        executionQueueRef.current.push({
          orderId: order.id,
          timestamp: Date.now(),
        });

        executeMatchedOrderRef.current(order)
          .then(() => {
            executedOrdersRef.current.add(order.id);
            executionQueueRef.current = executionQueueRef.current.filter(
              (q) => q.orderId !== order.id
            );
            console.log(`[AutoExecute] Order ${order.id} executed`);
          })
          .catch((error) => {
            console.error(`[AutoExecute] Failed to execute order ${order.id}:`, error);
            // Remove from queue on error (will retry on next poll)
            executionQueueRef.current = executionQueueRef.current.filter(
              (q) => q.orderId !== order.id
            );
          });
      }
    };

    // Process immediately
    processQueue();

    // Set up interval to process queue (reduced frequency to avoid log spam)
    const interval = setInterval(processQueue, 10000); // Check every 10 seconds

    return () => clearInterval(interval);
  }, [connected, publicKey]); // Only restart if connection or publicKey changes

  // Clean up executed orders list periodically (keep last 100)
  useEffect(() => {
    const cleanup = setInterval(() => {
      if (executedOrdersRef.current.size > 100) {
        executedOrdersRef.current.clear();
      }
    }, 60000); // Every minute

    return () => clearInterval(cleanup);
  }, []);
}


