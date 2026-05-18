import { useEffect, useState } from 'react';
import { useOrderBookWebSocket } from '@/hooks/useOrderBookWebSocket';

interface OrderBookProps {
  marketId: string;
  outcomeId?: number;
  side?: 'yes' | 'no';
  /** Decimals of the market's quote token. Defaults to 6 (USDC) for legacy callers. */
  quoteDecimals?: number;
}

interface OrderBookLevel {
  price: number;
  size: number;
  orders: number;
  total_value?: number;
}

interface OrderBookData {
  bids: OrderBookLevel[];
  asks: OrderBookLevel[];
  last_price: number;
  spread: number;
  spread_bps: number;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

export function OrderBook({ marketId, outcomeId = 0, side = 'yes', quoteDecimals = 6 }: OrderBookProps) {
  // Use WebSocket instead of polling
  const { orderBook: wsOrderBook, loading } = useOrderBookWebSocket(marketId, outcomeId, 100);
  const [orderbook, setOrderbook] = useState<OrderBookData | null>(null);

  useEffect(() => {
    if (wsOrderBook) {
      // Sort orders like a traditional exchange:
      // - SELL orders (asks): lowest price at top (best ask first) - ascending
      // - BUY orders (bids): highest price at top (best bid first) - descending
      const sortedAsks = [...wsOrderBook.asks].sort((a, b) => a.price - b.price); // Ascending (lowest first)
      const sortedBids = [...wsOrderBook.bids].sort((a, b) => b.price - a.price); // Descending (highest first)
      
      // Calculate spread from best bid and ask if not provided
      let spread = wsOrderBook.spread;
      if (spread === undefined || spread === null) {
        if (sortedBids.length > 0 && sortedAsks.length > 0) {
          // Spread = best ask (lowest sell) - best bid (highest buy)
          spread = sortedAsks[0].price - sortedBids[0].price;
        } else {
          spread = 0;
        }
      }
      
      // Calculate current price as mid-price (like centralized exchanges)
      // Priority: mid-price > best bid > best ask > lastPrice > default
      let currentPrice: number;
      if (sortedBids.length > 0 && sortedAsks.length > 0) {
        // Mid-price when both sides exist: (best_bid + best_ask) / 2
        currentPrice = Math.floor((sortedBids[0].price + sortedAsks[0].price) / 2);
      } else if (sortedBids.length > 0) {
        // Best bid if only bids exist
        currentPrice = sortedBids[0].price;
      } else if (sortedAsks.length > 0) {
        // Best ask if only asks exist
        currentPrice = sortedAsks[0].price;
      } else {
        // Fallback to lastPrice or default
        currentPrice = wsOrderBook.lastPrice || 5000;
      }
      
      const safeOrderbook: OrderBookData = {
        bids: sortedBids,
        asks: sortedAsks,
        last_price: currentPrice,
        spread: spread,
        spread_bps: spread, // Spread is already in basis points
      };
      
      setOrderbook(safeOrderbook);
    } else if (!loading) {
      // Set empty orderbook if no data and not loading
      setOrderbook({
        bids: [],
        asks: [],
        last_price: 5000,
        spread: 0,
        spread_bps: 0,
      });
    }
  }, [wsOrderBook, loading]);

  if (loading) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <div className="animate-pulse space-y-4">
          <div className="h-6 bg-gray-200 rounded w-1/3"></div>
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <div key={i} className="h-8 bg-gray-100 rounded"></div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!orderbook) {
    return (
      <div className="bg-white rounded-xl border border-gray-200 p-6">
        <p className="text-gray-500">No orderbook data available</p>
      </div>
    );
  }

  const formatPrice = (price: number) => {
    return (price / 100).toFixed(2) + '¢';
  };

  const formatSize = (size: number) => {
    // `size` is a share quantity in share base units. Share mints are fixed
    // at 6 decimals on-chain regardless of the market's quote token, so this
    // divisor is always 1e6 — using quoteDecimals here under-counts SPACE
    // market shares by 10^(quote_decimals - 6).
    const units = size / 1_000_000;
    if (units >= 1000) {
      return (units / 1000).toFixed(1) + 'K';
    }
    return units.toFixed(2);
  };

