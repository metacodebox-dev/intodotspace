import type { NextApiRequest, NextApiResponse } from 'next';

// Server-side proxy to the paid Solana RPC. The upstream URL (with API key)
// stays in SOLANA_RPC_URL — never sent to the browser. Frontend hits
// /api/rpc on its own origin so the key is never bundled.
//
// What this DOES NOT do:
//  - WebSocket subscriptions: web3.js opens a separate WS connection.
//    See NEXT_PUBLIC_SOLANA_WS_URL handling in WalletProvider.
//  - Strong abuse protection: same-origin + origin header check is enough
//    to block browser abuse from other sites. A determined attacker with
//    curl can still hit the endpoint. Add rate limiting if needed.

const UPSTREAM_URL = process.env.SOLANA_RPC_URL;

// Public-Solana-devnet fallback. Used only when the primary upstream
// (paid Helius) returns 401 or the JSON-RPC -32401 "rate-limit" response
// — keeps the app functional during a Helius throttle event without us
// having to swap env and redeploy. Public RPC is slow + rate-limited and
// not a long-term replacement, but it's better than serving 401s to users.
// Override with `SOLANA_RPC_FALLBACK_URL` if you want to point at a
// different secondary (e.g. another paid provider).
const FALLBACK_URL =
  process.env.SOLANA_RPC_FALLBACK_URL || 'https://api.devnet.solana.com';

// Comma-separated list of allowed origins. Defaults to a sensible set for
// local dev + Vercel deploys. Override via env if your domain differs.
const ALLOWED_ORIGINS = (
  process.env.RPC_PROXY_ALLOWED_ORIGINS ||
  'http://localhost:3000,https://space-frontend-nine.vercel.app,https://beta.into.space'
)
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

/** True if upstream's response indicates we should retry on the fallback. */
function shouldFallback(httpStatus: number, body: string): boolean {
  // HTTP 401 (Helius's wrapper around -32401) or 429 — both rate-limity.
  if (httpStatus === 401 || httpStatus === 429) return true;
  // JSON-RPC -32401 ("Bad request, please try again later") and -32429
  // (standard "Too Many Requests"). Helius wraps the former in HTTP 401
  // already, but defensively also check the body.
  try {
    const parsed = JSON.parse(body);
    const code = parsed?.error?.code;
    if (code === -32401 || code === -32429) return true;
  } catch { /* not JSON; ignore */ }
  return false;
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!UPSTREAM_URL) {
    return res.status(500).json({ error: 'SOLANA_RPC_URL not configured on server' });
  }

  // Origin check — browsers always send the Origin header on cross-site
  // requests. Same-origin (frontend → /api/rpc) usually omits it; in that
  // case we accept since it can't have come from a third-party tab.
  const origin = req.headers.origin;
  if (origin && !ALLOWED_ORIGINS.includes(origin)) {
    return res.status(403).json({ error: 'Origin not allowed' });
  }

  // Build the body once so we can resend it to the fallback verbatim.
  const upstreamBody = JSON.stringify(req.body);

  // Helper: fire one POST, return { status, contentType, text }.
  const dispatch = async (url: string) => {
    const r = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: upstreamBody,
    });
    const text = await r.text();
    const contentType = r.headers.get('content-type') || 'application/json';
    return { status: r.status, contentType, text };
  };

  try {
    let result = await dispatch(UPSTREAM_URL);

    // If the paid upstream is throttling (HTTP 401/429 or JSON-RPC
    // -32401/-32429), retry once on the public Solana devnet endpoint.
    // Public RPC is slower but it keeps the app responsive while Helius
    // sorts out whatever rate-limit state is active.
    if (shouldFallback(result.status, result.text)) {
      console.warn(
        `[rpc-proxy] primary upstream ${result.status} on method=${req.body?.method} → falling back to ${FALLBACK_URL}`,
      );
      try {
        result = await dispatch(FALLBACK_URL);
        // Tag the response so the browser can see we used fallback.
        res.setHeader('X-Rpc-Source', 'fallback');
      } catch (fallbackErr: any) {
        console.error('[rpc-proxy] fallback also failed:', fallbackErr?.message || fallbackErr);
        // Fall through to send the original primary response — the client
        // sees the original 401 instead of swallowing it as 502.
      }
    } else {
      res.setHeader('X-Rpc-Source', 'primary');
    }

    res.status(result.status);
    res.setHeader('Content-Type', result.contentType);
    res.send(result.text);
  } catch (err: any) {
    console.error('[rpc-proxy] upstream error:', err?.message || err);
    // Last-resort: try the fallback once before failing the request.
    try {
      const fb = await dispatch(FALLBACK_URL);
      res.setHeader('X-Rpc-Source', 'fallback-on-error');
      res.status(fb.status);
      res.setHeader('Content-Type', fb.contentType);
      res.send(fb.text);
    } catch {
      res.status(502).json({ error: 'Upstream RPC error' });
    }
  }
}
