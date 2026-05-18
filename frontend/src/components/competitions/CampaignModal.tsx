import { useEffect, useState } from 'react';
import { Campaign, LeaderboardEntry } from './types';
import { StatusDot } from './StatusDot';
import { useCountdown } from './useCountdown';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const RANK_MEDALS: Record<number, string> = {
  1: '\uD83E\uDD47',
  2: '\uD83E\uDD48',
  3: '\uD83E\uDD49',
};

function formatDateUTC(date: Date) {
  const months = [
    'Jan','Feb','Mar','Apr','May','Jun',
    'Jul','Aug','Sep','Oct','Nov','Dec',
  ];
  return `${months[date.getUTCMonth()]} ${date.getUTCDate()}, ${date.getUTCFullYear()} - ${String(date.getUTCHours()).padStart(2, '0')}:${String(date.getUTCMinutes()).padStart(2, '0')} UTC`;
}

function CompactCountdown({ targetDate }: { targetDate: Date }) {
  const { days, hours, minutes } = useCountdown(targetDate);
  return (
    <span>
      {days}d {hours}h {minutes}m
    </span>
  );
}

function ModalShell({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', handleEsc);
    return () => document.removeEventListener('keydown', handleEsc);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-4"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl max-h-[85vh] flex flex-col rounded-xl bg-[#141414] border border-[#262626] relative animate-fadeIn"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 pb-4 border-b border-[#262626] flex-shrink-0">
          <h2 className="text-lg font-bold text-white">{title}</h2>
          <button
            onClick={onClose}
            className="text-space-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
        <div className="overflow-y-auto p-6 pt-4 [scrollbar-width:none] [-ms-overflow-style:none] [&::-webkit-scrollbar]:hidden">
          {children}
        </div>
      </div>
    </div>
  );
}

function LeaderboardTable({ entries }: { entries: LeaderboardEntry[] }) {
  return (
    <div className="mt-6 rounded-lg border border-[#262626] overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-[#262626]">
            <th className="text-left py-3 px-4 text-space-gray-300 font-semibold">Rank</th>
            <th className="text-left py-3 px-4 text-space-gray-300 font-semibold">Trader</th>
            <th className="text-left py-3 px-4 text-space-gray-300 font-semibold">Points</th>
            <th className="text-left py-3 px-4 text-space-gray-300 font-semibold">Reward</th>
          </tr>
        </thead>
        <tbody>
          {entries.map((entry) => (
            <tr key={entry.rank} className="border-b border-[#262626] last:border-b-0">
              <td className="py-2.5 px-4 text-white">
                {entry.rank}
                {RANK_MEDALS[entry.rank] && (
                  <span className="ml-1">{RANK_MEDALS[entry.rank]}</span>
                )}
              </td>
              <td className="py-2.5 px-4 text-white">{entry.trader}</td>
              <td className="py-2.5 px-4 text-white">{entry.points}</td>
              <td className="py-2.5 px-4 text-white">{entry.reward}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function CampaignModal({
  campaign,
  onClose,
}: {
  campaign: Campaign;
  onClose: () => void;
}) {
  const isLive = campaign.status === 'live';
  const isEnded = campaign.status === 'ended';
  const [leaderboard, setLeaderboard] = useState<LeaderboardEntry[]>(campaign.leaderboard || []);
  const [loadingLb, setLoadingLb] = useState(false);

  useEffect(() => {
    if (campaign.status === 'live' || campaign.status === 'ended') {
      setLoadingLb(true);
      fetch(`${API_URL}/api/competitions/${campaign.id}/leaderboard`)
        .then(res => res.json())
        .then(data => {
          if (data.success && data.data?.length > 0) {
            setLeaderboard(data.data);
          }
        })
        .catch(() => {})
        .finally(() => setLoadingLb(false));
    }
  }, [campaign.id, campaign.status]);

  if (isEnded) {
    return (
      <ModalShell title="Competition Results" onClose={onClose}>
        <div className="space-y-4 text-sm">
          <div className="flex gap-3">
            <span className="text-space-gray-400 font-medium w-44 flex-shrink-0">Competition:</span>
            <span className="text-white">{campaign.name}</span>
          </div>
          <div className="flex gap-3 items-center">
            <span className="text-space-gray-400 font-medium w-44 flex-shrink-0">Status:</span>
            <span className="flex items-center gap-2">
              <StatusDot status={campaign.status} />
              <span className="text-white">Ended</span>
            </span>
          </div>
          <div className="flex gap-3">
            <span className="text-space-gray-400 font-medium w-44 flex-shrink-0">Total Prize Pool:</span>
            <span className="text-white">{campaign.prizePool}</span>
          </div>
          <div className="flex gap-3">
            <span className="text-space-gray-400 font-medium w-44 flex-shrink-0">Reward Breakdown:</span>
            <span className="text-white">{campaign.rewardBreakdown}</span>
          </div>
          <div className="flex gap-3">
            <span className="text-space-gray-400 font-medium w-44 flex-shrink-0">Ended on:</span>
            <span className="text-white">{formatDateUTC(campaign.endDate)}</span>
          </div>
        </div>

        {loadingLb ? (
          <div className="mt-6 text-center py-6 text-space-gray-500 text-sm">Loading leaderboard...</div>
        ) : leaderboard.length > 0 ? (
          <LeaderboardTable entries={leaderboard} />
        ) : null}
      </ModalShell>
    );
  }

  return (
    <ModalShell title="Competition Details" onClose={onClose}>
      <div className="space-y-4 text-sm">
        <div className="flex gap-3">
          <span className="text-space-gray-400 font-medium w-40 flex-shrink-0">Competition:</span>
          <span className="text-white">{campaign.name}</span>
        </div>
        <div className="flex gap-3 items-center">
          <span className="text-space-gray-400 font-medium w-40 flex-shrink-0">Status:</span>
          <span className="flex items-center gap-2">
            <StatusDot status={campaign.status} />
            <span className="text-white">
              {isLive ? 'Live' : 'Upcoming'}
            </span>
          </span>
        </div>
        <div className="flex gap-3">
          <span className="text-space-gray-400 font-medium w-40 flex-shrink-0">Total Prize Pool:</span>
          <span className="text-white">{campaign.prizePool}</span>
        </div>
        <div className="flex gap-3">
          <span className="text-space-gray-400 font-medium w-40 flex-shrink-0">Reward Breakdown:</span>
          <span className="text-white">{campaign.rewardBreakdown}</span>
        </div>
        <div className="flex gap-3">
          <span className="text-space-gray-400 font-medium w-40 flex-shrink-0">Start Date:</span>
          <span className="text-white">{formatDateUTC(campaign.startDate)}</span>
        </div>
        <div className="flex gap-3">
          <span className="text-space-gray-400 font-medium w-40 flex-shrink-0">End Date:</span>
          <span className="text-white">{formatDateUTC(campaign.endDate)}</span>
        </div>
        {isLive && (
          <div className="flex gap-3">
            <span className="text-space-gray-400 font-medium w-40 flex-shrink-0">Time Remaining:</span>
            <span className="text-white">
              <CompactCountdown targetDate={campaign.endDate} />
            </span>
          </div>
        )}
      </div>
      <div className="mt-6 rounded-lg bg-[#1a1a2e] border border-[#262646] p-4">
        <p className="text-sm text-space-gray-300 leading-relaxed">
          {campaign.description}
        </p>
      </div>
    </ModalShell>
  );
}
