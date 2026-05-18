import { useState } from 'react';
import { useOrderBookWebSocket } from '@/hooks/useOrderBookWebSocket';

interface OutcomeOption {
  id: number;
  label: string;
  lastPrice?: number;
}

interface MarketOrderBookSectionProps {
  marketId: string;
  outcomes?: OutcomeOption[];
  /** Decimals of the market's quote token. Defaults to 6 (USDC). */
  quoteDecimals?: number;
}

// Format helpers
const formatPrice = (price: number) => (price / 100).toFixed(2) + '¢';

export function MarketOrderBookSection({ marketId, outcomes, quoteDecimals = 6 }: MarketOrderBookSectionProps) {
  // Order book `size` is a share quantity (always 6 decimals on-chain) —
  // divide by 1e6 regardless of the market's quote token.
  const formatSize = (size: number) => {
    const units = size / 1_000_000;
    if (units >= 1000) return (units / 1000).toFixed(1) + 'K';
    return units.toFixed(2);
  };
  const [isOpen, setIsOpen] = useState(true);

  // Determine if this is a multi-outcome market (more than 2 outcomes)
  const isMultiOutcome = outcomes !== undefined && outcomes.length > 2;

  // For binary markets, always use outcome 0 and filter by tokenType (yes/no).
  // For multi-outcome markets, switch between outcomes and filter by tokenType sub-tabs.
  const defaultOutcomeId = isMultiOutcome ? (outcomes![0]?.id ?? 0) : 0;
  const [activeOutcomeId, setActiveOutcomeId] = useState<number>(defaultOutcomeId);
  const [orderBookSide, setOrderBookSide] = useState<'yes' | 'no'>('yes'); // YES or NO token type filter
  const [binaryTokenType, setBinaryTokenType] = useState<'yes' | 'no'>('yes'); // Binary market YES/NO filter

  // For binary markets: always outcome 0, filter by tokenType
  // For multi-outcome: selected outcome, filter by tokenType sub-tab
  const effectiveOutcomeId = isMultiOutcome ? activeOutcomeId : 0;
  const effectiveTokenType = isMultiOutcome ? orderBookSide : binaryTokenType;

  const { orderBook: currentOrderBook, loading: isLoading } = useOrderBookWebSocket(
    marketId,
    effectiveOutcomeId,
    100,
    effectiveTokenType,
  );

  return (
    <div className="bg-[#141414] rounded-xl">
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="w-full px-5 py-4 flex items-center justify-between"
      >
        <span className="text-white font-semibold">Order Book</span>
        <svg
          className={`w-5 h-5 text-gray-400 transition-transform ${isOpen ? 'rotate-180' : ''}`}
          fill="none"
          viewBox="0 0 24 24"
          stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>

      {isOpen && (
        <div className="px-5 pb-5">
          {/* Outcome Tabs */}
          <div className="flex gap-2 mb-4">
            {isMultiOutcome ? (
              // Multi-outcome: render a tab for each outcome with neutral color scheme
              outcomes!.map((outcome) => (
                <button
                  key={outcome.id}
                  onClick={() => setActiveOutcomeId(outcome.id)}
                  className={`flex-1 py-2.5 text-sm font-semibold rounded-lg ${
                    activeOutcomeId === outcome.id
                      ? ' text-white border border-white/20'
                      : ' text-gray-400 hover:text-white bg-black/20'
                  }`}
                >
                  {outcome.label}
                  {outcome.lastPrice !== undefined && (
                    <span className="ml-1 text-xs text-gray-500">
                      {formatPrice(outcome.lastPrice)}
                    </span>
                  )}
                </button>
              ))
            ) : (
              // Binary market: YES / NO tabs filter by tokenType on outcome 0
              <>
                <button
                  onClick={() => setBinaryTokenType('yes')}
                  className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-colors ${
                    binaryTokenType === 'yes'
                      ? 'bg-green-500/20 text-green-400 border border-green-500/50'
                      : 'bg-[#1a1a1a] text-gray-400 hover:text-white'
                  }`}
                >
                  YES Orders
                </button>
                <button
                  onClick={() => setBinaryTokenType('no')}
                  className={`flex-1 py-2.5 text-sm font-semibold rounded-lg transition-colors ${
                    binaryTokenType === 'no'
                      ? 'bg-red-500/20 text-red-400 border border-red-500/50'
                      : 'bg-[#1a1a1a] text-gray-400 hover:text-white'
                  }`}
                >
                  NO Orders
                </button>
              </>
            )}
          </div>

          {/* YES / NO sub-tabs for multi-outcome markets */}
          {isMultiOutcome && (
            <div className="flex gap-2 mb-4">
              <button
                onClick={() => setOrderBookSide('yes')}
                className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors ${
                  orderBookSide === 'yes'
                    ? 'bg-green-500/20 text-green-400 border border-green-500/50'
                    : 'bg-[#1a1a1a] text-gray-400 hover:text-white'
                }`}
              >
                YES Orders
              </button>
              <button
                onClick={() => setOrderBookSide('no')}
                className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-colors ${
                  orderBookSide === 'no'
                    ? 'bg-red-500/20 text-red-400 border border-red-500/50'
                    : 'bg-[#1a1a1a] text-gray-400 hover:text-white'
                }`}
              >
                NO Orders
              </button>
            </div>
          )}

          {/* Price & Spread Info */}
          <div className="flex items-center justify-between mb-4 text-sm">
            <div className="flex items-center gap-4">
              <span className="text-gray-500">Current Price:</span>
              <span className="text-white font-semibold">
                {(() => {
                  if (!currentOrderBook) {
                    return '50.00¢';
                  }

                  // Get sorted bids (descending - highest first) and asks (ascending - lowest first)
                  const bids = currentOrderBook.bids || [];
                  const asks = currentOrderBook.asks || [];

                  const sortedBids = [...bids].sort((a, b) => b.price - a.price);
                  const sortedAsks = [...asks].sort((a, b) => a.price - b.price);

                  let currentPrice: number;

                  if (sortedBids.length > 0 && sortedAsks.length > 0) {
                    // Mid-price: (best_bid + best_ask) / 2
                    const bestBid = sortedBids[0].price;
                    const bestAsk = sortedAsks[0].price;
                    currentPrice = Math.floor((bestBid + bestAsk) / 2);

                    // Debug log
                    if (process.env.NODE_ENV === 'development') {
                      console.log('[MarketOrderBook] Price calculation:', {
                        bestBid,
                        bestAsk,
                        midPrice: currentPrice,
                        bidsCount: sortedBids.length,
                        asksCount: sortedAsks.length,
                      });
                    }
                  } else if (sortedBids.length > 0) {
                    // Best bid if only bids exist
                    currentPrice = sortedBids[0].price;
                  } else if (sortedAsks.length > 0) {
                    // Best ask if only asks exist
                    currentPrice = sortedAsks[0].price;
                  } else {
                    // Fallback to lastPrice or default
                    currentPrice = currentOrderBook.lastPrice || 5000;
                  }

                  return formatPrice(currentPrice);
                })()}
              </span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-gray-500">Spread:</span>
              <span className="text-green-400 font-semibold">
                {(() => {
                  if (!currentOrderBook) {
                    return '0.00¢';
                  }

                  const bids = currentOrderBook.bids || [];
                  const asks = currentOrderBook.asks || [];

                  const sortedBids = [...bids].sort((a, b) => b.price - a.price);
                  const sortedAsks = [...asks].sort((a, b) => a.price - b.price);

                  if (sortedBids.length > 0 && sortedAsks.length > 0) {
                    const spread = sortedAsks[0].price - sortedBids[0].price;
                    return formatPrice(Math.abs(spread));
                  }
                  return '0.00¢';
                })()}
              </span>
            </div>
          </div>

          {isLoading ? (
            <div className="animate-pulse space-y-2">
              {[...Array(5)].map((_, i) => (
                <div key={i} className="h-8 bg-[#1a1a1a] rounded"></div>
              ))}
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              {/* Sell Orders (Asks) */}
              <div>
                <div className="flex items-center justify-between mb-2 pb-2 border-b border-[#262626]">
                  <span className="text-xs font-semibold text-red-400 uppercase tracking-wide">
                    Sell
                  </span>
                  <div className="flex gap-6 text-xs text-gray-500">
                    <span>Price</span>
                    <span>Size</span>
                  </div>
                </div>
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {currentOrderBook?.asks && currentOrderBook.asks.length > 0 ? (
                    [...currentOrderBook.asks].sort((a, b) => a.price - b.price).map((ask, i) => {
                      const maxSize = Math.max(
                        ...(currentOrderBook.asks?.map(a => a.size) || [1]),
                        ...(currentOrderBook.bids?.map(b => b.size) || [1]),
                        1
                      );
                      return (
                        <div
                          key={i}
                          className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-[#1a1a1a] relative cursor-pointer group"
                        >
                          <div
                            className="absolute left-0 top-0 bottom-0 bg-red-500/10 rounded"
                            style={{ width: `${(ask.size / maxSize) * 100}%` }}
                          />
                          <span className="text-sm text-red-400 font-medium relative z-10">{formatPrice(ask.price)}</span>
                          <span className="text-sm text-gray-400 font-mono relative z-10">{formatSize(ask.size)}</span>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center py-4 text-gray-600 text-sm">No sell orders</div>
                  )}
                </div>
              </div>

              {/* Buy Orders (Bids) */}
              <div>
                <div className="flex items-center justify-between mb-2 pb-2 border-b border-[#262626]">
                  <span className="text-xs font-semibold text-green-400 uppercase tracking-wide">Buy</span>
                  <div className="flex gap-6 text-xs text-gray-500">
                    <span>Price</span>
                    <span>Size</span>
                  </div>
                </div>
                <div className="space-y-1 max-h-64 overflow-y-auto">
                  {currentOrderBook?.bids && currentOrderBook.bids.length > 0 ? (
                    [...currentOrderBook.bids].sort((a, b) => b.price - a.price).map((bid, i) => {
                      const maxSize = Math.max(
                        ...(currentOrderBook.asks?.map(a => a.size) || [1]),
                        ...(currentOrderBook.bids?.map(b => b.size) || [1]),
                        1
                      );
                      return (
                        <div
                          key={i}
                          className="flex items-center justify-between py-1.5 px-2 rounded hover:bg-[#1a1a1a] relative cursor-pointer group"
                        >
                          <div
                            className="absolute right-0 top-0 bottom-0 bg-green-500/10 rounded"
                            style={{ width: `${(bid.size / maxSize) * 100}%` }}
                          />
                          <span className="text-sm text-green-400 font-medium relative z-10">{formatPrice(bid.price)}</span>
                          <span className="text-sm text-gray-400 font-mono relative z-10">{formatSize(bid.size)}</span>
                        </div>
                      );
                    })
                  ) : (
                    <div className="text-center py-4 text-gray-600 text-sm">No buy orders</div>
                  )}
                </div>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
