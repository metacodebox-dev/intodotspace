# Beta Access Gate Setup

This document describes how to configure and use the Beta Access Gate system.

## Overview

The Beta Access Gate is a **wrapper layer** that restricts access to the main website to users with valid beta codes. It is designed to:

- Allow only beta code holders to access the main site
- Each code is single-use (bound to one wallet)
- Scale to 1,000,000+ users
- Protect against brute force, replay, and abuse
- Be easily disabled for public launch

## Quick Start

### 1. Enable the Beta Gate

Add these environment variables:

**Backend (.env)**
```bash
# Required when gate is enabled
BETA_GATE_ENABLED=true
BETA_JWT_SECRET=your-32-character-minimum-secret-key
REDIS_URL=redis://localhost:6379

# Optional customization
BETA_JWT_EXPIRES_IN=7d
BETA_ACCESS_GRANT_TTL=604800
BETA_CHALLENGE_TTL=300

# For metrics endpoint
BETA_ADMIN_KEY=your-admin-key
```

**Frontend (.env.local)**
```bash
NEXT_PUBLIC_BETA_GATE_ENABLED=true
BETA_JWT_SECRET=your-32-character-minimum-secret-key  # Same as backend
NEXT_PUBLIC_API_URL=http://localhost:3001
```

### 2. Seed Beta Codes

```bash
cd backend

# Generate 50 random codes
npx ts-node scripts/seedBetaCodes.ts --generate 50

# Or import from file
npx ts-node scripts/seedBetaCodes.ts --file codes.txt

# View all codes
npx ts-node scripts/seedBetaCodes.ts --list

# View statistics
npx ts-node scripts/seedBetaCodes.ts --stats
```

### 3. Install Dependencies

```bash
# Backend
cd backend && npm install

# Frontend
cd frontend && npm install
```

### 4. Run the Application

```bash
# Backend
cd backend && npm run dev

# Frontend (new terminal)
cd frontend && npm run dev
```

## How It Works

### User Flow

1. User visits any page → Middleware redirects to `/beta`
2. User enters beta code → Backend validates and creates challenge
3. User connects wallet → Signs challenge message
4. Backend verifies signature and redeems code atomically
5. JWT token set in HttpOnly cookie
6. User redirected to original destination

### Security Features

- **Rate Limiting**: Per IP, per code, per wallet
- **Brute Force Protection**: Exponential backoff, temporary lockouts
- **Replay Protection**: Nonce-based challenge flow
- **Atomic Redemption**: Redis Lua script prevents double-spend
- **Secure Tokens**: Short-lived JWT with optional revocation

## Disabling the Gate (Public Launch)

To make the site publicly accessible, simply set:

```bash
BETA_GATE_ENABLED=false
NEXT_PUBLIC_BETA_GATE_ENABLED=false
```

No code changes required. The middleware will pass through all requests.

## Architecture

### Backend Files (New)
```
backend/src/betaGate/
├── config.ts     # Configuration & env validation
├── keys.ts       # Redis key schema
├── service.ts    # Core logic, Lua scripts, JWT
├── routes.ts     # API endpoints
└── index.ts      # Module exports

backend/src/models/
└── BetaAccess.ts # Audit model (Postgres)

backend/src/migrations/
└── 20240126_create_beta_access_table.sql

backend/scripts/
└── seedBetaCodes.ts  # CLI tool for managing codes
```

### Frontend Files (New)
```
frontend/
├── middleware.ts           # Edge middleware (gate enforcement)
└── src/
    ├── lib/betaGate.ts     # Client API helpers
    └── pages/beta.tsx      # Beta access page
```

### Modified Files (Minimal)
```
backend/src/index.ts        # +4 lines (import + route registration)
backend/src/models/index.ts # +1 line (export BetaAccess)
backend/package.json        # +2 dependencies (cookie-parser, bs58)
frontend/package.json       # +1 dependency (jose)
```

## API Endpoints

### POST /api/beta/verify
Verify a beta code and get challenge for signing.

**Request:**
```json
{ "code": "BETA-XXXX-XXXX" }
```

**Response (valid):**
```json
{
  "valid": true,
  "challenge": {
    "nonce": "abc123...",
    "message": "Sign this message...",
    "expiresAt": 1234567890
  }
}
```

### POST /api/beta/redeem
Redeem code with wallet signature.

**Request:**
```json
{
  "nonce": "abc123...",
  "signature": "base58-signature",
  "walletAddress": "ABC123..."
}
```

**Response (success):**
```json
{
  "success": true,
  "accessToken": "jwt-token"
}
```

### GET /api/beta/status
Check current access status.

**Response:**
```json
{
  "hasAccess": true,
  "wallet": "ABC123...",
  "grantedAt": 1234567890
}
```

## Redis Key Schema

```
beta:code:<normalized_code>     # Code status & binding
beta:challenge:<nonce>          # Challenge nonces (TTL: 5min)
beta:access:<wallet>            # Access grants (TTL: 7 days)
beta:ratelimit:ip:<hash>        # IP rate limits (TTL: 60s)
beta:ratelimit:code:<code>      # Code rate limits (TTL: 1hr)
beta:ratelimit:wallet:<addr>    # Wallet rate limits (TTL: 1hr)
beta:lockout:ip:<hash>          # Brute force lockouts (TTL: 1hr)
beta:metrics:<metric>           # Counters for monitoring
beta:revoked:<hash>             # Revoked tokens
```

## Monitoring

### Health Check
```bash
curl http://localhost:3001/health
```

Response includes `betaGate: "enabled"` or `"disabled"`.

### Metrics
```bash
curl -H "X-Admin-Key: your-admin-key" http://localhost:3001/api/beta/metrics
```

## Scaling Considerations

- All state is in Redis - horizontal scaling works out of the box
- No in-memory state - safe across multiple server instances
- Postgres table is audit-only - not in critical path
- Edge middleware uses local JWT verification (fast)
- Redis operations use pipelining and Lua scripts (atomic)

## Troubleshooting

### "BETA_JWT_SECRET must be set"
Set the environment variable with at least 32 characters.

### "Redis connection failed"
Ensure REDIS_URL is correct and Redis is running.

### User can't access after redemption
Check if cookie is being set (same-site, secure flags for production).

### Code showing as "already used" incorrectly
Check Redis directly: `redis-cli GET beta:code:<CODE>`
