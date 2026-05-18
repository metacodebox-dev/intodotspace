/**
 * Runs the `migrate_market_v1_to_v2` instruction over Market accounts so
 * existing markets get the new quote_mint / quote_decimals / version fields
 * backfilled and their on-chain accounts realloc'd.
 *
 * Usage:
 *   npx ts-node scripts/migrateMarketsToV2.ts [--keypair <path>] --all
 *   npx ts-node scripts/migrateMarketsToV2.ts [--keypair <path>] <market_pubkey> [...]
 *
 * Env:
 *   SOLANA_RPC_URL              (default: https://api.devnet.solana.com)
 *   QUOTE_MINT                  (default: USDC devnet mint — all pre-v2 markets are USDC)
 *   ADMIN_KEYPAIR               (path OR inline JSON array of 64 bytes)
 *   AUTO_MARKET_KEEPER_KEYPAIR  (path OR inline JSON array; used for keeper-created markets)
 *
 * The signer must be either the market's creator or `config.admin`. The
 * keeper keypair works as creator for all markets spun up by autoMarketKeeperService.
 * Markets the signer didn't create (and isn't admin of) will fail with Unauthorized —
 * run a second pass with a different keypair for those.
 */
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
} from "@solana/web3.js";
import { AnchorProvider, Program, Wallet } from "@coral-xyz/anchor";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as crypto from "crypto";
import bs58 from "bs58";

const PROGRAM_ID = new PublicKey(
  "DKRg9skUuewV1wdbVD6tpnoHtbWWy2Chq7EKdpPRY6Eh",
);
const DEFAULT_USDC_MINT = new PublicKey(
  "CqdmbJnQxMNNTGZzsBhEPTSzH52Pwa5DRvpVjZ2Us92t",
);
const RPC_URL = process.env.SOLANA_RPC_URL || "https://api.devnet.solana.com";
const QUOTE_MINT = new PublicKey(process.env.QUOTE_MINT || DEFAULT_USDC_MINT);

const MARKET_DISCRIMINATOR = Buffer.from(
  crypto.createHash("sha256").update("account:Market").digest().subarray(0, 8),
);

function loadIdl(): any {
  const candidates = [
    path.join(__dirname, "..", "target", "idl", "space_core.json"),
    path.join(__dirname, "..", "frontend", "src", "idl", "space_core.json"),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, "utf-8"));
  }
  throw new Error(
    `IDL not found. Looked in:\n  ${candidates.join("\n  ")}\nRun 'anchor build' first.`,
  );
}

function keypairFromBytes(raw: string, source: string): Keypair {
  let bytes: number[];
  try {
    bytes = JSON.parse(raw);
  } catch (e: any) {
    throw new Error(`${source}: not valid JSON (${e.message})`);
  }
  if (!Array.isArray(bytes) || bytes.length !== 64) {
    throw new Error(
      `${source}: expected a JSON array of 64 bytes, got length ${Array.isArray(bytes) ? bytes.length : "non-array"}`,
    );
  }
  return Keypair.fromSecretKey(Uint8Array.from(bytes));
}

function loadWallet(explicitPath?: string): Keypair {
  // 1) explicit --keypair <path>
  if (explicitPath) {
    if (!fs.existsSync(explicitPath)) {
      throw new Error(`Wallet not found at ${explicitPath}`);
    }
    return keypairFromBytes(
      fs.readFileSync(explicitPath, "utf-8"),
      explicitPath,
    );
  }

  // 2) env vars, in priority order; each may hold either a file path or an
  //    inline JSON array (the backend/.env format for AUTO_MARKET_KEEPER_KEYPAIR)
  for (const envName of ["ADMIN_KEYPAIR", "AUTO_MARKET_KEEPER_KEYPAIR"]) {
    const v = process.env[envName];
    if (!v) continue;
    const trimmed = v.trim();
    if (trimmed.startsWith("[")) {
      return keypairFromBytes(trimmed, `$${envName}`);
    }
    if (!fs.existsSync(trimmed)) {
      throw new Error(`$${envName} points to missing file: ${trimmed}`);
    }
    return keypairFromBytes(fs.readFileSync(trimmed, "utf-8"), trimmed);
  }

  // 3) default Solana CLI keypair
  const defaultPath = path.join(os.homedir(), ".config", "solana", "id.json");
  if (!fs.existsSync(defaultPath)) {
    throw new Error(
      `No keypair source. Pass --keypair <path>, set $ADMIN_KEYPAIR or $AUTO_MARKET_KEEPER_KEYPAIR, or place one at ${defaultPath}.`,
    );
  }
  return keypairFromBytes(fs.readFileSync(defaultPath, "utf-8"), defaultPath);
}

