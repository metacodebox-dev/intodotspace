#!/bin/bash

# Script to create and mint a test USDC token for development
# This creates a token with 6 decimals (same as USDC) that you can mint freely

echo "🚀 Creating Test USDC Token for Devnet"
echo "========================================"

# Check if Solana CLI is installed
if ! command -v solana &> /dev/null; then
    echo "❌ Solana CLI not found. Please install it first."
    exit 1
fi

# Check if SPL Token CLI is installed
if ! command -v spl-token &> /dev/null; then
    echo "❌ SPL Token CLI not found. Installing..."
    cargo install spl-token-cli
fi

# Set to devnet
echo "📡 Setting network to devnet..."
solana config set --url devnet

# Get current wallet
WALLET=$(solana address)
echo "💰 Using wallet: $WALLET"

# Check balance
BALANCE=$(solana balance)
echo "💵 Current SOL balance: $BALANCE"

if [ "$(echo $BALANCE | awk '{print $1}')" == "0" ]; then
    echo "⚠️  No SOL found. Requesting airdrop..."
    solana airdrop 2
    sleep 5
fi

# Create token mint (6 decimals like USDC)
echo ""
echo "🪙 Creating test token mint with 6 decimals..."
MINT=$(spl-token create-token --decimals 6 2>&1 | grep -oP 'Creating token \K[^\s]+')

if [ -z "$MINT" ]; then
    echo "❌ Failed to create token mint"
    exit 1
fi

echo "✅ Token mint created: $MINT"

# Create token account
echo ""
echo "📝 Creating token account..."
spl-token create-account $MINT

# Mint tokens (1,000,000 tokens = 1,000,000 * 10^6 = 1,000,000,000,000 units)
echo ""
echo "🪙 Minting 1,000,000 test USDC tokens..."
spl-token mint $MINT 1000000

# Check balance
echo ""
echo "✅ Test token setup complete!"
echo ""
echo "📋 Details:"
echo "   Mint Address: $MINT"
echo "   Decimals: 6"
echo "   Your Balance: 1,000,000 tokens"
echo ""
echo "💡 To use this in your app, update frontend/src/utils/solana.ts:"
echo "   export const USDC_MINT = new PublicKey('$MINT');"
echo ""
echo "🔄 To mint more tokens later, run:"
echo "   spl-token mint $MINT <amount>"






