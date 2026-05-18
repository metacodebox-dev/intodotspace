import { useState, useEffect, useCallback } from 'react';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { useSpaceProgram } from '@/hooks/useSpaceProgram';
import { AdminLayout } from '@/components/AdminLayout';
import { isAdminWallet } from '@/utils/admin';

const MARKET_STATUS = ['Active', 'Resolving', 'Disputed', 'Finalized', 'Invalid'];
const RESOLUTION_TYPE = ['TWAP', 'Oracle', 'Manual'];

interface MarketInfo {
  publicKey: string;
  title: string;
  status: number;
  resolvedOutcome: number | null;
  numOutcomes: number;
  outcomes: Array<{ id: number; label: string; lastPrice: number }>;
  endDate: number;
  resolutionType: number;
  challengeTimestamp: number | null;
  resolveTimestamp: number | null;
}

const FINALIZE_WAIT_SECONDS = 10 * 60;
const RESOLVE_TIME_KEY = (pubkey: string) => `resolveTime:${pubkey}`;

// Solana base58 pubkeys are 32-44 chars in this alphabet. Anything else
// (integer DB ids, `jup_evt_*` synthetic ids, empty strings) makes
// `new PublicKey(...)` throw synchronously.
const BASE58_RE = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
function isValidSolanaPubkey(s: string | null | undefined): boolean {
  return typeof s === 'string' && BASE58_RE.test(s);
}

const getStoredResolveTime = (pubkey: string): number | null => {
  if (typeof window === 'undefined') return null;
  const v = window.localStorage.getItem(RESOLVE_TIME_KEY(pubkey));
  const n = v ? parseInt(v, 10) : NaN;
  return Number.isFinite(n) ? n : null;
};

const setStoredResolveTime = (pubkey: string, sec: number) => {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(RESOLVE_TIME_KEY(pubkey), String(sec));
};

const clearStoredResolveTime = (pubkey: string) => {
  if (typeof window === 'undefined') return;
  window.localStorage.removeItem(RESOLVE_TIME_KEY(pubkey));
};

