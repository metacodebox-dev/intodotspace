/**
 * Backfill Positions Script
 * 
 * This script fetches all existing positions from on-chain and syncs them to the database.
 * Run this once to populate the positions table with existing positions.
 * 
 * Usage: 
 *   cd backend
 *   ts-node src/scripts/backfillPositions.ts
 * 
 * Or with npm:
 *   npm run backfill:positions
 */

// Load environment variables FIRST
import dotenv from 'dotenv';
dotenv.config();

import { Connection, PublicKey } from '@solana/web3.js';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import { loadIDL } from '../utils/idl-loader';
import { getPositionPDA, SPACE_CORE_PROGRAM_ID } from '../utils/solana';
import { Market } from '../models/Market';
import { PositionService } from '../services/positionService';
import { sequelize } from '../config/database';

async function backfillPositions() {
  console.log('[Backfill] Starting position backfill...');
  
  try {
    // Initialize connection and program
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
    
    // Initialize position service
    const positionService = new PositionService();
    
    // Get all active markets
    const markets = await Market.findAll({
      where: { status: 0 }, // Active markets only
    });
    
    console.log(`[Backfill] Found ${markets.length} active markets`);
    
    // Get all unique users from orders (users who have placed orders)
    // This gives us a list of users who might have positions
    const { Order } = await import('../models/Order');
    const usersWithOrders = await Order.findAll({
      attributes: ['userId'],
      group: ['userId'],
      raw: true,
    });
    
    const uniqueUsers = [...new Set(usersWithOrders.map((o: any) => o.userId))];
    console.log(`[Backfill] Found ${uniqueUsers.length} unique users with orders`);
    
    let totalPositionsSynced = 0;
    let totalPositionsSkipped = 0;
    
    // For each market, check all possible position combinations
    for (const market of markets) {
      console.log(`[Backfill] Processing market: ${market.title} (${market.marketAddress})`);

      // Skip event-stream / externally-sourced markets whose `marketAddress`
      // is a synthetic ID (e.g. "jup_evt_POLY-…") and not a base58 PDA.
      let marketPDA: PublicKey;
      try {
        marketPDA = new PublicKey(market.marketAddress);
      } catch {
        console.log(`[Backfill] Skipping non-Solana market: ${market.marketAddress}`);
        continue;
      }
      
      // Parse outcomes
      let outcomes: any[] = [];
      if (typeof market.outcomes === 'string') {
        try {
          outcomes = JSON.parse(market.outcomes);
        } catch {
          outcomes = [];
        }
      } else if (Array.isArray(market.outcomes)) {
        outcomes = market.outcomes;
      }
      
      // Build all position PDAs for batch fetching (much faster)
      const positionPDAs: Array<{
        pda: PublicKey;
        userId: string;
        outcomeId: number;
        side: number;
        positionType: number;
        tokenType: number; // 0 = YES, 1 = NO (part of PDA seed)
      }> = [];

      for (const userId of uniqueUsers) {
        try {
          const userPubkey = new PublicKey(userId);

          // Build list of all possible position PDAs (both YES and NO token types)
          for (let outcomeId = 0; outcomeId < outcomes.length; outcomeId++) {
            for (let side = 0; side <= 1; side++) {
              for (let positionType = 0; positionType <= 1; positionType++) {
                for (let tokenType = 0; tokenType <= 1; tokenType++) {
                  const [positionPDA] = getPositionPDA(marketPDA, userPubkey, outcomeId, side, positionType, tokenType);
                  positionPDAs.push({
                    pda: positionPDA,
                    userId,
                    outcomeId,
                    side,
                    positionType,
                    tokenType,
                  });
                }
              }
            }
          }
        } catch (error: any) {
          console.warn(`[Backfill] Error building PDAs for user ${userId}: ${error.message}`);
          continue;
        }
      }
      
      // Batch fetch all position accounts (much faster than sequential)
      const batchSize = 100;
      for (let i = 0; i < positionPDAs.length; i += batchSize) {
        const batch = positionPDAs.slice(i, i + batchSize);
        const pdas = batch.map(b => b.pda);
        
        try {
          const accounts = await connection.getMultipleAccountsInfo(pdas);
          
          for (let j = 0; j < accounts.length; j++) {
            const accountInfo = accounts[j];
            if (accountInfo) {
              try {
                const positionAccount = (program.coder.accounts as any).decode('position', accountInfo.data);
                
                if (positionAccount && positionAccount.shares > 0) {
                  const metadata = batch[j];
                  const shares = new BN(positionAccount.shares.toString());
                  const collateral = new BN(positionAccount.collateral.toString());
                  const borrowedAmount = new BN((positionAccount as any).borrowedAmount?.toString() || '0');
                  const avgEntryPrice = Number(positionAccount.avgEntryPrice);
                  const leverage = Number(positionAccount.leverage);
                  const positionTypeValue = Number((positionAccount as any).positionType ?? metadata.positionType);
                  const liquidationPrice = (positionAccount as any).liquidationPrice 
                    ? Number((positionAccount as any).liquidationPrice) 
                    : undefined;
                  const isOpen = (positionAccount as any).isOpen ?? true;
                  
                  // Sync to database — use the same ID scheme as the live keeper
                  // (`${PDA}:${tokenType}`) so backfill and keeper converge on a
                  // single row per position instead of creating duplicates.
                  const tokenTypeStr = metadata.tokenType === 1 ? 'no' : 'yes';
                  await positionService.upsertPosition({
                    id: `${metadata.pda.toString()}:${tokenTypeStr}`,
                    marketAddress: market.marketAddress,
                    marketId: market.marketId || market.id.toString(),
                    user: metadata.userId,
                    outcomeId: metadata.outcomeId,
                    side: metadata.side,
                    positionType: positionTypeValue,
                    shares: shares.toString(),
                    avgEntryPrice,
                    leverage,
                    collateral: collateral.toString(),
                    borrowedAmount: borrowedAmount.toString(),
                    liquidationPrice,
                    isOpen,
                    tokenType: tokenTypeStr,
                  } as any);
                  
                  totalPositionsSynced++;
                  console.log(`[Backfill] Synced position: ${metadata.pda.toString()} (User: ${metadata.userId.slice(0, 8)}..., Market: ${market.title}, Outcome: ${metadata.outcomeId}, Side: ${metadata.side === 0 ? 'Long' : 'Short'}, Type: ${positionTypeValue === 0 ? 'Spot' : 'Leveraged'})`);
                } else {
                  totalPositionsSkipped++;
                }
              } catch (decodeError) {
                // Invalid account - skip
                totalPositionsSkipped++;
                continue;
              }
            } else {
              totalPositionsSkipped++;
            }
          }
        } catch (batchError: any) {
          console.error(`[Backfill] Error fetching batch ${i}-${i + batchSize}: ${batchError.message}`);
          continue;
        }
      }
    }
    
    console.log(`[Backfill] Complete!`);
    console.log(`[Backfill] Positions synced: ${totalPositionsSynced}`);
    console.log(`[Backfill] Positions skipped (empty): ${totalPositionsSkipped}`);
    
  } catch (error) {
    console.error('[Backfill] Fatal error:', error);
    process.exit(1);
  } finally {
    await sequelize.close();
    process.exit(0);
  }
}

// Run the backfill
backfillPositions();

