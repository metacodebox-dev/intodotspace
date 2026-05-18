/**
 * Solana Playground Script - Test Leverage Architecture
 * 
 * To use:
 * 1. Go to https://beta.solpg.io/ or https://playground.solana.com/
 * 2. Create a new project
 * 3. Paste this code into the client.ts file
 * 4. Make sure your program is deployed (or use the one in the playground)
 * 5. Update the PROGRAM_ID and MARKET_PDA constants below
 * 6. Click "Run" button
 * 
 * This script tests:
 * - Mint shares (100 USDC → 100 YES + 100 NO)
 * - Place buy order (YES, 0.5 price, 1x leverage)
 * - Place sell order (YES, same price, 1x leverage)
 * - Validate match
 * - Execute buyer match
 */

// ============================================================================
// CONFIGURATION - UPDATE THESE VALUES
// ============================================================================

const PROGRAM_ID = new web3.PublicKey("4Aztdw22qBXVBv9A1SVErCqFy9yinHFfvcGtnk6ooCrw");
const MARKET_PDA = new web3.PublicKey("YOUR_MARKET_PDA_HERE"); // Replace with your market PDA
const USDC_MINT = new web3.PublicKey("Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr"); // Devnet USDC
const SYSVAR_RENT = new web3.PublicKey("SysvarRent111111111111111111111111111111111");

// Test parameters
const MINT_AMOUNT = 100 * 1e6; // 100 USDC (6 decimals)
const ORDER_PRICE = 5000; // 0.5 (50% probability) in basis points
const ORDER_QUANTITY = 100 * 1e6; // 100 shares (6 decimals)
const LEVERAGE = 1; // 1x (spot trading)

// ============================================================================
// PDA HELPERS
// ============================================================================

function findProgramAddress(seeds: Buffer[], programId: web3.PublicKey): [web3.PublicKey, number] {
  return web3.PublicKey.findProgramAddressSync(seeds, programId);
}

function getMarketVaultPDA(market: web3.PublicKey): [web3.PublicKey, number] {
  return findProgramAddress([Buffer.from("vault"), market.toBuffer()], PROGRAM_ID);
}

function getMarginVaultPDA(market: web3.PublicKey): [web3.PublicKey, number] {
  return findProgramAddress([Buffer.from("margin_vault"), market.toBuffer()], PROGRAM_ID);
}

function getLiquidityVaultPDA(market: web3.PublicKey): [web3.PublicKey, number] {
  return findProgramAddress([Buffer.from("liquidity_vault"), market.toBuffer()], PROGRAM_ID);
}

function getVaultAuthorityPDA(market: web3.PublicKey): [web3.PublicKey, number] {
  return findProgramAddress([Buffer.from("vault_authority"), market.toBuffer()], PROGRAM_ID);
}

function getMarginVaultAuthorityPDA(market: web3.PublicKey): [web3.PublicKey, number] {
  return findProgramAddress([Buffer.from("margin_vault_authority"), market.toBuffer()], PROGRAM_ID);
}

function getLiquidityVaultAuthorityPDA(market: web3.PublicKey): [web3.PublicKey, number] {
  return findProgramAddress([Buffer.from("liquidity_vault_authority"), market.toBuffer()], PROGRAM_ID);
}

function getYesMintPDA(market: web3.PublicKey, outcomeId: number): [web3.PublicKey, number] {
  return findProgramAddress([Buffer.from("yes_mint"), market.toBuffer(), Buffer.from([outcomeId])], PROGRAM_ID);
}

function getNoMintPDA(market: web3.PublicKey): [web3.PublicKey, number] {
  return findProgramAddress([Buffer.from("no_mint"), market.toBuffer()], PROGRAM_ID);
}

function getMintAuthorityPDA(market: web3.PublicKey): [web3.PublicKey, number] {
  return findProgramAddress([Buffer.from("mint_authority"), market.toBuffer()], PROGRAM_ID);
}

function getPendingOrderPDA(user: web3.PublicKey, orderId: number): [web3.PublicKey, number] {
  const orderIdBuffer = Buffer.allocUnsafe(8);
  orderIdBuffer.writeBigUInt64LE(BigInt(orderId), 0);
  return findProgramAddress([Buffer.from("order"), user.toBuffer(), orderIdBuffer], PROGRAM_ID);
}

function getOrderEscrowPDA(user: web3.PublicKey, orderId: number): [web3.PublicKey, number] {
  const orderIdBuffer = Buffer.allocUnsafe(8);
  orderIdBuffer.writeBigUInt64LE(BigInt(orderId), 0);
  return findProgramAddress([Buffer.from("order_escrow"), user.toBuffer(), orderIdBuffer], PROGRAM_ID);
}

