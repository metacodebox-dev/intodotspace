import { useMemo, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useSpaceProgram } from '@/hooks/useSpaceProgram';
import { useUserPositionsWebSocket, UserPosition } from '@/hooks/useUserPositionsWebSocket';
import { PublicKey } from '@solana/web3.js';

interface MarketPositionsProps {
  marketId: string;
  outcomes?: Array<{ id: number; label: string }>;
  marketStatus?: number; // 0=Active, 1=Resolving, 2=Disputed, 3=Finalized, 4=Invalid
  marketEndDate?: string; // ISO date string
  quoteDecimals?: number; // defaults to 6 (USDC)
  quoteSymbol?: string;   // defaults to 'USDC'
}

export function MarketPositions({ marketId, outcomes, marketStatus, marketEndDate, quoteDecimals = 6, quoteSymbol = 'USDC' }: MarketPositionsProps) {
  const { publicKey, connected } = useWallet();
  const { closePosition, closeLeveragedPosition, loading: programLoading } = useSpaceProgram();
  const { positions: allPositions, loading, liquidationWarnings } = useUserPositionsWebSocket();
  const [error, setError] = useState<string | null>(null);
  const [closingId, setClosingId] = useState<string | null>(null);

  // Filter positions for this market - only show leveraged positions (leverage > 1) with shares > 0
  // Spot positions are displayed in the portfolio page, not here
  const marketPositions = useMemo(() => {
    return allPositions.filter((p) => {
      const shares = Number(p.shares);
      const isActive = shares > 0; // Only show positions with shares > 0
      return (p.marketId === marketId || p.market === marketId) && 
             p.leverage > 1 && // Only show leveraged positions
             isActive; // Only show active positions (shares > 0)
    });
  }, [allPositions, marketId]);

  // Filter liquidation warnings for this market
  const marketWarnings = useMemo(() => {
    return liquidationWarnings.filter((w) => w.marketId === marketId);
  }, [liquidationWarnings, marketId]);

  // Check if market is still active for trading (closing positions requires placing sell orders)
  const isMarketActive = (() => {
    const status = marketStatus ?? 0;
    const isExpired = marketEndDate ? new Date(marketEndDate) < new Date() : false;
    return status === 0 && !isExpired;
  })();

  const handleClosePosition = async (position: UserPosition) => {
    if (!publicKey) return;

    setClosingId(position.id);
    setError(null);

    try {
      const marketPDA = new PublicKey(position.market);
      
      // Only leveraged positions (leverage > 1) can be closed here
      // Use closeLeveragedPosition which places a sell order at best available price
      // It will match with existing buy orders or place a sell order
      // Debt is automatically repaid and remaining USDC is returned to user
      if (position.leverage && position.leverage > 1) {
        // Leveraged position - use closeLeveragedPosition
        await closeLeveragedPosition({
          market: marketPDA,
          outcomeId: position.outcomeId || 0, // Default to 0 if not provided
          side: position.side || 0, // 0 = Long, 1 = Short
          tokenType: position.tokenType,
        });
      } else {
        // Spot positions should be sold via trading panel
        throw new Error('Spot positions must be sold via the trading panel');
      }

      // Trigger position refresh after closing
      // WebSocket will update, but also trigger manual refresh to ensure UI updates
      setTimeout(() => {
        // Dispatch refresh event to trigger position refetch
        window.dispatchEvent(new CustomEvent('positions-refresh'));
      }, 2000);
    } catch (err: any) {
      setError(err.message || 'Failed to close position');
    } finally {
      setClosingId(null);
    }
  };


  // Shares are always 6-decimal on-chain; quote-denominated fields (collateral,
  // borrowedAmount, pnl lamports) use the market's quote_decimals.
  const formatShares = (amount: string) => (Number(amount) / 1_000_000).toFixed(2);
  const formatQuote = (amount: string) =>
    (Number(amount) / Math.pow(10, quoteDecimals)).toFixed(2);
  const formatPrice = (price: number) => Math.round(price / 100) + '¢';

  if (!connected || !publicKey) {
    return null;
  }

  if (marketPositions.length === 0 && !loading) {
    return null;
  }

  return (
    <div className="bg-[#141414] rounded-xl p-5">
      <h3 className="text-white font-semibold mb-4">Your Positions</h3>

      {/* Liquidation Warnings */}
      {marketWarnings.length > 0 && (
        <div className="mb-4 space-y-2">
          {marketWarnings.map((warning) => (
            <div key={warning.positionId} className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
              <div className="flex items-center justify-between">
                <span className="text-red-400 text-sm font-semibold">⚠️ Liquidation Warning</span>
                <span className="text-xs text-red-300">Position at risk</span>
              </div>
              <div className="mt-2 text-xs text-red-300">
                Current: {warning.currentPrice / 100}% | Liq: {warning.liquidationPrice / 100}%
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="animate-pulse space-y-2">
          {[0, 1].map((i) => (
            <div key={i} className="h-24 bg-[#1a1a1a] rounded-lg"></div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {marketPositions.map((position) => {
            const pnl = position.pnl ? parseFloat(position.pnl) : 0;
            const pnlPercent = position.pnlPercent || 0;
            const isProfit = pnl >= 0;
            const isLiquidatable = position.isLiquidatable || false;

            return (
              <div
                key={position.id}
                className={`p-4 rounded-lg border ${
                  isLiquidatable
                    ? 'bg-red-500/10 border-red-500/50'
                    : 'bg-[#1a1a1a] border-[#262626]'
                }`}
              >
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-3">
                    <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                      position.side === 0 ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                    }`}>
                      {position.side === 0 ? 'BUY':'SELL'}
                    </span>
                    <span className={`text-sm font-medium ${position.tokenType === 'no' ? 'text-red-400' : 'text-emerald-400'}`}>
                      {(!outcomes || outcomes.length <= 2)
                        ? (position.tokenType === 'no' ? 'NO' : 'YES')
                        : `${outcomes?.[position.outcomeId]?.label || `Outcome ${position.outcomeId}`} ${position.tokenType === 'no' ? 'NO' : 'YES'}`
                      }
                    </span>
                    <span className="text-xs text-yellow-400">{position.leverage}x</span>
                  </div>
                  {isMarketActive ? (
                    <button
                      onClick={() => handleClosePosition(position)}
                      disabled={closingId === position.id || programLoading}
                      className="px-3 py-1.5 bg-white hover:bg-gray-100 text-black text-xs font-medium rounded-lg transition-colors disabled:opacity-50"
                    >
                      {closingId === position.id ? 'Closing...' : 'Close'}
                    </button>
                  ) : (
                    <span className="px-3 py-1.5 text-xs font-medium text-gray-500">
                      {(marketStatus ?? 0) === 3 ? 'Redeemable' : 'Market Ended'}
                    </span>
                  )}
                </div>

                {/* PnL */}
                <div className="flex items-center justify-between mb-3 p-2 bg-[#0a0a0a] rounded-lg">
                  <span className="text-sm text-gray-400">Unrealized PnL</span>
                  <div className="text-right">
                    <div className={`text-lg font-bold ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
                      {isProfit ? '+' : ''}{pnl.toFixed(2)} {quoteSymbol}
                    </div>
                    <div className={`text-xs ${isProfit ? 'text-green-400' : 'text-red-400'}`}>
                      {isProfit ? '+' : ''}{pnlPercent.toFixed(2)}%
                    </div>
                  </div>
                </div>

                {/* Details */}
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div>
                    <span className="text-gray-500">Entry</span>
                    <span className="text-white ml-2">{formatPrice(position.avgEntryPrice)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Current</span>
                    <span className="text-white ml-2">{position.currentPrice ? formatPrice(position.currentPrice) : 'N/A'}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Shares</span>
                    <span className="text-white ml-2">{formatShares(position.shares)}</span>
                  </div>
                  <div>
                    <span className="text-gray-500">Collateral</span>
                    <span className="text-white ml-2">{formatQuote(position.collateral)} {quoteSymbol}</span>
                  </div>
                  {position.liquidationPrice ? (
                    <div className="col-span-2 mt-1 p-2 bg-[#0a0a0a] rounded-lg flex items-center justify-between">
                      <span className="text-gray-500">Liq. Price</span>
                      <span className={`font-medium ${
                        position.currentPrice && (
                          (position.side === 0 && position.currentPrice <= position.liquidationPrice * 1.1) ||
                          (position.side === 1 && position.currentPrice >= position.liquidationPrice * 0.9)
                        ) ? 'text-red-400' : 'text-amber-400'
                      }`}>
                        {formatPrice(position.liquidationPrice)}
                      </span>
                    </div>
                  ) : null}
                </div>

                {/* Liquidation Warning */}
                {isLiquidatable && (
                  <div className="mt-3 p-2 bg-red-500/20 border border-red-500/50 rounded text-xs text-red-400">
                    ⚠️ Position is at risk of liquidation!
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
