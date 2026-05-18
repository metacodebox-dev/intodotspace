/**
 * Testing script for the refactored leverage architecture
 * Tests: Mint shares → Place buy/sell orders → Execute match
 * 
 * Usage:
 *   node scripts/test-leverage-architecture.js [keypair-path] [market-address]
 * 
 * Example:
 *   node scripts/test-leverage-architecture.js ~/.config/solana/id.json <market-pda>
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { Connection, Keypair, PublicKey, SystemProgram } = require('@solana/web3.js');
const { AnchorProvider, Program, BN, Wallet } = require('@coral-xyz/anchor');
const {
  TOKEN_PROGRAM_ID,
  ASSOCIATED_TOKEN_PROGRAM_ID,
  getAssociatedTokenAddress,
  createAssociatedTokenAccountInstruction,
  getAccount,
} = require('@solana/spl-token');

// Constants
const SPACE_CORE_PROGRAM_ID = new PublicKey('J6v8NQVWtB2718EuSk1xh3kByCuYzieSbBxwMbCUcPB2');
const USDC_MINT = new PublicKey('Gh9ZwEmdLJ8DscKNTkTqPbNwLNNBjuSzaG9Vp2KGtKJr'); // Devnet USDC
const BASIS_POINTS = 10000;

// PDA helpers (simplified)
function findProgramAddress(seeds, programId) {
  const [pda, bump] = PublicKey.findProgramAddressSync(seeds, programId);
  return [pda, bump];
}

function getMarketPDA(creator, marketId) {
  return findProgramAddress(
    [Buffer.from('market'), creator.toBuffer(), Buffer.from(marketId.toString().padStart(16, '0'), 'hex')],
    SPACE_CORE_PROGRAM_ID
  );
}

function getMarketVaultPDA(market) {
  return findProgramAddress(
    [Buffer.from('vault'), market.toBuffer()],
    SPACE_CORE_PROGRAM_ID
  );
}

function getMarginVaultPDA(market) {
  return findProgramAddress(
    [Buffer.from('margin_vault'), market.toBuffer()],
    SPACE_CORE_PROGRAM_ID
  );
}

function getLiquidityVaultPDA(market) {
  return findProgramAddress(
    [Buffer.from('liquidity_vault'), market.toBuffer()],
    SPACE_CORE_PROGRAM_ID
  );
}

function getVaultAuthorityPDA(market) {
  return findProgramAddress(
    [Buffer.from('vault_authority'), market.toBuffer()],
    SPACE_CORE_PROGRAM_ID
  );
}

function getMarginVaultAuthorityPDA(market) {
  return findProgramAddress(
    [Buffer.from('margin_vault_authority'), market.toBuffer()],
    SPACE_CORE_PROGRAM_ID
  );
}

function getLiquidityVaultAuthorityPDA(market) {
  return findProgramAddress(
    [Buffer.from('liquidity_vault_authority'), market.toBuffer()],
    SPACE_CORE_PROGRAM_ID
  );
}

function getYesMintPDA(market, outcomeId) {
  return findProgramAddress(
    [Buffer.from('yes_mint'), market.toBuffer(), Buffer.from([outcomeId])],
    SPACE_CORE_PROGRAM_ID
  );
}

function getNoMintPDA(market) {
  return findProgramAddress(
    [Buffer.from('no_mint'), market.toBuffer()],
    SPACE_CORE_PROGRAM_ID
  );
}

function getMintAuthorityPDA(market) {
  return findProgramAddress(
    [Buffer.from('mint_authority'), market.toBuffer()],
    SPACE_CORE_PROGRAM_ID
  );
}

function getPendingOrderPDA(user, orderId) {
  const orderIdBuffer = Buffer.allocUnsafe(8);
  orderIdBuffer.writeBigUInt64LE(BigInt(orderId), 0);
  return findProgramAddress(
    [Buffer.from('order'), user.toBuffer(), orderIdBuffer],
    SPACE_CORE_PROGRAM_ID
  );
}

function getOrderEscrowPDA(user, orderId) {
  const orderIdBuffer = Buffer.allocUnsafe(8);
  orderIdBuffer.writeBigUInt64LE(BigInt(orderId), 0);
  return findProgramAddress(
    [Buffer.from('order_escrow'), user.toBuffer(), orderIdBuffer],
    SPACE_CORE_PROGRAM_ID
  );
}

function getOrderEscrowAuthorityPDA(user, orderId) {
  const orderIdBuffer = Buffer.allocUnsafe(8);
  orderIdBuffer.writeBigUInt64LE(BigInt(orderId), 0);
  return findProgramAddress(
    [Buffer.from('order_escrow_authority'), user.toBuffer(), orderIdBuffer],
    SPACE_CORE_PROGRAM_ID
  );
}

function getShareEscrowAuthorityPDA(user, orderId) {
  const orderIdBuffer = Buffer.allocUnsafe(8);
  orderIdBuffer.writeBigUInt64LE(BigInt(orderId), 0);
  return findProgramAddress(
    [Buffer.from('share_escrow_authority'), user.toBuffer(), orderIdBuffer],
    SPACE_CORE_PROGRAM_ID
  );
}

function getShareEscrowYesPDA(user, orderId) {
  const orderIdBuffer = Buffer.allocUnsafe(8);
  orderIdBuffer.writeBigUInt64LE(BigInt(orderId), 0);
  return findProgramAddress(
    [Buffer.from('share_escrow'), user.toBuffer(), orderIdBuffer],
    SPACE_CORE_PROGRAM_ID
  );
}

function getPositionPDA(user, market, outcomeId, side) {
  return findProgramAddress(
    [Buffer.from('position'), user.toBuffer(), market.toBuffer(), Buffer.from([outcomeId]), Buffer.from([side])],
    SPACE_CORE_PROGRAM_ID
  );
}

function getMatchStatePDA(market, buyOrderId, sellOrderId) {
  const buyIdBuffer = Buffer.allocUnsafe(8);
  buyIdBuffer.writeBigUInt64LE(BigInt(buyOrderId), 0);
  const sellIdBuffer = Buffer.allocUnsafe(8);
  sellIdBuffer.writeBigUInt64LE(BigInt(sellOrderId), 0);
  return findProgramAddress(
    [Buffer.from('match'), market.toBuffer(), buyIdBuffer, sellIdBuffer],
    SPACE_CORE_PROGRAM_ID
  );
}

function getConfigPDA() {
  return findProgramAddress([Buffer.from('config')], SPACE_CORE_PROGRAM_ID);
}

function loadKeypair() {
  const keypairArg = process.argv[2];
  if (keypairArg) {
    try {
      const keypairData = JSON.parse(fs.readFileSync(keypairArg, 'utf-8'));
      return Keypair.fromSecretKey(Uint8Array.from(keypairData));
    } catch (error) {
      console.error(`❌ Could not load keypair from: ${keypairArg}`);
      process.exit(1);
    }
  }

  const keypairEnv = process.env.SOLANA_KEYPAIR_PATH;
  if (keypairEnv) {
    try {
      const keypairData = JSON.parse(fs.readFileSync(keypairEnv, 'utf-8'));
      return Keypair.fromSecretKey(Uint8Array.from(keypairData));
    } catch (error) {
      console.error(`❌ Could not load keypair from env: ${keypairEnv}`);
    }
  }

  try {
    const configOutput = execSync('solana config get', { encoding: 'utf-8', stdio: 'pipe' });
    const keypairMatch = configOutput.match(/Keypair Path: (.+)/);
    if (keypairMatch && keypairMatch[1]) {
      const keypairPath = keypairMatch[1].trim();
      if (fs.existsSync(keypairPath)) {
        const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
        return Keypair.fromSecretKey(Uint8Array.from(keypairData));
      }
    }
  } catch (error) {
    // Ignore
  }

  const defaultPath = path.join(os.homedir(), '.config', 'solana', 'id.json');
  if (fs.existsSync(defaultPath)) {
    const keypairData = JSON.parse(fs.readFileSync(defaultPath, 'utf-8'));
    return Keypair.fromSecretKey(Uint8Array.from(keypairData));
  }

  console.error('❌ Could not load keypair. Please provide path as argument or set SOLANA_KEYPAIR_PATH');
  process.exit(1);
}

async function loadIDL() {
  const idlPath = path.join(__dirname, '..', 'frontend', 'src', 'idl', 'space_core.json');
  if (fs.existsSync(idlPath)) {
    return JSON.parse(fs.readFileSync(idlPath, 'utf-8'));
  }
  throw new Error(`IDL not found at: ${idlPath}`);
}

async function ensureATA(connection, provider, mint, owner, ataAddress) {
  try {
    await getAccount(connection, ataAddress);
    return false; // ATA already exists
  } catch (error) {
    // ATA doesn't exist, create it
    const { Transaction } = require('@solana/web3.js');
    const createIx = createAssociatedTokenAccountInstruction(provider.wallet.publicKey, ataAddress, owner, mint);
    const tx = await provider.sendAndConfirm(new Transaction().add(createIx));
    console.log(`✅ Created ATA: ${ataAddress.toString()}`);
    return true;
  }
}

async function main() {
  console.log('🧪 Testing Refactored Leverage Architecture');
  console.log('===========================================\n');

  // Load keypair
  const payer = loadKeypair();
  console.log(`💰 Using wallet: ${payer.publicKey.toString()}\n`);

  // Get market address
  const marketAddress = process.argv[3];
  if (!marketAddress) {
    console.error('❌ Please provide market address as second argument');
    console.error('   Usage: node scripts/test-leverage-architecture.js [keypair] <market-address>');
    process.exit(1);
  }

  const marketPDA = new PublicKey(marketAddress);
  console.log(`📊 Market: ${marketPDA.toString()}\n`);

  // Connect to devnet
  const connection = new Connection('https://api.devnet.solana.com', 'confirmed');
  const wallet = new Wallet(payer);
  const provider = new AnchorProvider(connection, wallet, { commitment: 'confirmed' });

  // Load program
  const idl = await loadIDL();
  const program = new Program(idl, SPACE_CORE_PROGRAM_ID, provider);

  console.log('✅ Program loaded\n');

  // Get PDAs
  const [yesMint] = getYesMintPDA(marketPDA, 0);
  const [noMint] = getNoMintPDA(marketPDA);
  const [mintAuthority] = getMintAuthorityPDA(marketPDA);
  const [marketVault] = getMarketVaultPDA(marketPDA);
  const [marginVault] = getMarginVaultPDA(marketPDA);
  const [liquidityVault] = getLiquidityVaultPDA(marketPDA);

  console.log(`✅ YES Mint: ${yesMint.toString()}`);
  console.log(`✅ NO Mint: ${noMint.toString()}`);
  console.log(`✅ Market Vault: ${marketVault.toString()}`);
  console.log(`✅ Margin Vault: ${marginVault.toString()}`);
  console.log(`✅ Liquidity Vault: ${liquidityVault.toString()}\n`);

  // Get user ATAs
  const userUsdcATA = await getAssociatedTokenAddress(USDC_MINT, payer.publicKey);
  const userYesATA = await getAssociatedTokenAddress(yesMint, payer.publicKey);
  const userNoATA = await getAssociatedTokenAddress(noMint, payer.publicKey);

  console.log(`✅ User USDC ATA: ${userUsdcATA.toString()}`);
  console.log(`✅ User YES ATA: ${userYesATA.toString()}`);
  console.log(`✅ User NO ATA: ${userNoATA.toString()}\n`);

  // Ensure ATAs exist
  await ensureATA(connection, provider, USDC_MINT, payer.publicKey, userUsdcATA);
  await ensureATA(connection, provider, yesMint, payer.publicKey, userYesATA);
  await ensureATA(connection, provider, noMint, payer.publicKey, userNoATA);

  // Test 1: Mint Shares (100 USDC → 100 YES + 100 NO)
  console.log('📦 Test 1: Minting Shares');
  console.log('─────────────────────────');
  const mintAmount = 100 * 1e6; // 100 USDC (6 decimals)
  
  try {
    const tx1 = await program.methods
      .mintShares(0, new BN(mintAmount))
      .accounts({
        market: marketPDA,
        user: payer.publicKey,
        userUsdc: userUsdcATA,
        yesMint: yesMint,
        noMint: noMint,
        userYesAccount: userYesATA,
        userNoAccount: userNoATA,
        marketVault: marketVault,
        vaultAuthority: getVaultAuthorityPDA(marketPDA)[0],
        mintAuthority: mintAuthority,
        tokenProgram: TOKEN_PROGRAM_ID,
      })
      .rpc();

    console.log(`✅ Mint shares transaction: ${tx1}`);
    console.log(`   Minted ${mintAmount / 1e6} USDC worth of shares\n`);
  } catch (error) {
    console.error(`❌ Mint shares failed: ${error.message}`);
    throw error;
  }

  // Test 2: Place Buy Order (YES, 5000 basis points = 0.5, 100 shares, 1x leverage)
  console.log('📈 Test 2: Placing Buy Order');
  console.log('─────────────────────────────');
  const buyOrderId = Date.now();
  const buyPrice = 5000; // 0.5 (50% probability)
  const buyQuantity = 100 * 1e6; // 100 shares (6 decimals)
  const buyLeverage = 1; // 1x (spot)

  const [buyOrderPDA] = getPendingOrderPDA(payer.publicKey, buyOrderId);
  const [buyOrderEscrowAuthorityPDA] = getOrderEscrowAuthorityPDA(payer.publicKey, buyOrderId);
  const [buyOrderEscrowPDA] = getOrderEscrowPDA(payer.publicKey, buyOrderId);

  try {
    const tx2 = await program.methods
      .placeBuyOrder(
        new BN(buyOrderId),
        0, // outcomeId (YES)
        new BN(buyPrice),
        new BN(buyQuantity),
        buyLeverage
      )
      .accounts({
        market: marketPDA,
        user: payer.publicKey,
        userUsdc: userUsdcATA,
        pendingOrder: buyOrderPDA,
        orderEscrowAuthority: buyOrderEscrowAuthorityPDA,
        orderEscrow: buyOrderEscrowPDA,
        usdcMint: USDC_MINT,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`✅ Buy order transaction: ${tx2}`);
    console.log(`   Order ID: ${buyOrderId}`);
    console.log(`   Price: ${buyPrice / 100}% (${buyPrice} bps)`);
    console.log(`   Quantity: ${buyQuantity / 1e6} shares`);
    console.log(`   Leverage: ${buyLeverage}x\n`);
  } catch (error) {
    console.error(`❌ Place buy order failed: ${error.message}`);
    throw error;
  }

  // Test 3: Place Sell Order (YES, same price, same quantity)
  console.log('📉 Test 3: Placing Sell Order');
  console.log('──────────────────────────────');
  const sellOrderId = buyOrderId + 1;
  const sellPrice = buyPrice; // Same price for matching
  const sellQuantity = buyQuantity; // Same quantity
  const sellLeverage = 1; // 1x (spot)

  const [sellOrderPDA] = getPendingOrderPDA(payer.publicKey, sellOrderId);
  const [sellShareEscrowAuthorityPDA] = getShareEscrowAuthorityPDA(payer.publicKey, sellOrderId);
  const [sellShareEscrowYesPDA] = getShareEscrowYesPDA(payer.publicKey, sellOrderId);

  try {
    const tx3 = await program.methods
      .placeYesLimitSellOrder(
        new BN(sellOrderId),
        0, // outcomeId (YES)
        new BN(sellPrice),
        new BN(sellQuantity),
        sellLeverage
      )
      .accounts({
        market: marketPDA,
        user: payer.publicKey,
        pendingOrder: sellOrderPDA,
        userYesAccount: userYesATA,
        shareEscrowAuthority: sellShareEscrowAuthorityPDA,
        shareEscrowYes: sellShareEscrowYesPDA,
        yesMint: yesMint,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
        rent: new PublicKey('SysvarRent111111111111111111111111111111111'),
      })
      .rpc();

    console.log(`✅ Sell order transaction: ${tx3}`);
    console.log(`   Order ID: ${sellOrderId}`);
    console.log(`   Price: ${sellPrice / 100}% (${sellPrice} bps)`);
    console.log(`   Quantity: ${sellQuantity / 1e6} shares`);
    console.log(`   Leverage: ${sellLeverage}x\n`);
  } catch (error) {
    console.error(`❌ Place sell order failed: ${error.message}`);
    throw error;
  }

  // Test 4: Validate Match
  console.log('🔍 Test 4: Validating Match');
  console.log('───────────────────────────');
  const [configPDA] = getConfigPDA();
  const [matchStatePDA] = getMatchStatePDA(marketPDA, buyOrderId, sellOrderId);
  const matchPrice = buyPrice; // Same price
  const matchQuantity = buyQuantity; // Full quantity

  try {
    const tx4 = await program.methods
      .validateMatch(
        new BN(buyOrderId),
        new BN(sellOrderId),
        new BN(matchPrice),
        new BN(matchQuantity)
      )
      .accounts({
        market: marketPDA,
        config: configPDA,
        buyOrder: buyOrderPDA,
        sellOrder: sellOrderPDA,
        keeper: payer.publicKey,
        matchState: matchStatePDA,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`✅ Validate match transaction: ${tx4}`);
    console.log(`   Match State PDA: ${matchStatePDA.toString()}\n`);
  } catch (error) {
    console.error(`❌ Validate match failed: ${error.message}`);
    throw error;
  }

  // Test 5: Execute Buyer Match (YES)
  console.log('⚡ Test 5: Executing Buyer Match');
  console.log('─────────────────────────────────');
  
  const [vaultAuthorityPDA] = getVaultAuthorityPDA(marketPDA);
  const [marginVaultAuthorityPDA] = getMarginVaultAuthorityPDA(marketPDA);
  const [liquidityVaultAuthorityPDA] = getLiquidityVaultAuthorityPDA(marketPDA);
  const [buyPositionPDA] = getPositionPDA(payer.publicKey, marketPDA, 0, 0);

  try {
    const tx5 = await program.methods
      .executeYesBuyerMatch()
      .accounts({
        market: marketPDA,
        matchState: matchStatePDA,
        buyOrder: buyOrderPDA,
        keeper: payer.publicKey,
        buyOrderEscrowAuthority: buyOrderEscrowAuthorityPDA,
        buyOrderEscrow: buyOrderEscrowPDA,
        yesMint: yesMint,
        buyUserOutcomeAccount: userYesATA,
        sellShareEscrowAuthority: sellShareEscrowAuthorityPDA,
        sellShareEscrowYes: sellShareEscrowYesPDA,
        buyPosition: buyPositionPDA,
        marketVault: marketVault,
        vaultAuthority: vaultAuthorityPDA,
        marginVault: marginVault,
        marginVaultAuthority: marginVaultAuthorityPDA,
        liquidityVault: liquidityVault,
        liquidityVaultAuthority: liquidityVaultAuthorityPDA,
        tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log(`✅ Execute buyer match transaction: ${tx5}`);
    console.log(`   Position PDA: ${buyPositionPDA.toString()}\n`);
  } catch (error) {
    console.error(`❌ Execute buyer match failed: ${error.message}`);
    console.error(`   Error details: ${JSON.stringify(error, null, 2)}`);
    throw error;
  }

  console.log('🎉 All tests completed successfully!');
  console.log('─────────────────────────────────────');
  console.log('✅ Minted shares');
  console.log('✅ Placed buy order');
  console.log('✅ Placed sell order');
  console.log('✅ Validated match');
  console.log('✅ Executed buyer match');
  console.log('\n✅ Leverage architecture refactor is working!');
}

// Run
main().catch((error) => {
  console.error('\n❌ Test failed:', error);
  process.exit(1);
});

