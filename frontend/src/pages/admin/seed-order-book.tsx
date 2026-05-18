import { useState, useEffect, useMemo, useRef, useCallback } from 'react';
import { AdminLayout } from '@/components/AdminLayout';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useSpaceProgram } from '@/hooks/useSpaceProgram';
import {
  USDC_MINT,
  USDC_DECIMALS,
  SPACE_MINT,
  SPACE_DECIMALS,
  humanToLamports,
  getPendingOrderPDA,
  getOrderEscrowPDA,
  getOrderEscrowAuthorityPDA,
  getShareEscrowAuthorityPDA,
  getShareEscrowYesPDA,
  getShareEscrowNoPDA,
  getPositionPDA,
  getYesMintPDA,
  getNoMintPDA,
  getMarketVaultPDA,
  getVaultAuthorityPDA,
  getMintAuthorityPDA,
} from '@/utils/solana';

function resolveQuoteSymbol(mint: PublicKey): string {
  if (mint.equals(USDC_MINT)) return 'USDC';
  if (mint.equals(SPACE_MINT)) return 'SPC';
  return 'QUOTE';
}
import { PublicKey, Transaction, SystemProgram, SYSVAR_RENT_PUBKEY, Keypair } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, getAssociatedTokenAddress, createAssociatedTokenAccountInstruction, getAccount } from '@solana/spl-token';
import { BN } from '@coral-xyz/anchor';
import axios from 'axios';
import { isAdminWallet } from '@/utils/admin';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
// Quantities passed to `mint_shares` / `place_*_order` are share base units
// (shares are always 6 decimals). The program scales to the market's quote
// token internally using `quote_decimals`, so the frontend does NOT pack any
// quote scaling into `quantity` — doing so in the old pre-v2 program was a
// workaround that produced wrong share counts on SPACE markets.
const SHARE_DECIMALS = 6;
// Human-readable minimum order size, in share units (5,000 shares).
const MIN_ORDER_SIZE_HUMAN = 5_000;

interface Market {
  id: string;
  marketAddress: string;
  title: string;
  status: number;
  outcomes: any[];
}

interface OrderPlan {
  side: 'buy' | 'sell';
  tokenType: 'yes' | 'no';
  priceCents: number;
  priceBps: number;
  quantity: number;
}

interface LogEntry {
  message: string;
  type: 'info' | 'success' | 'error' | 'warn';
}

type SeedPhase = 'idle' | 'minting' | 'building' | 'sending' | 'done';

// ── Utility ──

let globalOrderId = Math.floor(Date.now() / 1000) * 1000 + Math.floor(Math.random() * 1000);
function nextOrderId(): number {
  return globalOrderId++;
}

