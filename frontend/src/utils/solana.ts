import { Program, AnchorProvider, Wallet, BN } from "@coral-xyz/anchor";
import {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
  SYSVAR_CLOCK_PUBKEY,
} from "@solana/web3.js";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";

// Program ID - Must match Anchor.toml and deployed program
export const SPACE_CORE_PROGRAM_ID = new PublicKey(
  "DKRg9skUuewV1wdbVD6tpnoHtbWWy2Chq7EKdpPRY6Eh",
);

// Note: Resolution, settlement, and redemption are all handled by space_core now

// USDC Mint (Devnet)
// Option 1: Use official devnet USDC (get from faucet)
// export const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'); // Devnet USDC

// Option 2: Use your own test token (create with scripts/create-test-usdc.js)
// Your test token mint address - you can mint unlimited amounts!
export const USDC_MINT = new PublicKey(
  "CqdmbJnQxMNNTGZzsBhEPTSzH52Pwa5DRvpVjZ2Us92t",
); // Your test token

// SPACE token (devnet, 9 decimals) — created via scripts/create-test-space.js
export const SPACE_MINT = new PublicKey(
  "EHaeA9ke8Gaj9AKdjZ92pvk6oUFSZ5YehaqhAhgqZRZa",
);

export const USDC_DECIMALS = 6;
export const SPACE_DECIMALS = 9;

/** Configured quote tokens admins can spin markets up in. */
export type QuoteTokenSymbol = "USDC" | "SPACE";

export interface QuoteTokenConfig {
  symbol: QuoteTokenSymbol;
  mint: PublicKey;
  decimals: number;
  /** Minimum initial collateral in human units (1000 = 1000 USDC or 1000 SPACE). */
  minInitialCollateralHuman: number;
}

export const QUOTE_TOKENS: Record<QuoteTokenSymbol, QuoteTokenConfig> = {
  USDC: {
    symbol: "USDC",
    mint: USDC_MINT,
    decimals: USDC_DECIMALS,
    minInitialCollateralHuman: 1000,
  },
  SPACE: {
    symbol: "SPACE",
    mint: SPACE_MINT,
    decimals: SPACE_DECIMALS,
    minInitialCollateralHuman: 1000,
  },
};

/**
 * Map an internal quote-token ticker to its user-visible display symbol.
 * SPACE is rendered as "SPC" in the UI while we keep the internal symbol
 * "SPACE" everywhere else (backend filters, chain-side quote_symbol, DB).
 * Any unknown symbol is returned unchanged.
 */
export function displayQuoteSymbol(symbol: string | null | undefined): string {
  if (!symbol) return '';
  if (symbol === 'SPACE') return 'SPC';
  return symbol;
}

/** Convert a human-readable quote amount to base-unit lamports for the given decimals. */
export function humanToLamports(amount: number, decimals: number): number {
  return Math.floor(amount * Math.pow(10, decimals));
}

/** Convert base-unit lamports to human-readable quote amount. */
export function lamportsToHuman(lamports: number, decimals: number): number {
  return lamports / Math.pow(10, decimals);
}

// Constants from program
export const BASIS_POINTS = 10000;
export const PRICE_SCALE = 10000;
export const MIN_INITIAL_COLLATERAL = 1_000_000_000; // 1000 USDC (6 decimals) — legacy, for USDC path
export const MAX_LEVERAGE = 10;
export const MAINTENANCE_MARGIN_BPS = 500; // 5%
export const DISPUTE_WINDOW_SLOTS = 43_200; // ~24h

export interface MarketCreationParams {
  title: string;
  description: string;
  category: number;
  endDate: Date;
  outcomes: string[];
  /** Human-readable amount (e.g. 1000 = 1000 USDC or 1000 SPACE). */
  initialCollateral: number;
  resolutionType?: number; // 0 = Deterministic (TWAP), 1 = Oracle (default)
  /** Quote/collateral mint. Defaults to USDC. */
  quoteMint?: PublicKey;
  /** Decimals of the quote mint. Defaults to 6 (USDC). */
  quoteDecimals?: number;
}

export interface MarketAccount {
  creator: PublicKey;
  marketId: BN; // Deterministic market ID for PDA derivation
  title: string;
  description: string;
  category: number;
  status: number; // MarketStatus enum
  outcomes: MarketOutcome[];
  endDate: BN;
  createdAt: BN;
  totalVolume: BN;
  totalCollateral: BN;
  totalOpenInterest: BN;
  maxOpenInterest: BN;
  insuranceFund: BN;
  resolvedOutcome: number | null;
  resolutionSource: PublicKey | null;
  resolveSlot: BN | null;
  challengeBond: BN;
  challenger: PublicKey | null;
  creatorFeeBps: number;
}

export interface MarketOutcome {
  id: number;
  label: string;
  openInterest: BN; // Notional-based, not shares
}

