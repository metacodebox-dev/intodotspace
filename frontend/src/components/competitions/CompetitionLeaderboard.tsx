import { useEffect, useRef, useState } from 'react';
import { useSpacePoints } from '@/context/SpacePointsContext';
import { Campaign, LeaderboardEntry } from './types';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const RANK_MEDALS: Record<number, string> = {
  1: '\uD83E\uDD47',
  2: '\uD83E\uDD48',
  3: '\uD83E\uDD49',
};

export function CompetitionLeaderboard({ campaigns }: { campaigns: Campaign[] }) {
  const { pointsInfo } = useSpacePoints();

  // Only show competitions that have leaderboards (live + ended)
  const eligible = campaigns.filter(c => c.status === 'live' || c.status === 'ended');

  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Auto-select live competition on mount, or most recent ended
  useEffect(() => {
    if (eligible.length === 0) return;
    const live = eligible.find(c => c.status === 'live');
    setSelectedId(live ? live.id : eligible[0].id);
  }, [campaigns]);

  // Close dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  // Fetch leaderboard when selection changes
  useEffect(() => {
    if (!selectedId) return;
    setIsLoading(true);

    fetch(`${API_URL}/api/competitions/${selectedId}/leaderboard?limit=100`)
      .then(res => res.json())
      .then(data => {
        if (data.success && Array.isArray(data.data)) {
          setLeaderboard(data.data);
        } else {
          setLeaderboard([]);
        }
      })
      .catch(() => setLeaderboard([]))
      .finally(() => setIsLoading(false));
  }, [selectedId]);

  if (eligible.length === 0) return null;

  const selected = eligible.find(c => c.id === selectedId);
  const title = selected ? selected.name : 'Competition Leaderboard';

  const formatWallet = (addr: string) => {
    if (!addr || addr.length <= 8) return addr || '...';
    return `${addr.slice(0, 4)}...${addr.slice(-4)}`;
  };

  const isCurrentUser = (walletAddress: string) => {
    return pointsInfo?.walletAddress === walletAddress;
  };

  return (
    <div className="space-y-4">
      {/* Header row */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
        <h3 className="text-xl font-bold text-white truncate">{title}</h3>

        {/* Dropdown */}
        {eligible.length > 1 && (
          <div className="relative flex-shrink-0" ref={dropdownRef}>
            <button
              onClick={() => setDropdownOpen(prev => !prev)}
              className="flex items-center gap-2 px-4 py-2 rounded-lg border border-[#262626] bg-[#141414] text-sm text-white hover:border-[#3a3a3a] transition-colors min-w-[200px] justify-between"
            >
              <span className="truncate">{selected?.name || 'Select competition'}</span>
              <svg
                className={`w-4 h-4 text-space-gray-400 transition-transform ${dropdownOpen ? 'rotate-180' : ''}`}
                fill="none" stroke="currentColor" viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {dropdownOpen && (
              <div className="absolute right-0 mt-1 w-full min-w-[240px] rounded-lg border border-[#262626] bg-[#1a1a1a] shadow-xl z-50 py-1 max-h-64 overflow-y-auto [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
                {eligible.map(comp => (
                  <button
                    key={comp.id}
                    onClick={() => {
                      setSelectedId(comp.id);
                      setDropdownOpen(false);
                    }}
                    className={`w-full text-left px-4 py-2.5 text-sm flex items-center justify-between gap-2 transition-colors ${
                      comp.id === selectedId
                        ? 'bg-[#262626] text-white'
                        : 'text-space-gray-300 hover:bg-[#222] hover:text-white'
                    }`}
                  >
                    <span className="truncate">{comp.name}</span>
                    <span className={`text-xs flex-shrink-0 px-1.5 py-0.5 rounded ${
                      comp.status === 'live'
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-space-gray-400/20 text-space-gray-400'
                    }`}>
                      {comp.status === 'live' ? 'Live' : 'Ended'}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Subtitle */}
      <p className="text-sm text-space-gray-400">
        {selected?.status === 'live'
          ? 'Points earned during this competition'
          : selected?.status === 'ended'
            ? 'Final standings'
            : ''}
      </p>

      {/* Table */}
      <div className="rounded-xl border border-[#262626] overflow-hidden">
        {/* Table Header */}
        <div className="grid grid-cols-12 gap-4 px-4 py-3 border-b border-[#262626] text-xs font-medium text-space-gray-400">
          <div className="col-span-1">#</div>
          <div className="col-span-5">Trader</div>
          <div className="col-span-3 text-right">Points</div>
          <div className="col-span-3 text-right">Reward</div>
        </div>

        {/* Loading */}
        {isLoading && (
          <div className="divide-y divide-[#262626]">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="grid grid-cols-12 gap-4 px-4 py-3 animate-pulse">
                <div className="col-span-1"><div className="w-6 h-4 bg-[#262626] rounded" /></div>
                <div className="col-span-5 flex items-center gap-3">
                  <div className="w-8 h-8 rounded-full bg-[#262626]" />
                  <div className="h-4 w-24 bg-[#262626] rounded" />
                </div>
                <div className="col-span-3 flex justify-end"><div className="h-4 w-16 bg-[#262626] rounded" /></div>
                <div className="col-span-3 flex justify-end"><div className="h-4 w-16 bg-[#262626] rounded" /></div>
              </div>
            ))}
          </div>
        )}

        {/* Empty */}
        {!isLoading && leaderboard.length === 0 && (
          <div className="p-8 text-center">
            <p className="text-space-gray-400 text-sm">No traders on the leaderboard yet</p>
          </div>
        )}

        {/* Entries */}
        {!isLoading && leaderboard.length > 0 && (
          <div className="divide-y divide-[#262626]">
            {leaderboard.map(entry => {
              const isSelf = isCurrentUser(entry.walletAddress);
              return (
                <div
                  key={`${entry.rank}-${entry.walletAddress}`}
                  className={`grid grid-cols-12 gap-4 px-4 py-3 transition-colors ${
                    isSelf ? 'bg-[#1a1a1a]' : 'hover:bg-[#0f0f0f]'
                  }`}
                >
                  <div className="col-span-1 flex items-center">
                    <span className={`text-sm ${entry.rank <= 3 ? 'text-white font-medium' : 'text-space-gray-400'}`}>
                      {entry.rank}
                      {RANK_MEDALS[entry.rank] && <span className="ml-1">{RANK_MEDALS[entry.rank]}</span>}
                    </span>
                  </div>
                  <div className="col-span-5 flex items-center gap-3">
                    <div className="w-8 h-8 rounded-full bg-[#262626] flex items-center justify-center text-xs text-space-gray-400 flex-shrink-0">
                      {(entry.trader || '?').charAt(0).toUpperCase()}
                    </div>
                    <p className={`text-sm truncate ${isSelf ? 'text-white' : 'text-space-gray-200'}`}>
                      {entry.trader || formatWallet(entry.walletAddress || '')}
                      {isSelf && <span className="ml-1 text-space-gray-400">(you)</span>}
                    </p>
                  </div>
                  <div className="col-span-3 flex items-center justify-end">
                    <span className="text-sm text-white">{entry.points}</span>
                  </div>
                  <div className="col-span-3 flex items-center justify-end">
                    <span className="text-sm text-space-gray-400">{entry.reward || '-'}</span>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
