import Image from 'next/image';
import { useState } from 'react';
import { Market } from '@/types/market';

interface MarketHeaderProps {
  market: Market;
}

function getMarketStatusBadge(market: Market) {
  const status = typeof market.status === 'string' ? parseInt(market.status) : (market.status || 0);

  // Check if end_date has passed (market ended but status not yet updated)
  const isExpired = market.end_date && new Date(market.end_date) < new Date();

  if (status === 0 && isExpired) {
    return (
      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-gray-500/15 text-gray-400 border border-gray-500/30">
        <span className="w-1.5 h-1.5 rounded-full bg-gray-400" />
        Ended - Awaiting Resolution
      </span>
    );
  }

  if (status === 0) return null; // Active and not expired - no badge needed

  const resolvedOutcome = market.resolved_outcome;
  const winnerLabel = resolvedOutcome !== null && resolvedOutcome !== undefined && market.outcomes?.[resolvedOutcome]
    ? market.outcomes[resolvedOutcome].label
    : null;

  switch (status) {
    case 1: // Resolving
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-yellow-500/15 text-yellow-400 border border-yellow-500/30">
          <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 animate-pulse" />
          Pending Resolution
        </span>
      );
    case 2: // Disputed
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-orange-500/15 text-orange-400 border border-orange-500/30">
          <span className="w-1.5 h-1.5 rounded-full bg-orange-400 animate-pulse" />
          Disputed
        </span>
      );
    case 3: // Finalized
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-green-500/15 text-green-400 border border-green-500/30">
          <span className="w-1.5 h-1.5 rounded-full bg-green-400" />
          Resolved{winnerLabel ? ` - ${winnerLabel} Won` : ''}
        </span>
      );
    case 4: // Invalid
      return (
        <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold bg-red-500/15 text-red-400 border border-red-500/30">
          <span className="w-1.5 h-1.5 rounded-full bg-red-400" />
          Invalid
        </span>
      );
    default:
      return null;
  }
}

export function MarketHeader({ market }: MarketHeaderProps) {
  const [copied, setCopied] = useState(false);

  const handleShare = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const statusBadge = getMarketStatusBadge(market);

  return (
    <div className="flex items-center gap-4">
      <div className="relative">
        <div className="w-20 h-20 rounded-xl bg-[#262626] overflow-hidden">
          {market.imageUrl ? (
            <Image
              src={market.imageUrl}
              alt={market.title}
              width={200}
              height={200}
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="w-full h-full bg-gradient-to-br from-gray-700 to-gray-800 flex items-center justify-center">
              <span className="text-2xl font-bold text-gray-500">
                {market.title.charAt(0).toUpperCase()}
              </span>
            </div>
          )}
        </div>
      </div>
      <div className="flex-1">
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-2xl font-bold text-white">{market.title}</h1>
            {statusBadge && <div className="mt-2">{statusBadge}</div>}
          </div>
          <div className="relative">
            <button
              onClick={handleShare}
              className="hover:scale-110 active:scale-95 transition-all duration-200"
            >
              <div className="relative w-8 h-8">
                <Image
                  src="/assets/share.svg"
                  alt="Share"
                  width={20}
                  height={20}
                  className={`w-8 h-8 absolute inset-0 transition-all duration-300 ${
                    copied ? 'opacity-0 scale-50' : 'opacity-100 scale-100'
                  }`}
                />
                <svg
                  xmlns="http://www.w3.org/2000/svg"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="#22c55e"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className={`w-8 h-8 absolute inset-0 transition-all duration-300 ${
                    copied ? 'opacity-100 scale-100' : 'opacity-0 scale-50'
                  }`}
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              </div>
            </button>
            <span
              className={`absolute -bottom-8 left-1/2 -translate-x-1/2 text-xs text-white whitespace-nowrap bg-[#1a1a1a] px-2 py-1 rounded-md transition-all duration-300 pointer-events-none shadow-2xl ${
                copied
                  ? 'opacity-100 translate-y-0'
                  : 'opacity-0 translate-y-1'
              }`}
            >
              Link copied!
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}
