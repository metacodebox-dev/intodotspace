#!/usr/bin/env node

/**
 * Convert a base58 private key to KEEPER_KEYPAIR format
 * 
 * Usage:
 *   node scripts/convert-private-key-to-keeper.js <private-key>
 */

const { Keypair } = require('@solana/web3.js');

// Try to use bs58 from @solana/web3.js or install it
let bs58;
try {
  // @solana/web3.js might have bs58 bundled
  bs58 = require('bs58');
} catch (e) {
  try {
    // Try alternative location
    bs58 = require('@solana/web3.js/node_modules/bs58');
  } catch (e2) {
    console.error('❌ Error: bs58 package not found');
    console.error('');
    console.error('Please install it:');
    console.error('  npm install bs58');
    console.error('  OR');
    console.error('  cd backend && npm install bs58');
    process.exit(1);
  }
}

const privateKey = process.argv[2];

if (!privateKey) {
  console.error('❌ Error: Private key required');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/convert-private-key-to-keeper.js <private-key>');
  console.log('');
  console.log('Example:');
  console.log('  node scripts/convert-private-key-to-keeper.js 45SDpBQ4GotbDGuctvWV6d28449ad7Js4e1baY1987FQUi9wgzd9hpWgwzxrRYu34iKtH8eubQHVKzZy3BGSYFRx');
  process.exit(1);
}

try {
  // Decode base58 private key
  const secretKey = bs58.decode(privateKey);
  
  // Validate length (should be 64 bytes for Solana keypair)
  if (secretKey.length !== 64) {
    console.error('❌ Error: Invalid private key length');
    console.error(`   Expected 64 bytes, got ${secretKey.length}`);
    console.error('   Make sure you provided the full private key');
    process.exit(1);
  }
  
  // Create keypair from secret key
  const keypair = Keypair.fromSecretKey(secretKey);
  
  // Convert to array format for KEEPER_KEYPAIR
  const secretKeyArray = Array.from(secretKey);
  
  console.log('✅ Keypair converted successfully!');
  console.log('');
  console.log('📝 Public Key:', keypair.publicKey.toString());
  console.log('');
  console.log('📋 Add this to your .env file:');
  console.log('');
  console.log(`KEEPER_KEYPAIR='${JSON.stringify(secretKeyArray)}'`);
  console.log('');
  console.log('⚠️  IMPORTANT:');
  console.log('   1. Fund this keypair with SOL for transaction fees');
  console.log('   2. Keep the private key secure');
  console.log('   3. This is your keeper keypair (different from program deployer)');
  console.log('');
  console.log('💰 To fund the keeper keypair:');
  console.log(`   solana transfer ${keypair.publicKey.toString()} 0.1 --allow-unfunded-recipient`);
  console.log('');
  console.log('💡 To check balance:');
  console.log(`   solana balance ${keypair.publicKey.toString()}`);
  console.log('');
  
} catch (error) {
  console.error('❌ Error converting private key:', error.message);
  console.error('');
  console.error('Make sure:');
  console.error('  1. The private key is in base58 format');
  console.error('  2. You have bs58 installed: npm install bs58');
  console.error('  3. The private key is complete (64 bytes when decoded)');
  process.exit(1);
}

