import { useMatchedOrders } from '@/hooks/useMatchedOrders';
import { useWallet } from '@solana/wallet-adapter-react';

export function MatchedOrders() {
  const { publicKey, connected } = useWallet();
  const {
    matchedOrders,
    loading,
    executing,
    error,
    executeMatchedOrder,
    executeAllMatchedOrders,
  } = useMatchedOrders();

  if (!connected || !publicKey) {
    return null;
  }

  if (matchedOrders.length === 0) {
    return null;
  }

  // `size` and `filled` are share counts (6-decimal base units) regardless
  // of the market's quote token — divide by 1e6 and label as shares, not quote.
  const formatShares = (amount: string) => {
    return (Number(amount) / 1e6).toFixed(2);
  };

  const formatPrice = (price: number) => {
    return (price / 100).toFixed(2) + '%';
  };

  return (
    <div className="bg-space-gray-800 rounded-xl border border-space-gray-700 p-6 mb-6">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h3 className="text-lg font-bold text-white">
            Matched Orders - Auto-Executing
          </h3>
          <p className="text-sm text-space-gray-400 mt-1">
            {executing.size > 0 
              ? `${executing.size} order${executing.size !== 1 ? 's' : ''} executing automatically...`
              : matchedOrders.length > 0
              ? `${matchedOrders.length} order${matchedOrders.length !== 1 ? 's' : ''} matched - executing automatically`
              : 'No matched orders'}
          </p>
        </div>
        {matchedOrders.length > 0 && executing.size === 0 && (
          <div className="flex items-center space-x-2 text-sm text-space-success">
            <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
            <span>Auto-executing...</span>
          </div>
        )}
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-100 border border-red-400 text-red-700 rounded text-sm">
          {error}
        </div>
      )}

      <div className="space-y-3">
        {matchedOrders.map((order) => {
          const isExecuting = executing.has(order.id);
          const filledAmount = BigInt(order.filled);
          const orderSize = BigInt(order.size);
          const remaining = orderSize - filledAmount;
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
                  <div className="text-sm text-space-gray-300">
                    Outcome {order.outcomeId}
                  </div>
                  <div className="text-sm text-space-gray-400">
                    {formatPrice(order.price)}
                  </div>
                </div>
                <button
                  onClick={() => executeMatchedOrder(order)}
                  disabled={isExecuting || loading}
                  className="px-3 py-1.5 bg-space-primary hover:bg-space-secondary text-white text-sm rounded font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  {isExecuting ? 'Executing...' : 'Execute'}
                </button>
              </div>

              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <div className="text-space-gray-400">Size</div>
                  <div className="text-white font-semibold">
                    {formatShares(order.size)} shares
                  </div>
                </div>
                <div>
                  <div className="text-space-gray-400">Filled</div>
                  <div className="text-white font-semibold">
                    {formatShares(order.filled)} shares
                  </div>
                </div>
                <div>
                  <div className="text-space-gray-400">Leverage</div>
                  <div className="text-white font-semibold">
                    {order.leverage}x
                  </div>
                </div>
              </div>

              {fillPercentage < 100 && (
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
        })}
      </div>
    </div>
  );
}

