/**
 * Script to manually test liquidations
 * 
 * Usage:
 *   npm run test-liquidation <marketPDA> <positionPDA> [userId]
 * 
 * Example:
 *   npm run test-liquidation 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU 5i7btbTRDYqmhhSiEZgR4X3BAS7BgbNTgMHPT8a7Bnxr
 */

import dotenv from 'dotenv';
dotenv.config();

import { PublicKey } from '@solana/web3.js';
import { LiquidationExecutorService } from '../services/liquidationExecutorService';

async function main() {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.error('Usage: npm run test-liquidation <marketPDA> <positionPDA> [userId]');
    console.error('');
    console.error('Arguments:');
    console.error('  marketPDA   - Market public key');
    console.error('  positionPDA - Position public key');
    console.error('  userId      - User wallet address (optional - will be fetched from position if not provided)');
    console.error('');
    console.error('Example:');
    console.error('  npm run test-liquidation 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU 5i7btbTRDYqmhhSiEZgR4X3BAS7BgbNTgMHPT8a7Bnxr');
    console.error('');
    console.error('Note: userId is the wallet address of the position owner. It will be automatically');
    console.error('      fetched from the position account if not provided.');
    process.exit(1);
  }

  const marketPDA = new PublicKey(args[0]);
  const positionPDA = new PublicKey(args[1]);
  let userId = args[2]; // Optional - will be fetched from position if not provided

  console.log('=== Liquidation Test ===');
  console.log(`Market: ${marketPDA.toString()}`);
  console.log(`Position: ${positionPDA.toString()}`);
  
  // Fetch userId from position if not provided
  if (!userId) {
    try {
      const { Connection, Keypair } = await import('@solana/web3.js');
      const { Program } = await import('@coral-xyz/anchor');
      const { loadIDL } = await import('../utils/idl-loader');
      const { AnchorProvider } = await import('@coral-xyz/anchor');
      const { SPACE_CORE_PROGRAM_ID } = await import('../utils/solana');
      
      const connection = new Connection(
        process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
        {
          commitment: 'confirmed',
          wsEndpoint: process.env.SOLANA_WS_URL,
          confirmTransactionInitialTimeout: 60000,
        }
      );
      const idl = await loadIDL();
      const dummyKeypair = Keypair.generate();
      const provider = new AnchorProvider(
        connection,
        { publicKey: dummyKeypair.publicKey } as any,
        {}
      );
      const program = new Program(idl as any, provider);
      
      const positionData: any = await (program.account as any).position.fetch(positionPDA);
      userId = positionData.user.toString();
      console.log(`User (from position): ${userId}`);
    } catch (error: any) {
      console.warn(`Could not fetch userId from position: ${error.message}`);
      userId = 'unknown';
      console.log(`User: ${userId} (using placeholder)`);
    }
  } else {
    console.log(`User: ${userId}`);
  }
  console.log('');

  const executor = new LiquidationExecutorService();
  
  // Initialize
  console.log('Initializing liquidation executor...');
  const initialized = await executor.initialize();
  if (!initialized) {
    console.error('Failed to initialize liquidation executor');
    console.error('Make sure LIQUIDATOR_KEYPAIR is set in .env');
    process.exit(1);
  }
  console.log('✓ Initialized');
  console.log('');

  // Fetch and log detailed position information
  console.log('Fetching position details...');
  try {
    const { Connection, Keypair } = await import('@solana/web3.js');
    const { Program } = await import('@coral-xyz/anchor');
    const { loadIDL } = await import('../utils/idl-loader');
    const { AnchorProvider } = await import('@coral-xyz/anchor');
    const { SPACE_CORE_PROGRAM_ID } = await import('../utils/solana');
    
    const connection = new Connection(
      process.env.SOLANA_RPC_URL || 'https://api.devnet.solana.com',
      {
        commitment: 'confirmed',
        wsEndpoint: process.env.SOLANA_WS_URL,
        confirmTransactionInitialTimeout: 60000,
      }
    );
    const idl = await loadIDL();
    const dummyKeypair = Keypair.generate();
    const provider = new AnchorProvider(
      connection,
      { publicKey: dummyKeypair.publicKey } as any,
      {}
    );
    const program = new Program(idl as any, provider);
    
    const positionData: any = await (program.account as any).position.fetch(positionPDA);
    const marketData: any = await (program.account as any).market.fetch(marketPDA);
    
    const currentPrice = marketData.outcomes[positionData.outcomeId].lastPrice;
    const positionValue = (positionData.shares * currentPrice) / 10000;
    const entryValue = (positionData.shares * positionData.avgEntryPrice) / 10000;
    const pnl = positionData.side === 0
      ? positionValue - entryValue
      : entryValue - positionValue;
    const equity = Math.max(0, Number(positionData.collateral) + pnl);
    const maintenanceRequirement = (positionValue * 1000) / 10000; // 10%
    
    console.log('\n=== POSITION DETAILS ===');
    console.log(`Position PDA: ${positionPDA.toString()}`);
    console.log(`User: ${positionData.user.toString()}`);
    console.log(`Market: ${marketData.marketId || marketPDA.toString()}`);
    console.log(`Outcome ID: ${positionData.outcomeId} (${positionData.outcomeId === 0 ? 'YES' : 'NO'})`);
    console.log(`Side: ${positionData.side === 0 ? 'LONG' : 'SHORT'}`);
    console.log(`Leverage: ${positionData.leverage}x`);
    console.log(`Shares: ${positionData.shares.toString()} (${(Number(positionData.shares) / 1e6).toFixed(6)} shares)`);
    console.log(`Collateral: ${positionData.collateral.toString()} lamports (${(Number(positionData.collateral) / 1e6).toFixed(6)} USDC)`);
    console.log(`Borrowed Amount: ${positionData.borrowedAmount.toString()} lamports (${(Number(positionData.borrowedAmount) / 1e6).toFixed(6)} USDC)`);
    console.log(`Avg Entry Price: ${positionData.avgEntryPrice} bps (${(positionData.avgEntryPrice / 100).toFixed(2)}%)`);
    console.log(`Current Price: ${currentPrice} bps (${(currentPrice / 100).toFixed(2)}%)`);
    console.log(`Entry Value: ${(entryValue / 1e6).toFixed(6)} USDC`);
    console.log(`Position Value: ${(positionValue / 1e6).toFixed(6)} USDC`);
    console.log(`PnL: ${(pnl / 1e6).toFixed(6)} USDC (${entryValue > 0 ? ((pnl / entryValue) * 100).toFixed(2) : '0.00'}%)`);
    console.log(`Equity: ${(equity / 1e6).toFixed(6)} USDC`);
    console.log(`Maintenance Requirement: ${(maintenanceRequirement / 1e6).toFixed(6)} USDC (10% of position value)`);
    console.log(`Equity Ratio: ${positionValue > 0 ? ((equity / positionValue) * 100).toFixed(2) : '0.00'}%`);
    console.log(`Liquidation Threshold: ${((maintenanceRequirement / positionValue) * 100).toFixed(2)}%`);
    console.log('========================\n');
  } catch (error: any) {
    console.warn(`Could not fetch detailed position info: ${error.message}`);
  }

  // Check liquidation status
  console.log('Checking liquidation status...');
  const status = await executor.checkPositionLiquidationStatus(marketPDA, positionPDA);
  console.log('\n=== LIQUIDATION STATUS ===');
  console.log(`Is Liquidatable: ${status.isLiquidatable ? 'YES ✓' : 'NO ✗'}`);
  console.log(`Equity: ${(status.equity / 1e6).toFixed(6)} USDC`);
  console.log(`Maintenance Requirement: ${(status.maintenanceRequirement / 1e6).toFixed(6)} USDC`);
  console.log(`Priority: ${status.priority} (higher = more urgent)`);
  console.log(`Reason: ${status.reason}`);
  console.log('==========================\n');

  if (!status.isLiquidatable) {
    console.log('⚠️  Position is NOT liquidatable');
    console.log(`   Reason: ${status.reason}`);
    console.log(`   Equity: ${(status.equity / 1e6).toFixed(6)} USDC`);
    console.log(`   Maintenance Requirement: ${(status.maintenanceRequirement / 1e6).toFixed(6)} USDC`);
    console.log(`   Equity must be < Maintenance Requirement (10% of position value) to be liquidatable`);
    process.exit(0);
  }

  console.log('✓ Position is liquidatable');
  console.log(`   Equity: ${(status.equity / 1e6).toFixed(6)} USDC`);
  console.log(`   Maintenance Requirement: ${(status.maintenanceRequirement / 1e6).toFixed(6)} USDC`);
  console.log(`   Liquidation will liquidate 25% of position`);
  console.log(`   Liquidator reward: 5% of liquidation value`);
  console.log(`   Insurance fund: 5% of liquidation value`);
  console.log('');

  // Execute liquidation
  console.log('Executing liquidation...');
  const result = await executor.executeLiquidation(marketPDA, positionPDA, userId);
  
  if (result.success) {
    console.log('✓ Liquidation executed successfully!');
    console.log(`   Transaction: ${result.tx}`);
    console.log('');
    console.log('Note: This liquidates 25% of the position.');
    console.log('If the position is still liquidatable, run this script again.');
  } else {
    console.error('✗ Liquidation failed');
    console.error(`   Error: ${result.error}`);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});

