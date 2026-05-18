import { useState, useEffect, useMemo } from 'react';
import { AdminLayout } from '@/components/AdminLayout';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useSpaceProgram } from '@/hooks/useSpaceProgram';
import { PublicKey, Transaction, ComputeBudgetProgram } from '@solana/web3.js';
import { getAccount, getAssociatedTokenAddress, createTransferInstruction } from '@solana/spl-token';
import {
  USDC_MINT,
  USDC_DECIMALS,
  SPACE_MINT,
  SPACE_CORE_PROGRAM_ID,
} from '@/utils/solana';
import axios from 'axios';
import { isAdminWallet } from '@/utils/admin';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

function resolveQuoteSymbol(mint: PublicKey): string {
  if (mint.equals(USDC_MINT)) return 'USDC';
  if (mint.equals(SPACE_MINT)) return 'SPC';
  return 'QUOTE';
}

interface Market {
  id: string;
  marketAddress: string;
  title: string;
  status: number;
}

// Helper to get liquidity vault PDA
function getLiquidityVaultPDA(marketPubkey: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('liquidity_vault'), marketPubkey.toBuffer()],
    SPACE_CORE_PROGRAM_ID
  );
}

export default function FundLiquidityVault() {
  const { connected, publicKey, signTransaction } = useWallet();
  const { connection } = useConnection();
  const { program } = useSpaceProgram();

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [selectedMarket, setSelectedMarket] = useState<string>('');
  const [amount, setAmount] = useState<number>(1000);
  const [liquidityVaultBalance, setLiquidityVaultBalance] = useState<number | null>(null);
  const [marketVaultBalance, setMarketVaultBalance] = useState<number | null>(null);
  const [userQuoteBalance, setUserQuoteBalance] = useState<number | null>(null);
  const [loadingMarkets, setLoadingMarkets] = useState(true);
  const [loading, setLoading] = useState(false);
  const [liquidityVaultAddress, setLiquidityVaultAddress] = useState<string>('');

  // Quote token resolved from the selected market. All balances and the
  // user-funded transfer use this token, not a hardcoded USDC mint.
  const [quoteMint, setQuoteMint] = useState<PublicKey>(USDC_MINT);
  const [quoteDecimals, setQuoteDecimals] = useState<number>(USDC_DECIMALS);
  const quoteSymbol = useMemo(() => resolveQuoteSymbol(quoteMint), [quoteMint]);
  const quoteUnit = useMemo(() => Math.pow(10, quoteDecimals), [quoteDecimals]);

  const isAdmin = isAdminWallet(connected, publicKey);

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

  // Fetch market.quote_mint + quote_decimals from on-chain whenever the
  // selection changes. Pre-v2 (unmigrated) markets read zero values — fall back
  // to USDC so the flow doesn't break on legacy accounts.
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

  // Fetch vault balances, denominated in the market's quote token
  useEffect(() => {
    const fetchBalances = async () => {
      if (!selectedMarket || !connection) {
        setLiquidityVaultBalance(null);
        setMarketVaultBalance(null);
        return;
      }

      try {
        const marketPDA = new PublicKey(selectedMarket);

        const [liquidityVaultPDA] = getLiquidityVaultPDA(marketPDA);
        setLiquidityVaultAddress(liquidityVaultPDA.toBase58());

        try {
          const liquidityAccount = await getAccount(connection, liquidityVaultPDA);
          setLiquidityVaultBalance(Number(liquidityAccount.amount) / quoteUnit);
        } catch {
          setLiquidityVaultBalance(0);
        }

        const [marketVaultPDA] = PublicKey.findProgramAddressSync(
          [Buffer.from('vault'), marketPDA.toBuffer()],
          SPACE_CORE_PROGRAM_ID
        );
        try {
          const marketVaultAccount = await getAccount(connection, marketVaultPDA);
          setMarketVaultBalance(Number(marketVaultAccount.amount) / quoteUnit);
        } catch {
          setMarketVaultBalance(0);
        }
      } catch (err) {
        console.error('Error fetching balances:', err);
      }
    };

    fetchBalances();
    const interval = setInterval(fetchBalances, 10000);
    return () => clearInterval(interval);
  }, [selectedMarket, connection, quoteUnit]);

  // Fetch user's balance in the market's quote token (not hardcoded USDC)
  useEffect(() => {
    const fetchUserBalance = async () => {
      if (!publicKey || !connection) {
        setUserQuoteBalance(null);
        return;
      }

      try {
        const userQuoteATA = await getAssociatedTokenAddress(quoteMint, publicKey);
        const account = await getAccount(connection, userQuoteATA);
        setUserQuoteBalance(Number(account.amount) / quoteUnit);
      } catch {
        setUserQuoteBalance(0);
      }
    };

    fetchUserBalance();
    const interval = setInterval(fetchUserBalance, 10000);
    return () => clearInterval(interval);
  }, [publicKey, connection, quoteMint, quoteUnit]);

  const selectedMarketData = markets.find(
    m => (m.marketAddress || m.id) === selectedMarket
  );

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setSuccess(null);

    if (!connected || !publicKey) {
      setError('Please connect your wallet');
      return;
    }

    if (!selectedMarket) {
      setError('Please select a market');
      return;
    }

    if (amount <= 0) {
      setError('Amount must be greater than 0');
      return;
    }

    if (userQuoteBalance !== null && amount > userQuoteBalance) {
      setError(`Insufficient ${quoteSymbol} balance. You have ${userQuoteBalance.toFixed(2)} ${quoteSymbol}`);
      return;
    }

    setLoading(true);

    try {
      const marketPDA = new PublicKey(selectedMarket);
      const [liquidityVaultPDA] = getLiquidityVaultPDA(marketPDA);
      const userQuoteATA = await getAssociatedTokenAddress(quoteMint, publicKey);

      // Preflight: verify the liquidity vault is an initialized SPL token
      // account on the right mint. If `initializeMarketVaults` never landed
      // (or landed for a different mint) the SPL Transfer would fail with
      // a generic WalletSendTransactionError; this gives a clearer error.
      try {
        const vaultAcct = await getAccount(connection, liquidityVaultPDA);
        if (!vaultAcct.mint.equals(quoteMint)) {
          setError(
            `Mint mismatch: liquidity vault is for ${vaultAcct.mint.toBase58()}, ` +
            `but selected quote mint is ${quoteMint.toBase58()}. ` +
            `This market was initialized with a different quote token.`,
          );
          setLoading(false);
          return;
        }
      } catch (vaultErr: any) {
        setError(
          `Liquidity vault account does not exist on-chain at ${liquidityVaultPDA.toBase58()}. ` +
          `The market's vaults were never initialized (initializeMarketVaults didn't land). ` +
          `Re-run market creation step 2 before funding.`,
        );
        setLoading(false);
        return;
      }

      const amountLamports = BigInt(Math.floor(amount * quoteUnit));

      const transferIx = createTransferInstruction(
        userQuoteATA,
        liquidityVaultPDA,
        publicKey,
        amountLamports
      );

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash('confirmed');

      const tx = new Transaction({
        feePayer: publicKey,
        blockhash,
        lastValidBlockHeight,
      }).add(
        // Tiny priority fee so the tx isn't last-in-line under devnet load.
        ComputeBudgetProgram.setComputeUnitLimit({ units: 200_000 }),
        ComputeBudgetProgram.setComputeUnitPrice({ microLamports: 50_000 }),
        transferIx,
      );

      // Sign and send in two explicit steps so we can see WHICH one fails.
      // The wallet adapter's `sendTransaction` swallows the underlying
      // error (it wraps everything in WalletSendTransactionError with an
      // empty message). Splitting them lets us print real diagnostics.
      if (!signTransaction) {
        throw new Error('Wallet does not support signTransaction');
      }

      console.log('[fund-liquidity] signing tx (network must be DEVNET)...');
      let signed;
      try {
        signed = await signTransaction(tx);
      } catch (signErr: any) {
        console.error('[fund-liquidity] signTransaction failed:', signErr);
        throw new Error(
          `Wallet refused to sign. Common causes:\n` +
          `1) Wallet is on the wrong network (must be DEVNET).\n` +
          `2) Wallet was disconnected. Try reconnecting.\n\n` +
          `Underlying: ${signErr?.message || signErr?.toString() || 'unknown'}`,
        );
      }

      console.log('[fund-liquidity] tx signed, sending raw...');
      let signature: string;
      try {
        signature = await connection.sendRawTransaction(signed.serialize(), {
          skipPreflight: true,
          preflightCommitment: 'confirmed',
          maxRetries: 3,
        });
      } catch (sendErr: any) {
        console.error('[fund-liquidity] sendRawTransaction failed:', sendErr);
        const sendLogs: string[] | undefined = sendErr?.logs;
        const detail = sendLogs && sendLogs.length > 0 ? `\n\nRPC logs:\n${sendLogs.slice(-10).join('\n')}` : '';
        throw new Error(`RPC rejected the transaction: ${sendErr?.message || 'unknown'}${detail}`);
      }
      console.log('[fund-liquidity] sent, signature:', signature);

      // Blockhash-based confirmation — works without a WS subscription, so
      // it succeeds even if NEXT_PUBLIC_SOLANA_WS_URL isn't configured.
      const result = await connection.confirmTransaction(
        { signature, blockhash, lastValidBlockHeight },
        'confirmed',
      );
      if (result.value.err) {
        throw new Error(`On-chain error: ${JSON.stringify(result.value.err)}`);
      }

      setSuccess(
        `Liquidity vault funded successfully!\n\n` +
        `Market: ${selectedMarketData?.title || selectedMarket}\n` +
        `Amount: ${amount.toLocaleString()} ${quoteSymbol}\n` +
        `Vault: ${liquidityVaultPDA.toBase58()}\n\n` +
        `Transaction: ${signature}\n\n` +
        `View on Solscan: https://solscan.io/tx/${signature}?cluster=devnet`
      );

      // Reset and refresh
      setAmount(1000);
    } catch (err: any) {
      // Dump every property on the error so we can see what the wallet
      // adapter is actually complaining about. WalletSendTransactionError
      // hides the real cause in `.cause` or `.error`.
      console.error('Error funding liquidity vault:', err);
      console.error('  err.name:', err?.name);
      console.error('  err.message:', err?.message);
      console.error('  err.cause:', err?.cause);
      console.error('  err.error:', err?.error);
      console.error('  err.logs:', err?.logs);
      console.error('  err.cause?.logs:', err?.cause?.logs);
      console.error('  err.transactionMessage:', err?.transactionMessage);

      const logs: string[] | undefined = err?.logs || err?.cause?.logs;
      const detail = logs && logs.length > 0
        ? `\n\nProgram logs:\n${logs.slice(-10).join('\n')}`
        : '';
      const causeMsg = err?.cause?.message ? `\n\nUnderlying cause: ${err.cause.message}` : '';
      setError((err.message || 'Failed to fund liquidity vault') + causeMsg + detail);
    } finally {
      setLoading(false);
    }
  };

  // Auth is handled by AdminLayout
  if (!isAdmin) {
    return <AdminLayout title="Fund Liquidity Vault" description="Add quote liquidity for leverage trading" />;
  }

  return (
    <AdminLayout title="Fund Liquidity Vault" description="Add the market's quote token to the liquidity vault — lent to leveraged traders">
      <div className="max-w-2xl">
        {/* Header Card */}
        <div className="bg-gradient-to-r from-[#0a0a0a] to-[#111111] rounded-2xl p-6 border border-[#1a1a1a] mb-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-cyan-500/10 border border-cyan-500/20 flex items-center justify-center">
              <span className="text-2xl">🏦</span>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Liquidity Vault</h2>
              <p className="text-sm text-[#737373]">Fund the vault that enables leverage trading</p>
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
                <p className="text-amber-400 text-sm">Please connect your wallet to fund the liquidity vault.</p>
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

            {success && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-4 flex items-start gap-3">
                <svg className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <p className="text-emerald-400 text-sm whitespace-pre-wrap">{success}</p>
              </div>
            )}
          </div>

          {loadingMarkets ? (
            <div className="p-12 text-center">
              <div className="inline-block animate-spin rounded-full h-10 w-10 border-4 border-white/20 border-t-white mb-4"></div>
              <p className="text-[#737373] text-sm">Loading markets...</p>
            </div>
          ) : (
            <form onSubmit={handleSubmit} className="p-6 pt-0 space-y-6">
              {/* Market Selection */}
              <div>
                <label className="block text-sm font-medium text-white mb-3">
                  Select Market
                </label>
                <select
                  value={selectedMarket}
                  onChange={(e) => setSelectedMarket(e.target.value)}
                  className="w-full px-4 py-3.5 bg-[#111111] border border-[#262626] rounded-xl text-white focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-transparent appearance-none cursor-pointer transition-all"
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
                {liquidityVaultAddress && (
                  <p className="mt-2 text-xs text-[#525252]">
                    Vault: <span className="font-mono text-[#737373]">{liquidityVaultAddress}</span>
                  </p>
                )}
              </div>

              {/* Balance Display */}
              {selectedMarket && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-[#111111] rounded-xl p-4 border border-[#1a1a1a]">
                    <div className="text-xs text-[#525252] mb-1 uppercase tracking-wider">Liquidity Vault</div>
                    <div className="text-xl font-semibold text-cyan-400">
                      {liquidityVaultBalance !== null
                        ? liquidityVaultBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                        : '—'}
                      <span className="text-[#525252] text-sm ml-1">{quoteSymbol}</span>
                    </div>
                    <div className="text-xs text-[#525252] mt-1">For leverage lending</div>
                  </div>
                  <div className="bg-[#111111] rounded-xl p-4 border border-[#1a1a1a]">
                    <div className="text-xs text-[#525252] mb-1 uppercase tracking-wider">Market Vault</div>
                    <div className="text-xl font-semibold text-white">
                      {marketVaultBalance !== null
                        ? marketVaultBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                        : '—'}
                      <span className="text-[#525252] text-sm ml-1">{quoteSymbol}</span>
                    </div>
                    <div className="text-xs text-[#525252] mt-1">For spot trading</div>
                  </div>
                </div>
              )}

              {/* User Balance */}
              {publicKey && (
                <div className="bg-[#111111] rounded-xl p-4 border border-[#1a1a1a]">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-[#737373]">Your {quoteSymbol} Balance</span>
                    <span className="text-lg font-semibold text-white">
                      {userQuoteBalance !== null
                        ? userQuoteBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
                        : '—'}
                      <span className="text-[#525252] text-sm ml-1">{quoteSymbol}</span>
                    </span>
                  </div>
                </div>
              )}

              {/* Amount Input */}
              <div>
                <label className="block text-sm font-medium text-white mb-3">
                  Amount to Deposit
                </label>
                <div className="relative">
                  <input
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => {
                      const val = e.target.value.replace(/[^0-9.]/g, '');
                      const num = parseFloat(val);
                      setAmount(isNaN(num) ? 0 : num);
                    }}
                    className="w-full px-4 py-4 bg-[#111111] border border-[#262626] rounded-xl text-white text-xl font-semibold focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-transparent pr-20 transition-all"
                    placeholder="1000"
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[#525252] font-medium">
                    {quoteSymbol}
                  </span>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {[100, 500, 1000, 5000, 10000].map((preset) => (
                    <button
                      key={preset}
                      type="button"
                      onClick={() => setAmount(preset)}
                      className={`px-3 py-1.5 text-xs rounded-lg transition-colors ${
                        amount === preset
                          ? 'bg-white text-black font-semibold'
                          : 'bg-[#171717] text-[#737373] hover:bg-[#262626] hover:text-white'
                      }`}
                    >
                      {preset >= 1000 ? `${(preset / 1000).toFixed(0)}K` : preset}
                    </button>
                  ))}
                  {userQuoteBalance && userQuoteBalance > 0 && (
                    <button
                      type="button"
                      onClick={() => setAmount(Math.floor(userQuoteBalance))}
                      className="px-3 py-1.5 text-xs bg-cyan-500/10 text-cyan-400 hover:bg-cyan-500/20 rounded-lg transition-colors font-medium"
                    >
                      MAX
                    </button>
                  )}
                </div>
              </div>

              {/* Leverage Example */}
              <div className="bg-[#111111] rounded-xl border border-[#1a1a1a] overflow-hidden">
                <div className="px-4 py-3 border-b border-[#1a1a1a]">
                  <h3 className="text-sm font-semibold text-white flex items-center gap-2">
                    <span>📊</span> Leverage Example
                  </h3>
                </div>
                <div className="p-4 text-xs text-[#737373] space-y-2">
                  <p>If a trader buys <span className="text-white font-semibold">100 {quoteSymbol}</span> at <span className="text-cyan-400 font-semibold">3x</span> leverage:</p>
                  <div className="grid grid-cols-3 gap-2 mt-3">
                    <div className="bg-[#0a0a0a] rounded-lg p-3 text-center">
                      <div className="text-white font-semibold">33.33 {quoteSymbol}</div>
                      <div className="text-[#525252] text-[10px] mt-1">User Margin</div>
                    </div>
                    <div className="bg-[#0a0a0a] rounded-lg p-3 text-center">
                      <div className="text-cyan-400 font-semibold">66.67 {quoteSymbol}</div>
                      <div className="text-[#525252] text-[10px] mt-1">From Vault</div>
                    </div>
                    <div className="bg-[#0a0a0a] rounded-lg p-3 text-center">
                      <div className="text-emerald-400 font-semibold">100 {quoteSymbol}</div>
                      <div className="text-[#525252] text-[10px] mt-1">Total Position</div>
                    </div>
                  </div>
                  <p className="mt-3 text-[#525252]">
                    Current vault can support ~<span className="text-white">{((liquidityVaultBalance || 0) * 1.5).toFixed(0)}</span> {quoteSymbol} in 3x positions
                  </p>
                </div>
              </div>

              <div className="flex items-center gap-4">
                <button
                  type="button"
                  onClick={() => window.history.back()}
                  className="flex-1 px-6 py-4 bg-[#171717] hover:bg-[#262626] text-white font-medium rounded-xl transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!connected || loading || amount <= 0 || !selectedMarket}
                  className="flex-1 px-6 py-4 bg-white hover:bg-neutral-200 text-black font-semibold rounded-xl transition-all disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                >
                  {loading ? (
                    <>
                      <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                      </svg>
                      Funding...
                    </>
                  ) : (
                    <>
                      Fund Vault
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
                      </svg>
                    </>
                  )}
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </AdminLayout>
  );
}
