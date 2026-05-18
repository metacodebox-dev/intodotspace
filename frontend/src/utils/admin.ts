import { PublicKey } from '@solana/web3.js';

/**
 * Get list of admin public keys from environment variable
 * Supports comma-separated list of public keys
 * 
 * Environment variable format:
 * NEXT_PUBLIC_ADMIN_PUBKEY=pubkey1,pubkey2,pubkey3
 * or for single admin (backward compatible):
 * NEXT_PUBLIC_ADMIN_PUBKEY=pubkey1
 */
export function getAdminPublicKeys(): string[] {
  const adminPubkeyEnv = process.env.NEXT_PUBLIC_ADMIN_PUBKEY;
  
  if (!adminPubkeyEnv) {
    return [];
  }

  // Split by comma and trim whitespace
  return adminPubkeyEnv
    .split(',')
    .map(key => key.trim())
    .filter(key => key.length > 0);
}

/**
 * Check if a public key is an admin
 * @param publicKey - The public key to check (can be PublicKey object or string)
 * @returns true if the public key is in the admin list
 */
export function isAdmin(publicKey: PublicKey | string | null | undefined): boolean {
  if (!publicKey) {
    return false;
  }

  const publicKeyString = typeof publicKey === 'string' 
    ? publicKey 
    : publicKey.toString();

  const adminKeys = getAdminPublicKeys();
  
  return adminKeys.includes(publicKeyString);
}

/**
 * Check if wallet is connected and is an admin
 * @param connected - Whether wallet is connected
 * @param publicKey - The public key to check
 * @returns true if wallet is connected and is an admin
 */
export function isAdminWallet(
  connected: boolean,
  publicKey: PublicKey | null | undefined
): boolean {
  return connected && isAdmin(publicKey);
}



