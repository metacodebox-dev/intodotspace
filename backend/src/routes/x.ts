import { Router, Request, Response, NextFunction } from 'express';
import { randomBytes, createHash } from 'crypto';
import { requireAuth } from '../middleware/authMiddleware';
import { UserProfile } from '../models/UserProfile';

const router = Router();

const X_AUTH_URL = 'https://twitter.com/i/oauth2/authorize';
const X_TOKEN_URL = 'https://api.twitter.com/2/oauth2/token';
const X_ME_URL = 'https://api.twitter.com/2/users/me';

const CLIENT_ID = process.env.TWITTER_CLIENT_ID || '';
const CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET || '';
const FRONTEND_URL = process.env.NEXT_PUBLIC_APP_URL || 'http://localhost:3000';
const BACKEND_URL = process.env.BACKEND_URL || 'http://localhost:3001';

const REDIRECT_URI = `${BACKEND_URL}/api/x/callback`;

// Log configuration on module load
console.log('[X OAuth Config]', {
  clientIdSet: !!CLIENT_ID,
  clientSecretSet: !!CLIENT_SECRET,
  frontendUrl: FRONTEND_URL,
  backendUrl: BACKEND_URL,
  redirectUri: REDIRECT_URI,
});

// In-memory store for OAuth state -> code verifier (use Redis in production)
const oauthStateStore = new Map<string, { codeVerifier: string; walletAddress: string; createdAt: number }>();

const STATE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function cleanupStates() {
  const now = Date.now();
  for (const [state, data] of oauthStateStore.entries()) {
    if (now - data.createdAt > STATE_TTL_MS) {
      oauthStateStore.delete(state);
    }
  }
}

function base64UrlEncode(buffer: Buffer) {
  return buffer
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function generateCodeVerifier() {
  return base64UrlEncode(randomBytes(32));
}

function generateCodeChallenge(verifier: string) {
  const hash = createHash('sha256').update(verifier).digest();
  return base64UrlEncode(hash);
}

/**
 * POST /api/x/connect
 * Initiate X OAuth flow - returns auth URL for frontend to redirect to
 */
router.post('/connect', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    if (!CLIENT_ID || !CLIENT_SECRET) {
      console.error('[X Connect] Missing TWITTER_CLIENT_ID or TWITTER_CLIENT_SECRET');
      return res.status(500).json({
        error: {
          code: 'X_CONFIG_MISSING',
          message: 'X client credentials are not configured',
        },
      });
    }

    cleanupStates();

    const state = base64UrlEncode(randomBytes(16));
    const codeVerifier = generateCodeVerifier();
    const codeChallenge = generateCodeChallenge(codeVerifier);

    const walletAddress = req.user?.walletAddress;
    if (!walletAddress) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
    }

    oauthStateStore.set(state, {
      codeVerifier,
      walletAddress,
      createdAt: Date.now(),
    });

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: CLIENT_ID,
      redirect_uri: REDIRECT_URI,
      scope: 'users.read tweet.read',
      state,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

    const authUrl = `${X_AUTH_URL}?${params.toString()}`;

    console.log('[X Connect] Generated auth URL for wallet:', walletAddress.slice(0, 8) + '...', 'redirect_uri:', REDIRECT_URI);

    res.json({ authUrl });
  } catch (error) {
    console.error('[X Connect] Error:', error);
    next(error);
  }
});

/**
 * GET /api/x/callback
 * Handle X OAuth callback - exchange code for token, fetch profile, save to DB
 */
