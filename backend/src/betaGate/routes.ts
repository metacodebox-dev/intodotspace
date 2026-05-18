/**
 * Beta Gate API Routes
 * 
 * Isolated routes for beta access verification and redemption.
 * These do not depend on existing auth flows.
 */

import { Router, Request, Response } from 'express';
import { betaGateService } from './service';
import { getBetaGateConfig } from './config';
import { maskCode, hashIp } from './keys';
import { logger } from '../utils/logger';

const router = Router();

/**
 * Get client IP from request
 */
function getClientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (typeof forwarded === 'string') {
    return forwarded.split(',')[0].trim();
  }
  return req.socket.remoteAddress || 'unknown';
}

/**
 * Rate limit middleware for beta routes
 */
async function rateLimitMiddleware(req: Request, res: Response, next: Function) {
  const config = getBetaGateConfig();
  if (!config.enabled) {
    return next();
  }

  const ip = getClientIp(req);

  // Check lockout
  const isLocked = await betaGateService.isLockedOut(ip);
  if (isLocked) {
    logger.warn('[BetaGate] Locked out IP attempted access', { ip: hashIp(ip) });
    // return res.status(429).json({
    //   error: 'TOO_MANY_REQUESTS',
    //   message: 'Too many failed attempts. Please try again later.',
    //   retryAfter: config.bruteForce.lockoutDuration,
    // });
  }

  // Check rate limit
  const { allowed, remaining } = await betaGateService.checkRateLimit('ip', ip);
  
  res.setHeader('X-RateLimit-Remaining', remaining);
  
  if (!allowed) {
    return res.status(429).json({
      error: 'RATE_LIMITED',
      message: 'Too many requests. Please slow down.',
      retryAfter: config.rateLimits.perIp.window,
    });
  }

  next();
}

/**
 * POST /api/beta/verify
 * 
 * Step 1: Verify code format and create challenge nonce
 * 
 * Request: { code: string }
 * Response: { valid: boolean, challenge?: { nonce, message, expiresAt }, error?: string }
 */
router.post('/verify', rateLimitMiddleware, async (req: Request, res: Response) => {
  const config = getBetaGateConfig();
  
  // If gate disabled, allow all
  if (!config.enabled) {
    return res.json({
      valid: true,
      gateDisabled: true,
    });
  }

  const { code } = req.body;
  const ip = getClientIp(req);

  // Validate input
  if (!code || typeof code !== 'string') {
    return res.status(400).json({
      valid: false,
      error: 'INVALID_INPUT',
      message: 'Beta code is required',
    });
  }

  try {
    // Check rate limit for this specific code
    const { allowed: codeAllowed } = await betaGateService.checkRateLimit('code', code);
    if (!codeAllowed) {
      return res.status(429).json({
        valid: false,
        error: 'RATE_LIMITED',
        message: 'Too many attempts for this code. Please try again later.',
      });
    }

    // Verify code exists and is valid
    const codeStatus = await betaGateService.verifyCode(code);

    if (!codeStatus.exists) {
      await betaGateService.recordFailure(ip);
      logger.info('[BetaGate] Invalid code attempt', { 
        code: maskCode(code), 
        ip: hashIp(ip) 
      });
      return res.json({
        valid: false,
        error: 'INVALID_CODE',
        message: 'Invalid beta code',
      });
    }

    if (codeStatus.status === 'redeemed') {
      return res.json({
        valid: false,
        error: 'ALREADY_REDEEMED',
        message: 'This code has already been used',
        wallet: codeStatus.wallet ? 
          codeStatus.wallet.substring(0, 6) + '...' + codeStatus.wallet.substring(codeStatus.wallet.length - 4) : 
          undefined,
      });
    }

    // Create challenge for wallet signature
    const challenge = await betaGateService.createChallenge(code, ip);

    logger.info('[BetaGate] Challenge created', { 
      code: maskCode(code), 
      nonce: challenge.nonce.substring(0, 8) + '...',
    });

    return res.json({
      valid: true,
      challenge: {
        nonce: challenge.nonce,
        message: challenge.message,
        expiresAt: challenge.expiresAt,
      },
    });
  } catch (error) {
    logger.error('[BetaGate] Verify error', { error });
    return res.status(500).json({
      valid: false,
      error: 'INTERNAL_ERROR',
      message: 'An error occurred. Please try again.',
    });
  }
});

/**
 * POST /api/beta/redeem
 * 
 * Step 2: Redeem code with wallet signature
 * 
 * Request: { nonce: string, signature: string, walletAddress: string }
 * Response: { success: boolean, accessToken?: string, error?: string }
 */
