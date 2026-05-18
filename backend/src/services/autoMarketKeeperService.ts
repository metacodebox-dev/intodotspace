import {
  Connection, PublicKey, Keypair, SystemProgram,
  SYSVAR_RENT_PUBKEY, Transaction,
} from '@solana/web3.js';
import { AnchorProvider, BN, Program, Wallet } from '@coral-xyz/anchor';
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  createTransferInstruction,
  getAccount,
} from '@solana/spl-token';
import { loadIDL } from '../utils/idl-loader';
import { Order } from '../models/Order';
import {
  SPACE_CORE_PROGRAM_ID,
  getMarketVaultPDA,
  getVaultAuthorityPDA,
  getMarginVaultPDA,
  getMarginVaultAuthorityPDA,
  getLiquidityVaultPDA,
  getLiquidityVaultAuthorityPDA,
  getYesMintPDA,
  getNoMintPDA,
  getMintAuthorityPDA,
  getConfigPDA,
  getOracleRegistryPDA,
  getPositionPDA,
  getOldPositionPDA,
} from '../utils/solana';

const USDC_MINT = new PublicKey(process.env.USDC_MINT || 'CqdmbJnQxMNNTGZzsBhEPTSzH52Pwa5DRvpVjZ2Us92t');
const SPACE_MINT = new PublicKey(process.env.SPACE_MINT || 'EHaeA9ke8Gaj9AKdjZ92pvk6oUFSZ5YehaqhAhgqZRZa');
const USDC_DECIMALS = 6;
const SPACE_DECIMALS = 9;

// Human-readable seed amounts; scaled to base units by current quote decimals at use-time.
const MINT_AMOUNT_HUMAN = 50_000;        // 50k YES + 50k NO minted per outcome
const BUY_ORDER_HUMAN = 50_000;          // 50k total buy-order size per outcome
const LIQUIDITY_VAULT_HUMAN = 100_000;   // 100k funded into liquidity_vault for leverage borrows
const SELL_PRICE_BPS = 5100; // 51¢
const BUY_PRICE_BPS = 4900;  // 49¢

type QuoteSymbol = 'USDC' | 'SPACE';

const QUOTE_TOKEN_REGISTRY: Record<QuoteSymbol, { mint: PublicKey; decimals: number }> = {
  USDC: { mint: USDC_MINT, decimals: USDC_DECIMALS },
  SPACE: { mint: SPACE_MINT, decimals: SPACE_DECIMALS },
};

const log = {
  info: (...args: any[]) => console.log('[AutoKeeper]', ...args),
  error: (...args: any[]) => console.error('[AutoKeeper]', ...args),
  warn: (...args: any[]) => console.warn('[AutoKeeper]', ...args),
};

/** Unique order ID generator to avoid PDA collisions */
let orderIdCounter = Date.now();
function nextOrderId(): BN {
  return new BN(++orderIdCounter);
}

export interface SeedOrderIds {
  yesSellOrderId: string;
  noSellOrderId: string;
  yesBuyOrderId: string;
  noBuyOrderId: string;
}

export class AutoMarketKeeperService {
  private connection: Connection;
  private program: Program<any> | null = null;
  private adminKeypair: Keypair | null = null;
  private initialized = false;

  // Quote token in use for the current seeding flow. Set per call at the top of
  // createAndSeedMarket; all helper methods read from here instead of hardcoding USDC.
  private currentQuoteMint: PublicKey = USDC_MINT;
  private currentQuoteDecimals: number = USDC_DECIMALS;
  private get quoteBaseUnit(): number {
    return Math.pow(10, this.currentQuoteDecimals);
  }

  constructor() {
    this.connection = new Connection(
      process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
      {
        commitment: 'confirmed',
        wsEndpoint: process.env.SOLANA_WS_URL,
        confirmTransactionInitialTimeout: 60000,
      }
    );
  }

  async initialize(): Promise<boolean> {
    const keypairEnv = process.env.AUTO_MARKET_KEEPER_KEYPAIR || process.env.KEEPER_KEYPAIR;
    if (!keypairEnv) {
      log.warn('AUTO_MARKET_KEEPER_KEYPAIR not set — disabled');
      return false;
    }
    try {
      const arr = JSON.parse(keypairEnv);
      this.adminKeypair = Keypair.fromSecretKey(Uint8Array.from(arr));
      const idl = await loadIDL();
      const wallet = new Wallet(this.adminKeypair);
      const provider = new AnchorProvider(this.connection, wallet, { commitment: 'confirmed' });
      this.program = new Program(idl, provider);
      this.initialized = true;
      log.info('Initialized, admin:', this.adminKeypair.publicKey.toBase58());
      return true;
    } catch (e: any) {
      log.error('Failed to initialize:', e.message);
      return false;
    }
  }

