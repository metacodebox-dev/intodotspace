// ============================================================================
// SOLANA PLAYGROUND: Execute Matched Orders
// Copy and paste this entire file into Solana Playground
// ============================================================================

import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';
import { BN } from '@coral-xyz/anchor';
import { 
  getAssociatedTokenAddress, 
  createAssociatedTokenAccountInstruction,
  ASSOCIATED_TOKEN_PROGRAM_ID 
} from '@solana/spl-token';

// ============================================================================
// CONFIGURATION - REPLACE THESE VALUES
// ============================================================================

const PROGRAM_ID = new PublicKey('6e92wMrut8NyK6k4N8dnsUGzAVPdzMYwzqsv3gYccGv8');
const TOKEN_PROGRAM_ID = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');

// ✅ ORDER DATA FROM YOUR MATCHED ORDERS
const MARKET_PDA = new PublicKey('6tf8ZkLR2osE63S114cqdsyVccJiynDkwQ9aY6XkpT8y');
const BUY_ORDER_USER = new PublicKey('6VkKsE4eLKBGDeYwxDHMvq5mZpTkW2BKLKj48eBB9WmE');
const SELL_ORDER_USER = new PublicKey('6VkKsE4eLKBGDeYwxDHMvq5mZpTkW2BKLKj48eBB9WmE'); // Same user
const BUY_ORDER_ID = 1768585492;  // Buy order ID
const SELL_ORDER_ID = 1768585429; // Sell order ID
const OUTCOME_ID = 0;              // Outcome ID

// Actual on-chain order addresses (from your JSON data)
const BUY_ORDER_PDA = new PublicKey('GupKL5vvv4ni1vo1fRwPA6ycvwBo9KkgCPCMNk3u8mkn');
const SELL_ORDER_PDA = new PublicKey('5SfbdNz9s2wNnMp1intV86NpQudbBqQwuKN2u8AY72jY');

// Match parameters - both orders at 5000 (50%), so match at 5000
// YES + NO = 1 USDC always, so at 50% price, both are worth 0.5 USDC each
const MATCH_PRICE = 5000;      // 50% in basis points (matches both orders)
const MATCH_QUANTITY = 1000000; // 1 USDC in lamports (1,000,000 = 1 USDC)

// ============================================================================
// PDA HELPER FUNCTIONS
// ============================================================================

function u64ToLeBytes(value: number): Buffer {
  const bytes = Buffer.alloc(8);
  let num = BigInt(value);
  for (let i = 0; i < 8; i++) {
    bytes[i] = Number(num & BigInt(0xff));
    num = num >> BigInt(8);
  }
  return bytes;
}

function getConfigPDA(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('config')],
    PROGRAM_ID
  );
}

function getMarketVaultPDA(market: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), market.toBuffer()],
    PROGRAM_ID
  );
}

function getVaultAuthorityPDA(market: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault_authority'), market.toBuffer()],
    PROGRAM_ID
  );
}

function getMintAuthorityPDA(market: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('mint_authority'), market.toBuffer()],
    PROGRAM_ID
  );
}

function getPendingOrderPDA(user: PublicKey, orderId: number): [PublicKey, number] {
  const orderIdBytes = u64ToLeBytes(orderId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('order'), user.toBuffer(), orderIdBytes],
    PROGRAM_ID
  );
}

function getOrderEscrowPDA(user: PublicKey, orderId: number): [PublicKey, number] {
  const orderIdBytes = u64ToLeBytes(orderId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('order_escrow'), user.toBuffer(), orderIdBytes],
    PROGRAM_ID
  );
}

function getOrderEscrowAuthorityPDA(user: PublicKey, orderId: number): [PublicKey, number] {
  const orderIdBytes = u64ToLeBytes(orderId);
  return PublicKey.findProgramAddressSync(
    [Buffer.from('order_escrow_authority'), user.toBuffer(), orderIdBytes],
    PROGRAM_ID
  );
}

