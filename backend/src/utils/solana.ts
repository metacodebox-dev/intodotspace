import { PublicKey } from "@solana/web3.js";
import { BN } from "@coral-xyz/anchor";

// Program ID - Must match deployed program
export const SPACE_CORE_PROGRAM_ID = new PublicKey(
  "DKRg9skUuewV1wdbVD6tpnoHtbWWy2Chq7EKdpPRY6Eh",
);

// Note: Resolution, settlement, and redemption are all handled by space_core now

/**
 * Convert a u64 to little-endian byte array
 */
function u64ToLeBytes(value: number | BN): Buffer {
  const bytes = Buffer.alloc(8);
  let num: bigint;

  if (typeof value === "number") {
    num = BigInt(value);
  } else {
    num = BigInt(value.toString());
  }

  for (let i = 0; i < 8; i++) {
    bytes[i] = Number(num & 0xffn);
    num = num >> 8n;
  }

  return bytes;
}

/**
 * Get the market PDA
 */
export function getMarketPDA(
  creator: PublicKey,
  marketId: number | BN,
  programId: PublicKey = SPACE_CORE_PROGRAM_ID,
): [PublicKey, number] {
  const marketIdBytes = u64ToLeBytes(marketId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from("market"), creator.toBuffer(), marketIdBytes],
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
 * Get the margin account PDA
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
 * Get the pending order PDA
 */
export function getPendingOrderPDA(
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
 * Get the order escrow PDA
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
 * Get the insurance fund PDA
 */
export function getInsuranceFundPDA(
  programId: PublicKey = SPACE_CORE_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("insurance_fund")],
    programId,
  );
}

/**
 * Get the insurance vault PDA
 */
export function getInsuranceVaultPDA(
  programId: PublicKey = SPACE_CORE_PROGRAM_ID,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("insurance_vault")],
    programId,
  );
}
