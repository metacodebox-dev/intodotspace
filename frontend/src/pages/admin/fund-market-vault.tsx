import { useState, useEffect, useMemo } from 'react';
import { AdminLayout } from '@/components/AdminLayout';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { useSpaceProgram } from '@/hooks/useSpaceProgram';
import {
  getMarketVaultPDA,
  humanToLamports,
  USDC_MINT,
  USDC_DECIMALS,
  SPACE_MINT,
} from '@/utils/solana';
import { PublicKey } from '@solana/web3.js';
import { getAccount } from '@solana/spl-token';
import axios from 'axios';
import { isAdminWallet } from '@/utils/admin';

function resolveQuoteSymbol(mint: PublicKey): string {
  if (mint.equals(USDC_MINT)) return 'USDC';
  if (mint.equals(SPACE_MINT)) return 'SPC';
  return 'QUOTE';
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface Market {
  id: string;
  marketAddress: string;
  title: string;
  status: number;
  outcomes: any[];
}

export default function FundMarketVault() {
  const { connected, publicKey } = useWallet();
  const { connection } = useConnection();
  const { mintShares, program, isReady, loading } = useSpaceProgram();

  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [selectedMarket, setSelectedMarket] = useState<string>('');
  const [selectedOutcomeId, setSelectedOutcomeId] = useState<number>(0);
  const [amount, setAmount] = useState<number>(1000);
  const [vaultBalance, setVaultBalance] = useState<number | null>(null);
  const [loadingMarkets, setLoadingMarkets] = useState(true);

  // Quote token resolved from the selected market's on-chain account.
  // Defaults to USDC; flips to SPACE (or whatever) once the market is fetched.
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

  // Fetch vault balance when market or quote decimals change
  useEffect(() => {
    const fetchVaultBalance = async () => {
      if (!selectedMarket || !connection) {
        setVaultBalance(null);
        return;
      }

      try {
        const marketPDA = new PublicKey(selectedMarket);
        const [vaultPDA] = getMarketVaultPDA(marketPDA);
        const vaultAccount = await getAccount(connection, vaultPDA);
        setVaultBalance(Number(vaultAccount.amount) / quoteUnit);
      } catch (err) {
        console.error('Error fetching vault balance:', err);
        setVaultBalance(null);
      }
    };

    fetchVaultBalance();
    const interval = setInterval(fetchVaultBalance, 10000); // Refresh every 10 seconds
    return () => clearInterval(interval);
  }, [selectedMarket, connection, quoteUnit]);

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

    if (!isReady) {
      setError('Program not ready. Please wait...');
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

    try {
      // `amount` is share units (6 decimals). The program scales share→quote
      // using quote_decimals for the token transfer, so we always send
      // share-unit lamports here regardless of the quote token.
      const amountInLamports = humanToLamports(amount, USDC_DECIMALS);

      const result = await mintShares({
        market: selectedMarket,
        outcomeId: selectedOutcomeId,
        amount: amountInLamports,
      });

      setSuccess(
        `Market vault funded successfully!\n` +
        `Market: ${selectedMarketData?.title || selectedMarket}\n` +
        `Amount: ${amount.toLocaleString()} ${quoteSymbol}\n` +
        `Outcome: ${selectedMarketData?.outcomes?.[selectedOutcomeId]?.label || `Outcome ${selectedOutcomeId}`}\n` +
        `You received: ${amount.toLocaleString()} YES + ${amount.toLocaleString()} NO shares\n\n` +
        `Transaction: ${result.transaction}\n\n` +
        `View on Solscan: https://solscan.io/tx/${result.transaction}`
      );

      // Reset form
      setAmount(1000);

      // Refresh vault balance
      setTimeout(() => {
        try {
          const marketPDA = new PublicKey(selectedMarket);
          const [vaultPDA] = getMarketVaultPDA(marketPDA);
          getAccount(connection, vaultPDA).then(vaultAccount => {
            setVaultBalance(Number(vaultAccount.amount) / quoteUnit);
          }).catch(() => {});
        } catch (err) {
          // Ignore errors
        }
      }, 2000);
    } catch (err: any) {
      console.error('Error funding market vault:', err);
      setError(err.message || 'Failed to fund market vault');
    }
  };

  // Auth is handled by AdminLayout
  if (!isAdmin) {
    return <AdminLayout title="Fund Market Vault" description="Add liquidity by minting shares" />;
  }

  return (
    <AdminLayout title="Fund Market Vault" description="Add liquidity to market vaults by minting shares">
      <div className="max-w-2xl">
        {/* Header Card */}
        <div className="bg-gradient-to-r from-[#0a0a0a] to-[#111111] rounded-2xl p-6 border border-[#1a1a1a] mb-6">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-blue-500/10 border border-blue-500/20 flex items-center justify-center">
              <span className="text-2xl">💰</span>
            </div>
            <div>
              <h2 className="text-lg font-semibold text-white">Market Vault Funding</h2>
              <p className="text-sm text-[#737373]">Deposit {quoteSymbol} and receive YES + NO shares</p>
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
                <p className="text-amber-400 text-sm">Please connect your wallet to fund market vaults.</p>
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
                  onChange={(e) => {
                    setSelectedMarket(e.target.value);
                    setSelectedOutcomeId(0);
                  }}
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
                {selectedMarketData && (
                  <p className="mt-2 text-xs text-[#525252] font-mono">
                    {selectedMarket}
                  </p>
                )}
              </div>

              {/* Outcome Selection */}
              {selectedMarketData && selectedMarketData.outcomes && selectedMarketData.outcomes.length > 0 && (
                <div>
                  <label className="block text-sm font-medium text-white mb-3">
                    Select Outcome
                  </label>
                  <div className="grid grid-cols-2 gap-3">
                    {selectedMarketData.outcomes.map((outcome: any, idx: number) => (
                      <button
                        key={idx}
                        type="button"
                        onClick={() => setSelectedOutcomeId(idx)}
                        className={`p-4 rounded-xl border-2 text-left transition-all ${
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
                  <p className="mt-2 text-xs text-[#525252]">
                    You'll receive YES shares for this outcome + NO shares
                  </p>
                </div>
              )}

              {/* Current Vault Balance */}
              {vaultBalance !== null && (
                <div className="bg-[#111111] rounded-xl p-4 border border-[#1a1a1a]">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-[#737373]">Current Vault Balance</span>
                    <span className="text-xl font-semibold text-white">
                      {vaultBalance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} <span className="text-[#525252] text-sm">{quoteSymbol}</span>
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
                    type="number"
                    value={amount}
                    onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
                    className="w-full px-4 py-4 bg-[#111111] border border-[#262626] rounded-xl text-white text-xl font-semibold focus:outline-none focus:ring-2 focus:ring-white/20 focus:border-transparent pr-20 transition-all"
                    placeholder="1000"
                    min="1"
                    step="100"
                    required
                  />
                  <span className="absolute right-4 top-1/2 -translate-y-1/2 text-[#525252] font-medium">
                    {quoteSymbol}
                  </span>
                </div>
                <div className="mt-3 flex gap-2">
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
                </div>
                <div className="mt-4 p-3 bg-[#111111] rounded-xl border border-[#1a1a1a]">
                  <p className="text-sm text-[#a3a3a3]">
                    You'll receive: <span className="text-white font-semibold">{amount.toLocaleString()} YES</span> + <span className="text-white font-semibold">{amount.toLocaleString()} NO</span> shares
                  </p>
                </div>
              </div>

              {/* How it works */}
              <div className="bg-[#111111] rounded-xl border border-[#1a1a1a] overflow-hidden">
                <div className="px-4 py-3 border-b border-[#1a1a1a]">
                  <h3 className="text-sm font-semibold text-white">How It Works</h3>
                </div>
                <div className="p-4 space-y-2 text-xs text-[#737373]">
                  <p>• Depositing {quoteSymbol} adds liquidity to the market</p>
                  <p>• You receive 1 YES + 1 NO share per {quoteSymbol}</p>
                  <p>• Shares can be burned later to redeem at 1:1 ratio</p>
                  <p>• This is useful for bootstrapping markets</p>
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
                  disabled={!connected || !isReady || loading || amount <= 0 || !selectedMarket}
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
