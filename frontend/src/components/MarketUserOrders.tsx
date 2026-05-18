import { useMemo, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useSpaceProgram } from '@/hooks/useSpaceProgram';
import { useUserOrdersWebSocket, UserOrder } from '@/hooks/useUserOrdersWebSocket';
import { Market } from '@/types/market';
import axios from 'axios';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface MarketUserOrdersProps {
  marketId: string;
  market?: Market;
}

export function MarketUserOrders({ marketId, market }: MarketUserOrdersProps) {
  const { publicKey, connected } = useWallet();
  const { cancelOrder, isReady, loading: programLoading } = useSpaceProgram();
  const { orders: allOrders, loading, refetch } = useUserOrdersWebSocket();
  const [error, setError] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [hoveredOrderId, setHoveredOrderId] = useState<string | null>(null);

  // Filter orders for this market
  const marketOrders = useMemo(() => {
    return allOrders.filter((o) => o.marketId === marketId);
  }, [allOrders, marketId]);

  const openOrders = marketOrders.filter((o) => ['open', 'pending', 'partially_filled'].includes(o.status));
  const filledOrders = marketOrders.filter((o) => o.status === 'filled');

  const handleCancelOrder = async (order: UserOrder) => {
    if (!publicKey || !isReady || !order.orderId) {
      setError('Cannot cancel order');
      return;
    }

    setCancellingId(order.id);
    setError(null);

    try {
      const result = await cancelOrder({ orderId: order.orderId });

      if ((result as any)?.alreadyProcessed) {
        console.log('Order already processed on-chain, updating backend only');
      }

      // Update backend (always — whether on-chain cancel succeeded
      // or the order was already gone on-chain)
      try {
        await axios.delete(`${API_URL}/api/v1/orders/${order.id}`, {
          headers: { 'x-pubkey': publicKey.toString() },
        });
      } catch (apiErr) {
        console.warn('Backend update failed:', apiErr);
      }

      refetch();
    } catch (err: any) {
      setError(err.message || 'Failed to cancel order');
    } finally {
      setCancellingId(null);
    }
  };

  const quoteDecimals = (market as any)?.quoteDecimals ?? 6;
  // Order `size`/`filled` are SHARE counts (always 6-decimal base units),
  // not quote-denominated — the only place this hit is on SPACE markets
  // where dividing by 1e9 under-counted by 1000×.
  const formatAmount = (amount: string) =>
    (Number(amount) / 1_000_000).toFixed(2);
  const formatPrice = (price: number) => (price / 100).toFixed(2) + '¢';
  
  // Get display label for an order, incorporating tokenType for binary markets
  const getOrderLabel = (outcomeId: number, tokenType?: string): string => {
    const isBinary = !market?.outcomes || market.outcomes.length <= 2;
    if (isBinary) {
      // Binary: label is just YES or NO based on tokenType
      return (tokenType || 'yes') === 'no' ? 'NO' : 'YES';
    }
    // Multi-outcome: "OutcomeName YES/NO"
    const outcomeName = market?.outcomes?.[outcomeId]?.label || `Outcome ${outcomeId}`;
    const suffix = (tokenType || 'yes') === 'no' ? 'NO' : 'YES';
    return `${outcomeName} ${suffix}`;
  };
  
  // Format date for display
  const formatDate = (dateString: string) => {
    const date = new Date(dateString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  if (!connected || !publicKey) {
    return null;
  }

  if (marketOrders.length === 0 && !loading) {
    return null;
  }

  return (
    <div className="bg-[#141414] rounded-xl p-5">
      <h3 className="text-white font-semibold mb-4">Your Orders</h3>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="animate-pulse space-y-2">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-16 bg-[#1a1a1a] rounded-lg"></div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {/* Open Orders */}
          {openOrders.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm text-gray-400 font-medium">Open Orders</h4>
              {openOrders.map((order) => {
                const fillPercentage = Number(order.size) > 0
                  ? (Number(order.filled) / Number(order.size)) * 100
                  : 0;
                const outcomeLabel = getOrderLabel(order.outcomeId, order.tokenType);
                const shares = formatAmount(order.size);
                const filledShares = formatAmount(order.filled);
                const remainingShares = formatAmount((Number(order.size) - Number(order.filled)).toString());
                const displayPrice = order.price;

                return (
                  <div
                    key={order.id}
                    className="relative p-3 bg-[#1a1a1a] rounded-lg border border-[#262626]"
                    onMouseEnter={() => setHoveredOrderId(order.id)}
                    onMouseLeave={() => setHoveredOrderId(null)}
                  >
                    <div className="flex items-center justify-between mb-2">
                      <div className="flex items-center gap-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                          order.side === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                        }`}>
                          {order.side.toUpperCase()}
                        </span>
                        {order.tokenType && (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            order.tokenType === 'yes' ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
                          }`}>
                            {order.tokenType.toUpperCase()}
                          </span>
                        )}
                        <span className="text-sm text-gray-300">{formatPrice(displayPrice)}</span>
                        <span className="text-sm text-white font-medium">{shares} {outcomeLabel}</span>
                      </div>
                      <button
                        onClick={() => handleCancelOrder(order)}
                        disabled={cancellingId === order.id || programLoading}
                        className="px-3 py-1 bg-red-500/10 hover:bg-red-500/20 text-red-400 text-xs rounded font-medium transition-colors disabled:opacity-50"
                      >
                        {cancellingId === order.id ? 'Cancelling...' : 'Cancel'}
                      </button>
                    </div>

                    {fillPercentage > 0 && fillPercentage < 100 && (
                      <div className="mt-2">
                        <div className="flex justify-between text-xs text-gray-500 mb-1">
                          <span>Filled</span>
                          <span>{fillPercentage.toFixed(1)}%</span>
                        </div>
                        <div className="w-full bg-[#262626] rounded-full h-1.5">
                          <div
                            className="bg-white h-1.5 rounded-full transition-all"
                            style={{ width: `${fillPercentage}%` }}
                          />
                        </div>
                      </div>
                    )}

                    {/* Hover Tooltip */}
                    {hoveredOrderId === order.id && (
                      <div className="absolute z-50 right-0 top-full mt-2 w-80 p-4 bg-[#0a0a0a] border border-[#3B3B3B] rounded-lg shadow-xl">
                        <div className="space-y-2 text-xs">
                          <div className="flex justify-between">
                            <span className="text-gray-400">Order ID:</span>
                            <span className="text-white font-mono">{order.id.slice(0, 8)}...</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-400">Type:</span>
                            <span className="text-white capitalize">{order.type}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-400">Outcome:</span>
                            <span className="text-white">{outcomeLabel}</span>
                          </div>
                          {order.tokenType && (
                            <div className="flex justify-between">
                              <span className="text-gray-400">Token Type:</span>
                              <span className={order.tokenType === 'yes' ? 'text-green-400' : 'text-red-400'}>
                                {order.tokenType.toUpperCase()}
                              </span>
                            </div>
                          )}
                          <div className="flex justify-between">
                            <span className="text-gray-400">Limit Price:</span>
                            <span className="text-white">{formatPrice(order.price)}</span>
                          </div>
                          {order.avgFillPrice && Number(order.filled) > 0 && (
                            <div className="flex justify-between">
                              <span className="text-gray-400">Avg Fill Price:</span>
                              <span className="text-green-400">{formatPrice(order.avgFillPrice)}</span>
                            </div>
                          )}
                          <div className="flex justify-between">
                            <span className="text-gray-400">Size:</span>
                            <span className="text-white">{shares} shares</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-400">Filled:</span>
                            <span className="text-white">{filledShares} shares</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-400">Remaining:</span>
                            <span className="text-white">{remainingShares} shares</span>
                          </div>
                          {order.leverage > 1 && (
                            <div className="flex justify-between">
                              <span className="text-gray-400">Leverage:</span>
                              <span className="text-yellow-400">{order.leverage}x</span>
                            </div>
                          )}
                          <div className="flex justify-between">
                            <span className="text-gray-400">Status:</span>
                            <span className="text-white capitalize">{order.status.replace('_', ' ')}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-400">Created:</span>
                            <span className="text-white">{formatDate(order.createdAt)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-400">Updated:</span>
                            <span className="text-white">{formatDate(order.updatedAt)}</span>
                          </div>
                          {order.onChainOrder && (
                            <div className="pt-2 border-t border-[#262626]">
                              <div className="text-gray-400 mb-1">On-Chain Order:</div>
                              <div className="text-white font-mono text-[10px] break-all">{order.onChainOrder}</div>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {/* Filled Orders */}
          {filledOrders.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-sm text-gray-400 font-medium">Filled Orders</h4>
              {filledOrders.slice(0, 5).map((order) => {
                const outcomeLabel = getOrderLabel(order.outcomeId, order.tokenType);
                const filledShares = formatAmount(order.filled);
                const displayPrice = order.price;

                return (
                  <div
                    key={order.id}
                    className="relative p-3 bg-[#1a1a1a] rounded-lg border border-[#262626]"
                    onMouseEnter={() => setHoveredOrderId(order.id)}
                    onMouseLeave={() => setHoveredOrderId(null)}
                  >
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-3">
                        <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                          order.side === 'buy' ? 'bg-green-500/20 text-green-400' : 'bg-red-500/20 text-red-400'
                        }`}>
                          {order.side.toUpperCase()}
                        </span>
                        {order.tokenType && (
                          <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                            order.tokenType === 'yes' ? 'bg-green-500/15 text-green-400' : 'bg-red-500/15 text-red-400'
                          }`}>
                            {order.tokenType.toUpperCase()}
                          </span>
                        )}
                        <span className="text-sm text-gray-300">{formatPrice(displayPrice)}</span>
                        <span className="text-sm text-white font-medium">{filledShares} {outcomeLabel}</span>
                      </div>
                      <span className="text-xs text-green-400">Filled</span>
                    </div>

                    {/* Hover Tooltip */}
                    {hoveredOrderId === order.id && (
                      <div className="absolute z-50 right-0 top-full mt-2 w-80 p-4 bg-[#0a0a0a] border border-[#3B3B3B] rounded-lg shadow-xl">
                        <div className="space-y-2 text-xs">
                          <div className="flex justify-between">
                            <span className="text-gray-400">Order ID:</span>
                            <span className="text-white font-mono">{order.id.slice(0, 8)}...</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-400">Type:</span>
                            <span className="text-white capitalize">{order.type}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-400">Outcome:</span>
                            <span className="text-white">{outcomeLabel}</span>
                          </div>
                          {order.tokenType && (
                            <div className="flex justify-between">
                              <span className="text-gray-400">Token Type:</span>
                              <span className={order.tokenType === 'yes' ? 'text-green-400' : 'text-red-400'}>
                                {order.tokenType.toUpperCase()}
                              </span>
                            </div>
                          )}
                          {order.avgFillPrice && (
                            <div className="flex justify-between">
                              <span className="text-gray-400">Avg Fill Price:</span>
                              <span className="text-green-400">{formatPrice(order.avgFillPrice)}</span>
                            </div>
                          )}
                          <div className="flex justify-between">
                            <span className="text-gray-400">Filled:</span>
                            <span className="text-white">{filledShares} shares</span>
                          </div>
                          {order.leverage > 1 && (
                            <div className="flex justify-between">
                              <span className="text-gray-400">Leverage:</span>
                              <span className="text-yellow-400">{order.leverage}x</span>
                            </div>
                          )}
                          <div className="flex justify-between">
                            <span className="text-gray-400">Status:</span>
                            <span className="text-green-400 capitalize">{order.status}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-400">Created:</span>
                            <span className="text-white">{formatDate(order.createdAt)}</span>
                          </div>
                          <div className="flex justify-between">
                            <span className="text-gray-400">Updated:</span>
                            <span className="text-white">{formatDate(order.updatedAt)}</span>
                          </div>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
