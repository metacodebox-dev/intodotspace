/**
 * Beta Gate Service
 * 
 * Core business logic for beta code verification and redemption.
 * Uses Redis with atomic Lua scripts for race-safe operations.
 */

import { randomBytes, createHash } from 'crypto';
import jwt, { SignOptions } from 'jsonwebtoken';
import nacl from 'tweetnacl';
import bs58 from 'bs58';
import { getRedisClient } from '../config/redis';
import { getBetaGateConfig } from './config';
import { BETA_KEYS, normalizeCode, maskCode, hashIp } from './keys';
import { logger } from '../utils/logger';

// Types
export interface BetaCodeStatus {
  exists: boolean;
  status: 'valid' | 'redeemed' | 'not_found';
  wallet?: string;
  redeemedAt?: number;
}

export interface ChallengeResult {
  nonce: string;
  message: string;
  expiresAt: number;
}

export interface RedeemResult {
  success: boolean;
  accessToken?: string;
  error?: string;
  errorCode?: 'INVALID_CODE' | 'ALREADY_REDEEMED' | 'INVALID_SIGNATURE' | 'INVALID_CHALLENGE' | 'RATE_LIMITED' | 'LOCKED_OUT';
}

export interface AccessStatus {
  hasAccess: boolean;
  wallet?: string;
  grantedAt?: number;
  expiresAt?: number;
}

/**
 * Lua script for atomic code redemption
 * Returns: 1 = success, 0 = already redeemed, -1 = not found
 */
const REDEEM_LUA_SCRIPT = `
local codeKey = KEYS[1]
local accessKey = KEYS[2]
local wallet = ARGV[1]
local timestamp = ARGV[2]
local accessTTL = tonumber(ARGV[3])

-- Check if code exists
local codeData = redis.call('GET', codeKey)
if not codeData then
  return -1
end

-- Parse code data
local code = cjson.decode(codeData)
if code.status == 'redeemed' then
  return 0
end

-- Atomically redeem the code
code.status = 'redeemed'
code.wallet = wallet
code.redeemedAt = tonumber(timestamp)
redis.call('SET', codeKey, cjson.encode(code))

-- Create access grant for wallet
local access = cjson.encode({
  code = KEYS[3],
  grantedAt = tonumber(timestamp)
})
redis.call('SETEX', accessKey, accessTTL, access)

return 1
`;

/**
 * Beta Gate Service Class
 */
class BetaGateService {
  private config = getBetaGateConfig();

  /**
   * Check if beta gate is enabled
   */
  isEnabled(): boolean {
    return this.config.enabled;
  }

  /**
   * Check if an IP is locked out due to brute force
   */
  async isLockedOut(ip: string): Promise<boolean> {
    if (!this.config.enabled) return false;

    const redis = getRedisClient();
    const key = BETA_KEYS.lockoutIp(hashIp(ip));
    const failures = await redis.get(key);
    
    if (failures && parseInt(failures, 10) >= this.config.bruteForce.maxFailures) {
      return true;
    }
    return false;
  }

  /**
   * Increment failure count for brute force protection
   */
  async recordFailure(ip: string): Promise<void> {
    const redis = getRedisClient();
    const key = BETA_KEYS.lockoutIp(hashIp(ip));
    
    await redis.multi()
      .incr(key)
      .expire(key, this.config.bruteForce.lockoutDuration)
      .exec();

    // Increment metrics
    await redis.incr(BETA_KEYS.metrics('failures'));
  }

  /**
   * Check rate limits
   */
  async checkRateLimit(type: 'ip' | 'code' | 'wallet', identifier: string): Promise<{ allowed: boolean; remaining: number }> {
    const redis = getRedisClient();
    const limits = this.config.rateLimits;
    
    let key: string;
    let limit: { window: number; max: number };
    
    switch (type) {
      case 'ip':
        key = BETA_KEYS.rateLimitIp(hashIp(identifier));
        limit = limits.perIp;
        break;
      case 'code':
        key = BETA_KEYS.rateLimitCode(identifier);
        limit = limits.perCode;
        break;
      case 'wallet':
        key = BETA_KEYS.rateLimitWallet(identifier);
        limit = limits.perWallet;
        break;
    }

    const current = await redis.incr(key);
    if (current === 1) {
      await redis.expire(key, limit.window);
    }

    const allowed = current <= limit.max;
    const remaining = Math.max(0, limit.max - current);

    if (!allowed) {
      await redis.incr(BETA_KEYS.metrics('rate_limited'));
    }

    return { allowed, remaining };
  }

