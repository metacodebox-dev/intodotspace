/**
 * Transfer test USDC tokens to an address
 * Usage: node scripts/transfer-test-usdc.js <recipient> <amount>
 * Example: node scripts/transfer-test-usdc.js 2Lh5uLkvU3eEHrR6mccn5qeHJTmXCUc5MNWUC5RBiE3Q 100000
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const { execSync } = require('child_process');
const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const {
  getOrCreateAssociatedTokenAccount,
  transfer,
  TOKEN_PROGRAM_ID,
} = require('@solana/spl-token');

// Your test USDC mint address
const USDC_MINT = new PublicKey('CqdmbJnQxMNNTGZzsBhEPTSzH52Pwa5DRvpVjZ2Us92t');

function loadKeypair() {
  // Method 1: Command line argument (keypair path)
  const keypairArg = process.argv[3];
  if (keypairArg && fs.existsSync(keypairArg)) {
    try {
      const keypairData = JSON.parse(fs.readFileSync(keypairArg, 'utf-8'));
      return Keypair.fromSecretKey(Uint8Array.from(keypairData));
    } catch (error) {
      console.error(`❌ Could not load keypair from: ${keypairArg}`);
      process.exit(1);
    }
  }

  // Method 2: Environment variable
  const keypairEnv = process.env.SOLANA_KEYPAIR_PATH;
  if (keypairEnv && fs.existsSync(keypairEnv)) {
    try {
      const keypairData = JSON.parse(fs.readFileSync(keypairEnv, 'utf-8'));
      return Keypair.fromSecretKey(Uint8Array.from(keypairData));
    } catch (error) {
      console.error(`❌ Could not load keypair from env: ${keypairEnv}`);
    }
  }

  // Method 3: Default location
  const defaultPath = path.join(os.homedir(), '.config', 'solana', 'id.json');
  if (fs.existsSync(defaultPath)) {
    try {
      const keypairData = JSON.parse(fs.readFileSync(defaultPath, 'utf-8'));
      return Keypair.fromSecretKey(Uint8Array.from(keypairData));
    } catch (error) {
      console.error(`❌ Could not load keypair from default location`);
    }
  }

  console.error('❌ Could not load keypair. Please provide keypair path:');
  console.error('   node scripts/transfer-test-usdc.js <recipient> <amount> [keypair-path]');
  process.exit(1);
}

async function transferTokens() {
  const recipientAddress = process.argv[2];
  const amount = parseFloat(process.argv[3] || '100000');

  if (!recipientAddress) {
    console.error('❌ Please provide recipient address');
    console.error('   Usage: node scripts/transfer-test-usdc.js <recipient> <amount>');
    process.exit(1);
  }

  console.log('🚀 Transferring Test USDC Tokens');
  console.log('=================================\n');
  console.log(`📤 Recipient: ${recipientAddress}`);
  console.log(`💰 Amount: ${amount} tokens\n`);

  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const payer = loadKeypair();

  console.log(`💳 Sender: ${payer.publicKey.toString()}\n`);

  try {
    const recipientPubkey = new PublicKey(recipientAddress);

    // Get or create sender's token account
    console.log('📝 Getting sender token account...');
    const senderTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      USDC_MINT,
      payer.publicKey
    );

    // Get or create recipient's token account
    console.log('📝 Getting recipient token account...');
    const recipientTokenAccount = await getOrCreateAssociatedTokenAccount(
      connection,
      payer,
      USDC_MINT,
      recipientPubkey
    );

    // Convert amount to token units (6 decimals)
    const amountInUnits = BigInt(Math.floor(amount * 1e6));

    console.log(`💸 Transferring ${amount} tokens (${amountInUnits} units)...\n`);

    // Transfer tokens
    const signature = await transfer(
      connection,
      payer,
      senderTokenAccount.address,
      recipientTokenAccount.address,
      payer,
      amountInUnits
    );

    console.log('✅ Transfer successful!\n');
    console.log(`📋 Transaction signature: ${signature}`);
    console.log(`🔗 View on explorer: https://solscan.io/tx/${signature}?cluster=devnet\n`);

    // Check balances
    const senderBalance = await connection.getTokenAccountBalance(senderTokenAccount.address);
    const recipientBalance = await connection.getTokenAccountBalance(recipientTokenAccount.address);

    console.log('📊 Updated Balances:');
    console.log(`   Sender: ${senderBalance.value.uiAmount} tokens`);
    console.log(`   Recipient: ${recipientBalance.value.uiAmount} tokens\n`);

  } catch (error) {
    console.error('❌ Transfer failed:', error.message);
    if (error.logs) {
      console.error('\nTransaction logs:');
      error.logs.forEach(log => console.error('  ', log));
    }
    process.exit(1);
  }
}

transferTokens().catch(console.error);





