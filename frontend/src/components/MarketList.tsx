import { useRef } from 'react';
import Link from 'next/link';
import { Market } from '@/types/market';
import Image from 'next/image';
import { useBookmarks } from '@/context/BookmarksContext';

const formatVolume = (amount: number, decimals: number, symbol: string) => {
  const units = amount / Math.pow(10, decimals);
  if (units >= 1_000_000) {
    return `${(units / 1_000_000).toFixed(1)}M ${symbol}`;
  }
  if (units >= 1000) {
    return `${(units / 1000).toFixed(1)}K ${symbol}`;
  }
  return `${units.toFixed(2)} ${symbol}`;
};

// Random per-market placeholder volume in the 500K..5M human-units range,
// applied when real volume is 0. Different markets get independent random
// values; same market keeps its value across re-renders within a session
// (we cache by market.id in a ref). Reloading the page redraws fresh
// numbers — that's the "looks active" effect the previous Math.random()
// approach was going for, minus the flicker.
function rollPlaceholderHuman(): number {
  const minHuman = 500_000;
  const maxHuman = 5_000_000;
  return minHuman + Math.floor(Math.random() * (maxHuman - minHuman + 1));
}

// Circular progress indicator component - Dual progress style
// Green = positive/YES progress, Gray = negative/NO progress
const CircularProgress = ({ percentage }: { percentage: number }) => {
  const size = 56;
  const height = 48;
  const center = size / 2;
  const radius = 21;
  const strokeWidth = 4;
  
  // Arc configuration: 180° total sweep (half circle)
  const totalSweepDeg = 180;
  const gapDeg = 16; // Transparent gap between the two progress arcs
  
  // Positive progress (YES) - percentage provided
  const positivePercent = Math.max(0, Math.min(100, percentage));
  // Negative progress (NO) - complement of positive
  const negativePercent = 100 - positivePercent;
  
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  
  const getPoint = (angleDeg: number) => ({
    x: center + radius * Math.cos(toRad(angleDeg)),
    y: center - radius * Math.sin(toRad(angleDeg)),
  });
  
  const createArcPath = (fromAngle: number, toAngle: number) => {
    if (Math.abs(fromAngle - toAngle) < 1) return ''; // Skip tiny arcs
    const start = getPoint(fromAngle);
    const end = getPoint(toAngle);
    let sweep = fromAngle - toAngle;
    if (sweep < 0) sweep += 360;
    const largeArc = sweep > 180 ? 1 : 0;
    return `M ${start.x} ${start.y} A ${radius} ${radius} 0 ${largeArc} 1 ${end.x} ${end.y}`;
  };
  
  // Both arcs split the available space (180° minus gap) proportionally
  // Positive arc: left side, Negative arc: right side, gap in the middle
  
  // Positive progress arc (green): starts at 180° (left), moves clockwise toward center
  const positiveSweep = (positivePercent / 100) * (totalSweepDeg - gapDeg);
  const positiveStartAngle = 180;
  const positiveEndAngle = positiveStartAngle - positiveSweep;
  const positivePath = positivePercent > 0 ? createArcPath(positiveStartAngle, positiveEndAngle) : '';
  
  // Negative progress arc (gray): ends at 0° (right), moves counter-clockwise toward center
  // Takes up its proportion of the total sweep
  const negativeSweep = (negativePercent / 100) * (totalSweepDeg - gapDeg);
  const negativeEndAngle = 0;
  const negativeStartAngle = negativeEndAngle + negativeSweep;
  const negativePath = negativePercent > 0 ? createArcPath(negativeStartAngle, negativeEndAngle) : '';

  return (
    <div className="flex flex-col justify-center items-end w-[56px] gap-1 shrink-0">
      <svg width={size} height={height} viewBox={`0 0 ${size} ${size}`}>
        {/* Negative progress arc (gray) - NO side - both ends rounded */}
        {negativePath && (
          <path d={negativePath} fill="none" stroke="#2a2a2a" strokeWidth={strokeWidth} strokeLinecap="round" />
        )}
        {/* Positive progress arc (green) - YES side - both ends rounded */}
        {positivePath && (
          <path d={positivePath} fill="none" stroke="#6CBE45" strokeWidth={strokeWidth} strokeLinecap="round" />
        )}
        {/* Center text */}
        <text
          x={center}
          y={center - 2}
          textAnchor="middle"
          dominantBaseline="middle"
          fill="white"
          fontSize="12"
          fontWeight="700"
          fontFamily="Inter, system-ui, sans-serif"
        >
          {percentage}%
        </text>
      </svg>
    </div>
  );
};

