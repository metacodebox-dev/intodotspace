/**
 * Node.js script to create and mint a test SPACE token for development.
 * Mirrors create-test-usdc.js but with 9 decimals for SPACE-denominated markets.
 * Run with: node scripts/create-test-space.js
 */

const { execSync } = require("child_process");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { Connection, Keypair } = require("@solana/web3.js");
const {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
} = require("@solana/spl-token");

const DECIMALS = 9;
const INITIAL_SUPPLY_HUMAN = 1_000_000_000; // 1M SPACE

function loadKeypair() {
  const keypairArg = process.argv[2];
  if (keypairArg) {
    try {
      const keypairData = JSON.parse(fs.readFileSync(keypairArg, "utf-8"));
      return Keypair.fromSecretKey(Uint8Array.from(keypairData));
    } catch (error) {
      console.error(`Could not load keypair from: ${keypairArg}`);
      console.error(`   Error: ${error.message}`);
      process.exit(1);
    }
  }

  const keypairEnv = process.env.SOLANA_KEYPAIR_PATH;
  if (keypairEnv) {
    try {
      const keypairData = JSON.parse(fs.readFileSync(keypairEnv, "utf-8"));
      return Keypair.fromSecretKey(Uint8Array.from(keypairData));
    } catch (error) {
      console.error(`Could not load keypair from env: ${keypairEnv}`);
      console.error(`   Error: ${error.message}`);
    }
  }

  try {
    const configOutput = execSync("solana config get", {
      encoding: "utf-8",
      stdio: "pipe",
    });
    let keypairPath = null;

    const match1 = configOutput.match(/Keypair Path:\s*(.+)/);
    if (match1) keypairPath = match1[1].trim();

    if (!keypairPath) {
      const match2 = configOutput.match(/keypairPath:\s*(.+)/i);
      if (match2) keypairPath = match2[1].trim();
    }

    if (!keypairPath) {
      const lines = configOutput.split("\n");
      for (const line of lines) {
        if (
          line.includes(".json") &&
          (line.includes("keypair") || line.includes("Keypair"))
        ) {
          const parts = line.split(/[:=]/);
          if (parts.length > 1) {
            keypairPath = parts[parts.length - 1].trim();
            break;
          }
        }
      }
    }

    if (keypairPath && fs.existsSync(keypairPath)) {
      const keypairData = JSON.parse(fs.readFileSync(keypairPath, "utf-8"));
      return Keypair.fromSecretKey(Uint8Array.from(keypairData));
    }
  } catch (error) {
    // fall through
  }

  const defaultPaths = [
    path.join(os.homedir(), ".config", "solana", "id.json"),
    path.join(os.homedir(), "solana", "id.json"),
  ];

  for (const defaultPath of defaultPaths) {
    if (fs.existsSync(defaultPath)) {
      try {
        const keypairData = JSON.parse(fs.readFileSync(defaultPath, "utf-8"));
        return Keypair.fromSecretKey(Uint8Array.from(keypairData));
      } catch (error) {
        // continue
      }
    }
  }

  console.error("Could not load keypair. Try one of these methods:");
  console.error("");
  console.error("   1. Pass keypair path as argument:");
  console.error(
    "      node scripts/create-test-space.js /path/to/keypair.json",
  );
  console.error("");
  console.error("   2. Set environment variable:");
  console.error(
    '      $env:SOLANA_KEYPAIR_PATH="C:\\path\\to\\keypair.json"  # PowerShell',
  );
  console.error(
    '      export SOLANA_KEYPAIR_PATH="/path/to/keypair.json"   # Bash',
  );
  console.error("");
  console.error("   3. Configure Solana CLI:");
  console.error("      solana-keygen new");
  console.error("      solana config set --url devnet");
  console.error("");
  console.error("   4. Place keypair at default location:");
  console.error(
    `      ${path.join(os.homedir(), ".config", "solana", "id.json")}`,
  );
  process.exit(1);
}

async function createTestSpace() {
  console.log("Creating Test SPACE Token for Devnet");
  console.log("========================================\n");

  const connection = new Connection(
    "https://api.devnet.solana.com",
    "confirmed",
  );
  const payer = loadKeypair();

  console.log(`Using wallet: ${payer.publicKey.toString()}\n`);

  const balance = await connection.getBalance(payer.publicKey);
  console.log(`Current SOL balance: ${balance / 1e9} SOL\n`);

  if (balance < 0.1 * 1e9) {
    console.log("Low balance. Requesting airdrop...");
    try {
      const signature = await connection.requestAirdrop(
        payer.publicKey,
        2 * 1e9,
      );
      await connection.confirmTransaction(signature);
      console.log("Airdrop received!\n");
    } catch (error) {
      console.error("Airdrop failed. Please request manually:");
      console.error("   solana airdrop 2\n");
    }
  }

  console.log(`Creating SPACE mint with ${DECIMALS} decimals...`);
  const mint = await createMint(
    connection,
    payer,
    payer.publicKey,
    null,
    DECIMALS,
  );
  console.log(`SPACE mint created: ${mint.toString()}\n`);

  console.log("Creating token account...");
  const tokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    payer.publicKey,
  );
  console.log(`Token account: ${tokenAccount.address.toString()}\n`);

  console.log(
    `Minting ${INITIAL_SUPPLY_HUMAN.toLocaleString()} SPACE tokens...`,
  );
  const amount = BigInt(INITIAL_SUPPLY_HUMAN) * BigInt(10) ** BigInt(DECIMALS);
  await mintTo(connection, payer, mint, tokenAccount.address, payer, amount);
  console.log("Tokens minted!\n");

  const tokenBalance = await connection.getTokenAccountBalance(
    tokenAccount.address,
  );
  console.log("SPACE token setup complete!\n");
  console.log("Details:");
  console.log(`   Mint Address: ${mint.toString()}`);
  console.log(`   Decimals: ${DECIMALS}`);
  console.log(`   Your Balance: ${tokenBalance.value.uiAmount} SPACE\n`);
  console.log("Next steps:");
  console.log(
    `   1. Save this mint address — add it to the program\'s quote-token allowlist.`,
  );
  console.log(`   2. Reference it in backend config and frontend utils.`);
  console.log(
    `   3. To mint more: spl-token mint ${mint.toString()} <amount>\n`,
  );
}

createTestSpace().catch(console.error);
