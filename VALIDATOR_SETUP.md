# Solana Test Validator Setup

## Problem: "Access is denied" Error

This error occurs when:
1. The `test-ledger` directory is locked by another process
2. Permission issues with the directory
3. A previous validator instance didn't shut down cleanly

## Solutions

### Solution 1: Clean and Restart (Recommended)

```powershell
# Stop any running validators
Get-Process | Where-Object {$_.ProcessName -like "*solana*"} | Stop-Process -Force

# Remove the test-ledger directory
Remove-Item -Recurse -Force test-ledger -ErrorAction SilentlyContinue

# Start validator
solana-test-validator --reset
```

### Solution 2: Use the PowerShell Script

```powershell
.\start-validator.ps1
```

This script will:
- Stop any existing validator processes
- Remove the old test-ledger directory
- Start a fresh validator

### Solution 3: Use a Different Directory

```powershell
solana-test-validator --ledger ./custom-ledger --reset
```

### Solution 4: Run as Administrator

If permission issues persist:
1. Right-click PowerShell
2. Select "Run as Administrator"
3. Run the validator command

## Running Tests with Local Validator

Once the validator is running:

### Option 1: Using Anchor
```bash
ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 anchor test
```

### Option 2: Set Environment Variable
```powershell
$env:ANCHOR_PROVIDER_URL = "http://127.0.0.1:8899"
anchor test
```

### Option 3: Update Anchor.toml
Change the provider cluster to `localnet`:
```toml
[provider]
cluster = "localnet"
wallet = "~/.config/solana/id.json"
```

Then run:
```bash
anchor test
```

## Troubleshooting

### Validator won't start
- Check if port 8899 is already in use: `netstat -ano | findstr :8899`
- Kill any processes using that port
- Try a different port: `solana-test-validator --rpc-port 8898`

### Validator keeps stopping
- Check the log file: `test-ledger/validator.log`
- Ensure you have enough disk space
- Check system resources

### Tests still fail
- Ensure validator is running: `solana cluster-version`
- Check that the validator has SOL: `solana balance`
- Verify the connection: `solana config get`

## Benefits of Local Validator

1. **No rate limits** - Unlimited airdrops
2. **Faster** - Local network is faster than devnet
3. **Deterministic** - Same results every time
4. **Free** - No real SOL needed
5. **Isolated** - Doesn't affect devnet/mainnet



