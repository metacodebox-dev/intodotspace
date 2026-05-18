/**
 * Market Maker Script — Seeds the order book for a specific outcome
 *
 * Usage:
 *   npx ts-node scripts/seedOrderBook.ts <market_pubkey> <outcome_id> <yes_start_cents> [mint_amount_usdc]
 *
 * Example (4-outcome market, outcome 1 at 70¢):
 *   npx ts-node scripts/seedOrderBook.ts K8yfc...tz99 1 70 100000
 *
 * This will:
 *   1. Mint 100K YES + 100K NO tokens for the outcome (costs 100K USDC)
 *   2. YES side: sell orders 71¢-99¢, buy orders 1¢-70¢
 *   3. NO side:  sell orders 31¢-99¢, buy orders 1¢-30¢
 *   4. Distribute the 100K minted tokens randomly across sell levels
 *   5. Place buy orders with random USDC amounts across buy levels
 *   6. Register all orders in the backend DB
 */

import {
  Connection,
  PublicKey,
  Keypair,
  SystemProgram,
  SYSVAR_RENT_PUBKEY,
} from "@solana/web3.js";
import { AnchorProvider, BN, Program, Wallet } from "@coral-xyz/anchor";
import {
  TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";
import * as readline from "readline";

// ── Configuration ──────────────────────────────────────────────────────────
const PROGRAM_ID = new PublicKey(
  "DKRg9skUuewV1wdbVD6tpnoHtbWWy2Chq7EKdpPRY6Eh",
);
const USDC_MINT = new PublicKey("CqdmbJnQxMNNTGZzsBhEPTSzH52Pwa5DRvpVjZ2Us92t");
const BACKEND_URL = process.env.BACKEND_URL || "http://localhost:3001";
const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";

// Minimum order size in share lamports (5,000 USDC = 5_000_000_000)
const MIN_ORDER_SIZE = 5_000_000_000;

// ── PDA helpers (mirror frontend/src/utils/solana.ts) ─────────────────────
function u64ToLeBytes(value: number | BN): Buffer {
  const bn = value instanceof BN ? value : new BN(value);
  return Buffer.from(bn.toArray("le", 8));
}

function getPendingOrderPDA(
  user: PublicKey,
  orderId: number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("order"), user.toBuffer(), u64ToLeBytes(orderId)],
    PROGRAM_ID,
  );
}
function getOrderEscrowPDA(
  user: PublicKey,
  orderId: number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("order_escrow"), user.toBuffer(), u64ToLeBytes(orderId)],
    PROGRAM_ID,
  );
}
function getOrderEscrowAuthorityPDA(
  user: PublicKey,
  orderId: number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("order_escrow_authority"),
      user.toBuffer(),
      u64ToLeBytes(orderId),
    ],
    PROGRAM_ID,
  );
}
function getShareEscrowAuthorityPDA(
  user: PublicKey,
  orderId: number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from("share_escrow_authority"),
      user.toBuffer(),
      u64ToLeBytes(orderId),
    ],
    PROGRAM_ID,
  );
}
function getShareEscrowYesPDA(
  user: PublicKey,
  orderId: number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("share_escrow"), user.toBuffer(), u64ToLeBytes(orderId)],
    PROGRAM_ID,
  );
}
function getShareEscrowNoPDA(
  user: PublicKey,
  orderId: number,
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("share_escrow_no"), user.toBuffer(), u64ToLeBytes(orderId)],
    PROGRAM_ID,
  );
}
function getPositionPDA(
  market: PublicKey,
  user: PublicKey,
  outcomeId: number,
  side: number,
  positionType: number,
  tokenType: number = 0,
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
    PROGRAM_ID,
  );
}
function getYesMintPDA(
  market: PublicKey,
  outcomeId?: number,
): [PublicKey, number] {
  const seeds =
    outcomeId !== undefined
      ? [Buffer.from("yes_mint"), market.toBuffer(), Buffer.from([outcomeId])]
      : [Buffer.from("yes_mint"), market.toBuffer()];
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID);
}
function getNoMintPDA(
  market: PublicKey,
  outcomeId?: number,
): [PublicKey, number] {
  const seeds =
    outcomeId !== undefined
      ? [Buffer.from("no_mint"), market.toBuffer(), Buffer.from([outcomeId])]
      : [Buffer.from("no_mint"), market.toBuffer()];
  return PublicKey.findProgramAddressSync(seeds, PROGRAM_ID);
}