export interface PositionAccount {
  user: PublicKey;
  market: PublicKey;
  outcomeId: number;
  side: number; // 0 = Long, 1 = Short
  shares: BN;
  avgEntryPrice: BN; // Basis points
  leverage: number;
  collateral: BN;
  borrowedAmount: BN;
  positionType: number; // 0 = Spot, 1 = Leveraged
  liquidationPrice: BN; // Only meaningful for leveraged (0 for spot)
  isOpen: boolean; // Whether position is active
}

export interface TradeParams {
  market: PublicKey | string;
  outcomeId: number;
  side: number; // 0 = Long (buy), 1 = Short (sell)
  price: number; // Basis points (0-10000)
  shares: number;
  leverage: number; // 1-10x
  referencePrice?: number; // Optional for oracle bounds check
}

export interface LockMarginParams {
  notional: number; // Total notional value
  leverage: number; // 1-10x
}

/**
 * Convert a u64 (unsigned 64-bit integer) to little-endian byte array
 * Uses BN.toArray for consistency with Anchor's serialization
 */
function u64ToLeBytes(value: number | BN): Buffer {
  // Use BN.toArray for consistency with Anchor
  if (value instanceof BN) {
    return Buffer.from(value.toArray("le", 8));
  }

  // For numbers, convert to BN first
  const bn = new BN(value);
  return Buffer.from(bn.toArray("le", 8));
}

/**
 * Get the market PDA (Program Derived Address)
 * Uses deterministic market_id instead of timestamp
 */
export function getMarketPDA(
  creator: PublicKey,
  marketId: number | BN,
  programId: PublicKey = SPACE_CORE_PROGRAM_ID,
): [PublicKey, number] {
  // Convert market_id to little-endian bytes (u64 = 8 bytes)
  const marketIdBytes = u64ToLeBytes(marketId);

  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), creator.toBuffer(), Buffer.from(marketIdBytes)],
    programId,
  );
}

/**
 * Get the market vault PDA (synchronous)
 */
export function getMarketVaultPDA(
  market: PublicKey,
  programId: PublicKey = SPACE_CORE_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), market.toBuffer()],
    programId,
  );
}

/**
 * Get the vault authority PDA (synchronous)
 */
export function getVaultAuthorityPDA(
  market: PublicKey,
  programId: PublicKey = SPACE_CORE_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority"), market.toBuffer()],
    programId,
  );
}

/**
 * Get the margin vault PDA
 */
export function getMarginVaultPDA(
  market: PublicKey,
  programId: PublicKey = SPACE_CORE_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("margin_vault"), market.toBuffer()],
    programId,
  );
}

/**
 * Get the margin vault authority PDA
 */
export function getMarginVaultAuthorityPDA(
  market: PublicKey,
  programId: PublicKey = SPACE_CORE_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("margin_vault_authority"), market.toBuffer()],
    programId,
  );
}

/**
 * Get the liquidity vault PDA
 */
export function getLiquidityVaultPDA(
  market: PublicKey,
  programId: PublicKey = SPACE_CORE_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("liquidity_vault"), market.toBuffer()],
    programId,
  );
}

/**
 * Get the liquidity vault authority PDA
 */
export function getLiquidityVaultAuthorityPDA(
  market: PublicKey,
  programId: PublicKey = SPACE_CORE_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("liquidity_vault_authority"), market.toBuffer()],
    programId,
  );
}

/**
 * Get the margin account PDA for a user
 */
export function getMarginAccountPDA(
  user: PublicKey,
  programId: PublicKey = SPACE_CORE_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("margin"), user.toBuffer()],
    programId,
  );
}

/**
 * Get the position PDA
 * Seeds: [b"position", user, market, &[outcome_id], &[side], &[position_type], &[token_type]]
 * position_type: 0 = Spot, 1 = Leveraged
 * token_type: 0 = YES, 1 = NO
 */
export function getPositionPDA(
  market: PublicKey,
  user: PublicKey,
  outcomeId: number,
  side: number,
  positionType: number, // Required: 0 = Spot, 1 = Leveraged
  tokenType: number = 0, // 0 = YES, 1 = NO
  programId: PublicKey = SPACE_CORE_PROGRAM_ID,
): [PublicKey, number] {
  // Match Rust: seeds = [b"position", user, market, &[outcome_id], &[side], &[position_type], &[token_type]]
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("position"),
      user.toBuffer(),
      market.toBuffer(),
      Buffer.from([outcomeId]),
      Buffer.from([side]),
      Buffer.from([positionType]),
      Buffer.from([tokenType]),
    ],
    programId,
  );
}

/**
 * Get the old position PDA (without token_type seed — backward compat)
 * Seeds: [b"position", user, market, &[outcome_id], &[side], &[position_type]]
 */
