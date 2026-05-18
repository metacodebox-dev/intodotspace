# Backend Setup Guide

## Database Configuration

The backend uses PostgreSQL to store market data. The database connection is configured in `src/config/database.ts`.

### Environment Variables

Create a `.env` file in the `backend` directory:

```env
DATABASE_URL=postgresql://postgres:AaaeernZwRwSDwftrGvRbKekXhTIPMdA@trolley.proxy.rlwy.net:23221/railway
SOLANA_RPC_URL=https://api.devnet.solana.com
SPACE_CORE_PROGRAM_ID=B53gQMtDZfdXxCw2CH5DESwY5Nuz3sB8wtG2Yfy1KKDB
PORT=3001
NODE_ENV=development
KEEPER_KEYPAIR=
```

## Installation

```bash
cd backend
npm install
```

## Database Setup

The database tables will be created automatically when you start the server. The `Market` model will create the `markets` table.

## Running the Server

```bash
# Development mode
npm run dev

# Production mode
npm run build
npm start
```

## API Endpoints

### Get All Markets
```
GET /api/markets?category=crypto&status=0&limit=50&offset=0
```

### Get Market by ID
```
GET /api/markets/:marketId
```
Supports:
- Market address (Solana PDA)
- Market ID (deterministic u64)
- Database ID

### Create Market
```
POST /api/markets
Body:
{
  "marketAddress": "string",
  "marketId": "string",
  "creator": "string",
  "title": "string",
  "description": "string",
  "category": "crypto" | "politics" | "sports" | "technology" | "economics" | "culture",
  "endDate": "ISO datetime string",
  "outcomes": ["string"],
  "initialCollateral": "string" (optional)
}
```

### Sync Market from Blockchain
```
POST /api/markets/:marketAddress/sync
```

### Get Orderbook
```
GET /api/markets/:marketId/orderbook?outcomeId=0
```

### Resolve Market
```
POST /api/markets/:marketId/resolve
Body:
{
  "outcomeId": "string",
  "resolutionSource": "string"
}
```

## Database Schema

### Markets Table

- `id` - Primary key (auto-increment)
- `marketAddress` - Solana PDA address (unique)
- `marketId` - Deterministic market ID (u64 as string)
- `creator` - Creator's Solana public key
- `title` - Market title
- `description` - Market description
- `category` - Category number (0-5)
- `status` - Market status (0=Active, 1=Resolving, 2=Disputed, 3=Finalized, 4=Closed)
- `endDate` - Market end date
- `outcomes` - JSON string of MarketOutcome array
- `totalVolume`, `totalCollateral`, etc. - BN values as strings
- `onChainCreatedAt` - When market was created on-chain
- `lastSyncedAt` - Last sync time from blockchain

## Integration with Frontend

After creating a market on-chain in the frontend, call the backend API to store it:

```typescript
// After successful on-chain market creation
const response = await fetch('http://localhost:3001/api/markets', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    marketAddress: marketPDA.toString(),
    marketId: marketId.toString(),
    creator: wallet.publicKey.toString(),
    title: params.title,
    description: params.description,
    category: params.category,
    endDate: params.endDate.toISOString(),
    outcomes: params.outcomes,
    initialCollateral: initialCollateral.toString(),
  }),
});
```


