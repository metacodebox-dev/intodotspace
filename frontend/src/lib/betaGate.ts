/**
 * Beta Gate Client Library
 * 
 * Client-side helpers for beta access flow.
 */

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export interface VerifyResponse {
  valid: boolean;
  gateDisabled?: boolean;
  challenge?: {
    nonce: string;
    message: string;
    expiresAt: number;
  };
  error?: string;
  message?: string;
  wallet?: string; // Partially masked wallet if code already used
}

export interface RedeemResponse {
  success: boolean;
  accessToken?: string;
  gateDisabled?: boolean;
  error?: string;
  message?: string;
}

export interface StatusResponse {
  hasAccess: boolean;
  gateDisabled?: boolean;
  wallet?: string;
  grantedAt?: number;
  expiresAt?: number;
  error?: string;
}

/**
 * Verify a beta code and get challenge for signing
 */
export async function verifyBetaCode(code: string): Promise<VerifyResponse> {
  try {
    const response = await fetch(`${API_URL}/api/beta/verify`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ code }),
      credentials: 'include',
    });

    const data = await response.json();

    if (!response.ok && response.status !== 200) {
      // Rate limited or server error
      if (response.status === 429) {
        return {
          valid: false,
          error: 'RATE_LIMITED',
          message: data.message || 'Too many attempts. Please try again later.',
        };
      }
      return {
        valid: false,
        error: 'SERVER_ERROR',
        message: 'An error occurred. Please try again.',
      };
    }

    return data;
  } catch (error) {
    console.error('[BetaGate] Verify error:', error);
    return {
      valid: false,
      error: 'NETWORK_ERROR',
      message: 'Network error. Please check your connection.',
    };
  }
}

/**
 * Redeem a beta code with wallet signature
 */
export async function redeemBetaCode(
  nonce: string,
  signature: string,
  walletAddress: string
): Promise<RedeemResponse> {
  try {
    const response = await fetch(`${API_URL}/api/beta/redeem`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ nonce, signature, walletAddress }),
      credentials: 'include',
    });

    const data = await response.json();

    if (!response.ok && response.status !== 200) {
      if (response.status === 429) {
        return {
          success: false,
          error: 'RATE_LIMITED',
          message: data.message || 'Too many attempts. Please try again later.',
        };
      }
      return {
        success: false,
        error: 'SERVER_ERROR',
        message: 'An error occurred. Please try again.',
      };
    }

    return data;
  } catch (error) {
    console.error('[BetaGate] Redeem error:', error);
    return {
      success: false,
      error: 'NETWORK_ERROR',
      message: 'Network error. Please check your connection.',
    };
  }
}

/**
 * Check current beta access status
 */
export async function checkBetaStatus(): Promise<StatusResponse> {
  try {
    const response = await fetch(`${API_URL}/api/beta/status`, {
      method: 'GET',
      credentials: 'include',
    });

    const data = await response.json();
    
    // If we have access, ensure we have the token stored in frontend cookie
    // Check localStorage first (set after redeem)
    if (data.hasAccess) {
      const storedToken = getStoredAccessToken();
      if (storedToken) {
        // Ensure cookie is set for frontend domain
        storeAccessToken(storedToken);
      }
    }
    
    return data;
  } catch (error) {
    console.error('[BetaGate] Status check error:', error);
    return {
      hasAccess: false,
      error: 'NETWORK_ERROR',
    };
  }
}

/**
 * Store access token in localStorage and set cookie for frontend domain
 * (Backend sets HttpOnly cookie, but frontend middleware needs its own cookie)
 */
export function storeAccessToken(token: string): void {
  if (typeof window !== 'undefined') {
    try {
      // Store in localStorage as backup
      localStorage.setItem('beta_access_token', token);
      
      // Set cookie for frontend domain (so middleware can read it)
      // Calculate max age (30 days in seconds)
      const maxAge = 30 * 24 * 60 * 60; // 30 days
      const expires = new Date(Date.now() + maxAge * 1000).toUTCString();
      
      // Set cookie for current domain (frontend domain)
      // Middleware and frontend are on same domain (Vercel), so SameSite=Lax works
      // This cookie is ONLY for the middleware to read (same-site)
      // Backend has its own cookie for API calls (cross-site)
      const isProduction = window.location.protocol === 'https:';
      const secureFlag = isProduction ? '; Secure' : '';
      const sameSiteFlag = '; SameSite=Lax';
      
      // Set cookie - this will be readable by middleware on same domain
      document.cookie = `beta_access_token=${token}; path=/; max-age=${maxAge}; expires=${expires}${sameSiteFlag}${secureFlag}`;
    } catch (e) {
      // localStorage or cookie might be disabled
    }
  }
}

/**
 * Get access token from localStorage
 */
export function getStoredAccessToken(): string | null {
  if (typeof window !== 'undefined') {
    try {
      return localStorage.getItem('beta_access_token');
    } catch (e) {
      return null;
    }
  }
  return null;
}

/**
 * Clear stored access token
 */
export function clearAccessToken(): void {
  if (typeof window !== 'undefined') {
    try {
      localStorage.removeItem('beta_access_token');
    } catch (e) {
      // Ignore
    }
  }
}

/**
 * Check if beta gate is enabled (from environment)
 */
export function isBetaGateEnabled(): boolean {
  return process.env.NEXT_PUBLIC_BETA_GATE_ENABLED === 'true';
}
