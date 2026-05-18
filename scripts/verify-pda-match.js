#!/usr/bin/env node

/**
 * Verify PDA derivation matches between frontend and what Anchor expects
 * 
 * Usage:
 *   node scripts/verify-pda-match.js
 */

const { PublicKey } = require('@solana/web3.js');
const { BN } = require('@coral-xyz/anchor');

const PROGRAM_ID = new PublicKey('B53gQMtDZfdXxCw2CH5DESwY5Nuz3sB8wtG2Yfy1KKDB');

// Test data from logs
const USER_PUBKEY = 'H8Bm2CRGgPMvxBo27tUCUerUyphjgQKmPkYgcnH9xav7';
const ORDER_ID = 1768483711;

// Convert u64 to little-endian bytes
function u64ToLeBytes(value) {
  const bytes = Buffer.alloc(8);
  let num = typeof value === 'number' ? BigInt(value) : BigInt(value.toString());
  
  for (let i = 0; i < 8; i++) {
    bytes[i] = Number(num & 0xffn);
    num = num >> 8n;
  }
  
  return bytes;
}

// Derive PDA
const user = new PublicKey(USER_PUBKEY);
const orderIdBytes = u64ToLeBytes(ORDER_ID);

const seeds = [
  Buffer.from('pending_order'),
  user.toBuffer(),
  orderIdBytes,
];

const [pda, bump] = PublicKey.findProgramAddressSync(seeds, PROGRAM_ID);

console.log('🔍 PDA Verification:');
console.log('');
console.log('Inputs:');
console.log('  Program ID:', PROGRAM_ID.toString());
console.log('  User:', user.toString());
console.log('  Order ID:', ORDER_ID);
console.log('');
console.log('Order ID Conversion:');
console.log('  Decimal:', ORDER_ID);
console.log('  Hex:', '0x' + ORDER_ID.toString(16));
console.log('  Little-endian bytes (hex):', orderIdBytes.toString('hex'));
console.log('  Little-endian bytes (decimal):', Array.from(orderIdBytes).join(', '));
console.log('');
console.log('Seeds:');
seeds.forEach((seed, i) => {
  if (i === 0) {
    console.log(`  [${i}] "${seed.toString()}":`, seed.toString('hex'));
  } else {
    console.log(`  [${i}]:`, seed.toString('hex'));
  }
});
console.log('');
console.log('Result:');
console.log('  PDA:', pda.toString());
console.log('  Bump:', bump);
console.log('');
console.log('Expected from logs: HBU17xZgv4JtXfW33CocVMSDqERjTvnecHPvP3uXYyGJ');
console.log('Match:', pda.toString() === 'HBU17xZgv4JtXfW33CocVMSDqERjTvnecHPvP3uXYyGJ' ? '✅ YES' : '❌ NO');
console.log('');

// Also test with BN
const orderIdBN = new BN(ORDER_ID);
const orderIdBytesBN = Buffer.from(orderIdBN.toArray('le', 8));
const seedsBN = [
  Buffer.from('pending_order'),
  user.toBuffer(),
  orderIdBytesBN,
];
const [pdaBN, bumpBN] = PublicKey.findProgramAddressSync(seedsBN, PROGRAM_ID);

console.log('🔍 Using BN.toArray method:');
console.log('  Order ID Bytes (hex):', orderIdBytesBN.toString('hex'));
console.log('  PDA:', pdaBN.toString());
console.log('  Bump:', bumpBN);
console.log('  Match with expected:', pdaBN.toString() === 'HBU17xZgv4JtXfW33CocVMSDqERjTvnecHPvP3uXYyGJ' ? '✅ YES' : '❌ NO');
console.log('');




