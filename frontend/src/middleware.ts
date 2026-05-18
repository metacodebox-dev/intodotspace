/**
 * Next.js Edge Middleware - Beta Access Gate
 * 
 * This middleware enforces beta access control at the edge.
 * It runs BEFORE any page or API route.
 * 
 * IMPORTANT: This is a WRAPPER that does not modify existing logic.
 * When BETA_GATE_ENABLED is false, it passes through all requests.
 */

import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';
import { jwtVerify } from 'jose';

// Routes that should ALWAYS be accessible (no gate)
const PUBLIC_ROUTES = [
  '/beta',           // Beta access page itself
  '/api/beta',       // Beta API routes (proxied to backend)
  '/_next',          // Next.js internals
  '/favicon.ico',    // Favicon
  '/assets',         // Static assets
  '/health',         // Health check
];

// API routes that should be accessible (for beta verification)
const PUBLIC_API_PATTERNS = [
  '/api/beta/',      // Beta gate APIs
];

/**
 * Check if a path should bypass the beta gate
 */
function isPublicPath(pathname: string): boolean {
  // Check exact matches and prefixes
  for (const route of PUBLIC_ROUTES) {
    if (pathname === route || pathname.startsWith(route + '/') || pathname.startsWith(route)) {
      return true;
    }
  }

  // Check API patterns
  for (const pattern of PUBLIC_API_PATTERNS) {
    if (pathname.startsWith(pattern)) {
      return true;
    }
  }

  // Static files
  if (pathname.match(/\.(ico|png|jpg|jpeg|gif|svg|webp|css|js|woff|woff2|ttf|eot)$/)) {
    return true;
  }

  return false;
}

/**
 * Verify beta access token using jose (Edge-compatible JWT library)
 */
async function verifyBetaToken(token: string): Promise<boolean> {
  try {
    const secret = process.env.NEXT_PUBLIC_BETA_JWT_SECRET;
    if (!secret) {
      console.error('[BetaGate Middleware] NEXT_PUBLIC_BETA_JWT_SECRET not configured');
      return false;
    }

    const secretKey = new TextEncoder().encode(secret);
    const { payload } = await jwtVerify(token, secretKey, {
      algorithms: ['HS256'],
    });

    // Verify token type
    if (payload.type !== 'beta_access') {
      return false;
    }

    return true;
  } catch (error) {
    // Token invalid or expired
    return false;
  }
}

/**
 * Main middleware function
 */
export async function middleware(request: NextRequest) {
  const pathname = request.nextUrl.pathname;

  // Check if beta gate is enabled
  const betaGateEnabled = process.env.NEXT_PUBLIC_BETA_GATE_ENABLED === 'true';

  // If gate is disabled, pass through everything
  if (!betaGateEnabled) {
    return NextResponse.next();
  }

  // Allow public routes
  if (isPublicPath(pathname)) {
    return NextResponse.next();
  }

  // Check for beta access token in cookie
  const token = request.cookies.get('beta_access_token')?.value;

  // Also check Authorization header (for API requests)
  const headerToken = request.headers.get('x-beta-access-token');

  const accessToken = token || headerToken;

  if (!accessToken) {
    // No token - redirect to beta page
    const url = request.nextUrl.clone();
    url.pathname = '/beta';
    url.searchParams.set('redirect', pathname);
    return NextResponse.redirect(url);
  }

  // Verify token
  const isValid = await verifyBetaToken(accessToken);

  if (!isValid) {
    // Invalid/expired token - clear cookie and redirect
    const url = request.nextUrl.clone();
    url.pathname = '/beta';
    url.searchParams.set('redirect', pathname);
    url.searchParams.set('error', 'expired');
    
    const response = NextResponse.redirect(url);
    response.cookies.delete('beta_access_token');
    return response;
  }

  // Valid token - allow access
  return NextResponse.next();
}

/**
 * Configure which paths the middleware runs on
 */
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static (static files)
     * - _next/image (image optimization)
     * - favicon.ico
     * - public folder
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
