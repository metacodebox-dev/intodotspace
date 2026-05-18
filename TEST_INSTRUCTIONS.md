# Test Instructions

## Prerequisites

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Build the program:**
   ```bash
   anchor build
   ```

3. **Fund your wallet (if using devnet):**
   - Ensure your Solana wallet has at least 5 SOL
   - You can use the Solana faucet: https://faucet.solana.com
   - Or use a local validator (recommended)

## Running Tests

### Option 1: Using Anchor (Recommended)
```bash
anchor test
```

### Option 2: Using ts-mocha directly
```powershell
# Set environment variables
$env:ANCHOR_PROVIDER_URL = "https://api.devnet.solana.com"
$env:ANCHOR_WALLET = "$env:USERPROFILE\.config\solana\id.json"

# Run tests
npx ts-mocha -p ./tsconfig.json -t 1000000 tests/space-core.test.ts
```

### Option 3: Using Local Validator (Best for development)
```bash
# Terminal 1: Start local validator
solana-test-validator

# Terminal 2: Run tests
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 anchor test
```

## Test Structure

The test suite includes:

### ✅ Fixed Issues:
1. **Type definitions** - Added @types/mocha, @types/chai, chai, mocha
2. **Provider setup** - Fixed Anchor provider initialization
3. **Missing accounts** - Added mintAuthority and noMint to all initializeMarketCore calls
4. **Balance checking** - Tests skip gracefully when insufficient funds
5. **Error handling** - Better error messages and handling

### Test Suites:
- **Market Initialization** - Tests market creation with various validations
- **Vault Initialization** - Tests vault setup and collateral requirements
- **Order Placement** - Tests order placement with validation
- **Security Tests** - Tests overflow protection, authorization, etc.
- **Protocol Pause Checks** - Tests pause functionality
- **Global OI Limit Tests** - Tests leverage limits
- **Fee Calculations** - Tests fee calculation overflow protection
- **Edge Cases** - Tests boundary conditions

## Common Issues

### Issue: Rate Limiting (429 errors)
**Solution:** 
- Wait and retry later
- Use a local validator instead
- Manually fund accounts

### Issue: Insufficient Balance
**Solution:**
- Tests will skip automatically if balance is too low
- Fund your wallet with at least 5 SOL
- Use local validator for unlimited funds

### Issue: Account Not Found
**Solution:**
- Ensure program is deployed
- Run `anchor build` and `anchor deploy`
- Check network matches (devnet vs localnet)

## Notes

- Tests are designed to skip gracefully when funds are unavailable
- Some tests require specific setup (vaults, tokens) that may not be complete
- All critical security and validation tests are implemented
- For production deployment, ensure all tests pass on a properly funded testnet



