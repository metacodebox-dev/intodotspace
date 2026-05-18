/**
 * Beta Gate Configuration
 * 
 * Environment variables required for beta gate functionality.
 * Validates on startup and provides defaults where safe.
 */

export interface BetaGateConfig {
  enabled: boolean;
  jwtSecret: string;
  jwtExpiresIn: string;
  accessGrantTTL: number; // seconds
  challengeTTL: number; // seconds for nonce validity
  rateLimits: {
    perIp: { window: number; max: number };
    perCode: { window: number; max: number };
    perWallet: { window: number; max: number };
  };
  bruteForce: {
    maxFailures: number;
    lockoutDuration: number; // seconds
  };
}

/**
 * Validate and load beta gate configuration
 * Throws on missing required vars when gate is enabled
 */
export function loadBetaGateConfig(): BetaGateConfig {
  const enabled = process.env.BETA_GATE_ENABLED === 'true';
  
  // If disabled, return minimal config
  if (!enabled) {
    return {
      enabled: false,
      jwtSecret: 'disabled',
      jwtExpiresIn: '7d',
      accessGrantTTL: 2592000, // 30 days
      challengeTTL: 300, // 5 minutes
      rateLimits: {
        perIp: { window: 60, max: 20 },
        perCode: { window: 3600, max: 10 },
        perWallet: { window: 3600, max: 10 },
      },
      bruteForce: {
        maxFailures: 10,
        lockoutDuration: 3600, // 1 hour
      },
    };
  }
  
  // When enabled, require BETA_JWT_SECRET
  const jwtSecret = process.env.BETA_JWT_SECRET;
  if (!jwtSecret || jwtSecret.length < 32) {
    throw new Error(
      '[BetaGate] BETA_JWT_SECRET must be set and at least 32 characters when BETA_GATE_ENABLED=true'
    );
  }
  
  // Redis URL is required (already validated by main app, but double-check)
  if (!process.env.REDIS_URL) {
    throw new Error('[BetaGate] REDIS_URL must be set when BETA_GATE_ENABLED=true');
  }
  
  return {
    enabled: true,
    jwtSecret,
    jwtExpiresIn: process.env.BETA_JWT_EXPIRES_IN || '100d',
    accessGrantTTL: parseInt(process.env.BETA_ACCESS_GRANT_TTL || '2592000', 10), // 30 days default
    challengeTTL: parseInt(process.env.BETA_CHALLENGE_TTL || '300', 10), // 5 min default
    rateLimits: {
      perIp: {
        window: parseInt(process.env.BETA_RATE_LIMIT_IP_WINDOW || '60', 10),
        max: parseInt(process.env.BETA_RATE_LIMIT_IP_MAX || '20', 10),
      },
      perCode: {
        window: parseInt(process.env.BETA_RATE_LIMIT_CODE_WINDOW || '3600', 10),
        max: parseInt(process.env.BETA_RATE_LIMIT_CODE_MAX || '10', 10),
      },
      perWallet: {
        window: parseInt(process.env.BETA_RATE_LIMIT_WALLET_WINDOW || '3600', 10),
        max: parseInt(process.env.BETA_RATE_LIMIT_WALLET_MAX || '10', 10),
      },
    },
    bruteForce: {
      maxFailures: parseInt(process.env.BETA_BRUTE_FORCE_MAX_FAILURES || '10', 10),
      lockoutDuration: parseInt(process.env.BETA_BRUTE_FORCE_LOCKOUT || '3600', 10),
    },
  };
}

// Singleton config instance
let configInstance: BetaGateConfig | null = null;

export function getBetaGateConfig(): BetaGateConfig {
  if (!configInstance) {
    configInstance = loadBetaGateConfig();
  }
  return configInstance;
}

/**
 * Reset config (for testing)
 */
export function resetBetaGateConfig(): void {
  configInstance = null;
}
