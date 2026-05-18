import { Connection, PublicKey, Keypair, Transaction } from "@solana/web3.js";
import {
  getAssociatedTokenAddress,
  createTransferInstruction,
  TOKEN_PROGRAM_ID,
} from "@solana/spl-token";
import * as fs from "fs";
import * as path from "path";

// Configuration
const PROGRAM_ID = new PublicKey(
  "DKRg9skUuewV1wdbVD6tpnoHtbWWy2Chq7EKdpPRY6Eh",
);
const USDC_MINT = new PublicKey("4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU"); // Devnet USDC

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.log(
      "Usage: npx ts-node scripts/fundLiquidityVault.ts <market_pubkey> <amount_usdc>",
    );
    console.log(
      "Example: npx ts-node scripts/fundLiquidityVault.ts K8yfcxipzqXn3T2Jh9Rx6d5L7xxrDvLbwt2GhF2tz99 1000",
    );
    process.exit(1);
  }

  const marketPubkey = new PublicKey(args[0]);
  const amountUsdc = parseFloat(args[1]);
  const amountLamports = BigInt(Math.floor(amountUsdc * 1_000_000)); // USDC has 6 decimals

  // Load wallet
  const walletPath = path.join(
    process.env.HOME || process.env.USERPROFILE || "",
    ".config",
    "solana",
    "id.json",
  );
  const walletKeypair = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf-8"))),
  );

  console.log("Wallet:", walletKeypair.publicKey.toBase58());
  console.log("Market:", marketPubkey.toBase58());
  console.log("Amount:", amountUsdc, "USDC");

  // Derive liquidity vault PDA
  const [liquidityVaultPDA] = PublicKey.findProgramAddressSync(
    [Buffer.from("liquidity_vault"), marketPubkey.toBuffer()],
    PROGRAM_ID,
  );
  console.log("Liquidity Vault PDA:", liquidityVaultPDA.toBase58());

  // Connect to devnet
  const connection = new Connection(
    "https://api.devnet.solana.com",
    "confirmed",
  );

  // Get user's USDC ATA
  const userUsdcATA = await getAssociatedTokenAddress(
    USDC_MINT,
    walletKeypair.publicKey,
  );
  console.log("User USDC ATA:", userUsdcATA.toBase58());

  // Check user's USDC balance
  try {
    const userUsdcBalance =
      await connection.getTokenAccountBalance(userUsdcATA);
    console.log("User USDC Balance:", userUsdcBalance.value.uiAmount, "USDC");
  } catch (e) {
    console.error(
      "Error: User USDC account not found. Please get some devnet USDC first.",
    );
    process.exit(1);
  }

  // Check if liquidity vault exists
  const vaultInfo = await connection.getAccountInfo(liquidityVaultPDA);
  if (!vaultInfo) {
    console.error(
      "Error: Liquidity vault does not exist. Make sure the market is properly initialized.",
    );
    process.exit(1);
  }

  // Check current liquidity vault balance
  try {
    const vaultBalance =
      await connection.getTokenAccountBalance(liquidityVaultPDA);
    console.log(
      "Current Liquidity Vault Balance:",
      vaultBalance.value.uiAmount,
      "USDC",
    );
  } catch (e) {
    console.log("Note: Could not read vault balance (might be a new vault)");
  }

  // Create transfer instruction
  const transferIx = createTransferInstruction(
    userUsdcATA,
    liquidityVaultPDA,
    walletKeypair.publicKey,
    amountLamports,
  );

  // Build and send transaction
  const tx = new Transaction().add(transferIx);
  tx.feePayer = walletKeypair.publicKey;
  tx.recentBlockhash = (await connection.getLatestBlockhash()).blockhash;
  tx.sign(walletKeypair);

  console.log("\nSending transaction...");
  const signature = await connection.sendRawTransaction(tx.serialize());
  console.log("Transaction sent:", signature);

  await connection.confirmTransaction(signature, "confirmed");
  console.log("Transaction confirmed!");

  // Check new balance
  const newVaultBalance =
    await connection.getTokenAccountBalance(liquidityVaultPDA);
  console.log(
    "\nNew Liquidity Vault Balance:",
    newVaultBalance.value.uiAmount,
    "USDC",
  );
}

main().catch(console.error);
