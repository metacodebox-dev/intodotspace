# PowerShell script to create and mint a test USDC token for development
# This creates a token with 6 decimals (same as USDC) that you can mint freely

Write-Host "🚀 Creating Test USDC Token for Devnet" -ForegroundColor Cyan
Write-Host "========================================" -ForegroundColor Cyan
Write-Host ""

# Check if Solana CLI is installed
$solanaExists = Get-Command solana -ErrorAction SilentlyContinue
if (-not $solanaExists) {
    Write-Host "❌ Solana CLI not found. Please install it first." -ForegroundColor Red
    exit 1
}

# Check if SPL Token CLI is installed
$splTokenExists = Get-Command spl-token -ErrorAction SilentlyContinue
if (-not $splTokenExists) {
    Write-Host "❌ SPL Token CLI not found. Please install it:" -ForegroundColor Red
    Write-Host "   cargo install spl-token-cli" -ForegroundColor Yellow
    exit 1
}

# Set to devnet
Write-Host "📡 Setting network to devnet..." -ForegroundColor Yellow
solana config set --url devnet

# Get current wallet
$wallet = solana address
Write-Host "💰 Using wallet: $wallet" -ForegroundColor Green

# Check balance
$balanceOutput = solana balance
Write-Host "💵 Current SOL balance: $balanceOutput" -ForegroundColor Green

$balanceValue = ($balanceOutput -split ' ')[0]
if ($balanceValue -eq "0" -or $balanceValue -eq "") {
    Write-Host "⚠️  No SOL found. Requesting airdrop..." -ForegroundColor Yellow
    solana airdrop 2
    Start-Sleep -Seconds 5
}

# Create token mint (6 decimals like USDC)
Write-Host ""
Write-Host "🪙 Creating test token mint with 6 decimals..." -ForegroundColor Yellow
$mintOutput = spl-token create-token --decimals 6 2>&1
$mint = ($mintOutput | Select-String -Pattern 'Creating token (\S+)').Matches.Groups[1].Value

if (-not $mint) {
    Write-Host "❌ Failed to create token mint" -ForegroundColor Red
    Write-Host "Output: $mintOutput" -ForegroundColor Red
    exit 1
}

Write-Host "✅ Token mint created: $mint" -ForegroundColor Green

# Create token account
Write-Host ""
Write-Host "📝 Creating token account..." -ForegroundColor Yellow
spl-token create-account $mint

# Mint tokens (1,000,000 tokens = 1,000,000 * 10^6 = 1,000,000,000,000 units)
Write-Host ""
Write-Host "🪙 Minting 1,000,000 test USDC tokens..." -ForegroundColor Yellow
spl-token mint $mint 1000000

# Check balance
Write-Host ""
Write-Host "✅ Test token setup complete!" -ForegroundColor Green
Write-Host ""
Write-Host "📋 Details:" -ForegroundColor Cyan
Write-Host "   Mint Address: $mint" -ForegroundColor White
Write-Host "   Decimals: 6" -ForegroundColor White
Write-Host "   Your Balance: 1,000,000 tokens" -ForegroundColor White
Write-Host ""
Write-Host "💡 To use this in your app, update frontend/src/utils/solana.ts:" -ForegroundColor Yellow
Write-Host "   export const USDC_MINT = new PublicKey('$mint');" -ForegroundColor White
Write-Host ""
Write-Host "🔄 To mint more tokens later, run:" -ForegroundColor Yellow
Write-Host "   spl-token mint $mint <amount>" -ForegroundColor White