function getOrderEscrowAuthorityPDA(user: web3.PublicKey, orderId: number): [web3.PublicKey, number] {
  const orderIdBuffer = Buffer.allocUnsafe(8);
  orderIdBuffer.writeBigUInt64LE(BigInt(orderId), 0);
  return findProgramAddress([Buffer.from("order_escrow_authority"), user.toBuffer(), orderIdBuffer], PROGRAM_ID);
}

function getShareEscrowAuthorityPDA(user: web3.PublicKey, orderId: number): [web3.PublicKey, number] {
  const orderIdBuffer = Buffer.allocUnsafe(8);
  orderIdBuffer.writeBigUInt64LE(BigInt(orderId), 0);
  return findProgramAddress([Buffer.from("share_escrow_authority"), user.toBuffer(), orderIdBuffer], PROGRAM_ID);
}

function getShareEscrowYesPDA(user: web3.PublicKey, orderId: number): [web3.PublicKey, number] {
  const orderIdBuffer = Buffer.allocUnsafe(8);
  orderIdBuffer.writeBigUInt64LE(BigInt(orderId), 0);
  return findProgramAddress([Buffer.from("share_escrow"), user.toBuffer(), orderIdBuffer], PROGRAM_ID);
}

function getPositionPDA(user: web3.PublicKey, market: web3.PublicKey, outcomeId: number, side: number): [web3.PublicKey, number] {
  return findProgramAddress(
    [Buffer.from("position"), user.toBuffer(), market.toBuffer(), Buffer.from([outcomeId]), Buffer.from([side])],
    PROGRAM_ID
  );
}

function getMatchStatePDA(market: web3.PublicKey, buyOrderId: number, sellOrderId: number): [web3.PublicKey, number] {
  const buyIdBuffer = Buffer.allocUnsafe(8);
  buyIdBuffer.writeBigUInt64LE(BigInt(buyOrderId), 0);
  const sellIdBuffer = Buffer.allocUnsafe(8);
  sellIdBuffer.writeBigUInt64LE(BigInt(sellOrderId), 0);
  return findProgramAddress([Buffer.from("match"), market.toBuffer(), buyIdBuffer, sellIdBuffer], PROGRAM_ID);
}

function getConfigPDA(): [web3.PublicKey, number] {
  return findProgramAddress([Buffer.from("config")], PROGRAM_ID);
}

async function getOrCreateATA(mint: web3.PublicKey, owner: web3.PublicKey): Promise<web3.PublicKey> {
  const ata = anchor.utils.token.associatedAddress({ mint, owner });
  try {
    const account = await pg.connection.getAccountInfo(ata);
    if (account) {
      console.log(`✅ ATA exists: ${ata.toString()}`);
      return ata;
    }
  } catch (e) {
    // ATA doesn't exist
  }

  console.log(`📝 Creating ATA: ${ata.toString()}`);
  const tx = new web3.Transaction().add(
    anchor.utils.token.createAssociatedTokenAccountInstruction(
      pg.wallet.publicKey,
      ata,
      owner,
      mint
    )
  );
  await pg.sendAndConfirmTransaction(tx);
  return ata;
}

// ============================================================================
// MAIN TEST FUNCTION
// ============================================================================

