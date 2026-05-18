/**
 * Redis Key Schema for Beta Gate
 * 
 * All keys are namespaced under 'beta:' to avoid collisions with existing keys.
 * TTLs are set appropriately for each key type.
 */

export const BETA_KEYS = {
  /**
   * Beta code validity and redemption state
   * Key: beta:code:<normalized_code>
   * Value: JSON { status: 'valid' | 'redeemed', wallet?: string, redeemedAt?: number }
   * TTL: None (permanent until explicitly deleted)
   */
  code: (code: string) => `beta:code:${normalizeCode(code)}`,

  /**
   * Challenge nonce for wallet signature verification
   * Key: beta:challenge:<nonce>
   * Value: JSON { code: string, ip: string, createdAt: number }
   * TTL: 5 minutes (configurable via BETA_CHALLENGE_TTL)
   */
  challenge: (nonce: string) => `beta:challenge:${nonce}`,

  /**
   * Access grant by wallet address
   * Key: beta:access:<wallet_address>
   * Value: JSON { code: string, grantedAt: number }
   * TTL: 7 days (configurable via BETA_ACCESS_GRANT_TTL)
   */
  access: (wallet: string) => `beta:access:${wallet.toLowerCase()}`,

  /**
   * Rate limit counter per IP
   * Key: beta:ratelimit:ip:<ip_hash>
   * Value: number (count)
   * TTL: 60 seconds (sliding window)
   */
  rateLimitIp: (ipHash: string) => `beta:ratelimit:ip:${ipHash}`,

  /**
   * Rate limit counter per code attempts
   * Key: beta:ratelimit:code:<normalized_code>
   * Value: number (count)
   * TTL: 1 hour
   */
  rateLimitCode: (code: string) => `beta:ratelimit:code:${normalizeCode(code)}`,

  /**
   * Rate limit counter per wallet
   * Key: beta:ratelimit:wallet:<wallet_address>
   * Value: number (count)
   * TTL: 1 hour
   */
  rateLimitWallet: (wallet: string) => `beta:ratelimit:wallet:${wallet.toLowerCase()}`,

  /**
   * Brute force lockout per IP
   * Key: beta:lockout:ip:<ip_hash>
   * Value: number (failure count)
   * TTL: 1 hour
   */
  lockoutIp: (ipHash: string) => `beta:lockout:ip:${ipHash}`,

  /**
   * Metrics counters
   * Key: beta:metrics:<metric_name>
   * Value: number (count)
   * TTL: None (persistent counters)
   */
  metrics: (metric: string) => `beta:metrics:${metric}`,

  /**
   * Token revocation list (optional)
   * Key: beta:revoked:<token_hash>
   * Value: '1'
   * TTL: Same as token expiry
   */
  revoked: (tokenHash: string) => `beta:revoked:${tokenHash}`,
};

/**
 * Normalize beta code for consistent lookups
 * - Trim whitespace
 * - Convert to uppercase
 * - Remove dashes/spaces
 */
export function normalizeCode(code: string): string {
  return code
    .trim()
    .toUpperCase()
    .replace(/[-\s]/g, '');
}

/**
 * Mask code for logging (show first 4 and last 2 chars)
 */
export function maskCode(code: string): string {
  const normalized = normalizeCode(code);
  if (normalized.length <= 6) {
    return normalized.substring(0, 2) + '***';
  }
  return normalized.substring(0, 4) + '***' + normalized.substring(normalized.length - 2);
}

/**
 * Hash IP for privacy (simple hash, not cryptographic)
 */
export function hashIp(ip: string): string {
  let hash = 0;
  for (let i = 0; i < ip.length; i++) {
    const char = ip.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash; // Convert to 32bit integer
  }
  return Math.abs(hash).toString(16);
}
