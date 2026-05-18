/**
 * Script to find all positions for a user wallet
 * 
 * Usage:
 *   npm run find-positions <userWallet>
 * 
 * Example:
 *   npm run find-positions 6ZqWHi2jZK94iRXw8srJD9SEyTzTCRP6TZ8S7VyCNM4D
 */

import dotenv from 'dotenv';
dotenv.config();

import { PublicKey, Connection } from '@solana/web3.js';
import { Program } from '@coral-xyz/anchor';
import { AnchorProvider } from '@coral-xyz/anchor';
import { Keypair } from '@solana/web3.js';
import { loadIDL } from '../utils/idl-loader';
import { SPACE_CORE_PROGRAM_ID } from '../utils/solana';
import { getPositionPDA } from '../utils/solana';

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 1) {
    console.error('Usage: npm run find-positions <userWallet>');
    console.error('');
    console.error('Arguments:');
    console.error('  userWallet - User wallet address');
    console.error('');
    console.error('Example:');
    console.error('  npm run find-positions 6ZqWHi2jZK94iRXw8srJD9SEyTzTCRP6TZ8S7VyCNM4D');
    process.exit(1);
  }

  const userWallet = new PublicKey(args[0]);
  console.log(`\n=== Finding Positions for User ===`);
  console.log(`User Wallet: ${userWallet.toString()}\n`);

  const connection = new Connection(
    process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
    {
      commitment: 'confirmed',
      wsEndpoint: process.env.SOLANA_WS_URL,
      confirmTransactionInitialTimeout: 60000,
    }
  );

  try {
    const idl = await loadIDL();
    const dummyKeypair = Keypair.generate();
    const provider = new AnchorProvider(
      connection,
      { publicKey: dummyKeypair.publicKey } as any,
      {}
    );
    const program = new Program(idl as any, provider);

    // Get all program accounts
    console.log('Searching for positions...');
    const allPositions: any[] = await (program.account as any).position.all();
    
    // Filter by user
    const userPositions = allPositions.filter(
      (pos) => pos.account.user.toString() === userWallet.toString()
    );

    if (userPositions.length === 0) {
      console.log('No positions found for this user.');
      console.log('\nNote: If you know the market PDA, you can derive the position PDA using:');
      console.log('  getPositionPDA(marketPDA, userWallet, outcomeId, side)');
      console.log('  where outcomeId is 0 (YES) or 1 (NO), and side is 0 (LONG) or 1 (SHORT)');
      process.exit(0);
    }

    console.log(`Found ${userPositions.length} position(s):\n`);

    for (let i = 0; i < userPositions.length; i++) {
      const position = userPositions[i];
      const positionData = position.account;
      const marketPDA = positionData.market;
      
      // Fetch market data
      let marketData: any;
      try {
        marketData = await (program.account as any).market.fetch(marketPDA);
      } catch (e) {
        marketData = { marketId: 'unknown' };
      }

      const currentPrice = marketData.outcomes?.[positionData.outcomeId]?.lastPrice || 0;
      const positionValue = (Number(positionData.shares) * currentPrice) / 10000;
      const entryValue = (Number(positionData.shares) * positionData.avgEntryPrice) / 10000;
      const pnl = positionData.side === 0
        ? positionValue - entryValue
        : entryValue - positionValue;
      const equity = Math.max(0, Number(positionData.collateral) + pnl);
      const maintenanceRequirement = (positionValue * 1000) / 10000; // 10%

      console.log(`--- Position ${i + 1} ---`);
      console.log(`Position PDA: ${position.publicKey.toString()}`);
      console.log(`Market PDA: ${marketPDA.toString()}`);
      console.log(`Market ID: ${marketData.marketId || 'unknown'}`);
      console.log(`Outcome ID: ${positionData.outcomeId} (${positionData.outcomeId === 0 ? 'YES' : 'NO'})`);
      console.log(`Side: ${positionData.side === 0 ? 'LONG' : 'SHORT'}`);
      console.log(`Leverage: ${positionData.leverage}x`);
      console.log(`Shares: ${positionData.shares.toString()} (${(Number(positionData.shares) / 1e6).toFixed(6)})`);
      console.log(`Collateral: ${(Number(positionData.collateral) / 1e6).toFixed(6)} USDC`);
      console.log(`Borrowed: ${(Number(positionData.borrowedAmount) / 1e6).toFixed(6)} USDC`);
      console.log(`Entry Price: ${positionData.avgEntryPrice} bps (${(positionData.avgEntryPrice / 100).toFixed(2)}%)`);
      console.log(`Current Price: ${currentPrice} bps (${(currentPrice / 100).toFixed(2)}%)`);
      console.log(`Position Value: ${(positionValue / 1e6).toFixed(6)} USDC`);
      console.log(`PnL: ${(pnl / 1e6).toFixed(6)} USDC`);
      console.log(`Equity: ${(equity / 1e6).toFixed(6)} USDC`);
      console.log(`Maintenance Requirement: ${(maintenanceRequirement / 1e6).toFixed(6)} USDC`);
      console.log(`Equity Ratio: ${positionValue > 0 ? ((equity / positionValue) * 100).toFixed(2) : '0.00'}%`);
      console.log(`Is Liquidatable: ${equity < maintenanceRequirement ? 'YES ✓' : 'NO ✗'}`);
      console.log('');
      console.log(`To test liquidation, run:`);
      console.log(`  npm run test-liquidation ${marketPDA.toString()} ${position.publicKey.toString()} ${userWallet.toString()}`);
      console.log('');
    }

  } catch (error: any) {
    console.error('Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});

