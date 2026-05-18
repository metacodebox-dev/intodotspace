import { Connection, PublicKey } from '@solana/web3.js';
import { Program, AnchorProvider, BN } from '@coral-xyz/anchor';
import { Position, Market } from '../models';
import { OrderBookService } from './orderBookService';
import { loadIDL } from '../utils/idl-loader';
import { getPositionPDA, getOldPositionPDA, SPACE_CORE_PROGRAM_ID } from '../utils/solana';

const LOG_LEVEL = process.env.POSITION_DEBUG ? 'debug' : 'error';
const log = {
  info: (...args: any[]) => { if (LOG_LEVEL === 'debug') console.log(...args); },
  warn: (...args: any[]) => { if (LOG_LEVEL === 'debug') console.warn(...args); },
  error: (...args: any[]) => console.error(...args),
};

export interface PositionData {
  id: string; // PDA address
  market: string; // Market PDA
  marketId: string; // Market ID from DB
  marketTitle?: string;
  user: string;
  outcomeId: number;
  side: number; // 0 = Long, 1 = Short
  shares: string; // BigInt as string
  avgEntryPrice: number; // Basis points
  leverage: number;
  collateral: string; // BigInt as string, in quote base units
  borrowedAmount: string; // BigInt as string, in quote base units
  positionType: number; // 0 = Spot, 1 = Leveraged
  tokenType?: string; // 'yes' or 'no'
  liquidationPrice?: number;
  isOpen: boolean;
  currentPrice?: number;
  positionValue?: string; // in quote base units
  pnl?: string; // in quote base units
  pnlPercent?: number;
  equity?: string; // in quote base units
  isLiquidatable?: boolean;
  // Quote token metadata so cross-market portfolio views can render the
  // correct symbol and decimals per row (USDC vs SPACE, etc.).
  quoteMint?: string;
  quoteDecimals?: number;
  quoteSymbol?: string;
}

export class PositionService {
  private orderBookService: OrderBookService;
  private connection: Connection;
  private program: Program<any> | null = null;

  constructor() {
    this.orderBookService = new OrderBookService();
    this.connection = new Connection(
      process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
      {
        commitment: 'confirmed',
        wsEndpoint: process.env.SOLANA_WS_URL,
        confirmTransactionInitialTimeout: 60000,
      }
    );
    this.initializeProgram();
  }

  private async initializeProgram() {
    try {
      const idl = await loadIDL();
      const provider = new AnchorProvider(
        this.connection,
        {} as any,
        { commitment: 'confirmed' }
      );
      this.program = new Program(idl, provider);
    } catch (error) {
      log.error('[PositionService] Failed to initialize program:', error);
    }
  }