export function getOldPositionPDA(
  market: PublicKey,
  user: PublicKey,
  outcomeId: number,
  side: number,
  positionType: number,
  programId: PublicKey = SPACE_CORE_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("position"),
      user.toBuffer(),
      market.toBuffer(),
      Buffer.from([outcomeId]),
      Buffer.from([side]),
      Buffer.from([positionType]),
    ],
    programId,
  );
}

/**
 * Get the config PDA
 */
export function getConfigPDA(
  programId: PublicKey = SPACE_CORE_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from("config")], programId);
}

/**
 * Get the oracle registry PDA
 */
export async function getOracleRegistryPDA(
  programId: PublicKey = SPACE_CORE_PROGRAM_ID,
): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("oracle_registry")],
    programId,
  );
}

/**
 * Get the insurance fund PDA
 */
export async function getInsuranceFundPDA(
  programId: PublicKey = SPACE_CORE_PROGRAM_ID,
): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("insurance_fund")],
    programId,
  );
}

/**
 * Get the insurance vault PDA (token account)
 */
export async function getInsuranceVaultPDA(
  programId: PublicKey = SPACE_CORE_PROGRAM_ID,
): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("insurance_vault")],
    programId,
  );
}

/**
 * Get the insurance authority PDA
 */
export async function getInsuranceAuthorityPDA(
  programId: PublicKey = SPACE_CORE_PROGRAM_ID,
): Promise<[PublicKey, number]> {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("insurance_authority")],
    programId,
  );
}

/**
 * Get the TWAP state PDA
 */
export function getTwapStatePDA(
  market: PublicKey,
  programId: PublicKey = SPACE_CORE_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("twap_state"), market.toBuffer()],
    programId,
  );
}

/**
 * Get the pending order PDA
 * Note: Uses "order" seed to match Rust program
 */
export function getPendingOrderPDA(
  user: PublicKey,
  orderId: number | BN,
  programId: PublicKey = SPACE_CORE_PROGRAM_ID,
): [PublicKey, number] {
  const orderIdBytes = u64ToLeBytes(orderId);
  // Match Rust seeds: [b"order", user.key().as_ref(), &order_id.to_le_bytes()]
  const seeds = [Buffer.from("order"), user.toBuffer(), orderIdBytes];

  const [pda, bump] = PublicKey.findProgramAddressSync(seeds, programId);

  return [pda, bump];
}

/**
 * Get the order escrow PDA (token account that holds locked margin)
 */
export function getOrderEscrowPDA(
  user: PublicKey,
  orderId: number | BN,
  programId: PublicKey = SPACE_CORE_PROGRAM_ID,
): [PublicKey, number] {
  const orderIdBytes = u64ToLeBytes(orderId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("order_escrow"), user.toBuffer(), orderIdBytes],
    programId,
  );
}

/**
 * Get the order escrow authority PDA
 */
export function getOrderEscrowAuthorityPDA(
  user: PublicKey,
  orderId: number | BN,
  programId: PublicKey = SPACE_CORE_PROGRAM_ID,
): [PublicKey, number] {
  const orderIdBytes = u64ToLeBytes(orderId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("order_escrow_authority"), user.toBuffer(), orderIdBytes],
    programId,
  );
}

/**
 * Get the share escrow authority PDA
 */
export function getShareEscrowAuthorityPDA(
  user: PublicKey,
  orderId: number | BN,
  programId: PublicKey = SPACE_CORE_PROGRAM_ID,
): [PublicKey, number] {
  const orderIdBytes = u64ToLeBytes(orderId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("share_escrow_authority"), user.toBuffer(), orderIdBytes],
    programId,
  );
}

/**
 * Get the share escrow YES PDA (token account for escrowing YES shares)
 */
export function getShareEscrowYesPDA(
  user: PublicKey,
  orderId: number | BN,
  programId: PublicKey = SPACE_CORE_PROGRAM_ID,
): [PublicKey, number] {
  const orderIdBytes = u64ToLeBytes(orderId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("share_escrow"), user.toBuffer(), orderIdBytes],
    programId,
  );
}

/**
 * Get the share escrow NO PDA (token account for escrowing NO shares)
 */
export function getShareEscrowNoPDA(
  user: PublicKey,
  orderId: number | BN,
  programId: PublicKey = SPACE_CORE_PROGRAM_ID,
): [PublicKey, number] {
  const orderIdBytes = u64ToLeBytes(orderId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("share_escrow_no"), user.toBuffer(), orderIdBytes],
    programId,
  );
}

// ========================================================================
// TOKEN-BASED SHARE PDAs (Space-style)
// ========================================================================

/**
 * Get the YES token mint PDA for a specific outcome
 */
