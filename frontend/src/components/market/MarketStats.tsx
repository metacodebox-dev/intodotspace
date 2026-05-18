import Image from 'next/image';
import { Market } from '@/types/market';
import { MarketCountdown } from './MarketCountdown';

interface MarketStatsProps {
  market: Market;
  yesPrice: number; // In basis points (e.g., 3300 = 33%)
}

export function MarketStats({ market, yesPrice }: MarketStatsProps) {
  const formattedEndDate = market.end_date
    ? new Date(market.end_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })
    : 'N/A';

  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-col gap-2">
        {!market.isMultiOutcome && (
          <div className="flex items-center gap-3">
            <span className="text-xl font-semibold text-white">
              {(yesPrice / 100).toFixed(0)}% chance
            </span>
            <span className="text-lg font-semibold text-green-400 flex items-center">
              <svg className="w-4 h-4 mr-1" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 10l7-7m0 0l7 7m-7-7v18" />
              </svg>
              7%
            </span>
          </div>
        )}
        <p className="text-sm text-gray-400">
          {market.end_date ? (
            <MarketCountdown endDate={market.end_date} className="text-white" />
          ) : (
            <span className="text-white">No end date</span>
          )}
          {' • '}{formattedEndDate}
        </p>
      </div>
      <Image src="/assets/space-chart.svg" alt="space chart" width={100} height={100} className="w-26" />
    </div>
  );
}