  /**
   * Fetch all positions for a user from database (MUCH FASTER - no on-chain calls)
   * Falls back to on-chain if database is empty (for backward compatibility)
   * This scales to millions of users since it's just a database query
   */
  async getPositions(user: string): Promise<PositionData[]> {
    try {
      log.info(`[PositionService] Fetching positions for user: ${user}`);
      
      // Fetch positions from database (indexed by user, very fast)
      // Note: We're not using the association include because it might not be initialized
      // Instead, we'll fetch markets separately if needed
      // Filter by isOpen AND shares > 0 to ensure we only get active positions
      const dbPositions = await Position.findAll({
        where: {
          user,
          isOpen: true, // Only fetch open positions
        },
        // Removed include for now - fetch markets separately to avoid association issues
      });
      
      // Filter out positions with zero shares and verify suspicious ones on-chain
      const activePositions: typeof dbPositions = [];
      const positionsToClose: string[] = [];

      const verificationPromises = dbPositions.map(async (p) => {
        const sharesNum = BigInt(p.shares);

        if (sharesNum === 0n) {
          positionsToClose.push(p.id);
          return null;
        }

        // Verify suspicious positions on-chain (non-round shares)
        if (this.program && (sharesNum < 1000000n || sharesNum % 1000000n !== 0n)) {
          try {
            // Strip :yes/:no suffix from DB ID to get the raw PDA address
            const positionPDA = new PublicKey(p.id.replace(/:(?:yes|no)$/, ''));

            // First do a cheap account existence check
            const accountInfo = await this.connection.getAccountInfo(positionPDA).catch(() => undefined);

            // RPC failed entirely — keep DB value, never close on network errors
            if (accountInfo === undefined) {
              log.warn(`[PositionService] RPC error checking position ${p.id} - keeping DB value`);
              return p;
            }

            // Account truly doesn't exist on-chain
            if (accountInfo === null || accountInfo.lamports === 0) {
              positionsToClose.push(p.id);
              return null;
            }

            // Account exists — decode it
            const positionAccount = await (this.program.account as any).position.fetch(positionPDA).catch(() => null);

            if (!positionAccount) {
              // Decode failed but account exists — keep DB value
              return p;
            }

            const onChainShares = new BN(positionAccount.shares.toString());
            if (onChainShares.lte(new BN(0))) {
              positionsToClose.push(p.id);
              await Position.update(
                { shares: '0', isOpen: false },
                { where: { id: p.id } }
              );
              return null;
            }

            // DO NOT overwrite DB shares with on-chain values.
            // On-chain accumulates all buys but never subtracts sells,
            // so on-chain shares are wrong after a sell. DB is the
            // source of truth — managed by the keeper (buy adds, sell subtracts).
          } catch (error) {
            // Any other failure — keep DB value
            log.warn(`[PositionService] Could not verify position ${p.id} on-chain:`, error);
          }
        }

        return p;
      });

      const verified = await Promise.all(verificationPromises);
      activePositions.push(...verified.filter((p): p is typeof dbPositions[0] => p !== null));

      if (positionsToClose.length > 0) {
        await Position.update(
          { isOpen: false },
          { where: { id: positionsToClose } }
        );
      }

      if (activePositions.length > 0) {
        log.info(`[PositionService] Raw positions from DB:`, activePositions.map(p => ({
          id: p.id,
          marketAddress: p.marketAddress,
          leverage: p.leverage,
          positionType: p.positionType,
          shares: p.shares,
          outcomeId: p.outcomeId,
          side: p.side,
        })));
      } else {
        log.info(`[PositionService] No active positions found in database for user ${user}`);
        // Let's also check if there are any positions at all (for debugging)
        const allPositions = await Position.findAll({ where: { user }, limit: 5 });
        log.info(`[PositionService] Total positions in DB for user (sample):`, allPositions.length);
        if (allPositions.length > 0) {
          log.info(`[PositionService] Sample position:`, {
            id: allPositions[0].id,
            user: allPositions[0].user,
            marketAddress: allPositions[0].marketAddress,
            shares: allPositions[0].shares,
            isOpen: allPositions[0].isOpen,
          });
        }
      }

      log.info(`[PositionService] Found ${activePositions.length} active positions (after filtering zero shares) in database for user ${user}`);
      
      // Use database only - positions are synced when orders execute
      const processed = await this.processDbPositions(activePositions);
      log.info(`[PositionService] Processed ${processed.length} positions`);
      return processed;
    } catch (error) {
      log.error('[PositionService] Error fetching positions:', error);
      log.error('[PositionService] Error details:', error instanceof Error ? error.stack : error);
      return [];
    }
  }