// ── Utility ────────────────────────────────────────────────────────────────

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

/** Generate a unique order ID */
let orderIdCounter =
  Math.floor(Date.now() / 1000) * 1000 + Math.floor(Math.random() * 1000);
function nextOrderId(): number {
  return orderIdCounter++;
}

// ── Backend DB registration ────────────────────────────────────────────────
async function registerOrderInDB(params: {
  marketId: string;
  outcomeId: number;
  side: "buy" | "sell";
  price: number; // basis points
  size: number; // lamports
  userId: string;
  onChainOrder: string;
  orderId: number;
  tokenType: "yes" | "no";
}) {
  try {
    const resp = await fetch(`${BACKEND_URL}/api/v1/orders/limit`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-pubkey": params.userId,
      },
      body: JSON.stringify({
        market_id: params.marketId,
        outcome_id: params.outcomeId,
        side: params.side,
        price: params.price,
        size: params.size,
        leverage: 1,
        token_type: params.tokenType,
        on_chain_order: params.onChainOrder,
        order_id: params.orderId,
      }),
    });
    if (!resp.ok) {
      const text = await resp.text();
      console.warn(
        `  [DB] Failed to register order ${params.orderId}: ${resp.status} ${text}`,
      );
    }
  } catch (err: any) {
    console.warn(
      `  [DB] Error registering order ${params.orderId}: ${err.message}`,
    );
  }
}

