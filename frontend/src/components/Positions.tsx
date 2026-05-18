import { useState, useEffect, useMemo, useCallback } from 'react';
import { useWallet, useConnection } from '@solana/wallet-adapter-react';
import { PublicKey } from '@solana/web3.js';
import { useSpaceProgram } from '@/hooks/useSpaceProgram';
import { useSharedPositions } from '@/context/PositionsContext';
import { Market } from '@/types/market';
import axios from 'axios';
import { useMarketPriceWebSocket } from '@/hooks/useOrderBookWebSocket';
import { useUserOrdersWebSocket, UserOrder } from '@/hooks/useUserOrdersWebSocket';
import { useRouter } from 'next/router';
import Image from 'next/image';
import { displayQuoteSymbol } from '@/utils/solana';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface Position {
  market: PublicKey;
  marketAddress: string;
  marketId: string;
  marketTitle?: string;
  imageUrl?: string | null;
  marketStatus?: number;
  resolvedOutcome?: number | null;
  outcomeId: number;
  outcomeLabel?: string;
  side: 'Long' | 'Short';
  shares: number;
  avgEntryPrice: number;
  leverage: number;
  collateral: number;
  currentPrice?: number;
  pnl?: number;
  pnlPercent?: number;
  isActive: boolean;
  isWinner?: boolean;
  isResolved?: boolean;        // market is finalized (status === 3)
  resolutionPayout?: number;   // human-units payout: shares/1e6 if won, 0 if lost
  resolutionPnl?: number;      // payout − cost basis (human units, signed)
  redeemedShares?: number;     // historical share count from a prior redemption (human units)
  isTokenHolding?: boolean;
  positionType?: number;
  borrowedAmount?: number;
  liquidationPrice?: number;
  tokenType?: string;
  quoteMint?: string | null;
  quoteDecimals?: number;
  quoteSymbol?: string;
}

