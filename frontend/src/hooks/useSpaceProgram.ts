import { useMemo, useState, useEffect } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { AnchorProvider, BN, Program, Idl, IdlTypes } from '@coral-xyz/anchor';
import { PublicKey, SystemProgram, SYSVAR_RENT_PUBKEY, SYSVAR_CLOCK_PUBKEY, ComputeBudgetProgram, TransactionInstruction } from '@solana/web3.js';

// Priority fee scaffolding. Without these, transactions sit in the mempool
// behind any paying tx when the cluster is busy and expire when their
// blockhash runs out (~60s) — which is exactly what surfaces as the
// "Transaction was not confirmed in 30 seconds" toast.
//
// Cost: 50_000 microLamports/CU × the limit below = a few thousand lamports
// per tx. Trivial dollars, but determines whether your tx gets into a block.
const DEFAULT_PRIORITY_MICROLAMPORTS = 50_000;
function priorityFeeIxs(computeUnitLimit: number, microLamports: number = DEFAULT_PRIORITY_MICROLAMPORTS): TransactionInstruction[] {
  return [
    ComputeBudgetProgram.setComputeUnitLimit({ units: computeUnitLimit }),
    ComputeBudgetProgram.setComputeUnitPrice({ microLamports }),
  ];
}
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, getAccount } from '@solana/spl-token';
import { 
  SPACE_CORE_PROGRAM_ID,
  USDC_MINT,
  USDC_DECIMALS,
  MIN_INITIAL_COLLATERAL,
  humanToLamports,
  getMarketPDA,
  getMarketVaultPDA,
  getVaultAuthorityPDA,
  getConfigPDA,
  getOracleRegistryPDA,
  getInsuranceFundPDA,
  getInsuranceVaultPDA,
  getInsuranceAuthorityPDA,
  getPendingOrderPDA,
  getOrderEscrowPDA,
  getOrderEscrowAuthorityPDA,
  getShareEscrowAuthorityPDA,
  getShareEscrowYesPDA,
  getShareEscrowNoPDA,
  getNoMintPDA,
  getYesMintPDA,
  getMintAuthorityPDA,
  getPositionPDA,
  getOldPositionPDA,
  getTwapStatePDA,
  getMatchStatePDA,
  getMarginVaultPDA,
  getMarginVaultAuthorityPDA,
  getLiquidityVaultPDA,
  getLiquidityVaultAuthorityPDA,
  usdcToLamports,
  MarketCreationParams,
} from '@/utils/solana';
import { loadIDL, getIDLProgramId } from '@/utils/idl-loader';

/**
 * Check if error is a user wallet rejection/cancellation
 * Wallet adapters throw errors when users reject transactions
 */
function isUserRejectionError(error: any): boolean {
  if (!error) return false;
  
  // Check for wallet error code (4001 = User rejected)
  if (error.code === 4001) return true;
  
  // Check error name/type (including Runtime errors)
  const errorName = (error.name || error.constructor?.name || '').toLowerCase();
  const errorString = String(error || '');
  const fullErrorText = `${errorName} ${errorString}`.toLowerCase();
  
  // Check for WalletSignTransactionError (with or without "Runtime" prefix)
  if (fullErrorText.includes('walletsigntransactionerror') ||
      fullErrorText.includes('userrejected') ||
      fullErrorText.includes('rejectedrequest')) {
    return true;
  }
  
  // Check error message for common rejection patterns
  const message = String(error.message || error.toString() || error || '').toLowerCase();
  const rejectionPatterns = [
    'user rejected',
    'user cancelled',
    'user denied',
    'rejected',
    'cancelled',
    'denied',
    'signature request rejected',
    'transaction cancelled',
    'wallet sign transaction error',
    'user disapproved',
    'not approved',
    'declined',
    'abort',
    'the user rejected the request',
  ];
  
  return rejectionPatterns.some(pattern => message.includes(pattern));
}

/**
 * Custom error class for user rejections that won't trigger Next.js error boundary
 * Using a special class that can be identified and handled gracefully
 */
class UserRejectionError extends Error {
  public readonly isUserRejection = true;
  
  constructor(message: string = 'Transaction rejected by user') {
    super(message);
    this.name = 'UserRejectionError';
    // Mark as handled to prevent error boundaries
    Object.defineProperty(this, 'stack', {
      value: '',
      writable: false,
    });
  }
}

/**
 * Handle wallet errors gracefully, converting user rejections to silent errors
 */
function handleWalletError(error: any): Error {
  // Check for user rejection first
  if (isUserRejectionError(error)) {
    // Return a special error type that won't trigger error boundaries
    return new UserRejectionError('Transaction rejected by user');
  }
  
  // If error might be wrapped, check nested errors
  if (error?.error || error?.originalError) {
    const nestedError = error.error || error.originalError;
    if (isUserRejectionError(nestedError)) {
      return new UserRejectionError('Transaction rejected by user');
    }
  }
  
  // Log other errors for debugging (but not rejections)
  if (error?.message && !isUserRejectionError(error)) {
    console.error('[Program] Transaction error:', {
      message: error.message,
      name: error.name,
      code: error.code,
      error: error.toString(),
    });
  }
  
  // Return original error if it's not a rejection
  return error instanceof Error ? error : new Error(error?.message || 'Transaction failed');
}