// ── Main ───────────────────────────────────────────────────────────────────
async function main() {
  const args = process.argv.slice(2);

  if (args.length < 3) {
    console.log(
      "Usage: npx ts-node scripts/seedOrderBook.ts <market_pubkey> <outcome_id> <yes_start_cents> [mint_amount_usdc]",
    );
    console.log("");
    console.log("Arguments:");
    console.log("  market_pubkey      Solana address of the market");
    console.log("  outcome_id         Outcome index (0, 1, 2, ...)");
    console.log(
      "  yes_start_cents    Starting YES price in cents (e.g. 70 means 70¢)",
    );
    console.log("  mint_amount_usdc   USDC to mint as shares (default 100000)");
    console.log("");
    console.log("Example:");
    console.log(
      "  npx ts-node scripts/seedOrderBook.ts K8yfcxipzq...99 1 70 100000",
    );
    process.exit(1);
  }

  const marketPubkey = new PublicKey(args[0]);
  const outcomeId = parseInt(args[1]);
  const yesStartCents = parseInt(args[2]);
  const mintAmountUsdc = parseFloat(args[3] || "100000");

  if (isNaN(outcomeId) || outcomeId < 0) {
    console.error("Error: outcome_id must be a non-negative integer");
    process.exit(1);
  }
  if (isNaN(yesStartCents) || yesStartCents < 1 || yesStartCents > 99) {
    console.error("Error: yes_start_cents must be between 1 and 99");
    process.exit(1);
  }

  const noStartCents = 100 - yesStartCents;
  const mintLamports = Math.floor(mintAmountUsdc * 1_000_000);

  // ── Load wallet ──
  const walletPath = path.join(
    process.env.HOME || process.env.USERPROFILE || "",
    ".config",
    "solana",
    "id.json",
  );
  if (!fs.existsSync(walletPath)) {
    console.error(`Error: Wallet file not found at ${walletPath}`);
    process.exit(1);
  }
  const walletKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf-8"))),
  );

  // ── Connect ──
  const connection = new Connection(RPC_URL, "confirmed");
  const wallet = new Wallet(walletKeypair);
  const provider = new AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });

  // ── Load IDL & Program ──
  const idlPath = path.join(
    __dirname,
    "..",
    "frontend",
    "src",
    "idl",
    "space_core.json",
  );
  if (!fs.existsSync(idlPath)) {
    console.error(`Error: IDL file not found at ${idlPath}`);
    process.exit(1);
  }
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf-8"));
  const program = new Program(idl, provider);

  // ── Display plan ──
  console.log("╔═══════════════════════════════════════════════════════════╗");
  console.log("║              ORDER BOOK SEEDER                           ║");
  console.log("╠═══════════════════════════════════════════════════════════╣");
  console.log(
    `║  Wallet:       ${walletKeypair.publicKey.toBase58().slice(0, 20)}...`,
  );
  console.log(`║  Market:       ${marketPubkey.toBase58().slice(0, 20)}...`);
  console.log(`║  Outcome:      ${outcomeId}`);
  console.log(`║  YES price:    ${yesStartCents}¢`);
  console.log(`║  NO  price:    ${noStartCents}¢`);
  console.log(`║  Mint amount:  ${mintAmountUsdc.toLocaleString()} USDC`);
  console.log(`║  RPC:          ${RPC_URL.slice(0, 40)}...`);
  console.log("╠═══════════════════════════════════════════════════════════╣");
  console.log(
    `║  YES SELL orders: ${yesStartCents + 1}¢ — 99¢  (${99 - yesStartCents} levels)`,
  );
  console.log(
    `║  YES BUY  orders: 1¢ — ${yesStartCents}¢       (${yesStartCents} levels)`,
  );
  console.log(
    `║  NO  SELL orders: ${noStartCents + 1}¢ — 99¢   (${99 - noStartCents} levels)`,
  );
  console.log(
    `║  NO  BUY  orders: 1¢ — ${noStartCents}¢        (${noStartCents} levels)`,
  );
  console.log("╚═══════════════════════════════════════════════════════════╝");

  // Check USDC balance
  const userUsdcATA = await getAssociatedTokenAddress(
    USDC_MINT,
    walletKeypair.publicKey,
  );
  try {
    const bal = await connection.getTokenAccountBalance(userUsdcATA);
    console.log(`\nUSDC balance: ${bal.value.uiAmount?.toLocaleString()} USDC`);
  } catch {
    console.error("Error: No USDC account found. Fund your wallet first.");
    process.exit(1);
  }

  // Confirmation prompt
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });
  const answer: string = await new Promise((resolve) =>
    rl.question("\nProceed? (y/n) ", resolve),
  );
  rl.close();
  if (answer.toLowerCase() !== "y") {
    console.log("Aborted.");
    process.exit(0);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 1: Mint shares (deposit USDC → get YES + NO)
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n═══ STEP 1: Minting shares ═══");
  console.log(
    `Minting ${mintAmountUsdc.toLocaleString()} YES + NO tokens for outcome ${outcomeId}...`,
  );

  const [marketVaultPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault"), marketPubkey.toBuffer()],
    PROGRAM_ID,
  );
  const [vaultAuthorityPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("vault_authority"), marketPubkey.toBuffer()],
    PROGRAM_ID,
  );
  const [mintAuthorityPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("mint_authority"), marketPubkey.toBuffer()],
    PROGRAM_ID,
  );
  // Detect old vs new YES mint PDA — old markets may use [b"yes_mint", market] without outcomeId
  const [newYesMintPDA] = getYesMintPDA(marketPubkey, outcomeId);
  const [oldYesMintPDA] = getYesMintPDA(marketPubkey); // old model: no outcomeId
  const newYesMintInfo = await connection.getAccountInfo(newYesMintPDA);
  const yesMintPDA = (newYesMintInfo && newYesMintInfo.data.length > 0)
    ? newYesMintPDA
    : oldYesMintPDA;

  if (yesMintPDA.equals(oldYesMintPDA)) {
    console.log(`  Using OLD YES mint PDA (no outcomeId)`);
  } else {
    console.log(`  Using NEW per-outcome YES mint PDA`);
  }

  // Detect old vs new NO mint PDA — old markets use shared [b"no_mint", market]
  const [newNoMintPDA] = getNoMintPDA(marketPubkey, outcomeId);
  const [oldNoMintPDA] = getNoMintPDA(marketPubkey); // old model: no outcomeId
  const newNoMintInfo = await connection.getAccountInfo(newNoMintPDA);
  const noMintPDA = (newNoMintInfo && newNoMintInfo.data.length > 0)
    ? newNoMintPDA
    : oldNoMintPDA;

  if (noMintPDA.equals(oldNoMintPDA)) {
    console.log(`  Using OLD shared NO mint PDA (no outcomeId)`);
  } else {
    console.log(`  Using NEW per-outcome NO mint PDA`);
  }

  // Verify both mints actually exist on-chain before proceeding
  const [yesMintCheck, noMintCheck] = await Promise.all([
    connection.getAccountInfo(yesMintPDA),
    connection.getAccountInfo(noMintPDA),
  ]);
  if (!yesMintCheck || yesMintCheck.data.length === 0) {
    console.error(`ERROR: YES mint ${yesMintPDA.toBase58()} does not exist on-chain. Cannot seed this market.`);
    process.exit(1);
  }
  if (!noMintCheck || noMintCheck.data.length === 0) {
    console.error(`ERROR: NO mint ${noMintPDA.toBase58()} does not exist on-chain. Cannot seed this market.`);
    process.exit(1);
  }

  const userYesATA = await getAssociatedTokenAddress(
    yesMintPDA,
    walletKeypair.publicKey,
  );
  const userNoATA = await getAssociatedTokenAddress(
    noMintPDA,
    walletKeypair.publicKey,
  );

  // Ensure ATAs exist
  const preIxs: any[] = [];
  try {
    await getAccount(connection, userYesATA);
  } catch {
    preIxs.push(
      createAssociatedTokenAccountInstruction(
        walletKeypair.publicKey,
        userYesATA,
        walletKeypair.publicKey,
        yesMintPDA,
      ),
    );
  }
  try {
    await getAccount(connection, userNoATA);
  } catch {
    preIxs.push(
      createAssociatedTokenAccountInstruction(
        walletKeypair.publicKey,
        userNoATA,
        walletKeypair.publicKey,
        noMintPDA,
      ),
    );
  }

  try {
    const mintTx = await program.methods
      .mintShares(outcomeId, new BN(mintLamports))
      .accounts({
        market: marketPubkey,
        user: walletKeypair.publicKey,
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
      .preInstructions(preIxs)
      .rpc();
    console.log(`  Mint TX: ${mintTx}`);
    await sleep(2000);
  } catch (err: any) {
    console.error(`  Mint failed: ${err.message}`);
    process.exit(1);
  }

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 2: Build order plans
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n═══ STEP 2: Building order plans ═══");

  // --- Price levels ---
  const yesSellLevels: number[] = [];
  for (let c = yesStartCents + 1; c <= 99; c++) yesSellLevels.push(c);

  const noSellLevels: number[] = [];
  for (let c = noStartCents + 1; c <= 99; c++) noSellLevels.push(c);

  const yesBuyLevels: number[] = [];
  for (let c = yesStartCents; c >= 1; c--) yesBuyLevels.push(c);

  const noBuyLevels: number[] = [];
  for (let c = noStartCents; c >= 1; c--) noBuyLevels.push(c);

  interface OrderPlan {
    side: "buy" | "sell";
    tokenType: "yes" | "no";
    priceCents: number;
    priceBps: number;
    quantity: number; // lamports
  }

  const orders: OrderPlan[] = [];

  // Chunk-based distribution: place MIN_ORDER_SIZE (5K shares) per order,
  // cycle through price levels until tokens run out.

  // 1. YES sell orders — cycle through sell levels with 5K chunks
  let yesRemaining = mintLamports;
  let yesSellIdx = 0;
  while (yesRemaining >= MIN_ORDER_SIZE && yesSellLevels.length > 0) {
    const lvl = yesSellLevels[yesSellIdx % yesSellLevels.length];
    orders.push({
      side: "sell",
      tokenType: "yes",
      priceCents: lvl,
      priceBps: lvl * 100,
      quantity: MIN_ORDER_SIZE,
    });
    yesRemaining -= MIN_ORDER_SIZE;
    yesSellIdx++;
  }

  // 2. NO sell orders — cycle through sell levels with 5K chunks
  let noRemaining = mintLamports;
  let noSellIdx = 0;
  while (noRemaining >= MIN_ORDER_SIZE && noSellLevels.length > 0) {
    const lvl = noSellLevels[noSellIdx % noSellLevels.length];
    orders.push({
      side: "sell",
      tokenType: "no",
      priceCents: lvl,
      priceBps: lvl * 100,
      quantity: MIN_ORDER_SIZE,
    });
    noRemaining -= MIN_ORDER_SIZE;
    noSellIdx++;
  }

  // 3. YES buy orders — 10% of mint as USDC budget, 5K share chunks
  const buyBudgetPerSide = Math.floor(mintLamports * 0.1);
  let yesBuyBudget = buyBudgetPerSide;
  let yesBuyIdx = 0;
  while (yesBuyBudget > 0 && yesBuyLevels.length > 0) {
    const lvl = yesBuyLevels[yesBuyIdx % yesBuyLevels.length];
    const priceBps = lvl * 100;
    const usdcCost = Math.ceil((MIN_ORDER_SIZE * priceBps) / 10000);
    if (yesBuyBudget < usdcCost) break;
    orders.push({
      side: "buy",
      tokenType: "yes",
      priceCents: lvl,
      priceBps,
      quantity: MIN_ORDER_SIZE,
    });
    yesBuyBudget -= usdcCost;
    yesBuyIdx++;
  }

  // 4. NO buy orders — 10% of mint as USDC budget, 5K share chunks
  let noBuyBudget = buyBudgetPerSide;
  let noBuyIdx = 0;
  while (noBuyBudget > 0 && noBuyLevels.length > 0) {
    const lvl = noBuyLevels[noBuyIdx % noBuyLevels.length];
    const priceBps = lvl * 100;
    const usdcCost = Math.ceil((MIN_ORDER_SIZE * priceBps) / 10000);
    if (noBuyBudget < usdcCost) break;
    orders.push({
      side: "buy",
      tokenType: "no",
      priceCents: lvl,
      priceBps,
      quantity: MIN_ORDER_SIZE,
    });
    noBuyBudget -= usdcCost;
    noBuyIdx++;
  }

  console.log(
    `  Chunk size: ${(MIN_ORDER_SIZE / 1e6).toLocaleString()} shares per order`,
  );
  console.log(
    `  YES tokens remaining: ${(yesRemaining / 1e6).toLocaleString()} (< 1 chunk)`,
  );
  console.log(
    `  NO  tokens remaining: ${(noRemaining / 1e6).toLocaleString()} (< 1 chunk)`,
  );
  console.log(`  Total orders to place: ${orders.length}`);
  console.log(
    `    YES SELL: ${orders.filter((o) => o.side === "sell" && o.tokenType === "yes").length}`,
  );
  console.log(
    `    YES BUY:  ${orders.filter((o) => o.side === "buy" && o.tokenType === "yes").length}`,
  );
  console.log(
    `    NO  SELL: ${orders.filter((o) => o.side === "sell" && o.tokenType === "no").length}`,
  );
  console.log(
    `    NO  BUY:  ${orders.filter((o) => o.side === "buy" && o.tokenType === "no").length}`,
  );

  // ═══════════════════════════════════════════════════════════════════════
  // STEP 3: Place orders on-chain + register in DB
  // ═══════════════════════════════════════════════════════════════════════
  console.log("\n═══ STEP 3: Placing orders on-chain ═══");

  let successCount = 0;
  let failCount = 0;
  let consecutiveFailures = 0;
  const MAX_CONSECUTIVE_FAILURES = 3;

  for (let idx = 0; idx < orders.length; idx++) {
    const o = orders[idx];
    const orderId = nextOrderId();
    const tag = `[${idx + 1}/${orders.length}] ${o.tokenType.toUpperCase()} ${o.side.toUpperCase()} ${o.priceCents}¢ qty=${(o.quantity / 1e6).toFixed(2)}`;

    try {
      if (o.side === "buy") {
        // ── BUY order (lock USDC margin) ──
        const [pendingOrderPDA] = getPendingOrderPDA(
          walletKeypair.publicKey,
          orderId,
        );
        const [orderEscrowAuthorityPDA] = getOrderEscrowAuthorityPDA(
          walletKeypair.publicKey,
          orderId,
        );
        const [orderEscrowPDA] = getOrderEscrowPDA(
          walletKeypair.publicKey,
          orderId,
        );

        const tx = await program.methods
          .placeBuyOrder(
            new BN(orderId),
            outcomeId,
            new BN(o.priceBps),
            new BN(o.quantity),
            1, // leverage = 1
          )
          .accounts({
            market: marketPubkey,
            user: walletKeypair.publicKey,
            userUsdc: userUsdcATA,
            pendingOrder: pendingOrderPDA,
            orderEscrowAuthority: orderEscrowAuthorityPDA,
            orderEscrow: orderEscrowPDA,
            usdcMint: USDC_MINT,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
          })
          .rpc();

        console.log(`  ${tag} → TX: ${tx.slice(0, 16)}...`);

        // Register in DB
        await registerOrderInDB({
          marketId: marketPubkey.toBase58(),
          outcomeId,
          side: "buy",
          price: o.priceBps,
          size: o.quantity,
          userId: walletKeypair.publicKey.toBase58(),
          onChainOrder: pendingOrderPDA.toBase58(),
          orderId,
          tokenType: o.tokenType,
        });

        successCount++;
      } else if (o.tokenType === "yes") {
        // ── YES SELL order (lock YES shares in escrow) ──
        const [pendingOrderPDA] = getPendingOrderPDA(
          walletKeypair.publicKey,
          orderId,
        );
        const [shareEscrowAuthorityPDA] = getShareEscrowAuthorityPDA(
          walletKeypair.publicKey,
          orderId,
        );
        const [shareEscrowYesPDA] = getShareEscrowYesPDA(
          walletKeypair.publicKey,
          orderId,
        );
        const [spotPositionPDA] = getPositionPDA(
          marketPubkey,
          walletKeypair.publicKey,
          outcomeId,
          0,
          0,
          0, // token_type=0 (YES)
        );

        const tx = await program.methods
          .placeYesLimitSellOrder(
            new BN(orderId),
            outcomeId,
            new BN(o.priceBps),
            new BN(o.quantity),
            1,
          )
          .accounts({
            market: marketPubkey,
            user: walletKeypair.publicKey,
            pendingOrder: pendingOrderPDA,
            userYesAccount: userYesATA,
            shareEscrowAuthority: shareEscrowAuthorityPDA,
            shareEscrowYes: shareEscrowYesPDA,
            yesMint: yesMintPDA,
            userPosition: spotPositionPDA,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .rpc();

        console.log(`  ${tag} → TX: ${tx.slice(0, 16)}...`);

        await registerOrderInDB({
          marketId: marketPubkey.toBase58(),
          outcomeId,
          side: "sell",
          price: o.priceBps,
          size: o.quantity,
          userId: walletKeypair.publicKey.toBase58(),
          onChainOrder: pendingOrderPDA.toBase58(),
          orderId,
          tokenType: "yes",
        });

        successCount++;
      } else {
        // ── NO SELL order (lock NO shares in escrow) ──
        const [pendingOrderPDA] = getPendingOrderPDA(
          walletKeypair.publicKey,
          orderId,
        );
        const [orderEscrowAuthorityPDA] = getOrderEscrowAuthorityPDA(
          walletKeypair.publicKey,
          orderId,
        );
        const [orderEscrowPDA] = getOrderEscrowPDA(
          walletKeypair.publicKey,
          orderId,
        );
        const [shareEscrowAuthorityPDA] = getShareEscrowAuthorityPDA(
          walletKeypair.publicKey,
          orderId,
        );
        const [shareEscrowNoPDA] = getShareEscrowNoPDA(
          walletKeypair.publicKey,
          orderId,
        );
        const [spotPositionPDA] = getPositionPDA(
          marketPubkey,
          walletKeypair.publicKey,
          outcomeId,
          0,
          0,
          1, // token_type=1 (NO)
        );

        const tx = await program.methods
          .placeNoLimitSellOrder(
            new BN(orderId),
            outcomeId,
            new BN(o.priceBps),
            new BN(o.quantity),
            1,
          )
          .accounts({
            market: marketPubkey,
            user: walletKeypair.publicKey,
            userUsdc: userUsdcATA,
            pendingOrder: pendingOrderPDA,
            orderEscrowAuthority: orderEscrowAuthorityPDA,
            orderEscrow: orderEscrowPDA,
            usdcMint: USDC_MINT,
            userNoAccount: userNoATA,
            shareEscrowAuthority: shareEscrowAuthorityPDA,
            shareEscrowNo: shareEscrowNoPDA,
            noMint: noMintPDA,
            userPosition: spotPositionPDA,
            tokenProgram: TOKEN_PROGRAM_ID,
            systemProgram: SystemProgram.programId,
            rent: SYSVAR_RENT_PUBKEY,
          })
          .rpc();

        console.log(`  ${tag} → TX: ${tx.slice(0, 16)}...`);

        await registerOrderInDB({
          marketId: marketPubkey.toBase58(),
          outcomeId,
          side: "sell",
          price: o.priceBps,
          size: o.quantity,
          userId: walletKeypair.publicKey.toBase58(),
          onChainOrder: pendingOrderPDA.toBase58(),
          orderId,
          tokenType: "no",
        });

        successCount++;
      }

      consecutiveFailures = 0; // reset on success
      // Rate-limit: small delay between transactions
      await sleep(500);
    } catch (err: any) {
      console.error(`  ${tag} FAILED: ${err.message?.slice(0, 120)}`);
      failCount++;
      consecutiveFailures++;
      if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
        console.error(`\n❌ ${MAX_CONSECUTIVE_FAILURES} consecutive failures — aborting to prevent fake orderbook.`);
        console.error(`   On-chain orders are failing. Fix the issue before re-running.`);
        break;
      }
      await sleep(1000);
    }
  }

  // ═══════════════════════════════════════════════════════════════════════
  // DONE
  // ═══════════════════════════════════════════════════════════════════════
  console.log(
    "\n╔═══════════════════════════════════════════════════════════╗",
  );
  console.log("║                    COMPLETE                              ║");
  console.log("╠═══════════════════════════════════════════════════════════╣");
  console.log(`║  Successful: ${successCount}`);
  console.log(`║  Failed:     ${failCount}`);
  console.log(`║  Total:      ${orders.length}`);
  console.log("╚═══════════════════════════════════════════════════════════╝");
}

main().catch((err) => {
  console.error("Fatal error:", err);
  process.exit(1);
});