async function findAllMarketPubkeys(
  connection: Connection,
): Promise<PublicKey[]> {
  const accounts = await connection.getProgramAccounts(PROGRAM_ID, {
    filters: [
      {
        memcmp: {
          offset: 0,
          bytes: bs58.encode(MARKET_DISCRIMINATOR),
        },
      },
    ],
    dataSlice: { offset: 0, length: 0 }, // only pubkeys; full data not needed
  });
  return accounts.map((a) => a.pubkey);
}

function getConfigPDA(): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from("config")],
    PROGRAM_ID,
  )[0];
}

async function migrateOne(
  program: any,
  market: PublicKey,
  admin: Keypair,
): Promise<"migrated" | "already" | "error"> {
  try {
    const sig = await program.methods
      .migrateMarketV1ToV2()
      .accounts({
        market,
        quoteMint: QUOTE_MINT,
        config: getConfigPDA(),
        admin: admin.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .signers([admin])
      .rpc();
    console.log(`  OK   ${market.toBase58()}  tx=${sig}`);
    return "migrated";
  } catch (e: any) {
    const msg = String(e?.message || e);
    if (msg.includes("AlreadyMigrated") || msg.includes("already migrated")) {
      console.log(`  SKIP ${market.toBase58()}  (already v2)`);
      return "already";
    }
    console.log(`  FAIL ${market.toBase58()}  ${msg.split("\n")[0]}`);
    return "error";
  }
}

async function main() {
  const argv = process.argv.slice(2);
  let keypairPath: string | undefined;
  const args: string[] = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--keypair" && argv[i + 1]) {
      keypairPath = argv[i + 1];
      i++;
    } else {
      args.push(argv[i]);
    }
  }
  if (args.length === 0) {
    console.error(
      "Usage:\n  npx ts-node scripts/migrateMarketsToV2.ts [--keypair <path>] --all\n  npx ts-node scripts/migrateMarketsToV2.ts [--keypair <path>] <market_pubkey> [...]",
    );
    process.exit(1);
  }

  const wallet = loadWallet(keypairPath);
  const connection = new Connection(RPC_URL, "confirmed");
  const provider = new AnchorProvider(connection, new Wallet(wallet), {
    commitment: "confirmed",
  });
  const idl = loadIdl();
  const program = new Program(idl, provider);

  console.log("Migrator");
  console.log(`  RPC:        ${RPC_URL}`);
  console.log(`  Program:    ${PROGRAM_ID.toBase58()}`);
  console.log(`  Admin:      ${wallet.publicKey.toBase58()}`);
  console.log(`  Quote mint: ${QUOTE_MINT.toBase58()}`);
  console.log("");

  let targets: PublicKey[];
  if (args[0] === "--all") {
    console.log("Discovering all Market accounts...");
    targets = await findAllMarketPubkeys(connection);
    console.log(`Found ${targets.length} market(s).`);
  } else {
    targets = args.map((a) => new PublicKey(a));
  }

  if (targets.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  let ok = 0,
    skip = 0,
    fail = 0;
  for (const market of targets) {
    const result = await migrateOne(program, market, wallet);
    if (result === "migrated") ok++;
    else if (result === "already") skip++;
    else fail++;
  }

  console.log("");
  console.log(`Summary: migrated=${ok}  already=${skip}  failed=${fail}`);
  if (fail > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
