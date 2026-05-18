import { Market } from '@/types/market';
import { useMarketPriceWebSocket } from '@/hooks/useOrderBookWebSocket';
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { LiveBinancePrice } from './LiveBinancePrice';
import { MarketCountdown } from './market/MarketCountdown';

const formatPrice = (price: number) => {
  return (price / 100).toFixed(2) + '%';
};

const formatQuote = (amount: number, decimals: number) =>
  (amount / Math.pow(10, decimals)).toLocaleString('en-US', { maximumFractionDigits: 2 });

interface Props {
  market: Market;
}

export function MarketDetail({ market }: Props) {
  // Safely handle outcomes - ensure it's an array
  const outcomes = market.outcomes || [];
  const isBinary = outcomes.length <= 2;
  const yesOutcome = outcomes.find((o) => o.label.toLowerCase() === 'yes') || outcomes[0];
  const noOutcome = outcomes.find((o) => o.label.toLowerCase() === 'no') || outcomes[1];

  // Fetch YES price from order book using WebSocket (for binary markets, NO = 10000 - YES)
  const { price: yesPriceFromBook } = useMarketPriceWebSocket(market.id, yesOutcome?.id || 0);

  // In binary markets: YES + NO = 100% always
  // YES price from order book, NO = 10000 - YES
  const yesPrice = yesPriceFromBook ?? yesOutcome?.lastPrice ?? yesOutcome?.share_price ?? 5000;
  const noPrice = isBinary ? 10000 - yesPrice : (noOutcome?.lastPrice ?? noOutcome?.share_price ?? 5000);

  // Mock price history data (in production, fetch from API)
  const priceHistory = [
    { time: '00:00', yes: 45, no: 55 },
    { time: '04:00', yes: 48, no: 52 },
    { time: '08:00', yes: 52, no: 48 },
    { time: '12:00', yes: 55, no: 45 },
    { time: '16:00', yes: 58, no: 42 },
    { time: '20:00', yes: 60, no: 40 },
  ];

  const getStatusColor = (status: string) => {
    const colors: Record<string, string> = {
      active: 'bg-green-100 text-green-700',
      resolved: 'bg-blue-100 text-blue-700',
      closed: 'bg-gray-100 text-gray-700',
      pending_resolution: 'bg-yellow-100 text-yellow-700',
    };
    return colors[status] || 'bg-gray-100 text-gray-700';
  };

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="bg-space-gray-800 rounded-xl p-6 border border-space-gray-700">
        <div className="flex items-start justify-between mb-4">
          <div className="flex-1">
            <h1 className="text-3xl font-bold text-white mb-3">{market.title}</h1>
            <div className="flex items-center space-x-4 text-sm text-space-gray-400">
              <span>{formatPrice(yesPrice)} chance</span>
              <span className="flex items-center text-space-success">
                <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
                </svg>
                +7%
              </span>
            </div>
            {market.end_date && (
              <p className="text-sm text-space-gray-400 mt-2">
                <MarketCountdown endDate={market.end_date} />
                {' • '}{new Date(market.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Live Binance price (only for auto-markets) */}
      {market.autoResolve && market.priceFeed && (
        <LiveBinancePrice symbol={market.priceFeed} strikePrice={market.strikePrice ?? undefined} />
      )}

      {/* Price Chart */}
      <div className="bg-space-gray-800 rounded-xl p-6 border border-space-gray-700">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-xl font-bold text-white">Price History</h2>
          <div className="flex items-center space-x-2">
            {['1H', '1D', '1W', '1M', 'All'].map((period) => (
              <button
                key={period}
                className={`px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${
                  period === 'All'
                    ? 'bg-space-primary text-white'
                    : 'bg-space-gray-700 text-space-gray-300 hover:bg-space-gray-600'
                }`}
              >
                {period}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-between mb-4">
          <div>
            <p className="text-sm text-space-gray-400">Volume</p>
            <p className="text-lg font-bold text-white">{formatQuote(market.total_volume, market.quoteDecimals ?? 6)} {market.quoteSymbol ?? 'USDC'}</p>
          </div>
          <div className="flex items-center space-x-2">
            <button className="px-4 py-2 bg-space-primary hover:bg-space-secondary text-white text-sm font-semibold rounded-lg transition-colors">
              Earn USDC
            </button>
            <button className="px-4 py-2 bg-space-gray-700 hover:bg-space-gray-600 text-white text-sm font-semibold rounded-lg transition-colors">
              Earn SPC
            </button>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={priceHistory}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
            <XAxis dataKey="time" stroke="#6b7280" />
            <YAxis stroke="#6b7280" />
            <Tooltip
              contentStyle={{
                backgroundColor: 'white',
                border: '1px solid #e5e7eb',
                borderRadius: '8px',
              }}
            />
            <Line
              type="monotone"
              dataKey="yes"
              stroke="#10b981"
              strokeWidth={2}
              name="YES"
              dot={{ fill: '#10b981', r: 4 }}
            />
            <Line
              type="monotone"
              dataKey="no"
              stroke="#ef4444"
              strokeWidth={2}
              name="NO"
              dot={{ fill: '#ef4444', r: 4 }}
            />
          </LineChart>
        </ResponsiveContainer>
      </div>

      {/* Outcomes */}
      {market.outcomes && market.outcomes.length > 2 && (
        <div className="bg-space-gray-800 rounded-xl p-6 border border-space-gray-700">
          <h2 className="text-xl font-bold text-white mb-4">Outcomes</h2>
          <div className="space-y-3">
            {market.outcomes.map((outcome) => {
              // Use order book price if available, otherwise fallback to share_price
              const outcomePriceValue = outcome.id === yesOutcome?.id ? yesPrice :
                                       outcome.id === noOutcome?.id ? noPrice :
                                       outcome.lastPrice || outcome.share_price || 5000;
              const outcomePrice = formatPrice(outcomePriceValue);
              const outcomePercent = outcomePriceValue / 100;
              return (
                <div
                  key={outcome.id}
                  className="flex items-center justify-between p-4 bg-space-gray-700/50 rounded-lg hover:bg-space-gray-700 transition-colors"
                >
                  <div className="flex items-center space-x-3 flex-1">
                    <div className="w-10 h-10 rounded-full bg-space-gray-600"></div>
                    <div>
                      <p className="text-sm font-semibold text-white">{outcome.label}</p>
                      <p className="text-xs text-space-gray-400">{outcomePercent.toFixed(0)}%</p>
                    </div>
                  </div>
                  <div className="flex items-center space-x-2">
                    <button className="px-4 py-2 bg-space-success/20 hover:bg-space-success/30 text-space-success text-sm font-semibold rounded-lg transition-colors">
                      Yes {outcomePrice.replace('%', 'c')}
                    </button>
                    <button className="px-4 py-2 bg-space-danger/20 hover:bg-space-danger/30 text-space-danger text-sm font-semibold rounded-lg transition-colors">
                      No {(100 - outcomePercent).toFixed(0)}c
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