  /**
   * Process database positions into API format
   */
  private async processDbPositions(
    dbPositions: any[],
    priceMap?: Map<string, number | null>
  ): Promise<PositionData[]> {
    const getPriceKey = (marketAddress: string, outcomeId: number, tokenType: string) => `${marketAddress}:${outcomeId}:${tokenType}`;

    // Build price map if not provided
    if (!priceMap) {
      const pricePromises = new Map<string, Promise<number | null>>();
      for (const pos of dbPositions) {
        const posTokenType = pos.tokenType || 'yes';
        const priceKey = getPriceKey(pos.marketAddress, pos.outcomeId, posTokenType);
        if (!pricePromises.has(priceKey)) {
          pricePromises.set(
            priceKey,
            this.orderBookService.getMarketPrice(pos.marketAddress, pos.outcomeId, posTokenType).catch(() => null)
          );
        }
      }
      const priceResults = await Promise.all(
        Array.from(pricePromises.entries()).map(async ([key, promise]) => {
          const price = await promise;
          return [key, price] as [string, number | null];
        })
      );
      priceMap = new Map(priceResults);
    }

    const positions: PositionData[] = [];

    for (const pos of dbPositions) {
      try {
        // Try to get market from association first, then fallback to direct lookup
        let market = (pos as any).market;
        if (!market) {
          log.info(`[PositionService] Market not in association, looking up directly for position ${pos.id}, marketAddress: ${pos.marketAddress}`);
          market = await Market.findOne({ where: { marketAddress: pos.marketAddress } });
        }
        if (!market) {
          log.warn(`[PositionService] Market not found for position ${pos.id}, marketAddress: ${pos.marketAddress}`);
          continue;
        }
        log.info(`[PositionService] Found market for position ${pos.id}: ${market.title || market.id}`);

      const shares = BigInt(pos.shares);
      const collateral = BigInt(pos.collateral);
      const borrowedAmount = BigInt(pos.borrowedAmount);
      const avgEntryPrice = pos.avgEntryPrice;
      const leverage = pos.leverage;
      const side = pos.side;

      // Get cached price — use the correct YES or NO orderbook price
      const posTokenType = pos.tokenType || 'yes';
      const priceKey = getPriceKey(pos.marketAddress, pos.outcomeId, posTokenType);
      const currentPrice = priceMap!.get(priceKey) || avgEntryPrice;

      // Calculate position value at current price. Shares are always 6
      // decimals; `/ 1e6` here converts them to human shares (which equals
      // human quote value at 1:1 redemption, regardless of quote decimals).
      const positionValue = (Number(shares) * currentPrice) / (10000 * 1e6);
      const entryValue = (Number(shares) * avgEntryPrice) / (10000 * 1e6);

      // Calculate PnL (human quote units)
      let pnl: number;
      if (side === 0) {
        pnl = positionValue - entryValue;
      } else {
        pnl = entryValue - positionValue;
      }

      // Calculate equity — collateral is in quote base units, so use the
      // market's real quote_decimals (6 USDC, 9 SPACE) to convert to human.
      const quoteDecimals = (market as any).quoteDecimals ?? 6;
      const equity = Number(collateral) / Math.pow(10, quoteDecimals) + pnl;

      // Calculate liquidation price (only for leveraged positions)
      // Derived from: Equity = Maintenance at liquidation point
      // Long: collateral + (P_liq - P_entry) * shares / 10000 = 0.10 * P_liq * shares / 10000
      //   => P_liq = (P_entry * shares - collateral * 10000) / (0.90 * shares)
      // Short: collateral + (P_entry - P_liq) * shares / 10000 = 0.10 * P_liq * shares / 10000
      //   => P_liq = (P_entry * shares + collateral * 10000) / (1.10 * shares)
      let calculatedLiquidationPrice: number | undefined;
      const sharesNum = Number(shares);
      // Normalize collateral to share-base-unit equivalence so the formula
      // (which expects shares and collateral in the same scale) holds for
      // markets whose quote_decimals > 6 (e.g. SPACE at 9 dec, quote_scale=1000).
      const quoteScale = Math.pow(10, Math.max(0, quoteDecimals - 6));
      const collateralNum = Number(collateral) / quoteScale;

      if (pos.positionType === 1 && sharesNum > 0) { // Only for leveraged
        if (side === 0) {
          // Long: liquidation when price drops
          const liquidationPriceBps = (avgEntryPrice * sharesNum - collateralNum * 10000) / (0.90 * sharesNum);
          calculatedLiquidationPrice = Math.max(0, Math.min(10000, Math.floor(liquidationPriceBps)));
        } else {
          // Short: liquidation when price rises
          const liquidationPriceBps = (avgEntryPrice * sharesNum + collateralNum * 10000) / (1.10 * sharesNum);
          calculatedLiquidationPrice = Math.max(0, Math.min(10000, Math.ceil(liquidationPriceBps)));
        }
      }

      // Check if liquidatable
      const positionValueForLiquidation = (Number(shares) * currentPrice) / (10000 * 1e6);
      const maintenanceRequirement = positionValueForLiquidation * 0.10;
      const isLiquidatable = equity < maintenanceRequirement;

      // Always use calculated value - on-chain value may have integer precision issues
      const finalLiquidationPrice = pos.positionType === 0 ? undefined : calculatedLiquidationPrice;

      positions.push({
        id: pos.id,
        market: pos.marketAddress,
        marketId: pos.marketId || market.id?.toString() || '',
        marketTitle: market.title,
        user: pos.user,
        outcomeId: pos.outcomeId,
        side: pos.side,
        shares: pos.shares,
        avgEntryPrice: pos.avgEntryPrice,
        leverage: pos.leverage,
        collateral: pos.collateral,
        borrowedAmount: pos.borrowedAmount,
        positionType: pos.positionType,
        tokenType: pos.tokenType || 'yes',
        liquidationPrice: finalLiquidationPrice,
        isOpen: pos.isOpen,
        currentPrice,
        positionValue: positionValue.toFixed(6),
        pnl: pnl.toFixed(6),
        pnlPercent: entryValue > 0 ? (pnl / entryValue) * 100 : 0,
        equity: equity.toFixed(6),
        isLiquidatable,
        quoteMint: market.quoteMint,
        quoteDecimals: market.quoteDecimals ?? 6,
        quoteSymbol: market.quoteSymbol ?? 'USDC',
      });
      } catch (posError: any) {
        log.error(`[PositionService] Error processing position ${pos.id}:`, posError);
        continue;
      }
    }

    log.info(`[PositionService] Successfully processed ${positions.length} positions`);
    return positions;
  }