async function main() {
  console.log("🧪 Testing Refactored Leverage Architecture");
  console.log("===========================================\n");

  // Validate market PDA
  if (MARKET_PDA.equals(new web3.PublicKey("YOUR_MARKET_PDA_HERE"))) {
    console.error("❌ Please update MARKET_PDA constant with your market address!");
    return;
  }

  console.log(`💰 Wallet: ${pg.wallet.publicKey.toString()}`);
  console.log(`📊 Market: ${MARKET_PDA.toString()}\n`);

  // Get PDAs
  const [yesMint] = getYesMintPDA(MARKET_PDA, 0);
  const [noMint] = getNoMintPDA(MARKET_PDA);
  const [mintAuthority] = getMintAuthorityPDA(MARKET_PDA);
  const [marketVault] = getMarketVaultPDA(MARKET_PDA);
  const [marginVault] = getMarginVaultPDA(MARKET_PDA);
  const [liquidityVault] = getLiquidityVaultPDA(MARKET_PDA);
  const [vaultAuthority] = getVaultAuthorityPDA(MARKET_PDA);

  console.log(`✅ YES Mint: ${yesMint.toString()}`);
  console.log(`✅ NO Mint: ${noMint.toString()}`);
  console.log(`✅ Market Vault: ${marketVault.toString()}`);
  console.log(`✅ Margin Vault: ${marginVault.toString()}`);
  console.log(`✅ Liquidity Vault: ${liquidityVault.toString()}\n`);

  // Get or create ATAs
  const userUsdcATA = await getOrCreateATA(USDC_MINT, pg.wallet.publicKey);
  const userYesATA = await getOrCreateATA(yesMint, pg.wallet.publicKey);
  const userNoATA = await getOrCreateATA(noMint, pg.wallet.publicKey);

  console.log(`✅ User USDC ATA: ${userUsdcATA.toString()}`);
  console.log(`✅ User YES ATA: ${userYesATA.toString()}`);
  console.log(`✅ User NO ATA: ${userNoATA.toString()}\n`);

  // Load program (make sure your program is deployed/imported in playground)
  const program = await pg.anchor.getProgram("space_core", PROGRAM_ID);

  // Test 1: Mint Shares
  console.log("📦 Test 1: Minting Shares");
  console.log("─────────────────────────");
  
  try {
    const tx1 = await program.methods
      .mintShares(0, new anchor.BN(MINT_AMOUNT))
      .accounts({
        market: MARKET_PDA,
        user: pg.wallet.publicKey,
        userUsdc: userUsdcATA,
        yesMint: yesMint,
        noMint: noMint,
        userYesAccount: userYesATA,
        userNoAccount: userNoATA,
        marketVault: marketVault,
        vaultAuthority: vaultAuthority,
        mintAuthority: mintAuthority,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log(`✅ Mint shares transaction: ${tx1}`);
    console.log(`   Minted ${MINT_AMOUNT / 1e6} USDC worth of shares\n`);
  } catch (error: any) {
    console.error(`❌ Mint shares failed: ${error.message}`);
    if (error.logs) console.error("   Logs:", error.logs);
    throw error;
  }

  // Test 2: Place Buy Order
  console.log("📈 Test 2: Placing Buy Order");
  console.log("─────────────────────────────");
  
  const buyOrderId = Date.now();
  const [buyOrderPDA] = getPendingOrderPDA(pg.wallet.publicKey, buyOrderId);
  const [buyOrderEscrowAuthorityPDA] = getOrderEscrowAuthorityPDA(pg.wallet.publicKey, buyOrderId);
  const [buyOrderEscrowPDA] = getOrderEscrowPDA(pg.wallet.publicKey, buyOrderId);

  try {
    const tx2 = await program.methods
      .placeBuyOrder(
        new anchor.BN(buyOrderId),
        0, // outcomeId (YES)
        new anchor.BN(ORDER_PRICE),
        new anchor.BN(ORDER_QUANTITY),
        LEVERAGE
      )
      .accounts({
        market: MARKET_PDA,
        user: pg.wallet.publicKey,
        userUsdc: userUsdcATA,
        pendingOrder: buyOrderPDA,
        orderEscrowAuthority: buyOrderEscrowAuthorityPDA,
        orderEscrow: buyOrderEscrowPDA,
        usdcMint: USDC_MINT,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();

    console.log(`✅ Buy order transaction: ${tx2}`);
    console.log(`   Order ID: ${buyOrderId}`);
    console.log(`   Price: ${ORDER_PRICE / 100}% (${ORDER_PRICE} bps)`);
    console.log(`   Quantity: ${ORDER_QUANTITY / 1e6} shares`);
    console.log(`   Leverage: ${LEVERAGE}x\n`);
  } catch (error: any) {
    console.error(`❌ Place buy order failed: ${error.message}`);
    if (error.logs) console.error("   Logs:", error.logs);
    throw error;
  }

  // Test 3: Place Sell Order
  console.log("📉 Test 3: Placing Sell Order");
  console.log("──────────────────────────────");
  
  const sellOrderId = buyOrderId + 1;
  const [sellOrderPDA] = getPendingOrderPDA(pg.wallet.publicKey, sellOrderId);
  const [sellShareEscrowAuthorityPDA] = getShareEscrowAuthorityPDA(pg.wallet.publicKey, sellOrderId);
  const [sellShareEscrowYesPDA] = getShareEscrowYesPDA(pg.wallet.publicKey, sellOrderId);

  try {
    const tx3 = await program.methods
      .placeYesLimitSellOrder(
        new anchor.BN(sellOrderId),
        0, // outcomeId (YES)
        new anchor.BN(ORDER_PRICE),
        new anchor.BN(ORDER_QUANTITY),
        LEVERAGE
      )
      .accounts({
        market: MARKET_PDA,
        user: pg.wallet.publicKey,
        pendingOrder: sellOrderPDA,
        userYesAccount: userYesATA,
        shareEscrowAuthority: sellShareEscrowAuthorityPDA,
        shareEscrowYes: sellShareEscrowYesPDA,
        yesMint: yesMint,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
        rent: SYSVAR_RENT,
      })
      .rpc();

    console.log(`✅ Sell order transaction: ${tx3}`);
    console.log(`   Order ID: ${sellOrderId}`);
    console.log(`   Price: ${ORDER_PRICE / 100}% (${ORDER_PRICE} bps)`);
    console.log(`   Quantity: ${ORDER_QUANTITY / 1e6} shares`);
    console.log(`   Leverage: ${LEVERAGE}x\n`);
  } catch (error: any) {
    console.error(`❌ Place sell order failed: ${error.message}`);
    if (error.logs) console.error("   Logs:", error.logs);
    throw error;
  }

  // Test 4: Validate Match
  console.log("🔍 Test 4: Validating Match");
  console.log("───────────────────────────");
  
  const [configPDA] = getConfigPDA();
  const [matchStatePDA] = getMatchStatePDA(MARKET_PDA, buyOrderId, sellOrderId);

  try {
    const tx4 = await program.methods
      .validateMatch(
        new anchor.BN(buyOrderId),
        new anchor.BN(sellOrderId),
        new anchor.BN(ORDER_PRICE),
        new anchor.BN(ORDER_QUANTITY)
      )
      .accounts({
        market: MARKET_PDA,
        config: configPDA,
        buyOrder: buyOrderPDA,
        sellOrder: sellOrderPDA,
        keeper: pg.wallet.publicKey,
        matchState: matchStatePDA,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();

    console.log(`✅ Validate match transaction: ${tx4}`);
    console.log(`   Match State PDA: ${matchStatePDA.toString()}\n`);
  } catch (error: any) {
    console.error(`❌ Validate match failed: ${error.message}`);
    if (error.logs) console.error("   Logs:", error.logs);
    throw error;
  }

  // Test 5: Execute Buyer Match
  console.log("⚡ Test 5: Executing Buyer Match");
  console.log("─────────────────────────────────");

  const [marginVaultAuthorityPDA] = getMarginVaultAuthorityPDA(MARKET_PDA);
  const [liquidityVaultAuthorityPDA] = getLiquidityVaultAuthorityPDA(MARKET_PDA);
  const [buyPositionPDA] = getPositionPDA(pg.wallet.publicKey, MARKET_PDA, 0, 0);

  try {
    const tx5 = await program.methods
      .executeYesBuyerMatch()
      .accounts({
        market: MARKET_PDA,
        matchState: matchStatePDA,
        buyOrder: buyOrderPDA,
        keeper: pg.wallet.publicKey,
        buyOrderEscrowAuthority: buyOrderEscrowAuthorityPDA,
        buyOrderEscrow: buyOrderEscrowPDA,
        yesMint: yesMint,
        buyUserOutcomeAccount: userYesATA,
        sellShareEscrowAuthority: sellShareEscrowAuthorityPDA,
        sellShareEscrowYes: sellShareEscrowYesPDA,
        buyPosition: buyPositionPDA,
        marketVault: marketVault,
        vaultAuthority: vaultAuthority,
        marginVault: marginVault,
        marginVaultAuthority: marginVaultAuthorityPDA,
        liquidityVault: liquidityVault,
        liquidityVaultAuthority: liquidityVaultAuthorityPDA,
        tokenProgram: anchor.utils.token.TOKEN_PROGRAM_ID,
        systemProgram: web3.SystemProgram.programId,
      })
      .rpc();

    console.log(`✅ Execute buyer match transaction: ${tx5}`);
    console.log(`   Position PDA: ${buyPositionPDA.toString()}\n`);
  } catch (error: any) {
    console.error(`❌ Execute buyer match failed: ${error.message}`);
    if (error.logs) console.error("   Logs:", error.logs);
    throw error;
  }

  console.log("🎉 All tests completed successfully!");
  console.log("─────────────────────────────────────");
  console.log("✅ Minted shares");
  console.log("✅ Placed buy order");
  console.log("✅ Placed sell order");
  console.log("✅ Validated match");
  console.log("✅ Executed buyer match");
  console.log("\n✅ Leverage architecture refactor is working!");
}

// Run the test
main().catch((error) => {
  console.error("\n❌ Test failed:", error);
});





