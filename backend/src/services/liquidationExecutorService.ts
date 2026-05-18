import { Connection, PublicKey, Keypair, Transaction, SystemProgram, ComputeBudgetProgram } from '@solana/web3.js';
import { AnchorProvider, BN, Program, Wallet } from '@coral-xyz/anchor';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { PositionService, PositionData } from './positionService';
import { Market } from '../models/Market';
import { wsEventEmitter } from '../websocket/server';
import { loadIDL } from '../utils/idl-loader';
import {
  getMarketVaultPDA,
  getVaultAuthorityPDA,
  getPositionPDA,
  getInsuranceFundPDA,
  getInsuranceVaultPDA,
} from '../utils/solana';

/**
 * SCALABLE LIQUIDATION SYSTEM FOR THOUSANDS OF MARKETS
 * 
 * ARCHITECTURE:
 * - Multiple liquidator keypairs (pool) for load distribution
 * - Market sharding: Each market assigned to a specific liquidator
 * - Priority queue: Urgent liquidations processed first
 * - Concurrent execution: Multiple liquidations in parallel
 * - Rate limiting: Per-liquidator to avoid RPC throttling
 * 
 * SCALING STRATEGY:
 * 1. Use multiple liquidator keypairs (e.g., 10-50 keypairs)
 * 2. Hash market ID to assign to liquidator (consistent sharding)
 * 3. Each liquidator handles ~100-1000 markets
 * 4. Parallel processing within each liquidator's markets
 * 5. Priority queue for urgent liquidations (equity < 5%)
 * 
 * EXAMPLE: 10,000 markets, 20 liquidators
 * - Each liquidator handles ~500 markets
 * - Check 50 markets per second per liquidator
 * - Total: 1000 markets checked per second
 * - Full cycle: 10 seconds for all markets
 */

interface LiquidatorPool {
  keypair: Keypair;
  program: any; // Program<any> causes type issues, use any for now
  assignedMarkets: Set<string>; // Market IDs assigned to this liquidator
  activeLiquidations: Set<string>; // Position PDAs being liquidated
  lastActivity: Date;
  totalLiquidations: number;
  totalRewards: number;
}

interface LiquidationTask {
  marketPDA: PublicKey;
  positionPDA: PublicKey;
  userId?: string;
  priority: number; // Higher = more urgent (based on equity ratio)
  timestamp: Date;
}

export class LiquidationExecutorService {
  private connection: Connection;
  private positionService: PositionService;
  private liquidatorPool: LiquidatorPool[] = [];
  private liquidationQueue: LiquidationTask[] = [];
  private executionInterval: NodeJS.Timeout | null = null;
  private processedPositions: Map<string, { lastChecked: Date; wasLiquidatable: boolean }> = new Map();
  
  // Configuration
  private readonly MAX_LIQUIDATORS = parseInt(process.env.MAX_LIQUIDATORS || '10');
  private readonly MAX_CONCURRENT_PER_LIQUIDATOR = 5;
  private readonly MAX_LIQUIDATIONS_PER_BATCH = 50;
  private readonly MIN_TIME_BETWEEN_CHECKS = 1000; // 1 second
  private readonly PRIORITY_THRESHOLD = 0.05; // 5% equity = high priority
  private lastCheckTime: number = 0;

  constructor() {
    this.connection = new Connection(
      process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
      {
        commitment: 'confirmed',
        wsEndpoint: process.env.SOLANA_WS_URL,
        confirmTransactionInitialTimeout: 60000,
      }
    );
    this.positionService = new PositionService();
  }

