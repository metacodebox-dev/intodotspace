import { OrderBookService } from './orderBookService';
import { OrderKeeperService } from './orderKeeperService';
import { wsEventEmitter } from '../websocket/server';
import { notificationService } from './notificationService';
import { Market } from '../models/Market';

/**
 * Service to periodically match orders in the order book
 * This ensures orders are matched even if matching wasn't triggered immediately
 */
export class OrderMatchingService {
  private orderBookService: OrderBookService;
  private keeperService: OrderKeeperService;
  private matchingInterval: NodeJS.Timeout | null = null;

  constructor() {
    this.orderBookService = new OrderBookService();
    this.keeperService = new OrderKeeperService();
    
    // Initialize keeper service (non-blocking, optional)
    this.keeperService.initialize().then((success) => {
      // Logs disabled - check keeper service logs for execution details
    }).catch((err) => {
      // Logs disabled - check keeper service logs for execution details
    });
  }

  /**
   * Start periodic order matching for all markets
   */
  startPeriodicMatching(intervalMs: number = 5000) {
    if (this.matchingInterval) {
      clearInterval(this.matchingInterval);
    }

    this.matchingInterval = setInterval(async () => {
      try {
        await this.matchAllMarkets();
      } catch (error) {
        // Logs disabled - check keeper service logs for execution details
      }
    }, intervalMs);

    // Logs disabled - check keeper service logs for execution details
  }

  /**
   * Stop periodic order matching
   */
  stopPeriodicMatching() {
    if (this.matchingInterval) {
      clearInterval(this.matchingInterval);
      this.matchingInterval = null;
      // Logs disabled - check keeper service logs for execution details
    }
  }

  /**
   * Match orders for all active markets
   * Scans all active markets and their outcomes for matchable order pairs
   */
  private async matchAllMarkets() {
    try {
      // Fetch all active markets (status 0 = Active)
      const markets = await Market.findAll({
        where: { status: 0 },
        attributes: ['marketId', 'outcomes', 'title'],
      });

      if (markets.length === 0) return;

      for (const market of markets) {
        try {
          // Parse outcomes to get the number of outcomes
          let outcomeCount = 2; // default binary
          try {
            const outcomes = JSON.parse(market.outcomes);
            if (Array.isArray(outcomes)) {
              outcomeCount = outcomes.length;
            }
          } catch {
            // If outcomes can't be parsed, assume binary (2 outcomes)
          }

          // Match orders for each outcome
          for (let outcomeId = 0; outcomeId < outcomeCount; outcomeId++) {
            try {
              await this.matchMarketOrders(market.marketId, outcomeId);
            } catch (err: any) {
              // Log but continue to next outcome
              if (!err.message?.includes('already') && !err.message?.includes('filled')) {
                console.warn(`[OrderMatchingService] Error matching market ${market.marketId} outcome ${outcomeId}: ${err.message}`);
              }
            }
          }
        } catch (marketErr: any) {
          console.warn(`[OrderMatchingService] Error processing market ${market.marketId}: ${marketErr.message}`);
        }
      }
    } catch (error: any) {
      console.error(`[OrderMatchingService] Error in matchAllMarkets: ${error.message}`);
    }
  }

