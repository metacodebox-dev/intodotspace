#!/usr/bin/env node

/**
 * Script to generate a keeper keypair and export it in the format needed for KEEPER_KEYPAIR env variable
 * 
 * Usage:
 *   node scripts/generate-keeper-keypair.js
 * 
 * This will:
 * 1. Generate a new keypair
 * 2. Save it to keeper-keypair.json
 * 3. Display the public key
 * 4. Display the KEEPER_KEYPAIR environment variable value
 */

const { Keypair } = require('@solana/web3.js');
const fs = require('fs');
const path = require('path');

// Generate new keypair
const keypair = Keypair.generate();

// Get the secret key as array
const secretKey = Array.from(keypair.secretKey);

// Save to file
const keypairPath = path.join(__dirname, 'keeper-keypair.json');
fs.writeFileSync(keypairPath, JSON.stringify(secretKey, null, 2));

console.log('✅ Keeper keypair generated!');
console.log('');
console.log('📝 Public Key:', keypair.publicKey.toString());
console.log('');
console.log('💾 Saved to:', keypairPath);
console.log('');
console.log('📋 Add this to your .env file:');
console.log('');
console.log(`KEEPER_KEYPAIR='${JSON.stringify(secretKey)}'`);
console.log('');
console.log('⚠️  IMPORTANT:');
console.log('   1. Fund this keypair with SOL for transaction fees');
console.log('   2. Keep the keypair file secure');
console.log('   3. This is DIFFERENT from your program deployer keypair');
console.log('');
console.log('💰 To fund the keeper keypair:');
console.log(`   solana transfer ${keypair.publicKey.toString()} 0.1 --allow-unfunded-recipient`);
console.log('');





