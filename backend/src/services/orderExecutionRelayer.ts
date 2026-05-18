import { Connection, Keypair, PublicKey, Transaction } from '@solana/web3.js';
import { AnchorProvider, BN, Program, Wallet } from '@coral-xyz/anchor';
import { Order } from '../models/Order';
import { OrderBookService } from './orderBookService';
import { getAssociatedTokenAddress, TOKEN_PROGRAM_ID } from '@solana/spl-token';
import { SystemProgram, SYSVAR_CLOCK_PUBKEY } from '@solana/web3.js';
import { loadIDL } from '../utils/idl-loader';
import {
  SPACE_CORE_PROGRAM_ID,
  USDC_MINT,
  getMarketPDA,
  getMarketVaultPDA,
  getVaultAuthorityPDA,
  getMarginAccountPDA,
  getPositionPDA,
  getConfigPDA,
} from '../utils/solana';

interface MatchExecutionResult {
  success: boolean;
  buyOrderId: string;
  sellOrderId: string;
  buyTx?: string;
  sellTx?: string;
  error?: string;
}

/**
 * Relayer service that automatically executes matched orders on-chain
 * This service monitors matched orders and executes settleTrade for both parties
 */
export class OrderExecutionRelayer {
  private connection: Connection;
  private orderBookService: OrderBookService;
  private program: Program<any> | null = null;
  private relayerKeypair: Keypair | null = null;
  private executionInterval: NodeJS.Timeout | null = null;
  private executingOrders: Set<string> = new Set();

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

    // Initialize relayer keypair from environment (optional - for future use)
    // For now, we'll execute using user authorizations
    if (process.env.RELAYER_KEYPAIR) {
      try {
        const keypairArray = JSON.parse(process.env.RELAYER_KEYPAIR);
        this.relayerKeypair = Keypair.fromSecretKey(Uint8Array.from(keypairArray));
      } catch (e) {
        // Logs disabled - check keeper service logs for execution details
      }
    }
  }

  /**
   * Initialize the relayer with Anchor program
   */
  async initialize() {
    try {
      const idl = await loadIDL();
      if (!idl) {
        throw new Error('Failed to load IDL');
      }

      // Create a dummy wallet for provider (we'll use user wallets for actual execution)
      const dummyKeypair = Keypair.generate();
      const wallet = new Wallet(dummyKeypair);
      const provider = new AnchorProvider(this.connection, wallet, {
        commitment: 'confirmed',
      });

      // Anchor 0.31+ requires new Program constructor signature
      this.program = new Program(idl, provider);
      // Logs disabled - check keeper service logs for execution details
    } catch (error) {
      // Logs disabled - check keeper service logs for execution details
      throw error;
    }
  }

  /**
   * Start automatic execution of matched orders
   */
  startAutoExecution(intervalMs: number = 10000) {
    if (this.executionInterval) {
      clearInterval(this.executionInterval);
    }

    this.executionInterval = setInterval(async () => {
      try {
        await this.executePendingMatches();
      } catch (error) {
        // Logs disabled - check keeper service logs for execution details
      }
    }, intervalMs);

    // Logs disabled - check keeper service logs for execution details
  }

  /**
   * Stop automatic execution
   */
  stopAutoExecution() {
    if (this.executionInterval) {
      clearInterval(this.executionInterval);
      this.executionInterval = null;
      // Logs disabled - check keeper service logs for execution details
    }
  }

  /**
   * Execute all pending matched orders
   */
  private async executePendingMatches() {
    // Get all markets and outcomes (simplified - in production, fetch from DB)
    // For now, we'll process orders that are matched but not executed
    
    // This would need to be implemented based on your market structure
    // For now, we'll create a method that processes individual matches
  }

  /**
   * Execute a matched order pair on-chain
   * This is called when orders are matched in the order book
   */
  async executeMatch(
    buyOrder: Order,
    sellOrder: Order,
    matchPrice: number,
    matchSize: bigint
  ): Promise<MatchExecutionResult> {
    const matchKey = `${buyOrder.id}-${sellOrder.id}`;
    
    // Prevent duplicate execution
    if (this.executingOrders.has(matchKey)) {
      return {
        success: false,
        buyOrderId: buyOrder.id,
        sellOrderId: sellOrder.id,
        error: 'Already executing',
      };
    }

    this.executingOrders.add(matchKey);

    try {
      if (!this.program) {
        await this.initialize();
      }

      // Calculate execution parameters
      const BASIS_POINTS = 10000;
      const notional = matchSize * BigInt(buyOrder.leverage);
      const shares = (notional * BigInt(BASIS_POINTS)) / BigInt(matchPrice);

      // Execute for buy order (Long position)
      const buyResult = await this.executeOrderOnChain(
        buyOrder,
        matchPrice,
        Number(shares),
        0, // Long (buy)
        Number(matchSize)
      );

      // Execute for sell order (Short position)
      const sellResult = await this.executeOrderOnChain(
        sellOrder,
        matchPrice,
        Number(shares),
        1, // Short (sell)
        Number(matchSize)
      );

      const success = buyResult.success && sellResult.success;

      return {
        success,
        buyOrderId: buyOrder.id,
        sellOrderId: sellOrder.id,
        buyTx: buyResult.tx,
        sellTx: sellResult.tx,
        error: success ? undefined : `Buy: ${buyResult.error}, Sell: ${sellResult.error}`,
      };
    } catch (error: any) {
      // Logs disabled - check keeper service logs for execution details
      return {
        success: false,
        buyOrderId: buyOrder.id,
        sellOrderId: sellOrder.id,
        error: error.message || 'Unknown error',
      };
    } finally {
      this.executingOrders.delete(matchKey);
    }
  }

  /**
   * Execute a single order on-chain
   * Note: This requires the user's wallet to sign, so we'll need to store
   * signed transactions or use a different approach
   */
  private async executeOrderOnChain(
    order: Order,
    price: number,
    shares: number,
    side: number,
    marginAmount: number
  ): Promise<{ success: boolean; tx?: string; error?: string }> {
    try {
      // Get user's public key from order
      const userPubkey = new PublicKey(order.userId);
      
      // For automatic execution, we need either:
      // 1. Pre-signed transactions from users
      // 2. User wallet delegation
      // 3. On-chain order storage with automatic execution
      
      // For now, we'll return a placeholder that indicates execution is needed
      // In production, you would:
      // - Store signed transactions when orders are placed
      // - Or use a relayer keypair with user authorization
      // - Or implement on-chain order storage
      
      // Logs disabled - check keeper service logs for execution details
      
      // TODO: Implement actual on-chain execution
      // This would require:
      // 1. User's signed transaction (stored when order placed)
      // 2. Or relayer with user authorization
      // 3. Or on-chain order account that can be executed by anyone
      
      return {
        success: false,
        error: 'Automatic execution not yet implemented - requires user authorization or on-chain orders',
      };
    } catch (error: any) {
      return {
        success: false,
        error: error.message || 'Execution failed',
      };
    }
  }
}