export function getYesMintPDA(
  market: PublicKey,
  outcomeId?: number,
  programId: PublicKey = SPACE_CORE_PROGRAM_ID,
): [PublicKey, number] {
  const seeds =
    outcomeId !== undefined
      ? [Buffer.from("yes_mint"), market.toBuffer(), Buffer.from([outcomeId])]
      : [Buffer.from("yes_mint"), market.toBuffer()];
  return PublicKey.findProgramAddressSync(seeds, programId);
}

/**
 * Get NO mint PDA.
 * - New model (per-outcome NO): pass outcomeId to derive [b"no_mint", market, &[outcomeId]]
 * - Old model (shared NO): omit outcomeId to derive [b"no_mint", market]
 */
export function getNoMintPDA(
  market: PublicKey,
  outcomeId?: number,
  programId: PublicKey = SPACE_CORE_PROGRAM_ID,
): [PublicKey, number] {
  const seeds =
    outcomeId !== undefined
      ? [Buffer.from("no_mint"), market.toBuffer(), Buffer.from([outcomeId])]
      : [Buffer.from("no_mint"), market.toBuffer()];
  return PublicKey.findProgramAddressSync(seeds, programId);
}

/**
 * Get the mint authority PDA
 */
export function getMintAuthorityPDA(
  market: PublicKey,
  programId: PublicKey = SPACE_CORE_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("mint_authority"), market.toBuffer()],
    programId,
  );
}

/**
 * Get the match state PDA for order execution
 * Seeds: [b"match", market.key().as_ref(), &buy_order_id.to_le_bytes(), &sell_order_id.to_le_bytes()]
 */
export function getMatchStatePDA(
  market: PublicKey,
  buyOrderId: number | BN,
  sellOrderId: number | BN,
  programId: PublicKey = SPACE_CORE_PROGRAM_ID,
): [PublicKey, number] {
  const buyOrderIdBytes = u64ToLeBytes(buyOrderId);
  const sellOrderIdBytes = u64ToLeBytes(sellOrderId);
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("match"),
      market.toBuffer(),
      buyOrderIdBytes,
      sellOrderIdBytes,
    ],
    programId,
  );
}

/**
 * Get the order PDA (updated seeds for new program)
 */
export function getOrderPDA(
  user: PublicKey,
  orderId: number | BN,
  programId: PublicKey = SPACE_CORE_PROGRAM_ID,
): [PublicKey, number] {
  const orderIdBytes = u64ToLeBytes(orderId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("order"), user.toBuffer(), orderIdBytes],
    programId,
  );
}

/**
 * Convert USDC amount to lamports (6 decimals)
 */
export function usdcToLamports(usdcAmount: number): number {
  return Math.floor(usdcAmount * 1_000_000);
}

/**
 * Convert lamports to USDC (6 decimals)
 */
export function lamportsToUsdc(lamports: number): number {
  return lamports / 1_000_000;
}

/**
 * Get or create associated token account
 */
export async function getOrCreateATA(
  connection: Connection,
  payer: PublicKey,
  mint: PublicKey,
  owner: PublicKey,
): Promise<PublicKey> {
  const ata = await getAssociatedTokenAddress(mint, owner);

  try {
    await getAccount(connection, ata);
    return ata;
  } catch (error: any) {
    if (error.name === "TokenAccountNotFoundError") {
      // Create ATA instruction would be added to transaction
      return ata;
    }
    throw error;
  }
}

/**
 * Calculate required margin for a leveraged position
 */
export function calculateRequiredMargin(
  notional: number,
  leverage: number,
): number {
  if (leverage < 1 || leverage > MAX_LEVERAGE) {
    throw new Error(`Leverage must be between 1 and ${MAX_LEVERAGE}`);
  }
  return Math.floor(notional / leverage);
}

/**
 * Calculate notional from shares and price
 */
export function calculateNotional(shares: number, price: number): number {
  return Math.floor((shares * price) / BASIS_POINTS);
}

/**
 * Convert price to basis points
 */
export function priceToBasisPoints(price: number): number {
  return Math.floor(price * BASIS_POINTS);
}

/**
 * Convert basis points to price
 */
export function basisPointsToPrice(bps: number): number {
  return bps / BASIS_POINTS;
}

/**
 * Calculate equity for a position
 */
export function calculateEquity(
  collateral: number,
  shares: number,
  entryPrice: number,
  currentPrice: number,
  side: number, // 0 = Long, 1 = Short
): number {
  const entryNotional = calculateNotional(shares, entryPrice);
  const currentNotional = calculateNotional(shares, currentPrice);

  const unrealizedPnl =
    side === 0
      ? currentNotional - entryNotional // Long: profit when price goes up
      : entryNotional - currentNotional; // Short: profit when price goes down

  return collateral + unrealizedPnl;
}

/**
 * Calculate maintenance margin requirement
 */
export function calculateMaintenanceMargin(notional: number): number {
  return Math.floor((notional * MAINTENANCE_MARGIN_BPS) / BASIS_POINTS);
}
