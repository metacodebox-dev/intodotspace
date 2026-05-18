import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { getOrCreateAssociatedTokenAccount, mintTo } from "@solana/spl-token";
import { FaucetClaim } from "../models/FaucetClaim";

const USDC_MINT = new PublicKey(
  process.env.USDC_MINT || "CqdmbJnQxMNNTGZzsBhEPTSzH52Pwa5DRvpVjZ2Us92t",
);
const SPACE_MINT = new PublicKey(
  process.env.SPACE_MINT || "EHaeA9ke8Gaj9AKdjZ92pvk6oUFSZ5YehaqhAhgqZRZa",
);
const FAUCET_AMOUNT = 100_000_000; // 100 USDC (6 decimals)
const SPACE_FAUCET_AMOUNT = 100 * 1_000_000_000; // 100 SPACE (9 decimals)
const SOL_FAUCET_AMOUNT = Math.floor(0.01 * LAMPORTS_PER_SOL); // 0.01 SOL

export interface FaucetClaimResult {
  success: boolean;
  message: string;
  txSignature?: string;
  amount?: number;
  nextClaimAt?: Date;
}

export interface FaucetStatusResult {
  canClaim: boolean;
  nextClaimAt: Date | null;
  lastClaimAt: Date | null;
  lastTxSignature: string | null;
  amountPerClaim: number;
}

class FaucetService {
  private connection: Connection;
  private mintAuthority: Keypair | null = null;
  private initialized: boolean = false;

  constructor() {
    this.connection = new Connection(
      process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com",
      {
        commitment: "confirmed",
        wsEndpoint: process.env.SOLANA_WS_URL,
        confirmTransactionInitialTimeout: 60000,
      },
    );

    // FAUCET_KEYPAIR must be the mint authority for both USDC and SPACE.
    // Falls back to KEEPER_KEYPAIR if FAUCET_KEYPAIR is not set.
    const keypairEnv = process.env.FAUCET_KEYPAIR || process.env.KEEPER_KEYPAIR;
    if (keypairEnv) {
      try {
        const keypairArray = JSON.parse(keypairEnv);
        this.mintAuthority = Keypair.fromSecretKey(
          Uint8Array.from(keypairArray),
        );
        this.initialized = true;
        console.log(
          "[Faucet] Mint authority loaded:",
          this.mintAuthority.publicKey.toString(),
        );
      } catch (e) {
        console.warn("[Faucet] Failed to load faucet keypair:", e);
      }
    } else {
      console.warn("[Faucet] FAUCET_KEYPAIR not set - faucet service disabled");
    }
  }

  isAvailable(): boolean {
    return this.initialized && this.mintAuthority !== null;
  }

  async getStatus(walletAddress: string): Promise<FaucetStatusResult> {
    const { canClaim, nextClaimAt } = await FaucetClaim.canClaim(
      walletAddress,
      "usdc",
    );
    const lastClaim = await FaucetClaim.getLastClaim(walletAddress, "usdc");

    return {
      canClaim: canClaim && this.isAvailable(),
      nextClaimAt,
      lastClaimAt: lastClaim ? lastClaim.claimedAt : null,
      lastTxSignature: lastClaim ? lastClaim.txSignature : null,
      amountPerClaim: FAUCET_AMOUNT,
    };
  }

  async getSolStatus(walletAddress: string): Promise<FaucetStatusResult> {
    const { canClaim, nextClaimAt } = await FaucetClaim.canClaim(
      walletAddress,
      "sol",
    );
    const lastClaim = await FaucetClaim.getLastClaim(walletAddress, "sol");

    return {
      canClaim: canClaim && this.isAvailable(),
      nextClaimAt,
      lastClaimAt: lastClaim ? lastClaim.claimedAt : null,
      lastTxSignature: lastClaim ? lastClaim.txSignature : null,
      amountPerClaim: SOL_FAUCET_AMOUNT,
    };
  }

  async claim(walletAddress: string): Promise<FaucetClaimResult> {
    if (!this.isAvailable() || !this.mintAuthority) {
      return {
        success: false,
        message: "Faucet service is not available.",
      };
    }

    const { canClaim, nextClaimAt } = await FaucetClaim.canClaim(
      walletAddress,
      "usdc",
    );
    if (!canClaim) {
      return {
        success: false,
        message: "You have already claimed today. Please try again later.",
        nextClaimAt: nextClaimAt || undefined,
      };
    }

    try {
      const userPublicKey = new PublicKey(walletAddress);

      const userATA = await getOrCreateAssociatedTokenAccount(
        this.connection,
        this.mintAuthority,
        USDC_MINT,
        userPublicKey,
      );

      console.log(
        `[Faucet] Minting ${FAUCET_AMOUNT} lamports to ATA ${userATA.address.toString()} for ${walletAddress}`,
      );

      const txSignature = await mintTo(
        this.connection,
        this.mintAuthority,
        USDC_MINT,
        userATA.address,
        this.mintAuthority,
        FAUCET_AMOUNT,
      );

      console.log(`[Faucet] Mint successful: ${txSignature}`);

      await FaucetClaim.create({
        walletAddress,
        claimType: "usdc",
        amount: FAUCET_AMOUNT,
        txSignature,
        status: "completed",
        claimedAt: new Date(),
      });

      return {
        success: true,
        message: "Successfully claimed 100 USDC!",
        txSignature,
        amount: FAUCET_AMOUNT,
      };
    } catch (error: any) {
      console.error("[Faucet] Claim failed:", error);

      try {
        await FaucetClaim.create({
          walletAddress,
          claimType: "usdc",
          amount: FAUCET_AMOUNT,
          txSignature: null,
          status: "failed",
          claimedAt: new Date(),
        });
      } catch (dbError) {
        console.error("[Faucet] Failed to record failed claim:", dbError);
      }

      return {
        success: false,
        message: `Faucet claim failed: ${error.message || "Unknown error"}. Please try again.`,
      };
    }
  }

