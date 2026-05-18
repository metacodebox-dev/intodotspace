# Set Anchor environment variables for Windows PowerShell
$env:ANCHOR_PROVIDER_URL = "https://api.devnet.solana.com"
$env:ANCHOR_WALLET = "$env:USERPROFILE\.config\solana\id.json"

# Run tests
npx ts-mocha -p ./tsconfig.json -t 1000000 tests/space-core.test.ts