router.post('/redeem', rateLimitMiddleware, async (req: Request, res: Response) => {
  const config = getBetaGateConfig();
  
  // If gate disabled, generate token without verification
  if (!config.enabled) {
    const { walletAddress } = req.body;
    if (!walletAddress) {
      return res.status(400).json({
        success: false,
        error: 'INVALID_INPUT',
        message: 'Wallet address is required',
      });
    }
    const token = betaGateService.generateAccessToken(walletAddress, 'GATE_DISABLED');
    return res.json({
      success: true,
      accessToken: token,
      gateDisabled: true,
    });
  }

  const { nonce, signature, walletAddress } = req.body;
  const ip = getClientIp(req);

  // Validate inputs
  if (!nonce || typeof nonce !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'INVALID_INPUT',
      message: 'Challenge nonce is required',
    });
  }

  if (!signature || typeof signature !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'INVALID_INPUT',
      message: 'Wallet signature is required',
    });
  }

  if (!walletAddress || typeof walletAddress !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'INVALID_INPUT',
      message: 'Wallet address is required',
    });
  }

  // Validate wallet address format (basic Solana address check)
  if (walletAddress.length < 32 || walletAddress.length > 44) {
    return res.status(400).json({
      success: false,
      error: 'INVALID_WALLET',
      message: 'Invalid wallet address format',
    });
  }

  try {
    // Check rate limit for wallet
    const { allowed: walletAllowed } = await betaGateService.checkRateLimit('wallet', walletAddress);
    if (!walletAllowed) {
      return res.status(429).json({
        success: false,
        error: 'RATE_LIMITED',
        message: 'Too many attempts for this wallet. Please try again later.',
      });
    }

    // Attempt redemption
    const result = await betaGateService.redeemCode(nonce, signature, walletAddress, ip);

    if (!result.success) {
      // Record failure for brute force protection
      if (result.errorCode === 'INVALID_SIGNATURE' || result.errorCode === 'INVALID_CODE') {
        await betaGateService.recordFailure(ip);
      }

      return res.json({
        success: false,
        error: result.errorCode,
        message: result.error,
      });
    }

    // Set access token in HttpOnly cookie
    const maxAge = parseInt(config.jwtExpiresIn) * 86400 * 1000; // Convert days to milliseconds
    const isProduction = process.env.NODE_ENV === 'production';
    
    // For cross-site requests (frontend on different domain), use 'none' with 'secure'
    // For same-site, 'lax' is more secure
    const sameSite = isProduction ? 'none' : 'lax'; // 'none' required for cross-site cookies
    
    res.cookie('beta_access_token', result.accessToken, {
      httpOnly: true,
      secure: isProduction, // Must be true when sameSite is 'none'
      sameSite: sameSite,
      maxAge,
      path: '/',
      domain: undefined, // Don't set domain to allow cross-site cookies
    });
    
    logger.info('[BetaGate] Cookie set', {
      sameSite,
      secure: isProduction,
      hasToken: !!result.accessToken,
    });

    return res.json({
      success: true,
      accessToken: result.accessToken,
    });
  } catch (error) {
    logger.error('[BetaGate] Redeem error', { error });
    return res.status(500).json({
      success: false,
      error: 'INTERNAL_ERROR',
      message: 'An error occurred. Please try again.',
    });
  }
});

/**
 * GET /api/beta/status
 * 
 * Check if current request has beta access
 * Checks both cookie and Authorization header
 * 
 * Response: { hasAccess: boolean, wallet?: string, grantedAt?: number }
 */
router.get('/status', async (req: Request, res: Response) => {
  const config = getBetaGateConfig();
  
  // If gate disabled, everyone has access
  if (!config.enabled) {
    return res.json({
      hasAccess: true,
      gateDisabled: true,
    });
  }

  try {
    // Try cookie first
    let token = req.cookies?.beta_access_token;
    
    // Fall back to Authorization header
    if (!token) {
      const authHeader = req.headers['x-beta-access-token'];
      if (typeof authHeader === 'string') {
        token = authHeader;
      }
    }

    if (!token) {
      return res.json({
        hasAccess: false,
      });
    }

    // Verify token
    const verification = betaGateService.verifyAccessToken(token);
    
    if (!verification.valid) {
      return res.json({
        hasAccess: false,
        error: 'INVALID_TOKEN',
      });
    }

    // Check if token is revoked
    const isRevoked = await betaGateService.isTokenRevoked(token);
    if (isRevoked) {
      return res.json({
        hasAccess: false,
        error: 'TOKEN_REVOKED',
      });
    }

    // Optional: verify access still exists in Redis
    const accessStatus = await betaGateService.checkAccess(verification.wallet!);
    
    return res.json({
      hasAccess: true,
      wallet: verification.wallet,
      grantedAt: accessStatus.grantedAt,
      expiresAt: accessStatus.expiresAt,
    });
  } catch (error) {
    logger.error('[BetaGate] Status check error', { error });
    return res.status(500).json({
      hasAccess: false,
      error: 'INTERNAL_ERROR',
    });
  }
});

/**
 * GET /api/beta/metrics (internal/admin only)
 * 
 * Get gate metrics for monitoring
 */
router.get('/metrics', async (req: Request, res: Response) => {
  const config = getBetaGateConfig();
  
  // Simple admin check - in production, add proper auth
  const adminKey = req.headers['x-admin-key'];
  if (adminKey !== process.env.BETA_ADMIN_KEY) {
    return res.status(403).json({ error: 'Forbidden' });
  }

  try {
    const metrics = await betaGateService.getMetrics();
    return res.json({
      enabled: config.enabled,
      metrics,
    });
  } catch (error) {
    logger.error('[BetaGate] Metrics error', { error });
    return res.status(500).json({ error: 'Failed to fetch metrics' });
  }
});

export const betaGateRoutes = router;