export function useSpaceProgram() {
  const { connection } = useConnection();
  const wallet = useWallet();
  const [loading, setLoading] = useState(false);
  const [program, setProgram] = useState<Program<Idl> | null>(null);

  const provider = useMemo(() => {
    if (!wallet.publicKey || !wallet.signTransaction || !wallet.signAllTransactions) {
      return null;
    }

    const walletAdapter = {
      publicKey: wallet.publicKey,
      signTransaction: wallet.signTransaction,
      signAllTransactions: wallet.signAllTransactions,
    };

    return new AnchorProvider(connection, walletAdapter as any, {
      commitment: 'confirmed',
    });
  }, [connection, wallet]);

  // Load programs when provider is ready
  useEffect(() => {
    if (provider) {
      // Load space_core program
      loadIDL().then((idl) => {
        if (idl) {
          try {
            // Check if IDL has program ID (handles both old and new IDL formats)
            const idlProgramId = getIDLProgramId(idl);
            
            // Validate IDL structure before creating Program
            const requiredFields = ['instructions', 'accounts'];
            const missingFields = requiredFields.filter(field => !idl[field]);
            
            if (missingFields.length > 0) {
              throw new Error(`IDL missing required fields: ${missingFields.join(', ')}`);
            }
            
            // Ensure IDL has address field (required for Anchor 0.31+)
            if (!idl.address && idlProgramId) {
              idl.address = idlProgramId;
            } else if (!idl.address) {
              idl.address = SPACE_CORE_PROGRAM_ID.toString();
            }
            
            console.log('[Program] Initialization:', {
              idlProgramId: idlProgramId || 'not found',
              idlAddress: idl.address || 'not found (will be set)',
              expectedProgramId: SPACE_CORE_PROGRAM_ID.toString(),
              match: (idl.address || idlProgramId || '') === SPACE_CORE_PROGRAM_ID.toString(),
              idlVersion: idl.metadata?.spec || idl.version || 'unknown',
              idlStructure: {
                hasAddress: !!idl.address,
                hasMetadata: !!idl.metadata,
                hasInstructions: !!idl.instructions,
                instructionCount: idl.instructions?.length || 0,
                hasAccounts: !!idl.accounts,
                accountCount: idl.accounts?.length || 0,
                hasTypes: !!idl.types,
                typeCount: idl.types?.length || 0,
                hasErrors: !!idl.errors,
                errorCount: idl.errors?.length || 0,
              },
            });
            
            // Anchor 0.31+ requires new Program constructor signature
            // Use: new Program(idl, provider) instead of new Program(idl, programId, provider)
            // The programId is extracted from the IDL's address field
            const programInstance = new Program(idl as Idl, provider);
            setProgram(programInstance);
            console.log('[Program] Program instance created successfully');
          } catch (error: any) {
            console.error('[Program] Failed to create program instance:', error);
            console.error('[Program] Error details:', {
              message: error?.message,
              stack: error?.stack,
              idlType: typeof idl,
              idlKeys: idl ? Object.keys(idl) : [],
            });
          }
        }
      }).catch((error) => {
        console.error('Failed to load IDL:', error);
      });

      // Note: space_resolution program was merged into space_core
      // All resolution/settlement functionality is now in space_core
      console.log('[Program] Resolution functionality is now part of space_core');
    }
  }, [provider]);

  /**
   * Resolve YES mint PDA — auto-detects old (no outcomeId) vs new (per-outcome) markets.
   * Old markets: [b"yes_mint", market], New markets: [b"yes_mint", market, outcomeId]
   */
  async function resolveYesMintPDA(marketPDA: PublicKey, outcomeId: number): Promise<PublicKey> {
    const [newPDA] = getYesMintPDA(marketPDA, outcomeId);
    const info = await connection.getAccountInfo(newPDA);
    if (info && info.data.length > 0) return newPDA;
    const [oldPDA] = getYesMintPDA(marketPDA);
    return oldPDA;
  }

  /**
   * Resolve NO mint PDA — auto-detects old (shared) vs new (per-outcome) markets.
   * Old markets: [b"no_mint", market], New markets: [b"no_mint", market, outcomeId]
   */
  async function resolveNoMintPDA(marketPDA: PublicKey, outcomeId: number): Promise<PublicKey> {
    const [newPDA] = getNoMintPDA(marketPDA, outcomeId);
    const info = await connection.getAccountInfo(newPDA);
    if (info && info.data.length > 0) return newPDA;
    const [oldPDA] = getNoMintPDA(marketPDA);
    return oldPDA;
  }

  const createMarket = async (params: MarketCreationParams) => {
    if (!wallet.publicKey || !wallet.signTransaction || !provider) {
      throw new Error('Wallet not connected');
    }

    if (!program) {
      throw new Error('Program not loaded. Please ensure IDL is available.');
    }

    setLoading(true);

    try {
      // Generate deterministic market_id (use timestamp as unique ID)
      const marketId = Math.floor(Date.now() / 1000); // Unix timestamp as market_id
      
      const [marketPDA] = getMarketPDA(wallet.publicKey, marketId);
      const [vaultPDA] = getMarketVaultPDA(marketPDA);
      const [vaultAuthorityPDA] = getVaultAuthorityPDA(marketPDA);
      
      // Margin and liquidity vault PDAs for leverage
      const [marginVaultPDA] = getMarginVaultPDA(marketPDA);
      const [marginVaultAuthorityPDA] = getMarginVaultAuthorityPDA(marketPDA);
      const [liquidityVaultPDA] = getLiquidityVaultPDA(marketPDA);
      const [liquidityVaultAuthorityPDA] = getLiquidityVaultAuthorityPDA(marketPDA);
      
      // New PDAs for token-based share system
      const [mintAuthorityPDA] = getMintAuthorityPDA(marketPDA);

      // Quote token (defaults to USDC). SPACE markets pass SPACE_MINT + 9 decimals.
      const quoteMint = params.quoteMint ?? USDC_MINT;
      const quoteDecimals = params.quoteDecimals ?? USDC_DECIMALS;

      // Get user's ATA for the quote mint
      const userQuoteATA = await getAssociatedTokenAddress(quoteMint, wallet.publicKey);

      // Check if ATA exists, create if not
      let needsATA = false;
      try {
        await getAccount(connection, userQuoteATA);
      } catch {
        needsATA = true;
      }

      // Convert initial collateral from human units to base-unit lamports
      const initialCollateral = humanToLamports(params.initialCollateral, quoteDecimals);

      // Client-side minimum check (program still enforces USDC-decimals min until
      // Phase B ships — this guards against under-seeding SPACE markets).
      const minHuman = 1000;
      if (params.initialCollateral < minHuman) {
        throw new Error(`Minimum initial collateral is ${minHuman}`);
      }

      // Convert end date to Unix timestamp
      const endDate = new BN(Math.floor(params.endDate.getTime() / 1000));

      // Resolution type: 0 = Deterministic (TWAP), 1 = Oracle
      const resolutionType = params.resolutionType ?? 1; // Default to Oracle for most markets

      // Generate YES mint PDAs for each outcome (required by deployed program)
      const yesMintPDAs = params.outcomes.map((_, index) => {
        const [yesMintPDA] = getYesMintPDA(marketPDA, index);
        return yesMintPDA;
      });

      // Generate per-outcome NO mint PDAs (Polymarket model)
      const noMintPDAs = params.outcomes.map((_, index) => {
        const [noMintPDA] = getNoMintPDA(marketPDA, index);
        return noMintPDA;
      });

      console.log('📦 Creating market with accounts:');
      console.log('  Market PDA:', marketPDA.toString());
      console.log('  Mint Authority PDA:', mintAuthorityPDA.toString());
      console.log('  Vault PDA:', vaultPDA.toString());
      console.log('  Vault Authority PDA:', vaultAuthorityPDA.toString());
      console.log('  YES Mint PDAs:', yesMintPDAs.map(p => p.toString()));
      console.log('  NO Mint PDAs:', noMintPDAs.map(p => p.toString()));

      // Build remaining accounts: [yes_mint_0, yes_mint_1, ..., no_mint_0, no_mint_1, ..., creator, token_program, system_program]
      const remainingAccounts = [
        // YES mint PDAs for each outcome
        ...yesMintPDAs.map(pubkey => ({
          pubkey,
          isSigner: false,
          isWritable: true, // Must be writable because we're initializing these accounts
        })),
        // NO mint PDAs for each outcome (per-outcome NO mints)
        ...noMintPDAs.map(pubkey => ({
          pubkey,
          isSigner: false,
          isWritable: true, // Must be writable because we're initializing these accounts
        })),
        // Creator account (required to avoid Anchor lifetime issues)
        {
          pubkey: wallet.publicKey,
          isSigner: false,
          isWritable: true,
        },
        // Token program (required for CPI)
        {
          pubkey: TOKEN_PROGRAM_ID,
          isSigner: false,
          isWritable: false,
        },
        // System program (required for CPI)
        {
          pubkey: SystemProgram.programId,
          isSigner: false,
          isWritable: false,
        },
      ];

      // Step 1: Initialize market core (market account, YES mints, NO mints via remainingAccounts)
      console.log('📦 Step 1: Initializing market core...');
      const coreTx = await program.methods
        .initializeMarketCore(
          new BN(marketId),
          params.title,
          params.description,
          params.category,
          endDate,
          params.outcomes,
          resolutionType
        )
        .accounts({
          market: marketPDA,
          creator: wallet.publicKey,
          mintAuthority: mintAuthorityPDA,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .remainingAccounts(remainingAccounts)
        .preInstructions([
          // High CU budget — initializeMarketCore creates 2 × num_outcomes
          // mint accounts in one ix, easily 600-900K CU for binary, more
          // for multi-outcome. Default 200K is too low and silently fails.
          ...priorityFeeIxs(1_400_000),
          ...(needsATA
            ? [
                createAssociatedTokenAccountInstruction(
                  wallet.publicKey,
                  userQuoteATA,
                  wallet.publicKey,
                  quoteMint
                ),
              ]
            : []),
        ])
        .rpc();

      // Step 2: Initialize market vaults (market vault, margin vault, liquidity vault)
      console.log('📦 Step 2: Initializing market vaults...');
      const vaultsTx = await program.methods
        .initializeMarketVaults(new BN(initialCollateral))
        .accounts({
          market: marketPDA,
          creator: wallet.publicKey,
          creatorUsdc: userQuoteATA,
          usdcMint: quoteMint,
          vaultAuthority: vaultAuthorityPDA,
          marketVault: vaultPDA,
          marginVaultAuthority: marginVaultAuthorityPDA,
          marginVault: marginVaultPDA,
          liquidityVaultAuthority: liquidityVaultAuthorityPDA,
          liquidityVault: liquidityVaultPDA,
          systemProgram: SystemProgram.programId,
          tokenProgram: TOKEN_PROGRAM_ID,
          rent: SYSVAR_RENT_PUBKEY,
        })
        // Creates 3 token accounts + a transfer; ~600K CU is comfortable.
        .preInstructions(priorityFeeIxs(600_000))
        .rpc();

      // Return both transaction signatures
      const tx = [coreTx, vaultsTx];

      return {
        market: marketPDA.toString(),
        marketId: marketId,
        transaction: tx,
      };
    } catch (error: any) {
      console.error('[Program] Create market error:', error);
      throw handleWalletError(error);
    } finally {
      setLoading(false);
    }
  };


  const placeBuyOrder = async (params: {
    market: PublicKey | string;
    outcomeId: number;
    price: number; // Basis points
    quantity: number; // Share base units (6 decimals)
    leverage: number;
    orderId: number;
    quoteMint?: string; // Optional; defaults to USDC for legacy callers.
  }) => {
    if (!wallet.publicKey || !wallet.signTransaction || !provider || !program) {
      throw new Error('Wallet not connected or program not loaded');
    }

    setLoading(true);

    try {
      const marketPDA = typeof params.market === 'string'
        ? new PublicKey(params.market)
        : params.market;

      const [pendingOrderPDA] = getPendingOrderPDA(wallet.publicKey, params.orderId);
      const [orderEscrowAuthorityPDA] = getOrderEscrowAuthorityPDA(wallet.publicKey, params.orderId);
      const [orderEscrowPDA] = getOrderEscrowPDA(wallet.publicKey, params.orderId);

      const quoteMint = params.quoteMint ? new PublicKey(params.quoteMint) : USDC_MINT;
      const userUsdcATA = await getAssociatedTokenAddress(quoteMint, wallet.publicKey);

      let tx: string;
      try {
        tx = await program.methods
          .placeBuyOrder(
            new BN(params.orderId),
            params.outcomeId,
            new BN(params.price),
            new BN(params.quantity),
            params.leverage
          )
          .accounts({
            market: marketPDA,
            user: wallet.publicKey,
            userUsdc: userUsdcATA,
            pendingOrder: pendingOrderPDA,
            orderEscrowAuthority: orderEscrowAuthorityPDA,
            orderEscrow: orderEscrowPDA,
            usdcMint: quoteMint,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .preInstructions(priorityFeeIxs(400_000))
          .rpc();
      } catch (rpcError: any) {
        // Catch RPC errors early and check for user rejection
        if (isUserRejectionError(rpcError)) {
          // Don't throw - return a rejection result instead to prevent Next.js error popup
          throw new UserRejectionError('Transaction rejected by user');
        }
        throw rpcError;
      }

      return { 
        transaction: tx,
        pendingOrder: pendingOrderPDA.toString(),
      };
    } catch (error: any) {
      // For user rejections, throw special error that will be caught in component
      // For other errors, handle normally
      const handledError = handleWalletError(error);
      if (handledError instanceof UserRejectionError) {
        // Suppress stack trace for user rejections to prevent Next.js error popup
        handledError.stack = '';
      }
      throw handledError;
    } finally {
      setLoading(false);
    }
  };

  const placeYesLimitSellOrder = async (params: {
    market: PublicKey | string;
    price: number; // Basis points
    quantity: number; // In lamports
    leverage: number;
    orderId: number;
    outcomeId?: number; // Outcome ID (default 0 for binary YES)
  }) => {
    if (!wallet.publicKey || !wallet.signTransaction || !provider || !program) {
      throw new Error('Wallet not connected or program not loaded');
    }
    
    // No frontend validation - contract will validate leverage = 1 for sell orders
    setLoading(true);

    try {
      const marketPDA = typeof params.market === 'string' 
        ? new PublicKey(params.market) 
        : params.market;
      
      const outcomeId = params.outcomeId ?? 0; // Dynamic outcome ID (default 0 for binary YES)
      const [pendingOrderPDA] = getPendingOrderPDA(wallet.publicKey, params.orderId);
      const [shareEscrowAuthorityPDA] = getShareEscrowAuthorityPDA(wallet.publicKey, params.orderId);
      const [shareEscrowYesPDA] = getShareEscrowYesPDA(wallet.publicKey, params.orderId);
      const yesMintPDA = await resolveYesMintPDA(marketPDA, outcomeId);

      // Get spot position PDA - try new format first, fall back to old format
      const [newSpotPDA] = getPositionPDA(marketPDA, wallet.publicKey, outcomeId, 0, 0, 0);
      const [oldSpotPDA] = getOldPositionPDA(marketPDA, wallet.publicKey, outcomeId, 0, 0);
      // Check if new PDA exists on-chain; if not, try old PDA (backward compat)
      const newSpotInfo = await connection.getAccountInfo(newSpotPDA);
      const userPositionPDA = newSpotInfo ? newSpotPDA : oldSpotPDA;

      // Check if leveraged position exists - pass it in remainingAccounts if it does
      const [leveragedPositionPDA] = getPositionPDA(marketPDA, wallet.publicKey, outcomeId, 0, 1, 0);
      const [oldLeveragedPDA] = getOldPositionPDA(marketPDA, wallet.publicKey, outcomeId, 0, 1);
      let leveragedPositionAccount = null;
      try {
        // Try new PDA first, then old
        let leveragedPos = await (program.account as any).position.fetch(leveragedPositionPDA).catch(() => null);
        let useLevPDA = leveragedPositionPDA;
        if (!leveragedPos) {
          leveragedPos = await (program.account as any).position.fetch(oldLeveragedPDA).catch(() => null);
          useLevPDA = oldLeveragedPDA;
        }
        if (leveragedPos && leveragedPos.shares && leveragedPos.shares.toNumber() > 0) {
          leveragedPositionAccount = {
            pubkey: useLevPDA,
            isSigner: false,
            isWritable: false,
          };
          console.log('[placeYesLimitSellOrder] Found leveraged position - passing to contract for validation');
        }
      } catch (e) {
        // Leveraged position doesn't exist - that's fine
      }
      
      console.log('[placeYesLimitSellOrder] Using spot position PDA - contract will validate:', userPositionPDA.toString());
      
      const userYesATA = await getAssociatedTokenAddress(yesMintPDA, wallet.publicKey);

      let tx: string;
      try {
        const instructionBuilder = program.methods
          .placeYesLimitSellOrder(
            new BN(params.orderId),
            outcomeId, // Dynamic outcome_id
            new BN(params.price),
            new BN(params.quantity),
            params.leverage
          )
          .accounts({
            market: marketPDA,
            user: wallet.publicKey,
            pendingOrder: pendingOrderPDA,
            userYesAccount: userYesATA,
            shareEscrowAuthority: shareEscrowAuthorityPDA,
            shareEscrowYes: shareEscrowYesPDA,
            yesMint: yesMintPDA,
            userPosition: userPositionPDA,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          });
        
        // Add leveraged position to remainingAccounts if it exists
        if (leveragedPositionAccount) {
          instructionBuilder.remainingAccounts([leveragedPositionAccount]);
        }

        tx = await instructionBuilder.preInstructions(priorityFeeIxs(400_000)).rpc();
      } catch (rpcError: any) {
        if (isUserRejectionError(rpcError)) {
          throw new UserRejectionError('Transaction rejected by user');
        }
        throw rpcError;
      }

      return { 
        transaction: tx,
        pendingOrder: pendingOrderPDA.toString(),
      };
    } catch (error: any) {
      const handledError = handleWalletError(error);
      if (handledError instanceof UserRejectionError) {
        handledError.stack = '';
      }
      throw handledError;
    } finally {
      setLoading(false);
    }
  };

  const placeNoLimitSellOrder = async (params: {
    market: PublicKey | string;
    price: number; // Basis points
    quantity: number; // In lamports
    leverage: number;
    orderId: number;
    outcomeId?: number;
  }) => {
    if (!wallet.publicKey || !wallet.signTransaction || !provider || !program) {
      throw new Error('Wallet not connected or program not loaded');
    }
    
    // No frontend validation - contract will validate leverage = 1 for sell orders
    setLoading(true);

    try {
      const marketPDA = typeof params.market === 'string' 
        ? new PublicKey(params.market) 
        : params.market;
      
      const [pendingOrderPDA] = getPendingOrderPDA(wallet.publicKey, params.orderId);
      const [orderEscrowAuthorityPDA] = getOrderEscrowAuthorityPDA(wallet.publicKey, params.orderId);
      const [orderEscrowPDA] = getOrderEscrowPDA(wallet.publicKey, params.orderId);
      const [shareEscrowAuthorityPDA] = getShareEscrowAuthorityPDA(wallet.publicKey, params.orderId);
      const [shareEscrowNoPDA] = getShareEscrowNoPDA(wallet.publicKey, params.orderId);
      const outcomeId = params.outcomeId ?? 0; // outcomeId always passed by caller; default 0 as safety
      const noMintPDA = await resolveNoMintPDA(marketPDA, outcomeId);

      // Get spot position PDA - try new format first, fall back to old format
      const [newSpotPDA] = getPositionPDA(marketPDA, wallet.publicKey, outcomeId, 0, 0, 1); // token_type=1 (NO)
      const [oldSpotPDA] = getOldPositionPDA(marketPDA, wallet.publicKey, outcomeId, 0, 0);
      const newSpotInfo = await connection.getAccountInfo(newSpotPDA);
      const userPositionPDA = newSpotInfo ? newSpotPDA : oldSpotPDA;

      // Check if leveraged position exists - pass it in remainingAccounts if it does
      const [leveragedPositionPDA] = getPositionPDA(marketPDA, wallet.publicKey, outcomeId, 0, 1, 1); // token_type=1 (NO)
      const [oldLeveragedPDA] = getOldPositionPDA(marketPDA, wallet.publicKey, outcomeId, 0, 1);
      let leveragedPositionAccount = null;
      try {
        let leveragedPos = await (program.account as any).position.fetch(leveragedPositionPDA).catch(() => null);
        let useLevPDA = leveragedPositionPDA;
        if (!leveragedPos) {
          leveragedPos = await (program.account as any).position.fetch(oldLeveragedPDA).catch(() => null);
          useLevPDA = oldLeveragedPDA;
        }
        if (leveragedPos && leveragedPos.shares && leveragedPos.shares.toNumber() > 0) {
          leveragedPositionAccount = {
            pubkey: useLevPDA,
            isSigner: false,
            isWritable: false,
          };
          console.log('[placeNoLimitSellOrder] Found leveraged position - passing to contract for validation');
        }
      } catch (e) {
        // Leveraged position doesn't exist - that's fine
      }
      
      console.log('[placeNoLimitSellOrder] Using spot position PDA - contract will validate:', userPositionPDA.toString());
      
      const userUsdcATA = await getAssociatedTokenAddress(USDC_MINT, wallet.publicKey);
      const userNoATA = await getAssociatedTokenAddress(noMintPDA, wallet.publicKey);

      let tx: string;
      try {
        const instructionBuilder = program.methods
          .placeNoLimitSellOrder(
            new BN(params.orderId),
            outcomeId,
            new BN(params.price),
            new BN(params.quantity),
            params.leverage
          )
          .accounts({
            market: marketPDA,
            user: wallet.publicKey,
            userUsdc: userUsdcATA,
            pendingOrder: pendingOrderPDA,
            orderEscrowAuthority: orderEscrowAuthorityPDA,
            orderEscrow: orderEscrowPDA,
            usdcMint: USDC_MINT,
            userNoAccount: userNoATA,
            shareEscrowAuthority: shareEscrowAuthorityPDA,
            shareEscrowNo: shareEscrowNoPDA,
            noMint: noMintPDA,
            userPosition: userPositionPDA,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          });
        
        // Add leveraged position to remainingAccounts if it exists
        if (leveragedPositionAccount) {
          instructionBuilder.remainingAccounts([leveragedPositionAccount]);
        }

        tx = await instructionBuilder.preInstructions(priorityFeeIxs(400_000)).rpc();
      } catch (rpcError: any) {
        if (isUserRejectionError(rpcError)) {
          throw new UserRejectionError('Transaction rejected by user');
        }
        throw rpcError;
      }

      return { 
        transaction: tx,
        pendingOrder: pendingOrderPDA.toString(),
      };
    } catch (error: any) {
      const handledError = handleWalletError(error);
      if (handledError instanceof UserRejectionError) {
        handledError.stack = '';
      }
      throw handledError;
    } finally {
      setLoading(false);
    }
  };

  // Legacy wrapper for backward compatibility - routes to placeYesLimitSellOrder or placeNoLimitSellOrder
  const placeSellOrder = async (params: {
    market: PublicKey | string;
    outcomeId: number;
    price: number; // Basis points
    quantity: number; // In lamports
    leverage: number;
    orderId: number;
    numOutcomes?: number; // Number of outcomes in the market (default 2 for binary)
    tokenType?: 'yes' | 'no'; // Token type: YES shares or NO shares
  }) => {
    // Determine if this is a NO share sell:
    // 1. Binary market outcome 1 always uses NO path (backward compat)
    // 2. Multi-outcome with tokenType='no' uses NO path
    const isBinaryNo = (params.numOutcomes ?? 2) === 2 && params.outcomeId === 1;
    const isNoSell = isBinaryNo || params.tokenType === 'no';

    if (!isNoSell) {
      return placeYesLimitSellOrder({
        market: params.market,
        price: params.price,
        quantity: params.quantity,
        leverage: params.leverage,
        orderId: params.orderId,
        outcomeId: params.outcomeId, // Pass dynamic outcomeId
      });
    } else {
      return placeNoLimitSellOrder({
        market: params.market,
        price: params.price,
        quantity: params.quantity,
        leverage: params.leverage,
        orderId: params.orderId,
        outcomeId: params.outcomeId, // Pass dynamic outcomeId
      });
    }
  };

  // Legacy wrapper for backward compatibility - routes to placeBuyOrder or placeSellOrder
  const placeLimitOrder = async (params: {
    market: PublicKey | string;
    outcomeId: number;
    side: number; // 0 = Long (buy), 1 = Short (sell)
    price: number; // Basis points
    quantity: number; // In lamports
    leverage: number;
    orderId: number;
    numOutcomes?: number; // Number of outcomes in the market (default 2 for binary)
  }) => {
    if (params.side === 0) {
      return placeBuyOrder({
        market: params.market,
        outcomeId: params.outcomeId,
        price: params.price,
        quantity: params.quantity,
        leverage: params.leverage,
        orderId: params.orderId,
      });
    } else {
      return placeSellOrder({
        market: params.market,
        outcomeId: params.outcomeId,
        price: params.price,
        quantity: params.quantity,
        leverage: params.leverage,
        orderId: params.orderId,
        numOutcomes: params.numOutcomes,
      });
    }
  };

  // Market orders MUST execute immediately or fail
  // This prevents orders sitting in the book and filling at unexpected prices later
  //
  // TRUE MARKET ORDER BEHAVIOR:
  // - BUY: Execute at best ask price + tiny slippage, or FAIL if no liquidity
  // - SELL: Execute at best bid price - tiny slippage, or FAIL if no liquidity
  // - User pays EXACTLY what they see (no excess funds in escrow)
  
  interface OrderBookData {
    bids: Array<{ price: number; size: number }>;
    asks: Array<{ price: number; size: number }>;
  }
  
  const fetchOrderBook = async (marketId: string, outcomeId: number, depth: number = 20, tokenType?: 'yes' | 'no'): Promise<OrderBookData | null> => {
    try {
      let url = `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/v1/orderbook/${marketId}/${outcomeId}?depth=${depth}`;
      if (tokenType) {
        url += `&tokenType=${tokenType}`;
      }
      const response = await fetch(url);
      
      if (!response.ok) {
        console.warn('[fetchOrderBook] API response not OK:', {
          status: response.status,
          statusText: response.statusText,
          url,
        });
        return null;
      }
      
      const data = await response.json();
      
      // Backend returns { orderBook: {...} }
      const orderBookData = data.orderBook || data;
      
      // Ensure bids and asks are arrays
      const result: OrderBookData = {
        bids: Array.isArray(orderBookData.bids) ? orderBookData.bids : [],
        asks: Array.isArray(orderBookData.asks) ? orderBookData.asks : [],
      };
      
      console.log('[fetchOrderBook] Fetched orderbook:', {
        marketId,
        outcomeId,
        depth,
        url,
        bidsCount: result.bids.length,
        asksCount: result.asks.length,
        topBids: result.bids.slice(0, 3).map((b: any) => ({ price: b.price, priceCents: b.price / 100, size: b.size })),
        topAsks: result.asks.slice(0, 3).map((a: any) => ({ price: a.price, priceCents: a.price / 100, size: a.size })),
        rawDataKeys: Object.keys(data),
        orderBookDataKeys: orderBookData ? Object.keys(orderBookData) : null,
      });
      
      return result;
    } catch (e) {
      console.error('[fetchOrderBook] Error fetching orderbook:', {
        error: e,
        marketId,
        outcomeId,
        url: `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/v1/orderbook/${marketId}/${outcomeId}`,
      });
      return null;
    }
  };
  
  const placeBuyMarketOrder = async (params: {
    market: PublicKey | string;
    outcomeId: number;
    usdcAmount: number; // Quote amount to invest (in quote base units)
    maxSlippageBps: number;
    leverage: number;
    orderId: number;
    tokenType?: 'yes' | 'no';
    quoteMint?: string;
    /** Decimals of the market's quote token. Defaults to USDC (6). Required
     *  for non-USDC markets so the share-quantity math doesn't mis-scale.  */
    quoteDecimals?: number;
  }) => {
    if (!wallet.publicKey || !wallet.signTransaction || !provider || !program) {
      throw new Error('Wallet not connected or program not loaded');
    }

    try {
      const marketPDA = typeof params.market === 'string'
        ? new PublicKey(params.market)
        : params.market;
      const marketId = marketPDA.toBase58();

      // Fetch orderbook to get best ask price (filtered by tokenType for multi-outcome)
      const orderBook = await fetchOrderBook(marketId, params.outcomeId, 20, params.tokenType);
      const asks = orderBook?.asks || [];
      const bids = orderBook?.bids || [];
      
      // Calculate execution price (best ask + slippage buffer)
      let executionPrice: number;
      let bestAskPrice: number;
      
      if (asks.length === 0) {
        // NO LIQUIDITY - Use mid-price or best bid + slippage
        let currentPrice: number;
        if (bids.length > 0) {
          currentPrice = bids[0].price;
        } else {
          try {
            const marketAccount = await program.account.market.fetch(marketPDA);
            const outcomes = marketAccount.outcomes as { id: number; label: string; lastPrice: BN }[];
            currentPrice = outcomes[params.outcomeId]?.lastPrice?.toNumber() || 5000;
          } catch {
            currentPrice = 5000;
          }
        }
        // Calculate 5% slippage: price * (slippageBps / 10000)
        // e.g., 55¢ * (500 / 10000) = 55¢ * 0.05 = 2.75¢
        const slippageAmount = Math.floor(currentPrice * params.maxSlippageBps / 10000);
        executionPrice = Math.min(9900, currentPrice + slippageAmount);
        bestAskPrice = executionPrice;
        console.log(`Market BUY: No sellers available. Using limit order at ${executionPrice/100}¢ (current ${currentPrice/100}¢ + ${params.maxSlippageBps/100}% = ${slippageAmount/100}¢ slippage)`);
      } else {
        // Use best ask price for quantity calculation
        // Use best ask + 5% slippage for limit order price (to ensure it matches)
        bestAskPrice = asks[0].price;
        // Calculate 5% slippage: price * (slippageBps / 10000)
        // e.g., 55¢ * (500 / 10000) = 55¢ * 0.05 = 2.75¢
        const slippageAmount = Math.floor(bestAskPrice * params.maxSlippageBps / 10000);
        const maxAcceptablePrice = Math.min(9900, bestAskPrice + slippageAmount);
        executionPrice = maxAcceptablePrice; // Limit order price (with 5% slippage buffer)
        console.log(`Market BUY: Best ask=${bestAskPrice/100}¢, limit price=${executionPrice/100}¢ (${params.maxSlippageBps/100}% slippage = ${slippageAmount/100}¢)`);
      }
      
      // Calculate quantity at bestAskPrice (the actual fill price).
      // On-chain margin = quantity * price / (leverage * 10000) * quote_scale,
      // where quote_scale = 10^(quote_decimals - 6). To solve for `quantity`
      // in share base units (always 6 decimals) given the user's quote-amount
      // investment: quantity = usdcAmount * leverage * 10000 / (bestAskPrice
      // * quote_scale). Works for USDC (scale=1) and SPACE (scale=1000).
      const qDec = params.quoteDecimals ?? USDC_DECIMALS;
      const qUnit = Math.pow(10, qDec);
      const notionalInLamports = params.usdcAmount * params.leverage;

      const notionalInQuote = notionalInLamports / qUnit; // human quote value
      const priceForQuantity = bestAskPrice / 10000; // 0.0 – 1.0 fraction
      const shares = notionalInQuote / priceForQuantity; // human shares
      const quantity = Math.floor(shares * 1e6); // shares in 6-dec base units

      // Validate: quantity * price should equal user's intended quote amount
      const expectedValue = (quantity / 1e6) * (bestAskPrice / 10000);
      const expectedValueDiff = Math.abs(expectedValue - (notionalInLamports / qUnit));

      console.log(`[placeBuyMarketOrder] Market BUY calculation:`, {
        quoteDecimals: qDec,
        usdcAmountQuote: params.usdcAmount / qUnit,
        leverage: params.leverage,
        notional: notionalInLamports / qUnit,
        bestAskPrice: bestAskPrice,
        bestAskPriceCents: bestAskPrice / 100,
        slippageLimitPrice: executionPrice,
        slippageLimitPriceCents: executionPrice / 100,
        priceUsedForOrder: bestAskPrice / 100 + '¢ (best ask = actual fill price)',
        calculatedShares: shares.toFixed(4),
        calculatedQuantityLamports: quantity,
        calculatedQuantityShares: quantity / 1e6,
        expectedMarginDeducted: expectedValue.toFixed(2),
        valueDifference: expectedValueDiff.toFixed(2),
      });

      // Validate calculation: margin should match user's intended amount
      if (expectedValueDiff > 0.01) {
        console.error(`[placeBuyMarketOrder] ERROR: Calculated quantity doesn't match expected value!`, {
          expectedValue: notionalInLamports / qUnit,
          actualValue: expectedValue,
          difference: expectedValueDiff,
        });
        throw new Error(`Quantity calculation error: Expected ${(notionalInLamports / qUnit).toFixed(2)} quote-units worth, but calculated quantity gives ${expectedValue.toFixed(2)} worth`);
      }

      if (quantity < 1e6) {
        console.warn(`[placeBuyMarketOrder] WARNING: Calculated quantity is less than 1 share! quantity=${quantity}, shares=${quantity/1e6}`);
      }

      // Place limit order at bestAskPrice (NOT slippage price)
      // This ensures margin deducted = user's intended amount
      // Order matches immediately since there's a seller at this price
      const result = await placeBuyOrder({
        market: params.market,
        outcomeId: params.outcomeId,
        price: bestAskPrice,
        quantity: quantity,
        leverage: params.leverage,
        orderId: params.orderId,
        quoteMint: params.quoteMint,
      });

      console.log(`[placeBuyMarketOrder] Order placed on-chain:`, {
        quantity: quantity,
        quantityShares: quantity / 1e6,
        price: bestAskPrice,
        priceCents: bestAskPrice / 100,
        marginDeducted: expectedValue.toFixed(2),
      });
      
      // Return result with execution price and calculated quantity for database storage
      return {
        ...result,
        aggressivePrice: executionPrice,
        bestAskPrice: bestAskPrice,
        calculatedQuantity: quantity, // Correctly calculated quantity
        immediateExecution: true,
      };
    } catch (error: any) {
      const handledError = handleWalletError(error);
      if (handledError instanceof UserRejectionError) {
        handledError.stack = '';
      }
      throw handledError;
    }
  };

  const placeSellMarketOrder = async (params: {
    market: PublicKey | string;
    outcomeId: number;
    quantity: number; // In lamports
    maxSlippageBps: number; // Max slippage in basis points
    leverage: number;
    orderId: number;
    numOutcomes?: number; // Number of outcomes in the market (default 2 for binary)
    tokenType?: 'yes' | 'no'; // Token type: YES shares or NO shares
  }) => {
    if (!wallet.publicKey || !wallet.signTransaction || !provider || !program) {
      throw new Error('Wallet not connected or program not loaded');
    }

    try {
      const marketPDA = typeof params.market === 'string' 
        ? new PublicKey(params.market) 
        : params.market;
      const marketId = marketPDA.toBase58();
      
      // Fetch orderbook to get current price (filtered by tokenType for multi-outcome)
      const orderBook = await fetchOrderBook(marketId, params.outcomeId, 20, params.tokenType);
      const bids = orderBook?.bids || [];
      const asks = orderBook?.asks || [];
      
      // Calculate current price as mid-price: (best_bid + best_ask) / 2
      // Similar to centralized exchanges and Polymarket
      let currentPrice: number;
      if (bids.length > 0 && asks.length > 0) {
        // Mid-price when both sides exist
        currentPrice = Math.floor((bids[0].price + asks[0].price) / 2);
      } else if (bids.length > 0) {
        // Best bid if only bids exist
        currentPrice = bids[0].price;
      } else if (asks.length > 0) {
        // Best ask if only asks exist
        currentPrice = asks[0].price;
      } else {
        // Fallback: fetch from market account or use default
        try {
          const marketAccount = await program.account.market.fetch(marketPDA);
          const outcomes = marketAccount.outcomes as { id: number; label: string; lastPrice: BN }[];
          currentPrice = outcomes[params.outcomeId]?.lastPrice?.toNumber() || 5000;
        } catch {
          currentPrice = 5000;
        }
      }
      
      // Market sell: set on-chain price to minimum (1 cent = 100 basis points)
      // This allows the order to sweep through ALL price levels in the order book.
      // Each partial fill executes at the buyer's price, so both sides are protected.
      // The matching engine enforces: match_price >= sell_order.price
      const executionPrice = 100; // 1 cent — accept any price
      if (bids.length > 0) {
        console.log(`Market SELL: Sweeping order book. Best bid=${bids[0].price/100}¢, min_price=1¢, current=${currentPrice/100}¢`);
      } else {
        console.log(`Market SELL: No buyers yet. Placing at min_price=1¢, will match when buyers appear`);
      }
      
      // Use limit sell order at execution price (will match immediately if liquidity available, otherwise waits)
      // Determine if this is a NO share sell:
      // 1. Binary market outcome 1 always uses NO path (backward compat)
      // 2. Multi-outcome with tokenType='no' uses NO path
      const isBinaryNo = (params.numOutcomes ?? 2) === 2 && params.outcomeId === 1;
      const isNoSell = isBinaryNo || params.tokenType === 'no';
      let result;
      if (!isNoSell) {
        result = await placeYesLimitSellOrder({
          market: params.market,
          price: executionPrice,
          quantity: params.quantity,
          leverage: params.leverage,
          orderId: params.orderId,
          outcomeId: params.outcomeId, // Pass dynamic outcomeId
        });
      } else {
        result = await placeNoLimitSellOrder({
          market: params.market,
          price: executionPrice,
          quantity: params.quantity,
          leverage: params.leverage,
          orderId: params.orderId,
          outcomeId: params.outcomeId, // Pass dynamic outcomeId
        });
      }
      
      // Return result with execution price and quantity for database storage
      return {
        ...result,
        aggressivePrice: executionPrice,
        calculatedQuantity: params.quantity, // For sell orders, quantity is already known
        immediateExecution: true,
      };
    } catch (error: any) {
      const handledError = handleWalletError(error);
      if (handledError instanceof UserRejectionError) {
        handledError.stack = '';
      }
      throw handledError;
    }
  };

  // Market order wrapper - routes to appropriate limit order with aggressive pricing
  // Accepts USDC amount and calculates quantity based on market price
  const placeMarketOrder = async (params: {
    market: PublicKey | string;
    outcomeId: number;
    side: number;
    usdcAmount: number;
    quantity?: number;
    maxSlippageBps?: number;
    leverage: number;
    orderId: number;
    numOutcomes?: number;
    tokenType?: 'yes' | 'no';
    quoteMint?: string;
    quoteDecimals?: number;
  }) => {
    const slippage = params.maxSlippageBps || 500;

    if (params.side === 0) {
      if (!params.usdcAmount) {
        throw new Error('USDC amount is required for market buy orders');
      }
      return placeBuyMarketOrder({
        market: params.market,
        outcomeId: params.outcomeId,
        usdcAmount: params.usdcAmount,
        maxSlippageBps: slippage,
        leverage: params.leverage,
        orderId: params.orderId,
        tokenType: params.tokenType,
        quoteMint: params.quoteMint,
        quoteDecimals: params.quoteDecimals,
      });
    } else {
      // Sell order - use quantity (shares)
      if (!params.quantity) {
        throw new Error('Quantity (shares) is required for market sell orders');
      }
      return placeSellMarketOrder({
        market: params.market,
        outcomeId: params.outcomeId,
        quantity: params.quantity,
        maxSlippageBps: slippage,
        leverage: params.leverage,
        orderId: params.orderId,
        numOutcomes: params.numOutcomes,
        tokenType: params.tokenType,
      });
    }
  };

  const executeMatchedOrders = async (params: {
    market: PublicKey | string;
    buyOrder: PublicKey;
    sellOrder: PublicKey;
    buyOrderId: number;
    sellOrderId: number;
    matchPrice: number; // Basis points
    matchQuantity: number; // In lamports
  }) => {
    if (!wallet.publicKey || !wallet.signTransaction || !provider || !program) {
      throw new Error('Wallet not connected or program not loaded');
    }

    setLoading(true);

    try {
      const marketPDA = typeof params.market === 'string' 
        ? new PublicKey(params.market) 
        : params.market;
      
      const [configPDA] = getConfigPDA();
      
      // Fetch order accounts to get user addresses and outcome IDs
      const buyOrderAccount = await program.account.pendingOrder.fetch(params.buyOrder);
      const sellOrderAccount = await program.account.pendingOrder.fetch(params.sellOrder);
      
      const buyOrderUser = buyOrderAccount.user as PublicKey;
      const sellOrderUser = sellOrderAccount.user as PublicKey;
      const buyOutcomeId = buyOrderAccount.outcomeId as number;
      const sellOutcomeId = sellOrderAccount.outcomeId as number;

      // Fetch market to determine number of outcomes for correct routing
      const marketAccount = await program.account.market.fetch(marketPDA);
      const numOutcomes = (marketAccount.numOutcomes as number) ?? 2;
      
      // Determine position type from buy order leverage
      // Position type: 0 = Spot (leverage == 1), 1 = Leveraged (leverage > 1)
      const buyLeverage = buyOrderAccount.leverage as number;
      const buyPositionType = buyLeverage === 1 ? 0 : 1;
      
      // Derive all required PDAs
      const [buyOrderEscrowAuthorityPDA] = getOrderEscrowAuthorityPDA(buyOrderUser, params.buyOrderId);
      const [buyOrderEscrowPDA] = getOrderEscrowPDA(buyOrderUser, params.buyOrderId);
      const buyYesMintPDA = await resolveYesMintPDA(marketPDA, buyOutcomeId);
      const buyNoMintPDA = await resolveNoMintPDA(marketPDA, buyOutcomeId);
      const buyTokenType = (numOutcomes === 2 && buyOutcomeId === 1) ? 1 : 0;
      // Try new PDA first, fall back to old PDA for buyer position
      const [newBuyPositionPDA] = getPositionPDA(marketPDA, buyOrderUser, buyOutcomeId, 0, buyPositionType, buyTokenType);
      const [oldBuyPositionPDA] = getOldPositionPDA(marketPDA, buyOrderUser, buyOutcomeId, 0, buyPositionType);
      const buyPosInfo = await connection.getAccountInfo(newBuyPositionPDA);
      const buyPositionPDA = buyPosInfo ? newBuyPositionPDA : oldBuyPositionPDA;

      const [sellOrderEscrowAuthorityPDA] = getOrderEscrowAuthorityPDA(sellOrderUser, params.sellOrderId);
      const [sellOrderEscrowPDA] = getOrderEscrowPDA(sellOrderUser, params.sellOrderId);
      const sellYesMintPDA = await resolveYesMintPDA(marketPDA, sellOutcomeId);
      const sellNoMintPDA = await resolveNoMintPDA(marketPDA, sellOutcomeId);
      // For seller, check both position types (spot and leveraged) - contract will use the correct one
      const sellTokenType = (numOutcomes === 2 && sellOutcomeId === 1) ? 1 : 0;
      const [sellPositionPDA_Spot] = getPositionPDA(marketPDA, sellOrderUser, sellOutcomeId, 1, 0, sellTokenType);
      const [sellPositionPDA_Leveraged] = getPositionPDA(marketPDA, sellOrderUser, sellOutcomeId, 1, 1, sellTokenType);
      const sellPositionPDA = sellPositionPDA_Spot; // Default, but both types are possible
      
      const [marketVaultPDA] = await getMarketVaultPDA(marketPDA);
      const [marginVaultPDA] = getMarginVaultPDA(marketPDA);
      const [marginVaultAuthorityPDA] = getMarginVaultAuthorityPDA(marketPDA);
      const [liquidityVaultPDA] = getLiquidityVaultPDA(marketPDA);
      const [liquidityVaultAuthorityPDA] = getLiquidityVaultAuthorityPDA(marketPDA);
      const [mintAuthorityPDA] = getMintAuthorityPDA(marketPDA);
      
      // Get token accounts
      const buyUserYesATA = await getAssociatedTokenAddress(buyYesMintPDA, buyOrderUser);
      const buyUserNoATA = await getAssociatedTokenAddress(buyNoMintPDA, buyOrderUser);
      const sellUserYesATA = await getAssociatedTokenAddress(sellYesMintPDA, sellOrderUser);
      const sellUserNoATA = await getAssociatedTokenAddress(sellNoMintPDA, sellOrderUser);
      const sellUserUsdcATA = await getAssociatedTokenAddress(USDC_MINT, sellOrderUser);
      
      // Derive match state PDA
      const [matchStatePDA] = getMatchStatePDA(marketPDA, params.buyOrderId, params.sellOrderId);

      // Check if match state already exists
      const matchStateAccount = await connection.getAccountInfo(matchStatePDA);
      const skipStep1 = matchStateAccount !== null;

      // Helper to create ATA if needed
      const ensureATA = async (mint: PublicKey, owner: PublicKey, ata: PublicKey) => {
        const account = await connection.getAccountInfo(ata);
        if (!account) {
          const ix = createAssociatedTokenAccountInstruction(
            wallet.publicKey!,
            ata,
            owner,
            mint,
            TOKEN_PROGRAM_ID,
            ASSOCIATED_TOKEN_PROGRAM_ID
          );
          const tx = await provider!.sendAndConfirm(new (await import('@solana/web3.js')).Transaction().add(ix));
          console.log('Created ATA:', ata.toString());
        }
      };

      // Step 1: Validate match (if not already done)
      let tx1 = 'skipped';
      if (!skipStep1) {
        console.log('Step 1: Validating match...');
        tx1 = await program.methods
          .validateMatch(
            new BN(params.buyOrderId),
            new BN(params.sellOrderId),
            new BN(params.matchPrice),
            new BN(params.matchQuantity)
          )
          .accounts({
            market: marketPDA,
            config: configPDA,
            buyOrder: params.buyOrder,
            sellOrder: params.sellOrder,
            keeper: wallet.publicKey,
            matchState: matchStatePDA,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
        console.log('Step 1 completed:', tx1);
      }

      // Ensure ATAs exist
      await ensureATA(buyYesMintPDA, buyOrderUser, buyUserYesATA);
      await ensureATA(buyNoMintPDA, buyOrderUser, buyUserNoATA);
      await ensureATA(sellYesMintPDA, sellOrderUser, sellUserYesATA);
      await ensureATA(sellNoMintPDA, sellOrderUser, sellUserNoATA);

      // Get vault authority and share escrow PDAs
      const [vaultAuthorityPDA] = getVaultAuthorityPDA(marketPDA);
      const [sellShareEscrowAuthorityPDA] = getShareEscrowAuthorityPDA(sellOrderUser, params.sellOrderId);
      const [sellShareEscrowYesPDA] = getShareEscrowYesPDA(sellOrderUser, params.sellOrderId);
      const [sellShareEscrowNoPDA] = getShareEscrowNoPDA(sellOrderUser, params.sellOrderId);
      
      // Get buyer's outcome account based on outcomeId
      // For multi-outcome markets, all outcomes trade YES shares
      // Only binary market's outcome 1 (NO) uses the NO path
      const isBuyBinaryNo = numOutcomes === 2 && buyOutcomeId === 1;
      const buyUserOutcomeATA = !isBuyBinaryNo ? buyUserYesATA : buyUserNoATA;

      // Step 2: Execute buyer side
      console.log(`Step 2: Executing buyer side (outcomeId: ${buyOutcomeId}, numOutcomes: ${numOutcomes})...`);
      let tx2: string;
      if (!isBuyBinaryNo) {
        // YES outcome (or multi-outcome) - use executeYesBuyerMatch
        tx2 = await program.methods
          .executeYesBuyerMatch()
          .accounts({
            market: marketPDA,
            matchState: matchStatePDA,
            buyOrder: params.buyOrder,
            keeper: wallet.publicKey,
            buyOrderEscrowAuthority: buyOrderEscrowAuthorityPDA,
            buyOrderEscrow: buyOrderEscrowPDA,
            yesMint: buyYesMintPDA,
            buyUserOutcomeAccount: buyUserOutcomeATA,
            sellShareEscrowAuthority: sellShareEscrowAuthorityPDA,
            sellShareEscrowYes: sellShareEscrowYesPDA,
            buyPosition: buyPositionPDA,
            marketVault: marketVaultPDA,
            vaultAuthority: vaultAuthorityPDA,
            marginVault: marginVaultPDA,
            marginVaultAuthority: marginVaultAuthorityPDA,
            liquidityVault: liquidityVaultPDA,
            liquidityVaultAuthority: liquidityVaultAuthorityPDA,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      } else {
        // Binary NO outcome - use executeNoBuyerMatch
        tx2 = await program.methods
          .executeNoBuyerMatch()
          .accounts({
            market: marketPDA,
            matchState: matchStatePDA,
            buyOrder: params.buyOrder,
            keeper: wallet.publicKey,
            buyOrderEscrowAuthority: buyOrderEscrowAuthorityPDA,
            buyOrderEscrow: buyOrderEscrowPDA,
            noMint: buyNoMintPDA,
            buyUserOutcomeAccount: buyUserOutcomeATA,
            sellShareEscrowAuthority: sellShareEscrowAuthorityPDA,
            sellShareEscrowNo: sellShareEscrowNoPDA,
            buyPosition: buyPositionPDA,
            marketVault: marketVaultPDA,
            vaultAuthority: vaultAuthorityPDA,
            marginVault: marginVaultPDA,
            marginVaultAuthority: marginVaultAuthorityPDA,
            liquidityVault: liquidityVaultPDA,
            liquidityVaultAuthority: liquidityVaultAuthorityPDA,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc();
      }
      console.log('Step 2 completed:', tx2);

      // Step 3: Execute seller side
      console.log('Step 3: Executing seller side...');
      const tx3 = await program.methods
        .executeSellerMatch()
        .accounts({
          market: marketPDA,
          matchState: matchStatePDA,
          sellOrder: params.sellOrder,
          keeper: wallet.publicKey,
          sellShareEscrowAuthority: sellShareEscrowAuthorityPDA,
          sellShareEscrowYes: sellShareEscrowYesPDA,
          sellShareEscrowNo: sellShareEscrowNoPDA,
          sellUserUsdcAccount: sellUserUsdcATA,
          marketVault: marketVaultPDA,
          vaultAuthority: vaultAuthorityPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
        })
        .rpc();
      console.log('Step 3 completed:', tx3);

      return { transaction: tx3, allTransactions: { tx1, tx2, tx3 } };
    } catch (error: any) {
      throw handleWalletError(error);
    } finally {
      setLoading(false);
    }
  };

  const cancelOrder = async (params: {
    orderId: number;
  }) => {
    if (!wallet.publicKey || !wallet.signTransaction || !provider || !program) {
      throw new Error('Wallet not connected or program not loaded');
    }

    setLoading(true);

    try {
      const [pendingOrderPDA] = getPendingOrderPDA(wallet.publicKey, params.orderId);

      // Check if the on-chain order still exists (it may have been filled/cancelled by the keeper)
      const pendingOrderInfo = await connection.getAccountInfo(pendingOrderPDA);
      if (!pendingOrderInfo) {
        console.log(`[cancelOrder] On-chain pendingOrder account not found for orderId ${params.orderId} — already filled or cancelled on-chain.`);
        // Return a flag so the caller knows to just update the DB
        return { transaction: null, alreadyProcessed: true };
      }

      // Fetch order to determine if it's buy or sell
      const orderAccount = await program.account.pendingOrder.fetch(pendingOrderPDA);
      const isSellOrder = orderAccount.side === 1;

      let tx: string;

      if (isSellOrder) {
        // Cancel sell order - return shares from share_escrow
        const marketPDA = new PublicKey(orderAccount.market as PublicKey);
        const outcomeId = orderAccount.outcomeId as number;

        // Fetch market to determine number of outcomes for correct routing
        const marketAccountData = await program.account.market.fetch(marketPDA);
        const numOutcomes = (marketAccountData.numOutcomes as number) ?? 2;

        // Determine if this is a NO sell order:
        // 1. Binary market outcome 1 always uses NO path
        // 2. Check share escrow type to determine YES vs NO for multi-outcome
        const isBinaryNo = numOutcomes === 2 && outcomeId === 1;

        // For cancel, check which escrow type was used by trying to read the NO escrow first
        const [shareEscrowNoPDACheck] = getShareEscrowNoPDA(wallet.publicKey, params.orderId);
        let isNoSellOrder = isBinaryNo;
        if (!isBinaryNo) {
          // For multi-outcome, check if NO share escrow exists (has data)
          try {
            const noEscrowInfo = await connection.getAccountInfo(shareEscrowNoPDACheck);
            if (noEscrowInfo && noEscrowInfo.data.length >= 40) {
              isNoSellOrder = true;
            }
          } catch { /* Not a NO sell order */ }
        }

        if (!isNoSellOrder) {
          const [shareEscrowYesPDA] = getShareEscrowYesPDA(wallet.publicKey, params.orderId);
          const [shareEscrowAuthorityPDA] = getShareEscrowAuthorityPDA(wallet.publicKey, params.orderId);
          const yesMintPDA = await resolveYesMintPDA(marketPDA, outcomeId);
          const [configPDA] = getConfigPDA();

          // Read escrow account to get its actual mint
          let escrowMint: PublicKey;

          try {
            const escrowAccountInfo = await connection.getAccountInfo(shareEscrowYesPDA);
            if (!escrowAccountInfo || escrowAccountInfo.data.length < 40) {
              throw new Error('Escrow account not found or invalid');
            }
            // Read mint from escrow account data (offset 0-32 for token account mint)
            const mintBytes = escrowAccountInfo.data.slice(0, 32);
            escrowMint = new PublicKey(mintBytes);
            console.log(`[Cancel] Escrow mint: ${escrowMint.toString()}`);
            console.log(`[Cancel] Expected YES mint: ${yesMintPDA.toString()}`);
          } catch (error) {
            // Fallback to expected YES mint if can't read escrow
            escrowMint = yesMintPDA;
            console.log(`[Cancel] Using fallback YES mint: ${escrowMint.toString()}`);
          }

          const userYesATA = await getAssociatedTokenAddress(escrowMint, wallet.publicKey);
          console.log(`[Cancel] User ATA for escrow mint: ${userYesATA.toString()}`);

          // Get position account — for leveraged close orders, use the position_key
          // stored in the order (avoids mismatch when both spot and leveraged positions exist)
          let positionPDA: PublicKey;
          const orderPositionKey = orderAccount.positionKey as PublicKey;
          if (orderAccount.isLeveragedClose && orderPositionKey && orderPositionKey.toString() !== PublicKey.default.toString()) {
            positionPDA = new PublicKey(orderPositionKey);
          } else {
            // Fallback: derive position PDA (try new then old format)
            let found = false;
            const [spotPositionPDA] = getPositionPDA(marketPDA, wallet.publicKey, outcomeId, 0, 0, 0);
            const [oldSpotPositionPDA] = getOldPositionPDA(marketPDA, wallet.publicKey, outcomeId, 0, 0);
            try {
              let spotPosition = await (program.account as any).position.fetch(spotPositionPDA).catch(() => null);
              if (spotPosition) { positionPDA = spotPositionPDA; found = true; }
              else {
                spotPosition = await (program.account as any).position.fetch(oldSpotPositionPDA).catch(() => null);
                if (spotPosition) { positionPDA = oldSpotPositionPDA; found = true; }
              }
            } catch { /* */ }
            if (!found) {
              const [leveragedPositionPDA] = getPositionPDA(marketPDA, wallet.publicKey, outcomeId, 0, 1, 0);
              const [oldLeveragedPositionPDA] = getOldPositionPDA(marketPDA, wallet.publicKey, outcomeId, 0, 1);
              try {
                let leveragedPosition = await (program.account as any).position.fetch(leveragedPositionPDA).catch(() => null);
                if (leveragedPosition) { positionPDA = leveragedPositionPDA; found = true; }
                else {
                  leveragedPosition = await (program.account as any).position.fetch(oldLeveragedPositionPDA).catch(() => null);
                  if (leveragedPosition) { positionPDA = oldLeveragedPositionPDA; found = true; }
                }
              } catch { /* */ }
            }
            if (!found) {
              // Try new PDA first, fall back to old
              const [newDefault] = getPositionPDA(marketPDA, wallet.publicKey, outcomeId, 0, 0, 0);
              const [oldDefault] = getOldPositionPDA(marketPDA, wallet.publicKey, outcomeId, 0, 0);
              const newInfo = await connection.getAccountInfo(newDefault);
              positionPDA = newInfo ? newDefault : oldDefault;
            }
          }

          // Check if user's ATA exists, if not create it first
          const userATAInfo = await connection.getAccountInfo(userYesATA);
          if (!userATAInfo) {
            console.log(`[Cancel] Creating ATA for mint ${escrowMint.toString()}`);
            const createATAIx = createAssociatedTokenAccountInstruction(
              wallet.publicKey,
              userYesATA,
              wallet.publicKey,
              escrowMint
            );
            
            // Build transaction with ATA creation + cancel
            const cancelIx = await program.methods
              .cancelSellOrder(new BN(params.orderId))
              .accounts({
                pendingOrder: pendingOrderPDA,
                user: wallet.publicKey,
                userYesAccount: userYesATA,
                shareEscrowAuthority: shareEscrowAuthorityPDA,
                shareEscrowYes: shareEscrowYesPDA,
                position: positionPDA,
                config: configPDA,
                tokenProgram: TOKEN_PROGRAM_ID,
              })
              .instruction();
            
            const { Transaction } = await import('@solana/web3.js');
            const combinedTx = new Transaction().add(createATAIx).add(cancelIx);
            tx = await provider.sendAndConfirm(combinedTx);
          } else {
            tx = await program.methods
              .cancelSellOrder(new BN(params.orderId))
              .accounts({
                pendingOrder: pendingOrderPDA,
                user: wallet.publicKey,
                userYesAccount: userYesATA,
                shareEscrowAuthority: shareEscrowAuthorityPDA,
                shareEscrowYes: shareEscrowYesPDA,
                position: positionPDA,
                config: configPDA,
                tokenProgram: TOKEN_PROGRAM_ID,
              })
              .preInstructions(priorityFeeIxs(300_000))
              .rpc();
          }
        } else {
          // NO sell orders (binary outcomeId=1 or multi-outcome with tokenType=no)
          const [shareEscrowNoPDA] = getShareEscrowNoPDA(wallet.publicKey, params.orderId);
          const [shareEscrowAuthorityPDA] = getShareEscrowAuthorityPDA(wallet.publicKey, params.orderId);
          const noMintPDA = await resolveNoMintPDA(marketPDA, outcomeId);
          const [configPDA] = getConfigPDA();

          // Read escrow account to get its actual mint
          let escrowMint: PublicKey;

          try {
            const escrowAccountInfo = await connection.getAccountInfo(shareEscrowNoPDA);
            if (!escrowAccountInfo || escrowAccountInfo.data.length < 40) {
              throw new Error('Escrow account not found or invalid');
            }
            // Read mint from escrow account data (offset 0-32 for token account mint)
            const mintBytes = escrowAccountInfo.data.slice(0, 32);
            escrowMint = new PublicKey(mintBytes);
            console.log(`[Cancel] Escrow mint: ${escrowMint.toString()}`);
            console.log(`[Cancel] Expected NO mint: ${noMintPDA.toString()}`);
          } catch (error) {
            // Fallback to expected NO mint if can't read escrow
            escrowMint = noMintPDA;
            console.log(`[Cancel] Using fallback NO mint: ${escrowMint.toString()}`);
          }

          const userNoATA = await getAssociatedTokenAddress(escrowMint, wallet.publicKey);
          console.log(`[Cancel] User ATA for escrow mint: ${userNoATA.toString()}`);

          // Get position account — for leveraged close orders, use the position_key
          // stored in the order (avoids mismatch when both spot and leveraged positions exist)
          let positionPDA: PublicKey;
          const orderPositionKeyNo = orderAccount.positionKey as PublicKey;
          if (orderAccount.isLeveragedClose && orderPositionKeyNo && orderPositionKeyNo.toString() !== PublicKey.default.toString()) {
            positionPDA = new PublicKey(orderPositionKeyNo);
          } else {
            let found = false;
            const [spotPositionPDA] = getPositionPDA(marketPDA, wallet.publicKey, outcomeId, 0, 0, 1);
            const [oldSpotPositionPDA] = getOldPositionPDA(marketPDA, wallet.publicKey, outcomeId, 0, 0);
            try {
              let spotPosition = await (program.account as any).position.fetch(spotPositionPDA).catch(() => null);
              if (spotPosition) { positionPDA = spotPositionPDA; found = true; }
              else {
                spotPosition = await (program.account as any).position.fetch(oldSpotPositionPDA).catch(() => null);
                if (spotPosition) { positionPDA = oldSpotPositionPDA; found = true; }
              }
            } catch { /* */ }
            if (!found) {
              const [leveragedPositionPDA] = getPositionPDA(marketPDA, wallet.publicKey, outcomeId, 0, 1, 1);
              const [oldLeveragedPositionPDA] = getOldPositionPDA(marketPDA, wallet.publicKey, outcomeId, 0, 1);
              try {
                let leveragedPosition = await (program.account as any).position.fetch(leveragedPositionPDA).catch(() => null);
                if (leveragedPosition) { positionPDA = leveragedPositionPDA; found = true; }
                else {
                  leveragedPosition = await (program.account as any).position.fetch(oldLeveragedPositionPDA).catch(() => null);
                  if (leveragedPosition) { positionPDA = oldLeveragedPositionPDA; found = true; }
                }
              } catch { /* */ }
            }
            if (!found) {
              const [newDefault] = getPositionPDA(marketPDA, wallet.publicKey, outcomeId, 0, 0, 1);
              const [oldDefault] = getOldPositionPDA(marketPDA, wallet.publicKey, outcomeId, 0, 0);
              const newInfo = await connection.getAccountInfo(newDefault);
              positionPDA = newInfo ? newDefault : oldDefault;
            }
          }

          // Check if user's ATA exists, if not create it first
          const userATAInfo = await connection.getAccountInfo(userNoATA);
          if (!userATAInfo) {
            console.log(`[Cancel] Creating ATA for mint ${escrowMint.toString()}`);
            const createATAIx = createAssociatedTokenAccountInstruction(
              wallet.publicKey,
              userNoATA,
              wallet.publicKey,
              escrowMint
            );
            
            // Build transaction with ATA creation + cancel
            const cancelAccounts: any = {
              pendingOrder: pendingOrderPDA,
              user: wallet.publicKey,
              userNoAccount: userNoATA,
              shareEscrowAuthority: shareEscrowAuthorityPDA,
              shareEscrowNo: shareEscrowNoPDA,
              position: positionPDA,
              config: configPDA,
              tokenProgram: TOKEN_PROGRAM_ID,
            };
            
            const cancelIx = await program.methods
              .cancelNoSellOrder(new BN(params.orderId))
              .accounts(cancelAccounts)
              .instruction();
            
            const { Transaction } = await import('@solana/web3.js');
            const combinedTx = new Transaction().add(createATAIx).add(cancelIx);
            tx = await provider.sendAndConfirm(combinedTx);
          } else {
            const cancelAccounts: any = {
              pendingOrder: pendingOrderPDA,
              user: wallet.publicKey,
              userNoAccount: userNoATA,
              shareEscrowAuthority: shareEscrowAuthorityPDA,
              shareEscrowNo: shareEscrowNoPDA,
              position: positionPDA,
              config: configPDA,
              tokenProgram: TOKEN_PROGRAM_ID,
            };
            
            tx = await program.methods
              .cancelNoSellOrder(new BN(params.orderId))
              .accounts(cancelAccounts)
              .preInstructions(priorityFeeIxs(300_000))
              .rpc();
          }
        }
      } else {
        // Cancel buy order - return quote token from order_escrow. The escrow
        // was created with the MARKET's quote mint (SPACE / USDC / etc.), so
        // hardcoding USDC_MINT here sent SPACE-market margin into the user's
        // USDC ATA (or MintMismatch'd the tx). Mirror the sell-cancel path:
        // read the escrow's mint at SPL offset 0..32 and derive the user ATA
        // from whatever mint is actually locked up.
        const [orderEscrowPDA] = getOrderEscrowPDA(wallet.publicKey, params.orderId);
        const [orderEscrowAuthorityPDA] = getOrderEscrowAuthorityPDA(wallet.publicKey, params.orderId);
        const [configPDA] = getConfigPDA();

        let escrowMint: PublicKey;
        try {
          const escrowInfo = await connection.getAccountInfo(orderEscrowPDA);
          if (!escrowInfo || escrowInfo.data.length < 32) {
            throw new Error('Order escrow account not found or invalid');
          }
          escrowMint = new PublicKey(escrowInfo.data.slice(0, 32));
          console.log(`[Cancel] Buy escrow mint: ${escrowMint.toString()}`);
        } catch (e) {
          console.warn(`[Cancel] Falling back to USDC mint for buy cancel:`, e);
          escrowMint = USDC_MINT;
        }

        const userQuoteATA = await getAssociatedTokenAddress(escrowMint, wallet.publicKey);

        // Create the user's quote-token ATA on the fly if it doesn't exist —
        // a user who only ever placed buys on a SPACE market may not have a
        // SPACE ATA yet, and cancel_order's SPL transfer would fail.
        const preIxs: any[] = [];
        const userQuoteATAInfo = await connection.getAccountInfo(userQuoteATA);
        if (!userQuoteATAInfo) {
          console.log(`[Cancel] Creating ATA for escrow mint ${escrowMint.toString()}`);
          preIxs.push(createAssociatedTokenAccountInstruction(
            wallet.publicKey,
            userQuoteATA,
            wallet.publicKey,
            escrowMint,
          ));
        }

        const builder = program.methods
          .cancelOrder(new BN(params.orderId))
          .accounts({
            pendingOrder: pendingOrderPDA,
            user: wallet.publicKey,
            userUsdc: userQuoteATA,
            orderEscrowAuthority: orderEscrowAuthorityPDA,
            orderEscrow: orderEscrowPDA,
            config: configPDA,
            tokenProgram: TOKEN_PROGRAM_ID,
          });

        tx = await builder
          .preInstructions([...priorityFeeIxs(300_000), ...preIxs])
          .rpc();
      }

      return { transaction: tx };
    } catch (error: any) {
      // If the error indicates the order no longer exists on-chain (race condition
      // with keeper), signal the caller so it can still clean up the backend DB.
      const errMsg = (error?.message || error?.toString() || '').toLowerCase();
      if (
        errMsg.includes('account does not exist') ||
        errMsg.includes('could not find') ||
        errMsg.includes('invalidorder') ||
        errMsg.includes('bad order') ||
        errMsg.includes('has already been processed')
      ) {
        console.warn('[cancelOrder] On-chain cancel failed (order likely already processed):', errMsg);
        return { transaction: null, alreadyProcessed: true };
      }
      throw handleWalletError(error);
    } finally {
      setLoading(false);
    }
  };

  const closePosition = async (params: {
    market: PublicKey | string;
    outcomeId: number;
    side: number;
    tokenType?: string;
    quoteMint?: string;
  }) => {
    if (!wallet.publicKey || !wallet.signTransaction || !provider || !program) {
      throw new Error('Wallet not connected or program not loaded');
    }

    setLoading(true);

    try {
      const marketPDA = typeof params.market === 'string' 
        ? new PublicKey(params.market) 
        : params.market;
      
      // Try both spot and leveraged positions to find the correct one (new + old PDA formats)
      const tokenTypeNum = params.tokenType === 'no' ? 1 : 0;
      const [positionPDA_Spot] = getPositionPDA(marketPDA, wallet.publicKey, params.outcomeId, params.side, 0, tokenTypeNum);
      const [positionPDA_Leveraged] = getPositionPDA(marketPDA, wallet.publicKey, params.outcomeId, params.side, 1, tokenTypeNum);
      const [oldPositionPDA_Spot] = getOldPositionPDA(marketPDA, wallet.publicKey, params.outcomeId, params.side, 0);
      const [oldPositionPDA_Leveraged] = getOldPositionPDA(marketPDA, wallet.publicKey, params.outcomeId, params.side, 1);

      // Fetch position accounts to find which one exists (new PDA first, then old)
      let positionAccount: any;
      let positionPDA: PublicKey;
      const pdaCandidates = [positionPDA_Leveraged, oldPositionPDA_Leveraged, positionPDA_Spot, oldPositionPDA_Spot];
      let foundPosition = false;
      for (const candidate of pdaCandidates) {
        try {
          positionAccount = await (program.account as any).position.fetch(candidate);
          positionPDA = candidate;
          foundPosition = true;
          break;
        } catch { /* continue */ }
      }
      if (!foundPosition) {
        throw new Error('Position not found. Please ensure the position exists and shares > 0.');
      }

      if (!positionAccount || !positionAccount.shares || positionAccount.shares.toNumber() === 0) {
        throw new Error('Position has no shares to close.');
      }

      // Check if this is a leveraged position (has borrowed_amount > 0)
      // Leveraged positions on active markets must use closeLeveragedPosition
      const borrowedAmount = positionAccount.borrowedAmount?.toNumber() || 0;
      if (borrowedAmount > 0) {
        // This is a leveraged position - use closeLeveragedPosition instead
        console.log('[closePosition] Detected leveraged position with borrowed_amount:', borrowedAmount);
        console.log('[closePosition] Redirecting to closeLeveragedPosition for proper debt settlement');
        
        // Release loading state before calling closeLeveragedPosition (which sets its own)
        setLoading(false);
        
        return closeLeveragedPosition({
          market: params.market,
          outcomeId: params.outcomeId,
          side: params.side,
          tokenType: params.tokenType,
        });
      }

      // Use the actual outcome_id from the position account
      const actualOutcomeId = Number(positionAccount.outcomeId);
      const yesMintPDA = await resolveYesMintPDA(marketPDA, actualOutcomeId);
      const noMintPDA = await resolveNoMintPDA(marketPDA, actualOutcomeId);
      const [vaultPDA] = getMarketVaultPDA(marketPDA);
      const [vaultAuthorityPDA] = getVaultAuthorityPDA(marketPDA);
      const [marginVaultPDA] = getMarginVaultPDA(marketPDA);
      const [marginVaultAuthorityPDA] = getMarginVaultAuthorityPDA(marketPDA);
      const [liquidityVaultPDA] = getLiquidityVaultPDA(marketPDA);
      const [liquidityVaultAuthorityPDA] = getLiquidityVaultAuthorityPDA(marketPDA);
      const resolvedQuoteMint = params.quoteMint ? new PublicKey(params.quoteMint) : USDC_MINT;
      const userUsdcATA = await getAssociatedTokenAddress(resolvedQuoteMint, wallet.publicKey);
      const userYesATA = await getAssociatedTokenAddress(yesMintPDA, wallet.publicKey);
      const userNoATA = await getAssociatedTokenAddress(noMintPDA, wallet.publicKey);

      // Check if user has sufficient shares in their token account (warning only, contract will validate)
      // Use tokenType to determine YES vs NO (works for both binary and multi-outcome)
      const isNoPosition = params.tokenType === 'no';
      try {
        const sharesNeeded = Number(positionAccount.shares.toNumber());
        const accountToCheck = isNoPosition ? userNoATA : userYesATA;
        const accountLabel = isNoPosition ? 'NO' : 'YES';
        try {
          const shareAccount = await getAccount(connection, accountToCheck);
          const availableShares = Number(shareAccount.amount.toString());
          if (availableShares < sharesNeeded) {
            console.warn(`Warning: Position shows ${sharesNeeded / 1e6} ${accountLabel} shares, but you only have ${availableShares / 1e6} in your wallet. Attempting to close with available shares...`);
          }
        } catch (ataError: any) {
          if (ataError.message?.includes('TokenAccountNotFoundError') || ataError.message?.includes('not found')) {
            throw new Error(`${accountLabel} token account not found. You need ${sharesNeeded / 1e6} shares for outcome ${actualOutcomeId}. Please ensure shares were transferred to your account during trade execution.`);
          }
          console.warn(`Error checking ${accountLabel} token account balance (contract will validate):`, ataError);
        }
      } catch (e: any) {
        // Re-throw specific errors, otherwise log and continue (contract will validate)
        if (e.message?.includes('token account not found')) throw e;
        console.warn('Error checking token account balance (contract will validate):', e);
      }

      const tx = await program.methods
        .closePosition()
        .accounts({
          market: marketPDA,
          position: positionPDA,
          user: wallet.publicKey,
          userUsdc: userUsdcATA,
          yesMint: yesMintPDA,
          noMint: noMintPDA,
          userYesAccount: userYesATA,
          userNoAccount: userNoATA,
          marketVault: vaultPDA,
          vaultAuthority: vaultAuthorityPDA,
          marginVault: marginVaultPDA,
          marginVaultAuthority: marginVaultAuthorityPDA,
          liquidityVault: liquidityVaultPDA,
          liquidityVaultAuthority: liquidityVaultAuthorityPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .preInstructions(priorityFeeIxs(400_000))
        .rpc();

      return { transaction: tx };
    } catch (error: any) {
      throw handleWalletError(error);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Close a leveraged position by placing a market sell order.
   * This properly sells shares on the market instead of burning them,
   * ensuring debt is repaid from actual sale proceeds.
   * 
   * For leveraged positions (borrowed_amount > 0), this function should be used
   * instead of closePosition to maintain proper invariants.
   */
  const closeLeveragedPosition = async (params: {
    market: PublicKey | string;
    outcomeId: number;
    side: number;
    sharesToClose?: number; // Optional: defaults to all shares
    minPrice?: number; // Optional: slippage protection (basis points)
    tokenType?: string; // 'yes' or 'no' — which token the position holds
  }) => {
    if (!wallet.publicKey || !wallet.signTransaction || !provider || !program) {
      throw new Error('Wallet not connected or program not loaded');
    }

    setLoading(true);

    try {
      const marketPDA = typeof params.market === 'string' 
        ? new PublicKey(params.market) 
        : params.market;
      
      // For leveraged positions, positionType = 1 (Leveraged) - try new then old PDA
      const leveragedTokenTypeNum = params.tokenType === 'no' ? 1 : 0;
      const [newPositionPDA] = getPositionPDA(marketPDA, wallet.publicKey, params.outcomeId, params.side, 1, leveragedTokenTypeNum);
      const [oldPositionPDA] = getOldPositionPDA(marketPDA, wallet.publicKey, params.outcomeId, params.side, 1);

      // Fetch the position account - try new PDA first, then old
      let positionAccount: any;
      let positionPDA: PublicKey;
      try {
        positionAccount = await (program.account as any).position.fetch(newPositionPDA);
        positionPDA = newPositionPDA;
      } catch (e) {
        try {
          positionAccount = await (program.account as any).position.fetch(oldPositionPDA);
          positionPDA = oldPositionPDA;
        } catch {
          throw new Error('Position not found. Please ensure the position exists.');
        }
      }

      if (!positionAccount || !positionAccount.shares || positionAccount.shares.toNumber() === 0) {
        throw new Error('Position has no shares to close.');
      }

      // Verify this is a leveraged position
      const borrowedAmount = positionAccount.borrowedAmount?.toNumber() || 0;
      if (borrowedAmount === 0) {
        // Not a leveraged position - use regular closePosition.
        // Pull the market's quote mint here and forward it so closePosition
        // doesn't fall back to USDC_MINT, which would mint-mismatch on
        // SPACE markets when the on-chain payout transfers from
        // market_vault → user_usdc.
        console.log('Position has no borrowed amount, using regular closePosition');
        let quoteMintForClose: string | undefined;
        try {
          const marketAcct: any = await (program.account as any).market.fetch(marketPDA);
          if (marketAcct?.quoteMint) {
            quoteMintForClose = new PublicKey(marketAcct.quoteMint).toString();
          }
        } catch { /* fall through; closePosition defaults to USDC */ }
        return closePosition({
          market: params.market,
          outcomeId: params.outcomeId,
          side: params.side,
          quoteMint: quoteMintForClose,
        });
      }

      const actualOutcomeId = Number(positionAccount.outcomeId);
      const positionShares = positionAccount.shares.toNumber();
      const sharesToClose = params.sharesToClose || positionShares;

      // Fetch market to determine num_outcomes for binary/multi-outcome routing
      let numOutcomes = 2;
      try {
        const marketAccount = await (program.account as any).market.fetch(marketPDA);
        numOutcomes = (marketAccount.numOutcomes as number) ?? 2;
      } catch { /* default to binary */ }
      const isBinaryNo = numOutcomes === 2 && actualOutcomeId === 1;
      // Determine if this is a NO token position (works for both binary and multi-outcome)
      const isNoPosition = params.tokenType === 'no' || isBinaryNo;

      // Generate a unique order ID
      const orderId = Date.now();
      const orderIdBN = new BN(orderId);

      // Get PDAs
      const [pendingOrderPDA] = getPendingOrderPDA(wallet.publicKey, orderId);
      const [shareEscrowAuthorityPDA] = getShareEscrowAuthorityPDA(wallet.publicKey, orderId);

      // Get the appropriate mint and escrow PDA based on outcome
      const yesMintPDA = await resolveYesMintPDA(marketPDA, actualOutcomeId);
      const noMintPDA = await resolveNoMintPDA(marketPDA, actualOutcomeId);

      // Use correct escrow PDA: ALL NO positions (binary and multi-outcome) use "share_escrow_no"
      // YES positions use "share_escrow"
      const shareEscrowPDA = isNoPosition
        ? getShareEscrowNoPDA(wallet.publicKey, orderId)[0]
        : getShareEscrowYesPDA(wallet.publicKey, orderId)[0];

      const [configPDA] = getConfigPDA();

      // Determine which mint and token account to use
      // For NO positions (binary or multi-outcome), use NO mint
      const shareMint = isNoPosition ? noMintPDA : yesMintPDA;
      const userShareATA = await getAssociatedTokenAddress(shareMint, wallet.publicKey);
      
      // Get order book to find best buy price
      // Must filter by tokenType to get bids for the correct token (YES or NO)
      // Binary: outcome 0 YES shares = tokenType 'yes', outcome 0 NO shares = tokenType 'no'
      // Multi-outcome: each outcome has YES/NO token types
      const marketId = marketPDA.toString();
      const closeTokenType: 'yes' | 'no' = isNoPosition ? 'no' : 'yes';
      let orderBook = await fetchOrderBook(marketId, actualOutcomeId, 100, closeTokenType);
      let bids = orderBook?.bids || [];

      // If REST API returned empty, retry after a short delay
      if (bids.length === 0) {
        console.warn('[closeLeveragedPosition] REST API returned empty bids, retrying...');
        await new Promise(resolve => setTimeout(resolve, 500));
        orderBook = await fetchOrderBook(marketId, actualOutcomeId, 100, closeTokenType);
        bids = orderBook?.bids || [];
      }
      
      console.log('[closeLeveragedPosition] Order book fetched:', {
        marketId,
        outcomeId: actualOutcomeId,
        bidsCount: bids.length,
        bids: bids.slice(0, 5).map((b: any) => ({ price: b.price, priceCents: b.price / 100, size: b.size })),
        orderBookUrl: `${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/v1/orderbook/${marketId}/${actualOutcomeId}`,
      });
      
      // Closing leveraged position is a market sell — sweep the entire order book.
      // Set min_price to 1 cent so the order can match at ALL price levels.
      // Each fill executes at the buyer's price, so the seller gets the best available.
      // The matching engine enforces: match_price >= sell_order.price
      const minPrice = params.minPrice || 100; // 1 cent default
      const orderPrice = bids.length > 0 ? bids[0].price : minPrice;

      console.log('[closeLeveragedPosition] Market sell - sweeping order book:', {
        bestBid: bids.length > 0 ? bids[0].price / 100 + '¢' : 'none',
        bidsCount: bids.length,
        minPrice: minPrice / 100 + '¢',
        orderPrice: orderPrice / 100 + '¢',
      });

      console.log('[closeLeveragedPosition] Closing leveraged position:', {
        market: marketPDA.toString(),
        position: positionPDA.toString(),
        sharesToClose,
        borrowedAmount,
        orderPrice,
        minPrice,
        orderId,
        shareMint: shareMint.toString(),
        userShareATA: userShareATA.toString(),
        shareEscrowPDA: shareEscrowPDA.toString(),
        shareEscrowAuthorityPDA: shareEscrowAuthorityPDA.toString(),
        pendingOrderPDA: pendingOrderPDA.toString(),
      });

      const tx = await program.methods
        .closeLeveragedPosition(
          orderIdBN,
          new BN(sharesToClose),
          new BN(minPrice) // Use minPrice (aggressive) to ensure matching - actual fill at buyer's price
        )
        .accounts({
          market: marketPDA,
          position: positionPDA,
          user: wallet.publicKey,
          pendingOrder: pendingOrderPDA,
          userShareAccount: userShareATA,
          shareEscrowAuthority: shareEscrowAuthorityPDA,
          shareEscrow: shareEscrowPDA,
          shareMint: shareMint,
          config: configPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        // Heavy: creates share escrow account + transfers shares + creates
        // the pending sell order in one ix.
        .preInstructions(priorityFeeIxs(600_000))
        .rpc();

      console.log('[closeLeveragedPosition] Sell order placed, tx:', tx);

      // Fetch the actual order price from on-chain
      let actualOrderPrice = minPrice;
      try {
        const pendingOrderAccount = await (program.account as any).pendingOrder.fetch(pendingOrderPDA);
        actualOrderPrice = pendingOrderAccount.price.toNumber();
        console.log('[closeLeveragedPosition] Order price from on-chain:', actualOrderPrice);
      } catch (error: any) {
        console.warn('[closeLeveragedPosition] Could not fetch order price, using minPrice:', error.message);
      }

      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

      // Step 1: Store the order in the database FIRST so the matching engine can find it
      try {
        const response = await fetch(`${apiUrl}/api/v1/orders/market`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-pubkey': wallet.publicKey.toString(),
          },
          body: JSON.stringify({
            market_id: marketPDA.toString(),
            outcome_id: actualOutcomeId,
            side: 'sell',
            size: sharesToClose,
            leverage: positionAccount.leverage || 1,
            price: actualOrderPrice,
            on_chain_order: pendingOrderPDA.toString(),
            order_id: orderId,
            token_type: closeTokenType,
          }),
        });

        if (!response.ok) {
          const errorData = await response.json().catch(() => ({ error: 'Unknown error' }));
          console.warn('[closeLeveragedPosition] Failed to store order in database:', errorData);
        } else {
          console.log('[closeLeveragedPosition] Order stored in database for matching');
        }
      } catch (error: any) {
        console.warn('[closeLeveragedPosition] Error storing order in database:', error.message);
      }

      // Step 2: Trigger matching immediately (same as MarketTradingPanel does)
      try {
        const matchResponse = await fetch(`${apiUrl}/api/v1/orderbook/${marketId}/${actualOutcomeId}/match`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        });
        if (matchResponse.ok) {
          const matchData = await matchResponse.json();
          console.log('[closeLeveragedPosition] Match triggered:', matchData);
        }
      } catch (matchError: any) {
        console.warn('[closeLeveragedPosition] Failed to trigger match:', matchError.message);
      }

      // Step 3: Wait briefly and check if the order was filled
      let orderExecuted = false;
      try {
        await new Promise(resolve => setTimeout(resolve, 3000));

        const pendingOrderAccount = await (program.account as any).pendingOrder.fetch(pendingOrderPDA);
        const orderStatus = pendingOrderAccount.status;
        const FILLED_STATUS = 2;
        const PARTIALLY_FILLED_STATUS = 1;

        if (orderStatus === FILLED_STATUS || orderStatus === PARTIALLY_FILLED_STATUS) {
          orderExecuted = true;
          console.log('[closeLeveragedPosition] Order executed successfully!');

          // Sync position after execution
          try {
            try {
              await fetch(`${apiUrl}/api/v1/positions/sync/${positionPDA.toString()}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  user: wallet.publicKey.toString(),
                  marketAddress: marketPDA.toString(),
                  outcomeId: actualOutcomeId,
                  side: params.side,
                  positionType: 1,
                }),
              });
              console.log('[closeLeveragedPosition] Position synced to database');
            } catch (syncError: any) {
              console.warn('[closeLeveragedPosition] Failed to sync specific position:', syncError.message);
            }

            try {
              await fetch(`${apiUrl}/api/v1/positions/cleanup?user=${wallet.publicKey.toString()}`, {
                method: 'POST',
              });
              console.log('[closeLeveragedPosition] Triggered position cleanup');
            } catch (cleanupError: any) {
              console.warn('[closeLeveragedPosition] Failed to trigger cleanup:', cleanupError.message);
            }
          } catch (error: any) {
            console.warn('[closeLeveragedPosition] Failed to sync positions:', error.message);
          }
        } else {
          // Order not executed - check if there's still a matching buy order
          const updatedOrderBook = await fetchOrderBook(marketId, actualOutcomeId, 100, closeTokenType);
          const updatedBids = updatedOrderBook?.bids || [];
          const stillHasMatch = updatedBids.some((bid: any) => bid.price >= minPrice);

          if (!stillHasMatch) {
            // No matching buy orders - cancel order and return shares
            console.warn('[closeLeveragedPosition] No matching buy orders found. Cancelling order...');

            try {
              const yesMintPDACancel = await resolveYesMintPDA(marketPDA, actualOutcomeId);
              const noMintPDACancel = await resolveNoMintPDA(marketPDA, actualOutcomeId);
              const shareMintForCancel = isNoPosition ? noMintPDACancel : yesMintPDACancel;
              const userShareATAForCancel = await getAssociatedTokenAddress(shareMintForCancel, wallet.publicKey);
              const [shareEscrowAuthorityPDACancel] = getShareEscrowAuthorityPDA(wallet.publicKey, orderId);
              const [configPDAForCancel] = getConfigPDA();

              let positionAccountForCancel: any = null;
              try {
                positionAccountForCancel = await (program.account as any).position.fetch(positionPDA);
              } catch (posError: any) {
                console.warn('[closeLeveragedPosition] Position account not found:', posError.message);
              }

              if (isNoPosition) {
                // NO position: use cancelNoSellOrder with share_escrow_no
                const [shareEscrowNoPDACancel] = getShareEscrowNoPDA(wallet.publicKey, orderId);
                const cancelAccounts: any = {
                  pendingOrder: pendingOrderPDA,
                  user: wallet.publicKey,
                  userNoAccount: userShareATAForCancel,
                  shareEscrowAuthority: shareEscrowAuthorityPDACancel,
                  shareEscrowNo: shareEscrowNoPDACancel,
                  position: positionAccountForCancel ? positionPDA : wallet.publicKey,
                  config: configPDAForCancel,
                  tokenProgram: TOKEN_PROGRAM_ID,
                };
                const cancelTx = await program.methods
                  .cancelNoSellOrder(new BN(orderId))
                  .accounts(cancelAccounts)
                  .rpc();
                console.log('[closeLeveragedPosition] NO order cancelled. Tx:', cancelTx);
                throw new Error('No matching buy orders available. Order cancelled and shares returned to your wallet.');
              } else {
                // YES position: use cancelSellOrder with share_escrow
                const [shareEscrowYesPDACancel] = getShareEscrowYesPDA(wallet.publicKey, orderId);
                const cancelAccounts: any = {
                  pendingOrder: pendingOrderPDA,
                  user: wallet.publicKey,
                  userYesAccount: userShareATAForCancel,
                  shareEscrowAuthority: shareEscrowAuthorityPDACancel,
                  shareEscrowYes: shareEscrowYesPDACancel,
                  position: positionAccountForCancel ? positionPDA : wallet.publicKey,
                  config: configPDAForCancel,
                  tokenProgram: TOKEN_PROGRAM_ID,
                };
                const cancelTx = await program.methods
                  .cancelSellOrder(new BN(orderId))
                  .accounts(cancelAccounts)
                  .rpc();
                console.log('[closeLeveragedPosition] YES order cancelled. Tx:', cancelTx);
                throw new Error('No matching buy orders available. Order cancelled and shares returned to your wallet.');
              }
            } catch (cancelError: any) {
              if (cancelError.message.includes('No matching buy orders')) {
                throw cancelError;
              }
              console.error('[closeLeveragedPosition] Failed to cancel order:', cancelError);
              throw new Error(`Order created but no matching buy orders found. Cancel failed: ${cancelError.message}. Please cancel the order manually (Order ID: ${orderId}) to get your shares back.`);
            }
          }
        }
      } catch (checkError: any) {
        if (checkError.message.includes('No matching buy orders') || checkError.message.includes('cancel')) {
          throw checkError;
        }
        console.warn('[closeLeveragedPosition] Could not verify order execution status:', checkError.message);
      }

      return { 
        transaction: tx,
        orderId,
        pendingOrder: pendingOrderPDA.toString(),
      };
    } catch (error: any) {
      throw handleWalletError(error);
    } finally {
      setLoading(false);
    }
  };

  const liquidatePosition = async (
    market: PublicKey,
    position: PublicKey
  ) => {
    if (!wallet.publicKey || !wallet.signTransaction || !provider || !program) {
      throw new Error('Wallet not connected or program not loaded');
    }

    setLoading(true);

    try {
      const [vaultPDA] = await getMarketVaultPDA(market);
      const [vaultAuthorityPDA] = await getVaultAuthorityPDA(market);
      const [insuranceFundPDA] = await getInsuranceFundPDA();
      const [insuranceVaultPDA] = await getInsuranceVaultPDA();
      const liquidatorUsdcATA = await getAssociatedTokenAddress(USDC_MINT, wallet.publicKey);

      const tx = await program.methods
        .liquidatePosition()
        .accounts({
          market: market,
          position: position,
          insuranceFund: insuranceFundPDA,
          insuranceVault: insuranceVaultPDA,
          marketVault: vaultPDA,
          vaultAuthority: vaultAuthorityPDA,
          liquidatorUsdc: liquidatorUsdcATA,
          liquidator: wallet.publicKey,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      return { transaction: tx };
    } catch (error: any) {
      throw handleWalletError(error);
    } finally {
      setLoading(false);
    }
  };

  const submitTwapData = async (
    market: PublicKey,
    price: number,
    timestamp: number
  ) => {
    if (!wallet.publicKey || !wallet.signTransaction || !provider || !program) {
      throw new Error('Wallet not connected or program not loaded');
    }

    setLoading(true);

    try {
      const [twapStatePDA] = getTwapStatePDA(market);
      const [oracleRegistryPDA] = await getOracleRegistryPDA();

      const tx = await program.methods
        .submitTwapData(new BN(price), new BN(timestamp))
        .accounts({
          market: market,
          twapState: twapStatePDA,
          oracleRegistry: oracleRegistryPDA,
          oracle: wallet.publicKey,
        })
        .rpc();

      return { transaction: tx };
    } catch (error: any) {
      throw handleWalletError(error);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Resolve market using TWAP (Time-Weighted Average Price)
   * Uses space_core's resolve_oracle with default evidence hash
   */
  const resolveMarketTwap = async (
    market: PublicKey,
    outcomeId: number
  ) => {
    console.log('[resolveMarketTwap] Called', {
      market: market.toString(),
      outcomeId,
      hasWallet: !!wallet.publicKey,
      hasProvider: !!provider,
      hasProgram: !!program,
    });

    if (!wallet.publicKey || !wallet.signTransaction || !provider || !program) {
      const errorMsg = !wallet.publicKey 
        ? 'Wallet not connected' 
        : !provider 
        ? 'Provider not available' 
        : !program 
        ? 'Program not loaded' 
        : 'Unknown error';
      console.error('[resolveMarketTwap] Validation failed:', errorMsg);
      throw new Error(errorMsg);
    }

    setLoading(true);

    try {
      // Get PDAs from space_core program
      const [configPDA] = getConfigPDA(SPACE_CORE_PROGRAM_ID);
      const [oracleRegistryPDA] = await getOracleRegistryPDA(SPACE_CORE_PROGRAM_ID);
      
      // Default evidence hash for TWAP resolution
      const evidenceHashArray = new Array(32).fill(0);
      
      console.log('[resolveMarketTwap] Building transaction with space_core', {
        market: market.toString(),
        config: configPDA.toString(),
        oracleRegistry: oracleRegistryPDA.toString(),
        resolver: wallet.publicKey.toString(),
        outcomeId,
      });

      // Call space_core's resolve_oracle for TWAP markets
      const tx = await program.methods
        .resolveOracle(outcomeId, evidenceHashArray)
        .accounts({
          market: market,
          config: configPDA,
          oracleRegistry: oracleRegistryPDA,
          resolver: wallet.publicKey,
        })
        .rpc();

      console.log('[resolveMarketTwap] Transaction successful:', tx);
      return { transaction: tx };
    } catch (error: any) {
      console.error('[resolveMarketTwap] Error:', error);
      throw handleWalletError(error);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Resolve market via oracle
   * Calls space_core directly (which owns the market account)
   */
  const resolveMarketOracle = async (
    market: PublicKey,
    outcomeId: number,
    evidenceHash?: number[] // Optional array of 32 u8 values
  ) => {
    console.log('[resolveMarketOracle] Called', {
      market: market.toString(),
      outcomeId,
      hasWallet: !!wallet.publicKey,
      hasProvider: !!provider,
      hasProgram: !!program,
      hasEvidenceHash: !!evidenceHash,
    });

    if (!wallet.publicKey || !wallet.signTransaction || !provider || !program) {
      const errorMsg = !wallet.publicKey 
        ? 'Wallet not connected' 
        : !provider 
        ? 'Provider not available' 
        : !program 
        ? 'Program not loaded' 
        : 'Unknown error';
      console.error('[resolveMarketOracle] Validation failed:', errorMsg);
      throw new Error(errorMsg);
    }

    setLoading(true);

    try {
      // Get PDAs from space_core program
      const [configPDA] = getConfigPDA(SPACE_CORE_PROGRAM_ID);
      const [oracleRegistryPDA] = await getOracleRegistryPDA(SPACE_CORE_PROGRAM_ID);
      
      // Convert evidenceHash to [u8; 32] format
      let evidenceHashArray: number[];
      if (evidenceHash && evidenceHash.length === 32) {
        evidenceHashArray = evidenceHash;
      } else {
        // Default to zeros if not provided
        evidenceHashArray = new Array(32).fill(0);
      }

      console.log('[resolveMarketOracle] Building transaction with space_core', {
        market: market.toString(),
        config: configPDA.toString(),
        oracleRegistry: oracleRegistryPDA.toString(),
        resolver: wallet.publicKey.toString(),
        outcomeId,
      });

      // Call space_core's resolve_oracle directly
      const tx = await program.methods
        .resolveOracle(outcomeId, evidenceHashArray)
        .accounts({
          market: market,
          config: configPDA,
          oracleRegistry: oracleRegistryPDA,
          resolver: wallet.publicKey,
        })
        .rpc();

      console.log('[resolveMarketOracle] Transaction successful:', tx);
      return { transaction: tx };
    } catch (error: any) {
      console.error('[resolveMarketOracle] Error:', error);
      throw handleWalletError(error);
    } finally {
      setLoading(false);
    }
  };

  const challengeResolution = async (
    market: PublicKey,
    bondAmount: number
  ) => {
    if (!wallet.publicKey || !wallet.signTransaction || !provider || !program) {
      throw new Error('Wallet not connected or program not loaded');
    }

    setLoading(true);

    try {
      const [vaultPDA] = await getMarketVaultPDA(market);
      const challengerUsdcATA = await getAssociatedTokenAddress(USDC_MINT, wallet.publicKey);

      console.log('[challengeResolution] Calling space_core challenge_resolution', {
        market: market.toString(),
        challenger: wallet.publicKey.toString(),
        bondAmount,
      });

      // Call space_core's challenge_resolution directly
      const tx = await program.methods
        .challengeResolution(new BN(bondAmount))
        .accounts({
          market: market,
          challenger: wallet.publicKey,
          challengerUsdc: challengerUsdcATA,
          marketVault: vaultPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      console.log('[challengeResolution] Transaction successful:', tx);
      return { transaction: tx };
    } catch (error: any) {
      console.error('[challengeResolution] Error:', error);
      throw handleWalletError(error);
    } finally {
      setLoading(false);
    }
  };

  const markInvalid = async (market: PublicKey) => {
    if (!wallet.publicKey || !wallet.signTransaction || !provider || !program) {
      throw new Error('Wallet not connected or program not loaded');
    }

    setLoading(true);

    try {
      const [configPDA] = getConfigPDA(SPACE_CORE_PROGRAM_ID);

      console.log('[markInvalid] Calling space_core mark_invalid', {
        market: market.toString(),
        admin: wallet.publicKey.toString(),
      });

      // Call space_core's mark_invalid directly
      const tx = await program.methods
        .markInvalid()
        .accounts({
          market: market,
          config: configPDA,
          admin: wallet.publicKey,
        })
        .rpc();

      console.log('[markInvalid] Transaction successful:', tx);
      return { transaction: tx };
    } catch (error: any) {
      console.error('[markInvalid] Error:', error);
      throw handleWalletError(error);
    } finally {
      setLoading(false);
    }
  };

  const finalizeMarket = async (market: PublicKey) => {
    if (!wallet.publicKey || !wallet.signTransaction || !provider || !program) {
      throw new Error('Wallet not connected or program not loaded');
    }

    setLoading(true);

    try {
      console.log('[finalizeMarket] Calling space_core finalize_market', {
        market: market.toString(),
      });

      // Call space_core's finalize_market directly
      const tx = await program.methods
        .finalizeMarket()
        .accounts({
          market: market,
        })
        .rpc();

      console.log('[finalizeMarket] Transaction successful:', tx);
      return { transaction: tx };
    } catch (error: any) {
      console.error('[finalizeMarket] Error:', error);
      throw handleWalletError(error);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Redeem winning shares after market is finalized
   * Burns winning shares and receives $1 USDC per share
   * Calls space_core directly (which owns the vault authority)
   */
  const redeemShares = async (params: {
    market: PublicKey | string;
    amount: number; // Amount of shares to redeem (in raw units with 6 decimals)
    /** Market's quote decimals. Defaults to USDC (6). Drives the status
     *  message formatting so SPACE markets don't print USDC numbers. */
    quoteDecimals?: number;
    /** Market's quote symbol for status messages (default "USDC"). */
    quoteSymbol?: string;
  }) => {
    if (!wallet.publicKey || !wallet.signTransaction || !provider || !program) {
      throw new Error('Wallet not connected or program not loaded');
    }

    setLoading(true);

    try {
      const marketPDA = typeof params.market === 'string'
        ? new PublicKey(params.market)
        : params.market;

      // Fetch market to get the resolved outcome
      const marketAccount = await program.account.market.fetch(marketPDA);
      const resolvedOutcome = (marketAccount.resolvedOutcome as number | null);

      if (resolvedOutcome === null || resolvedOutcome === undefined) {
        throw new Error('Market has not been resolved yet');
      }

      // Check market status is Finalized (3)
      const status = marketAccount.status as number;
      if (status !== 3) {
        throw new Error('Market is not finalized yet. Please wait for the challenge period to end.');
      }

      // Get other required PDAs (one set per market — same across all outcomes)
      const [vaultPDA] = getMarketVaultPDA(marketPDA);
      const [vaultAuthorityPDA] = getVaultAuthorityPDA(marketPDA);
      const marketQuoteMint = (marketAccount as any).quoteMint
        ? new PublicKey((marketAccount as any).quoteMint)
        : USDC_MINT;
      const userUsdcATA = await getAssociatedTokenAddress(marketQuoteMint, wallet.publicKey);

      // Walk EVERY outcome and find ones the user holds tokens in. The
      // on-chain redeem_shares is per-outcome — calling it with outcome_id
      // burns user_yes_account and user_no_account FOR THAT outcome and
      // pays out whichever side won (YES if outcome_id == winning, NO
      // otherwise). Previously this function called it once with
      // `resolvedOutcome`, which silently missed any user position held
      // on a *different* outcome (the typical "Buy NO" flow puts the
      // user in `no_mint_0` even when outcome 1 wins, so the redeem saw
      // zero balance and threw "no winning shares").
      const numOutcomes = (marketAccount.numOutcomes as number) ?? 2;

      type OutcomeRedeemInfo = {
        outcomeId: number;
        yesMintPDA: PublicKey;
        noMintPDA: PublicKey;
        userYesATA: PublicKey;
        userNoATA: PublicKey;
        yesBalance: number;
        noBalance: number;
        /** Shares that pay $1 each on this outcome's redemption. */
        winningSharesOnThisOutcome: number;
      };

      const outcomesToRedeem: OutcomeRedeemInfo[] = [];
      let totalWinningShares = 0;

      for (let i = 0; i < numOutcomes; i++) {
        const yesMintPDA = await resolveYesMintPDA(marketPDA, i);
        const noMintPDA = await resolveNoMintPDA(marketPDA, i);
        const userYesATA = await getAssociatedTokenAddress(yesMintPDA, wallet.publicKey);
        const userNoATA = await getAssociatedTokenAddress(noMintPDA, wallet.publicKey);

        let yesBalance = 0;
        let noBalance = 0;
        try {
          const yesAccount = await getAccount(connection, userYesATA);
          yesBalance = Number(yesAccount.amount);
        } catch { /* ATA doesn't exist */ }
        try {
          const noAccount = await getAccount(connection, userNoATA);
          noBalance = Number(noAccount.amount);
        } catch { /* ATA doesn't exist */ }

        // Skip outcomes the user has zero balance in — no point in calling
        // redeem_shares for them (would just be a no-op tx that costs gas).
        if (yesBalance === 0 && noBalance === 0) continue;

        // Per the on-chain rule: redeem_shares(i) pays yes_balance if
        // i == winning_outcome, else pays no_balance. So the winning side
        // for THIS outcome's redemption is one of those two.
        const winningSharesOnThisOutcome =
          i === resolvedOutcome ? yesBalance : noBalance;

        outcomesToRedeem.push({
          outcomeId: i,
          yesMintPDA,
          noMintPDA,
          userYesATA,
          userNoATA,
          yesBalance,
          noBalance,
          winningSharesOnThisOutcome,
        });
        totalWinningShares += winningSharesOnThisOutcome;
      }

      if (outcomesToRedeem.length === 0) {
        throw new Error(
          'You have no shares to redeem on this market.',
        );
      }
      if (totalWinningShares === 0) {
        throw new Error(
          'You hold shares on this market but none are winning shares — all of your tokens are on the losing side.',
        );
      }

      // Check for leveraged positions and prepare position accounts for on-chain repayment
      // The program will automatically repay borrowed amounts from the payout
      const positionAccounts: PublicKey[] = [];
      let totalBorrowedAmount = 0;
      
      // Derive all possible position PDAs and check if they exist (new + old PDA formats)
      // For multi-outcome markets, check all outcomes (not just 0 and 1)
      for (let outcomeCheck = 0; outcomeCheck < (marketAccount.numOutcomes as number); outcomeCheck++) {
        for (let sideCheck = 0; sideCheck < 2; sideCheck++) {
          for (let tokenTypeCheck = 0; tokenTypeCheck < 2; tokenTypeCheck++) {
            // Try new PDA format
            try {
              const [positionPDA] = getPositionPDA(marketPDA, wallet.publicKey, outcomeCheck, sideCheck, 1, tokenTypeCheck);
              try {
                const position = await program.account.position.fetch(positionPDA);
                if ((position as any).borrowedAmount && (position as any).borrowedAmount > 0 && (position as any).shares > 0) {
                  totalBorrowedAmount += Number((position as any).borrowedAmount);
                  console.log('[redeemShares] Found leveraged position with debt:', {
                    position: positionPDA.toString(),
                    borrowedAmount: (position as any).borrowedAmount.toString(),
                    outcomeId: (position as any).outcomeId,
                    side: (position as any).side,
                    tokenType: tokenTypeCheck,
                  });
                }
                positionAccounts.push(positionPDA);
              } catch (e) {
                // Position doesn't exist at new PDA, try old PDA
                try {
                  const [oldPositionPDA] = getOldPositionPDA(marketPDA, wallet.publicKey, outcomeCheck, sideCheck, 1);
                  const oldPosition = await program.account.position.fetch(oldPositionPDA);
                  if ((oldPosition as any).borrowedAmount && (oldPosition as any).borrowedAmount > 0 && (oldPosition as any).shares > 0) {
                    totalBorrowedAmount += Number((oldPosition as any).borrowedAmount);
                    console.log('[redeemShares] Found leveraged position with debt (old PDA):', {
                      position: oldPositionPDA.toString(),
                      borrowedAmount: (oldPosition as any).borrowedAmount.toString(),
                    });
                  }
                  positionAccounts.push(oldPositionPDA);
                } catch { /* old PDA doesn't exist either */ }
              }
            } catch (e) {
              // Error deriving PDA, continue
            }
          }
        }
      }

      // Shared PDAs and ATAs — same across all per-outcome redeem calls.
      const [liquidityVaultPDA] = getLiquidityVaultPDA(marketPDA);
      const [liquidityVaultAuthorityPDA] = getLiquidityVaultAuthorityPDA(marketPDA);
      const [configPDA] = getConfigPDA(SPACE_CORE_PROGRAM_ID);

      // Build the position-accounts remaining-accounts list once. We pass
      // these only on the FIRST redeem call below — the on-chain handler
      // sums borrowed_amount across all positions in remaining_accounts to
      // decide how much to pull from the market vault into the liquidity
      // vault. Passing them on every redeem would double-count debt.
      const remainingAccounts = positionAccounts.map((positionPDA) => ({
        pubkey: positionPDA,
        isSigner: false,
        isWritable: false,
      }));

      // Aggregate results across all per-outcome redeem txs.
      const txSignatures: string[] = [];
      let totalRedeemedShares = 0;

      for (let idx = 0; idx < outcomesToRedeem.length; idx++) {
        const o = outcomesToRedeem[idx];
        const isFirstTx = idx === 0;

        // Per-outcome preInstructions: ensure both share-mint ATAs exist
        // (the program reads them even if balance is 0). The USDC ATA only
        // needs to be created once — fold that into the first tx.
        const perTxPreIxs: TransactionInstruction[] = [];

        if (o.yesBalance === 0) {
          try {
            await getAccount(connection, o.userYesATA);
          } catch {
            perTxPreIxs.push(
              createAssociatedTokenAccountInstruction(
                wallet.publicKey,
                o.userYesATA,
                wallet.publicKey,
                o.yesMintPDA,
              ),
            );
          }
        }
        if (o.noBalance === 0) {
          try {
            await getAccount(connection, o.userNoATA);
          } catch {
            perTxPreIxs.push(
              createAssociatedTokenAccountInstruction(
                wallet.publicKey,
                o.userNoATA,
                wallet.publicKey,
                o.noMintPDA,
              ),
            );
          }
        }
        if (isFirstTx) {
          // USDC ATA: must use the MARKET's quote mint (USDC for legacy,
          // SPACE for SPACE markets). The previous code hardcoded USDC_MINT
          // here, which derived a different ATA address than userUsdcATA on
          // SPACE markets and could create the wrong account.
          try {
            await getAccount(connection, userUsdcATA);
          } catch {
            perTxPreIxs.push(
              createAssociatedTokenAccountInstruction(
                wallet.publicKey,
                userUsdcATA,
                wallet.publicKey,
                marketQuoteMint,
              ),
            );
          }
        }

        console.log(`[redeemShares] redeem_shares for outcome ${o.outcomeId}`, {
          market: marketPDA.toString(),
          user: wallet.publicKey.toString(),
          yesBalance: o.yesBalance,
          noBalance: o.noBalance,
          willPayOnThisTx: o.winningSharesOnThisOutcome,
          isFirstTx,
        });

        const txBuilder = program.methods
          .redeemShares(o.outcomeId)
          .accounts({
            market: marketPDA,
            user: wallet.publicKey,
            userUsdc: userUsdcATA,
            yesMint: o.yesMintPDA,
            noMint: o.noMintPDA,
            userYesAccount: o.userYesATA,
            userNoAccount: o.userNoATA,
            marketVault: vaultPDA,
            vaultAuthority: vaultAuthorityPDA,
            liquidityVault: liquidityVaultPDA,
            liquidityVaultAuthority: liquidityVaultAuthorityPDA,
            config: configPDA,
            tokenProgram: TOKEN_PROGRAM_ID,
          })
          .preInstructions([...priorityFeeIxs(400_000), ...perTxPreIxs]);

        // Pass leveraged-position accounts only on the first call to avoid
        // double-counting borrowed amounts in the on-chain repayment math.
        if (isFirstTx && remainingAccounts.length > 0) {
          txBuilder.remainingAccounts(remainingAccounts);
        }

        const sig = await txBuilder.rpc();
        txSignatures.push(sig);
        totalRedeemedShares += o.winningSharesOnThisOutcome;
        console.log(`[redeemShares] outcome ${o.outcomeId} done, sig: ${sig}`);

        // Persist the redemption on the backend so the resolved-positions
        // tab can show the historical payout AFTER `shares` is zeroed.
        // Fire-and-forget — the on-chain tx is the source of truth; this
        // is just a UX cache. Both sides (yes_balance and no_balance) are
        // burned on the same tx, so we record both with their respective
        // tokenType. Either or both can be 0.
        const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
        const recordRedemption = async (tokenType: 'yes' | 'no', shares: number) => {
          if (shares <= 0) return;
          try {
            await fetch(`${apiUrl}/api/v1/positions/record-redemption`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                user: wallet.publicKey!.toString(),
                marketAddress: marketPDA.toString(),
                outcomeId: o.outcomeId,
                tokenType,
                sharesRedeemed: shares.toString(),
                txSignature: sig,
              }),
            });
          } catch (e) {
            console.warn('[redeemShares] record-redemption POST failed (non-fatal):', e);
          }
        };
        await Promise.all([
          recordRedemption('yes', o.yesBalance),
          recordRedemption('no', o.noBalance),
        ]);
      }

      // Format the aggregate status message in the market's quote token.
      // shares balance (6 dec) redeems 1:1 to quote base units via the
      // on-chain quote_scale, so totalRedeemedShares / 1e6 equals the
      // human quote value received. totalBorrowedAmount is in quote base
      // units (scaled by the quote's real decimals).
      const qDec = params.quoteDecimals ?? 6;
      const qUnit = Math.pow(10, qDec);
      const qSym = params.quoteSymbol ?? 'USDC';
      const receivedHuman = totalRedeemedShares / 1_000_000;
      const netReceivedHuman = Math.max(0, receivedHuman - totalBorrowedAmount / qUnit);

      let message: string;
      if (totalBorrowedAmount > 0) {
        message = `Redeemed shares across ${outcomesToRedeem.length} outcome(s). Borrowed ${(totalBorrowedAmount / qUnit).toFixed(2)} ${qSym} repaid. You received ${netReceivedHuman.toFixed(2)} ${qSym}. Check your wallet balance.`;
      } else {
        message = `Redeemed shares across ${outcomesToRedeem.length} outcome(s). You received ${receivedHuman.toFixed(2)} ${qSym}. Check your wallet balance.`;
      }

      return {
        transaction: txSignatures[0], // Backwards-compat: first signature
        transactions: txSignatures,
        redeemedAmount: totalRedeemedShares,
        borrowedAmountRepaid: totalBorrowedAmount,
        usdcReceived: Math.max(0, totalRedeemedShares * (qUnit / 1_000_000) - totalBorrowedAmount),
        message,
      };
    } catch (error: any) {
      console.error('[redeemShares] Error:', error);
      throw handleWalletError(error);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Settle a leveraged position
   * - For active markets: Uses closeLeveragedPosition (places market sell order)
   * - For finalized markets: Uses closePosition (direct settlement)
   */
  const settleLeveragedPosition = async (params: {
    market: PublicKey | string;
    positionPDA: PublicKey | string;
    tokenType?: string; // 'yes' or 'no'
  }) => {
    if (!wallet.publicKey || !wallet.signTransaction || !provider || !program) {
      throw new Error('Wallet not connected or program not loaded');
    }

    setLoading(true);

    try {
      const marketPDA = typeof params.market === 'string' 
        ? new PublicKey(params.market) 
        : params.market;
      
      const positionPDA = typeof params.positionPDA === 'string'
        ? new PublicKey(params.positionPDA)
        : params.positionPDA;
      
      // Fetch market to check status
      const marketAccount = await program.account.market.fetch(marketPDA);
      const marketStatus = marketAccount.status as number;
      const isFinalized = marketStatus === 3; // MarketStatus::Finalized = 3
      
      // Fetch position to get outcome_id and side
      const positionAccount = await program.account.position.fetch(positionPDA);
      const outcomeId = positionAccount.outcomeId as number;
      const numOutcomes = (marketAccount.numOutcomes as number) ?? 2;
      // For multi-outcome markets, all outcomes are YES-side (side=0)
      // Only binary market's outcome 1 is NO-side (side=1)
      const side = (numOutcomes === 2 && outcomeId === 1) ? 1 : 0;
      
      console.log('[settleLeveragedPosition] Market status:', {
        market: marketPDA.toString(),
        position: positionPDA.toString(),
        status: marketStatus,
        isFinalized,
        outcomeId,
        side,
      });

      // If market is active, use closeLeveragedPosition (places market sell order)
      if (!isFinalized) {
        console.log('[settleLeveragedPosition] Market is active - using closeLeveragedPosition');
        setLoading(false); // Release loading before calling closeLeveragedPosition
        return await closeLeveragedPosition({
          market: marketPDA,
          outcomeId,
          side,
          tokenType: params.tokenType,
        });
      }

      // Market is finalized. For WINNING leveraged positions we must NOT
      // call close_position — its on-chain payout draws from margin_vault
      // (which only holds the user's deposited collateral) and caps at
      // margin_vault_balance, which strands the trade-profit portion of
      // the user's equity in market_vault. redeem_shares pays the full
      // share-value from market_vault and uses the remaining_accounts
      // mechanism to repay the leveraged debt, which is what we want.
      const resolvedOutcome = (marketAccount as any).resolvedOutcome as number | null | undefined;
      const positionTokenType = ((positionAccount as any).tokenType as number | undefined) ?? 0;
      const positionWon = resolvedOutcome !== null && resolvedOutcome !== undefined && (
        positionTokenType === 0
          ? outcomeId === resolvedOutcome   // YES of resolved outcome wins
          : outcomeId !== resolvedOutcome   // NO of any other outcome wins
      );

      if (positionWon) {
        console.log('[settleLeveragedPosition] WINNING leveraged on finalized market — routing to redeemShares so the profit gets paid from market_vault (close_position would only return collateral)');
        setLoading(false);
        return await redeemShares({
          market: marketPDA,
          amount: 0, // ignored by redeemShares; it iterates outcomes and burns winning balances
          quoteDecimals: (marketAccount as any).quoteDecimals ?? 6,
          quoteSymbol: (marketAccount as any).quoteSymbol ?? 'USDC',
        });
      }

      // Losing leveraged position on a finalized market — close_position is
      // the right call: it pays debt from market_vault, takes shortfall from
      // margin_vault (consuming the user's collateral), and pays user 0.
      console.log('[settleLeveragedPosition] LOSING leveraged on finalized market — using closePosition (collateral covers debt)');
      
      // Get required mints and token accounts
      const yesMintPDA = await resolveYesMintPDA(marketPDA, outcomeId);
      const noMintPDA = await resolveNoMintPDA(marketPDA, outcomeId);
      const userYesATA = await getAssociatedTokenAddress(yesMintPDA, wallet.publicKey);
      const userNoATA = await getAssociatedTokenAddress(noMintPDA, wallet.publicKey);

      // Get all required PDAs
      const [vaultPDA] = getMarketVaultPDA(marketPDA);
      const [vaultAuthorityPDA] = getVaultAuthorityPDA(marketPDA);
      const [marginVaultPDA] = getMarginVaultPDA(marketPDA);
      const [marginVaultAuthorityPDA] = getMarginVaultAuthorityPDA(marketPDA);
      const [liquidityVaultPDA] = getLiquidityVaultPDA(marketPDA);
      const [liquidityVaultAuthorityPDA] = getLiquidityVaultAuthorityPDA(marketPDA);
      // Use the market's actual quote mint (USDC for legacy markets, SPACE
      // for SPACE-quoted markets, etc.). Hardcoding USDC_MINT here was the
      // reason settle on a SPACE market silently paid 0: the on-chain
      // close_position payout is `Transfer(margin_vault → userUsdc)`, but
      // we were passing the user's USDC ATA while margin_vault holds SPC,
      // so any non-zero payout would have hit MintMismatch (0x3). The
      // tx didn't error only because actual_payout was 0 (compounding
      // overflow bug — margin_vault had no funds for this position
      // anyway), so the on-chain `if actual_payout > 0` guard skipped
      // the doomed transfer entirely.
      const marketQuoteMint = (marketAccount as any).quoteMint
        ? new PublicKey((marketAccount as any).quoteMint)
        : USDC_MINT;
      const userUsdcATA = await getAssociatedTokenAddress(marketQuoteMint, wallet.publicKey);

      // Ensure all required ATAs exist — the program expects valid token accounts
      const preInstructions = [];
      try { await getAccount(connection, userYesATA); } catch {
        preInstructions.push(createAssociatedTokenAccountInstruction(wallet.publicKey, userYesATA, wallet.publicKey, yesMintPDA));
      }
      try { await getAccount(connection, userNoATA); } catch {
        preInstructions.push(createAssociatedTokenAccountInstruction(wallet.publicKey, userNoATA, wallet.publicKey, noMintPDA));
      }
      try { await getAccount(connection, userUsdcATA); } catch {
        // Create against the *market's* quote mint, not USDC — otherwise
        // we'd derive an ATA address that doesn't match the mint we're
        // about to initialize it for, and the create instruction would
        // fail (or worse, succeed for the wrong mint).
        preInstructions.push(createAssociatedTokenAccountInstruction(wallet.publicKey, userUsdcATA, wallet.publicKey, marketQuoteMint));
      }

      // Use close_position from space_core (which owns the vault authority PDAs)
      const tx = await program.methods
        .closePosition()
        .accounts({
          market: marketPDA,
          position: positionPDA,
          user: wallet.publicKey,
          userUsdc: userUsdcATA,
          yesMint: yesMintPDA,
          noMint: noMintPDA,
          userYesAccount: userYesATA,
          userNoAccount: userNoATA,
          marketVault: vaultPDA,
          vaultAuthority: vaultAuthorityPDA,
          marginVault: marginVaultPDA,
          marginVaultAuthority: marginVaultAuthorityPDA,
          liquidityVault: liquidityVaultPDA,
          liquidityVaultAuthority: liquidityVaultAuthorityPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .preInstructions([...priorityFeeIxs(500_000), ...preInstructions])
        .rpc();

      console.log('[settleLeveragedPosition] Transaction successful:', tx);
      return { 
        transaction: tx,
        positionSettled: true,
      };
    } catch (error: any) {
      console.error('[settleLeveragedPosition] Error:', error);
      throw handleWalletError(error);
    } finally {
      setLoading(false);
    }
  };

  /**
   * Unified function to settle market position: 
   * - If user has leveraged position, it closes the leveraged position
   * - Otherwise, it redeems shares
   */
  const settleMarketPosition = async (params: {
    market: PublicKey | string;
    winningBalance?: number; // Optional: winning balance for redeem
  }) => {
    if (!wallet.publicKey || !wallet.signTransaction || !provider || !program) {
      throw new Error('Wallet not connected or program not loaded');
    }

    setLoading(true);

    try {
      const marketPDA = typeof params.market === 'string' 
        ? new PublicKey(params.market) 
        : params.market;

      // Fetch market to verify it's finalized
      const marketAccount = await program.account.market.fetch(marketPDA);
      const status = marketAccount.status as number;
      if (status !== 3) { // MarketStatus::Finalized = 3
        throw new Error('Market is not finalized yet. Please wait for the challenge period to end.');
      }

      const resolvedOutcome = (marketAccount.resolvedOutcome as number | null);
      if (resolvedOutcome === null || resolvedOutcome === undefined) {
        throw new Error('Market has not been resolved yet');
      }

      console.log('[settleMarketPosition] Checking for leveraged positions', {
        market: marketPDA.toString(),
        user: wallet.publicKey.toString(),
      });

      // Check for leveraged positions (new + old PDA formats)
      let leveragedPositionPDA: PublicKey | null = null;
      let leveragedIsWinner: boolean = false;

      // Helper to try fetching position at new PDA, then old PDA
      const tryFetchPosition = async (outcomeId: number, side: number, positionType: number, tokenType: number): Promise<{ pda: PublicKey; account: any; tokenType: number } | null> => {
        // Try new PDA
        try {
          const [newPDA] = getPositionPDA(marketPDA, wallet.publicKey, outcomeId, side, positionType, tokenType);
          const account = await program.account.position.fetch(newPDA);
          return { pda: newPDA, account, tokenType };
        } catch { /* */ }
        // Try old PDA (pre-tokenType migration — always YES)
        try {
          const [oldPDA] = getOldPositionPDA(marketPDA, wallet.publicKey, outcomeId, side, positionType);
          const account = await program.account.position.fetch(oldPDA);
          return { pda: oldPDA, account, tokenType: 0 };
        } catch { /* */ }
        return null;
      };

      // Search across ALL outcomes (not just 0/1), sides, and token types
      const numOutcomes = (marketAccount.numOutcomes as number) ?? 2;
      for (let outcomeCheck = 0; outcomeCheck < numOutcomes && !leveragedPositionPDA; outcomeCheck++) {
        for (const side of [0, 1]) {
          for (const tokenType of [0, 1]) {
            const result = await tryFetchPosition(outcomeCheck, side, 1, tokenType); // positionType=1 (leveraged)
            if (result) {
              const leverage = result.account.leverage as number;
              const shares = (result.account.shares as any).toNumber();
              if (leverage > 1 && shares > 0) {
                leveragedPositionPDA = result.pda;
                // Per-outcome-NO model: YES wins iff outcome_id == resolved, NO wins iff outcome_id != resolved.
                // Prefer on-chain tokenType from the fetched account; fall back to loop index for old-PDA positions.
                const effectiveTokenType = ((result.account as any).tokenType as number | undefined) ?? result.tokenType;
                leveragedIsWinner = effectiveTokenType === 1
                  ? outcomeCheck !== resolvedOutcome
                  : outcomeCheck === resolvedOutcome;
                console.log(`[settleMarketPosition] Found leveraged position for outcome ${outcomeCheck}, side ${side}, tokenType ${effectiveTokenType}`, {
                  position: result.pda.toString(),
                  leverage,
                  shares,
                  isWinner: leveragedIsWinner,
                });
                break;
              }
            }
          }
          if (leveragedPositionPDA) break;
        }
      }

      // Dispatch:
      //  - Winning leveraged → redeem_shares (pays from market_vault, debt repaid via remaining_accounts)
      //  - Losing leveraged  → close_position via settleLeveragedPosition (burns tokens, consumes margin_vault to cover debt)
      //  - No leveraged      → redeem_shares (spot winner redemption, or no-op losing-spot burn)
      if (leveragedPositionPDA && !leveragedIsWinner) {
        console.log('[settleMarketPosition] Losing leveraged position → close_position');
        return await settleLeveragedPosition({
          market: marketPDA,
          positionPDA: leveragedPositionPDA,
        });
      }

      if (leveragedPositionPDA && leveragedIsWinner) {
        console.log('[settleMarketPosition] Winning leveraged position → redeem_shares (will auto-repay debt from payout)');
      } else {
        console.log('[settleMarketPosition] No leveraged position found → redeem_shares');
      }
      const winningBalance = params.winningBalance;
      // Thread the on-chain quote_decimals through so the success message
      // formats non-USDC markets correctly.
      const mktQuoteDecimals = Number((marketAccount as any).quoteDecimals ?? 0) || 6;
      return await redeemShares({
        market: marketPDA,
        amount: winningBalance || 0,
        quoteDecimals: mktQuoteDecimals,
      });
    } catch (error: any) {
      console.error('[settleMarketPosition] Error:', error);
      throw handleWalletError(error);
    } finally {
      setLoading(false);
    }
  };

  // Governance functions (admin only)
  const pauseProtocol = async (paused: boolean) => {
    if (!wallet.publicKey || !wallet.signTransaction || !provider || !program) {
      throw new Error('Wallet not connected or program not loaded');
    }

    setLoading(true);

    try {
      const [configPDA] = getConfigPDA();
      const [oracleRegistryPDA] = await getOracleRegistryPDA();

      const tx = await program.methods
        .pauseProtocol(paused)
        .accounts({
          config: configPDA,
          admin: wallet.publicKey,
          oracleRegistry: oracleRegistryPDA,
        })
        .rpc();

      return { transaction: tx };
    } catch (error: any) {
      throw handleWalletError(error);
    } finally {
      setLoading(false);
    }
  };

  const initializeConfig = async (
    maxGlobalOi: string | number,
    protocolFeeBps: number,
    creatorFeeBps: number,
    insuranceFeeBps: number
  ) => {
    if (!wallet.publicKey || !wallet.signTransaction || !provider || !program) {
      throw new Error('Wallet not connected or program not loaded');
    }

    setLoading(true);

    try {
      const [configPDA] = getConfigPDA();
      
      // Convert maxGlobalOi to BN (u128)
      // For u128, we need to ensure it's a valid BN instance
      let maxGlobalOiBN: BN;
      if (typeof maxGlobalOi === 'string') {
        // Remove any commas or spaces from the string
        const cleanStr = maxGlobalOi.replace(/[,\s]/g, '');
        maxGlobalOiBN = new BN(cleanStr, 10);
      } else {
        maxGlobalOiBN = new BN(maxGlobalOi);
      }
      
      // Convert all fee parameters to BN (u64) - ensure they're numbers first
      const protocolFeeBpsBN = new BN(Number(protocolFeeBps));
      const creatorFeeBpsBN = new BN(Number(creatorFeeBps));
      const insuranceFeeBpsBN = new BN(Number(insuranceFeeBps));

      // Verify all BNs are valid
      if (!maxGlobalOiBN || !protocolFeeBpsBN || !creatorFeeBpsBN || !insuranceFeeBpsBN) {
        throw new Error('Failed to create BN values');
      }

      const tx = await program.methods
        .initializeConfig(
          maxGlobalOiBN,
          protocolFeeBpsBN,
          creatorFeeBpsBN,
          insuranceFeeBpsBN
        )
        .accounts({
          config: configPDA,
          admin: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      return { transaction: tx };
    } catch (error: any) {
      throw handleWalletError(error);
    } finally {
      setLoading(false);
    }
  };

  const updateConfig = async (
    maxGlobalOi?: string | number,
    protocolFeeBps?: number,
    creatorFeeBps?: number,
    insuranceFeeBps?: number
  ) => {
    if (!wallet.publicKey || !wallet.signTransaction || !provider || !program) {
      throw new Error('Wallet not connected or program not loaded');
    }

    setLoading(true);

    try {
      const [configPDA] = getConfigPDA();
      const [oracleRegistryPDA] = await getOracleRegistryPDA();

      const maxGlobalOiOption = maxGlobalOi !== undefined
        ? (typeof maxGlobalOi === 'string' ? new BN(maxGlobalOi) : new BN(maxGlobalOi))
        : null;
      const protocolFeeBpsOption = protocolFeeBps !== undefined ? protocolFeeBps : null;
      const creatorFeeBpsOption = creatorFeeBps !== undefined ? creatorFeeBps : null;
      const insuranceFeeBpsOption = insuranceFeeBps !== undefined ? insuranceFeeBps : null;

      const tx = await program.methods
        .updateConfig(
          maxGlobalOiOption,
          protocolFeeBpsOption,
          creatorFeeBpsOption,
          insuranceFeeBpsOption
        )
        .accounts({
          config: configPDA,
          admin: wallet.publicKey,
          oracleRegistry: oracleRegistryPDA,
        })
        .rpc();

      return { transaction: tx };
    } catch (error: any) {
      throw handleWalletError(error);
    } finally {
      setLoading(false);
    }
  };

  const initializeOracleRegistry = async () => {
    if (!wallet.publicKey || !wallet.signTransaction || !provider || !program) {
      throw new Error('Wallet not connected or program not loaded');
    }

    setLoading(true);

    try {
      const [configPDA] = getConfigPDA(SPACE_CORE_PROGRAM_ID);
      const [oracleRegistryPDA] = await getOracleRegistryPDA(SPACE_CORE_PROGRAM_ID);

      console.log('[initializeOracleRegistry] Building transaction', {
        oracleRegistry: oracleRegistryPDA.toString(),
        config: configPDA.toString(),
        admin: wallet.publicKey.toString(),
      });

      const tx = await program.methods
        .initializeOracleRegistry()
        .accounts({
          oracleRegistry: oracleRegistryPDA,
          config: configPDA,
          admin: wallet.publicKey,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log('[initializeOracleRegistry] Success:', tx);
      return { transaction: tx };
    } catch (error: any) {
      console.error('[initializeOracleRegistry] Error:', error);
      throw handleWalletError(error);
    } finally {
      setLoading(false);
    }
  };

  const addApprovedOracle = async (oracle: PublicKey) => {
    if (!wallet.publicKey || !wallet.signTransaction || !provider || !program) {
      throw new Error('Wallet not connected or program not loaded');
    }

    setLoading(true);

    try {
      const [configPDA] = getConfigPDA(SPACE_CORE_PROGRAM_ID);
      const [oracleRegistryPDA] = await getOracleRegistryPDA(SPACE_CORE_PROGRAM_ID);

      console.log('[addApprovedOracle] Building transaction', {
        oracle: oracle.toString(),
        oracleRegistry: oracleRegistryPDA.toString(),
        config: configPDA.toString(),
        admin: wallet.publicKey.toString(),
      });

      const tx = await program.methods
        .addApprovedOracle(oracle)
        .accounts({
          oracleRegistry: oracleRegistryPDA,
          config: configPDA,
          admin: wallet.publicKey,
        })
        .rpc();

      console.log('[addApprovedOracle] Success:', tx);
      return { transaction: tx };
    } catch (error: any) {
      console.error('[addApprovedOracle] Error:', error);
      throw handleWalletError(error);
    } finally {
      setLoading(false);
    }
  };

  const fetchOracleRegistry = async () => {
    if (!program) {
      console.log('[fetchOracleRegistry] Program not loaded yet');
      return null;
    }

    try {
      const [oracleRegistryPDA] = await getOracleRegistryPDA(SPACE_CORE_PROGRAM_ID);
      const oracleRegistry = await program.account.oracleRegistry.fetch(oracleRegistryPDA);
      return {
        address: oracleRegistryPDA,
        approvedOracles: oracleRegistry.approvedOracles as PublicKey[],
      };
    } catch (error: any) {
      // Account doesn't exist = not initialized yet (expected state)
      if (error?.message?.includes('Account does not exist') || 
          error?.message?.includes('has no data') ||
          error?.message?.includes('could not find account')) {
        console.log('[fetchOracleRegistry] Oracle registry not initialized yet');
        return null;
      }
      // Only log unexpected errors
      console.error('[fetchOracleRegistry] Unexpected error:', error);
      return null;
    }
  };

  // Sync market status to backend after on-chain operations
  const syncMarketStatusToBackend = async (
    marketAddress: string,
    data: {
      status: number;
      resolvedOutcome?: number | null;
      resolutionSource?: string | null;
      resolveSlot?: string | null;
      challengeBond?: string;
      challenger?: string | null;
    }
  ) => {
    try {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
      const response = await fetch(`${apiUrl}/api/v1/markets/${marketAddress}/status`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });

      if (!response.ok) {
        const errorData = await response.json();
        console.error('[syncMarketStatusToBackend] Failed:', errorData);
        return false;
      }

      const result = await response.json();
      console.log('[syncMarketStatusToBackend] Success:', result.message);
      return true;
    } catch (error) {
      console.error('[syncMarketStatusToBackend] Error:', error);
      return false;
    }
  };

  // Fetch market data directly from blockchain
  const fetchMarket = async (marketPubkey: PublicKey) => {
    if (!program) {
      console.log('[fetchMarket] Program not loaded yet');
      return null;
    }

    try {
      const marketData = await program.account.market.fetch(marketPubkey) as any;
      return {
        publicKey: marketPubkey,
        creator: marketData.creator,
        marketId: marketData.marketId?.toNumber?.() ?? 0,
        title: marketData.title as string,
        description: marketData.description as string,
        category: marketData.category as number,
        status: marketData.status as number,
        resolutionType: marketData.resolutionType as number,
        numOutcomes: marketData.numOutcomes as number,
        outcomes: marketData.outcomes,
        noMint: marketData.noMint,
        endDate: marketData.endDate?.toNumber?.() ?? 0,
        createdAt: marketData.createdAt?.toNumber?.() ?? 0,
        totalVolume: marketData.totalVolume?.toNumber?.() ?? 0,
        totalMinted: marketData.totalMinted?.toNumber?.() ?? 0,
        resolvedOutcome: (marketData.resolvedOutcome as number | null) ?? null,
        resolutionSource: marketData.resolutionSource,
        resolveSlot: marketData.resolveSlot?.toNumber?.() ?? null,
        evidenceHash: marketData.evidenceHash,
        challengeBond: marketData.challengeBond?.toNumber?.() ?? 0,
        challenger: marketData.challenger,
        challengeTimestamp: marketData.challengeTimestamp?.toNumber?.() ?? null,
        creatorFeeBps: marketData.creatorFeeBps?.toNumber?.() ?? 0,
        isInvalid: marketData.isInvalid as boolean,
        resolveTimestamp: marketData.resolveTimestamp?.toNumber?.() ?? null,
      };
    } catch (error: any) {
      if (error?.message?.includes('Account does not exist')) {
        console.log('[fetchMarket] Market not found:', marketPubkey.toString());
        return null;
      }
      console.error('[fetchMarket] Error:', error);
      return null;
    }
  };

  const initializeInsuranceFund = async (initialBalance: number) => {
    if (!wallet.publicKey || !wallet.signTransaction || !provider || !program) {
      throw new Error('Wallet not connected or program not loaded');
    }

    setLoading(true);

    try {
      const [insuranceFundPDA] = await getInsuranceFundPDA();
      const [insuranceVaultPDA] = await getInsuranceVaultPDA();
      const [insuranceAuthorityPDA] = await getInsuranceAuthorityPDA();
      const adminUsdcATA = await getAssociatedTokenAddress(USDC_MINT, wallet.publicKey);

      const tx = await program.methods
        .initializeInsuranceFund(new BN(initialBalance))
        .accounts({
          insuranceFund: insuranceFundPDA,
          insuranceVault: insuranceVaultPDA,
          insuranceAuthority: insuranceAuthorityPDA,
          usdcMint: USDC_MINT,
          admin: wallet.publicKey,
          adminUsdc: adminUsdcATA,
          tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId,
          rent: SYSVAR_RENT_PUBKEY,
        })
        .rpc();

      return { transaction: tx };
    } catch (error: any) {
      throw handleWalletError(error);
    } finally {
      setLoading(false);
    }
  };

  // ========================================================================
  // SHARE MINTING & BURNING (Space-style)
  // Based on: https://docs.into.space/en/concepts/minting-burning
  // ========================================================================

  interface MintSharesParams {
    market: string;
    outcomeId: number;
    amount: number; // Share base units (6 decimals). Program scales up to quote units.
    quoteMint?: string; // Optional; defaults to USDC for legacy callers.
  }

  /**
   * Mint shares: Deposit $1 USDC → Receive 1 YES + 1 NO token
   */
  const mintShares = async (params: MintSharesParams) => {
    if (!wallet.publicKey || !wallet.signTransaction || !provider || !program) {
      throw new Error('Wallet not connected or program not loaded');
    }

    setLoading(true);

    try {
      const marketPDA = new PublicKey(params.market);
      const quoteMint = params.quoteMint ? new PublicKey(params.quoteMint) : USDC_MINT;
      const userUsdcATA = await getAssociatedTokenAddress(quoteMint, wallet.publicKey);

      const [marketVaultPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault'), marketPDA.toBuffer()],
        SPACE_CORE_PROGRAM_ID
      );
      const [mintAuthorityPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('mint_authority'), marketPDA.toBuffer()],
        SPACE_CORE_PROGRAM_ID
      );

      const yesMintPDA = await resolveYesMintPDA(marketPDA, params.outcomeId);
      const noMintPDA = await resolveNoMintPDA(marketPDA, params.outcomeId);

      const userYesATA = await getAssociatedTokenAddress(yesMintPDA, wallet.publicKey);
      const userNoATA = await getAssociatedTokenAddress(noMintPDA, wallet.publicKey);

      // Check if ATAs exist and create them if needed
      const preInstructions = [];
      
      try {
        await getAccount(connection, userYesATA);
      } catch {
        // ATA doesn't exist, create it
        preInstructions.push(
          createAssociatedTokenAccountInstruction(
            wallet.publicKey,
            userYesATA,
            wallet.publicKey,
            yesMintPDA
          )
        );
      }
      
      try {
        await getAccount(connection, userNoATA);
      } catch {
        // ATA doesn't exist, create it
        preInstructions.push(
          createAssociatedTokenAccountInstruction(
            wallet.publicKey,
            userNoATA,
            wallet.publicKey,
            noMintPDA
          )
        );
      }

      console.log('[Program] Minting shares:', {
        user: wallet.publicKey.toString(),
        market: marketPDA.toString(),
        outcomeId: params.outcomeId,
        amount: params.amount,
        creatingATAs: preInstructions.length > 0,
      });

      const [vaultAuthorityPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault_authority'), marketPDA.toBuffer()],
        SPACE_CORE_PROGRAM_ID
      );

      const tx = await program.methods
        .mintShares(params.outcomeId, new BN(params.amount))
        .accounts({
          market: marketPDA,
          user: wallet.publicKey,
          userUsdc: userUsdcATA,
          yesMint: yesMintPDA,
          noMint: noMintPDA,
          userYesAccount: userYesATA,
          userNoAccount: userNoATA,
          marketVault: marketVaultPDA,
          vaultAuthority: vaultAuthorityPDA,
          mintAuthority: mintAuthorityPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .preInstructions(preInstructions)
        .rpc();

      console.log('[Program] Mint shares successful:', {
        transaction: tx,
        explorer: `https://solscan.io/tx/${tx}`,
        user: wallet.publicKey.toString(),
        amount: params.amount,
      });

      return { transaction: tx };
    } catch (error: any) {
      console.error('Mint shares failed:', error);
      throw handleWalletError(error);
    } finally {
      setLoading(false);
    }
  };

  interface BurnSharesParams {
    market: string;
    outcomeId: number;
    amount: number; // Share pairs to burn (share base units, 6 decimals)
    quoteMint?: string; // Optional; defaults to USDC.
  }

  /**
   * Burn shares: Return 1 YES + 1 NO → Get $1 USDC back
   */
  const burnShares = async (params: BurnSharesParams) => {
    if (!wallet.publicKey || !wallet.signTransaction || !provider || !program) {
      throw new Error('Wallet not connected or program not loaded');
    }

    setLoading(true);

    try {
      const marketPDA = new PublicKey(params.market);
      const quoteMint = params.quoteMint ? new PublicKey(params.quoteMint) : USDC_MINT;
      const userUsdcATA = await getAssociatedTokenAddress(quoteMint, wallet.publicKey);

      const [marketVaultPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault'), marketPDA.toBuffer()],
        SPACE_CORE_PROGRAM_ID
      );
      const [vaultAuthorityPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('vault_authority'), marketPDA.toBuffer()],
        SPACE_CORE_PROGRAM_ID
      );

      const yesMintPDA = await resolveYesMintPDA(marketPDA, params.outcomeId);
      const noMintPDA = await resolveNoMintPDA(marketPDA, params.outcomeId);

      const userYesATA = await getAssociatedTokenAddress(yesMintPDA, wallet.publicKey);
      const userNoATA = await getAssociatedTokenAddress(noMintPDA, wallet.publicKey);

      const tx = await program.methods
        .burnShares(params.outcomeId, new BN(params.amount))
        .accounts({
          market: marketPDA,
          user: wallet.publicKey,
          userUsdc: userUsdcATA,
          yesMint: yesMintPDA,
          noMint: noMintPDA,
          userYesAccount: userYesATA,
          userNoAccount: userNoATA,
          marketVault: marketVaultPDA,
          vaultAuthority: vaultAuthorityPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .preInstructions(priorityFeeIxs(300_000))
        .rpc();

      return { transaction: tx };
    } catch (error: any) {
      console.error('Burn shares failed:', error);
      throw handleWalletError(error);
    } finally {
      setLoading(false);
    }
  };

  interface ConvertSharesParams {
    market: string;
    toOutcomeId: number;
    amount: number;
  }

  /**
   * Convert NO shares to YES shares of a target outcome (1:1).
   * Per Space docs: https://docs.into.space/en/features/multi-outcome
   * NO shares are fungible across all outcomes (shared mint).
   */
  const convertShares = async (params: ConvertSharesParams) => {
    if (!wallet.publicKey || !wallet.signTransaction || !provider || !program) {
      throw new Error('Wallet not connected or program not loaded');
    }

    setLoading(true);

    try {
      const marketPDA = new PublicKey(params.market);

      // Resolve mint PDAs — auto-detects old vs new market format
      const noMintPDA = await resolveNoMintPDA(marketPDA, params.toOutcomeId);
      const toYesMintPDA = await resolveYesMintPDA(marketPDA, params.toOutcomeId);
      const [mintAuthorityPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('mint_authority'), marketPDA.toBuffer()],
        SPACE_CORE_PROGRAM_ID
      );
      const [configPDA] = PublicKey.findProgramAddressSync(
        [Buffer.from('config')],
        SPACE_CORE_PROGRAM_ID
      );

      const userNoATA = await getAssociatedTokenAddress(noMintPDA, wallet.publicKey);
      const userToYesATA = await getAssociatedTokenAddress(toYesMintPDA, wallet.publicKey);

      const tx = await program.methods
        .convertShares(params.toOutcomeId, new BN(params.amount))
        .accounts({
          market: marketPDA,
          user: wallet.publicKey,
          noMint: noMintPDA,
          toYesMint: toYesMintPDA,
          noAccount: userNoATA,
          toYesAccount: userToYesATA,
          mintAuthority: mintAuthorityPDA,
          config: configPDA,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();

      return { transaction: tx };
    } catch (error: any) {
      console.error('Convert shares failed:', error);
      throw handleWalletError(error);
    } finally {
      setLoading(false);
    }
  };

  return {
    provider,
    program,
    createMarket,
    closePosition,
    closeLeveragedPosition,
    liquidatePosition,
    submitTwapData,
    resolveMarketTwap,
    resolveMarketOracle,
    challengeResolution,
    markInvalid,
    finalizeMarket,
    // Space-style share operations (mint/burn for liquidity, convert for multi-outcome)
    mintShares,
    burnShares,
    convertShares,
    pauseProtocol,
    initializeConfig,
    updateConfig,
    initializeOracleRegistry,
    addApprovedOracle,
    fetchOracleRegistry,
    fetchMarket,
    syncMarketStatusToBackend,
    initializeInsuranceFund,
    placeLimitOrder,
    placeBuyOrder,
    placeSellOrder,
    placeYesLimitSellOrder,
    placeNoLimitSellOrder,
    placeMarketOrder,
    placeBuyMarketOrder,
    placeSellMarketOrder,
    executeMatchedOrders,
    cancelOrder,
    // Resolution & Settlement
    redeemShares,
    settleLeveragedPosition,
    settleMarketPosition,
    loading,
    // space_core handles all core functions including resolution
    isReady: !!provider && !!wallet.publicKey && !!program,
  };
}