  /**
   * Initialize liquidator pool from environment
   * Supports multiple keypairs: LIQUIDATOR_KEYPAIR_0, LIQUIDATOR_KEYPAIR_1, etc.
   * Or single keypair: LIQUIDATOR_KEYPAIR (for backward compatibility)
   */
  async initialize(): Promise<boolean> {
    const liquidatorKeypairs: Keypair[] = [];

    // Try to load multiple liquidator keypairs
    for (let i = 0; i < this.MAX_LIQUIDATORS; i++) {
      const envKey = i === 0 ? 'LIQUIDATOR_KEYPAIR' : `LIQUIDATOR_KEYPAIR_${i}`;
      const keypairStr = process.env[envKey];
      
      if (keypairStr) {
        try {
          const keypairArray = JSON.parse(keypairStr);
          const keypair = Keypair.fromSecretKey(Uint8Array.from(keypairArray));
          liquidatorKeypairs.push(keypair);
          console.log(`[LiquidationExecutor] Loaded liquidator ${i} keypair`);
        } catch (e) {
          console.warn(`[LiquidationExecutor] Failed to load liquidator ${i}:`, e);
        }
      }
    }

    if (liquidatorKeypairs.length === 0) {
      console.warn('[LiquidationExecutor] No liquidator keypairs found');
      console.warn('[LiquidationExecutor] Set LIQUIDATOR_KEYPAIR or LIQUIDATOR_KEYPAIR_0, LIQUIDATOR_KEYPAIR_1, etc.');
      return false;
    }

    // Initialize each liquidator
    const idl = await loadIDL();
    for (let i = 0; i < liquidatorKeypairs.length; i++) {
      const keypair = liquidatorKeypairs[i];
      try {
        const provider = new AnchorProvider(
          this.connection,
          new Wallet(keypair),
          { commitment: 'confirmed' }
        );
        // Anchor 0.31+ requires: new Program(idl, provider)
        // Program ID is extracted from IDL.address
        const program = new Program(idl, provider);
        
        this.liquidatorPool.push({
          keypair,
          program,
          assignedMarkets: new Set(),
          activeLiquidations: new Set(),
          lastActivity: new Date(),
          totalLiquidations: 0,
          totalRewards: 0,
        });
        
        console.log(`[LiquidationExecutor] Initialized liquidator ${i} (${keypair.publicKey.toString().slice(0, 8)}...)`);
      } catch (error: any) {
        console.error(`[LiquidationExecutor] Failed to initialize liquidator ${i}:`, error.message);
      }
    }

    if (this.liquidatorPool.length === 0) {
      console.error('[LiquidationExecutor] No liquidators initialized');
      return false;
    }

    console.log(`[LiquidationExecutor] Initialized ${this.liquidatorPool.length} liquidators`);
    return true;
  }

  /**
   * Assign markets to liquidators using consistent hashing
   * This ensures each market is always assigned to the same liquidator
   */
  private assignMarketToLiquidator(marketId: string): LiquidatorPool {
    // Simple hash-based assignment for consistent sharding
    let hash = 0;
    for (let i = 0; i < marketId.length; i++) {
      hash = ((hash << 5) - hash) + marketId.charCodeAt(i);
      hash = hash & hash; // Convert to 32-bit integer
    }
    const index = Math.abs(hash) % this.liquidatorPool.length;
    const liquidator = this.liquidatorPool[index];
    liquidator.assignedMarkets.add(marketId);
    return liquidator;
  }

  /**
   * Start monitoring and executing liquidations
   */
  startMonitoring(intervalMs: number = 5000) {
    if (this.executionInterval) {
      clearInterval(this.executionInterval);
    }

    if (this.liquidatorPool.length === 0) {
      console.warn('[LiquidationExecutor] Cannot start monitoring - no liquidators initialized');
      return;
    }

    // Process liquidation queue
    const queueInterval = setInterval(async () => {
      try {
        await this.processLiquidationQueue();
      } catch (error) {
        console.error('[LiquidationExecutor] Error processing queue:', error);
      }
    }, 1000); // Process queue every second

    // Check for new liquidatable positions
    this.executionInterval = setInterval(async () => {
      try {
        await this.checkAndQueueLiquidations();
      } catch (error) {
        console.error('[LiquidationExecutor] Error in monitoring loop:', error);
      }
    }, intervalMs);

    console.log(`[LiquidationExecutor] Started monitoring with ${this.liquidatorPool.length} liquidators (interval: ${intervalMs}ms)`);
  }