  /**
   * Manually trigger order matching for a specific market/outcome
   */
  async matchMarketOrders(marketId: string, outcomeId: number) {
    try {
      // Logs disabled - check keeper service logs for execution details
      
      const matches = await this.orderBookService.matchOrders(marketId, outcomeId);
      if (matches.length > 0) {
        // Emit WebSocket events for each match
        for (const match of matches) {
          wsEventEmitter.emit('order_match', {
            marketId,
            outcomeId,
            buyOrderId: match.buyOrder.id.toString(),
            sellOrderId: match.sellOrder.id.toString(),
            price: match.price,
            size: match.size,
            timestamp: new Date().toISOString(),
          });
        }

        // Execute matches on-chain via keeper service
        // IMPORTANT: Only execute if keeper is initialized
        if (!this.keeperService.isInitialized()) {
          // Keeper not initialized - matches found but cannot execute on-chain
          // Return matches so they can be executed manually
          return matches;
        }

        for (let i = 0; i < matches.length; i++) {
          const match = matches[i];
          try {
            // Refresh order status from database before execution to avoid race conditions
            const { Order } = await import('../models/Order');
            const freshBuyOrder = await Order.findOne({ where: { id: match.buyOrder.id } });
            const freshSellOrder = await Order.findOne({ where: { id: match.sellOrder.id } });
            
            if (!freshBuyOrder || !freshSellOrder) {
              console.log(`[OrderMatchingService] Order not found in database, skipping match`);
              continue;
            }
            
            // Check if orders are already filled
            if (freshBuyOrder.status === 'filled' || freshSellOrder.status === 'filled') {
              console.log(`[OrderMatchingService] Orders already filled, skipping match`);
              console.log(`  Buy Order: ${freshBuyOrder.id} (status: ${freshBuyOrder.status})`);
              console.log(`  Sell Order: ${freshSellOrder.id} (status: ${freshSellOrder.status})`);
              continue;
            }
            
            // CRITICAL: Check on-chain order status before attempting execution
            // This prevents duplicate execution for partially filled orders
            // Database might not be updated yet, but on-chain state is authoritative
            let actualMatchSize: bigint | undefined;
            let shouldSkip = false;
            
            try {
              const { Connection, PublicKey } = await import('@solana/web3.js');
              const connection = new Connection(
                process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
                {
                  commitment: 'confirmed',
                  wsEndpoint: process.env.SOLANA_WS_URL,
                  confirmTransactionInitialTimeout: 60000,
                }
              );
              
              // Get on-chain order addresses
              const buyOrderOnChain = (freshBuyOrder as any).onChainOrder || (freshBuyOrder as any).on_chain_order;
              const sellOrderOnChain = (freshSellOrder as any).onChainOrder || (freshSellOrder as any).on_chain_order;
              
              if (buyOrderOnChain && sellOrderOnChain) {
                const { Program } = await import('@coral-xyz/anchor');
                const { loadIDL } = await import('../utils/idl-loader');
                const idl = await loadIDL();
                const { AnchorProvider } = await import('@coral-xyz/anchor');
                const { Keypair } = await import('@solana/web3.js');
                
                // Create a minimal provider just for reading (no wallet needed)
                const dummyKeypair = Keypair.generate();
                const provider = new AnchorProvider(connection, { publicKey: dummyKeypair.publicKey } as any, {});
                const program = new Program(idl as any, provider);
                
                try {
                  const buyOrderOnChainData: any = await (program.account as any).pendingOrder.fetch(new PublicKey(buyOrderOnChain));
                  const sellOrderOnChainData: any = await (program.account as any).pendingOrder.fetch(new PublicKey(sellOrderOnChain));
                  
                  const FILLED_STATUS = 2;
                  
                  // Check if orders are already fully filled on-chain
                  if (buyOrderOnChainData.status === FILLED_STATUS || sellOrderOnChainData.status === FILLED_STATUS) {
                    console.log(`[OrderMatchingService] Orders already filled on-chain, syncing DB and skipping match`);
                    console.log(`  Buy Order Status: ${buyOrderOnChainData.status}, Sell Order Status: ${sellOrderOnChainData.status}`);
                    // Sync DB status so these orders stop being re-matched
                    try {
                      const { Order } = await import('../models/Order');
                      if (buyOrderOnChainData.status === FILLED_STATUS && (freshBuyOrder.status as string) !== 'filled') {
                        await Order.update({ status: 'filled' as any, filled: freshBuyOrder.size }, { where: { id: freshBuyOrder.id } });
                        console.log(`[OrderMatchingService] Synced buy order ${freshBuyOrder.id} to filled`);
                      }
                      if (sellOrderOnChainData.status === FILLED_STATUS && (freshSellOrder.status as string) !== 'filled') {
                        await Order.update({ status: 'filled' as any, filled: freshSellOrder.size }, { where: { id: freshSellOrder.id } });
                        console.log(`[OrderMatchingService] Synced sell order ${freshSellOrder.id} to filled`);
                      }
                    } catch (syncErr: any) {
                      console.warn(`[OrderMatchingService] Failed to sync order status: ${syncErr.message}`);
                    }
                    shouldSkip = true;
                  } else {
                    // Check remaining quantity on-chain (more accurate than database)
                    const buyRemainingOnChain = buyOrderOnChainData.quantity.toNumber() - buyOrderOnChainData.filledQuantity.toNumber();
                    const sellRemainingOnChain = sellOrderOnChainData.quantity.toNumber() - sellOrderOnChainData.filledQuantity.toNumber();
                    
                    if (buyRemainingOnChain <= 0 || sellRemainingOnChain <= 0) {
                      console.log(`[OrderMatchingService] No remaining quantity on-chain, skipping match`);
                      console.log(`  Buy Remaining: ${buyRemainingOnChain}, Sell Remaining: ${sellRemainingOnChain}`);
                      shouldSkip = true;
                    } else {
                      // Use on-chain remaining quantities (more accurate)
                      actualMatchSize = BigInt(Math.min(buyRemainingOnChain, sellRemainingOnChain));
                      console.log(`[OrderMatchingService] On-chain check passed - Buy remaining: ${buyRemainingOnChain}, Sell remaining: ${sellRemainingOnChain}, Match size: ${actualMatchSize}`);
                    }
                  }
                } catch (onChainError: any) {
                  // If we can't read on-chain status, fall back to database-based matching
                  console.warn(`[OrderMatchingService] Could not read on-chain order status, using database: ${onChainError.message}`);
                  // Will fall through to database-based calculation
                }
              }
            } catch (checkError: any) {
              // If on-chain check fails, fall back to database-based matching
              console.warn(`[OrderMatchingService] On-chain check failed, using database: ${checkError.message}`);
            }
            
            // Skip if on-chain check determined we should skip
            if (shouldSkip) {
              continue;
            }
            
            // Fallback: Use database remaining quantities if on-chain check failed or wasn't available
            if (!actualMatchSize) {
              const buyRemaining = freshBuyOrder.getSizeBigInt() - freshBuyOrder.getFilledBigInt();
              const sellRemaining = freshSellOrder.getSizeBigInt() - freshSellOrder.getFilledBigInt();
              if (buyRemaining <= 0 || sellRemaining <= 0) {
                console.log(`[OrderMatchingService] No remaining quantity, skipping match`);
                console.log(`  Buy Remaining: ${buyRemaining.toString()}, Sell Remaining: ${sellRemaining.toString()}`);
                continue;
              }
              actualMatchSize = buyRemaining < sellRemaining ? buyRemaining : sellRemaining;
            }
            
            // Execute on-chain - keeper will update DB after successful execution
            const result = await this.keeperService.executeMatch(
              freshBuyOrder,
              freshSellOrder,
              match.price,
              actualMatchSize
            );
            
            // Emit trade event after successful execution
            if (result.success) {
              wsEventEmitter.emit('trade', {
                marketId,
                outcomeId,
                side: 'buy', // Buyer side
                price: match.price,
                size: Number(actualMatchSize),
                timestamp: new Date().toISOString(),
              });

              // Only send notifications once per match execution
              // Check if we've already sent notifications for this match
              const matchKey = `${freshBuyOrder.id}-${freshSellOrder.id}-${actualMatchSize}`;
              const notificationSentKey = `notification_sent:${matchKey}`;
              
              // Use a simple in-memory cache to prevent duplicate notifications within the same execution
              // This prevents the same match from triggering multiple notifications
              if (!(global as any).__notificationCache) {
                (global as any).__notificationCache = new Set<string>();
              }
              
              const notificationCache = (global as any).__notificationCache as Set<string>;
              
              if (!notificationCache.has(notificationSentKey)) {
                notificationCache.add(notificationSentKey);
                
                // Clean up old entries (keep cache size manageable)
                if (notificationCache.size > 1000) {
                  const entries = Array.from(notificationCache);
                  entries.slice(0, 500).forEach(key => notificationCache.delete(key));
                }
                
                // Fetch market title for notifications (non-blocking)
                // Ensure we always get the market name for notifications
                // Try multiple lookup strategies to find the market
                const marketPromise = (async () => {
                  try {
                    // First try: exact marketId match (as string)
                    let market = await Market.findOne({ 
                      where: { 
                        marketId: marketId.toString()
                      } 
                    });
                    
                    if (market) {
                      console.log(`[OrderMatchingService] ✓ Found market: "${market.title}" for marketId: ${marketId}`);
                      return market;
                    }
                    
                    // Second try: marketId as number (in case it's stored differently)
                    const marketIdNum = parseInt(marketId);
                    if (!isNaN(marketIdNum)) {
                      market = await Market.findOne({ 
                        where: { 
                          marketId: marketIdNum.toString()
                        } 
                      });
                      
                      if (market) {
                        console.log(`[OrderMatchingService] ✓ Found market: "${market.title}" for marketId (as number): ${marketId}`);
                        return market;
                      }
                    }
                    
                    // Third try: Try to find by marketAddress if we can derive it
                    // Some markets might be stored with marketAddress as the identifier
                    // Check if marketId looks like a Solana address (base58, 32-44 chars)
                    if (marketId.length >= 32 && marketId.length <= 44) {
                      market = await Market.findOne({ 
                        where: { 
                          marketAddress: marketId
                        } 
                      });
                      
                      if (market) {
                        console.log(`[OrderMatchingService] ✓ Found market: "${market.title}" by marketAddress: ${marketId}`);
                        return market;
                      }
                    }
                    
                    // Log all markets to debug (only in development)
                    if (process.env.NODE_ENV === 'development') {
                      const allMarkets = await Market.findAll({ limit: 5, attributes: ['id', 'marketId', 'marketAddress', 'title'] });
                      console.log(`[OrderMatchingService] Sample markets in DB:`, allMarkets.map(m => ({
                        id: m.id,
                        marketId: m.marketId,
                        marketAddress: m.marketAddress?.slice(0, 8),
                        title: m.title
                      })));
                    }
                    
                    console.warn(`[OrderMatchingService] ✗ Market not found for marketId: ${marketId} (tried string, number, and address lookup)`);
                    return null;
                  } catch (err) {
                    console.error(`[OrderMatchingService] Error fetching market ${marketId}:`, err);
                    return null;
                  }
                })();
                
                // Send notifications to both parties (non-blocking)
                Promise.all([
                  marketPromise.then((market) => {
                    // Notify buyer - always include market name (with fallback)
                    const marketTitle = market?.title || `Market ${marketId.slice(0, 8)}...`;
                    return notificationService.notifyTradeBuy({
                      userId: freshBuyOrder.userId,
                      marketId,
                      outcomeId,
                      price: match.price,
                      size: Number(actualMatchSize),
                      orderId: freshBuyOrder.id,
                      marketTitle,
                      tokenType: (freshBuyOrder as any).tokenType || undefined,
                    });
                  }).catch((err) => {
                    console.warn('[OrderMatchingService] Failed to send buy notification:', err);
                    // Still send notification with fallback market name
                    const marketTitle = `Market ${marketId.slice(0, 8)}...`;
                    notificationService.notifyTradeBuy({
                      userId: freshBuyOrder.userId,
                      marketId,
                      outcomeId,
                      price: match.price,
                      size: Number(actualMatchSize),
                      orderId: freshBuyOrder.id,
                      marketTitle,
                      tokenType: (freshBuyOrder as any).tokenType || undefined,
                    }).catch((notifErr) => {
                      console.error('[OrderMatchingService] Failed to send buy notification with fallback:', notifErr);
                    });
                  }),
                  marketPromise.then((market) => {
                    // Notify seller - always include market name (with fallback)
                    console.log(`[OrderMatchingService] Sending sell notification to user ${freshSellOrder.userId} for order ${freshSellOrder.id}`);
                    const marketTitle = market?.title || `Market ${marketId.slice(0, 8)}...`;
                    return notificationService.notifyTradeSell({
                      userId: freshSellOrder.userId,
                      marketId,
                      outcomeId,
                      price: match.price,
                      size: Number(actualMatchSize),
                      orderId: freshSellOrder.id,
                      marketTitle,
                      tokenType: (freshSellOrder as any).tokenType || undefined,
                    }).then((notification) => {
                      console.log(`[OrderMatchingService] Sell notification created successfully:`, {
                        id: notification.id,
                        type: notification.type,
                        userId: freshSellOrder.userId,
                        marketTitle: notification.data?.marketTitle
                      });
                      return notification;
                    });
                  }).catch((err) => {
                    console.error('[OrderMatchingService] Failed to send sell notification:', err);
                    // Still send notification with fallback market name
                    const marketTitle = `Market ${marketId.slice(0, 8)}...`;
                    notificationService.notifyTradeSell({
                      userId: freshSellOrder.userId,
                      marketId,
                      outcomeId,
                      price: match.price,
                      size: Number(actualMatchSize),
                      orderId: freshSellOrder.id,
                      marketTitle,
                      tokenType: (freshSellOrder as any).tokenType || undefined,
                    }).catch((notifErr) => {
                      console.error('[OrderMatchingService] Failed to send sell notification with fallback:', notifErr);
                    });
                  }),
                ]).then(() => {
                  // Remove from cache after 30 seconds to allow re-notification if needed
                  setTimeout(() => {
                    notificationCache.delete(notificationSentKey);
                  }, 30000);
                });
              } else {
                console.log(`[OrderMatchingService] Notification already sent for match: ${matchKey}, skipping`);
              }
            } else {
              // Log the error but continue to next match
              // Some errors are expected (e.g., order already filled on-chain)
              if (result.error && !result.error.includes('already') && !result.error.includes('filled')) {
                console.warn(`[OrderMatchingService] Match execution failed: ${result.error}`);
              }
            }
            
            // Continue to next match even if this one failed
            // This allows other matches to proceed
          } catch (execError: any) {
            // Log error but continue to next match
            // Some errors are expected (e.g., race conditions with concurrent matches)
            const errorMsg = execError?.message || execError?.toString() || 'Unknown error';
            if (!errorMsg.includes('InvalidOrder') && !errorMsg.includes('already') && !errorMsg.includes('filled')) {
              console.warn(`[OrderMatchingService] Match execution error: ${errorMsg}`);
            }
            // Continue to next match instead of breaking
          }
        }
      }
      return matches;
    } catch (error: any) {
      // Logs disabled - check keeper service logs for execution details
      throw error;
    }
  }

  /**
   * Start keeper service for automatic execution
   * This will only start if the keeper service is properly initialized
   */
  startKeeper(intervalMs: number = 10000) {
    if (!this.keeperService.isInitialized()) {
      // Logs disabled - check keeper service logs for execution details
      return;
    }
    
    this.keeperService.startAutoExecution(intervalMs);
  }

  /**
   * Stop keeper service
   */
  stopKeeper() {
    this.keeperService.stopAutoExecution();
  }
}

