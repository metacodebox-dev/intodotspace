/**
 * Node.js script to create and mint a test USDC token for development
 * Run with: node scripts/create-test-usdc.js
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Connection, Keypair, PublicKey } = require('@solana/web3.js');
const {
  createMint,
  getOrCreateAssociatedTokenAccount,
  mintTo,
  TOKEN_PROGRAM_ID,
} = require('@solana/spl-token');

function loadKeypair() {
  // Method 1: Command line argument
  const keypairArg = process.argv[2];
  if (keypairArg) {
    try {
      const keypairData = JSON.parse(fs.readFileSync(keypairArg, 'utf-8'));
      return Keypair.fromSecretKey(Uint8Array.from(keypairData));
    } catch (error) {
      console.error(`❌ Could not load keypair from: ${keypairArg}`);
      console.error(`   Error: ${error.message}`);
      process.exit(1);
    }
  }

  // Method 2: Environment variable
  const keypairEnv = process.env.SOLANA_KEYPAIR_PATH;
  if (keypairEnv) {
    try {
      const keypairData = JSON.parse(fs.readFileSync(keypairEnv, 'utf-8'));
      return Keypair.fromSecretKey(Uint8Array.from(keypairData));
    } catch (error) {
      console.error(`❌ Could not load keypair from env: ${keypairEnv}`);
      console.error(`   Error: ${error.message}`);
    }
  }

  // Method 3: Solana CLI config
  try {
    const configOutput = execSync('solana config get', { encoding: 'utf-8', stdio: 'pipe' });
    
    // Try different formats
    let keypairPath = null;
    
    // Format 1: "Keypair Path: /path/to/keypair.json"
    const match1 = configOutput.match(/Keypair Path:\s*(.+)/);
    if (match1) {
      keypairPath = match1[1].trim();
    }
    
    // Format 2: "keypairPath: /path/to/keypair.json"
    if (!keypairPath) {
      const match2 = configOutput.match(/keypairPath:\s*(.+)/i);
      if (match2) {
        keypairPath = match2[1].trim();
      }
    }
    
    // Format 3: Look for any line with .json
    if (!keypairPath) {
      const lines = configOutput.split('\n');
      for (const line of lines) {
        if (line.includes('.json') && (line.includes('keypair') || line.includes('Keypair'))) {
          const parts = line.split(/[:=]/);
          if (parts.length > 1) {
            keypairPath = parts[parts.length - 1].trim();
            break;
          }
        }
      }
    }

    if (keypairPath && fs.existsSync(keypairPath)) {
      const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
      return Keypair.fromSecretKey(Uint8Array.from(keypairData));
    }
  } catch (error) {
    // Continue to next method
  }

  // Method 4: Default locations
  const defaultPaths = [
    path.join(os.homedir(), '.config', 'solana', 'id.json'),
    path.join(os.homedir(), 'solana', 'id.json'),
  ];

  for (const defaultPath of defaultPaths) {
    if (fs.existsSync(defaultPath)) {
      try {
        const keypairData = JSON.parse(fs.readFileSync(defaultPath, 'utf-8'));
        return Keypair.fromSecretKey(Uint8Array.from(keypairData));
      } catch (error) {
        // Continue to next path
      }
    }
  }

  // If all methods fail
  console.error('❌ Could not load keypair. Try one of these methods:');
  console.error('');
  console.error('   1. Pass keypair path as argument:');
  console.error('      node scripts/create-test-usdc.js /path/to/keypair.json');
  console.error('');
  console.error('   2. Set environment variable:');
  console.error('      $env:SOLANA_KEYPAIR_PATH="C:\\path\\to\\keypair.json"  # PowerShell');
  console.error('      export SOLANA_KEYPAIR_PATH="/path/to/keypair.json"   # Bash');
  console.error('');
  console.error('   3. Configure Solana CLI:');
  console.error('      solana-keygen new');
  console.error('      solana config set --url devnet');
  console.error('');
  console.error('   4. Place keypair at default location:');
  console.error(`      ${path.join(os.homedir(), '.config', 'solana', 'id.json')}`);
  process.exit(1);
}

async function createTestUSDC() {
  console.log('🚀 Creating Test USDC Token for Devnet');
  console.log('========================================\n');

  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');

  // Load keypair using multiple methods
  const payer = loadKeypair();

  console.log(`💰 Using wallet: ${payer.publicKey.toString()}\n`);

  // Check balance
  const balance = await connection.getBalance(payer.publicKey);
  console.log(`💵 Current SOL balance: ${balance / 1e9} SOL\n`);

  if (balance < 0.1 * 1e9) {
    console.log('⚠️  Low balance. Requesting airdrop...');
    try {
      const signature = await connection.requestAirdrop(payer.publicKey, 2 * 1e9);
      await connection.confirmTransaction(signature);
      console.log('✅ Airdrop received!\n');
    } catch (error) {
      console.error('❌ Airdrop failed. Please request manually:');
      console.error('   solana airdrop 2\n');
    }
  }

  // Create mint (6 decimals like USDC)
  console.log('🪙 Creating test token mint with 6 decimals...');
  const mint = await createMint(
    connection,
    payer,
    payer.publicKey, // mint authority
    null, // freeze authority (null = no freeze)
    6 // decimals
  );
  console.log(`✅ Token mint created: ${mint.toString()}\n`);

  // Create token account
  console.log('📝 Creating token account...');
  const tokenAccount = await getOrCreateAssociatedTokenAccount(
    connection,
    payer,
    mint,
    payer.publicKey
  );
  console.log(`✅ Token account: ${tokenAccount.address.toString()}\n`);

  // Mint tokens (1,000,000 tokens)
  console.log('🪙 Minting 1,000,000 test USDC tokens...');
  const amount = 1_000_000 * 1e6; // 1M tokens with 6 decimals
  await mintTo(
    connection,
    payer,
    mint,
    tokenAccount.address,
    payer, // mint authority
    amount
  );
  console.log('✅ Tokens minted!\n');

  // Check balance
  const tokenBalance = await connection.getTokenAccountBalance(tokenAccount.address);
  console.log('✅ Test token setup complete!\n');
  console.log('📋 Details:');
  console.log(`   Mint Address: ${mint.toString()}`);
  console.log(`   Decimals: 6`);
  console.log(`   Your Balance: ${tokenBalance.value.uiAmount} tokens\n`);
  console.log('💡 To use this in your app, update frontend/src/utils/solana.ts:');
  console.log(`   export const USDC_MINT = new PublicKey('${mint.toString()}');\n`);
  console.log('🔄 To mint more tokens, you can use this script again or:');
  console.log(`   spl-token mint ${mint.toString()} <amount>\n`);
}

createTestUSDC().catch(console.error);