  /**
   * Stop monitoring
   */
  stopMonitoring() {
    if (this.executionInterval) {
      clearInterval(this.executionInterval);
      this.executionInterval = null;
      console.log('[LiquidationExecutor] Stopped monitoring');
    }
  }

  /**
   * Check all markets for liquidatable positions and add to queue
   */
  private async checkAndQueueLiquidations() {
    const now = Date.now();
    if (now - this.lastCheckTime < this.MIN_TIME_BETWEEN_CHECKS) {
      return;
    }
    this.lastCheckTime = now;

    try {
      const markets = await Market.findAll({
        where: { status: 0 }, // Active markets
      });

      if (markets.length === 0) {
        return;
      }

      // Distribute markets across liquidators
      const marketsByLiquidator = new Map<number, Market[]>();
      for (const market of markets) {
        const liquidator = this.assignMarketToLiquidator(market.id.toString());
        const index = this.liquidatorPool.indexOf(liquidator);
        if (!marketsByLiquidator.has(index)) {
          marketsByLiquidator.set(index, []);
        }
        marketsByLiquidator.get(index)!.push(market);
      }

      // Check markets in parallel (per liquidator)
      const checkPromises: Promise<void>[] = [];
      for (const [liquidatorIndex, marketList] of marketsByLiquidator.entries()) {
        // Process markets in batches to avoid overwhelming RPC
        const batchSize = 10;
        for (let i = 0; i < marketList.length; i += batchSize) {
          const batch = marketList.slice(i, i + batchSize);
          checkPromises.push(
            this.checkMarketsForLiquidations(batch, liquidatorIndex)
          );
        }
      }

      await Promise.all(checkPromises);
    } catch (error: any) {
      console.error('[LiquidationExecutor] Error checking liquidations:', error.message);
    }
  }

  /**
   * Check a batch of markets for liquidatable positions
   */
  private async checkMarketsForLiquidations(markets: Market[], liquidatorIndex: number) {
    // TODO: Implement position discovery
    // For now, this is a placeholder
    // In production, query positions from database:
    // SELECT * FROM positions WHERE marketId IN (...) AND leverage > 1 AND isLiquidatable = true
    
    // Example implementation:
    // const positions = await Position.findAll({ where: { marketId: { [Op.in]: markets.map(m => m.id) } } });
    // for (const position of positions) {
    //   const status = await this.checkPositionLiquidationStatus(...);
    //   if (status.isLiquidatable) {
    //     this.queueLiquidation(position, status, liquidatorIndex);
    //   }
    // }
  }

  /**
   * Add liquidation to priority queue
   */
  private queueLiquidation(
    marketPDA: PublicKey,
    positionPDA: PublicKey,
    priority: number,
    userId?: string,
    liquidatorIndex?: number
  ) {
    // Remove duplicate if exists
    this.liquidationQueue = this.liquidationQueue.filter(
      task => task.positionPDA.toString() !== positionPDA.toString()
    );

    this.liquidationQueue.push({
      marketPDA,
      positionPDA,
      userId,
      priority,
      timestamp: new Date(),
    });

    // Sort by priority (highest first)
    this.liquidationQueue.sort((a, b) => b.priority - a.priority);
  }

  /**
   * Process liquidation queue - execute liquidations in priority order
   */
  private async processLiquidationQueue() {
    if (this.liquidationQueue.length === 0) {
      return;
    }

    // Distribute tasks across liquidators
    const tasksByLiquidator = new Map<number, LiquidationTask[]>();
    
    for (const task of this.liquidationQueue.slice(0, this.MAX_LIQUIDATIONS_PER_BATCH)) {
      // Assign to liquidator based on market (consistent hashing)
      const marketId = task.marketPDA.toString();
      const liquidator = this.assignMarketToLiquidator(marketId);
      const index = this.liquidatorPool.indexOf(liquidator);
      
      if (!tasksByLiquidator.has(index)) {
        tasksByLiquidator.set(index, []);
      }
      tasksByLiquidator.get(index)!.push(task);
    }

    // Execute liquidations in parallel (per liquidator, with concurrency limit)
    const executionPromises: Promise<void>[] = [];
    for (const [liquidatorIndex, tasks] of tasksByLiquidator.entries()) {
      const liquidator = this.liquidatorPool[liquidatorIndex];
      
      // Limit concurrent liquidations per liquidator
      const concurrentTasks = tasks.slice(0, this.MAX_CONCURRENT_PER_LIQUIDATOR);
      for (const task of concurrentTasks) {
        executionPromises.push(
          this.executeLiquidationWithLiquidator(
            task,
            liquidator,
            liquidatorIndex
          ).then(() => {
            // Remove from queue after execution
            this.liquidationQueue = this.liquidationQueue.filter(
              t => t.positionPDA.toString() !== task.positionPDA.toString()
            );
          })
        );
      }
    }

    await Promise.allSettled(executionPromises);
  }

