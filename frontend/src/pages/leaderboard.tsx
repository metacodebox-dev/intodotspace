import Head from 'next/head';
import { Layout } from '@/components/Layout';
import { useSpacePoints, UserLevel } from '@/context/SpacePointsContext';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState, useRef } from 'react';

interface LeaderboardEntry {
  rank: number;
  walletAddress: string;
  totalPoints: number;
  level: UserLevel;
  totalReferrals: number;
  totalTrades: number;
  username: string | null;
  avatarUrl: string | null;
}

const ITEMS_PER_PAGE = 50;

export default function Leaderboard() {
  const { pointsInfo } = useSpacePoints();

  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);
  const [offset, setOffset] = useState(0);

  const loadMoreRef = useRef<HTMLDivElement>(null);
  const apiBaseUrl = useMemo(() => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001', []);

  // Fetch leaderboard data
  const fetchLeaderboard = useCallback(async (loadMore = false) => {
    if (loadMore) {
      setIsLoadingMore(true);
    } else {
      setIsLoading(true);
      setError(null);
    }

    try {
      const currentOffset = loadMore ? offset : 0;
      const response = await fetch(
        `${apiBaseUrl}/api/referrals/leaderboard?limit=${ITEMS_PER_PAGE}&offset=${currentOffset}`
      );

      if (!response.ok) {
        throw new Error('Failed to fetch leaderboard');
      }

      const data = await response.json();

      if (data.success && Array.isArray(data.data)) {
        if (loadMore) {
          setLeaderboard(prev => [...prev, ...data.data]);
        } else {
          setLeaderboard(data.data);
        }

        setHasMore(data.data.length === ITEMS_PER_PAGE);
        setOffset(currentOffset + data.data.length);
      } else {
        throw new Error('Invalid response format');
      }
    } catch (err) {
      console.error('Leaderboard fetch error:', err);
      setError(err instanceof Error ? err.message : 'Failed to load leaderboard');
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [apiBaseUrl, offset]);

  // Initial fetch
  useEffect(() => {
    fetchLeaderboard(false);
  }, []);

  // Intersection observer for infinite scroll
  useEffect(() => {
    if (!loadMoreRef.current || !hasMore || isLoadingMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
          fetchLeaderboard(true);
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(loadMoreRef.current);
    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, fetchLeaderboard]);

  // Format wallet address
  const formatWallet = (address: string) => {
    if (!address) return '...';
    return `${address.slice(0, 4)}...${address.slice(-4)}`;
  };

  // Check if entry is current user
  const isCurrentUser = (walletAddress: string) => {
    return pointsInfo?.walletAddress === walletAddress;
  };

  return (
    <>
      <Head>
        <title>Leaderboard - Space</title>
        <meta name="description" content="SpacePoints leaderboard - See top traders and earn your rank" />
      </Head>

      <Layout>
        <div className="max-w-7xl mx-auto">
          {/* Header */}
          <div className="flex items-center justify-between mb-6">
            <div>
              <h1 className="text-2xl font-bold text-white">Leaderboard</h1>
              <p className="text-sm text-space-gray-400">Top traders by Points</p>
            </div>
            {pointsInfo && (
              <div className="text-right">
                <p className="text-xs text-space-gray-400">Your Rank</p>
                <p className="text-xl font-bold text-white">#{pointsInfo.rank || '-'}</p>
              </div>
            )}
          </div>

          {/* Leaderboard Table */}
          <div className="rounded-xl border border-[#262626] overflow-hidden">
            {/* Table Header */}
            <div className="grid grid-cols-12 gap-4 px-4 py-3 border-b border-[#262626] text-xs font-medium text-space-gray-400">
              <div className="col-span-1">#</div>
              <div className="col-span-5">Trader</div>
              <div className="col-span-3 text-right">Trades</div>
              <div className="col-span-3 text-right">Points</div>
            </div>

            {/* Loading State */}
            {isLoading && (
              <div className="divide-y divide-[#262626]">
                {Array.from({ length: 10 }).map((_, i) => (
                  <div key={i} className="grid grid-cols-12 gap-4 px-4 py-3 animate-pulse">
                    <div className="col-span-1">
                      <div className="w-6 h-4 bg-[#262626] rounded" />
                    </div>
                    <div className="col-span-5 flex items-center gap-3">
                      <div className="w-8 h-8 rounded-full bg-[#262626]" />
                      <div className="h-4 w-24 bg-[#262626] rounded" />
                    </div>
                    <div className="col-span-3 flex justify-end">
                      <div className="h-4 w-12 bg-[#262626] rounded" />
                    </div>
                    <div className="col-span-3 flex justify-end">
                      <div className="h-4 w-16 bg-[#262626] rounded" />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {/* Error State */}
            {error && !isLoading && (
              <div className="p-8 text-center">
                <p className="text-space-gray-400 mb-4">{error}</p>
                <button
                  onClick={() => fetchLeaderboard(false)}
                  className="px-4 py-2 text-sm text-white hover:text-space-gray-300 transition-colors"
                >
                  Try Again
                </button>
              </div>
            )}

            {/* Empty State */}
            {!isLoading && !error && leaderboard.length === 0 && (
              <div className="p-8 text-center">
                <p className="text-space-gray-400">No traders yet</p>
              </div>
            )}

            {/* Leaderboard Entries */}
            {!isLoading && !error && leaderboard.length > 0 && (
              <div className="divide-y divide-[#262626]">
                {leaderboard.map((entry) => {
                  const isSelf = isCurrentUser(entry.walletAddress);

                  return (
                    <div
                      key={`${entry.rank}-${entry.walletAddress}`}
                      className={`grid grid-cols-12 gap-4 px-4 py-3 transition-colors ${
                        isSelf ? 'bg-[#1a1a1a]' : 'hover:bg-[#0f0f0f]'
                      }`}
                    >
                      {/* Rank */}
                      <div className="col-span-1 flex items-center">
                        <span className={`text-sm ${entry.rank <= 3 ? 'text-white font-medium' : 'text-space-gray-400'}`}>
                          {entry.rank}
                        </span>
                      </div>

                      {/* Trader */}
                      <div className="col-span-5 flex items-center gap-3">
                        {entry.avatarUrl ? (
                          <Image
                            src={entry.avatarUrl}
                            alt={entry.username || 'User'}
                            width={32}
                            height={32}
                            className="w-8 h-8 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-8 h-8 rounded-full bg-[#262626] flex items-center justify-center text-xs text-space-gray-400">
                            {(entry.username || entry.walletAddress).charAt(0).toUpperCase()}
                          </div>
                        )}
                        <div className="min-w-0">
                          <p className={`text-sm truncate ${isSelf ? 'text-white' : 'text-space-gray-200'}`}>
                            {entry.username ? `@${entry.username}` : formatWallet(entry.walletAddress)}
                            {isSelf && <span className="ml-1 text-space-gray-400">(you)</span>}
                          </p>
                        </div>
                      </div>

                      {/* Trades */}
                      <div className="col-span-3 flex items-center justify-end">
                        <span className="text-sm text-space-gray-400">
                          {entry.totalTrades.toLocaleString()}
                        </span>
                      </div>

                      {/* Points */}
                      <div className="col-span-3 flex items-center justify-end">
                        <span className="text-sm text-white">
                          {entry.totalPoints.toLocaleString()}
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Load More Trigger */}
            {hasMore && !isLoading && !error && (
              <div ref={loadMoreRef} className="p-4 flex justify-center border-t border-[#262626]">
                {isLoadingMore ? (
                  <span className="text-sm text-space-gray-400">Loading...</span>
                ) : (
                  <button
                    onClick={() => fetchLeaderboard(true)}
                    className="text-sm text-space-gray-400 hover:text-white transition-colors"
                  >
                    Load more
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </Layout>
    </>
  );
}
