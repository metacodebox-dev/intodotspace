/**
 * Walks every row in the `markets` table, fetches that market's on-chain
 * account, and writes `quote_mint` / `quote_decimals` / `quote_symbol` into the
 * DB to match the on-chain state. Safe to run repeatedly.
 *
 * Run from repo root:
 *   npx ts-node scripts/backfillMarketQuoteInfo.ts
 *
 * Env:
 *   DATABASE_URL         (same one the backend uses)
 *   SOLANA_RPC_URL       (default: devnet)
 *   BACKFILL_DEFAULT_USDC=true  — when set, rows whose on-chain market
 *                                 returns a default-zero quote_mint get
 *                                 USDC values instead of being skipped
 *                                 (use after Phase A migrate cron has run).
 */
import * as path from 'path';
import * as fs from 'fs';
// Load backend/.env before any import that needs it. Use a direct require on
// backend's dotenv so the script works from the repo root without installing
// dotenv at the top level.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const dotenv = require(path.join(__dirname, '..', 'backend', 'node_modules', 'dotenv'));
dotenv.config({ path: path.join(__dirname, '..', 'backend', '.env') });

import { Connection, PublicKey, Keypair } from '@solana/web3.js';
import { AnchorProvider, Program, Wallet } from '@coral-xyz/anchor';

const PROGRAM_ID = new PublicKey('DKRg9skUuewV1wdbVD6tpnoHtbWWy2Chq7EKdpPRY6Eh');
const USDC_MINT = 'CqdmbJnQxMNNTGZzsBhEPTSzH52Pwa5DRvpVjZ2Us92t';
const SPACE_MINT = 'EHaeA9ke8Gaj9AKdjZ92pvk6oUFSZ5YehaqhAhgqZRZa';
const RPC_URL = process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com';

function symbolFor(mint: string): string {
  if (mint === USDC_MINT) return 'USDC';
  if (mint === SPACE_MINT) return 'SPACE';
  return 'QUOTE';
}

function loadIdl(): any {
  const candidates = [
    path.join(__dirname, '..', 'target', 'idl', 'space_core.json'),
    path.join(__dirname, '..', 'backend', 'src', 'idl', 'space_core.json'),
    path.join(__dirname, '..', 'frontend', 'src', 'idl', 'space_core.json'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) return JSON.parse(fs.readFileSync(p, 'utf-8'));
  }
  throw new Error('IDL not found. Run `anchor build` first.');
}

async function main() {
  // Lazy-import sequelize model so the script can run without a full backend boot
  const { Market } = await import('../backend/src/models/Market');
  const { sequelize } = await import('../backend/src/config/database');
  await sequelize.authenticate();

  const connection = new Connection(RPC_URL, 'confirmed');
  // Read-only provider: Anchor needs *some* wallet to construct the client.
  const throwawayWallet = new Wallet(Keypair.generate());
  const provider = new AnchorProvider(connection, throwawayWallet, { commitment: 'confirmed' });
  const idl = loadIdl();
  const program = new Program(idl, provider);

  const defaultUSDC = process.env.BACKFILL_DEFAULT_USDC === 'true';

  const rows = await Market.findAll({ attributes: ['id', 'marketAddress', 'quoteMint', 'quoteSymbol'] });
  console.log(`Scanning ${rows.length} markets...`);

  let updated = 0;
  let skippedUnmigrated = 0;
  let unchanged = 0;
  let failed = 0;

  for (const row of rows) {
    try {
      const acct: any = await (program as any).account.market.fetch(new PublicKey(row.marketAddress));
      const qm: PublicKey | undefined = acct.quoteMint;
      const qd: number = Number(acct.quoteDecimals ?? 0);

      let quoteMint: string;
      let quoteDecimals: number;
      if (qm && !qm.equals(PublicKey.default) && qd > 0) {
        quoteMint = qm.toBase58();
        quoteDecimals = qd;
      } else if (defaultUSDC) {
        quoteMint = USDC_MINT;
        quoteDecimals = 6;
      } else {
        skippedUnmigrated++;
        console.log(`  SKIP ${row.marketAddress} (pre-v2 layout, run Phase A migration first or set BACKFILL_DEFAULT_USDC=true)`);
        continue;
      }

      const quoteSymbol = symbolFor(quoteMint);

      if (row.quoteMint === quoteMint && row.quoteSymbol === quoteSymbol) {
        unchanged++;
        continue;
      }

      await row.update({ quoteMint, quoteDecimals, quoteSymbol });
      updated++;
      console.log(`  OK   ${row.marketAddress}  ${quoteSymbol} (${quoteDecimals} decimals)`);
    } catch (e: any) {
      failed++;
      console.log(`  FAIL ${row.marketAddress}  ${e?.message || e}`);
    }
  }

  console.log('');
  console.log(`Updated=${updated}  Unchanged=${unchanged}  SkippedUnmigrated=${skippedUnmigrated}  Failed=${failed}`);
  await sequelize.close();
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
