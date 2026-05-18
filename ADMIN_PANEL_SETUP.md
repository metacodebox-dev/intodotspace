# Admin Panel Setup Guide

## Overview
The admin panel allows authorized users to create prediction markets on-chain using the Space Core Solana program.

## Setup Steps

### 1. Generate Program IDL

First, generate the IDL (Interface Definition Language) from your Solana program:

```bash
cd programs/space-core
anchor build
anchor idl parse -f src/lib.rs -o ../../frontend/src/idl/space_core.json
```

### 2. Update Program ID

Update the program ID in `frontend/src/utils/solana.ts`:

```typescript
export const SPACE_CORE_PROGRAM_ID = new PublicKey('YOUR_DEPLOYED_PROGRAM_ID');
```

### 3. Update USDC Mint

Update the USDC mint address in `frontend/src/utils/solana.ts`:

```typescript
// Mainnet USDC
export const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

// Or Devnet USDC
export const USDC_MINT = new PublicKey('4zMMC9srt5Ri5X14GAgXhaHii3GnPAEERYPJgZJDncDU');
```

### 4. Set Admin Public Key

Create a `.env.local` file in the frontend directory:

```env
NEXT_PUBLIC_ADMIN_PUBKEY=YOUR_ADMIN_WALLET_PUBLIC_KEY
NEXT_PUBLIC_PROGRAM_ID=YOUR_PROGRAM_ID
NEXT_PUBLIC_USDC_MINT=YOUR_USDC_MINT
```

### 5. Install Dependencies

```bash
cd frontend
npm install @coral-xyz/anchor @solana/spl-token
```

### 6. Update useSpaceProgram Hook

Once you have the IDL, update `frontend/src/hooks/useSpaceProgram.ts` to use the actual Anchor program:

```typescript
import { loadIDL } from '@/utils/idl-loader';
import { Program } from '@coral-xyz/anchor';

// In the hook:
const [idl, setIdl] = useState<any>(null);

useEffect(() => {
  loadIDL().then(setIdl);
}, []);

const program = useMemo(() => {
  if (!provider || !idl) return null;
  return new Program(idl, SPACE_CORE_PROGRAM_ID, provider);
}, [provider, idl]);

// Then use program.methods.initializeMarket() in createMarket
```

## Usage

1. Connect your admin wallet
2. Navigate to `/admin/create-market`
3. Fill in the market details:
   - Title and description
   - Category
   - End date
   - Outcomes (2-10)
   - Initial liquidity per outcome (minimum 5000 USDC)
4. Click "Create Market"
5. Approve the transaction in your wallet
6. Wait for confirmation

## Market Creation Requirements

- **Minimum Liquidity**: 5,000 USDC per outcome
- **Outcomes**: 2-10 outcomes required
- **End Date**: Must be in the future
- **Total Cost**: Initial liquidity × number of outcomes

Example: Creating a market with 2 outcomes and 5,000 USDC per outcome requires 10,000 USDC total.

## Integration with Leverage System

The created markets automatically support:
- Leverage trading (up to 10x)
- Position management
- Automatic liquidation
- Share minting/burning

All leverage functionality is handled by the Solana program instructions:
- `mint_shares` - Open positions with leverage
- `burn_shares` - Close positions
- `liquidate_position` - Liquidate undercollateralized positions

## Security Notes

- Only wallets in the admin list can create markets
- Market creation requires sufficient USDC balance
- All transactions are on-chain and verifiable
- Market parameters cannot be changed after creation



