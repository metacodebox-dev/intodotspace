#!/usr/bin/env node

/**
 * Simple script to convert your private key to KEEPER_KEYPAIR format
 * 
 * Usage:
 *   node scripts/convert-keeper-simple.js
 * 
 * This will prompt you for your private key and convert it.
 */

const readline = require('readline');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

console.log('🔑 Keeper Keypair Converter');
console.log('');
console.log('Enter your private key (base58 format):');
console.log('');

rl.question('Private Key: ', (privateKey) => {
  rl.close();
  
  if (!privateKey || privateKey.trim().length === 0) {
    console.error('❌ Error: Private key is required');
    process.exit(1);
  }
  
  privateKey = privateKey.trim();
  
  try {
    // Try to use @solana/web3.js which should have base58
    const { Keypair } = require('@solana/web3.js');
    
    // Check if we can use the private key directly
    // Solana keypairs can be created from base58 strings in some cases
    let keypair;
    let secretKeyArray;
    
    try {
      // Method 1: Try to decode as base58
      // @solana/web3.js uses tweetnacl which has base58
      const secretKey = Buffer.from(privateKey, 'base64');
      
      if (secretKey.length === 64) {
        keypair = Keypair.fromSecretKey(secretKey);
        secretKeyArray = Array.from(secretKey);
      } else {
        throw new Error('Not base64');
      }
    } catch (e) {
      // Method 2: Try to use bs58 if available
      try {
        const bs58 = require('bs58');
        const secretKey = bs58.decode(privateKey);
        keypair = Keypair.fromSecretKey(secretKey);
        secretKeyArray = Array.from(secretKey);
      } catch (e2) {
        // Method 3: Try to parse as JSON array
        try {
          const parsed = JSON.parse(privateKey);
          if (Array.isArray(parsed) && parsed.length === 64) {
            secretKeyArray = parsed;
            keypair = Keypair.fromSecretKey(Uint8Array.from(parsed));
          } else {
            throw new Error('Not an array');
          }
        } catch (e3) {
          console.error('❌ Error: Could not parse private key');
          console.error('');
          console.error('The private key should be:');
          console.error('  1. Base58 encoded string (88 characters)');
          console.error('  2. JSON array of 64 numbers');
          console.error('');
          console.error('Install bs58 for base58 support:');
          console.error('  npm install bs58');
          process.exit(1);
        }
      }
    }
    
    console.log('');
    console.log('✅ Keypair converted successfully!');
    console.log('');
    console.log('📝 Public Key:', keypair.publicKey.toString());
    console.log('');
    console.log('📋 Add this to your .env file:');
    console.log('');
    console.log(`KEEPER_KEYPAIR='${JSON.stringify(secretKeyArray)}'`);
    console.log('');
    console.log('💰 To fund the keeper keypair:');
    console.log(`   solana transfer ${keypair.publicKey.toString()} 0.1 --allow-unfunded-recipient`);
    console.log('');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('');
    console.error('Make sure:');
    console.error('  1. You have @solana/web3.js installed');
    console.error('  2. The private key is in the correct format');
    console.error('  3. Install bs58 for base58 support: npm install bs58');
    process.exit(1);
  }
});