  get isReady() { return this.initialized && this.program && this.adminKeypair; }

  private get adminKey() { return this.adminKeypair!.publicKey; }

  // ═══════════════════════════════════════════════════════════
  //  CREATE + SEED FULL ORDERBOOK
  // ═══════════════════════════════════════════════════════════

  async createAndSeedMarket(params: {
    title: string;
    description: string;
    category: number;
    endDate: number;
    outcomes: string[];
    resolutionType: number;
    /** Human-readable initial collateral (e.g. 1000 = 1000 of the quote token). */
    initialCollateral: number;
    /** Quote token to seed the market with. Defaults to USDC. */
    quoteToken?: QuoteSymbol;
  }): Promise<{ marketPDA: PublicKey; seedOrderIds: SeedOrderIds }> {
    if (!this.isReady) throw new Error('AutoKeeper not initialized');

    // Select quote token for this seeding flow
    const quote = QUOTE_TOKEN_REGISTRY[params.quoteToken ?? 'USDC'];
    this.currentQuoteMint = quote.mint;
    this.currentQuoteDecimals = quote.decimals;
    const unit = this.quoteBaseUnit;

    const marketId = new BN(Date.now());
    const [marketPDA] = PublicKey.findProgramAddressSync(
      [Buffer.from('market'), this.adminKey.toBuffer(), marketId.toArrayLike(Buffer, 'le', 8)],
      SPACE_CORE_PROGRAM_ID,
    );

    log.info(
      `Creating market "${params.title}" → ${marketPDA.toBase58()} (quote=${params.quoteToken ?? 'USDC'})`,
    );

    // Human-readable collateral → base units for the chosen quote token
    const initialCollateralLamports = Math.floor(params.initialCollateral * unit);

    // Step 1: Create market on-chain
    await this.initializeMarketCore(marketPDA, marketId, params);

    // Step 2: Initialize vaults (market_vault, margin_vault, liquidity_vault)
    await this.initializeMarketVaults(marketPDA, initialCollateralLamports);

    // Step 2b: Fund liquidity_vault so users can take leveraged trades (plain SPL transfer)
    await this.fundLiquidityVault(marketPDA, Math.floor(LIQUIDITY_VAULT_HUMAN * unit));

    // Step 3: Mint shares — deposit quote token → get YES + NO in equal amounts
    const mintAmount = Math.floor(MINT_AMOUNT_HUMAN * unit);
    await this.mintShares(marketPDA, 0, mintAmount);

    // Step 4: Sell ALL minted YES tokens at 51¢ (escrows YES tokens into share_escrow)
    const yesSellOrderId = await this.placeYesSellOrder(marketPDA, 0, SELL_PRICE_BPS, mintAmount);

    // Step 5: Sell ALL minted NO tokens at 51¢ (escrows NO tokens into share_escrow_no)
    const noSellOrderId = await this.placeNoSellOrder(marketPDA, 0, SELL_PRICE_BPS, mintAmount);

    // Step 6: Place buy order for YES at 49¢ (escrows quote token)
    // Binary markets put YES and NO on the SAME outcomeId (0) and use
    // `tokenType` to distinguish sides — matches what the frontend places
    // (see MarketTradingPanel.tsx:466).
    // quantity in shares = total buy-order budget split between YES and NO
    const buyQty = Math.floor((BUY_ORDER_HUMAN * unit) / 2);
    const yesBuyOrderId = await this.placeBuyOrder(marketPDA, 0, BUY_PRICE_BPS, buyQty, 'yes');

    // Step 7: Place buy order for NO at 49¢ (same outcomeId, tokenType='no')
    const noBuyOrderId = await this.placeBuyOrder(marketPDA, 0, BUY_PRICE_BPS, buyQty, 'no');

    const seedOrderIds: SeedOrderIds = {
      yesSellOrderId: yesSellOrderId.toString(),
      noSellOrderId: noSellOrderId.toString(),
      yesBuyOrderId: yesBuyOrderId.toString(),
      noBuyOrderId: noBuyOrderId.toString(),
    };

    log.info(`Market fully seeded: ${marketPDA.toBase58()}`);
    return { marketPDA, seedOrderIds };
  }