function getYesMintPDA(market: PublicKey, outcomeId: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('yes_mint'), market.toBuffer(), Buffer.from([outcomeId])],
    PROGRAM_ID
  );
}

function getNoMintPDA(market: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('no_mint'), market.toBuffer()],
    PROGRAM_ID
  );
}

function getPositionPDA(market: PublicKey, user: PublicKey, outcomeId: number, side: number): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('position'),
      user.toBuffer(),
      market.toBuffer(),
      Buffer.from([outcomeId]),
      Buffer.from([side])
    ],
    PROGRAM_ID
  );
}

function getMatchStatePDA(market: PublicKey, buyOrderId: number, sellOrderId: number): [PublicKey, number] {
  const buyOrderIdBytes = u64ToLeBytes(buyOrderId);
  const sellOrderIdBytes = u64ToLeBytes(sellOrderId);
  return PublicKey.findProgramAddressSync(
    [
      Buffer.from('match'),
      market.toBuffer(),
      buyOrderIdBytes,
      sellOrderIdBytes
    ],
    PROGRAM_ID
  );
}

// Helper to create ATA if it doesn't exist
async function ensureATAExists(
  connection: any,
  payer: PublicKey,
  mint: PublicKey,
  owner: PublicKey,
  ataAddress: PublicKey
): Promise<boolean> {
  const account = await connection.getAccountInfo(ataAddress);
  if (account === null) {
    console.log(`  Creating ATA for mint ${mint.toString().slice(0, 8)}... for owner ${owner.toString().slice(0, 8)}...`);
    
    const ix = createAssociatedTokenAccountInstruction(
      payer,           // payer
      ataAddress,      // ata address
      owner,           // owner
      mint,            // mint
      TOKEN_PROGRAM_ID,
      ASSOCIATED_TOKEN_PROGRAM_ID
    );
    
    const tx = new Transaction().add(ix);
    // @ts-ignore
    const sig = await pg.connection.sendTransaction(tx, [pg.wallet.keypair]);
    // @ts-ignore
    await pg.connection.confirmTransaction(sig);
    console.log(`  ✅ ATA created: ${ataAddress.toString()}`);
    return true;
  }
  return false;
}

// ============================================================================
// MAIN EXECUTION
// ============================================================================

