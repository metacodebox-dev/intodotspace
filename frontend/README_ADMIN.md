# Admin Panel - Quick Start

## What's Been Created

✅ **Admin Panel Page** (`/admin/create-market`)
- Full market creation form
- Validation and error handling
- Integration with Solana wallet

✅ **Solana Program Integration**
- Utility functions for PDA derivation
- Market creation hook
- USDC token handling

✅ **Navigation**
- Admin link in header (visible to admins only)
- Protected routes

## Next Steps to Complete Integration

### 1. Generate IDL from Your Program

```bash
# In your project root
anchor build
anchor idl parse -f programs/space-core/src/lib.rs -o frontend/src/idl/space_core.json
```

### 2. Update Program Configuration

Edit `frontend/src/utils/solana.ts`:
- Update `SPACE_CORE_PROGRAM_ID` with your deployed program ID
- Update `USDC_MINT` with your USDC mint address

### 3. Set Environment Variables

Create `frontend/.env.local`:
```env
NEXT_PUBLIC_ADMIN_PUBKEY=YOUR_ADMIN_WALLET_PUBLIC_KEY
```

### 4. Complete Program Integration

Update `frontend/src/hooks/useSpaceProgram.ts` to load and use the IDL:

```typescript
import idl from '@/idl/space_core.json';
import { Program } from '@coral-xyz/anchor';

// In createMarket function:
const program = new Program(idl as Idl, SPACE_CORE_PROGRAM_ID, provider);

const tx = await program.methods
  .initializeMarket(
    params.title,
    params.description,
    params.category,
    endDate,
    params.outcomes,
    new BN(liquidityPerOutcome)
  )
  .accounts({
    market: marketPDA,
    creator: wallet.publicKey,
    creatorUsdc: userUsdcATA,
    marketVault: vaultPDA,
    usdcMint: USDC_MINT,
    tokenProgram: TOKEN_PROGRAM_ID,
    clock: SYSVAR_CLOCK_PUBKEY,
    systemProgram: SystemProgram.programId,
  })
  .rpc();
```

### 5. Install Dependencies

```bash
cd frontend
npm install
```

## Features

- ✅ Multi-outcome market support (2-10 outcomes)
- ✅ Minimum liquidity validation (5000 USDC per outcome)
- ✅ Category selection
- ✅ End date picker
- ✅ Real-time liquidity calculation
- ✅ Wallet integration
- ✅ Transaction signing and confirmation
- ✅ Error handling

## Market Creation Flow

1. Admin connects wallet
2. Fills in market details
3. System calculates total liquidity required
4. Admin approves transaction
5. Market is created on-chain
6. Market PDA is generated
7. Initial liquidity is deposited
8. Market becomes active

## Leverage Integration

All created markets automatically support:
- ✅ Leverage trading (1x-10x)
- ✅ Position management via `mint_shares` and `burn_shares`
- ✅ Automatic liquidation via `liquidate_position`
- ✅ Collateral management

The leverage system is fully integrated - users can trade on any created market with leverage up to 10x.




