import { Connection, PublicKey, Keypair, Transaction, SystemProgram, ComputeBudgetProgram } from '@solana/web3.js';
import { AnchorProvider, BN, Program, Wallet } from '@coral-xyz/anchor';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { OrderBookService } from './orderBookService';
import { Op } from 'sequelize';
import { Order } from '../models/Order';
import { Market } from '../models/Market';
import { wsEventEmitter } from '../websocket/server';
import { referralService } from './referralService';
import { loadIDL } from '../utils/idl-loader';
import {
  getPendingOrderPDA,
  getOrderEscrowPDA,
  getOrderEscrowAuthorityPDA,
  getMarketVaultPDA,
  getVaultAuthorityPDA,
  getPositionPDA,
  getOldPositionPDA,
  getConfigPDA,
  getYesMintPDA,
  getNoMintPDA,
  getMintAuthorityPDA,
  getMatchStatePDA,
  getShareEscrowAuthorityPDA,
  getShareEscrowYesPDA,
  getShareEscrowNoPDA,
  getMarginVaultPDA,
  getMarginVaultAuthorityPDA,
  getLiquidityVaultPDA,
  getLiquidityVaultAuthorityPDA,
} from '../utils/solana';

// Only show error logs unless KEEPER_DEBUG is set
const LOG_LEVEL = process.env.KEEPER_DEBUG ? 'debug' : 'error';
const log = {
  info: (...args: any[]) => { if (LOG_LEVEL === 'debug') console.log(...args); },
  warn: (...args: any[]) => { if (LOG_LEVEL === 'debug') console.warn(...args); },
  error: (...args: any[]) => console.error(...args),
  debug: (...args: any[]) => { if (LOG_LEVEL === 'debug') console.log(...args); },
};

/**
 * Keeper service that automatically executes matched orders on-chain
 * This service monitors the order book, finds matches, and executes them
 * without requiring user signatures (orders are already authorized on-chain)
 */
export class OrderKeeperService {
  private connection: Connection;
  private orderBookService: OrderBookService;
  private program: Program<any> | null = null;
  private keeperKeypair: Keypair | null = null;
  private executionInterval: NodeJS.Timeout | null = null;
  private executingMatches: Set<string> = new Set();

