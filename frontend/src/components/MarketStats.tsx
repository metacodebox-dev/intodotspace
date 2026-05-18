import { Market } from '@/types/market';

interface Props {
  market: Market;
}

const formatQuote = (amount: number, decimals: number) =>
  (amount / Math.pow(10, decimals)).toLocaleString('en-US', { maximumFractionDigits: 2 });

export function MarketStats({ market }: Props) {
  const decimals = market.quoteDecimals ?? 6;
  const symbol = market.quoteSymbol ?? 'USDC';
  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 mt-6">
      <h2 className="text-xl font-bold text-gray-900 mb-4">Market Statistics</h2>

      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">Total Volume</span>
          <span className="font-semibold text-gray-900">{formatQuote(market.total_volume, decimals)} {symbol}</span>
        </div>

        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">Total Liquidity</span>
          <span className="font-semibold text-gray-900">{formatQuote(market.total_liquidity, decimals)} {symbol}</span>
        </div>
        
        <div className="flex items-center justify-between">
          <span className="text-sm text-gray-500">Status</span>
          <span className="font-semibold capitalize text-gray-900">{market.status}</span>
        </div>
        
        {market.end_date && (
          <div className="flex items-center justify-between">
            <span className="text-sm text-gray-500">End Date</span>
            <span className="font-semibold text-gray-900">
              {new Date(market.end_date).toLocaleDateString()}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}


