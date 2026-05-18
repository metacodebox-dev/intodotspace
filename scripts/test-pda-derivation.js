#!/usr/bin/env node

/**
 * Test script to verify PDA derivation matches between frontend and program
 * 
 * Usage:
 *   node scripts/test-pda-derivation.js <user-pubkey> <order-id>
 * 
 * Example:
 *   node scripts/test-pda-derivation.js 8U2HycMXXApmLE9mNPf33JQszp2Ej9EDqKN79YaL5xH3 1234567890
 */

const { PublicKey } = require('@solana/web3.js');
const { BN } = require('@coral-xyz/anchor');

const PROGRAM_ID = new PublicKey('B53gQMtDZfdXxCw2CH5DESwY5Nuz3sB8wtG2Yfy1KKDB');

// Convert u64 to little-endian bytes (same as frontend)
function u64ToLeBytes(value) {
  const bytes = Buffer.alloc(8);
  let num = typeof value === 'number' ? BigInt(value) : BigInt(value.toString());
  
  for (let i = 0; i < 8; i++) {
    bytes[i] = Number(num & 0xffn);
    num = num >> 8n;
  }
  
  return bytes;
}

// Get pending order PDA (same as frontend)
function getPendingOrderPDA(user, orderId) {
  const orderIdBytes = u64ToLeBytes(orderId);
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('pending_order'),
      user.toBuffer(),
      orderIdBytes,
    ],
    PROGRAM_ID
  );
}

// Parse arguments
const userPubkey = process.argv[2];
const orderId = parseInt(process.argv[3]) || Math.floor(Date.now() / 1000);

if (!userPubkey) {
  console.error('❌ Error: User public key required');
  console.log('');
  console.log('Usage:');
  console.log('  node scripts/test-pda-derivation.js <user-pubkey> [order-id]');
  console.log('');
  console.log('Example:');
  console.log('  node scripts/test-pda-derivation.js 8U2HycMXXApmLE9mNPf33JQszp2Ej9EDqKN79YaL5xH3 1234567890');
  process.exit(1);
}

try {
  const user = new PublicKey(userPubkey);
  const [pda, bump] = getPendingOrderPDA(user, orderId);
  
  console.log('🔍 PDA Derivation Test');
  console.log('');
  console.log('Inputs:');
  console.log('  Program ID:', PROGRAM_ID.toString());
  console.log('  User:', user.toString());
  console.log('  Order ID:', orderId);
  console.log('');
  console.log('Seeds:');
  const orderIdBytes = u64ToLeBytes(orderId);
  console.log('  1. "pending_order":', Buffer.from('pending_order').toString('hex'));
  console.log('  2. User pubkey:', user.toBuffer().toString('hex'));
  console.log('  3. Order ID (u64 le):', orderIdBytes.toString('hex'));
  console.log('');
  console.log('Result:');
  console.log('  PDA:', pda.toString());
  console.log('  Bump:', bump);
  console.log('');
  console.log('✅ PDA derivation complete');
  console.log('');
  console.log('If this PDA doesn\'t match what the program expects, check:');
  console.log('  1. Program ID matches in Rust (declare_id!)');
  console.log('  2. Order ID is the same value');
  console.log('  3. User public key is correct');
  console.log('  4. Seed format matches exactly');
  
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}