export default function SeedOrderBook() {
  const { connected, publicKey } = useWallet();
  const { connection } = useConnection();
  const { mintShares, program, provider, isReady, loading: programLoading } = useSpaceProgram();

  const isAdmin = isAdminWallet(connected, publicKey);

  // Signing mode
  const [signingMode, setSigningMode] = useState<'wallet' | 'keypair'>('wallet');
  const [keypairInput, setKeypairInput] = useState('');

  // Form state
  const [markets, setMarkets] = useState<Market[]>([]);
  const [selectedMarket, setSelectedMarket] = useState('');
  const [selectedOutcomeId, setSelectedOutcomeId] = useState(0);
  const [yesStartCents, setYesStartCents] = useState(50);
  const [mintAmount, setMintAmount] = useState(100000);
  const [loadingMarkets, setLoadingMarkets] = useState(true);

  // Quote token resolved from the selected market's on-chain account.
  // Defaults to USDC; flips to SPACE (or whatever) once the market is fetched.
  const [quoteMint, setQuoteMint] = useState<PublicKey>(USDC_MINT);
  const [quoteDecimals, setQuoteDecimals] = useState<number>(USDC_DECIMALS);
  const quoteSymbol = useMemo(() => resolveQuoteSymbol(quoteMint), [quoteMint]);
  // minOrderSize is a share quantity (6 decimals), not quote base units.
  const minOrderSize = useMemo(
    () => humanToLamports(MIN_ORDER_SIZE_HUMAN, SHARE_DECIMALS),
    [],
  );

  // Execution state
  const [phase, setPhase] = useState<SeedPhase>('idle');
  const [progress, setProgress] = useState(0);
  const [totalSteps, setTotalSteps] = useState(0);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [successCount, setSuccessCount] = useState(0);
  const [failCount, setFailCount] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const logRef = useRef<HTMLDivElement>(null);

  const addLog = useCallback((message: string, type: LogEntry['type'] = 'info') => {
    setLogs(prev => [...prev, { message, type }]);
  }, []);

  // Auto-scroll log
  useEffect(() => {
    if (logRef.current) {
      logRef.current.scrollTop = logRef.current.scrollHeight;
    }
  }, [logs]);

  // Fetch active markets
  useEffect(() => {
    const fetchMarkets = async () => {
      try {
        const response = await axios.get(`${API_URL}/api/v1/markets?status=0&limit=100`);
        const marketsData = response.data.markets || response.data || [];
        setMarkets(marketsData);
        if (marketsData.length > 0 && !selectedMarket) {
          setSelectedMarket(marketsData[0].marketAddress || marketsData[0].id);
        }
      } catch (err) {
        console.error('Error fetching markets:', err);
        setError('Failed to load markets');
      } finally {
        setLoadingMarkets(false);
      }
    };
    fetchMarkets();
  }, []);

  const selectedMarketData = markets.find(
    m => (m.marketAddress || m.id) === selectedMarket
  );

  // Fetch market.quote_mint + market.quote_decimals from on-chain whenever the
  // selection changes. Pre-v2 (unmigrated) markets will read zero values — fall
  // back to USDC so the flow doesn't break.
  useEffect(() => {
    if (!selectedMarket || !program) return;
    let cancelled = false;
    (async () => {
      try {
        const marketPDA = new PublicKey(selectedMarket);
        const acct: any = await (program as any).account.market.fetch(marketPDA);
        if (cancelled) return;
        const qm: PublicKey | undefined = acct.quoteMint;
        const qd: number = Number(acct.quoteDecimals ?? 0);
        if (qm && !qm.equals(PublicKey.default) && qd > 0) {
          setQuoteMint(qm);
          setQuoteDecimals(qd);
        } else {
          setQuoteMint(USDC_MINT);
          setQuoteDecimals(USDC_DECIMALS);
        }
      } catch (e) {
        console.warn('Could not read quote_mint from market; defaulting to USDC', e);
        setQuoteMint(USDC_MINT);
        setQuoteDecimals(USDC_DECIMALS);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedMarket, program]);

  const isBinaryMarket = selectedMarketData ? (selectedMarketData.outcomes?.length ?? 0) <= 2 : false;

  // For binary markets, always use outcome 0 (YES/NO are token types, not separate outcomes)
  useEffect(() => {
    if (isBinaryMarket) {
      setSelectedOutcomeId(0);
    }
  }, [isBinaryMarket, selectedMarket]);

  const noStartCents = 100 - yesStartCents;

  // Compute order plan preview
  const orderPlanPreview = useMemo(() => {
    const yesSellCount = 99 - yesStartCents; // yesStart+1 to 99
    const yesBuyCount = yesStartCents;        // 1 to yesStart
    const noSellCount = 99 - noStartCents;    // noStart+1 to 99
    const noBuyCount = noStartCents;          // 1 to noStart
    const totalOrders = yesSellCount + yesBuyCount + noSellCount + noBuyCount;

    // Estimate quote-token needed for NO sell margins:
    // Average margin factor = avg((10000 - price_bps) / 10000) across NO sell levels
    let noSellMarginEst = 0;
    for (let c = noStartCents + 1; c <= 99; c++) {
      noSellMarginEst += (10000 - c * 100) / 10000;
    }
    const avgNoSellMarginFactor = noSellCount > 0 ? noSellMarginEst / noSellCount : 0;
    const noSellMarginQuote = Math.ceil(mintAmount * avgNoSellMarginFactor);
    const buyBudget = Math.floor(mintAmount * 0.1) * 2; // 10% per side
    const totalQuoteNeeded = mintAmount + noSellMarginQuote + buyBudget;

    return {
      yesSellCount, yesBuyCount, noSellCount, noBuyCount, totalOrders,
      yesSellRange: `${yesStartCents + 1}¢ — 99¢`,
      yesBuyRange: `1¢ — ${yesStartCents}¢`,
      noSellRange: `${noStartCents + 1}¢ — 99¢`,
      noBuyRange: `1¢ — ${noStartCents}¢`,
      noSellMarginQuote,
      buyBudget,
      totalQuoteNeeded,
    };
  }, [yesStartCents, noStartCents, mintAmount]);

  // Build all order plans
  // Order: YES sell → NO sell → YES buy → NO buy (sell first to use ALL minted tokens)
  // Each order is exactly minOrderSize (5K shares, scaled by quote decimals). Cycles through price levels
  // until tokens run out (< 5K remaining).
  function buildOrderPlans(): OrderPlan[] {
    const mintLamports = humanToLamports(mintAmount, SHARE_DECIMALS);

    // Price levels
    const yesSellLevels: number[] = [];
    for (let c = yesStartCents + 1; c <= 99; c++) yesSellLevels.push(c);

    const noSellLevels: number[] = [];
    for (let c = noStartCents + 1; c <= 99; c++) noSellLevels.push(c);

    const yesBuyLevels: number[] = [];
    for (let c = yesStartCents; c >= 1; c--) yesBuyLevels.push(c);

    const noBuyLevels: number[] = [];
    for (let c = noStartCents; c >= 1; c--) noBuyLevels.push(c);

    const orders: OrderPlan[] = [];

    // 1. YES sell — cycle through levels with minOrderSize chunks
    let yesRemaining = mintLamports;
    let yesSellIdx = 0;
    while (yesRemaining >= minOrderSize && yesSellLevels.length > 0) {
      const lvl = yesSellLevels[yesSellIdx % yesSellLevels.length];
      orders.push({ side: 'sell', tokenType: 'yes', priceCents: lvl, priceBps: lvl * 100, quantity: minOrderSize });
      yesRemaining -= minOrderSize;
      yesSellIdx++;
    }

    // 2. NO sell — cycle through levels with minOrderSize chunks
    let noRemaining = mintLamports;
    let noSellIdx = 0;
    while (noRemaining >= minOrderSize && noSellLevels.length > 0) {
      const lvl = noSellLevels[noSellIdx % noSellLevels.length];
      orders.push({ side: 'sell', tokenType: 'no', priceCents: lvl, priceBps: lvl * 100, quantity: minOrderSize });
      noRemaining -= minOrderSize;
      noSellIdx++;
    }

    // 3. YES buy — 10% of mint as quote-token budget, minOrderSize chunks
    const buyBudgetPerSide = Math.floor(mintLamports * 0.1);
    let yesBuyBudget = buyBudgetPerSide;
    let yesBuyIdx = 0;
    while (yesBuyBudget > 0 && yesBuyLevels.length > 0) {
      const lvl = yesBuyLevels[yesBuyIdx % yesBuyLevels.length];
      const priceBps = lvl * 100;
      const quoteCost = Math.ceil(minOrderSize * priceBps / 10000);
      if (yesBuyBudget < quoteCost) break;
      orders.push({ side: 'buy', tokenType: 'yes', priceCents: lvl, priceBps, quantity: minOrderSize });
      yesBuyBudget -= quoteCost;
      yesBuyIdx++;
    }

    // 4. NO buy — 10% of mint as quote-token budget, minOrderSize chunks
    let noBuyBudget = buyBudgetPerSide;
    let noBuyIdx = 0;
    while (noBuyBudget > 0 && noBuyLevels.length > 0) {
      const lvl = noBuyLevels[noBuyIdx % noBuyLevels.length];
      const priceBps = lvl * 100;
      const quoteCost = Math.ceil(minOrderSize * priceBps / 10000);
      if (noBuyBudget < quoteCost) break;
      orders.push({ side: 'buy', tokenType: 'no', priceCents: lvl, priceBps, quantity: minOrderSize });
      noBuyBudget -= quoteCost;
      noBuyIdx++;
    }

    return orders;
  }

  // Register order in backend DB
  async function registerOrderInDB(params: {
    marketId: string; outcomeId: number; side: 'buy' | 'sell';
    price: number; size: number; userId: string;
    onChainOrder: string; orderId: number; tokenType: 'yes' | 'no';
  }) {
    try {
      await fetch(`${API_URL}/api/v1/orders/limit`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-pubkey': params.userId },
        body: JSON.stringify({
          market_id: params.marketId, outcome_id: params.outcomeId,
          side: params.side, price: params.price, size: params.size,
          leverage: 1, token_type: params.tokenType,
          on_chain_order: params.onChainOrder, order_id: params.orderId,
        }),
      });
    } catch (err: any) {
      console.warn(`DB register failed for order ${params.orderId}: ${err.message}`);
    }
  }

  // Build a single order instruction
  async function buildOrderInstruction(
    order: OrderPlan,
    orderId: number,
    marketPDA: PublicKey,
    userPubkey: PublicKey,
  ) {
    if (!program) throw new Error('Program not loaded');

    const userUsdcATA = await getAssociatedTokenAddress(quoteMint, userPubkey);

    if (order.side === 'buy') {
      const [pendingOrderPDA] = getPendingOrderPDA(userPubkey, orderId);
      const [orderEscrowAuthorityPDA] = getOrderEscrowAuthorityPDA(userPubkey, orderId);
      const [orderEscrowPDA] = getOrderEscrowPDA(userPubkey, orderId);

      const ix = await program.methods
        .placeBuyOrder(new BN(orderId), selectedOutcomeId, new BN(order.priceBps), new BN(order.quantity), 1)
        .accounts({
          market: marketPDA, user: userPubkey, userUsdc: userUsdcATA,
          pendingOrder: pendingOrderPDA, orderEscrowAuthority: orderEscrowAuthorityPDA,
          orderEscrow: orderEscrowPDA, usdcMint: quoteMint,
          tokenProgram: TOKEN_PROGRAM_ID, systemProgram: SystemProgram.programId,
        })
        .instruction();
      return { ix, pendingOrderPDA };
    }

    if (order.tokenType === 'yes') {
      const [pendingOrderPDA] = getPendingOrderPDA(userPubkey, orderId);
      const [shareEscrowAuthorityPDA] = getShareEscrowAuthorityPDA(userPubkey, orderId);
      const [shareEscrowYesPDA] = getShareEscrowYesPDA(userPubkey, orderId);
      const [newYM] = getYesMintPDA(marketPDA, selectedOutcomeId);
      const [oldYM] = getYesMintPDA(marketPDA);
      const newYMInfo = await connection.getAccountInfo(newYM);
      const yesMintPDA = (newYMInfo && newYMInfo.data.length > 0) ? newYM : oldYM;
      const [spotPositionPDA] = getPositionPDA(marketPDA, userPubkey, selectedOutcomeId, 0, 0, 0); // token_type=0 (YES)
      const userYesATA = await getAssociatedTokenAddress(yesMintPDA, userPubkey);

      const ix = await program.methods
        .placeYesLimitSellOrder(new BN(orderId), selectedOutcomeId, new BN(order.priceBps), new BN(order.quantity), 1)
        .accounts({
          market: marketPDA, user: userPubkey, pendingOrder: pendingOrderPDA,
          userYesAccount: userYesATA, shareEscrowAuthority: shareEscrowAuthorityPDA,
          shareEscrowYes: shareEscrowYesPDA, yesMint: yesMintPDA,
          userPosition: spotPositionPDA, tokenProgram: TOKEN_PROGRAM_ID,
          systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
        })
        .instruction();
      return { ix, pendingOrderPDA };
    }

    // NO sell
    const [pendingOrderPDA] = getPendingOrderPDA(userPubkey, orderId);
    const [orderEscrowAuthorityPDA] = getOrderEscrowAuthorityPDA(userPubkey, orderId);
    const [orderEscrowPDA] = getOrderEscrowPDA(userPubkey, orderId);
    const [shareEscrowAuthorityPDA] = getShareEscrowAuthorityPDA(userPubkey, orderId);
    const [shareEscrowNoPDA] = getShareEscrowNoPDA(userPubkey, orderId);
    const [newNM] = getNoMintPDA(marketPDA, selectedOutcomeId);
    const [oldNM] = getNoMintPDA(marketPDA);
    const newNMInfo = await connection.getAccountInfo(newNM);
    const noMintPDA = (newNMInfo && newNMInfo.data.length > 0) ? newNM : oldNM;
    const [spotPositionPDA] = getPositionPDA(marketPDA, userPubkey, selectedOutcomeId, 0, 0, 1); // token_type=1 (NO)
    const userNoATA = await getAssociatedTokenAddress(noMintPDA, userPubkey);

    const ix = await program.methods
      .placeNoLimitSellOrder(new BN(orderId), selectedOutcomeId, new BN(order.priceBps), new BN(order.quantity), 1)
      .accounts({
        market: marketPDA, user: userPubkey, userUsdc: userUsdcATA,
        pendingOrder: pendingOrderPDA, orderEscrowAuthority: orderEscrowAuthorityPDA,
        orderEscrow: orderEscrowPDA, usdcMint: quoteMint,
        userNoAccount: userNoATA, shareEscrowAuthority: shareEscrowAuthorityPDA,
        shareEscrowNo: shareEscrowNoPDA, noMint: noMintPDA,
        userPosition: spotPositionPDA, tokenProgram: TOKEN_PROGRAM_ID,
        systemProgram: SystemProgram.programId, rent: SYSVAR_RENT_PUBKEY,
      })
      .instruction();
    return { ix, pendingOrderPDA };
  }

  // ── Helper: send a transaction (keypair or wallet mode) ──
  async function sendTransaction(
    tx: Transaction,
    keypair: Keypair | null,
  ): Promise<string> {
    if (keypair) {
      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      tx.recentBlockhash = blockhash;
      tx.lastValidBlockHeight = lastValidBlockHeight;
      tx.feePayer = keypair.publicKey;
      tx.sign(keypair);
      const sig = await connection.sendRawTransaction(tx.serialize(), { skipPreflight: true });
      await connection.confirmTransaction({ signature: sig, blockhash, lastValidBlockHeight });
      return sig;
    } else {
      return await provider!.sendAndConfirm(tx, [], { skipPreflight: true });
    }
  }

  // ── Main execution ──
  const handleSeed = async () => {
    if (!program) return;

    // Resolve signer
    let keypairObj: Keypair | null = null;
    let signerPubkey: PublicKey;

    if (signingMode === 'keypair') {
      try {
        const parsed = JSON.parse(keypairInput.trim());
        keypairObj = Keypair.fromSecretKey(new Uint8Array(parsed));
        signerPubkey = keypairObj.publicKey;
      } catch {
        setError('Invalid keypair. Paste your Solana CLI keypair JSON array (e.g. [1,2,3,...])');
        return;
      }
      addLog(`Using keypair: ${signerPubkey.toBase58().slice(0, 8)}...${signerPubkey.toBase58().slice(-8)}`, 'info');
    } else {
      if (!publicKey || !provider) {
        setError('Connect your wallet first');
        return;
      }
      signerPubkey = publicKey;
    }

    setError(null);
    setLogs([]);
    setSuccessCount(0);
    setFailCount(0);
    setProgress(0);

    const marketPDA = new PublicKey(selectedMarket);
    const mintLamports = humanToLamports(mintAmount, SHARE_DECIMALS);

    // ─── PHASE 1: Mint shares ───
    setPhase('minting');
    addLog(`Minting ${mintAmount.toLocaleString()} YES + NO tokens for outcome ${selectedOutcomeId}...`, 'info');

    try {
      if (keypairObj) {
        // Keypair mode: build mint tx manually
        const [marketVaultPDA] = getMarketVaultPDA(marketPDA);
        const [vaultAuthorityPDA] = getVaultAuthorityPDA(marketPDA);
        const [mintAuthorityPDA] = getMintAuthorityPDA(marketPDA);
        const [newYesMintPDA] = getYesMintPDA(marketPDA, selectedOutcomeId);
        const [oldYesMintPDA] = getYesMintPDA(marketPDA);
        const newYesMintCheck = await connection.getAccountInfo(newYesMintPDA);
        const yesMintPDA = (newYesMintCheck && newYesMintCheck.data.length > 0) ? newYesMintPDA : oldYesMintPDA;

        const [newNoMintPDA] = getNoMintPDA(marketPDA, selectedOutcomeId);
        const [oldNoMintPDA] = getNoMintPDA(marketPDA);
        const newNoMintCheck = await connection.getAccountInfo(newNoMintPDA);
        const noMintPDA = (newNoMintCheck && newNoMintCheck.data.length > 0) ? newNoMintPDA : oldNoMintPDA;

        const userUsdcATA = await getAssociatedTokenAddress(quoteMint, signerPubkey);
        const userYesATA = await getAssociatedTokenAddress(yesMintPDA, signerPubkey);
        const userNoATA = await getAssociatedTokenAddress(noMintPDA, signerPubkey);

        // Create ATAs if needed
        const preIxs: any[] = [];
        try { await getAccount(connection, userYesATA); } catch {
          preIxs.push(createAssociatedTokenAccountInstruction(signerPubkey, userYesATA, signerPubkey, yesMintPDA));
        }
        try { await getAccount(connection, userNoATA); } catch {
          preIxs.push(createAssociatedTokenAccountInstruction(signerPubkey, userNoATA, signerPubkey, noMintPDA));
        }

        const mintIx = await program.methods
          .mintShares(selectedOutcomeId, new BN(mintLamports))
          .accounts({
            market: marketPDA, user: signerPubkey, userUsdc: userUsdcATA,
            yesMint: yesMintPDA, noMint: noMintPDA,
            userYesAccount: userYesATA, userNoAccount: userNoATA,
            marketVault: marketVaultPDA, vaultAuthority: vaultAuthorityPDA,
            mintAuthority: mintAuthorityPDA, tokenProgram: TOKEN_PROGRAM_ID,
          })
          .instruction();

        const mintTx = new Transaction();
        preIxs.forEach(ix => mintTx.add(ix));
        mintTx.add(mintIx);
        const mintSig = await sendTransaction(mintTx, keypairObj);
        addLog(`Mint successful: ${mintSig}`, 'success');
      } else {
        // Wallet mode: use existing mintShares hook
        const mintResult = await mintShares({
          market: selectedMarket,
          outcomeId: selectedOutcomeId,
          amount: mintLamports,
        });
        addLog(`Mint successful: ${mintResult.transaction}`, 'success');
      }
    } catch (err: any) {
      addLog(`Mint failed: ${err.message}`, 'error');
      setError(`Mint failed. Make sure you have enough ${quoteSymbol}.`);
      setPhase('idle');
      return;
    }

    // Wait for confirmation propagation
    await new Promise(r => setTimeout(r, 2000));

    // ─── PHASE 2: Build order plans ───
    setPhase('building');
    addLog('Building order plans...', 'info');

    const orders = buildOrderPlans();
    addLog(`Built ${orders.length} orders: ${orders.filter(o => o.side === 'sell' && o.tokenType === 'yes').length} YES sell, ${orders.filter(o => o.side === 'buy' && o.tokenType === 'yes').length} YES buy, ${orders.filter(o => o.side === 'sell' && o.tokenType === 'no').length} NO sell, ${orders.filter(o => o.side === 'buy' && o.tokenType === 'no').length} NO buy`, 'info');

    setTotalSteps(orders.length);

    // ─── PHASE 3: Send orders ───
    setPhase('sending');
    addLog(`Sending ${orders.length} orders${keypairObj ? ' (auto-signing with keypair)' : ' via wallet'}...`, 'info');

    let sent = 0;
    let ok = 0;
    let fail = 0;

    for (let i = 0; i < orders.length; i++) {
      const order = orders[i];
      const orderId = nextOrderId();
      const tag = `${order.tokenType.toUpperCase()} ${order.side.toUpperCase()} ${order.priceCents}¢ qty=${(order.quantity / 1e6).toFixed(1)}`;

      try {
        const { ix, pendingOrderPDA } = await buildOrderInstruction(order, orderId, marketPDA, signerPubkey);
        const tx = new Transaction().add(ix);
        const sig = await sendTransaction(tx, keypairObj);

        addLog(`[${i + 1}/${orders.length}] ${tag} → ${sig.slice(0, 16)}...`, 'success');

        // Register in backend DB
        await registerOrderInDB({
          marketId: selectedMarket,
          outcomeId: selectedOutcomeId,
          side: order.side,
          price: order.priceBps,
          size: order.quantity,
          userId: signerPubkey.toBase58(),
          onChainOrder: pendingOrderPDA.toBase58(),
          orderId,
          tokenType: order.tokenType,
        });

        ok++;
        setSuccessCount(ok);
      } catch (err: any) {
        const msg = err.message?.slice(0, 100) || 'Unknown error';
        if (msg.includes('User rejected') || msg.includes('rejected the request')) {
          addLog(`User cancelled. Stopping.`, 'warn');
          break;
        }
        addLog(`[${i + 1}/${orders.length}] ${tag} FAILED: ${msg}`, 'error');
        fail++;
        setFailCount(fail);
      }

      sent++;
      setProgress(sent);

      // Small delay to avoid rate limiting
      if (i < orders.length - 1) {
        await new Promise(r => setTimeout(r, 300));
      }
    }

    // ─── DONE ───
    setPhase('done');
    addLog(`Complete! ${ok} succeeded, ${fail} failed out of ${orders.length} total.`, ok > 0 ? 'success' : 'error');
  };

  const isSeeding = phase !== 'idle' && phase !== 'done';

  if (!isAdmin) {
    return <AdminLayout title="Seed Order Book" description="Seed order books with automated market making" />;
  }

  return (
    <AdminLayout title="Seed Order Book" description="Seed order books with automated market making">
      <div className="max-w-3xl">
        {/* Header Card */}
        <div className="bg-gradient-to-r from-[#0a0a0a] to-[#111111] rounded-2xl p-6 border border-[#1a1a1a] mb-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-purple-500/10 border border-purple-500/20 flex items-center justify-center">
              <svg className="w-6 h-6 text-purple-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Order Book Seeder</h2>
              <p className="text-sm text-[#737373]">Mint tokens and place orders across all price levels</p>
            </div>
          </div>
        </div>

        <div className="bg-[#0a0a0a] rounded-2xl border border-[#1a1a1a] overflow-hidden">
          {/* Alerts */}
          <div className="p-6 space-y-4">
            {!connected && (
              <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4 flex items-start gap-3">
                <svg className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
                </svg>
                <p className="text-amber-400 text-sm">Please connect your wallet to seed order books.</p>
              </div>
            )}

            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 flex items-start gap-3">
                <svg className="w-5 h-5 text-red-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-red-400 text-sm">{error}</p>
              </div>
            )}
          </div>

          {loadingMarkets ? (
            <div className="p-12 text-center">
              <div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-white/20 border-t-white mb-4"></div>
              <p className="text-[#737373] text-sm">Loading markets...</p>
            </div>
          ) : (
            <div className="p-6 pt-0 space-y-6">
              {/* Market Selection */}
              <div>
                <label className="block text-sm font-medium text-white mb-3">Select Market</label>
                <select
                  value={selectedMarket}
                  onChange={(e) => {
                    setSelectedMarket(e.target.value);
                    setSelectedOutcomeId(0); // Reset to outcome 0 (binary always uses 0)
                  }}
                  disabled={isSeeding}
                  className="w-full px-4 py-3.5 bg-[#111111] border border-[#262626] rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-transparent appearance-none cursor-pointer transition-all disabled:opacity-50"
                  style={{ backgroundImage: `url("data:image/svg+xml,%3csvg xmlns='http://www.w3.org/2000/svg' fill='none' viewBox='0 0 20 20'%3e%3cpath stroke='%236b7280' stroke-linecap='round' stroke-linejoin='round' stroke-width='1.5' d='M6 8l4 4 4-4'/%3e%3c/svg%3e")`, backgroundPosition: 'right 0.75rem center', backgroundRepeat: 'no-repeat', backgroundSize: '1.5em 1.5em', paddingRight: '2.5rem' }}
                  required
                >
                  <option value="" className="bg-[#111111]">-- Select a market --</option>
                  {markets.map((market) => (
                    <option key={market.marketAddress || market.id} value={market.marketAddress || market.id} className="bg-[#111111]">
                      {market.title}
                    </option>
                  ))}
                </select>
                {selectedMarketData && (
                  <div className="mt-2 flex items-center gap-2">
                    <p className="text-xs text-[#525252] font-mono">{selectedMarket}</p>
                    <span className={`text-[10px] font-semibold px-2 py-0.5 rounded-full ${
                      isBinaryMarket
                        ? 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                        : 'bg-purple-500/10 text-purple-400 border border-purple-500/20'
                    }`}>
                      {isBinaryMarket ? 'Binary' : `Multi (${selectedMarketData.outcomes?.length} outcomes)`}
                    </span>
                  </div>
                )}
              </div>

              {/* Outcome Selection — only for multi-outcome markets */}
              {selectedMarketData && !isBinaryMarket && selectedMarketData.outcomes?.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-white mb-3">Select Outcome</label>
                  <div className="grid grid-cols-2 gap-3">
                    {selectedMarketData.outcomes.map((outcome: any, idx: number) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setSelectedOutcomeId(idx)}
                        disabled={isSeeding}
                        className={`p-4 rounded-xl border-2 text-left transition-all disabled:opacity-50 ${
                          selectedOutcomeId === idx
                            ? 'border-white bg-white/5'
                            : 'border-[#262626] hover:border-[#404040]'
                        }`}
                      >
                        <span className={`font-semibold ${selectedOutcomeId === idx ? 'text-white' : 'text-[#a3a3a3]'}`}>
                          {outcome.label || `Outcome ${idx}`}
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Binary market indicator */}
              {selectedMarketData && isBinaryMarket && (
                <div className="bg-[#111111] rounded-xl border border-[#1a1a1a] p-4 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-green-500/10 border border-green-500/20 flex items-center justify-center">
                    <svg className="w-4 h-4 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-white">Binary Market</p>
                    <p className="text-xs text-[#737373]">Seeds both YES and NO order books for outcome 0. The YES start price sets the initial midpoint — NO price is automatically derived as its complement.</p>
                  </div>
                </div>
              )}

              {/* YES Start Price */}
              <div>
                <label className="block text-sm font-medium text-white mb-3">
                  {isBinaryMarket ? 'Market Price' : 'YES Start Price'}: <span className="text-purple-400">{yesStartCents}¢</span>
                  <span className="text-[#525252] ml-2">(NO: {noStartCents}¢)</span>
                </label>
                <input
                  type="range"
                  min={1}
                  max={99}
                  value={yesStartCents}
                  onChange={(e) => setYesStartCents(parseInt(e.target.value))}
                  disabled={isSeeding}
                  className="w-full h-2 bg-[#262626] rounded-lg appearance-none cursor-pointer accent-purple-500 disabled:opacity-50"
                />
                <div className="flex justify-between text-xs text-[#525252] mt-1">
                  <span>1¢</span>
                  <span>50¢</span>
                  <span>99¢</span>
                </div>
                {/* Quick presets */}
                <div className="mt-3 flex gap-2">
                  {[20, 30, 40, 50, 60, 70, 80].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setYesStartCents(preset)}
                      disabled={isSeeding}
                      className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                        yesStartCents === preset
                          ? 'bg-white text-black font-semibold'
                          : 'bg-[#171717] text-[#737373] hover:bg-[#262626] hover:text-white'
                      } disabled:opacity-50`}
                    >
                      {preset}¢
                    </button>
                  ))}
                </div>
              </div>

              {/* Mint Amount */}
              <div>
                <label className="block text-sm font-medium text-white mb-3">
                  Mint Amount ({quoteSymbol})
                </label>
                <div className="relative">
                  <input
                    type="number"
                    value={mintAmount}
                    onChange={(e) => setMintAmount(parseFloat(e.target.value) || 0)}
                    disabled={isSeeding}
                    className="w-full px-4 py-4 bg-[#111111] border border-[#262626] rounded-xl text-white text-xl font-semibold focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-transparent pr-20 transition-all disabled:opacity-50"
                    placeholder="100000"
                    min="100"
                    step="1000"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[#525252] font-medium">{quoteSymbol}</span>
                </div>
                <div className="mt-3 flex gap-2">
                  {[1000, 10000, 50000, 100000].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setMintAmount(preset)}
                      disabled={isSeeding}
                      className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                        mintAmount === preset
                          ? 'bg-white text-black font-semibold'
                          : 'bg-[#171717] text-[#737373] hover:bg-[#262626] hover:text-white'
                      } disabled:opacity-50`}
                    >
                      {preset >= 1000 ? `${(preset / 1000).toFixed(0)}K` : preset}
                    </button>
                  ))}
                </div>
              </div>

              {/* Preview Panel */}
              <div className="bg-[#111111] rounded-xl border border-[#1a1a1a] overflow-hidden">
                <div className="px-4 py-3 border-b border-[#1a1a1a]">
                  <h3 className="text-sm font-semibold text-white">Order Plan Preview</h3>
                </div>
                <div className="p-4 space-y-3">
                  {isBinaryMarket && (
                    <p className="text-[10px] text-[#525252] uppercase tracking-wider font-semibold">Outcome 0 — YES {yesStartCents}¢ / NO {noStartCents}¢</p>
                  )}
                  {!isBinaryMarket && selectedMarketData && (
                    <p className="text-[10px] text-[#525252] uppercase tracking-wider font-semibold">
                      {selectedMarketData.outcomes?.[selectedOutcomeId]?.label || `Outcome ${selectedOutcomeId}`} — YES {yesStartCents}¢ / NO {noStartCents}¢
                    </p>
                  )}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-green-400">{isBinaryMarket ? 'YES Side' : 'YES Orders'}</p>
                      <div className="text-xs text-[#a3a3a3] space-y-1">
                        <p>Sell: {orderPlanPreview.yesSellRange} <span className="text-[#525252]">({orderPlanPreview.yesSellCount} levels)</span></p>
                        <p>Buy: {orderPlanPreview.yesBuyRange} <span className="text-[#525252]">({orderPlanPreview.yesBuyCount} levels)</span></p>
                      </div>
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs font-semibold text-red-400">{isBinaryMarket ? 'NO Side' : 'NO Orders'}</p>
                      <div className="text-xs text-[#a3a3a3] space-y-1">
                        <p>Sell: {orderPlanPreview.noSellRange} <span className="text-[#525252]">({orderPlanPreview.noSellCount} levels)</span></p>
                        <p>Buy: {orderPlanPreview.noBuyRange} <span className="text-[#525252]">({orderPlanPreview.noBuyCount} levels)</span></p>
                      </div>
                    </div>
                  </div>
                  <div className="border-t border-[#1a1a1a] pt-3 space-y-2">
                    <div className="flex justify-between">
                      <span className="text-xs text-[#737373]">Total orders</span>
                      <span className="text-sm font-semibold text-white">{orderPlanPreview.totalOrders}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-xs text-[#737373]">Minting cost</span>
                      <span className="text-xs text-[#a3a3a3]">{mintAmount.toLocaleString()} {quoteSymbol}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-xs text-[#737373]">NO sell margins (est.)</span>
                      <span className="text-xs text-[#a3a3a3]">~{orderPlanPreview.noSellMarginQuote.toLocaleString()} {quoteSymbol}</span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-xs text-[#737373]">Buy order budget (10%)</span>
                      <span className="text-xs text-[#a3a3a3]">~{orderPlanPreview.buyBudget.toLocaleString()} {quoteSymbol}</span>
                    </div>
                    <div className="flex justify-between border-t border-[#1a1a1a] pt-2">
                      <span className="text-xs font-semibold text-white">Total {quoteSymbol} needed (est.)</span>
                      <span className="text-sm font-semibold text-white">~{orderPlanPreview.totalQuoteNeeded.toLocaleString()} {quoteSymbol}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Signing Mode */}
              <div className="bg-[#111111] rounded-xl border border-[#1a1a1a] overflow-hidden">
                <div className="px-4 py-3 border-b border-[#1a1a1a]">
                  <h3 className="text-sm font-semibold text-white">Signing Mode</h3>
                </div>
                <div className="p-4 space-y-4">
                  <div className="flex gap-3">
                    <button
                      type="button"
                      onClick={() => setSigningMode('wallet')}
                      disabled={isSeeding}
                      className={`flex-1 px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all disabled:opacity-50 ${
                        signingMode === 'wallet'
                          ? 'border-white bg-white/5 text-white'
                          : 'border-[#262626] text-[#737373] hover:border-[#404040]'
                      }`}
                    >
                      Wallet (popup per tx)
                    </button>
                    <button
                      type="button"
                      onClick={() => setSigningMode('keypair')}
                      disabled={isSeeding}
                      className={`flex-1 px-4 py-3 rounded-xl border-2 text-sm font-medium transition-all disabled:opacity-50 ${
                        signingMode === 'keypair'
                          ? 'border-purple-500 bg-purple-500/5 text-purple-400'
                          : 'border-[#262626] text-[#737373] hover:border-[#404040]'
                      }`}
                    >
                      Keypair (auto-sign)
                    </button>
                  </div>

                  {signingMode === 'keypair' && (
                    <div className="space-y-2">
                      <textarea
                        value={keypairInput}
                        onChange={(e) => setKeypairInput(e.target.value)}
                        disabled={isSeeding}
                        placeholder="Paste your Solana keypair JSON array: [1,2,3,...,64 bytes]"
                        className="w-full px-4 py-3 bg-[#0a0a0a] border border-[#262626] rounded-xl text-white text-xs font-mono focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-transparent resize-none h-20 placeholder:text-[#404040] disabled:opacity-50"
                      />
                      <p className="text-xs text-[#525252]">
                        Your key stays in the browser and is never sent to any server. Same format as ~/.config/solana/id.json
                      </p>
                    </div>
                  )}
                </div>
              </div>

              {/* How it works */}
              <div className="bg-[#111111] rounded-xl border border-[#1a1a1a] overflow-hidden">
                <div className="px-4 py-3 border-b border-[#1a1a1a]">
                  <h3 className="text-sm font-semibold text-white">How It Works</h3>
                </div>
                <div className="p-4 space-y-2 text-xs text-[#737373]">
                  {isBinaryMarket ? (
                    <>
                      <p>1. Deposits {quoteSymbol} to mint YES + NO tokens for outcome 0</p>
                      <p>2. YES sell orders placed above the YES start price (e.g. {yesStartCents + 1}¢ — 99¢)</p>
                      <p>3. NO sell orders placed above the NO start price (e.g. {noStartCents + 1}¢ — 99¢)</p>
                      <p>4. Buy orders placed below each start price using 10% of mint amount</p>
                      <p>5. YES + NO prices are complementary: YES {yesStartCents}¢ ↔ NO {noStartCents}¢</p>
                    </>
                  ) : (
                    <>
                      <p>1. Deposits {quoteSymbol} to mint YES + NO tokens for the selected outcome</p>
                      <p>2. Places sell orders across all price levels above the start price</p>
                      <p>3. Places buy orders across all price levels below the start price</p>
                      <p>4. NO orders are the mirror (100 - YES price) within the same outcome</p>
                      <p>5. Each outcome must be seeded separately</p>
                    </>
                  )}
                  <p className="text-[#525252] mt-1">Token amounts are distributed randomly across levels.</p>
                </div>
              </div>

              {/* Progress Section */}
              {phase !== 'idle' && (
                <div className="bg-[#111111] rounded-xl border border-[#1a1a1a] overflow-hidden">
                  <div className="px-4 py-3 border-b border-[#1a1a1a] flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-white">Progress</h3>
                    <div className="flex items-center gap-2">
                      {/* Phase indicator */}
                      {['minting', 'building', 'sending', 'done'].map((p, idx) => (
                        <div key={p} className="flex items-center gap-1">
                          <div className={`w-2 h-2 rounded-full ${
                            phase === p ? 'bg-purple-400 animate-pulse' :
                            ['minting', 'building', 'sending', 'done'].indexOf(phase) > idx ? 'bg-green-400' :
                            'bg-[#404040]'
                          }`} />
                          <span className={`text-xs ${phase === p ? 'text-purple-400' : 'text-[#525252]'}`}>
                            {p === 'minting' ? 'Mint' : p === 'building' ? 'Build' : p === 'sending' ? 'Send' : 'Done'}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>

                  {/* Progress bar */}
                  {totalSteps > 0 && (
                    <div className="px-4 pt-3">
                      <div className="flex justify-between text-xs text-[#737373] mb-1">
                        <span>{progress} / {totalSteps} transactions</span>
                        <span>{totalSteps > 0 ? Math.round((progress / totalSteps) * 100) : 0}%</span>
                      </div>
                      <div className="w-full h-2 bg-[#262626] rounded-full overflow-hidden">
                        <div
                          className="h-full bg-purple-500 rounded-full transition-all duration-300"
                          style={{ width: `${totalSteps > 0 ? (progress / totalSteps) * 100 : 0}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {/* Success/Fail counts */}
                  {(successCount > 0 || failCount > 0) && (
                    <div className="px-4 pt-2 flex gap-4 text-xs">
                      <span className="text-green-400">{successCount} succeeded</span>
                      {failCount > 0 && <span className="text-red-400">{failCount} failed</span>}
                    </div>
                  )}

                  {/* Log panel */}
                  <div
                    ref={logRef}
                    className="m-4 p-3 bg-[#0a0a0a] rounded-lg max-h-60 overflow-y-auto font-mono text-xs space-y-1"
                  >
                    {logs.map((log, i) => (
                      <div key={i} className={
                        log.type === 'success' ? 'text-green-400' :
                        log.type === 'error' ? 'text-red-400' :
                        log.type === 'warn' ? 'text-amber-400' :
                        'text-[#737373]'
                      }>
                        {log.message}
                      </div>
                    ))}
                    {isSeeding && (
                      <div className="text-purple-400 animate-pulse">Processing...</div>
                    )}
                  </div>
                </div>
              )}

              {/* Action Buttons */}
              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => window.history.back()}
                  className="flex-1 px-6 py-4 bg-[#171717] hover:bg-[#262626] text-white font-medium rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleSeed}
                  disabled={
                    (signingMode === 'wallet' ? (!connected || !isReady) : !keypairInput.trim()) ||
                    isSeeding || programLoading || !selectedMarket || mintAmount <= 0
                  }
                  className="flex-1 px-6 py-4 bg-white hover:bg-neutral-200 text-black font-semibold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {isSeeding ? (
                    <>
                      <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                      </svg>
                      {phase === 'minting' ? 'Minting...' : phase === 'building' ? 'Building...' : 'Sending...'}
                    </>
                  ) : phase === 'done' ? (
                    <>
                      Seed Again
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                      </svg>
                    </>
                  ) : (
                    <>
                      Seed Order Book
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </>
                  )}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