async function executeMatchedOrders() {
  console.log('🚀 Starting order execution...\n');

  // Derive Config PDA
  const [configPDA] = getConfigPDA();
  console.log('✅ Config PDA:', configPDA.toString());

  // Derive Market PDAs
  const [marketVaultPDA] = getMarketVaultPDA(MARKET_PDA);
  const [vaultAuthorityPDA] = getVaultAuthorityPDA(MARKET_PDA);
  const [mintAuthorityPDA] = getMintAuthorityPDA(MARKET_PDA);
  console.log('✅ Market Vault:', marketVaultPDA.toString());
  console.log('✅ Vault Authority:', vaultAuthorityPDA.toString());
  console.log('✅ Mint Authority:', mintAuthorityPDA.toString());

  // Use actual order PDAs from on-chain data
  const buyOrderPDA = BUY_ORDER_PDA;
  const sellOrderPDA = SELL_ORDER_PDA;
  
  // Derive escrow and other PDAs using order IDs
  const [buyOrderEscrowPDA] = getOrderEscrowPDA(BUY_ORDER_USER, BUY_ORDER_ID);
  const [buyOrderEscrowAuthorityPDA] = getOrderEscrowAuthorityPDA(BUY_ORDER_USER, BUY_ORDER_ID);
  const [buyYesMintPDA] = getYesMintPDA(MARKET_PDA, OUTCOME_ID);
  const [buyNoMintPDA] = getNoMintPDA(MARKET_PDA);
  const [buyPositionPDA] = getPositionPDA(MARKET_PDA, BUY_ORDER_USER, OUTCOME_ID, 0);
  
  console.log('\n📦 Buy Order PDAs:');
  console.log('  Buy Order (on-chain):', buyOrderPDA.toString());
  console.log('  Buy Escrow:', buyOrderEscrowPDA.toString());
  console.log('  Buy Escrow Authority:', buyOrderEscrowAuthorityPDA.toString());
  console.log('  Buy YES Mint:', buyYesMintPDA.toString());
  console.log('  Buy NO Mint:', buyNoMintPDA.toString());
  console.log('  Buy Position:', buyPositionPDA.toString());

  // Derive Sell Order PDAs
  const [sellOrderEscrowPDA] = getOrderEscrowPDA(SELL_ORDER_USER, SELL_ORDER_ID);
  const [sellOrderEscrowAuthorityPDA] = getOrderEscrowAuthorityPDA(SELL_ORDER_USER, SELL_ORDER_ID);
  const [sellYesMintPDA] = getYesMintPDA(MARKET_PDA, OUTCOME_ID);
  const [sellNoMintPDA] = getNoMintPDA(MARKET_PDA);
  const [sellPositionPDA] = getPositionPDA(MARKET_PDA, SELL_ORDER_USER, OUTCOME_ID, 1);
  
  console.log('\n📦 Sell Order PDAs:');
  console.log('  Sell Order (on-chain):', sellOrderPDA.toString());
  console.log('  Sell Escrow:', sellOrderEscrowPDA.toString());
  console.log('  Sell Escrow Authority:', sellOrderEscrowAuthorityPDA.toString());
  console.log('  Sell YES Mint:', sellYesMintPDA.toString());
  console.log('  Sell NO Mint:', sellNoMintPDA.toString());
  console.log('  Sell Position:', sellPositionPDA.toString());

  // Get Associated Token Accounts (ATAs)
  const buyUserYesATA = await getAssociatedTokenAddress(buyYesMintPDA, BUY_ORDER_USER);
  const buyUserNoATA = await getAssociatedTokenAddress(buyNoMintPDA, BUY_ORDER_USER);
  const sellUserYesATA = await getAssociatedTokenAddress(sellYesMintPDA, SELL_ORDER_USER);
  const sellUserNoATA = await getAssociatedTokenAddress(sellNoMintPDA, SELL_ORDER_USER);
  
  console.log('\n💳 Token Accounts:');
  console.log('  Buy User YES ATA:', buyUserYesATA.toString());
  console.log('  Buy User NO ATA:', buyUserNoATA.toString());
  console.log('  Sell User YES ATA:', sellUserYesATA.toString());
  console.log('  Sell User NO ATA:', sellUserNoATA.toString());

  // Keeper (your wallet) - pg is a Solana Playground global
  // @ts-ignore - pg is available in Solana Playground environment
  const keeper = pg.wallet.publicKey;
  console.log('\n👤 Keeper:', keeper.toString());

  // Derive Match State PDA
  const [matchStatePDA] = getMatchStatePDA(MARKET_PDA, BUY_ORDER_ID, SELL_ORDER_ID);
  console.log('\n📋 Match State PDA:', matchStatePDA.toString());

  // Check if match state already exists (Step 1 already completed)
  // @ts-ignore - pg is available in Solana Playground environment
  const matchStateAccount = await pg.connection.getAccountInfo(matchStatePDA);
  const skipStep1 = matchStateAccount !== null;
  
  if (skipStep1) {
    console.log('\n⏭️  Match state already exists - skipping Step 1 (already validated)');
  }

  // Execute the transaction in 3 steps (to avoid BPF stack overflow)
  console.log('\n  Buy Order ID:', BUY_ORDER_ID);
  console.log('  Sell Order ID:', SELL_ORDER_ID);
  console.log('  Match Price:', MATCH_PRICE, 'basis points (', (MATCH_PRICE / 100).toFixed(2), '%)');
  console.log('  Match Quantity:', MATCH_QUANTITY, 'lamports (', (MATCH_QUANTITY / 1000000).toFixed(2), 'USDC)');

  try {
    let validateTx = 'skipped';
    
    // Step 1: Validate match (only if not already done)
    if (!skipStep1) {
      console.log('\n⚡ Step 1: Validating match and creating match state...');
      // @ts-ignore - pg is available in Solana Playground environment
      validateTx = await pg.program.methods
        .validateMatch(
          new BN(BUY_ORDER_ID),
          new BN(SELL_ORDER_ID),
          new BN(MATCH_PRICE),
          new BN(MATCH_QUANTITY)
        )
        .accounts({
          market: MARKET_PDA,
          config: configPDA,
          buyOrder: buyOrderPDA,
          sellOrder: sellOrderPDA,
          keeper: keeper,
          matchState: matchStatePDA,
          systemProgram: SystemProgram.programId,
        })
        .rpc();

      console.log('\n✅ Step 1 SUCCESS! Validation transaction:', validateTx);
      console.log('🔗 View on Solana Explorer:', `https://explorer.solana.com/tx/${validateTx}?cluster=devnet`);
    }

    // Ensure ATAs exist before execution
    console.log('\n🔧 Ensuring token accounts exist...');
    // @ts-ignore
    await ensureATAExists(pg.connection, keeper, buyYesMintPDA, BUY_ORDER_USER, buyUserYesATA);
    // @ts-ignore
    await ensureATAExists(pg.connection, keeper, buyNoMintPDA, BUY_ORDER_USER, buyUserNoATA);
    // @ts-ignore
    await ensureATAExists(pg.connection, keeper, sellYesMintPDA, SELL_ORDER_USER, sellUserYesATA);
    // @ts-ignore
    await ensureATAExists(pg.connection, keeper, sellNoMintPDA, SELL_ORDER_USER, sellUserNoATA);
    console.log('✅ All token accounts ready');

    // Step 2: Execute buyer side (mint YES, transfer escrow, update position)
    console.log('\n⚡ Step 2: Executing buyer side...');
    // @ts-ignore - pg is available in Solana Playground environment
    const buyerTx = await pg.program.methods
      .executeBuyerMatch()
      .accounts({
        market: MARKET_PDA,
        matchState: matchStatePDA,
        buyOrder: buyOrderPDA,
        keeper: keeper,
        buyOrderEscrowAuthority: buyOrderEscrowAuthorityPDA,
        buyOrderEscrow: buyOrderEscrowPDA,
        yesMint: buyYesMintPDA,
        buyUserYesAccount: buyUserYesATA,
        buyPosition: buyPositionPDA,
        marketVault: marketVaultPDA,
        mintAuthority: mintAuthorityPDA,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log('\n✅ Step 2 SUCCESS! Buyer execution transaction:', buyerTx);
    console.log('🔗 View on Solana Explorer:', `https://explorer.solana.com/tx/${buyerTx}?cluster=devnet`);

    // Step 3: Execute seller side (mint NO, update position, finalize)
    console.log('\n⚡ Step 3: Executing seller side...');
    // @ts-ignore - pg is available in Solana Playground environment
    const sellerTx = await pg.program.methods
      .executeSellerMatch()
      .accounts({
        market: MARKET_PDA,
        matchState: matchStatePDA,
        sellOrder: sellOrderPDA,
        keeper: keeper,
        noMint: sellNoMintPDA,
        sellUserNoAccount: sellUserNoATA,
        sellPosition: sellPositionPDA,
        mintAuthority: mintAuthorityPDA,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log('\n✅ Step 3 SUCCESS! Seller execution transaction:', sellerTx);
    console.log('🔗 View on Solana Explorer:', `https://explorer.solana.com/tx/${sellerTx}?cluster=devnet`);
    
    console.log('\n🎉 ORDER EXECUTION COMPLETE!');
    console.log('📊 Summary:');
    console.log('  - Buyer received YES tokens');
    console.log('  - Seller received NO tokens');
    console.log('  - USDC transferred to market vault');
    console.log('  - Positions updated for both parties');
    
    return { validateTx, buyerTx, sellerTx };
  } catch (error: any) {
    console.error('\n❌ ERROR:', error.message);
    console.error('Full error:', error);
    throw error;
  }
}

// Run the function
executeMatchedOrders();