  /**
   * Fallback: Fetch positions from on-chain (for backward compatibility)
   * This is slower but works when database is empty
   */
  private async fetchPositionsFromChain(user: string): Promise<PositionData[]> {
    if (!this.program) {
      await this.initializeProgram();
      if (!this.program) {
        log.error('[PositionService] Program not initialized for on-chain fetch');
        return [];
      }
    }

    try {
      const userPubkey = new PublicKey(user);
      const positions: PositionData[] = [];

      // Get all markets from database
      const markets = await Market.findAll({
        where: { status: 0 }, // Active markets only
      });

      // Build all position PDAs upfront for batch fetching
      const positionPDAs: Array<{
        pda: PublicKey;
        market: typeof markets[0];
        outcomeId: number;
        side: number;
        positionType: number;
        tokenType: number;
      }> = [];

      for (const market of markets) {
        const marketPDA = new PublicKey(market.marketAddress);
        
        // Parse outcomes to get count
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

        // Build list of all possible position PDAs (new + old formats, both YES and NO token types)
        for (let outcomeId = 0; outcomeId < outcomes.length; outcomeId++) {
          for (let side = 0; side <= 1; side++) {
            for (let positionType = 0; positionType <= 1; positionType++) {
              // New PDA format (with token_type)
              for (let tokenType = 0; tokenType <= 1; tokenType++) {
                const [positionPDA] = getPositionPDA(marketPDA, userPubkey, outcomeId, side, positionType, tokenType);
                positionPDAs.push({
                  pda: positionPDA,
                  market,
                  outcomeId,
                  side,
                  positionType,
                  tokenType,
                });
              }
              // Old PDA format (without token_type) — backward compat
              const [oldPositionPDA] = getOldPositionPDA(marketPDA, userPubkey, outcomeId, side, positionType);
              positionPDAs.push({
                pda: oldPositionPDA,
                market,
                outcomeId,
                side,
                positionType,
                tokenType: 0, // Old positions default to YES
              });
            }
          }
        }
      }

      // Batch fetch all position accounts
      const batchSize = 100;
      const positionAccounts: Array<{ account: any; metadata: typeof positionPDAs[0] }> = [];

      for (let i = 0; i < positionPDAs.length; i += batchSize) {
        const batch = positionPDAs.slice(i, i + batchSize);
        const pdas = batch.map(b => b.pda);
        
        try {
          const accounts = await this.connection.getMultipleAccountsInfo(pdas);
          
          for (let j = 0; j < accounts.length; j++) {
            const accountInfo = accounts[j];
            if (accountInfo) {
              try {
                const account = (this.program!.coder.accounts as any).decode('position', accountInfo.data);
                if (account && account.shares > 0) {
                  positionAccounts.push({
                    account,
                    metadata: batch[j],
                  });
                }
              } catch (decodeError) {
                continue;
              }
            }
          }
        } catch (batchError) {
          log.error(`[PositionService] Error fetching batch ${i}-${i + batchSize}:`, batchError);
          continue;
        }
      }

      // Process positions and sync to DB for next time
      for (const { account: positionAccount, metadata } of positionAccounts) {
        const { market, outcomeId, side, positionType, tokenType } = metadata;
        
        const shares = new BN(positionAccount.shares.toString());
        const collateral = new BN(positionAccount.collateral.toString());
        const borrowedAmount = new BN((positionAccount as any).borrowedAmount?.toString() || '0');
        const avgEntryPrice = Number(positionAccount.avgEntryPrice);
        const leverage = Number(positionAccount.leverage);
        const positionTypeValue = Number((positionAccount as any).positionType ?? positionType);
        const accountLiquidationPrice = (positionAccount as any).liquidationPrice 
          ? Number((positionAccount as any).liquidationPrice) 
          : undefined;
        const isOpen = (positionAccount as any).isOpen ?? true;

        // Sync to database for next time
        const [positionPDA] = getPositionPDA(new PublicKey(market.marketAddress), userPubkey, outcomeId, side, positionType, tokenType);
        try {
          await this.upsertPosition({
            id: positionPDA.toString(),
            marketAddress: market.marketAddress,
            marketId: market.marketId || market.id.toString(),
            user,
            outcomeId,
            side,
            positionType: positionTypeValue,
            shares: shares.toString(),
            avgEntryPrice,
            leverage,
            collateral: collateral.toString(),
            borrowedAmount: borrowedAmount.toString(),
            liquidationPrice: accountLiquidationPrice,
            isOpen,
            tokenType: tokenType === 1 ? 'no' : 'yes',
          });
        } catch (syncError) {
          log.warn(`[PositionService] Failed to sync position to DB:`, syncError);
        }

        // Get current price
        const posTokenType = tokenType === 1 ? 'no' : 'yes';
        const currentPrice = await this.orderBookService.getMarketPrice(
          market.marketAddress,
          outcomeId,
          posTokenType
        ).catch(() => avgEntryPrice) || avgEntryPrice;

        // Calculate values (same as processDbPositions)
        const positionValue = (Number(shares) * currentPrice) / (10000 * 1e6);
        const entryValue = (Number(shares) * avgEntryPrice) / (10000 * 1e6);
        let pnl: number;
        if (side === 0) {
          pnl = positionValue - entryValue;
        } else {
          pnl = entryValue - positionValue;
        }
        // Collateral is in quote base units — divide by market's quote decimals.
        const quoteDecimals = (market as any).quoteDecimals ?? 6;
        const equity = Number(collateral) / Math.pow(10, quoteDecimals) + pnl;

        positions.push({
          id: positionPDA.toString(),
          market: market.marketAddress,
          marketId: market.marketId || market.id.toString(),
          marketTitle: market.title,
          user,
          outcomeId,
          side,
          shares: shares.toString(),
          avgEntryPrice,
          leverage,
          collateral: collateral.toString(),
          borrowedAmount: borrowedAmount.toString(),
          positionType: positionTypeValue,
          liquidationPrice: accountLiquidationPrice,
          isOpen,
          currentPrice,
          positionValue: positionValue.toFixed(6),
          pnl: pnl.toFixed(6),
          pnlPercent: entryValue > 0 ? (pnl / entryValue) * 100 : 0,
          equity: equity.toFixed(6),
          isLiquidatable: false, // Calculate if needed
          quoteMint: market.quoteMint,
          quoteDecimals: market.quoteDecimals ?? 6,
          quoteSymbol: market.quoteSymbol ?? 'USDC',
        });
      }

      return positions;
    } catch (error) {
      log.error('[PositionService] Error fetching positions from chain:', error);
      return [];
    }
  }