// Category icon component
const CategoryIcon = ({ category }: { category?: string | null }) => {
  // Bitcoin/crypto icon as default
  return (
    <div className="w-8 h-8 rounded-lg flex items-center justify-center flex-shrink-0 bg-space-gray-400">
      {category && (
        <Image src={category} alt="Icon" width={100} height={100} className='object-cover w-8 h-8 rounded-lg' />
      )}
      {!category && (
        <div className="w-8 h-8 rounded-lg bg-space-gray-400 flex items-center justify-center flex-shrink-0">
        </div>
      )}
    </div>
  );
};

interface Props {
  markets: Market[];
}

export function MarketList({ markets }: Props) {
  const { toggle, isBookmarked } = useBookmarks();

  // Per-market placeholder cache. Keyed by market.id; populated lazily the
  // first time a market with zero real volume is rendered. Stable for the
  // lifetime of this component instance — each re-render keeps the same
  // value. New markets added later get a fresh roll. Reloading the page
  // remounts the component, so users see fresh numbers next time.
  const placeholderCache = useRef<Map<string, number>>(new Map());
  const getPlaceholderVolumeLamports = (marketId: string, decimals: number): number => {
    let human = placeholderCache.current.get(marketId);
    if (human === undefined) {
      human = rollPlaceholderHuman();
      placeholderCache.current.set(marketId, human);
    }
    return human * Math.pow(10, decimals);
  };

  if (markets.length === 0) {
    return (
      <div className="text-center py-16">
        <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-[#1a1a1a] mb-4">
          <svg className="w-8 h-8 text-gray-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
          </svg>
        </div>
        <p className="text-gray-400 text-lg font-medium">No markets found</p>
      </div>
    );
  }

  // Helper to check if a market is ended/inactive
  const isMarketEnded = (market: Market) => {
    const status = typeof market.status === 'string' ? parseInt(market.status) : (market.status || 0);
    // API returns endDate (camelCase), market detail page transforms to end_date - check both
    const endDate = (market as any).endDate || market.end_date;
    const isExpired = endDate && new Date(endDate) < new Date();
    return status !== 0 || isExpired;
  };

  // Sort: bookmarked first, then active, then ended
  const sortedMarkets = [...markets].sort((a, b) => {
    const aBookmarked = isBookmarked(a.id);
    const bBookmarked = isBookmarked(b.id);
    if (aBookmarked !== bBookmarked) return aBookmarked ? -1 : 1;
    const aEnded = isMarketEnded(a);
    const bEnded = isMarketEnded(b);
    if (aEnded !== bEnded) return aEnded ? 1 : -1;
    return 0;
  });

  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-5">
      {sortedMarkets.map((market) => {
        const ended = isMarketEnded(market);
        const isMultiOutcome = market.outcomes.length > 2;
        const yesOutcome = market.outcomes.find((o) => o.label.toLowerCase() === 'yes') || market.outcomes[0];
        const noOutcome =
          market.outcomes.find((o) => o.label.toLowerCase() === 'no') ||
          market.outcomes.find((o) => o !== yesOutcome) ||
          market.outcomes[1];
        const yesPrice = yesOutcome?.lastPrice || yesOutcome?.share_price || 5000;
        const yesPercentage = Math.round(yesPrice / 100);
        // Real on-chain volume in quote base units. The keeper writes
        // trade_value to markets.totalVolume on every match. Backend
        // serializes the column as `totalVolume` (camelCase), but older
        // call sites and the local Market type still use `total_volume`
        // (snake_case). Read both — whichever the API gives us — so the
        // card stays correct regardless of which response shape is in
        // flight.
        const rawVolume =
          (market as any).totalVolume ?? (market as any).total_volume ?? '0';
        const realVolume =
          typeof rawVolume === 'number' ? rawVolume : parseInt(rawVolume || '0', 10) || 0;

        // For markets with no real volume yet, show a random placeholder
        // in the 500K..5M range (in the market's quote token). Different
        // markets get independent random numbers; same market keeps its
        // value across re-renders so the list doesn't flicker.
        const decimalsForVolume = market.quoteDecimals ?? 6;
        const volume =
          realVolume > 0
            ? realVolume
            : getPlaceholderVolumeLamports(market.id, decimalsForVolume);

        // For multi-outcome: sort outcomes by price descending, take top 3
        const topOutcomes = isMultiOutcome
          ? [...market.outcomes]
              .sort((a, b) => (b.lastPrice || b.share_price || 0) - (a.lastPrice || a.share_price || 0))
              .slice(0, 2)
          : [];

        return (
          <Link
            key={market.id}
            href={`/markets/${market.id}`}
            className="group block"
          >
            <div className={`bg-[#141414] flex flex-col justify-between rounded-2xl p-3 border transition-all duration-200 h-[200px] ${
              ended
                ? 'border-[#1e1e1e] opacity-50 grayscale-[30%]'
                : 'border-[#262626] hover:border-[#3a3a3a]'
            }`}>
              {/* <div> */}
              {/* Header: Icon + Title + Progress (binary only shows circular progress).
                  Title spans the remaining width and is clamped to 2 lines; ellipsis
                  only kicks in past the 2nd line so Polymarket-length titles render
                  in full. `min-w-0` is required for a flex child's line-clamp to
                  actually shrink instead of pushing siblings out. */}
              <div className="flex items-start justify-between gap-[4px]">
                <div className="flex items-start gap-1.5 flex-1 min-w-0">
                  <CategoryIcon category={market.imageUrl} />
                  <div className="flex-1 min-w-0">
                    <h3 className="text-[13px] font-semibold text-white leading-snug line-clamp-2 break-words">
                      {market.title}
                    </h3>
                    {ended && (
                      <span className="inline-flex items-center gap-1 mt-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-500/15 text-gray-500 border border-gray-500/20">
                        <span className="w-1 h-1 rounded-full bg-gray-500" />
                        Ended
                      </span>
                    )}
                  </div>
                </div>
                {!isMultiOutcome && <CircularProgress percentage={yesPercentage} />}
              </div>

              {/* Binary: Yes/No Buttons */}
              {!isMultiOutcome && (
                <div className="flex gap-1 mb-4">
                  <button
                    className="flex-1 py-5 rounded-xl bg-[#51C02614] hover:bg-[#1f3a1f] transition-colors"
                  >
                    <span className="text-space-success text-base font-medium">{yesOutcome?.label || 'Yes'}</span>
                  </button>
                  <button
                    className="flex-1 py-5 rounded-xl bg-[#ED422814] hover:bg-[#3a1f1f] transition-colors"
                  >
                    <span className="text-space-danger text-base font-medium">{noOutcome?.label || 'No'}</span>
                  </button>
                </div>
              )}

              {/* Multi-outcome: Top outcomes with photos + YES/NO badges */}
              {isMultiOutcome && (
                <div className="mt-2 mb-3 space-y-1.5">
                  {topOutcomes.map((outcome, idx) => {
                    const price = outcome.lastPrice || outcome.share_price || 5000;
                    const pct = Math.round(price / 100);
                    const noPct = 100 - pct;
                    return (
                      <div key={outcome.id ?? idx} className="flex items-center justify-between gap-2 px-1">
                        <div className="flex items-center gap-2 min-w-0 flex-1">
                          
                          <span className="text-white text-xs font-medium truncate">{outcome.label}</span>
                        </div>
                        {/* YES/NO price badges */}
                        <div className="flex gap-1 items-center flex-shrink-0">
                          <span className="px-1.5 py-0.5 text-[10px] font-bold">
                            {pct}%
                          </span>
                          <span className="px-2 py-0.5 rounded bg-[#51C02614] text-[#5CDB2A] text-[12px] font-bold">
                            Yes 
                          </span>
                          <span className="px-2 py-0.5 rounded bg-[#ED422814] text-[#ed4228] text-[12px] font-bold">
                            No
                          </span>
                        </div>
                      </div>
                    );
                  })}
                  {market.outcomes.length > 2 && (
                    <p className="text-gray-500 text-[11px] font-medium px-1 pt-0.5">
                      +{market.outcomes.length - 2} more outcomes
                    </p>
                  )}
                </div>
              )}

              {/* </div> */}

              {/* Footer: Volume + Bookmark */}
              <div className="flex items-center justify-between">
                <p className="text-[#909090] text-sm font-medium">
                  {formatVolume(volume, market.quoteDecimals ?? 6, market.quoteSymbol ?? 'USDC')} Volume
                </p>
                <button
                  onClick={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    toggle(market.id);
                  }}
                  className={`transition-colors ${isBookmarked(market.id) ? 'text-white' : 'text-[#4a4a4a] hover:text-white'}`}
                >
                  <svg className="w-6 h-6" fill={isBookmarked(market.id) ? 'currentColor' : 'none'} viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 5a2 2 0 012-2h10a2 2 0 012 2v16l-7-3.5L5 21V5z" />
                  </svg>
                </button>
              </div>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