  /**
   * Verify code format and existence
   */
  async verifyCode(code: string): Promise<BetaCodeStatus> {
    const redis = getRedisClient();
    const normalized = normalizeCode(code);
    
    // Basic format validation
    if (normalized.length < 6 || normalized.length > 32) {
      return { exists: false, status: 'not_found' };
    }

    const key = BETA_KEYS.code(normalized);
    const data = await redis.get(key);

    if (!data) {
      return { exists: false, status: 'not_found' };
    }

    const parsed = JSON.parse(data);
    return {
      exists: true,
      status: parsed.status,
      wallet: parsed.wallet,
      redeemedAt: parsed.redeemedAt,
    };
  }

  /**
   * Create a challenge nonce for wallet signature
   */
  async createChallenge(code: string, ip: string): Promise<ChallengeResult> {
    const redis = getRedisClient();
    const nonce = randomBytes(32).toString('hex');
    const timestamp = Date.now(); // Use same timestamp for both message and storage
    const expiresAt = timestamp + (this.config.challengeTTL * 1000);

    // Create message for wallet to sign (use same timestamp)
    const message = `Sign this message to verify beta access.\n\nNonce: ${nonce}\nTimestamp: ${timestamp}`;

    const challengeData = JSON.stringify({
      code: normalizeCode(code),
      ip: hashIp(ip),
      createdAt: timestamp, // Same timestamp as in message
    });

    const key = BETA_KEYS.challenge(nonce);
    await redis.setex(key, this.config.challengeTTL, challengeData);

    await redis.incr(BETA_KEYS.metrics('challenges_created'));

    return {
      nonce,
      message,
      expiresAt,
    };
  }

  /**
   * Verify wallet signature
   */
  verifySignature(message: string, signature: string, walletAddress: string): boolean {
    try {
      const messageBytes = new TextEncoder().encode(message);
      const signatureBytes = bs58.decode(signature);
      const publicKeyBytes = bs58.decode(walletAddress);

      return nacl.sign.detached.verify(messageBytes, signatureBytes, publicKeyBytes);
    } catch (error) {
      logger.warn('[BetaGate] Signature verification failed', { error });
      return false;
    }
  }

  /**
   * Redeem a beta code (atomic operation)
   */
  async redeemCode(
    nonce: string,
    signature: string,
    walletAddress: string,
    ip: string
  ): Promise<RedeemResult> {
    const redis = getRedisClient();

    // Get and validate challenge
    const challengeKey = BETA_KEYS.challenge(nonce);
    const challengeData = await redis.get(challengeKey);

    if (!challengeData) {
      return { success: false, error: 'Challenge expired or invalid', errorCode: 'INVALID_CHALLENGE' };
    }

    const challenge = JSON.parse(challengeData);

    // Verify IP hasn't changed (optional security)
    if (challenge.ip !== hashIp(ip)) {
      logger.warn('[BetaGate] IP mismatch during redemption', {
        requestId: nonce.substring(0, 8),
        code: maskCode(challenge.code),
      });
      // Don't fail on IP change, just log it
    }

    // Reconstruct message and verify signature
    const message = `Sign this message to verify beta access.\n\nNonce: ${nonce}\nTimestamp: ${challenge.createdAt}`;
    
    if (!this.verifySignature(message, signature, walletAddress)) {
      await this.recordFailure(ip);
      return { success: false, error: 'Invalid signature', errorCode: 'INVALID_SIGNATURE' };
    }

    // Delete challenge (one-time use)
    await redis.del(challengeKey);

    // Execute atomic redemption
    const codeKey = BETA_KEYS.code(challenge.code);
    const accessKey = BETA_KEYS.access(walletAddress);
    
    const result = await redis.eval(
      REDEEM_LUA_SCRIPT,
      3,
      codeKey,
      accessKey,
      challenge.code,
      walletAddress.toLowerCase(),
      Date.now().toString(),
      this.config.accessGrantTTL.toString()
    ) as number;

    if (result === -1) {
      return { success: false, error: 'Invalid beta code', errorCode: 'INVALID_CODE' };
    }

    if (result === 0) {
      return { success: false, error: 'Code already redeemed', errorCode: 'ALREADY_REDEEMED' };
    }

    // Generate access token
    const accessToken = this.generateAccessToken(walletAddress, challenge.code);

    // Update metrics
    await redis.incr(BETA_KEYS.metrics('successful_redemptions'));

    logger.info('[BetaGate] Code redeemed successfully', {
      requestId: nonce.substring(0, 8),
      code: maskCode(challenge.code),
      wallet: walletAddress.substring(0, 8) + '...',
    });

    return {
      success: true,
      accessToken,
    };
  }

