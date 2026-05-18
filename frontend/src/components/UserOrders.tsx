import { useState, useEffect, useMemo } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useSpaceProgram } from '@/hooks/useSpaceProgram';
import { useUserOrdersWebSocket } from '@/hooks/useUserOrdersWebSocket';
import { useUserPositionsWebSocket } from '@/hooks/useUserPositionsWebSocket';
import axios from 'axios';
import { PublicKey } from '@solana/web3.js';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface Order {
  id: string;
  marketId: string;
  outcomeId: number;
  side: 'buy' | 'sell';
  type: 'market' | 'limit';
  price: number;
  size: string;
  filled: string;
  leverage: number;
  status: 'pending' | 'open' | 'partially_filled' | 'filled' | 'cancelled';
  createdAt: string;
  updatedAt: string;
  orderId?: number | null;
  onChainOrder?: string | null;
  quoteMint?: string | null;
  quoteDecimals?: number;
  quoteSymbol?: string;
}

interface Position {
  id: string;
  market: string;
  marketId: string;
  marketTitle?: string;
  outcomeId: number;
  side: number;
  shares: string;
  avgEntryPrice: number;
  leverage: number;
  collateral: string;
  currentPrice?: number;
  positionValue?: string;
  pnl?: string;
  pnlPercent?: number;
  liquidationPrice?: number;
  equity?: string;
  isLiquidatable?: boolean;
  tokenType?: string;
  quoteMint?: string | null;
  quoteDecimals?: number;
  quoteSymbol?: string;
}