export function Positions() {
  const router = useRouter();
  const { connected, publicKey } = useWallet();
  const { closePosition, burnShares, closeLeveragedPosition, redeemShares, loading: programLoading } = useSpaceProgram();
  const { positions: sharedPositions, loading, refetch: refetchPositions } = useSharedPositions();
  const [positions, setPositions] = useState<Position[]>([]);
  const [resolvedPositions, setResolvedPositions] = useState<Position[]>([]);
  const [resolvedLoading, setResolvedLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState<'active' | 'resolved' | 'orders' | 'history'>('active');
  const [status, setStatus] = useState<{ type: 'success' | 'error'; message: string } | null>(null);
  const { orders: allUserOrders, loading: ordersLoading, refetch: refetchOrders } = useUserOrdersWebSocket();
  const { cancelOrder, isReady: programReady, loading: cancelLoading } = useSpaceProgram();
  const [cancellingOrderId, setCancellingOrderId] = useState<string | null>(null);
  const [historyOrders, setHistoryOrders] = useState<any[]>([]);
  const [historyPage, setHistoryPage] = useState(0);
  const [historyTotal, setHistoryTotal] = useState(0);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [marketTitleMap, setMarketTitleMap] = useState<Map<string, { title: string; imageUrl?: string }>>(new Map());
  const [marketMap, setMarketMap] = useState<Map<string, Market>>(new Map());

  // Fetch markets metadata once (for enriching positions with titles, images, outcomes)
  useEffect(() => {
    if (!connected || !publicKey) return;
    const fetchMarkets = async () => {
      try {
        const res = await axios.get(`${API_URL}/api/v1/markets`);
        const markets: Market[] = res.data.markets || res.data || [];
        const map = new Map<string, Market>();
        for (const m of markets) {
          if ((m as any).marketAddress) map.set((m as any).marketAddress, m);
          if (m.id && typeof m.id === 'string' && m.id.length > 30) map.set(m.id, m);
        }
        setMarketMap(map);
      } catch (e) {
        console.error('Error fetching markets:', e);
      }
    };
    fetchMarkets();
  }, [connected, publicKey]);

  // Enrich one raw position with market metadata + resolution flags.
  // Used by both the active-positions effect (sharedPositions from context)
  // and the resolved-positions fetch (separate API endpoint).
  const enrichPosition = useCallback((bp: any): Position => {
    const market = marketMap.get(bp.market) || marketMap.get(bp.marketAddress || '');

    const shares = Number(bp.shares);
    const collateral = Number(bp.collateral);
    const pnl = bp.pnl ? parseFloat(bp.pnl) : 0;
    const pnlPercent = bp.pnlPercent || 0;

    // Resolution status. A YES-of-outcome-X share pays $1 iff X is the
    // resolved outcome. A NO-of-outcome-X share pays $1 iff X is NOT the
    // resolved outcome. The previous `isWinner` only checked outcomeId
    // === resolved, which mislabelled every NO holder.
    const marketStatusNum = market?.status ? parseInt(market.status.toString()) : undefined;
    const isResolved = marketStatusNum === 3;
    // Backend returns `resolvedOutcome` (camelCase). Older fixtures and
    // some legacy paths use snake_case `resolved_outcome`. Read both —
    // missing this fallback was the bug that made every resolved position
    // (YES *and* NO on the same market) show LOST: `resolved` was always
    // undefined, so isWinner never evaluated true.
    const resolved =
      market?.resolvedOutcome !== undefined && market?.resolvedOutcome !== null
        ? market.resolvedOutcome
        : market?.resolved_outcome;
    const tokenTypeStr = bp.tokenType || 'yes';
    const isWinner =
      isResolved && resolved !== null && resolved !== undefined &&
      (tokenTypeStr === 'yes'
        ? bp.outcomeId === resolved
        : bp.outcomeId !== resolved);
    // Use the historical redeemedShares (persisted by the redemption flow)
    // when the position has already been claimed (shares = 0 post-redeem).
    // Otherwise fall back to current shares — that's the user's pre-claim
    // entitlement on a finalized market.
    const redeemedSharesRaw = (bp as any).redeemedShares;
    const redeemedSharesNum = redeemedSharesRaw != null ? Number(redeemedSharesRaw) : 0;
    const redeemedSharesHuman = redeemedSharesNum / 1e6;
    const sharesHuman = shares / 1e6;
    const effectiveSharesHuman = sharesHuman > 0 ? sharesHuman : redeemedSharesHuman;
    const costBasisHuman = (effectiveSharesHuman * bp.avgEntryPrice) / 10000;
    const resolutionPayout = isResolved
      ? (isWinner ? effectiveSharesHuman : 0)
      : undefined;
    const resolutionPnl = isResolved ? (resolutionPayout! - costBasisHuman) : undefined;

    return {
      market: new PublicKey(bp.market),
      marketAddress: bp.market,
      marketId: bp.marketId || market?.id || '',
      marketTitle: bp.marketTitle || market?.title,
      imageUrl: market?.imageUrl || market?.image_url || null,
      marketStatus: marketStatusNum,
      resolvedOutcome: resolved,
      outcomeId: bp.outcomeId,
      outcomeLabel: (() => {
        const isBinary = !market?.outcomes || market.outcomes.length <= 2;
        const tokenSuffix = tokenTypeStr === 'no' ? 'NO' : 'YES';
        if (isBinary) return tokenSuffix;
        const outcomeName = market?.outcomes?.[bp.outcomeId]?.label || `Outcome ${bp.outcomeId}`;
        return `${outcomeName} ${tokenSuffix}`;
      })(),
      side: bp.side === 0 ? 'Long' : 'Short',
      shares,
      avgEntryPrice: bp.avgEntryPrice,
      leverage: bp.leverage,
      collateral,
      currentPrice: bp.currentPrice,
      pnl: pnl * 1e6,
      pnlPercent,
      isActive: (bp.isOpen !== false) && shares > 0,
      isWinner,
      isResolved,
      resolutionPayout,
      resolutionPnl,
      redeemedShares: redeemedSharesHuman,
      isTokenHolding: false,
      positionType: bp.positionType ?? (bp.leverage === 1 ? 0 : 1),
      borrowedAmount: bp.borrowedAmount ? Number(bp.borrowedAmount) : 0,
      liquidationPrice: bp.liquidationPrice ?? undefined,
      tokenType: tokenTypeStr,
      quoteMint: (bp as any).quoteMint ?? (market as any)?.quoteMint ?? null,
      quoteDecimals: (bp as any).quoteDecimals ?? (market as any)?.quoteDecimals ?? 6,
      quoteSymbol: (bp as any).quoteSymbol ?? (market as any)?.quoteSymbol ?? 'USDC',
    };
  }, [marketMap]);

  // Transform shared positions into enriched Position[] with market metadata
  useEffect(() => {
    if (sharedPositions.length === 0 && !loading) {
      setPositions([]);
      return;
    }
    if (marketMap.size === 0) return;
    setPositions(sharedPositions.map(enrichPosition));
  }, [sharedPositions, loading, marketMap, enrichPosition]);

  // Fetch positions on resolved markets (incl. already-claimed). Hits a
  // separate endpoint that ignores the isOpen=true filter the active path
  // applies, so users see win/loss history even after they've claimed.
  useEffect(() => {
    if (!connected || !publicKey || marketMap.size === 0) return;
    let cancelled = false;
    setResolvedLoading(true);
    axios
      .get(`${API_URL}/api/v1/positions/user/${publicKey.toString()}/resolved`)
      .then((res) => {
        if (cancelled) return;
        const raw = res.data.positions || [];
        // Map quote symbol the same way PositionsContext does for the active
        // tab — internal "SPACE" becomes display "SPC" so the resolved tab
        // doesn't print "Paid out in SPACE" while the rest of the UI says SPC.
        const remapped = raw.map((p: any) =>
          p.quoteSymbol ? { ...p, quoteSymbol: displayQuoteSymbol(p.quoteSymbol) } : p,
        );
        setResolvedPositions(remapped.map(enrichPosition));
      })
      .catch((e) => console.error('[Positions] Error fetching resolved:', e))
      .finally(() => { if (!cancelled) setResolvedLoading(false); });
    return () => { cancelled = true; };
  }, [connected, publicKey, marketMap, enrichPosition]);

  // Manual refresh function
  const handleRefresh = () => {
    if (!connected || !publicKey || loading) return;
    refetchPositions();
  };

  // Show both spot and leveraged positions
  const activePositions = positions.filter(p => p.isActive);

  const formatPrice = (price: number) => {
    return (price / 100).toFixed(2) + '%';
  };

  // Resolve quote metadata for a position by looking up the market. Defaults
  // to USDC/6 for legacy positions whose Market record predates v2 columns.
  const quoteInfoFor = (position: Position): { symbol: string; decimals: number } => {
    if (position.quoteSymbol || position.quoteDecimals !== undefined) {
      return {
        symbol: position.quoteSymbol ?? 'USDC',
        decimals: position.quoteDecimals ?? 6,
      };
    }
    const market = marketMap.get(position.marketAddress) as any;
    return {
      symbol: market?.quoteSymbol ?? 'USDC',
      decimals: market?.quoteDecimals ?? 6,
    };
  };

  const getMarketStatusLabel = (status?: number) => {
    switch (status) {
      case 0: return 'Active';
      case 1: return 'Resolving';
      case 2: return 'Disputed';
      case 3: return 'Finalized';
      case 4: return 'Invalid';
      default: return 'Unknown';
    }
  };

  // Handle closing a leveraged position
  const handleClosePosition = async (position: Position) => {
    if (!publicKey) return;
    
    setActionLoading(position.marketId + position.outcomeId);
    setStatus(null);

    try {
      // Use closeLeveragedPosition which places a sell order at best available price
      // It will match with existing buy orders or place a sell order
      // Debt is automatically repaid and remaining USDC is returned to user
      await closeLeveragedPosition({
        market: position.marketAddress,
        outcomeId: position.outcomeId,
        side: position.side === 'Long' ? 0 : 1, // Convert to number
        tokenType: position.tokenType,
      });
      
      setStatus({ type: 'success', message: `Sell order placed! Position will be closed when matched. Debt will be repaid and remaining ${quoteInfoFor(position).symbol} returned.` });
      
      // Refresh positions after a delay to allow keeper to execute
      // Poll a few times to check if position was closed
      let pollCount = 0;
      const maxPolls = 8; // Poll for up to 16 seconds (2s * 8)
      
      const pollForUpdate = async () => {
        pollCount++;
        
        // Use the shared fetchPositions function to refresh
        refetchPositions();
        
        // Check if this position still exists by querying backend directly
        // (positions state might not be updated immediately)
        try {
          const positionsResponse = await axios.get(`${API_URL}/api/v1/positions/user/${publicKey.toString()}`);
          const backendPositions = positionsResponse.data.positions || [];
          
          const stillExists = backendPositions.some((p: any) => 
            (p.market === position.marketAddress || p.marketAddress === position.marketAddress) && 
            p.outcomeId === position.outcomeId && 
            Number(p.leverage) > 1 &&
            Number(p.shares) > 0
          );
          
          if (!stillExists) {
            setStatus({ type: 'success', message: `Position closed successfully!` });
            setActionLoading(null);
            // Trigger one more refresh to update UI
            refetchPositions();
            return; // Stop polling
          }
        } catch (error) {
          console.error('[Positions] Error checking position status:', error);
        }
        
        if (pollCount < maxPolls) {
          // Continue polling
          setTimeout(pollForUpdate, 2000);
        } else {
          setActionLoading(null);
        }
      };
      
      // Start polling after initial delay
      setTimeout(pollForUpdate, 3000);
    } catch (error: any) {
      console.error('Error closing position:', error);
      setStatus({ type: 'error', message: error.message || 'Failed to close position' });
      setActionLoading(null);
    }
  };

  // Handle burning shares (requires YES + NO matching pairs to get USDC back) - ONLY for ACTIVE markets
  const handleBurnShares = async (position: Position) => {
    if (!publicKey) return;

    setActionLoading(position.marketId + position.outcomeId);
    setStatus(null);

    try {
      await burnShares({
        market: position.marketAddress,
        outcomeId: position.outcomeId,
        amount: position.shares,
      });

      setStatus({ type: 'success', message: `Shares burned! ${quoteInfoFor(position).symbol} returned to your wallet.` });
      
      // Refresh positions after a short delay
      setTimeout(() => {
        window.location.reload();
      }, 2000);
    } catch (error: any) {
      console.error('Error burning shares:', error);
      // Provide helpful error messages
      if (error.message?.includes('insufficient')) {
        setStatus({ type: 'error', message: 'You need matching YES + NO shares to burn. Try acquiring the opposite shares first.' });
      } else if (error.message?.includes('MarketNotActive') || error.message?.includes('Not active')) {
        setStatus({ type: 'error', message: 'This market is no longer active. If you won, use "Redeem Winnings" instead.' });
      } else {
        setStatus({ type: 'error', message: error.message || 'Failed to burn shares' });
      }
    } finally {
      setActionLoading(null);
    }
  };

  // Format shares count with commas
  const formatShares = (shares: number) => {
    return Math.floor(shares / 1e6).toLocaleString();
  };

  // Format price as cents
  const formatCents = (price: number) => {
    return Math.round(price / 100) + '¢';
  };

  // Format a quote-denominated value using the position's own quote decimals
  // and symbol. For USDC positions this matches the old `$X` output; for
  // SPACE it renders `X SPACE` with the correct 10^9 divisor.
  const formatQuoteValue = (position: Position, lamports: number) => {
    const info = quoteInfoFor(position);
    const human = lamports / Math.pow(10, info.decimals);
    return `${human.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${info.symbol}`;
  };

  // Filter open orders from WebSocket data
  const openOrders = useMemo(() => {
    return allUserOrders.filter(o => ['open', 'pending', 'partially_filled'].includes(o.status));
  }, [allUserOrders]);

  // Fetch market title map once for orders/history display
  useEffect(() => {
    if (!connected || !publicKey) return;
    const fetchMarketTitles = async () => {
      try {
        const res = await axios.get(`${API_URL}/api/v1/markets`);
        const markets: Market[] = res.data.markets || res.data || [];
        const map = new Map<string, { title: string; imageUrl?: string }>();
        for (const m of markets) {
          const info = { title: m.title, imageUrl: m.imageUrl || m.image_url || undefined };
          const id = m.id || (m as any).marketId;
          if (id) {
            map.set(id.toString(), info);
          }
          // Also index by on-chain marketAddress so orders using pubkey as marketId resolve
          const addr = (m as any).marketAddress;
          if (addr) {
            map.set(addr, info);
          }
        }
        setMarketTitleMap(map);
      } catch (e) {
        console.error('Error fetching market titles:', e);
      }
    };
    fetchMarketTitles();
  }, [connected, publicKey]);

  // Fetch history orders (paginated)
  const fetchHistory = useCallback(async (page: number = 0) => {
    if (!connected || !publicKey) return;
    setHistoryLoading(true);
    try {
      const offset = page * 50;
      const res = await axios.get(
        `${API_URL}/api/v1/orders/user/${publicKey.toString()}?status=filled&status=cancelled&limit=50&offset=${offset}`
      );
      setHistoryOrders(res.data.orders || []);
      setHistoryTotal(res.data.pagination?.total || res.data.orders?.length || 0);
      setHistoryPage(page);
    } catch (e) {
      console.error('Error fetching history:', e);
    } finally {
      setHistoryLoading(false);
    }
  }, [connected, publicKey]);

  // Fetch history when switching to history tab
  useEffect(() => {
    if (activeTab === 'history' && historyOrders.length === 0) {
      fetchHistory(0);
    }
  }, [activeTab, fetchHistory]);

  // Cancel order handler
  const handleCancelOrder = async (order: UserOrder) => {
    if (!publicKey || !programReady || !order.orderId) {
      setStatus({ type: 'error', message: 'Cannot cancel order' });
      return;
    }
    setCancellingOrderId(order.id);
    setStatus(null);
    try {
      await cancelOrder({ orderId: order.orderId });
      // Update backend
      try {
        await axios.delete(`${API_URL}/api/v1/orders/${order.id}`, {
          headers: { 'x-pubkey': publicKey.toString() },
        });
      } catch (apiErr) {
        console.warn('Backend cancel update failed:', apiErr);
      }
      refetchOrders();
      setStatus({ type: 'success', message: 'Order cancelled successfully' });
    } catch (err: any) {
      setStatus({ type: 'error', message: err.message || 'Failed to cancel order' });
    } finally {
      setCancellingOrderId(null);
    }
  };

  // Format date for history display
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  // Get market title for an order
  const getMarketTitle = (marketId: string) => {
    return marketTitleMap.get(marketId)?.title || marketId.slice(0, 8) + '...';
  };

  if (!connected) {
    return (
      <div className="rounded-xl border border-[#262626] p-8">
        <p className="text-[#737373] text-center">Please connect your wallet to view positions</p>
      </div>
    );
  }

  return (
    <div className="rounded-xl overflow-hidden">
      {/* Status Message */}
      {status && (
        <div className={`p-3 ${
          status.type === 'success' ? 'bg-emerald-500/10 border-b border-emerald-500/20' : 'bg-red-500/10 border-b border-red-500/20'
        }`}>
          <p className={`text-sm ${status.type === 'success' ? 'text-emerald-400' : 'text-red-400'}`}>
            {status.message}
          </p>
        </div>
      )}

      {/* Tabs Header */}
      <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-[#191919]">
        <div className="flex items-center gap-4 sm:gap-6">
          <button
            onClick={() => setActiveTab('active')}
            className={`text-xs sm:text-sm font-medium transition-colors ${
              activeTab === 'active'
                ? 'text-white'
                : 'text-[#737373] hover:text-white'
            }`}
          >
            Positions
          </button>
          <button
            onClick={() => setActiveTab('resolved')}
            className={`text-xs sm:text-sm font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'resolved'
                ? 'text-white'
                : 'text-[#737373] hover:text-white'
            }`}
          >
            Resolved
            {resolvedPositions.length > 0 && (
              <span className="text-[10px] bg-[#262626] text-white px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                {resolvedPositions.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('orders')}
            className={`text-xs sm:text-sm font-medium transition-colors flex items-center gap-1.5 ${
              activeTab === 'orders'
                ? 'text-white'
                : 'text-[#737373] hover:text-white'
            }`}
          >
            Orders
            {openOrders.length > 0 && (
              <span className="text-[10px] bg-[#262626] text-white px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                {openOrders.length}
              </span>
            )}
          </button>
          <button
            onClick={() => setActiveTab('history')}
            className={`text-xs sm:text-sm font-medium transition-colors ${
              activeTab === 'history'
                ? 'text-white'
                : 'text-[#737373] hover:text-white'
            }`}
          >
            History
          </button>
        </div>
        <button
          onClick={() => {
            if (activeTab === 'active') handleRefresh();
            else if (activeTab === 'orders') refetchOrders();
            else if (activeTab === 'history') fetchHistory(0);
          }}
          disabled={loading || ordersLoading || historyLoading}
          className="flex items-center gap-2 p-2 sm:px-3 sm:py-1.5 text-sm text-[#a3a3a3] hover:text-white border border-[#191919] rounded-lg transition-colors disabled:opacity-50"
        >
          <svg className={`w-4 h-4 ${(loading || ordersLoading || historyLoading) ? 'animate-spin' : ''}`} fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span className="hidden sm:inline">Refresh</span>
        </button>
      </div>

      {/* Table Header - Hidden on mobile */}
      {(activeTab === 'active' || activeTab === 'resolved') && (
        <div className="hidden sm:grid grid-cols-12 gap-4 bg-[#14141480] px-6 py-3 text-xs text-[#737373] border-b border-[#191919]">
          <div className="col-span-5">Market</div>
          <div className="col-span-1 text-center">Leverage</div>
          <div className="col-span-2 text-center">{activeTab === 'resolved' ? 'Result' : 'Current'}</div>
          <div className="col-span-2 text-center">{activeTab === 'resolved' ? 'Outcome' : 'Liq. Price'}</div>
          <div className="col-span-2 text-right">{activeTab === 'resolved' ? 'Payout' : 'Value'}</div>
        </div>
      )}
      {activeTab === 'orders' && (
        <div className="hidden sm:grid grid-cols-12 gap-4 bg-[#14141480] px-6 py-3 text-xs text-[#737373] border-b border-[#191919]">
          <div className="col-span-4">Market</div>
          <div className="col-span-1 text-center">Side</div>
          <div className="col-span-2 text-center">Price</div>
          <div className="col-span-2 text-center">Size / Filled</div>
          <div className="col-span-1 text-center">Status</div>
          <div className="col-span-2 text-right">Action</div>
        </div>
      )}
      {activeTab === 'history' && (
        <div className="hidden sm:grid grid-cols-12 gap-4 bg-[#14141480] px-6 py-3 text-xs text-[#737373] border-b border-[#191919]">
          <div className="col-span-4">Market</div>
          <div className="col-span-1 text-center">Side</div>
          <div className="col-span-2 text-center">Price</div>
          <div className="col-span-2 text-center">Shares</div>
          <div className="col-span-1 text-center">Status</div>
          <div className="col-span-2 text-right">Date</div>
        </div>
      )}

      {/* Content */}
      {(activeTab === 'active' && loading) || (activeTab === 'resolved' && resolvedLoading) || (activeTab === 'orders' && ordersLoading) || (activeTab === 'history' && historyLoading) ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-2 border-[#262626] border-t-white"></div>
        </div>
      ) : (
        <>
          {/* Positions Tab — shared rendering for Active and Resolved.
              Active tab uses live positions (open, shares > 0).
              Resolved tab pulls from a separate endpoint that includes
              already-claimed positions so users see their full win/loss
              history. Both reuse the same card markup since each card
              already handles isResolved/isWinner. */}
          {(activeTab === 'active' || activeTab === 'resolved') && (() => {
            const list = activeTab === 'resolved' ? resolvedPositions : activePositions;
            const emptyMsg = activeTab === 'resolved'
              ? 'No resolved markets yet. Once markets you traded in finalize, they’ll appear here.'
              : 'No active positions';
            if (list.length === 0) {
              return (
                <div className="flex flex-col items-center justify-center py-16 px-6 text-center">
                  <p className="text-[#737373]">{emptyMsg}</p>
                </div>
              );
            }
            return (
              <div className="divide-y divide-[#262626]">
                {list.map((position, index) => (
                  <div
                    key={index}
                    onClick={() => position.marketId && router.push(`/markets/${position.marketId}`)}
                    className={`px-4 sm:px-6 py-4 hover:bg-[#111111] transition-colors cursor-pointer ${
                      position.isResolved && position.isWinner ? 'bg-emerald-500/5' :
                      position.isResolved && !position.isWinner ? 'bg-red-500/5' : ''
                    }`}
                  >
                    {/* Mobile Layout */}
                    <div className="sm:hidden">
                      <div className="flex items-start gap-3 mb-3">
                        <div className="w-10 h-10 rounded-lg bg-[#1a1a1a] border border-[#262626] flex items-center justify-center overflow-hidden flex-shrink-0">
                          {position.imageUrl && (
                            <Image src={position.imageUrl} alt={position.marketTitle || 'Market'} width={40} height={40} className="w-full h-full object-cover" />
                          )}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="text-white font-medium text-sm truncate">
                              {position.marketTitle || 'Market'}
                            </h3>
                            {position.isResolved && position.isWinner && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500 text-white font-bold tracking-wide">WON</span>
                            )}
                            {position.isResolved && !position.isWinner && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/80 text-white font-bold tracking-wide">LOST</span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-1">
                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                              position.tokenType === 'no'
                                ? 'bg-red-500/20 text-red-400'
                                : 'bg-emerald-500/20 text-emerald-400'
                            }`}>
                              {position.outcomeLabel || (`Outcome ${position.outcomeId}`)}
                            </span>
                            {position.leverage > 1 && (
                              <span className="text-xs text-[#737373]">{position.leverage}x</span>
                            )}
                          </div>
                        </div>
                        <div className="text-right flex-shrink-0">
                          {position.isResolved ? (
                            <>
                              <p className="text-white font-medium text-sm">
                                {position.resolutionPayout?.toFixed(2) ?? '0.00'} {quoteInfoFor(position).symbol}
                              </p>
                              {position.resolutionPnl !== undefined && (
                                <p className={`text-xs font-semibold ${position.resolutionPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                  {position.resolutionPnl >= 0 ? '+' : ''}{position.resolutionPnl.toFixed(2)} {quoteInfoFor(position).symbol}
                                </p>
                              )}
                            </>
                          ) : (
                            <>
                              <p className="text-white font-medium text-sm">
                                {formatQuoteValue(position, position.collateral + (position.pnl || 0))}
                              </p>
                              {position.pnl !== undefined && position.pnlPercent !== undefined && (
                                <p className={`text-xs ${position.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                  {position.pnl >= 0 ? '+' : ''}{Math.round(position.pnlPercent)}%
                                </p>
                              )}
                            </>
                          )}
                        </div>
                      </div>
                      <div className="flex items-center justify-between text-xs text-[#737373] pl-[52px]">
                        {position.isResolved ? (
                          // For resolved positions, current `shares` is 0 after
                          // a claim and we don't always have a historical
                          // count to show. Just show the entry price — that's
                          // the only reliably-meaningful number per the user's
                          // request to "remove count of shares … only show
                          // price at which bought".
                          <span>Bought @ {formatCents(position.avgEntryPrice)}</span>
                        ) : (
                          <span>{formatShares(position.shares)} shares @ {formatCents(position.avgEntryPrice)}</span>
                        )}
                        <span>Now: {position.currentPrice ? formatCents(position.currentPrice) : '--'}</span>
                      </div>
                      {position.leverage > 1 && position.liquidationPrice ? (
                        <div className="flex items-center justify-between text-xs pl-[52px] mt-1">
                          <span className={`${
                            position.currentPrice && (
                              (position.side === 'Long' && position.currentPrice <= position.liquidationPrice * 1.1) ||
                              (position.side === 'Short' && position.currentPrice >= position.liquidationPrice * 0.9)
                            ) ? 'text-red-400' : 'text-amber-400'
                          }`}>
                            Liq. Price: {formatCents(position.liquidationPrice)}
                          </span>
                        </div>
                      ) : null}
                    </div>

                    {/* Desktop Layout */}
                    <div className="hidden sm:grid grid-cols-12 gap-4 items-center">
                      <div className="col-span-5 flex items-center gap-3">
                        <div className="w-10 h-10 rounded-lg bg-[#1a1a1a] border border-[#262626] flex items-center justify-center overflow-hidden flex-shrink-0">
                          {position.imageUrl && (
                            <Image src={position.imageUrl} alt={position.marketTitle || 'Market'} width={40} height={40} className="w-full h-full object-cover" />
                          )}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-2">
                            <h3 className="text-white font-medium truncate">
                              {position.marketTitle || 'Market'}
                            </h3>
                            {position.isResolved && position.isWinner && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-emerald-500 text-white font-bold tracking-wide flex-shrink-0">
                                WON
                              </span>
                            )}
                            {position.isResolved && !position.isWinner && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-red-500/80 text-white font-bold tracking-wide flex-shrink-0">
                                LOST
                              </span>
                            )}
                          </div>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className={`text-xs px-1.5 py-0.5 rounded font-medium ${
                              position.tokenType === 'no'
                                ? 'bg-red-500/20 text-red-400'
                                : 'bg-emerald-500/20 text-emerald-400'
                            }`}>
                              {position.outcomeLabel || (`Outcome ${position.outcomeId}`)}
                            </span>
                            <span className="text-xs text-[#737373]">
                              {position.isResolved
                                ? `Bought at ${formatCents(position.avgEntryPrice)}`
                                : `${formatShares(position.shares)} shares at ${formatCents(position.avgEntryPrice)}`}
                            </span>
                          </div>
                        </div>
                      </div>
                      <div className="col-span-1 text-center">
                        {position.leverage > 1 ? (
                          <span className="text-white font-medium">{position.leverage}x</span>
                        ) : (
                          <span className="text-[#737373] text-xs">Spot</span>
                        )}
                      </div>
                      <div className="col-span-2 text-center">
                        {position.isResolved ? (
                          // For resolved markets the "current price" is meaningless;
                          // show the user's entry price under the "Result" header
                          // so users can see what they paid versus the payout.
                          <span className="text-white font-medium">
                            {formatCents(position.avgEntryPrice)}
                          </span>
                        ) : (
                          <span className="text-white font-medium">
                            {position.currentPrice ? formatCents(position.currentPrice) : '--'}
                          </span>
                        )}
                      </div>
                      <div className="col-span-2 text-center">
                        {position.isResolved ? (
                          // Show which side won under the "Outcome" header. The
                          // user's own bet vs. this label tells them at a glance
                          // whether they were on the winning side.
                          <span className={`text-xs font-semibold px-2 py-0.5 rounded ${
                            position.isWinner
                              ? 'bg-emerald-500/15 text-emerald-400'
                              : 'bg-red-500/15 text-red-400'
                          }`}>
                            {(() => {
                              if (position.resolvedOutcome === undefined || position.resolvedOutcome === null) {
                                return 'Resolved';
                              }
                              // Binary markets: just say YES/NO won. Multi-outcome:
                              // show the actual outcome label that won.
                              const market = marketMap.get(position.marketAddress) as any;
                              const isBinary = !market?.outcomes || market.outcomes.length <= 2;
                              if (isBinary) {
                                return position.resolvedOutcome === 0 ? 'YES won' : 'NO won';
                              }
                              const label = market?.outcomes?.[position.resolvedOutcome]?.label;
                              return label ? `${label} won` : `Outcome ${position.resolvedOutcome} won`;
                            })()}
                          </span>
                        ) : position.leverage > 1 && position.liquidationPrice ? (
                          <span className={`font-medium ${
                            position.currentPrice && (
                              (position.side === 'Long' && position.currentPrice <= position.liquidationPrice * 1.1) ||
                              (position.side === 'Short' && position.currentPrice >= position.liquidationPrice * 0.9)
                            ) ? 'text-red-400' : 'text-amber-400'
                          }`}>
                            {formatCents(position.liquidationPrice)}
                          </span>
                        ) : (
                          <span className="text-[#737373] text-xs">--</span>
                        )}
                      </div>
                      <div className="col-span-2 text-right">
                        {position.isResolved ? (
                          (() => {
                            const symbol = quoteInfoFor(position).symbol;
                            // Already redeemed: shares zeroed out by the redeem
                            // flow. If the redemption flow recorded the
                            // historical share count we can show the actual
                            // amount; otherwise we just say "Claimed" (older
                            // redemptions that pre-date redeemed_shares).
                            const alreadyClaimed = position.shares === 0 && position.isWinner;
                            if (alreadyClaimed) {
                              const historicalPayout = position.redeemedShares ?? 0;
                              if (historicalPayout > 0) {
                                const historicalCost = (historicalPayout * position.avgEntryPrice) / 10000;
                                const historicalPnl = historicalPayout - historicalCost;
                                return (
                                  <>
                                    <p className="text-white font-medium">
                                      {historicalPayout.toFixed(2)} {symbol}
                                    </p>
                                    <p className="text-xs text-emerald-400 font-semibold">
                                      +{historicalPnl.toFixed(2)} {symbol} (claimed)
                                    </p>
                                  </>
                                );
                              }
                              return (
                                <>
                                  <p className="text-white font-medium">Claimed</p>
                                  <p className="text-xs text-emerald-400 font-semibold">
                                    Paid out in {symbol}
                                  </p>
                                </>
                              );
                            }
                            return (
                              <>
                                <p className="text-white font-medium">
                                  {position.resolutionPayout?.toFixed(2) ?? '0.00'} {symbol}
                                </p>
                                {position.resolutionPnl !== undefined && (
                                  <p className={`text-xs font-semibold ${position.resolutionPnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                    {position.resolutionPnl >= 0 ? '+' : ''}{position.resolutionPnl.toFixed(2)} {symbol}
                                    {' '}({position.isWinner ? 'won' : 'lost'})
                                  </p>
                                )}
                              </>
                            );
                          })()
                        ) : (
                          <>
                            <p className="text-white font-medium">
                              {formatQuoteValue(position, position.collateral + (position.pnl || 0))}
                            </p>
                            {position.pnl !== undefined && position.pnlPercent !== undefined && (
                              <p className={`text-xs ${position.pnl >= 0 ? 'text-emerald-400' : 'text-red-400'}`}>
                                {position.pnl >= 0 ? '+' : ''}{formatQuoteValue(position, position.pnl)} ({position.pnlPercent >= 0 ? '+' : ''}{Math.round(position.pnlPercent)}%)
                              </p>
                            )}
                          </>
                        )}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            );
          })()}

          {/* Orders Tab */}
          {activeTab === 'orders' && (
            openOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16">
                <p className="text-[#737373]">No open orders</p>
              </div>
            ) : (
              <div className="divide-y divide-[#262626]">
                {openOrders.map((order) => {
                  const fillPct = Number(order.size) > 0 ? (Number(order.filled) / Number(order.size)) * 100 : 0;
                  const sizeStr = (Number(order.size) / 1e6).toFixed(2);
                  const filledStr = (Number(order.filled) / 1e6).toFixed(2);
                  const priceStr = (order.price / 100).toFixed(2) + '%';
                  const title = getMarketTitle(order.marketId);

                  return (
                    <div key={order.id} className="px-4 sm:px-6 py-4 hover:bg-[#111111] transition-colors">
                      {/* Mobile Layout */}
                      <div className="sm:hidden">
                        <div className="flex items-start justify-between mb-2">
                          <div className="flex-1 min-w-0">
                            <h3 className="text-white font-medium text-sm truncate">{title}</h3>
                            <div className="flex items-center gap-2 mt-1">
                              <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${
                                order.side === 'buy' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                              }`}>
                                {order.side.toUpperCase()}
                              </span>
                              {order.tokenType && (
                                <span className={`text-xs px-1 py-0.5 rounded font-semibold ${
                                  order.tokenType === 'yes' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                                }`}>
                                  {order.tokenType.toUpperCase()}
                                </span>
                              )}
                              <span className="text-xs text-[#737373]">{priceStr}</span>
                              <span className="text-xs text-white">{sizeStr} shares</span>
                            </div>
                          </div>
                          <button
                            onClick={(e) => { e.stopPropagation(); handleCancelOrder(order); }}
                            disabled={cancellingOrderId === order.id || cancelLoading}
                            className="px-3 py-1.5 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs rounded font-medium transition-colors disabled:opacity-50 flex-shrink-0"
                          >
                            {cancellingOrderId === order.id ? 'Cancelling...' : 'Cancel'}
                          </button>
                        </div>
                        {fillPct > 0 && (
                          <div className="mt-1">
                            <div className="flex justify-between text-xs text-[#737373] mb-1">
                              <span>Filled: {filledStr}/{sizeStr}</span>
                              <span>{fillPct.toFixed(0)}%</span>
                            </div>
                            <div className="w-full bg-[#262626] rounded-full h-1">
                              <div className="bg-white h-1 rounded-full" style={{ width: `${fillPct}%` }} />
                            </div>
                          </div>
                        )}
                      </div>

                      {/* Desktop Layout */}
                      <div className="hidden sm:grid grid-cols-12 gap-4 items-center">
                        <div className="col-span-4">
                          <h3 className="text-white font-medium truncate text-sm">{title}</h3>
                          <span className="text-xs text-[#737373] capitalize">{order.type} order</span>
                        </div>
                        <div className="col-span-1 text-center flex items-center justify-center gap-1">
                          <span className={`text-xs px-2 py-0.5 rounded font-semibold ${
                            order.side === 'buy' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                          }`}>
                            {order.side.toUpperCase()}
                          </span>
                          {order.tokenType && (
                            <span className={`text-[10px] px-1 py-0.5 rounded font-semibold ${
                              order.tokenType === 'yes' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                            }`}>
                              {order.tokenType.toUpperCase()}
                            </span>
                          )}
                        </div>
                        <div className="col-span-2 text-center">
                          <span className="text-white text-sm">{priceStr}</span>
                        </div>
                        <div className="col-span-2 text-center">
                          <span className="text-white text-sm">{filledStr} / {sizeStr}</span>
                          {fillPct > 0 && fillPct < 100 && (
                            <div className="w-full bg-[#262626] rounded-full h-1 mt-1">
                              <div className="bg-white h-1 rounded-full" style={{ width: `${fillPct}%` }} />
                            </div>
                          )}
                        </div>
                        <div className="col-span-1 text-center">
                          <span className="text-xs text-[#737373] capitalize">{order.status.replace('_', ' ')}</span>
                        </div>
                        <div className="col-span-2 text-right">
                          <button
                            onClick={(e) => { e.stopPropagation(); handleCancelOrder(order); }}
                            disabled={cancellingOrderId === order.id || cancelLoading}
                            className="px-3 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs rounded font-medium transition-colors disabled:opacity-50"
                          >
                            {cancellingOrderId === order.id ? 'Cancelling...' : 'Cancel'}
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )
          )}

          {/* History Tab */}
          {activeTab === 'history' && (
            historyOrders.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-16">
                <p className="text-[#737373]">No order history</p>
              </div>
            ) : (
              <>
                <div className="divide-y divide-[#262626]">
                  {historyOrders.map((order: any) => {
                    const sizeStr = (Number(order.size) / 1e6).toFixed(2);
                    const filledStr = (Number(order.filled) / 1e6).toFixed(2);
                    const priceStr = (order.price / 100).toFixed(2) + '%';
                    const fillPriceStr = order.avgFillPrice ? ((order.avgFillPrice / 100).toFixed(2) + '%') : '--';
                    const title = getMarketTitle(order.marketId);
                    const isCancelled = order.status === 'cancelled';

                    return (
                      <div key={order.id} className={`px-4 sm:px-6 py-4 hover:bg-[#111111] transition-colors ${isCancelled ? 'opacity-50' : ''}`}>
                        {/* Mobile Layout */}
                        <div className="sm:hidden">
                          <div className="flex items-start justify-between mb-1">
                            <div className="flex-1 min-w-0">
                              <h3 className="text-white font-medium text-sm truncate">{title}</h3>
                              <div className="flex items-center gap-2 mt-1">
                                <span className={`text-xs px-1.5 py-0.5 rounded font-semibold ${
                                  order.side === 'buy' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                                }`}>
                                  {order.side.toUpperCase()}
                                </span>
                                {order.tokenType && (
                                  <span className={`text-xs px-1 py-0.5 rounded font-semibold ${
                                    order.tokenType === 'yes' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                                  }`}>
                                    {order.tokenType.toUpperCase()}
                                  </span>
                                )}
                                <span className="text-xs text-[#737373]">{priceStr}</span>
                                <span className="text-xs text-white">{isCancelled ? sizeStr : filledStr} shares</span>
                              </div>
                            </div>
                            <div className="text-right flex-shrink-0">
                              <span className={`text-xs ${isCancelled ? 'text-[#737373]' : 'text-emerald-400'}`}>
                                {isCancelled ? 'Cancelled' : 'Filled'}
                              </span>
                              <p className="text-xs text-[#737373] mt-0.5">{formatDate(order.createdAt)}</p>
                            </div>
                          </div>
                        </div>

                        {/* Desktop Layout */}
                        <div className="hidden sm:grid grid-cols-12 gap-4 items-center">
                          <div className="col-span-4">
                            <h3 className="text-white font-medium truncate text-sm">{title}</h3>
                            <span className="text-xs text-[#737373] capitalize">{order.type} order</span>
                          </div>
                          <div className="col-span-1 text-center flex items-center justify-center gap-1">
                            <span className={`text-xs px-2 py-0.5 rounded font-semibold ${
                              order.side === 'buy' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400'
                            }`}>
                              {order.side.toUpperCase()}
                            </span>
                            {order.tokenType && (
                              <span className={`text-[10px] px-1 py-0.5 rounded font-semibold ${
                                order.tokenType === 'yes' ? 'bg-emerald-500/15 text-emerald-400' : 'bg-red-500/15 text-red-400'
                              }`}>
                                {order.tokenType.toUpperCase()}
                              </span>
                            )}
                          </div>
                          <div className="col-span-2 text-center">
                            <span className="text-white text-sm">{fillPriceStr}</span>
                            {order.avgFillPrice && order.avgFillPrice !== order.price && (
                              <span className="text-xs text-[#737373] block">Limit: {priceStr}</span>
                            )}
                          </div>
                          <div className="col-span-2 text-center">
                            <span className="text-white text-sm">{isCancelled ? sizeStr : filledStr}</span>
                          </div>
                          <div className="col-span-1 text-center">
                            <span className={`text-xs ${isCancelled ? 'text-[#737373]' : 'text-emerald-400'}`}>
                              {isCancelled ? 'Cancelled' : 'Filled'}
                            </span>
                          </div>
                          <div className="col-span-2 text-right">
                            <span className="text-xs text-[#737373]">{formatDate(order.createdAt)}</span>
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Pagination */}
                {historyTotal > 50 && (
                  <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-t border-[#262626]">
                    <span className="text-xs text-[#737373]">
                      Showing {historyPage * 50 + 1}-{Math.min((historyPage + 1) * 50, historyTotal)} of {historyTotal}
                    </span>
                    <div className="flex gap-2">
                      <button
                        onClick={() => fetchHistory(historyPage - 1)}
                        disabled={historyPage === 0}
                        className="px-3 py-1 text-xs text-[#a3a3a3] hover:text-white border border-[#262626] rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        Prev
                      </button>
                      <button
                        onClick={() => fetchHistory(historyPage + 1)}
                        disabled={(historyPage + 1) * 50 >= historyTotal}
                        className="px-3 py-1 text-xs text-[#a3a3a3] hover:text-white border border-[#262626] rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                      >
                        Next
                      </button>
                    </div>
                  </div>
                )}
              </>
            )
          )}
        </>
      )}

      {/* Action Buttons Section (shown when position is selected/expanded) */}
      {activePositions.some(p => p.marketStatus === 3 || p.marketStatus === 0 || p.marketStatus === 1) && (
        <div className="border-t border-[#262626] p-3 sm:p-4">
          <div className="flex flex-col sm:flex-row flex-wrap gap-2">
            {activePositions.map((position, index) => (
              <div key={index} className="flex gap-2">
                {/* Close Position - for active markets with leveraged positions (leverage > 1) */}
                {position.marketStatus === 0 && position.leverage > 1 && position.positionType === 1 && (
                  <button
                    onClick={() => handleClosePosition(position)}
                    disabled={actionLoading === position.marketId + position.outcomeId || programLoading}
                    className="px-4 py-2 bg-red-500/10 hover:bg-red-500/20 text-red-400 border border-red-500/20 rounded-lg text-sm font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {actionLoading === position.marketId + position.outcomeId ? 'Closing...' : `Close ${position.marketTitle?.slice(0, 20)}...`}
                  </button>
                )}
                
                {/* Sell Position - for active markets with spot positions (leverage = 1) */}
                {position.marketStatus === 0 && position.leverage === 1 && position.positionType === 0 && (
                  <button
                    onClick={() => {
                      // Navigate to market trading panel with sell tab and show spot balance
                      window.location.href = `/market/${position.marketId}?tab=sell&outcome=${position.outcomeId}&shares=${position.shares}`;
                    }}
                    className="px-4 py-2 bg-blue-500/10 hover:bg-blue-500/20 text-blue-400 border border-blue-500/20 rounded-lg text-sm font-medium transition-colors"
                  >
                    Sell {formatShares(position.shares)} shares
                  </button>
                )}
                
                {/* Claim / Settle / Redeem buttons removed from the portfolio
                    page per product call. Settlement still happens — losing
                    positions are reaped and winners can be claimed via the
                    market detail page or the existing close-position flow. */}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