  /**
   * Execute liquidation with a specific liquidator
   */
  private async executeLiquidationWithLiquidator(
    task: LiquidationTask,
    liquidator: LiquidatorPool,
    liquidatorIndex: number
  ): Promise<void> {
    const positionKey = task.positionPDA.toString();
    
    if (liquidator.activeLiquidations.has(positionKey)) {
      return; // Already being liquidated
    }

    liquidator.activeLiquidations.add(positionKey);
    liquidator.lastActivity = new Date();

    try {
      const result = await this.executeLiquidation(
        task.marketPDA,
        task.positionPDA,
        task.userId,
        liquidator
      );

      if (result.success) {
        liquidator.totalLiquidations++;
        if (result.reward) {
          liquidator.totalRewards += result.reward;
        }
        console.log(`[LiquidationExecutor] Liquidator ${liquidatorIndex} executed liquidation: ${result.tx}`);
      }
    } catch (error: any) {
      console.error(`[LiquidationExecutor] Liquidator ${liquidatorIndex} failed:`, error.message);
    } finally {
      liquidator.activeLiquidations.delete(positionKey);
    }
  }

  /**
   * Ensure liquidator's USDC token account exists, create if needed
   */
  private async ensureLiquidatorTokenAccount(
    liquidator: LiquidatorPool,
    usdcMint: PublicKey
  ): Promise<PublicKey> {
    const liquidatorUsdcATA = await getAssociatedTokenAddress(
      usdcMint,
      liquidator.keypair.publicKey
    );

    // Check if account exists
    const account = await this.connection.getAccountInfo(liquidatorUsdcATA);
    if (account === null) {
      console.log(`[LiquidationExecutor] Creating liquidator USDC token account: ${liquidatorUsdcATA.toString()}`);
      
      const ix = createAssociatedTokenAccountInstruction(
        liquidator.keypair.publicKey, // payer
        liquidatorUsdcATA,            // ata address
        liquidator.keypair.publicKey, // owner
        usdcMint,                     // mint
        TOKEN_PROGRAM_ID,
        ASSOCIATED_TOKEN_PROGRAM_ID
      );
      
      const tx = new Transaction().add(ix);
      tx.feePayer = liquidator.keypair.publicKey;
      const { blockhash } = await this.connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.sign(liquidator.keypair);
      
      const sig = await this.connection.sendRawTransaction(tx.serialize());
      await this.connection.confirmTransaction(sig, 'confirmed');
      console.log(`[LiquidationExecutor] Liquidator USDC token account created: ${liquidatorUsdcATA.toString()}`);
    }

    return liquidatorUsdcATA;
  }

