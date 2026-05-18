# Start Solana Test Validator
# This script starts a local Solana validator for testing

Write-Host "Stopping any existing validator processes..."
Get-Process | Where-Object {$_.ProcessName -like "*solana*" -or $_.ProcessName -like "*validator*"} | Stop-Process -Force -ErrorAction SilentlyContinue

Write-Host "Removing old test-ledger directory..."
if (Test-Path "test-ledger") {
    Remove-Item -Recurse -Force "test-ledger" -ErrorAction SilentlyContinue
    Start-Sleep -Seconds 2
}

Write-Host "Starting Solana test validator..."
solana-test-validator --reset --quiet

Write-Host ""
Write-Host "Validator started! You can now run tests in another terminal."
Write-Host "To run tests, use:"
Write-Host "  ANCHOR_PROVIDER_URL=http://127.0.0.1:8899 anchor test"
Write-Host ""
Write-Host "Press Ctrl+C to stop the validator"