  async getSpaceStatus(walletAddress: string): Promise<FaucetStatusResult> {
    const { canClaim, nextClaimAt } = await FaucetClaim.canClaim(
      walletAddress,
      "space",
    );
    const lastClaim = await FaucetClaim.getLastClaim(walletAddress, "space");

    return {
      canClaim: canClaim && this.isAvailable(),
      nextClaimAt,
      lastClaimAt: lastClaim ? lastClaim.claimedAt : null,
      lastTxSignature: lastClaim ? lastClaim.txSignature : null,
      amountPerClaim: SPACE_FAUCET_AMOUNT,
    };
  }

  async claimSpace(walletAddress: string): Promise<FaucetClaimResult> {
    if (!this.isAvailable() || !this.mintAuthority) {
      return {
        success: false,
        message: "Faucet service is not available.",
      };
    }

    const { canClaim, nextClaimAt } = await FaucetClaim.canClaim(
      walletAddress,
      "space",
    );
    if (!canClaim) {
      return {
        success: false,
        message:
          "You have already claimed SPC today. Please try again later.",
        nextClaimAt: nextClaimAt || undefined,
      };
    }

    try {
      const userPublicKey = new PublicKey(walletAddress);

      const userATA = await getOrCreateAssociatedTokenAccount(
        this.connection,
        this.mintAuthority,
        SPACE_MINT,
        userPublicKey,
      );

      console.log(
        `[Faucet] Minting ${SPACE_FAUCET_AMOUNT} SPACE lamports to ATA ${userATA.address.toString()} for ${walletAddress}`,
      );

      const txSignature = await mintTo(
        this.connection,
        this.mintAuthority,
        SPACE_MINT,
        userATA.address,
        this.mintAuthority,
        SPACE_FAUCET_AMOUNT,
      );

      console.log(`[Faucet] SPACE mint successful: ${txSignature}`);

      await FaucetClaim.create({
        walletAddress,
        claimType: "space",
        amount: SPACE_FAUCET_AMOUNT,
        txSignature,
        status: "completed",
        claimedAt: new Date(),
      });

      return {
        success: true,
        message: "Successfully claimed 100 SPC!",
        txSignature,
        amount: SPACE_FAUCET_AMOUNT,
      };
    } catch (error: any) {
      console.error("[Faucet] SPACE claim failed:", error);

      try {
        await FaucetClaim.create({
          walletAddress,
          claimType: "space",
          amount: SPACE_FAUCET_AMOUNT,
          txSignature: null,
          status: "failed",
          claimedAt: new Date(),
        });
      } catch (dbError) {
        console.error("[Faucet] Failed to record failed SPACE claim:", dbError);
      }

      return {
        success: false,
        message: `SPC faucet claim failed: ${error.message || "Unknown error"}. Please try again.`,
      };
    }
  }

  async claimSol(walletAddress: string): Promise<FaucetClaimResult> {
    if (!this.isAvailable() || !this.mintAuthority) {
      return {
        success: false,
        message: "Faucet service is not available.",
      };
    }

    const { canClaim, nextClaimAt } = await FaucetClaim.canClaim(
      walletAddress,
      "sol",
    );
    if (!canClaim) {
      return {
        success: false,
        message: "You have already claimed SOL today. Please try again later.",
        nextClaimAt: nextClaimAt || undefined,
      };
    }

    try {
      const userPublicKey = new PublicKey(walletAddress);

      // Check faucet wallet SOL balance
      const faucetBalance = await this.connection.getBalance(
        this.mintAuthority.publicKey,
      );
      const requiredBalance = SOL_FAUCET_AMOUNT + 5000; // include tx fee
      if (faucetBalance < requiredBalance) {
        console.warn(
          `[Faucet] Insufficient SOL balance: ${faucetBalance / LAMPORTS_PER_SOL} SOL, need ${requiredBalance / LAMPORTS_PER_SOL} SOL`,
        );
        return {
          success: false,
          message:
            "Faucet wallet has insufficient SOL. Please try again later.",
        };
      }

      console.log(
        `[Faucet] Transferring ${SOL_FAUCET_AMOUNT / LAMPORTS_PER_SOL} SOL to ${walletAddress}`,
      );

      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: this.mintAuthority.publicKey,
          toPubkey: userPublicKey,
          lamports: SOL_FAUCET_AMOUNT,
        }),
      );

      const txSignature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [this.mintAuthority],
      );

      console.log(`[Faucet] SOL transfer successful: ${txSignature}`);

      await FaucetClaim.create({
        walletAddress,
        claimType: "sol",
        amount: SOL_FAUCET_AMOUNT,
        txSignature,
        status: "completed",
        claimedAt: new Date(),
      });

      return {
        success: true,
        message: "Successfully claimed 0.01 SOL!",
        txSignature,
        amount: SOL_FAUCET_AMOUNT,
      };
    } catch (error: any) {
      console.error("[Faucet] SOL claim failed:", error);

      try {
        await FaucetClaim.create({
          walletAddress,
          claimType: "sol",
          amount: SOL_FAUCET_AMOUNT,
          txSignature: null,
          status: "failed",
          claimedAt: new Date(),
        });
      } catch (dbError) {
        console.error("[Faucet] Failed to record failed SOL claim:", dbError);
      }

      return {
        success: false,
        message: `SOL faucet claim failed: ${error.message || "Unknown error"}. Please try again.`,
      };
    }
  }
}

export const faucetService = new FaucetService();
