import { sequelize } from '../config/database';
import { Position } from '../models/Position';
import { Market as MarketModel } from '../models/Market';
import { Connection, PublicKey } from '@solana/web3.js';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import { loadIDL } from '../utils/idl-loader';
import { getPositionPDA } from '../utils/solana';
import { OrderBookService } from '../services/orderBookService';
import dotenv from 'dotenv';

dotenv.config();

/**
 * Calculate realized PnL for a closed position
 * @param shares - Shares that were closed (in lamports)
 * @param entryPrice - Average entry price in basis points
 * @param exitPrice - Exit price in basis points (current market price or last traded price)
 * @param side - 0 for Long, 1 for Short
 * @returns Realized PnL in USDC
 */
function calculateRealizedPnL(
  shares: bigint,
  entryPrice: number,
  exitPrice: number,
  side: number
): number {
  if (shares === 0n) return 0;
  
  const sharesNum = Number(shares);
  const entryValue = (sharesNum * entryPrice) / (10000 * 1e6);
  const exitValue = (sharesNum * exitPrice) / (10000 * 1e6);
  
  if (side === 0) {
    // Long position: PnL = exit_value - entry_value
    return exitValue - entryValue;
  } else {
    // Short position: PnL = entry_value - exit_value
    return entryValue - exitValue;
  }
}

/**
 * Script to cleanup closed positions (mark positions with 0 shares as closed)
 * Usage: 
 *   npm run ts-node src/scripts/cleanupClosedPositions.ts [userPubkey]
 *   If userPubkey is provided, only cleanup positions for that user
 *   If not provided, cleanup all positions with 0 shares
 */