export function UserOrders() {
  const { publicKey, connected } = useWallet();
  const { closePosition, cancelOrder, isReady, loading: programLoading } = useSpaceProgram();
  const [activeTab, setActiveTab] = useState<'open' | 'filled' | 'positions'>('open');
  const [error, setError] = useState<string | null>(null);
  const [closingPositionId, setClosingPositionId] = useState<string | null>(null);

  // Use WebSocket hooks for real-time updates
  // Fetch ALL orders once, filter client-side to avoid multiple API calls
  const { orders: allOrders, loading: ordersLoading } = useUserOrdersWebSocket();
  const { positions, loading: positionsLoading, liquidationWarnings } = useUserPositionsWebSocket();

  // Filter orders based on active tab (client-side filtering)
  const orders = useMemo(() => {
    if (activeTab === 'open') {
      return allOrders.filter((o) => ['open', 'pending', 'partially_filled'].includes(o.status));
    } else if (activeTab === 'filled') {
      return allOrders.filter((o) => o.status === 'filled');
    }
    return [];
  }, [allOrders, activeTab]);

  const loading = activeTab === 'positions' ? positionsLoading : ordersLoading;

  const handleCancelOrder = async (order: Order) => {
    if (!publicKey || !isReady) return;

    // Check if we have the on-chain order ID
    if (!order.orderId) {
      setError('Order does not have on-chain order ID. Cannot cancel on-chain.');
      return;
    }

    try {
      setError(null);

      // First, cancel on-chain to get margin back
      const result = await cancelOrder({
        orderId: order.orderId,
      });

      if ((result as any)?.alreadyProcessed) {
        console.log('Order already processed on-chain, updating backend only');
      }

      // Update backend database (always — whether on-chain cancel succeeded
      // or the order was already gone on-chain)
      try {
        await axios.delete(`${API_URL}/api/v1/orders/${order.id}`, {
          headers: {
            'x-pubkey': publicKey.toString(),
          },
        });
      } catch (apiErr: any) {
        // If on-chain cancel succeeded but API fails, that's okay
        // The order is cancelled on-chain which is what matters
        console.warn('On-chain cancel succeeded but API update failed:', apiErr);
      }

      // Orders will auto-update via WebSocket
    } catch (err: any) {
      console.error('Cancel order error:', err);
      setError(err.message || 'Failed to cancel order');
    }
  };

  const handleClosePosition = async (position: Position) => {
    if (!publicKey || !isReady || closingPositionId) return;

    setClosingPositionId(position.id);
    setError(null);

    try {
      // Use market PDA from position data
      const marketPDA = new PublicKey(position.market);
      
      await closePosition({
        market: marketPDA,
        outcomeId: position.outcomeId,
        side: position.side,
        tokenType: position.tokenType,
      });

      // Positions will auto-update via WebSocket
    } catch (err: any) {
      console.error('Close position error:', err);
      setError(err.message || 'Failed to close position');
    } finally {
      setClosingPositionId(null);
    }
  };

  const formatAmount = (amount: string, decimals: number = 6) => {
    return (Number(amount) / Math.pow(10, decimals)).toFixed(2);
  };

  const formatPrice = (price: number) => {
    return Math.round(price / 100) + '¢';
  };

  const calculatePnL = (order: Order, currentPrice?: number) => {
    if (!currentPrice || order.status !== 'filled') return null;
    
    const filledAmount = Number(order.filled) / 1e6;
    const entryPrice = order.price / 100;
    const side = order.side === 'buy' ? 'long' : 'short';
    
    if (side === 'long') {
      const pnl = ((currentPrice - entryPrice) / 100) * filledAmount;
      const pnlPercent = entryPrice > 0 ? ((currentPrice - entryPrice) / entryPrice) * 100 : 0;
      return { pnl, pnlPercent };
    } else {
      const pnl = ((entryPrice - currentPrice) / 100) * filledAmount;
      const pnlPercent = entryPrice > 0 ? ((entryPrice - currentPrice) / entryPrice) * 100 : 0;
      return { pnl, pnlPercent };
    }
  };

  if (!connected || !publicKey) {
    return (
      <div className="bg-space-gray-800 rounded-xl border border-space-gray-700 p-6">
        <h3 className="text-lg font-bold text-white mb-2">Your Orders</h3>
        <p className="text-sm text-space-gray-400">Connect your wallet to view your orders</p>
      </div>
    );
  }

  return (
    <div className="bg-space-gray-800 rounded-xl border border-space-gray-700 p-6">
      <h3 className="text-lg font-bold text-white mb-4">Your Orders</h3>

      {/* Tabs */}
      <div className="flex space-x-2 mb-4 border-b border-space-gray-700">
        {[
          { 
            id: 'open' as const, 
            label: 'Open Orders', 
            count: activeTab === 'open' 
              ? orders.filter(o => ['open', 'pending', 'partially_filled'].includes(o.status)).length
              : 0
          },
          { 
            id: 'filled' as const, 
            label: 'Filled Orders', 
            count: activeTab === 'filled' 
              ? orders.filter(o => o.status === 'filled').length
              : 0
          },
          { id: 'positions' as const, label: 'Positions', count: positions.length },
        ].map((tab) => (
          <button
            key={tab.id}
            onClick={() => {
              setActiveTab(tab.id);
            }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.id
                ? 'border-space-primary text-space-primary'
                : 'border-transparent text-space-gray-400 hover:text-white'
            }`}
          >
            {tab.label} {tab.count > 0 && <span className="ml-1 text-xs">({tab.count})</span>}
          </button>
        ))}
      </div>

      {/* Liquidation Warnings */}
      {liquidationWarnings.length > 0 && (
        <div className="mb-4 space-y-2">
          {liquidationWarnings.map((warning) => (
            (() => {
              // Resolve the warning's market quote so equity is formatted in
              // the correct decimals/symbol (USDC markets stay 1e6/"USDC";
              // SPACE markets use 1e9/"SPACE").
              const relatedPosition = positions.find((p: any) => p.id === warning.positionId);
              const wQuoteDecimals = (relatedPosition as any)?.quoteDecimals ?? 6;
              const wQuoteSymbol = (relatedPosition as any)?.quoteSymbol ?? 'USDC';
              const equityHuman = parseFloat(warning.equity) / Math.pow(10, wQuoteDecimals);
              return (
                <div key={warning.positionId} className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
                  <div className="flex items-center justify-between">
                    <div className="text-red-400 text-sm font-semibold">
                      ⚠️ Liquidation Warning
                    </div>
                    <div className="text-xs text-red-300">
                      Position at risk
                    </div>
                  </div>
                  <div className="mt-2 text-xs text-red-300">
                    Current: {Math.round(warning.currentPrice / 100)}¢ | Liquidation: {Math.round(warning.liquidationPrice / 100)}¢ | Equity: {equityHuman.toFixed(2)} {wQuoteSymbol}
                  </div>
                </div>
              );
            })()
          ))}
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm">
          {error}
        </div>
      )}

      {loading ? (
        <div className="text-center py-8">
          <div className="inline-block animate-spin rounded-full h-8 w-8 border-4 border-space-primary border-t-transparent"></div>
          <p className="mt-2 text-sm text-space-gray-400">Loading...</p>
        </div>
      ) : (
        <>
          {/* Open Orders */}
          {activeTab === 'open' && (
            <div className="space-y-3">
              {orders.length === 0 ? (
                <p className="text-center py-8 text-space-gray-400 text-sm">No open orders</p>
              ) : (
                orders.map((order) => {
                  const filledAmount = BigInt(order.filled);
                  const orderSize = BigInt(order.size);
                  const fillPercentage = orderSize > 0
                    ? (Number(filledAmount) / Number(orderSize)) * 100
                    : 0;

                  return (
                    <div
                      key={order.id}
                      className="p-4 bg-space-gray-700 rounded-lg border border-space-gray-600"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-3">
                          <div
                            className={`px-3 py-1 rounded text-sm font-semibold ${
                              order.side === 'buy'
                                ? 'bg-space-success/20 text-space-success'
                                : 'bg-space-danger/20 text-space-danger'
                            }`}
                          >
                            {order.side.toUpperCase()}
                          </div>
                          {(order as any).tokenType && (
                            <div className={`px-2 py-0.5 rounded text-xs font-semibold ${
                              (order as any).tokenType === 'yes' ? 'bg-space-success/15 text-space-success' : 'bg-space-danger/15 text-space-danger'
                            }`}>
                              {(order as any).tokenType.toUpperCase()}
                            </div>
                          )}
                          <div className="text-sm text-space-gray-300">
                            {formatPrice(order.price)}
                          </div>
                          <div className="text-sm text-space-gray-400">
                            {formatAmount(order.size)} {(order as any).outcomeName || `#${order.outcomeId}`}
                          </div>
                        </div>
                        <button
                          onClick={() => handleCancelOrder(order)}
                          disabled={programLoading}
                          className="px-3 py-1.5 bg-space-danger/20 hover:bg-space-danger/30 text-space-danger text-sm rounded font-medium transition-colors disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>

                      <div className="grid grid-cols-3 gap-4 text-sm mt-2">
                        <div>
                          <div className="text-space-gray-400">Filled</div>
                          <div className="text-white font-semibold">
                            {formatAmount(order.filled)} shares
                          </div>
                        </div>
                        <div>
                          <div className="text-space-gray-400">Status</div>
                          <div className="text-white font-semibold capitalize">
                            {order.status.replace('_', ' ')}
                          </div>
                        </div>
                        <div>
                          <div className="text-space-gray-400">Leverage</div>
                          <div className="text-white font-semibold">
                            {order.leverage}x
                          </div>
                        </div>
                      </div>

                      {fillPercentage > 0 && fillPercentage < 100 && (
                        <div className="mt-3">
                          <div className="flex justify-between text-xs text-space-gray-400 mb-1">
                            <span>Fill Progress</span>
                            <span>{fillPercentage.toFixed(1)}%</span>
                          </div>
                          <div className="w-full bg-space-gray-600 rounded-full h-2">
                            <div
                              className="bg-space-primary h-2 rounded-full transition-all"
                              style={{ width: `${fillPercentage}%` }}
                            />
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Filled Orders */}
          {activeTab === 'filled' && (
            <div className="space-y-3">
              {orders.length === 0 ? (
                <p className="text-center py-8 text-space-gray-400 text-sm">No filled orders</p>
              ) : (
                orders.map((order) => {
                  const pnl = calculatePnL(order);
                  
                  return (
                    <div
                      key={order.id}
                      className="p-4 bg-space-gray-700 rounded-lg border border-space-gray-600"
                    >
                      <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center space-x-3">
                          <div
                            className={`px-3 py-1 rounded text-sm font-semibold ${
                              order.side === 'buy'
                                ? 'bg-space-success/20 text-space-success'
                                : 'bg-space-danger/20 text-space-danger'
                            }`}
                          >
                            {order.side.toUpperCase()}
                          </div>
                          {(order as any).tokenType && (
                            <div className={`px-2 py-0.5 rounded text-xs font-semibold ${
                              (order as any).tokenType === 'yes' ? 'bg-space-success/15 text-space-success' : 'bg-space-danger/15 text-space-danger'
                            }`}>
                              {(order as any).tokenType.toUpperCase()}
                            </div>
                          )}
                          <div className="text-sm text-space-gray-300">
                            {formatPrice(order.price)}
                          </div>
                          <div className="text-sm text-space-gray-400">
                            {formatAmount(order.filled)} {(order as any).outcomeName || `#${order.outcomeId}`}
                          </div>
                        </div>
                        <span className="text-xs text-space-gray-400">Filled</span>
                        {pnl && (
                          <div className={`text-sm font-semibold ${pnl.pnl >= 0 ? 'text-space-success' : 'text-space-danger'}`}>
                            {pnl.pnl >= 0 ? '+' : ''}{pnl.pnl.toFixed(2)} {order.quoteSymbol ?? 'USDC'} ({pnl.pnlPercent >= 0 ? '+' : ''}{pnl.pnlPercent.toFixed(2)}%)
                          </div>
                        )}
                      </div>

                      <div className="text-xs text-space-gray-400 mt-2">
                        Filled at {new Date(order.updatedAt).toLocaleString()}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}

          {/* Positions */}
          {activeTab === 'positions' && (
            <div className="space-y-3">
              {positions.length === 0 ? (
                <p className="text-center py-8 text-space-gray-400 text-sm">No open positions</p>
              ) : (
                positions.map((position) => {
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
                          : 'bg-space-gray-700 border-space-gray-600'
                      }`}
                    >
                      {/* Header */}
                      <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center space-x-3">
                          <div
                            className={`px-3 py-1 rounded text-sm font-semibold ${
                              position.side === 0
                                ? 'bg-space-success/20 text-space-success'
                                : 'bg-space-danger/20 text-space-danger'
                            }`}
                          >
                            {position.side === 0 ? 'LONG' : 'SHORT'}
                          </div>
                          {position.tokenType && (
                            <div className={`px-2 py-0.5 rounded text-xs font-semibold ${
                              position.tokenType === 'yes' ? 'bg-space-success/15 text-space-success' : 'bg-space-danger/15 text-space-danger'
                            }`}>
                              {position.tokenType.toUpperCase()}
                            </div>
                          )}
                          {position.marketTitle && (
                            <div className="text-sm text-space-gray-300 max-w-xs truncate">
                              {position.marketTitle}
                            </div>
                          )}
                        </div>
                        <button
                          onClick={() => handleClosePosition(position)}
                          disabled={closingPositionId === position.id || programLoading}
                          className="px-4 py-2 bg-space-primary hover:bg-space-primary/90 text-white text-sm rounded font-medium transition-colors disabled:opacity-50"
                        >
                          {closingPositionId === position.id ? 'Closing...' : 'Close Position'}
                        </button>
                      </div>

                      {/* PnL Display */}
                      {position.pnl !== undefined && (
                        <div className="mb-3 p-3 bg-space-gray-800/50 rounded-lg">
                          <div className="flex items-center justify-between">
                            <span className="text-sm text-space-gray-400">Unrealized PnL</span>
                            <div className="text-right">
                              <div className={`text-lg font-bold ${isProfit ? 'text-space-success' : 'text-space-danger'}`}>
                                {isProfit ? '+' : ''}{pnl.toFixed(2)} {position.quoteSymbol ?? 'USDC'}
                              </div>
                              <div className={`text-xs ${isProfit ? 'text-space-success' : 'text-space-danger'}`}>
                                {isProfit ? '+' : ''}{pnlPercent.toFixed(2)}%
                              </div>
                            </div>
                          </div>
                        </div>
                      )}

                      {/* Position Details Grid */}
                      <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm mb-3">
                        <div>
                          <div className="text-space-gray-400 text-xs mb-1">Entry Price</div>
                          <div className="text-white font-semibold">
                            {formatPrice(position.avgEntryPrice)}
                          </div>
                        </div>
                        <div>
                          <div className="text-space-gray-400 text-xs mb-1">Current Price</div>
                          <div className="text-white font-semibold">
                            {position.currentPrice ? formatPrice(position.currentPrice) : 'N/A'}
                          </div>
                        </div>
                        <div>
                          <div className="text-space-gray-400 text-xs mb-1">Liquidation Price</div>
                          <div className={`font-semibold ${isLiquidatable ? 'text-red-400' : 'text-space-warning'}`}>
                            {position.liquidationPrice ? formatPrice(position.liquidationPrice) : 'N/A'}
                          </div>
                        </div>
                        <div>
                          <div className="text-space-gray-400 text-xs mb-1">Shares</div>
                          <div className="text-white font-semibold">
                            {formatAmount(position.shares)}
                          </div>
                        </div>
                        <div>
                          <div className="text-space-gray-400 text-xs mb-1">Collateral</div>
                          <div className="text-white font-semibold">
                            {formatAmount(position.collateral, position.quoteDecimals ?? 6)} {position.quoteSymbol ?? 'USDC'}
                          </div>
                        </div>
                        <div>
                          <div className="text-space-gray-400 text-xs mb-1">Leverage</div>
                          <div className="text-white font-semibold">
                            {position.leverage}x
                          </div>
                        </div>
                        <div>
                          <div className="text-space-gray-400 text-xs mb-1">Position Value</div>
                          <div className="text-white font-semibold">
                            {position.positionValue ? `${parseFloat(position.positionValue).toFixed(2)} ${position.quoteSymbol ?? 'USDC'}` : 'N/A'}
                          </div>
                        </div>
                        <div>
                          <div className="text-space-gray-400 text-xs mb-1">Equity</div>
                          <div className={`font-semibold ${position.equity && parseFloat(position.equity) < 0 ? 'text-red-400' : 'text-white'}`}>
                            {position.equity ? `${parseFloat(position.equity).toFixed(2)} ${position.quoteSymbol ?? 'USDC'}` : 'N/A'}
                          </div>
                        </div>
                      </div>

                      {/* Liquidation Warning */}
                      {isLiquidatable && (
                        <div className="mt-3 p-2 bg-red-500/20 border border-red-500/50 rounded text-xs text-red-400">
                          ⚠️ Position is liquidatable! Close immediately or risk liquidation.
                        </div>
                      )}

                      {/* Market Info */}
                      <div className="mt-3 pt-3 border-t border-space-gray-600 text-xs text-space-gray-400">
                        Market: {position.marketTitle || position.marketId} | Outcome #{position.outcomeId} {position.tokenType ? position.tokenType.toUpperCase() : 'YES'}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