  /**
   * Fetch positions on FINALIZED markets, regardless of `isOpen`.
   * Used for the "Resolved" portfolio tab so users can see their win/loss
   * history even after they've claimed (which sets isOpen=false, shares=0).
   * Markets table is the filter (status === 3 = Finalized), not Position.
   */
  async getResolvedPositions(user: string): Promise<PositionData[]> {
    try {
      // Find markets that are finalized — used to scope position lookup.
      const finalizedMarkets = await Market.findAll({
        where: { status: 3 },
        attributes: ['marketAddress'],
      });
      if (finalizedMarkets.length === 0) return [];

      const finalizedAddresses = finalizedMarkets.map((m) => (m as any).marketAddress);

      // Pull every position the user has on any finalized market — open or
      // closed, with shares or zeroed-out. Cost basis (avgEntryPrice) is
      // preserved on close so we can still compute pnl post-claim.
      const dbPositions = await Position.findAll({
        where: {
          user,
          marketAddress: finalizedAddresses,
        },
      });

      if (dbPositions.length === 0) return [];

      // No live orderbook prices needed — these markets are resolved, so
      // payout is determined by outcome match, not current price.
      return await this.processDbPositions(dbPositions, new Map());
    } catch (error) {
      log.error('[PositionService] Error fetching resolved positions:', error);
      return [];
    }
  }