  // ═══════════════════════════════════════════════════════════
  //  MARKET CREATION
  // ═══════════════════════════════════════════════════════════

  private async initializeMarketCore(
    marketPDA: PublicKey, marketId: BN,
    params: { title: string; description: string; category: number; endDate: number; outcomes: string[]; resolutionType: number },
  ) {
    const numOutcomes = params.outcomes.length;
    const [mintAuthorityPDA] = getMintAuthorityPDA(marketPDA);
    const [configPDA] = getConfigPDA();

    const remainingAccounts: { pubkey: PublicKey; isSigner: boolean; isWritable: boolean }[] = [];
    for (let i = 0; i < numOutcomes; i++) {
      const [ym] = getYesMintPDA(marketPDA, i);
      remainingAccounts.push({ pubkey: ym, isSigner: false, isWritable: true });
    }
    for (let i = 0; i < numOutcomes; i++) {
      const [nm] = getNoMintPDA(marketPDA, i);
      remainingAccounts.push({ pubkey: nm, isSigner: false, isWritable: true });
    }
    remainingAccounts.push({ pubkey: this.adminKey, isSigner: true, isWritable: true });
    remainingAccounts.push({ pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false });
    remainingAccounts.push({ pubkey: SystemProgram.programId, isSigner: false, isWritable: false });

    const tx = await this.program!.methods
      .initializeMarketCore(marketId, params.title, params.description, params.category, new BN(params.endDate), params.outcomes, params.resolutionType)
      .accounts({ market: marketPDA, creator: this.adminKey, mintAuthority: mintAuthorityPDA, config: configPDA, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId })
      .remainingAccounts(remainingAccounts)
      .rpc();
    log.info('Market core initialized, tx:', tx);
  }