  /**
   * Execute liquidation for a specific position
   */
  async executeLiquidation(
    marketPDA: PublicKey,
    positionPDA: PublicKey,
    userId?: string,
    liquidator?: LiquidatorPool
  ): Promise<{ success: boolean; tx?: string; reward?: number; error?: string }> {
    // Use provided liquidator or assign one
    if (!liquidator) {
      const marketId = marketPDA.toString();
      liquidator = this.assignMarketToLiquidator(marketId);
    }

    if (!liquidator.program || !liquidator.keypair) {
      return {
        success: false,
        error: 'Liquidator not initialized',
      };
    }

    const positionKey = positionPDA.toString();
    
    if (liquidator.activeLiquidations.has(positionKey)) {
      return {
        success: false,
        error: 'Liquidation already in progress',
      };
    }

    liquidator.activeLiquidations.add(positionKey);

    try {
      // Verify position is liquidatable on-chain
      const positionData: any = await (liquidator.program.account as any).position.fetch(positionPDA);
      const marketData: any = await (liquidator.program.account as any).market.fetch(marketPDA);
      const currentPrice = marketData.outcomes[positionData.outcomeId].lastPrice;
      const positionValue = (positionData.shares * currentPrice) / 10000;
      const entryValue = (positionData.shares * positionData.avgEntryPrice) / 10000;
      
      const pnl = positionData.side === 0
        ? positionValue - entryValue
        : entryValue - positionValue;
      const equity = Math.max(0, Number(positionData.collateral) + pnl);
      const maintenanceRequirement = (positionValue * 1000) / 10000; // 10%

      // Log detailed position information
      console.log(`[LiquidationExecutor] Position Details:`);
      console.log(`  Position: ${positionPDA.toString()}`);
      console.log(`  User: ${positionData.user.toString()}`);
      console.log(`  Market: ${marketPDA.toString()}`);
      const outcomeLabel = marketData?.outcomes?.[positionData.outcomeId]?.label || `Outcome ${positionData.outcomeId}`;
      console.log(`  Outcome ID: ${positionData.outcomeId} (${outcomeLabel})`);
      console.log(`  Side: ${positionData.side === 0 ? 'LONG' : 'SHORT'}`);
      console.log(`  Leverage: ${positionData.leverage}x`);
      console.log(`  Shares: ${positionData.shares.toString()} (${(Number(positionData.shares) / 1e6).toFixed(6)})`);
      console.log(`  Collateral: ${positionData.collateral.toString()} lamports (${(Number(positionData.collateral) / 1e6).toFixed(6)} USDC)`);
      console.log(`  Borrowed Amount: ${positionData.borrowedAmount.toString()} lamports (${(Number(positionData.borrowedAmount) / 1e6).toFixed(6)} USDC)`);
      console.log(`  Entry Price: ${positionData.avgEntryPrice} bps (${(positionData.avgEntryPrice / 100).toFixed(2)}%)`);
      console.log(`  Current Price: ${currentPrice} bps (${(currentPrice / 100).toFixed(2)}%)`);
      console.log(`  Entry Value: ${(entryValue / 1e6).toFixed(6)} USDC`);
      console.log(`  Position Value: ${(positionValue / 1e6).toFixed(6)} USDC`);
      console.log(`  PnL: ${(pnl / 1e6).toFixed(6)} USDC (${entryValue > 0 ? ((pnl / entryValue) * 100).toFixed(2) : '0.00'}%)`);
      console.log(`  Equity: ${(equity / 1e6).toFixed(6)} USDC`);
      console.log(`  Maintenance Requirement: ${(maintenanceRequirement / 1e6).toFixed(6)} USDC (10%)`);
      console.log(`  Equity Ratio: ${positionValue > 0 ? ((equity / positionValue) * 100).toFixed(2) : '0.00'}%`);
      console.log(`  Is Liquidatable: ${equity < maintenanceRequirement ? 'YES' : 'NO'}`);

      if (equity >= maintenanceRequirement) {
        liquidator.activeLiquidations.delete(positionKey);
        return {
          success: false,
          error: `Position is not liquidatable. Equity (${(equity / 1e6).toFixed(6)} USDC) >= Maintenance (${(maintenanceRequirement / 1e6).toFixed(6)} USDC)`,
        };
      }

      // Get required PDAs
      const [vaultPDA] = await getMarketVaultPDA(marketPDA);
      const [vaultAuthorityPDA] = await getVaultAuthorityPDA(marketPDA);
      const [insuranceFundPDA] = await getInsuranceFundPDA();
      const [insuranceVaultPDA] = await getInsuranceVaultPDA();
      // Use the market's own quote mint (SPACE for SPACE markets, USDC for
      // USDC markets). Hardcoding USDC causes SPL-Token 0x3 on payout for
      // non-USDC markets since market_vault and liquidator ATA mints differ.
      const fallbackUsdc = new PublicKey(process.env.USDC_MINT || 'CqdmbJnQxMNNTGZzsBhEPTSzH52Pwa5DRvpVjZ2Us92t');
      const marketQuoteMint: PublicKey = (marketData?.quoteMint && !(marketData.quoteMint as PublicKey).equals(PublicKey.default))
        ? (marketData.quoteMint as PublicKey)
        : fallbackUsdc;

      // Ensure liquidator's reward ATA exists in the market's quote token
      const liquidatorUsdcATA = await this.ensureLiquidatorTokenAccount(liquidator, marketQuoteMint);

      // Build liquidation transaction
      const tx = await liquidator.program.methods
        .liquidatePosition()
        .accounts({
          market: marketPDA,
          position: positionPDA,
          insuranceFund: insuranceFundPDA,
          insuranceVault: insuranceVaultPDA,
          marketVault: vaultPDA,
          vaultAuthority: vaultAuthorityPDA,
          liquidatorUsdc: liquidatorUsdcATA,
          liquidator: liquidator.keypair.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      // Calculate reward (5% of liquidation value)
      const liquidationAmount = (positionData.shares * 2500) / 10000; // 25% of position
      const liquidationValue = (liquidationAmount * currentPrice) / 10000;
      const reward = (liquidationValue * 500) / 10000; // 5%
      const insurancePenalty = (liquidationValue * 500) / 10000; // 5%

      console.log(`[LiquidationExecutor] ✓ Liquidation executed successfully!`);
      console.log(`  Transaction: ${tx}`);
      console.log(`  Position: ${positionPDA.toString()}`);
      console.log(`  Market: ${marketPDA.toString()}`);
      console.log(`  Liquidator: ${liquidator.keypair.publicKey.toString().slice(0, 8)}...`);
      if (userId) {
        console.log(`  User: ${userId}`);
      }
      console.log(`  Liquidation Amount: ${liquidationAmount.toString()} shares (${(Number(liquidationAmount) / 1e6).toFixed(6)}) - 25% of position)`);
      console.log(`  Liquidation Value: ${(liquidationValue / 1e6).toFixed(6)} USDC`);
      console.log(`  Liquidator Reward: ${(reward / 1e6).toFixed(6)} USDC (5%)`);
      console.log(`  Insurance Fund: ${(insurancePenalty / 1e6).toFixed(6)} USDC (5%)`);
      console.log(`  Remaining Position: ${(positionData.shares - liquidationAmount).toString()} shares (75% remaining)`);

      // Emit WebSocket event
      wsEventEmitter.emit('liquidation_executed', {
        marketId: marketPDA.toString(),
        positionId: positionPDA.toString(),
        userId: userId || 'unknown',
        liquidator: liquidator.keypair.publicKey.toString(),
        tx,
        reward,
        timestamp: new Date().toISOString(),
      });

      liquidator.activeLiquidations.delete(positionKey);
      return {
        success: true,
        tx,
        reward,
      };
    } catch (error: any) {
      console.error(`[LiquidationExecutor] Liquidation failed:`, error);
      liquidator.activeLiquidations.delete(positionKey);
      
      if (error.message?.includes('not liquidatable') || 
          error.message?.includes('PositionNotLiquidatable')) {
        return {
          success: false,
          error: 'Position is not liquidatable',
        };
      }

      return {
        success: false,
        error: error.message || 'Unknown error',
      };
    }
  }

  /**
   * Check if a specific position is liquidatable
   */
  async checkPositionLiquidationStatus(
    marketPDA: PublicKey,
    positionPDA: PublicKey
  ): Promise<{ isLiquidatable: boolean; equity: number; maintenanceRequirement: number; priority: number; reason?: string }> {
    if (this.liquidatorPool.length === 0) {
      return {
        isLiquidatable: false,
        equity: 0,
        maintenanceRequirement: 0,
        priority: 0,
        reason: 'Service not initialized',
      };
    }

    // Use first available liquidator for read operations
    const liquidator = this.liquidatorPool[0];

    try {
      const positionData: any = await (liquidator.program.account as any).position.fetch(positionPDA);
      const marketData: any = await (liquidator.program.account as any).market.fetch(marketPDA);
      
      const currentPrice = marketData.outcomes[positionData.outcomeId].lastPrice;
      const positionValue = (positionData.shares * currentPrice) / 10000;
      const entryValue = (positionData.shares * positionData.avgEntryPrice) / 10000;
      
      const pnl = positionData.side === 0
        ? positionValue - entryValue
        : entryValue - positionValue;
      const equity = Math.max(0, Number(positionData.collateral) + pnl);
      const maintenanceRequirement = (positionValue * 1000) / 10000; // 10%

      const isLiquidatable = equity < maintenanceRequirement;
      
      // Calculate priority: lower equity ratio = higher priority
      const equityRatio = positionValue > 0 ? equity / positionValue : 0;
      const priority = isLiquidatable ? Math.max(0, 1000 - Math.floor(equityRatio * 1000)) : 0;

      // Log position details for testing
      console.log(`[LiquidationExecutor] Position Status Check:`);
      console.log(`  Position: ${positionPDA.toString()}`);
      console.log(`  User: ${positionData.user.toString()}`);
      console.log(`  Shares: ${positionData.shares.toString()} (${(Number(positionData.shares) / 1e6).toFixed(6)})`);
      console.log(`  Collateral: ${(Number(positionData.collateral) / 1e6).toFixed(6)} USDC`);
      console.log(`  Borrowed: ${(Number(positionData.borrowedAmount) / 1e6).toFixed(6)} USDC`);
      console.log(`  Leverage: ${positionData.leverage}x`);
      console.log(`  Entry Price: ${positionData.avgEntryPrice} bps (${(positionData.avgEntryPrice / 100).toFixed(2)}%)`);
      console.log(`  Current Price: ${currentPrice} bps (${(currentPrice / 100).toFixed(2)}%)`);
      console.log(`  Position Value: ${(positionValue / 1e6).toFixed(6)} USDC`);
      console.log(`  PnL: ${(pnl / 1e6).toFixed(6)} USDC`);
      console.log(`  Equity: ${(equity / 1e6).toFixed(6)} USDC`);
      console.log(`  Maintenance Requirement: ${(maintenanceRequirement / 1e6).toFixed(6)} USDC (10%)`);
      console.log(`  Equity Ratio: ${(equityRatio * 100).toFixed(2)}%`);
      console.log(`  Is Liquidatable: ${isLiquidatable ? 'YES ✓' : 'NO ✗'}`);
      console.log(`  Priority: ${priority}`);

      return {
        isLiquidatable,
        equity,
        maintenanceRequirement,
        priority,
        reason: isLiquidatable 
          ? `Equity (${(equity / 1e6).toFixed(6)} USDC) < Maintenance (${(maintenanceRequirement / 1e6).toFixed(6)} USDC)`
          : `Position is healthy. Equity (${(equity / 1e6).toFixed(6)} USDC) >= Maintenance (${(maintenanceRequirement / 1e6).toFixed(6)} USDC)`,
      };
    } catch (error: any) {
      return {
        isLiquidatable: false,
        equity: 0,
        maintenanceRequirement: 0,
        priority: 0,
        reason: `Error: ${error.message}`,
      };
    }
  }

  /**
   * Get liquidator pool statistics
   */
  getStats() {
    return {
      totalLiquidators: this.liquidatorPool.length,
      queueSize: this.liquidationQueue.length,
      liquidators: this.liquidatorPool.map((l, i) => ({
        index: i,
        publicKey: l.keypair.publicKey.toString().slice(0, 8) + '...',
        assignedMarkets: l.assignedMarkets.size,
        activeLiquidations: l.activeLiquidations.size,
        totalLiquidations: l.totalLiquidations,
        totalRewards: l.totalRewards,
        lastActivity: l.lastActivity,
      })),
    };
  }
}