  async getPositionById(positionId: string): Promise<PositionData | null> {
    const pos = await Position.findByPk(positionId);
    if (!pos) return null;
    
    // Convert to PositionData format (similar to getPositions)
    const market = await Market.findOne({ where: { marketAddress: pos.marketAddress } });
    if (!market) return null;
    
    // Similar conversion logic as getPositions...
    return null; // TODO: Implement full conversion
  }

  /**
   * Sync position from on-chain to database
   * Called after orders execute to keep database in sync
   */
  async syncPosition(
    positionPDA: string,
    marketAddress: string,
    marketId: string,
    user: string,
    outcomeId: number,
    side: number,
    positionType: number
  ): Promise<void> {
    try {
      // Fetch position from on-chain (we need the program for this)
      // For now, we'll update this when we have the position data from the keeper
      // This will be called with the actual position data after execution
    } catch (error) {
      log.error('[PositionService] Error syncing position:', error);
    }
  }

  /**
   * Sync position from on-chain to database by checking on-chain state
   */
  async syncPositionFromChain(
    positionPDA: string,
    marketAddress: string,
    user: string,
    outcomeId: number,
    side: number,
    positionType: number
  ): Promise<void> {
    try {
      if (!this.program) {
        throw new Error('Program not initialized');
      }

      const positionPubkey = new PublicKey(positionPDA);
      
      // Check if position account exists
      const accountInfo = await this.program.provider.connection.getAccountInfo(positionPubkey);
      
      const { Position } = await import('../models/Position');
      const MarketModule = await import('../models/Market');
      const MarketModel = MarketModule.Market;
      
      // Helper function to calculate and store realized PnL
      const calculateAndStoreRealizedPnL = async (position: any) => {
        if (position.realizedPnl) return; // Already calculated
        
        try {
          const market = await MarketModel.findOne({
            where: { marketAddress: position.marketAddress },
          });
          
          if (market) {
            const orderBook = await this.orderBookService.getOrderBook(
              market.marketId || market.id.toString(),
              position.outcomeId
            );
            
            const exitPrice = orderBook.lastPrice || 
              (orderBook.bids.length > 0 && orderBook.asks.length > 0
                ? Math.floor((orderBook.bids[0].price + orderBook.asks[0].price) / 2)
                : position.avgEntryPrice);
            
            const closedShares = BigInt(position.shares || '0');
            if (closedShares > 0n) {
              const entryValue = (Number(closedShares) * position.avgEntryPrice) / (10000 * 1e6);
              const exitValue = (Number(closedShares) * exitPrice) / (10000 * 1e6);
              
              let pnl: number;
              if (position.side === 0) {
                pnl = exitValue - entryValue;
              } else {
                pnl = entryValue - exitValue;
              }
              
              return pnl.toFixed(6);
            }
          }
        } catch (error: any) {
          log.warn(`[PositionService] Could not calculate realized PnL for position ${positionPDA}:`, error.message);
        }
        return null;
      };
      
      if (!accountInfo || accountInfo.lamports === 0) {
        // Position doesn't exist - mark as closed in DB
        // Check both raw PDA and suffixed IDs
        for (const suffix of ['', ':yes', ':no']) {
          const dbId = `${positionPDA}${suffix}`;
          const existingPosition = await Position.findByPk(dbId);
          if (existingPosition) {
            const realizedPnl = await calculateAndStoreRealizedPnL(existingPosition);
            await Position.update(
              { isOpen: false, shares: '0', realizedPnl },
              { where: { id: dbId } }
            );
          }
        }
        log.info(`[PositionService] Position ${positionPDA} doesn't exist on-chain - marked as closed`);
        return;
      }

      // Fetch position account
      const positionAccount = await (this.program.account as any).position.fetch(positionPubkey).catch(() => null);

      if (!positionAccount) {
        // Can't fetch - mark as closed (check all suffixes)
        for (const suffix of ['', ':yes', ':no']) {
          const dbId = `${positionPDA}${suffix}`;
          const existingPosition = await Position.findByPk(dbId);
          if (existingPosition) {
            const realizedPnl = await calculateAndStoreRealizedPnL(existingPosition);
            await Position.update(
              { isOpen: false, shares: '0', realizedPnl },
              { where: { id: dbId } }
            );
          }
        }
        log.info(`[PositionService] Position ${positionPDA} can't be fetched - marked as closed`);
        return;
      }

      // Sync position data from on-chain
      // IMPORTANT: For binary markets, YES and NO positions share the same on-chain PDA
      // (same outcome_id=0, side, positionType). The on-chain account has COMBINED shares.
      // We must NOT overwrite individual :yes/:no DB rows with combined on-chain shares.
      // Only update DB rows that already exist with :yes/:no suffix.
      // If no suffixed rows exist, create one (for backward compat / new positions).

      const onChainShares = new BN(positionAccount.shares.toString());
      const collateral = new BN(positionAccount.collateral.toString());
      const borrowedAmount = new BN((positionAccount as any).borrowedAmount?.toString() || '0');
      const onChainAvgEntryPrice = Number(positionAccount.avgEntryPrice);
      const leverage = Number(positionAccount.leverage);
      const liquidationPrice = (positionAccount as any).liquidationPrice
        ? Number((positionAccount as any).liquidationPrice)
        : undefined;
      const isOpen = onChainShares.gt(new BN(0)) && ((positionAccount as any).isOpen ?? true);

      // Check for existing suffixed rows (:yes and :no)
      const yesRow = await Position.findByPk(`${positionPDA}:yes`);
      const noRow = await Position.findByPk(`${positionPDA}:no`);

      if (yesRow || noRow) {
        // Suffixed rows exist — update isOpen/collateral/leverage but DO NOT overwrite shares
        // (keeper tracks shares accurately per token type; on-chain has combined total)
        for (const row of [yesRow, noRow]) {
          if (!row) continue;
          const rowShares = BigInt(row.shares);
          const rowIsOpen = isOpen && rowShares > 0n;
          await Position.update(
            {
              collateral: collateral.toString(),
              leverage,
              liquidationPrice,
              isOpen: rowIsOpen,
              borrowedAmount: borrowedAmount.toString(),
            },
            { where: { id: row.id } }
          );
        }
        log.info(`[PositionService] Synced position ${positionPDA} metadata from on-chain (preserved per-token shares)`);
      } else {
        // No suffixed rows — check for unsuffixed row or create new
        const existingPos = await Position.findByPk(positionPDA);
        const avgEntryPrice = existingPos?.avgEntryPrice && existingPos.avgEntryPrice > 0
          ? existingPos.avgEntryPrice
          : onChainAvgEntryPrice;

        const market = await Market.findOne({ where: { marketAddress } });
        const marketId = market?.marketId || market?.id?.toString() || marketAddress;

        // Create with :yes suffix by default (single-token position)
        await this.upsertPosition({
          id: `${positionPDA}:yes`,
          marketAddress,
          marketId,
          user,
          outcomeId,
          side,
          positionType,
          shares: onChainShares.toString(),
          avgEntryPrice,
          leverage,
          collateral: collateral.toString(),
          borrowedAmount: borrowedAmount.toString(),
          liquidationPrice,
          isOpen,
          tokenType: 'yes',
        });
        log.info(`[PositionService] Created position ${positionPDA}:yes from on-chain`);
      }
    } catch (error) {
      log.error('[PositionService] Error syncing position from chain:', error);
      throw error;
    }
  }