  /**
   * Generate JWT access token
   */
  generateAccessToken(walletAddress: string, code: string): string {
    const payload = {
      type: 'beta_access',
      wallet: walletAddress.toLowerCase(),
      code: normalizeCode(code),
      iat: Math.floor(Date.now() / 1000),
    };

    const signOptions: SignOptions = {
      expiresIn: this.config.jwtExpiresIn as SignOptions['expiresIn'],
      algorithm: 'HS256',
    };

    return jwt.sign(payload, this.config.jwtSecret, signOptions);
  }

  /**
   * Verify access token
   */
  verifyAccessToken(token: string): { valid: boolean; wallet?: string; code?: string } {
    try {
      const decoded = jwt.verify(token, this.config.jwtSecret) as any;
      
      if (decoded.type !== 'beta_access') {
        return { valid: false };
      }

      return {
        valid: true,
        wallet: decoded.wallet,
        code: decoded.code,
      };
    } catch (error) {
      return { valid: false };
    }
  }

  /**
   * Check if wallet has access (fast lookup)
   */
  async checkAccess(walletAddress: string): Promise<AccessStatus> {
    const redis = getRedisClient();
    const key = BETA_KEYS.access(walletAddress);
    const data = await redis.get(key);

    if (!data) {
      return { hasAccess: false };
    }

    const parsed = JSON.parse(data);
    const ttl = await redis.ttl(key);

    return {
      hasAccess: true,
      wallet: walletAddress.toLowerCase(),
      grantedAt: parsed.grantedAt,
      expiresAt: ttl > 0 ? Date.now() + (ttl * 1000) : undefined,
    };
  }

  /**
   * Revoke access token (optional)
   */
  async revokeToken(token: string): Promise<void> {
    const redis = getRedisClient();
    const hash = createHash('sha256').update(token).digest('hex');
    const key = BETA_KEYS.revoked(hash);
    
    // Parse token to get expiry
    try {
      const decoded = jwt.decode(token) as any;
      if (decoded && decoded.exp) {
        const ttl = decoded.exp - Math.floor(Date.now() / 1000);
        if (ttl > 0) {
          await redis.setex(key, ttl, '1');
        }
      }
    } catch (error) {
      // Token invalid, no need to revoke
    }
  }

  /**
   * Check if token is revoked
   */
  async isTokenRevoked(token: string): Promise<boolean> {
    const redis = getRedisClient();
    const hash = createHash('sha256').update(token).digest('hex');
    const key = BETA_KEYS.revoked(hash);
    const revoked = await redis.get(key);
    return revoked === '1';
  }

  /**
   * Get metrics for monitoring
   */
  async getMetrics(): Promise<Record<string, number>> {
    const redis = getRedisClient();
    const metrics: Record<string, number> = {};

    const keys = [
      'challenges_created',
      'successful_redemptions',
      'failures',
      'rate_limited',
    ];

    for (const key of keys) {
      const value = await redis.get(BETA_KEYS.metrics(key));
      metrics[key] = value ? parseInt(value, 10) : 0;
    }

    return metrics;
  }

  /**
   * Seed a beta code into Redis
   */
  async seedCode(code: string, expiresInSeconds?: number): Promise<boolean> {
    const redis = getRedisClient();
    const normalized = normalizeCode(code);
    const key = BETA_KEYS.code(normalized);

    // Check if already exists
    const existing = await redis.get(key);
    if (existing) {
      return false; // Already exists
    }

    const data = JSON.stringify({
      status: 'valid',
      createdAt: Date.now(),
    });

    if (expiresInSeconds) {
      await redis.setex(key, expiresInSeconds, data);
    } else {
      await redis.set(key, data);
    }

    return true;
  }

  /**
   * Bulk seed codes
   */
  async seedCodes(codes: string[], expiresInSeconds?: number): Promise<{ added: number; skipped: number }> {
    let added = 0;
    let skipped = 0;

    for (const code of codes) {
      const success = await this.seedCode(code, expiresInSeconds);
      if (success) {
        added++;
      } else {
        skipped++;
      }
    }

    return { added, skipped };
  }
}

// Export singleton instance
export const betaGateService = new BetaGateService();