router.get('/callback', async (req: Request, res: Response) => {
  try {
    const { code, state, error: oauthError } = req.query as { code?: string; state?: string; error?: string };

    // Handle OAuth error (user denied access)
    if (oauthError) {
      console.log('[X Callback] OAuth error:', oauthError);
      return res.redirect(`${FRONTEND_URL}/profile?x=denied`);
    }

    if (!code || !state) {
      console.log('[X Callback] Missing code or state');
      return res.redirect(`${FRONTEND_URL}/profile?x=error`);
    }

    const stored = oauthStateStore.get(state);
    if (!stored) {
      console.log('[X Callback] State not found or expired');
      return res.redirect(`${FRONTEND_URL}/profile?x=expired`);
    }

    oauthStateStore.delete(state);

    console.log('[X Callback] Exchanging code for token...', 'redirect_uri:', REDIRECT_URI);

    // Exchange code for access token
    const basicAuth = Buffer.from(`${CLIENT_ID}:${CLIENT_SECRET}`).toString('base64');

    const tokenResponse = await fetch(X_TOKEN_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'Authorization': `Basic ${basicAuth}`,
      },
      body: new URLSearchParams({
        grant_type: 'authorization_code',
        code,
        redirect_uri: REDIRECT_URI,
        code_verifier: stored.codeVerifier,
      }),
    });

    if (!tokenResponse.ok) {
      const errorText = await tokenResponse.text();
      console.error('[X Callback] Token exchange failed:', tokenResponse.status, errorText);
      return res.redirect(`${FRONTEND_URL}/profile?x=token_error`);
    }

    const tokenData = await tokenResponse.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      console.error('[X Callback] No access token in response:', tokenData);
      return res.redirect(`${FRONTEND_URL}/profile?x=token_error`);
    }

    console.log('[X Callback] Token obtained, fetching user profile...');

    // Fetch user profile
    const meResponse = await fetch(`${X_ME_URL}?user.fields=profile_image_url,name,username`, {
      headers: {
        'Authorization': `Bearer ${accessToken}`,
      },
    });

    if (!meResponse.ok) {
      const errorText = await meResponse.text();
      console.error('[X Callback] Profile fetch failed:', meResponse.status, errorText);
      return res.redirect(`${FRONTEND_URL}/profile?x=profile_error`);
    }

    const meData = await meResponse.json();
    const user = meData.data;

    if (!user?.id) {
      console.error('[X Callback] No user data in response:', meData);
      return res.redirect(`${FRONTEND_URL}/profile?x=profile_error`);
    }

    console.log('[X Callback] Got user profile:', user.username);

    // Get higher resolution avatar (replace _normal with _400x400)
    const avatarUrl = user.profile_image_url?.replace('_normal', '_400x400') || user.profile_image_url;

    // Save or update user profile using findOrCreate + update pattern
    const [profile, created] = await UserProfile.findOrCreate({
      where: { walletAddress: stored.walletAddress },
      defaults: {
        walletAddress: stored.walletAddress,
        twitterId: user.id,
        twitterUsername: user.username,
        twitterName: user.name,
        twitterAvatarUrl: avatarUrl,
      },
    });

    if (!created) {
      // Update existing profile
      await profile.update({
        twitterId: user.id,
        twitterUsername: user.username,
        twitterName: user.name,
        twitterAvatarUrl: avatarUrl,
      });
    }

    console.log('[X Callback] Profile saved for wallet:', stored.walletAddress.slice(0, 8) + '...');

    return res.redirect(`${FRONTEND_URL}/profile?x=connected`);
  } catch (error) {
    console.error('[X Callback] Error:', error);
    return res.redirect(`${FRONTEND_URL}/profile?x=error`);
  }
});

/**
 * GET /api/x/profile
 * Get current user's X profile if connected
 */
router.get('/profile', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const walletAddress = req.user?.walletAddress;
    if (!walletAddress) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
    }

    const profile = await UserProfile.findOne({ where: { walletAddress } });

    if (!profile || !profile.twitterId) {
      return res.json({ connected: false });
    }

    return res.json({
      connected: true,
      profile: {
        id: profile.twitterId,
        name: profile.twitterName,
        username: profile.twitterUsername,
        avatarUrl: profile.twitterAvatarUrl,
      },
    });
  } catch (error) {
    console.error('[X Profile] Error:', error);
    next(error);
  }
});

/**
 * POST /api/x/disconnect
 * Disconnect X account from wallet
 */
router.post('/disconnect', requireAuth, async (req: Request, res: Response, next: NextFunction) => {
  try {
    const walletAddress = req.user?.walletAddress;
    if (!walletAddress) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Authentication required',
        },
      });
    }

    const profile = await UserProfile.findOne({ where: { walletAddress } });

    if (profile) {
      await profile.update({
        twitterId: null,
        twitterUsername: null,
        twitterName: null,
        twitterAvatarUrl: null,
      });
    }

    return res.json({ success: true });
  } catch (error) {
    console.error('[X Disconnect] Error:', error);
    next(error);
  }
});

export { router as xRoutes };