  /**
   * Upsert position in database (called after order execution)
   */
  async upsertPosition(positionData: {
    id: string; // PDA
    marketAddress: string;
    marketId: string;
    user: string;
    outcomeId: number;
    side: number;
    positionType: number;
    shares: string;
    avgEntryPrice: number;
    leverage: number;
    collateral: string;
    borrowedAmount: string;
    liquidationPrice?: number;
    isOpen: boolean;
    tokenType?: string; // 'yes' or 'no'
  }): Promise<void> {
    try {
      await Position.upsert({
        id: positionData.id,
        marketAddress: positionData.marketAddress,
        marketId: positionData.marketId,
        user: positionData.user,
        outcomeId: positionData.outcomeId,
        side: positionData.side,
        positionType: positionData.positionType,
        shares: positionData.shares,
        avgEntryPrice: positionData.avgEntryPrice,
        leverage: positionData.leverage,
        collateral: positionData.collateral,
        borrowedAmount: positionData.borrowedAmount,
        liquidationPrice: positionData.liquidationPrice,
        isOpen: positionData.isOpen,
        tokenType: positionData.tokenType || 'yes',
        lastUpdated: new Date(),
      });
    } catch (error) {
      log.error('[PositionService] Error upserting position:', error);
      throw error;
    }
  }
}