  constructor() {
    this.connection = new Connection(
      process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
      {
        commitment: 'confirmed',
        wsEndpoint: process.env.SOLANA_WS_URL,
        confirmTransactionInitialTimeout: 60000,
      }
    );
    this.orderBookService = new OrderBookService();

    // Load keeper keypair from environment
    if (process.env.KEEPER_KEYPAIR) {
      try {
        const keypairArray = JSON.parse(process.env.KEEPER_KEYPAIR);
        this.keeperKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairArray));
        log.info('[Keeper] Keypair loaded');
      } catch (e) {
        log.warn('[Keeper] Failed to load keypair:', e);
        log.warn('[Keeper] Service will not execute orders automatically');
      }
    } else {
      log.warn('[Keeper] KEEPER_KEYPAIR not set - service disabled');
    }
  }

  /**
   * Check if keeper service is initialized
   */
  isInitialized(): boolean {
    return this.program !== null && this.keeperKeypair !== null;
  }

  /**
   * Ensure an Associated Token Account exists, create if it doesn't
   */
  private async ensureATAExists(
    mint: PublicKey,
    owner: PublicKey,
    ataAddress: PublicKey
  ): Promise<void> {
    if (!this.keeperKeypair) return;

    // Verify mint exists on-chain before trying to create ATA
    const mintAccount = await this.connection.getAccountInfo(mint);
    if (!mintAccount || mintAccount.data.length === 0) {
      log.info(`[Keeper] Mint ${mint.toString().slice(0, 8)}... does not exist on-chain, skipping ATA creation`);
      return;
    }

    const account = await this.connection.getAccountInfo(ataAddress);
    if (account === null) {
      log.info(`[Keeper] Creating ATA for mint ${mint.toString().slice(0, 8)}... owner ${owner.toString().slice(0, 8)}...`);
      
      const ix = createAssociatedTokenAccountInstruction(
        this.keeperKeypair.publicKey, // payer
        ataAddress,                    // ata address
        owner,                         // owner
        mint,                          // mint
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      
      const tx = new Transaction().add(ix);
      tx.feePayer = this.keeperKeypair.publicKey;
      const { blockhash } = await this.connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.sign(this.keeperKeypair);
      
      const sig = await this.connection.sendRawTransaction(tx.serialize());
      await this.connection.confirmTransaction(sig);
      log.info(`[Keeper] ATA created: ${ataAddress.toString()}`);
    }
  }

  /**
   * Initialize the keeper with Anchor program
   * Returns true if initialized successfully, false otherwise
   */
  async initialize(): Promise<boolean> {
    try {
      // Check for keypair first
      if (!this.keeperKeypair) {
        log.warn('[Keeper] Cannot start - no keypair available');
        log.warn('[Keeper] Set KEEPER_KEYPAIR environment variable');
        return false;
      }

      // Try to load IDL
      const idl = await loadIDL();
      if (!idl) {
        log.warn('[Keeper] Cannot start - IDL file not found');
        log.warn('[Keeper] Ensure IDL file exists');
        return false;
      }

      const wallet = new Wallet(this.keeperKeypair);
      const provider = new AnchorProvider(this.connection, wallet, {
        commitment: 'confirmed',
      });

      // Anchor 0.31+ requires new Program constructor signature
      // Use: new Program(idl, provider) instead of new Program(idl, programId, provider)
      // The programId is extracted from the IDL's address field
      this.program = new Program(idl, provider);
      log.info('[Keeper] Service initialized');
      return true;
    } catch (error) {
      log.warn('[Keeper] Failed to initialize:', error instanceof Error ? error.message : error);
      log.warn('[Keeper] Service disabled. Orders can be executed manually.');
      return false;
    }
  }

  /**
   * Start automatic execution of matched orders
   */
  startAutoExecution(intervalMs: number = 10000) {
    if (this.executionInterval) {
      clearInterval(this.executionInterval);
    }

    if (!this.isInitialized()) {
      log.warn('[Keeper] Cannot start - service not initialized');
      log.warn('[Keeper] Set KEEPER_KEYPAIR and ensure IDL file exists');
      return;
    }

    // Run one-time cleanup of stale orders on startup
    this.cleanupStaleOrders().catch((err: any) => console.error(`[Keeper] Stale order cleanup error: ${err.message}`));

    this.executionInterval = setInterval(async () => {
      try {
        await this.executePendingMatches();
      } catch (error) {
        log.error('Error in keeper execution:', error);
      }
    }, intervalMs);

    log.info(`[Keeper] Service started (interval: ${intervalMs}ms)`);
  }

  /**
   * Stop automatic execution
   */
  stopAutoExecution() {
    if (this.executionInterval) {
      clearInterval(this.executionInterval);
      this.executionInterval = null;
      log.info('[Keeper] Service stopped');
    }
  }

  /**
   * One-time cleanup: cancel all DB orders whose on-chain accounts no longer exist.
   */
  private async cleanupStaleOrders() {
    const openOrders = await Order.findAll({
      where: { status: { [Op.in]: ['open', 'partially_filled', 'pending'] } },
    });
    if (openOrders.length === 0) return;

    console.log(`[Keeper] Cleaning up stale orders: checking ${openOrders.length} open orders`);
    let cancelled = 0;

    // Check in batches of 100 to avoid RPC overload
    const batchSize = 100;
    for (let i = 0; i < openOrders.length; i += batchSize) {
      const batch = openOrders.slice(i, i + batchSize);
      const pdas = batch.map(o => {
        const onChain = (o as any).onChainOrder || (o as any).on_chain_order;
        return onChain ? new PublicKey(onChain) : null;
      });

      const accountInfos = await this.connection.getMultipleAccountsInfo(
        pdas.map(p => p || PublicKey.default)
      );

      for (let j = 0; j < batch.length; j++) {
        if (!pdas[j]) continue; // no on-chain PDA stored
        if (!accountInfos[j] || accountInfos[j]!.data.length === 0) {
          await Order.update({ status: 'cancelled' as any }, { where: { id: batch[j].id } });
          cancelled++;
          console.log(`[Keeper] Cancelled stale order ${batch[j].id} (no on-chain account)`);
        }
      }
    }

    if (cancelled > 0) {
      console.log(`[Keeper] Cleanup complete: cancelled ${cancelled} stale orders`);
    } else {
      console.log(`[Keeper] Cleanup complete: all ${openOrders.length} orders valid`);
    }
  }

  /**
   * Execute all pending matched orders
   * Scans all active markets for crossing orders and executes matches
   */
  private async executePendingMatches() {
    try {
      // Fetch all active markets (status 0 = Active)
      const markets = await Market.findAll({
        where: { status: 0 },
        attributes: ['marketId', 'outcomes'],
      });

      if (markets.length === 0) return;

      for (const market of markets) {
        let outcomeCount = 2;
        try {
          const outcomes = JSON.parse(market.outcomes);
          if (Array.isArray(outcomes)) {
            outcomeCount = outcomes.length;
          }
        } catch {
          // default binary
        }

        for (let outcomeId = 0; outcomeId < outcomeCount; outcomeId++) {
          try {
            const matches = await this.orderBookService.matchOrders(market.marketId, outcomeId);
            for (const match of matches) {
              try {
                // Refresh orders from DB
                const freshBuy = await Order.findOne({ where: { id: match.buyOrder.id } });
                const freshSell = await Order.findOne({ where: { id: match.sellOrder.id } });
                if (!freshBuy || !freshSell) continue;
                if (freshBuy.status === 'filled' || freshSell.status === 'filled') continue;

                const buyRemaining = freshBuy.getSizeBigInt() - freshBuy.getFilledBigInt();
                const sellRemaining = freshSell.getSizeBigInt() - freshSell.getFilledBigInt();
                if (buyRemaining <= 0n || sellRemaining <= 0n) continue;

                const matchSize = buyRemaining < sellRemaining ? buyRemaining : sellRemaining;
                await this.executeMatch(freshBuy, freshSell, match.price, matchSize);
              } catch (execErr: any) {
                if (!execErr.message?.includes('Already executing') && !execErr.message?.includes('already')) {
                  log.warn(`[Keeper] Match execution error: ${execErr.message}`);
                }
              }
            }
          } catch (err: any) {
            // Continue to next outcome
          }
        }
      }
    } catch (error: any) {
      log.error(`[Keeper] Error in executePendingMatches: ${error.message}`);
    }
  }

  /**
   * Execute a matched order pair on-chain
   * Called by the order matching service when orders are matched
   */
  async executeMatch(
    buyOrder: Order,
    sellOrder: Order,
    matchPrice: number,
    matchSize: bigint
  ): Promise<{ success: boolean; tx?: string; error?: string }> {
    if (!this.program || !this.keeperKeypair) {
      return {
        success: false,
        error: 'Keeper not initialized or keypair not available',
      };
    }

    const matchKey = `${buyOrder.id}-${sellOrder.id}`;
    
    // Prevent duplicate execution
    if (this.executingMatches.has(matchKey)) {
      return {
        success: false,
        error: 'Already executing',
      };
    }

    // Check if orders are already filled before proceeding
    if (buyOrder.status === 'filled' || sellOrder.status === 'filled') {
      log.info(`[Keeper] Skipping - orders already filled`);
      log.info(`  Buy Status: ${buyOrder.status}, Sell Status: ${sellOrder.status}`);
      return {
        success: false,
        error: 'One or both orders are already filled',
      };
    }

    // Check if orders have remaining quantity to fill
    const buyRemaining = buyOrder.getSizeBigInt() - buyOrder.getFilledBigInt();
    const sellRemaining = sellOrder.getSizeBigInt() - sellOrder.getFilledBigInt();
    if (buyRemaining <= 0 || sellRemaining <= 0) {
      log.info(`[Keeper] Skipping - no remaining quantity`);
      log.info(`  Buy Remaining: ${buyRemaining.toString()}, Sell Remaining: ${sellRemaining.toString()}`);
      return {
        success: false,
        error: 'No remaining quantity to fill',
      };
    }

    this.executingMatches.add(matchKey);

    try {
      // Get on-chain order addresses from database
      // Orders should have on_chain_order and order_id fields stored when placed
      // These are set in the frontend TradingPanel when calling the /api/v1/orders/limit endpoint
      const buyOrderOnChain = (buyOrder as any).on_chain_order || (buyOrder as any).onChainOrder;
      const sellOrderOnChain = (sellOrder as any).on_chain_order || (sellOrder as any).onChainOrder;
      const buyOrderId = (buyOrder as any).order_id || (buyOrder as any).orderId;
      const sellOrderId = (sellOrder as any).order_id || (sellOrder as any).orderId;

      // Get user pubkeys (needed for all operations)
      const buyUserPubkey = new PublicKey(buyOrder.userId);
      const sellUserPubkey = new PublicKey(sellOrder.userId);

      let buyPendingOrderPDA: PublicKey;
      let sellPendingOrderPDA: PublicKey;
      let buyOrderIdNum: number;
      let sellOrderIdNum: number;

      if (buyOrderOnChain && sellOrderOnChain && buyOrderId !== undefined && sellOrderId !== undefined) {
        // Use stored on-chain order addresses and order IDs (preferred method)
        // This matches the playground script which uses actual on-chain order PDAs
        buyPendingOrderPDA = new PublicKey(buyOrderOnChain);
        sellPendingOrderPDA = new PublicKey(sellOrderOnChain);
        // Ensure order IDs are numbers (not strings/UUIDs)
        buyOrderIdNum = typeof buyOrderId === 'number' ? buyOrderId : parseInt(buyOrderId.toString(), 10);
        sellOrderIdNum = typeof sellOrderId === 'number' ? sellOrderId : parseInt(sellOrderId.toString(), 10);
        
        if (isNaN(buyOrderIdNum) || isNaN(sellOrderIdNum)) {
          throw new Error(`Invalid order IDs: buyOrderId=${buyOrderId}, sellOrderId=${sellOrderId}. Order IDs must be numeric.`);
        }
        
        log.info('[Keeper] Using stored on-chain order addresses and IDs');
        log.info(`  Buy PDA: ${buyPendingOrderPDA.toString()}, ID: ${buyOrderIdNum}`);
        log.info(`  Sell PDA: ${sellPendingOrderPDA.toString()}, ID: ${sellOrderIdNum}`);

        // Verify on-chain accounts exist — cancel stale DB orders if not
        const [buyAccInfo, sellAccInfo] = await Promise.all([
          this.connection.getAccountInfo(buyPendingOrderPDA),
          this.connection.getAccountInfo(sellPendingOrderPDA),
        ]);
        if (!buyAccInfo || buyAccInfo.data.length === 0) {
          log.warn(`[Keeper] Buy order on-chain account does not exist: ${buyPendingOrderPDA.toString()}`);
          await Order.update({ status: 'cancelled' as any }, { where: { id: buyOrder.id } });
          log.info(`[Keeper] Marked stale buy order ${buyOrder.id} as cancelled`);
          throw new Error('Buy order on-chain account does not exist — marked as cancelled');
        }
        if (!sellAccInfo || sellAccInfo.data.length === 0) {
          log.warn(`[Keeper] Sell order on-chain account does not exist: ${sellPendingOrderPDA.toString()}`);
          await Order.update({ status: 'cancelled' as any }, { where: { id: sellOrder.id } });
          log.info(`[Keeper] Marked stale sell order ${sellOrder.id} as cancelled`);
          throw new Error('Sell order on-chain account does not exist — marked as cancelled');
        }
      } else {
        // Fallback: derive from order ID
        // This should only happen for old orders that were created before we started storing these fields
        throw new Error(
          `Missing required on-chain order data. ` +
          `Buy order on-chain: ${buyOrderOnChain ? 'present' : 'missing'}, ` +
          `Sell order on-chain: ${sellOrderOnChain ? 'present' : 'missing'}, ` +
          `Buy order ID: ${buyOrderId !== undefined ? buyOrderId : 'missing'}, ` +
          `Sell order ID: ${sellOrderId !== undefined ? sellOrderId : 'missing'}. ` +
          `Orders must have on_chain_order and order_id fields stored.`
        );
      }

      // Get market PDA - use the stored marketAddress directly from database
      // buyOrder.marketId should be the market PDA address (marketAddress)
      const marketRecord = await Market.findOne({
        where: { marketAddress: buyOrder.marketId },
      });
      
      if (!marketRecord) {
        throw new Error(`Market not found in database: ${buyOrder.marketId}`);
      }
      
      // Use the stored marketAddress directly - this is the actual on-chain PDA
      // Don't derive it again as it might not match if the market was created differently
      const marketPDA = new PublicKey(marketRecord.marketAddress);

      // Get all required accounts (using let so they can be updated from match state if needed)
      let [buyOrderEscrowPDA] = getOrderEscrowPDA(buyUserPubkey, buyOrderIdNum);
      let [buyOrderEscrowAuthorityPDA] = getOrderEscrowAuthorityPDA(buyUserPubkey, buyOrderIdNum);
      let [sellOrderEscrowPDA] = getOrderEscrowPDA(sellUserPubkey, sellOrderIdNum);
      let [sellOrderEscrowAuthorityPDA] = getOrderEscrowAuthorityPDA(sellUserPubkey, sellOrderIdNum);
      
      // Fetch buy order on-chain to get leverage for position type determination
      // Position type: 0 = Spot (leverage == 1), 1 = Leveraged (leverage > 1)
      let buyPositionType = 0; // Default to Spot
      let leverage: number | undefined;
      
      // First try to get leverage from on-chain order
      try {
        const buyOrderAccount = await (this.program.account as any).pendingOrder.fetch(buyPendingOrderPDA);
        leverage = buyOrderAccount.leverage as number;
        buyPositionType = leverage === 1 ? 0 : 1; // 0 = Spot, 1 = Leveraged
        log.info(`[Keeper] Buy order leverage (on-chain): ${leverage}, Position type: ${buyPositionType} (${buyPositionType === 0 ? 'Spot' : 'Leveraged'})`);
      } catch (error) {
        // Fallback: try to get leverage from database order
        try {
          const dbLeverage = (buyOrder as any).leverage;
          if (dbLeverage !== undefined && dbLeverage !== null) {
            leverage = typeof dbLeverage === 'number' ? dbLeverage : parseInt(dbLeverage.toString(), 10);
            buyPositionType = leverage === 1 ? 0 : 1;
            log.info(`[Keeper] Buy order leverage (database): ${leverage}, Position type: ${buyPositionType} (${buyPositionType === 0 ? 'Spot' : 'Leveraged'})`);
          } else {
            log.warn(`[Keeper] Could not fetch buy order leverage from on-chain or database, defaulting to Spot (leverage=1)`);
          }
        } catch (dbError) {
          log.warn(`[Keeper] Could not fetch buy order to determine leverage, defaulting to Spot: ${error}`);
        }
      }
      
      // buyPositionPDA is computed after isNoTrade is determined (token_type needed for PDA)
      let buyPositionPDA: PublicKey;
      
      const [vaultPDA] = getMarketVaultPDA(marketPDA);
      const [vaultAuthorityPDA] = getVaultAuthorityPDA(marketPDA);
      const [marginVaultPDA] = getMarginVaultPDA(marketPDA);
      const [marginVaultAuthorityPDA] = getMarginVaultAuthorityPDA(marketPDA);
      const [liquidityVaultPDA] = getLiquidityVaultPDA(marketPDA);
      const [liquidityVaultAuthorityPDA] = getLiquidityVaultAuthorityPDA(marketPDA);
      const [mintAuthorityPDA] = getMintAuthorityPDA(marketPDA);
      const [configPDA] = getConfigPDA();

      // Get YES/NO mint PDAs
      // Multi-outcome: YES mint is per-outcome, NO mint is per-outcome (new model)
      // Old model: NO mint was shared per-market (no outcomeId in PDA derivation)
      const outcomeId = buyOrder.outcomeId;
      const [yesMintForOutcome] = getYesMintPDA(marketPDA, outcomeId); // YES mint for actual outcome
      const [yesMintForOutcome0] = outcomeId === 0 ? [yesMintForOutcome] : getYesMintPDA(marketPDA, 0); // For backward compat
      // Try new per-outcome NO mint first; fall back to old shared NO mint (no outcomeId)
      const [newNoMintPDA] = getNoMintPDA(marketPDA, outcomeId);
      const [oldNoMintPDA] = getNoMintPDA(marketPDA); // Old model: no outcomeId
      const newNoMintInfo = await this.connection.getAccountInfo(newNoMintPDA);
      const buyNoMintPDA = (newNoMintInfo && newNoMintInfo.data.length > 0) ? newNoMintPDA : oldNoMintPDA;

      // Get buyer's YES mint - use outcome 0 for consistency with executeYesBuyerMatch
      const buyYesMintPDA = yesMintForOutcome0;
      const [sellYesMintPDA] = getYesMintPDA(marketPDA, sellOrder.outcomeId);
      const [newSellNoMintPDA] = getNoMintPDA(marketPDA, sellOrder.outcomeId);
      const [oldSellNoMintPDA] = getNoMintPDA(marketPDA);
      const newSellNoMintInfo = await this.connection.getAccountInfo(newSellNoMintPDA);
      const sellNoMintPDA = (newSellNoMintInfo && newSellNoMintInfo.data.length > 0) ? newSellNoMintPDA : oldSellNoMintPDA;

      // Get user token accounts (ATAs)
      const buyUserYesATA = await getAssociatedTokenAddress(buyYesMintPDA, buyUserPubkey);
      const buyUserNoATA = await getAssociatedTokenAddress(buyNoMintPDA, buyUserPubkey);
      const sellUserYesATA = await getAssociatedTokenAddress(sellYesMintPDA, sellUserPubkey);
      const sellUserNoATA = await getAssociatedTokenAddress(sellNoMintPDA, sellUserPubkey);

      log.info(`[Keeper] Executing match: ${matchKey}`);
      log.info(`  Market: ${marketPDA.toString()} (ID: ${marketRecord.marketId})`);
      log.info(`  Price: ${matchPrice}bps (${(matchPrice / 10000 * 100).toFixed(2)}%), Size: ${matchSize.toString()}, Value: ${(Number(matchSize) * matchPrice / 10000).toFixed(2)} USDC`);
      log.info(`  Buy Order: ${buyOrder.id} (on-chain: ${buyOrderIdNum}), User: ${buyUserPubkey.toString().slice(0, 8)}..., Outcome: ${buyOrder.outcomeId}`);
      log.info(`  Sell Order: ${sellOrder.id} (on-chain: ${sellOrderIdNum}), User: ${sellUserPubkey.toString().slice(0, 8)}..., Outcome: ${sellOrder.outcomeId}`);

      const [matchStatePDA] = getMatchStatePDA(marketPDA, buyOrderIdNum, sellOrderIdNum);

      // Check if match state already exists (in case of retry)
      const matchStateAccount = await this.connection.getAccountInfo(matchStatePDA);
      const skipStep1 = matchStateAccount !== null;
      
      // If match state exists, verify order IDs match and use them
      if (skipStep1 && this.program) {
        try {
          const matchStateData: any = await this.program.account.matchState.fetch(matchStatePDA);
          
          if (matchStateData.executed) {
            log.info(`[Keeper] Match already executed - skipping`);
            this.executingMatches.delete(matchKey);
            return {
              success: false,
              error: 'Match already executed',
            };
          }

          // Also check on-chain order status to see if orders are already filled
          try {
            const buyOrderOnChainData: any = await this.program.account.pendingOrder.fetch(buyPendingOrderPDA);
            const sellOrderOnChainData: any = await this.program.account.pendingOrder.fetch(sellPendingOrderPDA);
            
            const FILLED_STATUS = 2;
            if (buyOrderOnChainData.status === FILLED_STATUS || sellOrderOnChainData.status === FILLED_STATUS) {
              log.info(`[Keeper] Orders already filled on-chain - syncing DB and skipping`);
              // Sync DB so these stale orders stop being re-matched
              try {
                if (buyOrderOnChainData.status === FILLED_STATUS && (buyOrder.status as string) !== 'filled') {
                  await Order.update({ status: 'filled' as any, filled: buyOrder.size }, { where: { id: buyOrder.id } });
                  log.info(`[Keeper] Synced buy order ${buyOrder.id} to filled`);
                }
                if (sellOrderOnChainData.status === FILLED_STATUS && (sellOrder.status as string) !== 'filled') {
                  await Order.update({ status: 'filled' as any, filled: sellOrder.size }, { where: { id: sellOrder.id } });
                  log.info(`[Keeper] Synced sell order ${sellOrder.id} to filled`);
                }
              } catch (syncErr: any) {
                log.warn(`[Keeper] Failed to sync order status: ${syncErr.message}`);
              }
              this.executingMatches.delete(matchKey);
              return {
                success: false,
                error: 'Orders already filled on-chain',
              };
            }
          } catch (onChainError: any) {
            log.warn(`[Keeper] Could not read on-chain order status: ${onChainError.message}`);
            // Continue execution if we can't read on-chain status
          }
          
          // Verify order IDs match
          if (matchStateData.buyOrderId.toNumber() !== buyOrderIdNum) {
            throw new Error(
              `Order ID mismatch: Match state has buyOrderId=${matchStateData.buyOrderId.toNumber()}, ` +
              `but we're using buyOrderId=${buyOrderIdNum}. They must match.`
            );
          }
          if (matchStateData.sellOrderId.toNumber() !== sellOrderIdNum) {
            throw new Error(
              `Order ID mismatch: Match state has sellOrderId=${matchStateData.sellOrderId.toNumber()}, ` +
              `but we're using sellOrderId=${sellOrderIdNum}. They must match.`
            );
          }
          
          // Verify order users match
          if (matchStateData.buyOrderUser.toString() !== buyUserPubkey.toString()) {
            throw new Error(
              `User mismatch: Match state has buyOrderUser=${matchStateData.buyOrderUser.toString()}, ` +
              `but we're using buyUserPubkey=${buyUserPubkey.toString()}. They must match.`
            );
          }
          if (matchStateData.sellOrderUser.toString() !== sellUserPubkey.toString()) {
            throw new Error(
              `User mismatch: Match state has sellOrderUser=${matchStateData.sellOrderUser.toString()}, ` +
              `but we're using sellUserPubkey=${sellUserPubkey.toString()}. They must match.`
            );
          }
          
          // Sync matchPrice from on-chain match state to ensure DB writes match on-chain execution.
          // This is critical: the on-chain match_state.match_price is what the program uses for
          // position entry, so the keeper's local matchPrice must match to keep DB consistent.
          const onChainMatchPrice = matchStateData.matchPrice?.toNumber?.() ?? matchStateData.match_price?.toNumber?.();
          if (onChainMatchPrice && onChainMatchPrice > 0 && onChainMatchPrice !== matchPrice) {
            log.info(`[Keeper] Syncing matchPrice from on-chain match state: ${matchPrice} -> ${onChainMatchPrice}`);
            matchPrice = onChainMatchPrice;
          }

          // Derive order PDAs from match state to ensure consistency
          const matchStateBuyUser = new PublicKey(matchStateData.buyOrderUser);
          const matchStateSellUser = new PublicKey(matchStateData.sellOrderUser);
          const matchStateBuyOrderId = matchStateData.buyOrderId.toNumber();
          const matchStateSellOrderId = matchStateData.sellOrderId.toNumber();
          
          const [buyOrderPDAFromMatch] = getPendingOrderPDA(matchStateBuyUser, matchStateBuyOrderId);
          const [sellOrderPDAFromMatch] = getPendingOrderPDA(matchStateSellUser, matchStateSellOrderId);
          
          if (buyOrderPDAFromMatch.toString() !== buyPendingOrderPDA.toString()) {
            log.warn(`[Keeper] Buy Order PDA mismatch - using match state derived PDA`);
            buyPendingOrderPDA = buyOrderPDAFromMatch;
            // Also update escrow PDAs
            [buyOrderEscrowPDA] = getOrderEscrowPDA(matchStateBuyUser, matchStateBuyOrderId);
            [buyOrderEscrowAuthorityPDA] = getOrderEscrowAuthorityPDA(matchStateBuyUser, matchStateBuyOrderId);
          }
          if (sellOrderPDAFromMatch.toString() !== sellPendingOrderPDA.toString()) {
            log.warn(`[Keeper] Sell Order PDA mismatch - using match state derived PDA`);
            sellPendingOrderPDA = sellOrderPDAFromMatch;
            // Also update escrow PDAs
            [sellOrderEscrowPDA] = getOrderEscrowPDA(matchStateSellUser, matchStateSellOrderId);
            [sellOrderEscrowAuthorityPDA] = getOrderEscrowAuthorityPDA(matchStateSellUser, matchStateSellOrderId);
          }
        } catch (error: any) {
          log.error(`[Keeper] Failed to read match state: ${error.message}`);
          // Continue with original PDAs if read fails
        }
      }
      
      let tx1 = 'skipped';
      if (!skipStep1) {
        // Check on-chain order status before validating match
        try {
          const buyOrderOnChainData: any = await this.program.account.pendingOrder.fetch(buyPendingOrderPDA);
          const sellOrderOnChainData: any = await this.program.account.pendingOrder.fetch(sellPendingOrderPDA);
          
          const FILLED_STATUS = 2;
          const OPEN_STATUS = 0;
          const PARTIALLY_FILLED_STATUS = 1;
          
          // Check if orders are already filled
          if (buyOrderOnChainData.status === FILLED_STATUS || sellOrderOnChainData.status === FILLED_STATUS) {
            log.info(`[Keeper] Orders already filled on-chain - syncing DB and skipping match`);
            log.info(`  Buy Order Status: ${buyOrderOnChainData.status}, Sell Order Status: ${sellOrderOnChainData.status}`);
            try {
              if (buyOrderOnChainData.status === FILLED_STATUS && (buyOrder.status as string) !== 'filled') {
                await Order.update({ status: 'filled' as any, filled: buyOrder.size }, { where: { id: buyOrder.id } });
                log.info(`[Keeper] Synced buy order ${buyOrder.id} to filled`);
              }
              if (sellOrderOnChainData.status === FILLED_STATUS && (sellOrder.status as string) !== 'filled') {
                await Order.update({ status: 'filled' as any, filled: sellOrder.size }, { where: { id: sellOrder.id } });
                log.info(`[Keeper] Synced sell order ${sellOrder.id} to filled`);
              }
            } catch (syncErr: any) {
              log.warn(`[Keeper] Failed to sync order status: ${syncErr.message}`);
            }
            this.executingMatches.delete(matchKey);
            return {
              success: false,
              error: 'Orders already filled on-chain',
            };
          }

          // Check if orders are in valid status for matching
          const buyStatusValid = buyOrderOnChainData.status === OPEN_STATUS || buyOrderOnChainData.status === PARTIALLY_FILLED_STATUS;
          const sellStatusValid = sellOrderOnChainData.status === OPEN_STATUS || sellOrderOnChainData.status === PARTIALLY_FILLED_STATUS;
          
          if (!buyStatusValid || !sellStatusValid) {
            log.info(`[Keeper] Orders not in valid status for matching - skipping`);
            log.info(`  Buy Order Status: ${buyOrderOnChainData.status}, Sell Order Status: ${sellOrderOnChainData.status}`);
            this.executingMatches.delete(matchKey);
            return {
              success: false,
              error: `Orders not in valid status (buy: ${buyOrderOnChainData.status}, sell: ${sellOrderOnChainData.status})`,
            };
          }
        } catch (onChainError: any) {
          // If we can't read on-chain status, log but continue
          log.warn(`[Keeper] Could not read on-chain order status before Step 1: ${onChainError.message}`);
          // Continue with validation - it will fail if orders are invalid
        }
        
        log.info(`[Keeper] Step 1: Validating match and creating match state`);

        // Fetch actual on-chain order prices to verify they match our match price
        let buyPriceOnChain: number | undefined;
        let sellPriceOnChain: number | undefined;
        
        try {
          const buyOrderOnChain = await this.program.account.pendingOrder.fetch(buyPendingOrderPDA);
          const sellOrderOnChain = await this.program.account.pendingOrder.fetch(sellPendingOrderPDA);
          
          buyPriceOnChain = buyOrderOnChain.price.toNumber();
          sellPriceOnChain = sellOrderOnChain.price.toNumber();
          
          if (buyPriceOnChain !== undefined && sellPriceOnChain !== undefined) {
            log.info(`[Keeper] On-chain order prices:`);
            log.info(`  Buy order (DB: ${buyOrder.price}, On-chain: ${buyPriceOnChain}): ${buyPriceOnChain === buyOrder.price ? '✓ Match' : '✗ Mismatch'}`);
            log.info(`  Sell order (DB: ${sellOrder.price}, On-chain: ${sellPriceOnChain}): ${sellPriceOnChain === sellOrder.price ? '✓ Match' : '✗ Mismatch'}`);
            log.info(`  Match price: ${matchPrice}`);
            log.info(`  Price check: buy_price (${buyPriceOnChain}) >= sell_price (${sellPriceOnChain}): ${buyPriceOnChain >= sellPriceOnChain ? '✓' : '✗'}`);
            
            // For market orders, adjust match price if needed
            // Market sell orders should accept any price >= their min_price (stored in price field for market orders)
            // Market buy orders should accept any price <= their max_price
            if (buyOrder.type === 'market' || sellOrder.type === 'market') {
              log.info(`[Keeper] Market order detected - adjusting validation logic`);
              // For market sell: match price should be >= sell order price (min acceptable)
              // For market buy: match price should be <= buy order price (max acceptable)
              // The match price should be the limit order's price
              if (buyOrder.type === 'limit' && sellOrder.type === 'market') {
                // Limit buy + Market sell: always use buy order price (best available price for seller)
                // This ensures market sell executes at the best available price
                log.info(`[Keeper] Limit buy (${buyPriceOnChain}) + Market sell (min: ${sellPriceOnChain})`);
                log.info(`[Keeper] Executing at best available price: ${buyPriceOnChain}`);
                matchPrice = buyPriceOnChain;
                
                // Verify the match price meets the market sell's minimum requirement
                if (matchPrice < sellPriceOnChain) {
                  log.error(`[Keeper] ERROR: Match price ${matchPrice} is below market sell min price ${sellPriceOnChain}`);
                  log.error(`[Keeper] This order cannot be matched - slippage exceeded`);
                  throw new Error(`Match price ${matchPrice} is below market sell minimum ${sellPriceOnChain} (slippage exceeded)`);
                }
              } else if (buyOrder.type === 'market' && sellOrder.type === 'limit') {
                // Market buy + Limit sell: always use sell order price (best available price for buyer)
                log.info(`[Keeper] Market buy (max: ${buyPriceOnChain}) + Limit sell (${sellPriceOnChain})`);
                log.info(`[Keeper] Executing at best available price: ${sellPriceOnChain}`);
                matchPrice = sellPriceOnChain;
                
                // Verify the match price meets the market buy's maximum requirement
                if (matchPrice > buyPriceOnChain) {
                  log.error(`[Keeper] ERROR: Match price ${matchPrice} is above market buy max price ${buyPriceOnChain}`);
                  throw new Error(`Match price ${matchPrice} is above market buy maximum ${buyPriceOnChain} (slippage exceeded)`);
                }
              }
            }
          }
        } catch (fetchError: any) {
          log.warn(`[Keeper] Could not fetch on-chain order prices: ${fetchError.message}`);
        }
        
        try {
          tx1 = await this.program.methods
            .validateMatch(
              new BN(buyOrderIdNum),
              new BN(sellOrderIdNum),
              new BN(matchPrice),
              new BN(matchSize.toString())
            )
            .accounts({
              market: marketPDA,
              config: configPDA,
              buyOrder: buyPendingOrderPDA,
              sellOrder: sellPendingOrderPDA,
              keeper: this.keeperKeypair.publicKey,
              matchState: matchStatePDA,
              systemProgram: SystemProgram.programId,
            })
            .rpc();
          log.info(`[Keeper] Step 1 completed: ${tx1}`);
        } catch (validateError: any) {
          // Check if error is due to orders already filled or invalid status
          const errorMsg = validateError?.message || validateError?.toString() || '';
          const errorCode = validateError?.error?.errorCode?.code || '';
          
          if (errorCode === 'InvalidPrice' || errorMsg.includes('Bad price')) {
            log.error(`[Keeper] Step 1 failed - Price validation failed`);
            log.error(`  Buy order price (on-chain): ${buyPriceOnChain ?? 'N/A'}`);
            log.error(`  Sell order price (on-chain): ${sellPriceOnChain ?? 'N/A'}`);
            log.error(`  Match price: ${matchPrice}`);
            log.error(`  Validation requires: buy_price >= sell_price`);
            log.error(`  For market sell orders, the price should be min_price (with 5% slippage)`);
            log.error(`  This order may have been created with the wrong price before the fix`);
            log.error(`  Solution: Cancel this order and create a new leveraged close order`);
            this.executingMatches.delete(matchKey);
            return {
              success: false,
              error: `Price validation failed: buy_price (${buyPriceOnChain ?? 'unknown'}) < sell_price (${sellPriceOnChain ?? 'unknown'}). The sell order may need to be canceled and recreated.`,
            };
          }
          
          if (errorCode === 'InvalidOrder' || errorMsg.includes('Bad order')) {
            log.info(`[Keeper] Step 1 failed - orders may already be filled or invalid`);
            log.info(`  This is likely a race condition - another keeper may have executed this match`);
            this.executingMatches.delete(matchKey);
            return {
              success: false,
              error: 'Orders already filled or invalid (race condition)',
            };
          }
          
          // Handle "already in use" — match_state was created by a previous attempt or race condition
          if (errorMsg.includes('already in use') || errorMsg.includes('Allocate')) {
            log.info(`[Keeper] Step 1 - match_state already exists (race condition). Proceeding to Step 2.`);
            // Sync matchPrice from on-chain match state to ensure consistency
            try {
              const matchStateData: any = await (this.program.account as any).matchState.fetch(matchStatePDA);
              const onChainMatchPrice = matchStateData.matchPrice?.toNumber?.() ?? matchStateData.match_price?.toNumber?.();
              if (onChainMatchPrice && onChainMatchPrice > 0 && onChainMatchPrice !== matchPrice) {
                log.info(`[Keeper] Syncing matchPrice from on-chain match state: ${matchPrice} -> ${onChainMatchPrice}`);
                matchPrice = onChainMatchPrice;
              }
            } catch (readErr: any) {
              log.warn(`[Keeper] Could not read match state for price sync: ${readErr.message}`);
            }
            tx1 = 'skipped-already-exists';
          } else if (errorCode === 'AccountDidNotDeserialize' || errorMsg.includes('AccountDidNotDeserialize') || errorMsg.includes('Failed to deserialize')) {
            // Handle deserialization errors (old orders created before program upgrade)
            log.info(`[Keeper] Step 1 failed - order account incompatible (pre-upgrade order)`);
            log.info(`  Old orders created before program upgrade cannot be matched.`);
            log.info(`  Users need to cancel old orders and create new ones.`);
            this.executingMatches.delete(matchKey);
            // Mark these orders as needing cancellation in the database
            return {
              success: false,
              error: 'Order incompatible - created before program upgrade. User must cancel and recreate.',
            };
          } else {
            // Re-throw other errors
            throw validateError;
          }
        }
      } else {
        log.info(`[Keeper] Step 1 skipped (match state exists)`);
      }

      // outcomeId already declared above from buyOrder.outcomeId
      
      // Get seller's share escrow PDAs
      const [sellShareEscrowAuthorityPDA] = getShareEscrowAuthorityPDA(sellUserPubkey, sellOrderIdNum);
      const [sellShareEscrowYesPDA] = getShareEscrowYesPDA(sellUserPubkey, sellOrderIdNum);
      const [sellShareEscrowNoPDA] = getShareEscrowNoPDA(sellUserPubkey, sellOrderIdNum);
      
      // DEBUG: Log escrow derivation
      log.info(`[Keeper] Sell escrow derivation:`);
      log.info(`  sellUserPubkey: ${sellUserPubkey.toString()}`);
      log.info(`  sellOrderIdNum: ${sellOrderIdNum}`);
      log.info(`  sellShareEscrowYesPDA: ${sellShareEscrowYesPDA.toString()}`);
      log.info(`  sellShareEscrowAuthorityPDA: ${sellShareEscrowAuthorityPDA.toString()}`);

      // Determine if this is a NO-side trade.
      // Primary: check the DB order's tokenType (set by frontend when placing order).
      // Fallback: check if sell NO escrow account exists on-chain (for spot NO sells
      // via placeNoLimitSellOrder, and leveraged close NO sells via closeLeveragedPosition,
      // both of which use share_escrow_no seeds for ALL NO positions).
      const sellTokenTypeFromDb = (sellOrder as any).tokenType || (sellOrder as any).token_type || 'yes';
      const sellNoEscrowAccountInfo = await this.connection.getAccountInfo(sellShareEscrowNoPDA);
      const isNoTradeFromEscrow = sellNoEscrowAccountInfo !== null && sellNoEscrowAccountInfo.lamports > 0 && sellNoEscrowAccountInfo.data.length >= 72;
      const isNoTrade = sellTokenTypeFromDb === 'no' || isNoTradeFromEscrow;

      // Now compute buyPositionPDA with correct token_type (0=YES, 1=NO)
      // Try new PDA first; if buyer already has position at old PDA, use that instead
      const buyTokenTypeNum = isNoTrade ? 1 : 0;
      const newBuyPositionPDA = getPositionPDA(marketPDA, buyUserPubkey, buyOrder.outcomeId, 0, buyPositionType, buyTokenTypeNum)[0];
      const oldBuyPositionPDA = getOldPositionPDA(marketPDA, buyUserPubkey, buyOrder.outcomeId, 0, buyPositionType)[0];
      const oldBuyPosInfo = await this.connection.getAccountInfo(oldBuyPositionPDA);
      // If old PDA has an account, buyer's position lives there (backward compat)
      // If not, use new PDA (either existing or will be created by program)
      buyPositionPDA = (oldBuyPosInfo && oldBuyPosInfo.lamports > 0) ? oldBuyPositionPDA : newBuyPositionPDA;
      log.info(`  buyPositionPDA: ${buyPositionPDA.toString()} (tokenType=${buyTokenTypeNum}, isOldPDA=${buyPositionPDA.equals(oldBuyPositionPDA)})`);

      // Get buyer's outcome account
      // NO trade: use NO mint for the outcome (executeNoBuyerMatch)
      // YES trade: use YES mint for the outcome (executeYesBuyerMatch)
      let outcomeMintPDA: PublicKey;
      let buyUserOutcomeATA: PublicKey;
      if (isNoTrade) {
        // NO outcome - use per-outcome NO mint with executeNoBuyerMatch
        outcomeMintPDA = buyNoMintPDA;
        buyUserOutcomeATA = await getAssociatedTokenAddress(buyNoMintPDA, buyUserPubkey);
      } else {
        // YES outcome (any outcome)
        outcomeMintPDA = yesMintForOutcome;
        buyUserOutcomeATA = await getAssociatedTokenAddress(yesMintForOutcome, buyUserPubkey);
      }

      // Resolve the market's quote mint from on-chain so the seller's payout
      // ATA matches the vault's token (USDC for legacy markets, SPACE for
      // SPACE-denominated markets, etc.). Hardcoding USDC here previously
      // caused SPL-Token 0x3 (Account not associated with this Mint) on every
      // SPACE seller match because market_vault (SPACE) ≠ seller USDC ATA.
      const USDC_MINT_FALLBACK = new PublicKey(process.env.USDC_MINT || 'CqdmbJnQxMNNTGZzsBhEPTSzH52Pwa5DRvpVjZ2Us92t');
      let marketQuoteMint: PublicKey = USDC_MINT_FALLBACK;
      try {
        const marketAcct: any = await (this.program.account as any).market.fetch(marketPDA);
        const qm = marketAcct?.quoteMint as PublicKey | undefined;
        if (qm && !qm.equals(PublicKey.default)) {
          marketQuoteMint = qm;
        }
      } catch (e: any) {
        log.warn(`[Keeper] Could not read market.quote_mint; falling back to USDC: ${e?.message || e}`);
      }
      log.info(`[Keeper] Market quote mint resolved: ${marketQuoteMint.toString()}`);

      // Seller's payout ATA in the market's quote token
      const sellUserUsdcATA = await getAssociatedTokenAddress(marketQuoteMint, sellUserPubkey);

      log.info(`[Keeper] Ensuring token accounts exist`);
      await this.ensureATAExists(buyYesMintPDA, buyUserPubkey, buyUserYesATA);
      await this.ensureATAExists(buyNoMintPDA, buyUserPubkey, buyUserNoATA);
      await this.ensureATAExists(outcomeMintPDA, buyUserPubkey, buyUserOutcomeATA);
      await this.ensureATAExists(marketQuoteMint, sellUserPubkey, sellUserUsdcATA);

      // Verify escrow accounts exist before executing match
      // This is critical for leveraged positions where the position needs to be created
      // The contract checks if escrow.lamports() > 0, so we verify this upfront
      if (!isNoTrade) {
        // YES outcome (any outcome) - check YES escrow
        const sellEscrowAccount = await this.connection.getAccountInfo(sellShareEscrowYesPDA);
        if (!sellEscrowAccount || sellEscrowAccount.lamports === 0) {
          log.error(`[Keeper] ERROR: Sell share escrow YES account does not exist or is not initialized`);
          log.error(`  Escrow PDA: ${sellShareEscrowYesPDA.toString()}`);
          log.error(`  Account exists: ${sellEscrowAccount !== null}, Lamports: ${sellEscrowAccount?.lamports ?? 0}`);
          log.error(`  This usually means the sell order was placed incorrectly or the seller doesn't have shares to escrow`);
          log.error(`  The sell order (${sellOrder.id}) may need to be canceled and recreated`);
          log.error(`  Marking sell order as cancelled in database to prevent further match attempts`);

          // Mark the sell order as cancelled in the database to prevent further match attempts
          try {
            await Order.update(
              { status: 'cancelled' },
              { where: { id: sellOrder.id } }
            );
            log.info(`[Keeper] Marked sell order ${sellOrder.id} as cancelled due to missing escrow account`);
          } catch (dbError) {
            log.error(`[Keeper] Failed to update order status in database:`, dbError);
          }

          this.executingMatches.delete(matchKey);
          return {
            success: false,
            error: `Sell share escrow YES account not initialized. The sell order may be invalid or the seller doesn't have shares. Escrow PDA: ${sellShareEscrowYesPDA.toString()}`,
          };
        }
        // Verify it's a token account (should have data length >= 72 for token account)
        if (sellEscrowAccount.data.length < 72) {
          log.error(`[Keeper] ERROR: Sell share escrow YES account exists but is not a valid token account`);
          log.error(`  Account data length: ${sellEscrowAccount.data.length} (expected >= 72)`);
          log.error(`  Marking sell order as cancelled in database to prevent further match attempts`);

          // Mark the sell order as cancelled in the database to prevent further match attempts
          try {
            await Order.update(
              { status: 'cancelled' },
              { where: { id: sellOrder.id } }
            );
            log.info(`[Keeper] Marked sell order ${sellOrder.id} as cancelled due to invalid escrow account`);
          } catch (dbError) {
            log.error(`[Keeper] Failed to update order status in database:`, dbError);
          }

          this.executingMatches.delete(matchKey);
          return {
            success: false,
            error: `Sell share escrow YES account is not a valid token account. The sell order may be invalid.`,
          };
        }
        log.info(`[Keeper] Sell share escrow YES account verified: ${sellShareEscrowYesPDA.toString()} (lamports: ${sellEscrowAccount.lamports})`);
      } else {
        // NO outcome (any outcome) - verify NO escrow exists
        // Re-fetch if the initial check was null (isNoTrade may have come from DB tokenType)
        const noEscrowInfo = sellNoEscrowAccountInfo || await this.connection.getAccountInfo(sellShareEscrowNoPDA);
        if (!noEscrowInfo || noEscrowInfo.lamports === 0 || noEscrowInfo.data.length < 72) {
          log.error(`[Keeper] ERROR: Sell share escrow NO account does not exist or is not initialized`);
          log.error(`  Escrow PDA: ${sellShareEscrowNoPDA.toString()}`);
          log.error(`  Account exists: ${noEscrowInfo !== null}, Lamports: ${noEscrowInfo?.lamports ?? 0}`);
          log.error(`  Marking sell order as cancelled in database to prevent further match attempts`);

          try {
            await Order.update(
              { status: 'cancelled' },
              { where: { id: sellOrder.id } }
            );
            log.info(`[Keeper] Marked sell order ${sellOrder.id} as cancelled due to missing NO escrow account`);
          } catch (dbError) {
            log.error(`[Keeper] Failed to update order status in database:`, dbError);
          }

          this.executingMatches.delete(matchKey);
          return {
            success: false,
            error: `Sell share escrow NO account not initialized. Escrow PDA: ${sellShareEscrowNoPDA.toString()}`,
          };
        }
        log.info(`[Keeper] Sell share escrow NO account verified: ${sellShareEscrowNoPDA.toString()} (lamports: ${noEscrowInfo.lamports})`);
        log.info(`[Keeper] NO trade for outcomeId=${outcomeId} - Position PDA: ${buyPositionPDA.toString()}, Position type: ${buyPositionType} (${buyPositionType === 0 ? 'Spot' : 'Leveraged'})`);
      }

      log.info(`[Keeper] Step 2: Executing buyer side (outcomeId: ${outcomeId})`);
      
      // Check match state before executing buyer side
      let buyAlreadyExecuted = false;
      try {
        const matchStateData: any = await this.program.account.matchState.fetch(matchStatePDA);
        if (matchStateData.buyExecuted) {
          log.info(`[Keeper] Buyer side already executed - skipping Step 2`);
          buyAlreadyExecuted = true;
        }
      } catch (matchStateError: any) {
        // If we can't read match state, continue with execution
        log.warn(`[Keeper] Could not read match state before Step 2: ${matchStateError.message}`);
      }
      
      let tx2: string;
      if (!buyAlreadyExecuted) {
        // Verify accounts match before execution
        if (!isNoTrade) {
          log.info(`[Keeper] Verifying YES outcome accounts (outcomeId=${outcomeId}):`);
          log.info(`  yesMint (outcome ${outcomeId}): ${yesMintForOutcome.toString()}`);
          log.info(`  buyUserOutcomeATA: ${buyUserOutcomeATA.toString()}`);

          // Verify buyUserOutcomeATA is for the correct mint
          try {
            const ataInfo = await this.connection.getParsedAccountInfo(buyUserOutcomeATA);
            if (ataInfo.value && 'parsed' in ataInfo.value.data) {
              const parsedData = ataInfo.value.data.parsed;
              if (parsedData.type === 'account' && parsedData.info.mint) {
                const ataMint = new PublicKey(parsedData.info.mint);
                log.info(`  buyUserOutcomeATA mint: ${ataMint.toString()}`);
                if (ataMint.toString() !== yesMintForOutcome.toString()) {
                  log.error(`[Keeper] ERROR: buyUserOutcomeATA has wrong mint!`);
                  log.error(`  Expected: ${yesMintForOutcome.toString()}`);
                  log.error(`  Got: ${ataMint.toString()}`);
                  throw new Error(`buyUserOutcomeATA mint mismatch - expected ${yesMintForOutcome.toString()}, got ${ataMint.toString()}`);
                }
              }
            }
          } catch (error: any) {
            log.warn(`[Keeper] Could not verify ATA mint: ${error.message}`);
          }
        }
        
        // Request more compute units for complex execution
        const computeBudgetIx = ComputeBudgetProgram.setComputeUnitLimit({
          units: 400000, // Request 400k CUs
        });
        
        try {
          if (!isNoTrade) {
            // YES outcome (any outcome) - use executeYesBuyerMatch with the YES mint
            tx2 = await this.program.methods
              .executeYesBuyerMatch()
              .accounts({
                market: marketPDA,
                matchState: matchStatePDA,
                buyOrder: buyPendingOrderPDA,
                keeper: this.keeperKeypair.publicKey,
                buyOrderEscrow: buyOrderEscrowPDA,
                sellShareEscrowYes: sellShareEscrowYesPDA,
                yesMint: yesMintForOutcome,
                buyUserOutcomeAccount: buyUserOutcomeATA,
                buyPosition: buyPositionPDA,
                marketVault: vaultPDA,
                marginVault: marginVaultPDA,
                liquidityVault: liquidityVaultPDA,
                buyOrderEscrowAuthority: buyOrderEscrowAuthorityPDA,
                sellShareEscrowAuthority: sellShareEscrowAuthorityPDA,
                vaultAuthority: vaultAuthorityPDA,
                marginVaultAuthority: marginVaultAuthorityPDA,
                liquidityVaultAuthority: liquidityVaultAuthorityPDA,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
              })
              .preInstructions([computeBudgetIx])
              .rpc();
          } else {
            // NO outcome (any outcome) - use executeNoBuyerMatch with per-outcome NO mint
            // Verify position PDA derivation matches contract expectation (new or old format)
            const expectedNewPDA = getPositionPDA(marketPDA, buyUserPubkey, outcomeId, 0, buyPositionType, buyTokenTypeNum)[0];
            const expectedOldPDA = getOldPositionPDA(marketPDA, buyUserPubkey, outcomeId, 0, buyPositionType)[0];
            if (buyPositionPDA.toString() !== expectedNewPDA.toString() && buyPositionPDA.toString() !== expectedOldPDA.toString()) {
              log.error(`[Keeper] ERROR: Position PDA mismatch for NO buy`);
              log.error(`  Expected new (outcomeId=${outcomeId}): ${expectedNewPDA.toString()}`);
              log.error(`  Expected old (outcomeId=${outcomeId}): ${expectedOldPDA.toString()}`);
              log.error(`  Got: ${buyPositionPDA.toString()}`);
              log.error(`  Position type: ${buyPositionType} (${buyPositionType === 0 ? 'Spot' : 'Leveraged'})`);
              this.executingMatches.delete(matchKey);
              return {
                success: false,
                error: `Position PDA mismatch for NO buy outcomeId=${buyOrder.outcomeId}`,
              };
            }

            log.info(`[Keeper] NO buy (outcomeId=${outcomeId}) - Position PDA verified: ${buyPositionPDA.toString()}`);

            tx2 = await this.program.methods
              .executeNoBuyerMatch()
              .accounts({
                market: marketPDA,
                matchState: matchStatePDA,
                buyOrder: buyPendingOrderPDA,
                keeper: this.keeperKeypair.publicKey,
                buyOrderEscrow: buyOrderEscrowPDA,
                sellShareEscrowNo: sellShareEscrowNoPDA,
                noMint: buyNoMintPDA,
                buyUserOutcomeAccount: buyUserOutcomeATA,
                buyPosition: buyPositionPDA,
                marketVault: vaultPDA,
                marginVault: marginVaultPDA,
                liquidityVault: liquidityVaultPDA,
                buyOrderEscrowAuthority: buyOrderEscrowAuthorityPDA,
                sellShareEscrowAuthority: sellShareEscrowAuthorityPDA,
                vaultAuthority: vaultAuthorityPDA,
                marginVaultAuthority: marginVaultAuthorityPDA,
                liquidityVaultAuthority: liquidityVaultAuthorityPDA,
                tokenProgram: TOKEN_PROGRAM_ID,
                systemProgram: SystemProgram.programId,
              })
              .preInstructions([computeBudgetIx])
              .rpc();
          }
          log.info(`[Keeper] Step 2 completed: ${tx2}`);
        } catch (step2Error: any) {
          // Check if error is due to already executed match
          const errorMsg = step2Error?.message || step2Error?.toString() || '';
          const errorCode = step2Error?.error?.errorCode?.code || '';
          
          if (errorCode === 'InvalidOrder' || errorMsg.includes('Bad order') || errorMsg.includes('already executed') || errorMsg.includes('buy_executed')) {
            // This is likely a race condition - buyer side was already executed
            log.info(`[Keeper] Step 2 skipped - buyer side already executed (race condition or corrupted state)`);
            log.info(`[Keeper] Marking buy order as potentially filled in database`);
            
            // Try to mark the buy order as filled in the database
            try {
              const buyOrderRecord = await Order.findOne({
                where: { id: buyOrder.id }
              });
              if (buyOrderRecord) {
                // Check if order is already fully filled
                const currentFilled = buyOrderRecord.getFilledBigInt();
                const orderSize = buyOrderRecord.getSizeBigInt();
                if (currentFilled >= orderSize) {
                  buyOrderRecord.setDataValue('status', 'filled');
                } else {
                  // Mark as partially filled or keep current status
                  buyOrderRecord.setDataValue('status', 'partially_filled');
                }
                await buyOrderRecord.save();
                log.info(`[Keeper] Updated buy order ${buyOrder.id} status in database`);
              }
            } catch (dbError: any) {
              log.warn(`[Keeper] Could not update order in database: ${dbError.message}`);
            }
            
            // Continue to Step 3 (seller side) - don't throw error
            tx2 = 'already-executed';
          } else {
            // Re-throw other errors
            throw step2Error;
          }
        }
      } else {
        tx2 = 'already-executed';
      }

      log.info(`[Keeper] Step 3: Executing seller side`);
      let tx;
      try {
        // CRITICAL: Check match state before executing seller side (with retry to handle race conditions)
        // We check multiple times because another transaction might execute between our check and our execution
        let matchStateCheckAttempts = 0;
        let shouldSkip = false;
        const MAX_CHECK_ATTEMPTS = 5; // Increased retries
        const CHECK_DELAY = 300; // 300ms between checks
        
        while (matchStateCheckAttempts < MAX_CHECK_ATTEMPTS && !shouldSkip) {
          try {
            const matchStateData: any = await (this.program.account as any).matchState.fetch(matchStatePDA);
            
            // Check all execution flags
            if (matchStateData.executed) {
              log.info(`[Keeper] Match already fully executed (executed=true) - skipping Step 3`);
              shouldSkip = true;
              break;
            }
            if (matchStateData.sellExecuted) {
              log.info(`[Keeper] Seller side already executed (sellExecuted=true) - skipping Step 3`);
              shouldSkip = true;
              break;
            }
            if (!matchStateData.buyExecuted) {
              log.info(`[Keeper] Buyer side not executed yet (buyExecuted=false) - skipping Step 3`);
              shouldSkip = true;
              break;
            }
            
            // If we get here, match is ready for seller execution
            // But wait a bit and check again to catch any race conditions
            if (matchStateCheckAttempts < MAX_CHECK_ATTEMPTS - 1) {
              await new Promise(resolve => setTimeout(resolve, CHECK_DELAY));
              matchStateCheckAttempts++;
              log.info(`[Keeper] Re-checking match state (attempt ${matchStateCheckAttempts + 1}/${MAX_CHECK_ATTEMPTS}) to avoid race condition`);
            } else {
              // Final check passed, proceed with execution
              break;
            }
          } catch (matchStateError: any) {
            matchStateCheckAttempts++;
            if (matchStateCheckAttempts < MAX_CHECK_ATTEMPTS) {
              await new Promise(resolve => setTimeout(resolve, CHECK_DELAY));
              log.info(`[Keeper] Retrying match state check (attempt ${matchStateCheckAttempts + 1}/${MAX_CHECK_ATTEMPTS}): ${matchStateError.message}`);
            } else {
              log.warn(`[Keeper] Could not read match state after ${matchStateCheckAttempts} attempts: ${matchStateError.message}`);
              // If we can't read match state, we should skip to avoid errors
              shouldSkip = true;
            }
          }
        }
        
        if (shouldSkip) {
          this.executingMatches.delete(matchKey);
          return {
            success: true, // Already executed is success
            tx: 'already-executed',
          };
        }
        
        // Also check sell order status before executing (final check)
        try {
          const sellOrderOnChainData: any = await (this.program.account as any).pendingOrder.fetch(sellPendingOrderPDA);
          const FILLED_STATUS = 2;
          if (sellOrderOnChainData.status === FILLED_STATUS) {
            log.info(`[Keeper] Sell order already filled on-chain - skipping Step 3`);
            this.executingMatches.delete(matchKey);
            return {
              success: true,
              tx: 'already-executed',
            };
          }
        } catch (orderCheckError: any) {
          log.warn(`[Keeper] Could not check sell order status before Step 3: ${orderCheckError.message}`);
          // Continue with execution - this is a final check, not critical
        }
        
        tx = await this.program.methods
          .executeSellerMatch()
          .accounts({
            market: marketPDA,
            matchState: matchStatePDA,
            sellOrder: sellPendingOrderPDA,
            keeper: this.keeperKeypair.publicKey,
            sellShareEscrowAuthority: sellShareEscrowAuthorityPDA,
            sellShareEscrowYes: sellShareEscrowYesPDA,
            sellShareEscrowNo: sellShareEscrowNoPDA,
            sellUserUsdcAccount: sellUserUsdcATA,
            marketVault: vaultPDA,
            vaultAuthority: vaultAuthorityPDA,
            liquidityVault: liquidityVaultPDA,
            liquidityVaultAuthority: liquidityVaultAuthorityPDA,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        log.info(`[Keeper] Step 3 completed: ${tx}`);
      } catch (step3Error: any) {
        // Check if error is due to already executed match
        const errorMsg = step3Error?.message || step3Error?.toString() || '';
        const errorCode = step3Error?.error?.errorCode?.code || '';
        const errorNumber = step3Error?.error?.errorCode?.number || step3Error?.error?.errorNumber;
        
        // Error 6009 = InvalidOrder, which can mean match already executed
        if (errorCode === 'InvalidOrder' || errorNumber === 6009 || errorMsg.includes('Bad order') || errorMsg.includes('already executed') || errorMsg.includes('executed') || errorMsg.includes('sell_executed')) {
          // This is likely a race condition - match was already executed
          log.info(`[Keeper] Step 3 failed with InvalidOrder (6009) - checking if match was already executed (race condition)`);
          log.info(`[Keeper] Error details: ${errorMsg}`);
          
          // Wait a bit for transaction to confirm, then check match state
          await new Promise(resolve => setTimeout(resolve, 1000));
          
          // Try to read match state to confirm
          try {
            const matchStateData: any = await this.program.account.matchState.fetch(matchStatePDA);
            if (matchStateData.executed || matchStateData.sellExecuted) {
              log.info(`[Keeper] ✓ Confirmed: Match already executed on-chain (race condition handled)`);
              log.info(`[Keeper]   executed: ${matchStateData.executed}, sellExecuted: ${matchStateData.sellExecuted}`);
              this.executingMatches.delete(matchKey);
              return {
                success: true, // Consider this success since match was executed
                tx: 'already-executed',
              };
            } else {
              log.warn(`[Keeper] Match state shows not executed, but got InvalidOrder error`);
              log.warn(`[Keeper]   executed: ${matchStateData.executed}, sellExecuted: ${matchStateData.sellExecuted}, buyExecuted: ${matchStateData.buyExecuted}`);
            }
          } catch (readError: any) {
            log.warn(`[Keeper] Could not confirm match state after error: ${readError.message}`);
          }
          
          // Also check sell order status
          try {
            const sellOrderOnChainData: any = await this.program.account.pendingOrder.fetch(sellPendingOrderPDA);
            const FILLED_STATUS = 2;
            if (sellOrderOnChainData.status === FILLED_STATUS) {
              log.info(`[Keeper] ✓ Confirmed: Sell order already filled on-chain (race condition handled)`);
              this.executingMatches.delete(matchKey);
              return {
                success: true,
                tx: 'already-executed',
              };
            }
          } catch (orderReadError: any) {
            log.warn(`[Keeper] Could not check sell order status: ${orderReadError.message}`);
          }
          
          // If we can't confirm, but error suggests it's already executed, treat as success
          // This prevents false error reporting when match was actually executed by another transaction
          log.info(`[Keeper] Step 3 error (InvalidOrder 6009) suggests match already executed - treating as success`);
          log.info(`[Keeper] This is likely a race condition where another transaction executed first`);
          this.executingMatches.delete(matchKey);
          return {
            success: true,
            tx: 'already-executed',
          };
        }
        
        // Log detailed error for Step 3 (only for non-race-condition errors)
        log.error(`[Keeper] Step 3 error details:`, {
          message: step3Error?.message,
          name: step3Error?.name,
          code: step3Error?.code,
          logs: step3Error?.logs,
          cause: step3Error?.cause,
        });
        // Re-throw to be caught by outer catch block
        throw step3Error;
      }
    


      log.info(`[Keeper] Match execution successful`);
      log.info(`  Transaction: https://solscan.io/tx/${tx}`);
      log.info(`  Match: ${matchKey}, Price: ${matchPrice}bps, Size: ${matchSize.toString()}`);
      log.info(`  Buyer: ${buyUserPubkey.toString().slice(0, 8)}... (YES: ${matchSize.toString()})`);
      log.info(`  Seller: ${sellUserPubkey.toString().slice(0, 8)}... (NO: ${matchSize.toString()})`);

      // Read on-chain match state to confirm actual execution price
      // This ensures DB writes use the exact same price as on-chain position entries
      try {
        const matchStateData: any = await (this.program.account as any).matchState.fetch(matchStatePDA);
        const onChainMatchPrice = matchStateData.matchPrice?.toNumber?.() ?? matchStateData.match_price?.toNumber?.();
        if (onChainMatchPrice && onChainMatchPrice > 0 && onChainMatchPrice !== matchPrice) {
          log.warn(`[Keeper] matchPrice mismatch! Local: ${matchPrice}, On-chain: ${onChainMatchPrice}. Using on-chain value.`);
          matchPrice = onChainMatchPrice;
        }
      } catch (readErr: any) {
        log.warn(`[Keeper] Could not read match state for final price verification: ${readErr.message}`);
      }

      // Update database after successful on-chain execution
      try {
        const buyOrderRecord = await Order.findOne({
          where: { id: buyOrder.id }
        });
        const sellOrderRecord = await Order.findOne({
          where: { id: sellOrder.id }
        });

        if (buyOrderRecord && sellOrderRecord) {
          // Update filled amounts
          const oldBuyFilled = buyOrderRecord.getFilledBigInt();
          const oldSellFilled = sellOrderRecord.getFilledBigInt();
          const buyFilled = oldBuyFilled + matchSize;
          const sellFilled = oldSellFilled + matchSize;

          buyOrderRecord.setDataValue('filled', buyFilled.toString());
          sellOrderRecord.setDataValue('filled', sellFilled.toString());

          // Compute weighted average fill price
          const oldBuyAvg = buyOrderRecord.avgFillPrice || 0;
          const oldSellAvg = sellOrderRecord.avgFillPrice || 0;
          const buyAvgFillPrice = oldBuyFilled > 0n
            ? Math.round((oldBuyAvg * Number(oldBuyFilled) + matchPrice * Number(matchSize)) / Number(buyFilled))
            : matchPrice;
          const sellAvgFillPrice = oldSellFilled > 0n
            ? Math.round((oldSellAvg * Number(oldSellFilled) + matchPrice * Number(matchSize)) / Number(sellFilled))
            : matchPrice;
          buyOrderRecord.avgFillPrice = buyAvgFillPrice;
          sellOrderRecord.avgFillPrice = sellAvgFillPrice;

          // Update status
          if (buyFilled >= buyOrderRecord.getSizeBigInt()) {
            buyOrderRecord.status = 'filled';
          } else if (buyFilled > 0) {
            buyOrderRecord.status = 'partially_filled';
          }

          if (sellFilled >= sellOrderRecord.getSizeBigInt()) {
            sellOrderRecord.status = 'filled';
          } else if (sellFilled > 0) {
            sellOrderRecord.status = 'partially_filled';
          }

          // Save to database
          await buyOrderRecord.save();
          await sellOrderRecord.save();

          log.info(`[Keeper] Database updated: Orders ${buyOrder.id} and ${sellOrder.id} marked as executed`);

          // Mirror the on-chain `market.total_volume += trade_value` into
          // the DB row. The on-chain value increments every match but no
          // backend code was reading it back, so MarketList showed `0`
          // volume forever (which masked us into adding a Math.random()
          // fallback on the frontend — now removed).
          //
          // trade_value formula matches the on-chain math at lib.rs:3329:
          //   trade_value = fill_quantity * match_price / BASIS_POINTS * quote_scale
          // For USDC scale=1; for SPACE scale=1000 (10^(9-6)).
          //
          // total_volume is VARCHAR (BigInt-as-string), so we cast to
          // numeric in SQL to do the arithmetic, then back to text. This
          // keeps the operation atomic and avoids JS Number-precision
          // issues on large totals.
          try {
            const qDec = (marketRecord as any).quoteDecimals ?? 6;
            const quoteScale = BigInt(Math.pow(10, Math.max(0, qDec - 6)));
            const tradeValue =
              (matchSize * BigInt(matchPrice) / 10000n) * quoteScale;
            if (tradeValue > 0n) {
              const { sequelize } = await import('../config/database');
              // The Market model stores volume in a camelCase column
              // (`"totalVolume"`), not `total_volume`. There is no `field`
              // mapping and no `underscored: true` setting, so Sequelize
              // uses the JS field name verbatim as the column name. The
              // double quotes preserve case.
              const [, meta]: any = await sequelize.query(
                `UPDATE markets
                   SET "totalVolume" = (COALESCE(NULLIF("totalVolume", ''), '0')::numeric + :delta)::text
                 WHERE id = :id`,
                {
                  replacements: { delta: tradeValue.toString(), id: marketRecord.id },
                },
              );
              const rowsUpdated = meta?.rowCount ?? 0;
              console.log(
                `[Keeper] Bumped market.totalVolume by ${tradeValue.toString()} (qDec=${qDec}, rows=${rowsUpdated}, marketId=${marketRecord.id})`,
              );
            } else {
              console.log('[Keeper] Skipped totalVolume bump — tradeValue is 0');
            }
          } catch (volErr: any) {
            console.warn('[Keeper] Failed to bump market totalVolume (non-fatal):', volErr?.message || volErr);
          }
          
          // Sync positions to database (for fast position queries)
          try {
            const { PositionService } = await import('./positionService');
            const positionService = new PositionService();
            
            // Update buyer's position in DB by incrementing shares.
            // DO NOT read from on-chain — on-chain accumulates all buys but
            // never subtracts sells, so on-chain shares would be wrong after
            // a buy-sell-buy sequence.
            try {
              const { Position } = await import('../models/Position');
              // Use tokenType-suffixed ID so YES and NO positions get separate DB rows
              const buyTokenType = isNoTrade ? 'no' : 'yes';
              const buyPositionDbId = `${buyPositionPDA.toString()}:${buyTokenType}`;
              const existingBuyPos = await Position.findByPk(buyPositionDbId);

              if (existingBuyPos && existingBuyPos.isOpen && BigInt(existingBuyPos.shares) > 0n) {
                // Position exists and is open — increment shares, update avg entry price
                const oldShares = BigInt(existingBuyPos.shares);
                const newShares = oldShares + matchSize;
                const oldAvg = existingBuyPos.avgEntryPrice || matchPrice;
                const newAvg = Math.round(
                  (oldAvg * Number(oldShares) + matchPrice * Number(matchSize)) / Number(newShares)
                );
                // Recalculate collateral in QUOTE BASE UNITS:
                //   shares(6-dec) * price(bps) / 10000 * quote_scale
                // quote_scale = 10^(quoteDecimals - 6) — 1 for USDC, 1000 for SPACE.
                const leverage = existingBuyPos.leverage || 1;
                const qDec = (marketRecord as any).quoteDecimals ?? 6;
                const quoteScale = Math.pow(10, Math.max(0, qDec - 6));
                const newCollateral = (Number(newShares) * newAvg * quoteScale) / (10000 * leverage);
                const newBorrowed = leverage > 1
                  ? (Number(newShares) * newAvg * quoteScale) / 10000 - newCollateral
                  : 0;

                await Position.update({
                  shares: newShares.toString(),
                  avgEntryPrice: newAvg,
                  collateral: Math.round(newCollateral).toString(),
                  borrowedAmount: Math.round(newBorrowed).toString(),
                  lastUpdated: new Date(),
                }, { where: { id: buyPositionDbId } });

                log.info(`[Keeper] Incremented buyer position ${buyPositionDbId}: shares ${oldShares} -> ${newShares}, avgEntry: ${newAvg}`);
              } else {
                // Position doesn't exist or is closed — create new DB row
                await new Promise(resolve => setTimeout(resolve, 1000));
                const buyPositionAccount = await (this.program.account as any).position.fetch(buyPositionPDA).catch(() => null);

                let finalShares: string;
                let finalAvgEntry: number;
                let posLeverage = buyOrder.leverage || 1;
                let positionTypeValue = buyPositionType;
                let liquidationPrice: number | undefined;

                // Read leverage/positionType/liquidationPrice from on-chain position PDA
                if (buyPositionAccount && buyPositionAccount.shares > 0) {
                  posLeverage = Number(buyPositionAccount.leverage);
                  positionTypeValue = Number((buyPositionAccount as any).positionType ?? buyPositionType);
                  liquidationPrice = (buyPositionAccount as any).liquidationPrice
                    ? Number((buyPositionAccount as any).liquidationPrice)
                    : undefined;
                }

                // Use matchSize — the exact fill quantity for this specific trade.
                // Cannot use position PDA shares (combines YES+NO for binary outcomeId=0).
                // Cannot use SPL token balance (combines spot+leveraged in same ATA).
                // matchSize is always accurate per token type and position type.
                finalShares = matchSize.toString();
                finalAvgEntry = matchPrice;

                // Calculate liquidation price for leveraged positions if not from on-chain
                if (!liquidationPrice && posLeverage > 1) {
                  liquidationPrice = Math.round(finalAvgEntry * (1 - (0.9 / posLeverage)));
                }

                const sharesNum = Number(finalShares);
                // Collateral in QUOTE BASE UNITS (scale by quote_decimals so SPACE,
                // USDC, etc. all store the amount actually transferred to escrow).
                const qDec = (marketRecord as any).quoteDecimals ?? 6;
                const quoteScale = Math.pow(10, Math.max(0, qDec - 6));
                const finalCollateral = Math.round((sharesNum * finalAvgEntry * quoteScale) / (10000 * posLeverage));
                const finalBorrowed = posLeverage > 1
                  ? Math.round((sharesNum * finalAvgEntry * quoteScale) / 10000 - finalCollateral)
                  : 0;

                await positionService.upsertPosition({
                  id: buyPositionDbId,
                  marketAddress: marketPDA.toString(),
                  marketId: marketRecord.marketId || marketRecord.id.toString(),
                  user: buyOrder.userId,
                  outcomeId: buyOrder.outcomeId,
                  side: 0,
                  positionType: positionTypeValue,
                  shares: finalShares,
                  avgEntryPrice: finalAvgEntry,
                  leverage: posLeverage,
                  collateral: finalCollateral.toString(),
                  borrowedAmount: finalBorrowed.toString(),
                  liquidationPrice,
                  isOpen: true,
                  tokenType: buyTokenType,
                });
                log.info(`[Keeper] Created buyer position ${buyPositionDbId}: shares=${finalShares}, avgEntry=${finalAvgEntry}, leverage=${posLeverage}, posType=${positionTypeValue}, tokenType=${buyTokenType}${existingBuyPos && !existingBuyPos.isOpen ? ' (reopened)' : ''}`);
              }
            } catch (buyPosError: any) {
              log.warn(`[Keeper] Failed to sync buyer position: ${buyPosError.message}`);
            }

          } catch (positionSyncError: any) {
            log.warn(`[Keeper] Failed to sync positions: ${positionSyncError.message}`);
            // Non-critical - positions will be synced on next fetch
          }

          // After a sell order fills, reduce/close the seller's existing position in DB.
          // The on-chain match uses a separate PDA and does NOT update the seller's
          // original position account, so we must do it here.
          try {
            const { Position } = await import('../models/Position');

            // Determine which position type the sell order belongs to.
            // Leverage > 1 means it's a leveraged position being closed;
            // leverage === 1 means it's a spot position being sold.
            const sellLeverage = sellOrder.leverage || 1;
            const sellPositionType = sellLeverage === 1 ? 0 : 1; // 0 = Spot, 1 = Leveraged

            // Find seller's open BUY (side=0) positions for this market/outcome
            // FILTERED by positionType so closing a leveraged position doesn't
            // accidentally drain the spot position (or vice-versa).
            // Also filter by tokenType so selling YES doesn't reduce a NO position.
            const sellTokenType = isNoTrade ? 'no' : 'yes';
            const sellerPositions = await Position.findAll({
              where: {
                user: sellOrder.userId,
                marketAddress: marketPDA.toString(),
                outcomeId: sellOrder.outcomeId,
                side: 0, // Only LONG/buy positions
                positionType: sellPositionType,
                tokenType: sellTokenType,
                isOpen: true,
              },
            });

            log.info(`[Keeper] Sell filled: checking ${sellerPositions.length} open ${sellPositionType === 0 ? 'spot' : 'leveraged'} position(s) for seller ${sellOrder.userId.slice(0, 8)}... on market ${sellOrder.marketId} outcome ${sellOrder.outcomeId}`);

            let remaining = matchSize;
            for (const pos of sellerPositions) {
              if (remaining <= 0n) break;
              const posShares = BigInt(pos.shares);
              if (posShares <= 0n) continue;

              const reduction = posShares < remaining ? posShares : remaining;
              const newShares = posShares - reduction;
              remaining -= reduction;

              if (newShares <= 0n) {
                log.info(`[Keeper] Closing seller position ${pos.id} (sold ${reduction.toString()} of ${posShares.toString()} shares)`);
                await Position.update(
                  { shares: '0', isOpen: false },
                  { where: { id: pos.id } }
                );
              } else {
                log.info(`[Keeper] Reducing seller position ${pos.id} from ${posShares.toString()} to ${newShares.toString()} shares`);
                await Position.update(
                  { shares: newShares.toString() },
                  { where: { id: pos.id } }
                );
              }
            }
          } catch (sellPosError: any) {
            log.warn(`[Keeper] Failed to update seller position after sell: ${sellPosError.message}`);
          }

          // Increment trade count and award points for both users
          try {
            await Promise.all([
              referralService.incrementTradeCount(buyOrder.userId),
              referralService.incrementTradeCount(sellOrder.userId),
            ]);
            log.info(`[Keeper] Trade count incremented for ${buyOrder.userId} and ${sellOrder.userId}`);

            // Award points based on order type (standard vs leverage)
            const awardTradePoints = async (order: any) => {
              if (order.leverage && order.leverage > 1) {
                await referralService.addLeverageTradePoints(order.userId);
              } else if (order.type === 'limit') {
                await referralService.addLimitOrderPoints(order.userId);
              } else {
                await referralService.addStandardTradePoints(order.userId);
              }
            };

            await Promise.all([
              awardTradePoints(buyOrder),
              awardTradePoints(sellOrder),
            ]);
            log.info(`[Keeper] Trade points awarded for ${buyOrder.userId} and ${sellOrder.userId}`);

            // Credit referrers if this was either trader's first filled trade.
            // The service is idempotent (atomic pending→completed claim), so safe to call every fill.
            await Promise.all([
              referralService.creditReferrerOnFirstTrade(buyOrder.userId),
              referralService.creditReferrerOnFirstTrade(sellOrder.userId),
            ]);
          } catch (tradeCountError: any) {
            log.warn(`[Keeper] Failed to increment trade count or award points: ${tradeCountError.message}`);
            // Non-critical - don't fail the transaction
          }
          
          // Emit WebSocket events for orderbook update and trade
          try {
            const orderBookService = new OrderBookService();
            const orderBook = await orderBookService.getOrderBook(buyOrder.marketId, buyOrder.outcomeId, 20);
            wsEventEmitter.emit('orderbook_update', {
              marketId: buyOrder.marketId,
              outcomeId: buyOrder.outcomeId,
              orderBook,
            });
            
            // Emit trade event
            wsEventEmitter.emit('trade', {
              marketId: buyOrder.marketId,
              outcomeId: buyOrder.outcomeId,
              side: 'buy',
              price: matchPrice,
              size: Number(matchSize),
              timestamp: new Date().toISOString(),
            });

            // Emit user-specific order update events (for real-time UI updates)
            wsEventEmitter.emit('user_order_update', {
              userId: buyOrder.userId,
              orderId: buyOrder.id,
              status: buyOrderRecord.status,
              filledSize: buyOrderRecord.filled,
              avgFillPrice: buyOrderRecord.avgFillPrice,
            });
            wsEventEmitter.emit('user_order_update', {
              userId: sellOrder.userId,
              orderId: sellOrder.id,
              status: sellOrderRecord.status,
              filledSize: sellOrderRecord.filled,
              avgFillPrice: sellOrderRecord.avgFillPrice,
            });

            // Emit user-specific position update events (triggers frontend refetch)
            wsEventEmitter.emit('user_position_update', {
              userId: buyOrder.userId,
              marketId: buyOrder.marketId,
            });
            wsEventEmitter.emit('user_position_update', {
              userId: sellOrder.userId,
              marketId: sellOrder.marketId,
            });
          } catch (wsError) {
            // Silently fail - WebSocket updates are best-effort
          }
        }
      } catch (dbError: any) {
        log.error(`[Keeper] Failed to update database: ${dbError.message}`);
        // Don't fail the transaction - on-chain execution succeeded
      }

      return {
        success: true,
        tx,
      };
    } catch (error: any) {
      log.error(`[Keeper] Execution failed: ${matchKey}`);
      log.error(`  Buy Order: ${buyOrder.id}, Sell Order: ${sellOrder.id}`);
      log.error(`  Error: ${error.message || error}`);
      log.error(`  Error details:`, {
        name: error?.name,
        code: error?.code,
        cause: error?.cause,
        stack: error?.stack?.split('\n').slice(0, 5), // First 5 lines of stack
      });
      if (error.logs) {
        log.error(`  Program logs:`);
        error.logs.forEach((logLine: string) => {
          log.error(`    ${logLine}`);
        });
      }
      // Check if this is an Anchor error with more details
      if (error.error) {
        log.error(`  Anchor error:`, error.error);
      }
      if (error.errorCode) {
        log.error(`  Error code:`, error.errorCode);
      }
      return {
        success: false,
        error: error.message || 'Execution failed',
      };
    } finally {
      this.executingMatches.delete(matchKey);
    }
  }
}

