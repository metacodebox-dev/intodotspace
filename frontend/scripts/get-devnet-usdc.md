# Getting Devnet USDC

## Quick Options

### Option 1: SolFaucet (Recommended)
1. Visit: https://solfaucet.com/
2. Select **Devnet** network
3. Enter your wallet address
4. Request **USDC** tokens
5. Wait for the airdrop (usually instant)

### Option 2: QuickNode Faucet
1. Visit: https://faucet.quicknode.com/solana/devnet
2. Enter your wallet address
3. Request USDC tokens

### Option 3: Manual Airdrop via CLI
If you have the USDC mint authority, you can mint tokens directly:

```bash
# First, get some SOL from the Solana faucet
solana airdrop 2

# Then mint USDC to your wallet (if you have mint authority)
spl-token mint EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v 1000 <YOUR_WALLET_ADDRESS>
```

## Current Configuration

Your app is configured to use:
- **Network**: Devnet
- **USDC Mint**: `EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v`
- **Decimals**: 6

## Important Notes

1. **Devnet USDC is not real money** - it's only for testing
2. The devnet USDC mint address is the same as mainnet, but on devnet network
3. You need SOL first to pay for transaction fees
4. Some faucets may have rate limits

## Troubleshooting

If faucets don't work:
1. Make sure you're on **Devnet** (not mainnet or testnet)
2. Get SOL first: https://faucet.solana.com/
3. Check your wallet address is correct
4. Try a different faucet