  private async initializeMarketVaults(marketPDA: PublicKey, initialCollateral: number) {
    const [marketVaultPDA] = getMarketVaultPDA(marketPDA);
    const [vaultAuthorityPDA] = getVaultAuthorityPDA(marketPDA);
    const [marginVaultPDA] = getMarginVaultPDA(marketPDA);
    const [marginVaultAuthorityPDA] = getMarginVaultAuthorityPDA(marketPDA);
    const [liquidityVaultPDA] = getLiquidityVaultPDA(marketPDA);
    const [liquidityVaultAuthorityPDA] = getLiquidityVaultAuthorityPDA(marketPDA);
    const adminUsdcATA = await getAssociatedTokenAddress(this.currentQuoteMint, this.adminKey);

    const tx = await this.program!.methods
      .initializeMarketVaults(new BN(initialCollateral))
      .accounts({
        market: marketPDA, creator: this.adminKey, creatorUsdc: adminUsdcATA, usdcMint: this.currentQuoteMint,
        marketVault: marketVaultPDA, vaultAuthority: vaultAuthorityPDA,
        marginVault: marginVaultPDA, marginVaultAuthority: marginVaultAuthorityPDA,
        liquidityVault: liquidityVaultPDA, liquidityVaultAuthority: liquidityVaultAuthorityPDA,
        tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();
    log.info('Vaults initialized, tx:', tx);
  }

  // ═══════════════════════════════════════════════════════════
  //  FUND LIQUIDITY VAULT (plain SPL transfer)
  // ═══════════════════════════════════════════════════════════

  /**
   * Fund the liquidity_vault so users can take leveraged positions.
   * liquidity_vault is a standard SPL token account; plain USDC transfer deposits it.
   */
  private async fundLiquidityVault(marketPDA: PublicKey, amount: number) {
    const [liquidityVaultPDA] = getLiquidityVaultPDA(marketPDA);
    const adminUsdcATA = await getAssociatedTokenAddress(this.currentQuoteMint, this.adminKey);

    const tx = new Transaction().add(
      createTransferInstruction(
        adminUsdcATA,
        liquidityVaultPDA,
        this.adminKey,
        amount,
      )
    );
    tx.feePayer = this.adminKey;
    const { blockhash } = await this.connection.getLatestBlockhash();
    tx.recentBlockhash = blockhash;
    tx.sign(this.adminKeypair!);
    const sig = await this.connection.sendRawTransaction(tx.serialize());
    await this.connection.confirmTransaction(sig, 'confirmed');
    log.info(`Funded liquidity_vault with ${amount / this.quoteBaseUnit} (quote units), tx: ${sig}`);
  }

  // ═══════════════════════════════════════════════════════════
  //  MINT SHARES
  // ═══════════════════════════════════════════════════════════

  async mintShares(marketPDA: PublicKey, outcomeId: number, amount: number) {
    const [yesMintPDA] = getYesMintPDA(marketPDA, outcomeId);
    const [noMintPDA] = getNoMintPDA(marketPDA, outcomeId);
    const [marketVaultPDA] = getMarketVaultPDA(marketPDA);
    const [vaultAuthorityPDA] = getVaultAuthorityPDA(marketPDA);
    const [mintAuthorityPDA] = getMintAuthorityPDA(marketPDA);
    const [configPDA] = getConfigPDA();
    const adminUsdcATA = await getAssociatedTokenAddress(this.currentQuoteMint, this.adminKey);
    const userYesATA = await getAssociatedTokenAddress(yesMintPDA, this.adminKey);
    const userNoATA = await getAssociatedTokenAddress(noMintPDA, this.adminKey);

    const preIxs = [];
    try { await getAccount(this.connection, userYesATA); } catch {
      preIxs.push(createAssociatedTokenAccountInstruction(this.adminKey, userYesATA, this.adminKey, yesMintPDA));
    }
    try { await getAccount(this.connection, userNoATA); } catch {
      preIxs.push(createAssociatedTokenAccountInstruction(this.adminKey, userNoATA, this.adminKey, noMintPDA));
    }

    const tx = await this.program!.methods
      .mintShares(outcomeId, new BN(amount))
      .accounts({
        market: marketPDA, user: this.adminKey, userUsdc: adminUsdcATA,
        yesMint: yesMintPDA, noMint: noMintPDA, userYesAccount: userYesATA, userNoAccount: userNoATA,
        marketVault: marketVaultPDA, vaultAuthority: vaultAuthorityPDA, mintAuthority: mintAuthorityPDA,
        config: configPDA, tokenProgram: TOKEN_PROGRAM_ID,
      })
      .preInstructions(preIxs)
      .rpc();
    log.info(`Minted ${amount / this.quoteBaseUnit} shares for outcome ${outcomeId}, tx:`, tx);
  }

  // ═══════════════════════════════════════════════════════════
  //  PLACE ORDERS (BUY + SELL YES + SELL NO)
  // ═══════════════════════════════════════════════════════════

  /** Buy order — escrows USDC at given price. Returns orderId. */
  async placeBuyOrder(marketPDA: PublicKey, outcomeId: number, priceBps: number, quantity: number, tokenType: 'yes' | 'no' = 'yes'): Promise<BN> {
    const orderId = nextOrderId();
    const orderIdBytes = orderId.toArrayLike(Buffer, 'le', 8);
    const [pendingOrderPDA] = PublicKey.findProgramAddressSync([Buffer.from('order'), this.adminKey.toBuffer(), orderIdBytes], SPACE_CORE_PROGRAM_ID);
    const [orderEscrowAuthorityPDA] = PublicKey.findProgramAddressSync([Buffer.from('order_escrow_authority'), this.adminKey.toBuffer(), orderIdBytes], SPACE_CORE_PROGRAM_ID);
    const [orderEscrowPDA] = PublicKey.findProgramAddressSync([Buffer.from('order_escrow'), this.adminKey.toBuffer(), orderIdBytes], SPACE_CORE_PROGRAM_ID);
    const [configPDA] = getConfigPDA();
    const adminUsdcATA = await getAssociatedTokenAddress(this.currentQuoteMint, this.adminKey);

    const tx = await this.program!.methods
      .placeBuyOrder(orderId, outcomeId, new BN(priceBps), new BN(quantity), 1)
      .accounts({
        market: marketPDA, config: configPDA, user: this.adminKey, userUsdc: adminUsdcATA,
        pendingOrder: pendingOrderPDA, orderEscrowAuthority: orderEscrowAuthorityPDA, orderEscrow: orderEscrowPDA,
        usdcMint: this.currentQuoteMint, tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
      })
      .rpc();
    log.info(`Buy order: outcome=${outcomeId} price=${priceBps}bps qty=${quantity / this.quoteBaseUnit}, tx:`, tx);

    // Insert into DB orders table so frontend orderbook picks it up
    await this.persistOrder({
      marketId: marketPDA.toBase58(),
      outcomeId,
      side: 'buy',
      type: 'limit',
      price: priceBps,
      size: quantity,
      leverage: 1,
      tokenType,
      orderId: orderId.toNumber(),
      onChainOrder: pendingOrderPDA.toBase58(),
    });

    return orderId;
  }

  /** Sell YES tokens — escrows YES shares into share_escrow. Returns orderId. */
  async placeYesSellOrder(marketPDA: PublicKey, outcomeId: number, priceBps: number, quantity: number): Promise<BN> {
    const orderId = nextOrderId();
    const orderIdBytes = orderId.toArrayLike(Buffer, 'le', 8);
    const [pendingOrderPDA] = PublicKey.findProgramAddressSync([Buffer.from('order'), this.adminKey.toBuffer(), orderIdBytes], SPACE_CORE_PROGRAM_ID);
    const [shareEscrowAuthorityPDA] = PublicKey.findProgramAddressSync([Buffer.from('share_escrow_authority'), this.adminKey.toBuffer(), orderIdBytes], SPACE_CORE_PROGRAM_ID);
    const [shareEscrowYesPDA] = PublicKey.findProgramAddressSync([Buffer.from('share_escrow'), this.adminKey.toBuffer(), orderIdBytes], SPACE_CORE_PROGRAM_ID);
    const [configPDA] = getConfigPDA();
    const [yesMintPDA] = getYesMintPDA(marketPDA, outcomeId);
    const userYesATA = await getAssociatedTokenAddress(yesMintPDA, this.adminKey);

    // user_position — pass a spot position PDA (may or may not exist; instruction handles CHECK)
    const [userPositionPDA] = getPositionPDA(marketPDA, this.adminKey, outcomeId, 0, 0, 0);

    const tx = await this.program!.methods
      .placeYesLimitSellOrder(orderId, outcomeId, new BN(priceBps), new BN(quantity), 1)
      .accounts({
        market: marketPDA, config: configPDA, user: this.adminKey,
        pendingOrder: pendingOrderPDA, userYesAccount: userYesATA,
        shareEscrowAuthority: shareEscrowAuthorityPDA, shareEscrowYes: shareEscrowYesPDA,
        yesMint: yesMintPDA, userPosition: userPositionPDA,
        tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();
    log.info(`YES sell order: outcome=${outcomeId} price=${priceBps}bps qty=${quantity / this.quoteBaseUnit}, tx:`, tx);

    await this.persistOrder({
      marketId: marketPDA.toBase58(),
      outcomeId,
      side: 'sell',
      type: 'limit',
      price: priceBps,
      size: quantity,
      leverage: 1,
      tokenType: 'yes',
      orderId: orderId.toNumber(),
      onChainOrder: pendingOrderPDA.toBase58(),
    });

    return orderId;
  }

  /** Sell NO tokens — escrows NO shares into share_escrow_no. Returns orderId. */
  async placeNoSellOrder(marketPDA: PublicKey, outcomeId: number, priceBps: number, quantity: number): Promise<BN> {
    const orderId = nextOrderId();
    const orderIdBytes = orderId.toArrayLike(Buffer, 'le', 8);
    const [pendingOrderPDA] = PublicKey.findProgramAddressSync([Buffer.from('order'), this.adminKey.toBuffer(), orderIdBytes], SPACE_CORE_PROGRAM_ID);
    const [shareEscrowAuthorityPDA] = PublicKey.findProgramAddressSync([Buffer.from('share_escrow_authority'), this.adminKey.toBuffer(), orderIdBytes], SPACE_CORE_PROGRAM_ID);
    const [shareEscrowNoPDA] = PublicKey.findProgramAddressSync([Buffer.from('share_escrow_no'), this.adminKey.toBuffer(), orderIdBytes], SPACE_CORE_PROGRAM_ID);
    const [configPDA] = getConfigPDA();
    const [noMintPDA] = getNoMintPDA(marketPDA, outcomeId);
    const userNoATA = await getAssociatedTokenAddress(noMintPDA, this.adminKey);

    // user_position — pass NO position PDA
    const [userPositionPDA] = getPositionPDA(marketPDA, this.adminKey, outcomeId, 0, 0, 1);

    const tx = await this.program!.methods
      .placeNoLimitSellOrder(orderId, outcomeId, new BN(priceBps), new BN(quantity), 1)
      .accounts({
        market: marketPDA, config: configPDA, user: this.adminKey,
        pendingOrder: pendingOrderPDA, userNoAccount: userNoATA,
        shareEscrowAuthority: shareEscrowAuthorityPDA, shareEscrowNo: shareEscrowNoPDA,
        noMint: noMintPDA, userPosition: userPositionPDA,
        tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
      })
      .rpc();
    log.info(`NO sell order: outcome=${outcomeId} price=${priceBps}bps qty=${quantity / this.quoteBaseUnit}, tx:`, tx);

    await this.persistOrder({
      marketId: marketPDA.toBase58(),
      outcomeId,
      side: 'sell',
      type: 'limit',
      price: priceBps,
      size: quantity,
      leverage: 1,
      tokenType: 'no',
      orderId: orderId.toNumber(),
      onChainOrder: pendingOrderPDA.toBase58(),
    });

    return orderId;
  }

  /** Persist seed order in backend DB so the orderbook frontend can render it */
  private async persistOrder(params: {
    marketId: string;
    outcomeId: number;
    side: 'buy' | 'sell';
    type: 'market' | 'limit';
    price: number;
    size: number;
    leverage: number;
    tokenType: 'yes' | 'no';
    orderId: number;
    onChainOrder: string;
  }) {
    try {
      await Order.create({
        marketId: params.marketId,
        outcomeId: params.outcomeId,
        side: params.side,
        type: params.type,
        price: params.price,
        size: BigInt(params.size).toString() as any,
        filled: '0' as any,
        avgFillPrice: null,
        leverage: params.leverage,
        status: 'open',
        userId: this.adminKey.toBase58(),
        orderId: params.orderId,
        onChainOrder: params.onChainOrder,
        tokenType: params.tokenType,
      });
    } catch (e: any) {
      log.warn('Failed to persist order in DB:', e.message);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  RESOLVE + FINALIZE
  // ═══════════════════════════════════════════════════════════

  /** Fetch the on-chain market's status + resolved_outcome. Returns null if account not found. */
  async getOnChainMarketState(marketPDA: PublicKey): Promise<{ status: number; resolvedOutcome: number | null } | null> {
    if (!this.isReady) throw new Error('AutoKeeper not initialized');
    try {
      const account: any = await this.program!.account.market.fetch(marketPDA);
      return {
        status: account.status as number,
        resolvedOutcome: (account.resolvedOutcome as number | null) ?? null,
      };
    } catch {
      return null;
    }
  }

  async resolveMarket(marketPDA: PublicKey, winningOutcome: number) {
    if (!this.isReady) throw new Error('AutoKeeper not initialized');
    const [configPDA] = getConfigPDA();
    let oracleRegistryPDA: PublicKey;
    try { [oracleRegistryPDA] = getOracleRegistryPDA(); } catch {
      [oracleRegistryPDA] = PublicKey.findProgramAddressSync([Buffer.from('oracle_registry')], SPACE_CORE_PROGRAM_ID);
    }
    const evidenceHash = Buffer.alloc(32);
    const tx = await this.program!.methods
      .resolveOracle(winningOutcome, Array.from(evidenceHash))
      .accounts({ market: marketPDA, resolver: this.adminKey, config: configPDA, oracleRegistry: oracleRegistryPDA })
      .rpc();
    log.info(`Market resolved (outcome=${winningOutcome}), tx:`, tx);
  }

  async finalizeMarket(marketPDA: PublicKey) {
    if (!this.isReady) throw new Error('AutoKeeper not initialized');
    const tx = await this.program!.methods.finalizeMarket().accounts({ market: marketPDA }).rpc();
    log.info(`Market finalized, tx:`, tx);
  }

  // ═══════════════════════════════════════════════════════════
  //  LIQUIDITY RECOVERY (cancel orders + redeem winning shares)
  // ═══════════════════════════════════════════════════════════

  async recoverLiquidity(marketPDA: PublicKey, resolvedOutcome: number, seedOrderIds: SeedOrderIds) {
    if (!this.isReady) throw new Error('AutoKeeper not initialized');

    // Cancel unfilled buy orders (recover USDC from order_escrow)
    await this.cancelBuyOrder(new BN(seedOrderIds.yesBuyOrderId));
    await this.cancelBuyOrder(new BN(seedOrderIds.noBuyOrderId));

    // Cancel unfilled sell orders (recover YES/NO tokens from share_escrow)
    await this.cancelYesSellOrder(marketPDA, 0, new BN(seedOrderIds.yesSellOrderId));
    await this.cancelNoSellOrder(marketPDA, 0, new BN(seedOrderIds.noSellOrderId));

    // Redeem winning shares
    await this.redeemShares(marketPDA, resolvedOutcome);

    log.info('Liquidity recovery complete for', marketPDA.toBase58());
  }

  private async cancelBuyOrder(orderId: BN) {
    const orderIdBytes = orderId.toArrayLike(Buffer, 'le', 8);
    const [pendingOrderPDA] = PublicKey.findProgramAddressSync([Buffer.from('order'), this.adminKey.toBuffer(), orderIdBytes], SPACE_CORE_PROGRAM_ID);
    const [orderEscrowAuthorityPDA] = PublicKey.findProgramAddressSync([Buffer.from('order_escrow_authority'), this.adminKey.toBuffer(), orderIdBytes], SPACE_CORE_PROGRAM_ID);
    const [orderEscrowPDA] = PublicKey.findProgramAddressSync([Buffer.from('order_escrow'), this.adminKey.toBuffer(), orderIdBytes], SPACE_CORE_PROGRAM_ID);
    const [configPDA] = getConfigPDA();
    const adminUsdcATA = await getAssociatedTokenAddress(this.currentQuoteMint, this.adminKey);

    try {
      const tx = await this.program!.methods
        .cancelOrder(orderId)
        .accounts({
          pendingOrder: pendingOrderPDA, user: this.adminKey, userUsdc: adminUsdcATA,
          orderEscrowAuthority: orderEscrowAuthorityPDA, orderEscrow: orderEscrowPDA,
          config: configPDA, tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      log.info(`Cancelled buy order ${orderId.toString()}, tx:`, tx);
    } catch (e: any) {
      log.warn(`Cancel buy order ${orderId.toString()} failed (may be filled): ${e.message}`);
    }
  }

  private async cancelYesSellOrder(marketPDA: PublicKey, outcomeId: number, orderId: BN) {
    const orderIdBytes = orderId.toArrayLike(Buffer, 'le', 8);
    const [pendingOrderPDA] = PublicKey.findProgramAddressSync([Buffer.from('order'), this.adminKey.toBuffer(), orderIdBytes], SPACE_CORE_PROGRAM_ID);
    const [shareEscrowAuthorityPDA] = PublicKey.findProgramAddressSync([Buffer.from('share_escrow_authority'), this.adminKey.toBuffer(), orderIdBytes], SPACE_CORE_PROGRAM_ID);
    const [shareEscrowYesPDA] = PublicKey.findProgramAddressSync([Buffer.from('share_escrow'), this.adminKey.toBuffer(), orderIdBytes], SPACE_CORE_PROGRAM_ID);
    const [configPDA] = getConfigPDA();
    const [yesMintPDA] = getYesMintPDA(marketPDA, outcomeId);
    const userYesATA = await getAssociatedTokenAddress(yesMintPDA, this.adminKey);
    const [userPositionPDA] = getPositionPDA(marketPDA, this.adminKey, outcomeId, 0, 0, 0);

    try {
      const tx = await this.program!.methods
        .cancelSellOrder(orderId)
        .accounts({
          pendingOrder: pendingOrderPDA, user: this.adminKey, userYesAccount: userYesATA,
          shareEscrowAuthority: shareEscrowAuthorityPDA, shareEscrowYes: shareEscrowYesPDA,
          position: userPositionPDA, config: configPDA, tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      log.info(`Cancelled YES sell order ${orderId.toString()}, tx:`, tx);
    } catch (e: any) {
      log.warn(`Cancel YES sell ${orderId.toString()} failed (may be filled): ${e.message}`);
    }
  }

  private async cancelNoSellOrder(marketPDA: PublicKey, outcomeId: number, orderId: BN) {
    const orderIdBytes = orderId.toArrayLike(Buffer, 'le', 8);
    const [pendingOrderPDA] = PublicKey.findProgramAddressSync([Buffer.from('order'), this.adminKey.toBuffer(), orderIdBytes], SPACE_CORE_PROGRAM_ID);
    const [shareEscrowAuthorityPDA] = PublicKey.findProgramAddressSync([Buffer.from('share_escrow_authority'), this.adminKey.toBuffer(), orderIdBytes], SPACE_CORE_PROGRAM_ID);
    const [shareEscrowNoPDA] = PublicKey.findProgramAddressSync([Buffer.from('share_escrow_no'), this.adminKey.toBuffer(), orderIdBytes], SPACE_CORE_PROGRAM_ID);
    const [configPDA] = getConfigPDA();
    const [noMintPDA] = getNoMintPDA(marketPDA, outcomeId);
    const userNoATA = await getAssociatedTokenAddress(noMintPDA, this.adminKey);
    const [userPositionPDA] = getPositionPDA(marketPDA, this.adminKey, outcomeId, 0, 0, 1);

    try {
      const tx = await this.program!.methods
        .cancelNoSellOrder(orderId)
        .accounts({
          pendingOrder: pendingOrderPDA, user: this.adminKey, userNoAccount: userNoATA,
          shareEscrowAuthority: shareEscrowAuthorityPDA, shareEscrowNo: shareEscrowNoPDA,
          position: userPositionPDA, config: configPDA, tokenProgram: TOKEN_PROGRAM_ID,
        })
        .rpc();
      log.info(`Cancelled NO sell order ${orderId.toString()}, tx:`, tx);
    } catch (e: any) {
      log.warn(`Cancel NO sell ${orderId.toString()} failed (may be filled): ${e.message}`);
    }
  }

  private async redeemShares(marketPDA: PublicKey, resolvedOutcome: number) {
    const [yesMintPDA] = getYesMintPDA(marketPDA, resolvedOutcome);
    const [noMintPDA] = getNoMintPDA(marketPDA, resolvedOutcome);
    const [marketVaultPDA] = getMarketVaultPDA(marketPDA);
    const [vaultAuthorityPDA] = getVaultAuthorityPDA(marketPDA);
    const [liquidityVaultPDA] = getLiquidityVaultPDA(marketPDA);
    const [liquidityVaultAuthorityPDA] = getLiquidityVaultAuthorityPDA(marketPDA);
    const [configPDA] = getConfigPDA();
    const userYesATA = await getAssociatedTokenAddress(yesMintPDA, this.adminKey);
    const userNoATA = await getAssociatedTokenAddress(noMintPDA, this.adminKey);
    const userUsdcATA = await getAssociatedTokenAddress(this.currentQuoteMint, this.adminKey);

    const preIxs = [];
    try { await getAccount(this.connection, userYesATA); } catch {
      preIxs.push(createAssociatedTokenAccountInstruction(this.adminKey, userYesATA, this.adminKey, yesMintPDA));
    }
    try { await getAccount(this.connection, userNoATA); } catch {
      preIxs.push(createAssociatedTokenAccountInstruction(this.adminKey, userNoATA, this.adminKey, noMintPDA));
    }

    try {
      const tx = await this.program!.methods
        .redeemShares(resolvedOutcome)
        .accounts({
          market: marketPDA, user: this.adminKey, userUsdc: userUsdcATA,
          yesMint: yesMintPDA, noMint: noMintPDA, userYesAccount: userYesATA, userNoAccount: userNoATA,
          marketVault: marketVaultPDA, vaultAuthority: vaultAuthorityPDA,
          liquidityVault: liquidityVaultPDA, liquidityVaultAuthority: liquidityVaultAuthorityPDA,
          config: configPDA, tokenProgram: TOKEN_PROGRAM_ID,
        })
        .preInstructions(preIxs)
        .rpc();
      log.info(`Redeemed winning shares, tx:`, tx);
    } catch (e: any) {
      log.warn(`Redeem shares failed: ${e.message}`);
    }
  }

  // ═══════════════════════════════════════════════════════════
  //  v1 → v2 MIGRATION (admin panel support)
  // ═══════════════════════════════════════════════════════════

  async listV1Markets(): Promise<
    Array<{
      pubkey: string;
      title: string;
      creator: string;
      version: number;
      canMigrate: boolean;
    }>
  > {
    if (!this.isReady) throw new Error('AutoKeeper not initialized');
    const adminKey = this.adminKey.toBase58();
    const out: any[] = [];
    try {
      const all = await (this.program as any).account.market.all();
      for (const { publicKey, account } of all) {
        const version = Number(account.version ?? 0);
        if (version === 2) continue;
        const creator = new PublicKey(account.creator).toBase58();
        out.push({
          pubkey: publicKey.toBase58(),
          title: String(account.title || ''),
          creator,
          version,
          canMigrate: creator === adminKey,
        });
      }
    } catch (e: any) {
      log.error('listV1Markets failed:', e.message);
      throw e;
    }
    return out;
  }

  async migrateMarketToV2(
    marketPubkey: PublicKey,
    quoteMintPubkey: PublicKey = USDC_MINT,
  ): Promise<string> {
    if (!this.isReady) throw new Error('AutoKeeper not initialized');
    const configPDA = getConfigPDA();
    const sig = await (this.program as any).methods
      .migrateMarketV1ToV2()
      .accounts({
        market: marketPubkey,
        quoteMint: quoteMintPubkey,
        config: configPDA,
        admin: this.adminKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([this.adminKeypair!])
      .rpc();
    log.info(`Migrated ${marketPubkey.toBase58()}, tx: ${sig}`);
    return sig;
  }
}

export const autoMarketKeeperService = new AutoMarketKeeperService();
