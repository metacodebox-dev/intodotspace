#!/usr/bin/env node

/**
 * Direct setup for your keeper keypair
 * Private Key: 45SDpBQ4GotbDGuctvWV6d28449ad7Js4e1baY1987FQUi9wgzd9hpWgwzxrRYu34iKtH8eubQHVKzZy3BGSYFRx
 */

const { Keypair } = require('@solana/web3.js');

// Your private key
const PRIVATE_KEY = '45SDpBQ4GotbDGuctvWV6d28449ad7Js4e1baY1987FQUi9wgzd9hpWgwzxrRYu34iKtH8eubQHVKzZy3BGSYFRx';

try {
  // Try to decode base58 - we'll need bs58 for this
  let bs58;
  try {
    bs58 = require('bs58');
  } catch (e) {
    console.error('❌ bs58 package not found');
    console.error('');
    console.error('Installing bs58...');
    console.error('Please run: npm install bs58');
    console.error('');
    console.error('Or use Solana CLI method (see setup-keeper-from-private-key.md)');
    process.exit(1);
  }
  
  // Decode the base58 private key
  const secretKey = bs58.decode(PRIVATE_KEY);
  
  // Validate length
  if (secretKey.length !== 64) {
    console.error('❌ Error: Invalid private key length');
    console.error(`   Expected 64 bytes, got ${secretKey.length}`);
    process.exit(1);
  }
  
  // Create keypair
  const keypair = Keypair.fromSecretKey(secretKey);
  
  // Convert to array format
  const secretKeyArray = Array.from(secretKey);
  
  console.log('✅ Keeper keypair setup complete!');
  console.log('');
  console.log('📝 Public Key:', keypair.publicKey.toString());
  console.log('');
  console.log('📋 Copy this to your .env file:');
  console.log('');
  console.log(`KEEPER_KEYPAIR='${JSON.stringify(secretKeyArray)}'`);
  console.log('');
  console.log('💰 Next steps:');
  console.log('   1. Fund the keeper with SOL:');
  console.log(`      solana transfer ${keypair.publicKey.toString()} 0.1`);
  console.log('');
  console.log('   2. Add KEEPER_KEYPAIR to your .env file (see above)');
  console.log('');
  console.log('   3. Restart your backend server');
  console.log('');
  
} catch (error) {
  console.error('❌ Error:', error.message);
  console.error('');
  console.error('Troubleshooting:');
  console.error('   1. Install bs58: npm install bs58');
  console.error('   2. Make sure @solana/web3.js is installed');
  console.error('   3. Verify your private key is correct');
  process.exit(1);
}