export default function ResolveMarket() {
  const { connected, publicKey } = useWallet();
  const wallet = useWallet();
  const { 
    resolveMarketTwap, 
    resolveMarketOracle, 
    finalizeMarket,
    challengeResolution,
    fetchMarket,
    syncMarketStatusToBackend,
    loading, 
    isReady 
  } = useSpaceProgram();

  const [markets, setMarkets] = useState<MarketInfo[]>([]);
  const [selectedMarket, setSelectedMarket] = useState<string>('');
  const [selectedOutcome, setSelectedOutcome] = useState<number>(0);
  const [resolutionMethod, setResolutionMethod] = useState<'twap' | 'oracle'>('oracle');
  const [bondAmount, setBondAmount] = useState<string>('100');
  const [status, setStatus] = useState<{ type: 'success' | 'error' | 'info'; message: string } | null>(null);
  const [loadingMarkets, setLoadingMarkets] = useState(false);
  const [nowSec, setNowSec] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    const id = setInterval(() => setNowSec(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  const isAdmin = isAdminWallet(connected, publicKey);

  // Function to fetch on-chain market status
  const fetchOnChainStatus = useCallback(async (marketPubkey: string): Promise<{ status: number; resolvedOutcome: number | null; resolveTimestamp: number | null } | null> => {
    if (!isReady || !fetchMarket) return null;
    // Guard: `new PublicKey(...)` throws synchronously on any non-base58
    // input, which Next.js dev overlay surfaces as a Runtime Error even
    // though our outer try/catch swallows it. Filter early so the path
    // that finalizes a real on-chain market doesn't trip over a sibling
    // market row that has a missing/integer marketAddress.
    if (!isValidSolanaPubkey(marketPubkey)) {
      console.warn('[fetchOnChainStatus] Skipping non-base58 marketPubkey:', marketPubkey);
      return null;
    }
    try {
      const marketData = await fetchMarket(new PublicKey(marketPubkey));
      if (marketData) {
        return {
          status: Number(marketData.status) || 0,
          resolvedOutcome: marketData.resolvedOutcome !== null && marketData.resolvedOutcome !== undefined
            ? Number(marketData.resolvedOutcome)
            : null,
          resolveTimestamp: (marketData as any).resolveTimestamp ?? null,
        };
      }
    } catch (err) {
      console.error('[fetchOnChainStatus] Error:', err);
    }
    return null;
  }, [isReady, fetchMarket]);

  // Fetch markets from backend, then update with on-chain status
  const loadMarkets = useCallback(async () => {
    setLoadingMarkets(true);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001'}/api/v1/markets`);
      if (response.ok) {
        const data = await response.json();
        const marketList = (data.markets || data || [])
          // Drop rows without a usable on-chain pubkey BEFORE we ever
          // construct a `new PublicKey()` from them. Otherwise a single
          // bad row (synthetic `jup_evt_*` id, integer DB id, empty
          // marketAddress) takes down the whole resolve-market admin page.
          .map((m: any) => {
            const publicKeyValue = m.marketAddress || m.publicKey;
            if (!publicKeyValue || typeof publicKeyValue !== 'string' || !isValidSolanaPubkey(publicKeyValue)) {
              console.warn('[Markets] Skipping market without valid Solana pubkey:', { id: m.id, title: m.title, marketAddress: m.marketAddress });
              return null;
            }
            return {
              publicKey: publicKeyValue,
              title: m.title,
              status: m.status,
              resolvedOutcome: m.resolvedOutcome,
              numOutcomes: m.numOutcomes || 2,
              outcomes: m.outcomes || [
                { id: 0, label: 'Yes', lastPrice: 5000 },
                { id: 1, label: 'No', lastPrice: 5000 }
              ],
              endDate: m.endDate,
              resolutionType: m.resolutionType || 0,
              challengeTimestamp: m.challengeTimestamp,
              resolveTimestamp: m.resolveTimestamp ?? null,
            };
          })
          .filter((m: any): m is MarketInfo => m !== null);
        
        // Update with on-chain status for each market
        if (isReady) {
          const updatedMarkets = await Promise.all(
            marketList.map(async (market: MarketInfo) => {
              const onChainData = await fetchOnChainStatus(market.publicKey);
              if (onChainData) {
                return {
                  ...market,
                  status: onChainData.status,
                  resolvedOutcome: onChainData.resolvedOutcome,
                  resolveTimestamp: onChainData.resolveTimestamp ?? market.resolveTimestamp,
                };
              }
              return market;
            })
          );
          setMarkets(updatedMarkets);
          if (updatedMarkets.length > 0 && !selectedMarket) {
            setSelectedMarket(updatedMarkets[0].publicKey);
          }
        } else {
          setMarkets(marketList);
          if (marketList.length > 0 && !selectedMarket) {
            setSelectedMarket(marketList[0].publicKey);
          }
        }
      }
    } catch (err) {
      console.error('Failed to fetch markets:', err);
    } finally {
      setLoadingMarkets(false);
    }
  }, [isReady, fetchOnChainStatus, selectedMarket]);

  // Initial load
  useEffect(() => {
    loadMarkets();
  }, []);

  // Reload when program becomes ready (to get on-chain status)
  useEffect(() => {
    if (isReady && markets.length > 0) {
      loadMarkets();
    }
  }, [isReady]);

  const currentMarket = markets.find(m => m.publicKey === selectedMarket);

  const handleResolve = async () => {
    if (!selectedMarket || !wallet.publicKey) {
      setStatus({ type: 'error', message: !selectedMarket ? 'Please select a market' : 'Please connect your wallet' });
      return;
    }

    if (!isReady) {
      setStatus({ type: 'error', message: 'Programs are still loading. Please wait and try again.' });
      return;
    }

    if (loading) return;

    let marketPubkey: PublicKey;
    try {
      if (typeof selectedMarket !== 'string' || selectedMarket.length < 32) {
        throw new Error('Invalid market public key format');
      }
      marketPubkey = new PublicKey(selectedMarket);
    } catch (pubkeyError: any) {
      setStatus({ type: 'error', message: `Invalid market selection. Error: ${pubkeyError.message}` });
      return;
    }

    setStatus({ type: 'info', message: 'Resolving market...' });

    try {
      if (resolutionMethod === 'twap') {
        await resolveMarketTwap(marketPubkey, selectedOutcome);
      } else {
        await resolveMarketOracle(marketPubkey, selectedOutcome);
      }

      setStoredResolveTime(selectedMarket, Math.floor(Date.now() / 1000));

      await syncMarketStatusToBackend(selectedMarket, {
        status: 1,
        resolvedOutcome: selectedOutcome,
        resolutionSource: wallet.publicKey?.toString() || null,
      });
      
      setStatus({
        type: 'success',
        message: `Market resolved! Outcome "${currentMarket?.outcomes[selectedOutcome]?.label || selectedOutcome}" is the winner. Finalize will be available in 10 minutes.`
      });
      
      setTimeout(() => loadMarkets(), 1500);
    } catch (err: any) {
      setStatus({ type: 'error', message: err.message || 'Failed to resolve market' });
    }
  };

  const handleFinalize = async () => {
    if (!selectedMarket || !wallet.publicKey) {
      setStatus({ type: 'error', message: 'Please select a market and connect wallet' });
      return;
    }

    setStatus({ type: 'info', message: 'Finalizing resolution...' });

    try {
      const marketPubkey = new PublicKey(selectedMarket);
      await finalizeMarket(marketPubkey);

      await syncMarketStatusToBackend(selectedMarket, { status: 3 });

      clearStoredResolveTime(selectedMarket);
      setStatus({ type: 'success', message: 'Market finalized! Users can now redeem their winning shares.' });
      setTimeout(() => loadMarkets(), 1500);
    } catch (err: any) {
      setStatus({ type: 'error', message: err.message || 'Failed to finalize market' });
    }
  };

  const handleChallenge = async () => {
    if (!selectedMarket || !wallet.publicKey) {
      setStatus({ type: 'error', message: 'Please select a market and connect wallet' });
      return;
    }

    const bondAmountNum = parseFloat(bondAmount) * 1_000_000;
    if (isNaN(bondAmountNum) || bondAmountNum <= 0) {
      setStatus({ type: 'error', message: 'Please enter a valid bond amount' });
      return;
    }

    setStatus({ type: 'info', message: 'Challenging resolution...' });

    try {
      const marketPubkey = new PublicKey(selectedMarket);
      await challengeResolution(marketPubkey, bondAmountNum);

      await syncMarketStatusToBackend(selectedMarket, {
        status: 2,
        challengeBond: bondAmountNum.toString(),
        challenger: wallet.publicKey?.toString() || null,
      });

      setStatus({ type: 'success', message: `Resolution challenged! Bond of ${bondAmount} USDC deposited.` });
      setTimeout(() => loadMarkets(), 1500);
    } catch (err: any) {
      setStatus({ type: 'error', message: err.message || 'Failed to challenge resolution' });
    }
  };

  const parseEndDate = (raw: unknown): Date | null => {
    if (raw == null) return null;
    const d = typeof raw === 'number'
      ? new Date(raw < 1e12 ? raw * 1000 : raw)
      : new Date(raw as string);
    return isNaN(d.getTime()) ? null : d;
  };

  const isMarketEnded = (market: Pick<MarketInfo, 'status' | 'endDate'>) => {
    if (market.status !== 0) return false;
    const end = parseEndDate(market.endDate);
    return end !== null && end.getTime() < Date.now();
  };

  const getDisplayStatus = (market: Pick<MarketInfo, 'status' | 'endDate'>) => {
    if (isMarketEnded(market)) return 'Ended';
    return MARKET_STATUS[market.status] || 'Unknown';
  };

  const getStatusBadge = (market: Pick<MarketInfo, 'status' | 'endDate'>) => {
    const statusConfig: { [key: number]: { color: string; bgColor: string } } = {
      0: { color: 'text-emerald-400', bgColor: 'bg-emerald-500/10 border-emerald-500/20' },
      1: { color: 'text-amber-400', bgColor: 'bg-amber-500/10 border-amber-500/20' },
      2: { color: 'text-red-400', bgColor: 'bg-red-500/10 border-red-500/20' },
      3: { color: 'text-blue-400', bgColor: 'bg-blue-500/10 border-blue-500/20' },
      4: { color: 'text-[#737373]', bgColor: 'bg-[#262626] border-[#404040]' },
    };
    const ended = isMarketEnded(market);
    const config = ended
      ? { color: 'text-orange-400', bgColor: 'bg-orange-500/10 border-orange-500/20' }
      : (statusConfig[market.status] || statusConfig[4]);
    return (
      <span className={`px-2.5 py-1 rounded-lg text-xs font-semibold border ${config.bgColor} ${config.color}`}>
        {getDisplayStatus(market)}
      </span>
    );
  };

  // Auth is handled by AdminLayout
  if (!isAdmin) {
    return <AdminLayout title="Resolve Market" description="Resolve markets and finalize outcomes" />;
  }

  return (
    <AdminLayout title="Resolve Market" description="Resolve markets and finalize outcomes for settlement">
      <div className="max-w-4xl">

        {/* Status Message */}
        {status && (
          <div className={`mb-6 rounded-xl p-4 flex items-start gap-3 ${
            status.type === 'success' ? 'bg-emerald-500/10 border border-emerald-500/20' :
            status.type === 'error' ? 'bg-red-500/10 border border-red-500/20' :
            'bg-blue-500/10 border border-blue-500/20'
          }`}>
            <svg className={`w-5 h-5 shrink-0 mt-0.5 ${
              status.type === 'success' ? 'text-emerald-400' :
              status.type === 'error' ? 'text-red-400' : 'text-blue-400'
            }`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              {status.type === 'success' ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z" />
              ) : status.type === 'error' ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              )}
            </svg>
            <p className={`text-sm ${
              status.type === 'success' ? 'text-emerald-400' :
              status.type === 'error' ? 'text-red-400' : 'text-blue-400'
            }`}>{status.message}</p>
          </div>
        )}

        {/* Market Selection */}
        <div className="bg-[#0a0a0a] rounded-2xl border border-[#1a1a1a] overflow-hidden mb-6">
          <div className="px-6 py-4 border-b border-[#1a1a1a] flex items-center justify-between">
            <h2 className="text-lg font-semibold text-white">Select Market</h2>
            <button
              onClick={() => loadMarkets()}
              disabled={loadingMarkets}
              className="px-3 py-1.5 bg-[#171717] hover:bg-[#262626] rounded-lg text-xs text-[#a3a3a3] hover:text-white transition-colors flex items-center gap-2 disabled:opacity-50"
            >
              <svg className={`w-3.5 h-3.5 ${loadingMarkets ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
              </svg>
              {loadingMarkets ? 'Refreshing...' : 'Refresh'}
            </button>
          </div>
          
          <div className="p-4">
            {loadingMarkets ? (
              <div className="text-center py-8">
                <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-white/20 border-t-white mb-4"></div>
                <p className="text-[#737373] text-sm">Loading markets...</p>
              </div>
            ) : markets.length === 0 ? (
              <div className="text-center py-8">
                <p className="text-[#737373]">No markets found</p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[300px] overflow-y-auto">
                {markets.map((market) => (
                  <button
                    key={market.publicKey}
                    onClick={() => setSelectedMarket(market.publicKey)}
                    className={`w-full p-4 rounded-xl text-left transition-all ${
                      selectedMarket === market.publicKey
                        ? 'bg-white/5 border-2 border-white'
                        : 'bg-[#111111] border-2 border-transparent hover:border-[#262626]'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex-1 min-w-0 mr-4">
                        <h3 className="font-semibold text-white truncate">{market.title}</h3>
                        <p className="text-xs text-[#525252] mt-1 font-mono">
                          {String(market.publicKey).slice(0, 8)}...{String(market.publicKey).slice(-8)}
                        </p>
                      </div>
                      <div className="text-right shrink-0">
                        {getStatusBadge(market)}
                        {market.resolvedOutcome !== null && (
                          <p className="text-xs text-[#737373] mt-1">
                            Winner: {market.outcomes[market.resolvedOutcome]?.label || `#${market.resolvedOutcome}`}
                          </p>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Resolution Panel */}
        {currentMarket && (
          <div className="bg-[#0a0a0a] rounded-2xl border border-[#1a1a1a] overflow-hidden mb-6">
            <div className="px-6 py-4 border-b border-[#1a1a1a]">
              <h2 className="text-lg font-semibold text-white">
                {currentMarket.status === 0 ? 'Resolve Market' : 
                 currentMarket.status === 1 ? 'Finalize or Challenge' :
                 currentMarket.status === 3 ? 'Market Finalized' :
                 'Market Status'}
              </h2>
            </div>

            <div className="p-6 space-y-6">
              {/* Market Info */}
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                {[
                  { label: 'Status', value: getDisplayStatus(currentMarket) },
                  { label: 'Resolution Type', value: RESOLUTION_TYPE[currentMarket.resolutionType] },
                  { label: 'End Date', value: (() => {
                    const d = parseEndDate(currentMarket.endDate);
                    return d
                      ? d.toLocaleString(undefined, {
                          year: 'numeric', month: 'short', day: 'numeric',
                          hour: '2-digit', minute: '2-digit',
                        })
                      : '—';
                  })() },
                  { label: 'Outcomes', value: currentMarket.numOutcomes },
                ].map((item, idx) => (
                  <div key={idx} className="bg-[#111111] rounded-xl p-3 border border-[#1a1a1a]">
                    <p className="text-xs text-[#525252] uppercase tracking-wider">{item.label}</p>
                    <p className="font-semibold text-white mt-1">{item.value}</p>
                  </div>
                ))}
              </div>

              {/* Active Market - Can Resolve */}
              {currentMarket.status === 0 && (
                <div className="space-y-4">
                  {/* Outcome Selection */}
                  <div>
                    <label className="block text-sm font-medium text-white mb-3">Winning Outcome</label>
                    <div className="grid grid-cols-2 gap-3">
                      {currentMarket.outcomes.map((outcome) => (
                        <button
                          key={outcome.id}
                          onClick={() => setSelectedOutcome(outcome.id)}
                          className={`py-4 px-4 rounded-xl font-semibold transition-all border-2 ${
                            selectedOutcome === outcome.id
                              ? outcome.id === 0 
                                ? 'bg-emerald-500/10 border-emerald-500 text-emerald-400' 
                                : 'bg-red-500/10 border-red-500 text-red-400'
                              : 'bg-[#111111] border-[#262626] text-[#a3a3a3] hover:border-[#404040]'
                          }`}
                        >
                          {outcome.label}
                          <span className="block text-xs opacity-75 mt-1 font-normal">
                            Last: {(outcome.lastPrice / 100).toFixed(2)}¢
                          </span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Resolution Method */}
                  <div>
                    <label className="block text-sm font-medium text-white mb-3">Resolution Method</label>
                    <div className="grid grid-cols-2 gap-3">
                      {[
                        { id: 'oracle', label: 'Oracle/Manual', icon: '🔮' },
                        { id: 'twap', label: 'TWAP (Price)', icon: '📊' },
                      ].map((method) => (
                        <button
                          key={method.id}
                          onClick={() => setResolutionMethod(method.id as 'oracle' | 'twap')}
                          className={`py-3 px-4 rounded-xl font-medium transition-all border-2 flex items-center justify-center gap-2 ${
                            resolutionMethod === method.id
                              ? 'bg-white/5 border-white text-white'
                              : 'bg-[#111111] border-[#262626] text-[#a3a3a3] hover:border-[#404040]'
                          }`}
                        >
                          <span>{method.icon}</span>
                          {method.label}
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Resolve Button */}
                  <button
                    onClick={handleResolve}
                    disabled={loading || !isReady}
                    className="w-full py-4 rounded-xl font-bold text-lg transition-all bg-white hover:bg-neutral-200 text-black disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2"
                  >
                    {loading ? (
                      <>
                        <svg className="animate-spin h-5 w-5" fill="none" viewBox="0 0 24 24">
                          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                        </svg>
                        Processing...
                      </>
                    ) : !isReady ? (
                      'Loading programs...'
                    ) : (
                      `Resolve: ${currentMarket.outcomes[selectedOutcome]?.label} Wins`
                    )}
                  </button>

                  {isReady && (
                    <p className="text-xs text-[#525252] text-center">
                      ⚠️ Finalize will be available 10 minutes after resolving
                    </p>
                  )}
                </div>
              )}

              {/* Resolving Market */}
              {currentMarket.status === 1 && (() => {
                let resolvedAt = currentMarket.resolveTimestamp ?? getStoredResolveTime(currentMarket.publicKey);
                if (resolvedAt == null) {
                  resolvedAt = Math.floor(Date.now() / 1000);
                  setStoredResolveTime(currentMarket.publicKey, resolvedAt);
                }
                const finalizeAvailableAt = resolvedAt + FINALIZE_WAIT_SECONDS;
                const secondsLeft = Math.max(0, finalizeAvailableAt - nowSec);
                const waiting = secondsLeft > 0;
                const formatRemaining = (s: number) => {
                  const m = Math.floor(s / 60);
                  const sec = s % 60;
                  return `${m}m ${sec}s`;
                };
                return (
                <div className="space-y-4">
                  <div className="bg-amber-500/10 border border-amber-500/20 rounded-xl p-4">
                    <h3 className="font-semibold text-amber-400 mb-2 flex items-center gap-2">
                      <span>⏳</span> Awaiting Finalization
                    </h3>
                    <p className="text-[#a3a3a3] text-sm">
                      Current winner: <strong className="text-white">{currentMarket.outcomes[currentMarket.resolvedOutcome || 0]?.label}</strong>
                    </p>
                    <p className="text-[#a3a3a3] text-sm mt-2">
                      {waiting
                        ? <>Finalize available in <strong className="text-white font-mono">{formatRemaining(secondsLeft)}</strong></>
                        : <span className="text-emerald-400">Ready to finalize.</span>}
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <button
                      onClick={handleFinalize}
                      disabled={loading || !isReady || waiting}
                      title={waiting ? `Available in ${formatRemaining(secondsLeft)}` : undefined}
                      className="py-4 rounded-xl font-bold transition-all bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 hover:bg-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                      {loading
                        ? 'Processing...'
                        : waiting
                          ? `Finalize (${formatRemaining(secondsLeft)})`
                          : 'Finalize'}
                    </button>

                    {/* <div className="space-y-2">
                      <input
                        type="text"
                        value={bondAmount}
                        onChange={(e) => setBondAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                        placeholder="Bond (USDC)"
                        className="w-full px-4 py-2.5 bg-[#111111] border border-[#262626] rounded-lg text-white text-sm focus:outline-none focus:ring-2 focus:ring-white/20"
                      />
                      <button
                        onClick={handleChallenge}
                        disabled={loading || !isReady}
                        className="w-full py-2 rounded-lg font-bold text-sm transition-all bg-red-500/10 border border-red-500/20 text-red-400 hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                      >
                        Challenge
                      </button>
                    </div> */}
                  </div>
                </div>
                );
              })()}

              {/* Finalized Market */}
              {currentMarket.status === 3 && (
                <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-xl p-5">
                  <h3 className="font-semibold text-emerald-400 mb-2 flex items-center gap-2">
                    <span>✅</span> Market Finalized
                  </h3>
                  <p className="text-[#a3a3a3] text-sm">
                    Winner: <strong className="text-white">{currentMarket.outcomes[currentMarket.resolvedOutcome || 0]?.label}</strong>
                  </p>
                  <p className="text-[#525252] text-xs mt-2">
                    Users can now redeem their winning shares for $1 USDC each.
                  </p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Resolution Flow */}
        <div className="bg-[#0a0a0a] rounded-2xl border border-[#1a1a1a] overflow-hidden">
          <div className="px-6 py-4 border-b border-[#1a1a1a]">
            <h2 className="text-lg font-semibold text-white">Resolution Flow</h2>
          </div>
          <div className="p-6">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
              {[
                { step: '1', color: 'emerald', title: 'Resolve', desc: 'Admin selects winning outcome' },
                { step: '2', color: 'amber', title: 'Challenge (24h)', desc: 'Anyone can challenge with bond' },
                { step: '3', color: 'blue', title: 'Finalize', desc: 'Confirm resolution after period' },
                { step: '4', color: 'purple', title: 'Redeem', desc: 'Winners claim $1 per share' },
              ].map((item, idx) => (
                <div key={idx} className="text-center">
                  <div className={`w-10 h-10 rounded-full bg-${item.color}-500/10 border border-${item.color}-500/20 flex items-center justify-center mx-auto mb-3`}>
                    <span className={`text-${item.color}-400 font-bold`}>{item.step}</span>
                  </div>
                  <h3 className="font-semibold text-white text-sm">{item.title}</h3>
                  <p className="text-xs text-[#525252] mt-1">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </AdminLayout>
  );
}
