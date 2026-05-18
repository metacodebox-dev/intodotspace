# Utility Scripts

This directory contains utility scripts for setting up and managing the Space Prediction platform.

## Scripts Available

### 1. Test USDC Token Setup
Create your own test USDC token for development.

### 2. Keeper Keypair Generator
Generate a keypair for the keeper service (automatic order execution).

---

## Keeper Keypair Generator

Generate a keypair for the keeper service that automatically executes matched orders.

### Quick Start

```bash
node scripts/generate-keeper-keypair.js
```

This will:
1. Generate a new keypair
2. Save it to `keeper-keypair.json`
3. Display the public key and environment variable format

### After Generation

1. **Add to .env file:**
   ```bash
   KEEPER_KEYPAIR='[123,45,67,...]'
   ```

2. **Fund the keypair with SOL:**
   ```bash
   solana transfer <keeper-public-key> 0.1 --allow-unfunded-recipient
   ```

3. **Restart backend** to enable keeper service

### Important Notes

- ⚠️ **This is DIFFERENT from your program deployer keypair**
- The keeper keypair is used for automatic order execution
- It needs SOL balance for transaction fees
- Keep it secure but it can be on the server

See `KEEPER_KEYPAIR_EXPLANATION.md` for more details.

---

## Test Token Setup Scripts

These scripts help you create your own test USDC token for development, which you can mint freely.

## Quick Start

### Option 1: Using PowerShell (Windows) - Recommended
```powershell
cd scripts
.\create-test-usdc.ps1
```

### Option 2: Using Bash (Linux/Mac)
```bash
chmod +x scripts/create-test-usdc.sh
./scripts/create-test-usdc.sh
```

### Option 3: Using Node.js
```bash
# Method 1: Use Solana CLI config (default)
node scripts/create-test-usdc.js

# Method 2: Pass keypair path as argument
node scripts/create-test-usdc.js /path/to/your/keypair.json

# Method 3: Use environment variable
# PowerShell:
$env:SOLANA_KEYPAIR_PATH="C:\path\to\keypair.json"
node scripts/create-test-usdc.js

# Bash:
export SOLANA_KEYPAIR_PATH="/path/to/keypair.json"
node scripts/create-test-usdc.js
```

## What These Scripts Do

1. ✅ Check if you have SOL (request airdrop if needed)
2. ✅ Create a new token mint with 6 decimals (same as USDC)
3. ✅ Create a token account for your wallet
4. ✅ Mint 1,000,000 test tokens to your wallet
5. ✅ Display the mint address to update in your code

## After Running the Script

1. Copy the mint address from the output
2. Update `frontend/src/utils/solana.ts`:
   ```typescript
   export const USDC_MINT = new PublicKey('YOUR_MINT_ADDRESS_HERE');
   ```

## Minting More Tokens

After creating the token, you can mint more anytime:

```bash
# Using SPL Token CLI
spl-token mint <MINT_ADDRESS> <AMOUNT>

# Example: Mint 100,000 more tokens
spl-token mint YOUR_MINT_ADDRESS 100000
```

## Requirements

- Solana CLI installed (`solana --version`)
- SPL Token CLI installed (`spl-token --version`)
  - Install with: `cargo install spl-token-cli`
- Node.js (for the JS script)
- Your Solana wallet configured (`solana config get`)

## Troubleshooting

### "Could not load keypair" Error

If you get this error with the Node.js script, try:

1. **Pass keypair path directly:**
   ```bash
   node scripts/create-test-usdc.js ~/.config/solana/id.json
   ```

2. **Use environment variable:**
   ```powershell
   # PowerShell
   $env:SOLANA_KEYPAIR_PATH="C:\Users\YourName\.config\solana\id.json"
   node scripts/create-test-usdc.js
   ```

3. **Use PowerShell or Bash scripts instead** (they handle keypair loading automatically)

4. **Create a new keypair:**
   ```bash
   solana-keygen new
   solana config set --url devnet
   ```

## Notes

- This creates a **test token** - not real USDC
- You have full control over minting
- The token has 6 decimals (same as USDC)
- Works on devnet only
- You can mint unlimited amounts for testing