async function cleanupClosedPositions(userPubkey?: string) {
  try {
    console.log(`[CleanupPositions] Connecting to database...`);
    await sequelize.authenticate();
    console.log(`[CleanupPositions] Database connection established`);

    const whereClause: any = {
      isOpen: true, // Only check positions marked as open
    };

    if (userPubkey) {
      whereClause.user = userPubkey;
      console.log(`[CleanupPositions] Cleaning up positions for user: ${userPubkey}`);
    } else {
      console.log(`[CleanupPositions] Cleaning up all closed positions`);
    }

    // Find all positions marked as open
    const openPositions = await Position.findAll({
      where: whereClause,
    });

    console.log(`[CleanupPositions] Found ${openPositions.length} positions marked as open`);

    const positionsToClose: string[] = [];
    const positionsToKeep: string[] = [];
    const positionsToVerify: typeof openPositions = [];

    // Initialize OrderBookService for getting current prices
    const orderBookService = new OrderBookService();
    
    // First pass: Check database shares
    for (const position of openPositions) {
      const sharesNum = BigInt(position.shares);
      if (sharesNum === 0n) {
        positionsToClose.push(position.id);
        
        // Calculate realized PnL for positions with 0 shares if not already set
        if (!position.realizedPnl) {
          try {
            const market = await MarketModel.findOne({
              where: { marketAddress: position.marketAddress },
            });
            
            if (market) {
              const orderBook = await orderBookService.getOrderBook(
                market.marketId || market.id.toString(),
                position.outcomeId
              );
              
              const exitPrice = orderBook.lastPrice || 
                (orderBook.bids.length > 0 && orderBook.asks.length > 0
                  ? Math.floor((orderBook.bids[0].price + orderBook.asks[0].price) / 2)
                  : position.avgEntryPrice);
              
              // For positions with 0 shares, we need to estimate based on entry value
              // Since shares are 0, we can't calculate directly, but we can estimate
              // based on the collateral that was returned
              // For now, we'll use a simplified approach: calculate based on entry price vs exit price
              // This is an approximation - ideally we'd track the exact shares closed
              const estimatedShares = BigInt(position.collateral); // Rough estimate
              if (estimatedShares > 0n) {
                const pnl = calculateRealizedPnL(
                  estimatedShares,
                  position.avgEntryPrice,
                  exitPrice,
                  position.side
                );
                await Position.update(
                  { realizedPnl: pnl.toFixed(6) },
                  { where: { id: position.id } }
                );
              }
            }
          } catch (error: any) {
            console.warn(`[CleanupPositions] Could not calculate realized PnL for position ${position.id}:`, error.message);
          }
        }
      } else {
        // Need to verify on-chain - database might be stale
        positionsToVerify.push(position);
      }
    }

    console.log(`[CleanupPositions] Positions with 0 shares in DB: ${positionsToClose.length}`);
    console.log(`[CleanupPositions] Positions to verify on-chain: ${positionsToVerify.length}`);

    // Verify positions on-chain if program is available
    if (positionsToVerify.length > 0) {
      try {
        console.log(`[CleanupPositions] Initializing program for on-chain verification...`);
        const connection = new Connection(
          process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
          {
            commitment: 'confirmed',
            wsEndpoint: process.env.SOLANA_WS_URL,
            confirmTransactionInitialTimeout: 60000,
          }
        );
        const idl = await loadIDL();
        const provider = new AnchorProvider(
          connection,
          {} as any,
          { commitment: 'confirmed' }
        );
        const program = new Program(idl, provider);

        console.log(`[CleanupPositions] Verifying ${positionsToVerify.length} positions on-chain...`);
        
        for (const position of positionsToVerify) {
          try {
            // Derive the position PDA based on the position's side and type from the database
            // This ensures we're checking the correct account on-chain
            const userPubkey = new PublicKey(position.user);
            const marketPDA = new PublicKey(position.marketAddress);
            const outcomeId = position.outcomeId;
            const side = position.side ?? 1; // Default to 1 (Short) if not set
            const positionType = position.positionType ?? 0; // Default to 0 (Spot) if not set

            // Derive the correct PDA (token_type from DB record: 'yes'=0, 'no'=1)
            const tokenType = (position as any).tokenType === 'no' ? 1 : 0;
            const [positionPDA] = getPositionPDA(
              marketPDA,
              userPubkey,
              outcomeId,
              side,
              positionType,
              tokenType,
            );

            // Position DB IDs may have :yes/:no suffix (e.g., "PDA_ADDRESS:yes")
            // Strip suffix for on-chain PDA comparison
            const positionIdBase = position.id.replace(/:(?:yes|no)$/, '');

            console.log(`[CleanupPositions] Checking position: ${position.id} (DB) vs ${positionPDA.toString()} (on-chain), side=${side}, type=${positionType}, tokenType=${position.tokenType || 'yes'}`);
            
            // First check if account exists
            const accountInfo = await connection.getAccountInfo(positionPDA);
            
            if (!accountInfo || accountInfo.lamports === 0) {
              // Position account doesn't exist on-chain - mark as closed
              console.log(`[CleanupPositions] Position ${position.id} (PDA: ${positionPDA.toString()}) doesn't exist on-chain - marking as closed`);
              positionsToClose.push(position.id);
              
              // Calculate realized PnL if not already set
              let realizedPnl = position.realizedPnl;
              if (!realizedPnl) {
                try {
                  // Get market to find marketId
                  const market = await MarketModel.findOne({
                    where: { marketAddress: position.marketAddress },
                  });
                  
                  if (market) {
                    // Get current price from orderbook
                    const orderBook = await orderBookService.getOrderBook(
                      market.marketId || market.id.toString(),
                      position.outcomeId
                    );
                    
                    // Use last traded price or mid price (average of best bid/ask)
                    const exitPrice = orderBook.lastPrice || 
                      (orderBook.bids.length > 0 && orderBook.asks.length > 0
                        ? Math.floor((orderBook.bids[0].price + orderBook.asks[0].price) / 2)
                        : position.avgEntryPrice); // Fallback to entry price if no market data
                    
                    // Calculate realized PnL using the shares that were in the position before closing
                    // We'll use the shares from the database (which should be the amount that was closed)
                    const closedShares = BigInt(position.shares || '0');
                    if (closedShares > 0n) {
                      const pnl = calculateRealizedPnL(
                        closedShares,
                        position.avgEntryPrice,
                        exitPrice,
                        position.side
                      );
                      realizedPnl = pnl.toFixed(6);
                    }
                  }
                } catch (error: any) {
                  console.warn(`[CleanupPositions] Could not calculate realized PnL for position ${position.id}:`, error.message);
                }
              }
              
              // Update shares to 0 and store realized PnL
              await Position.update(
                { shares: '0', isOpen: false, realizedPnl },
                { where: { id: position.id } }
              );
            } else {
              // Account exists, try to fetch and decode it
              const positionAccount = await (program.account as any).position.fetch(positionPDA).catch(() => null);

              if (!positionAccount) {
                // Account exists but decode failed - keep position (don't close on decode errors)
                console.warn(`[CleanupPositions] Position ${position.id} (PDA: ${positionPDA.toString()}) account exists but decode failed - keeping position`);
                positionsToKeep.push(position.id);
              } else {
                const onChainShares = new BN(positionAccount.shares.toString());
                if (onChainShares.lte(new BN(0))) {
                  // Position has 0 shares on-chain - mark as closed
                  console.log(`[CleanupPositions] Position ${position.id} (PDA: ${positionPDA.toString()}) has 0 shares on-chain - marking as closed`);
                  positionsToClose.push(position.id);
                  
                  // Calculate realized PnL if not already set
                  let realizedPnl = position.realizedPnl;
                  if (!realizedPnl) {
                    try {
                      const market = await MarketModel.findOne({
                        where: { marketAddress: position.marketAddress },
                      });
                      
                      if (market) {
                        const orderBook = await orderBookService.getOrderBook(
                          market.marketId || market.id.toString(),
                          position.outcomeId
                        );
                        
                        const exitPrice = orderBook.lastPrice || 
                          (orderBook.bids.length > 0 && orderBook.asks.length > 0
                            ? Math.floor((orderBook.bids[0].price + orderBook.asks[0].price) / 2)
                            : position.avgEntryPrice);
                        
                        // Use the shares from database (amount that was closed)
                        const closedShares = BigInt(position.shares || '0');
                        if (closedShares > 0n) {
                          const pnl = calculateRealizedPnL(
                            closedShares,
                            position.avgEntryPrice,
                            exitPrice,
                            position.side
                          );
                          realizedPnl = pnl.toFixed(6);
                        }
                      }
                    } catch (error: any) {
                      console.warn(`[CleanupPositions] Could not calculate realized PnL for position ${position.id}:`, error.message);
                    }
                  }
                  
                  await Position.update(
                    { shares: '0', isOpen: false, realizedPnl },
                    { where: { id: position.id } }
                  );
                } else {
                  // Position has shares on-chain — keep it open.
                  // DO NOT overwrite DB shares with on-chain values!
                  // On-chain position accounts accumulate all buys but never
                  // subtract sells (match_orders doesn't update the seller's
                  // original position account). The DB is the source of truth
                  // for share counts, managed by the keeper (buy adds, sell subtracts).

                  // Warn if PDA doesn't match (but don't update ID as it might be a primary key)
                  if (positionIdBase !== positionPDA.toString()) {
                    console.warn(`[CleanupPositions] WARNING: Position ID mismatch for ${position.id}: DB base is ${positionIdBase}, but on-chain PDA is ${positionPDA.toString()}. Side=${side}, Type=${positionType}`);
                  }

                  positionsToKeep.push(position.id);
                }
              }
            }
          } catch (error: any) {
            console.warn(`[CleanupPositions] Could not verify position ${position.id} on-chain:`, error.message);
            // If verification fails, keep the position (don't close it)
            positionsToKeep.push(position.id);
          }
        }
      } catch (error: any) {
        console.error(`[CleanupPositions] Failed to initialize program for verification:`, error.message);
        console.log(`[CleanupPositions] Falling back to database-only check`);
        // Fallback: just use database values
        for (const position of positionsToVerify) {
          positionsToKeep.push(position.id);
        }
      }
    }

    console.log(`[CleanupPositions] Total positions to close: ${positionsToClose.length}`);
    console.log(`[CleanupPositions] Total positions to keep: ${positionsToKeep.length}`);

    if (positionsToClose.length > 0) {
      // Batch update positions with 0 shares to mark them as closed
      const [updatedCount] = await Position.update(
        { isOpen: false },
        { where: { id: positionsToClose } }
      );

      console.log(`[CleanupPositions] Successfully marked ${updatedCount} positions as closed`);
      
      // Show some examples
      if (positionsToClose.length > 0) {
        const samplePositions = await Position.findAll({
          where: { id: positionsToClose.slice(0, 5) },
        });
        console.log(`[CleanupPositions] Sample closed positions:`);
        for (const pos of samplePositions) {
          console.log(`  - ${pos.id}: shares=${pos.shares}, user=${pos.user}, market=${pos.marketAddress}`);
        }
      }
    } else {
      console.log(`[CleanupPositions] No positions need to be closed`);
    }
    
  } catch (error) {
    console.error(`[CleanupPositions] Error cleaning up positions:`, error);
    throw error;
  }
  // NOTE: Do NOT close sequelize here — this function is called from the API route
  // which shares the global DB connection pool. Closing it would break all queries.
}

// Get command line arguments
const args = process.argv.slice(2);
const userPubkey = args[0] || undefined;

if (require.main === module) {
  cleanupClosedPositions(userPubkey)
    .then(async () => {
      console.log(`[CleanupPositions] Done`);
      await sequelize.close();
      process.exit(0);
    })
    .catch(async (error) => {
      console.error(`[CleanupPositions] Failed:`, error);
      await sequelize.close();
      process.exit(1);
    });
}

export { cleanupClosedPositions };