  // Safely calculate max size with fallbacks
  const bidsSizes = orderbook.bids?.map((b) => b.size) || [];
  const asksSizes = orderbook.asks?.map((a) => a.size) || [];
  const maxSize = Math.max(
    ...bidsSizes,
    ...asksSizes,
    1
  );

  return (
    <div className="bg-space-gray-800 rounded-xl border border-space-gray-700 p-6">
      <div className="flex items-center justify-between mb-6">
        <h2 className="text-xl font-bold text-white">Order Book</h2>
        <div className="flex items-center space-x-4 text-sm">
          <div>
            <span className="text-space-gray-400">Current Price: </span>
            <span className="font-semibold text-white">{formatPrice(orderbook.last_price)}</span>
          </div>
          <div>
            <span className="text-space-gray-400">Spread: </span>
            <span className="font-semibold text-space-primary">
              {orderbook.bids.length > 0 && orderbook.asks.length > 0
                ? ((orderbook.asks[0].price - orderbook.bids[0].price) / 100).toFixed(2) + '¢'
                : orderbook.spread_bps !== undefined && orderbook.spread_bps !== null
                ? (orderbook.spread_bps / 100).toFixed(2) + '¢'
                : '0.00¢'}
            </span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-6">
        {/* Asks (Sell Orders) - Top */}
        <div>
          <div className="flex items-center justify-between mb-3 px-2 pb-2 border-b border-space-gray-700">
            <span className="text-xs font-semibold text-space-danger uppercase tracking-wide">Sell Orders</span>
            <div className="flex space-x-4 text-xs text-space-gray-400">
              <span>Price</span>
              <span>Size</span>
            </div>
          </div>
          <div className="space-y-0.5 max-h-96 overflow-y-auto">
            {(orderbook.asks || []).map((ask, index) => (
              <div
                key={index}
                className="flex items-center justify-between px-3 py-2 rounded hover:bg-space-gray-700/50 group relative transition-colors cursor-pointer"
                onClick={() => {
                  // Could trigger price fill in trading panel
                  console.log('Clicked ask:', ask);
                }}
              >
                <div
                  className="absolute left-0 top-0 bottom-0 bg-space-danger/10 rounded transition-all"
                  style={{ width: `${(ask.size / maxSize) * 100}%` }}
                />
                <div className="flex items-center justify-between w-full relative z-10">
                  <span className="text-sm font-medium text-space-danger">
                    {formatPrice(ask.price)}
                  </span>
                  <span className="text-sm text-space-gray-300 font-mono">{formatSize(ask.size)}</span>
                </div>
              </div>
            ))}
            {(!orderbook.asks || orderbook.asks.length === 0) && (
              <div className="text-center py-4 text-space-gray-500 text-sm">No sell orders</div>
            )}
          </div>
        </div>

        {/* Bids (Buy Orders) - Bottom */}
        <div>
          <div className="flex items-center justify-between mb-3 px-2 pb-2 border-b border-space-gray-700">
            <span className="text-xs font-semibold text-space-success uppercase tracking-wide">Buy Orders</span>
            <div className="flex space-x-4 text-xs text-space-gray-400">
              <span>Price</span>
              <span>Size</span>
            </div>
          </div>
          <div className="space-y-0.5 max-h-96 overflow-y-auto">
            {(orderbook.bids || []).map((bid, index) => (
              <div
                key={index}
                className="flex items-center justify-between px-3 py-2 rounded hover:bg-space-gray-700/50 group relative transition-colors cursor-pointer"
                onClick={() => {
                  // Could trigger price fill in trading panel
                  console.log('Clicked bid:', bid);
                }}
              >
                <div
                  className="absolute right-0 top-0 bottom-0 bg-space-success/10 rounded transition-all"
                  style={{ width: `${(bid.size / maxSize) * 100}%` }}
                />
                <div className="flex items-center justify-between w-full relative z-10">
                  <span className="text-sm font-medium text-space-success">
                    {formatPrice(bid.price)}
                  </span>
                  <span className="text-sm text-space-gray-300 font-mono">{formatSize(bid.size)}</span>
                </div>
              </div>
            ))}
            {(!orderbook.bids || orderbook.bids.length === 0) && (
              <div className="text-center py-4 text-space-gray-500 text-sm">No buy orders</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
