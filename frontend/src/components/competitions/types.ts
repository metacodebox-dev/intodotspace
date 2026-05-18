export interface LeaderboardEntry {
  rank: number;
  trader: string;
  walletAddress?: string;
  points: string;
  reward: string;
}

export interface Campaign {
  id: string;
  name: string;
  prizePool: string;
  rewardBreakdown: string;
  status: 'live' | 'upcoming' | 'ended';
  startDate: Date;
  endDate: Date;
  dateLabel: string;
  description: string;
  leaderboard?: LeaderboardEntry[];
}

export interface CompetitionApiResponse {
  id: number;
  name: string;
  description: string | null;
  prizePool: string;
  rewardBreakdown: string | null;
  status: 'upcoming' | 'live' | 'ended';
  startDate: string;
  endDate: string;
  createdBy: string | null;
  rewards?: { rank: number; reward: string }[];
}

function generateDateLabel(status: string, startDate: Date, endDate: Date): string {
  const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const fmt = (d: Date) =>
    `${months[d.getUTCMonth()]} ${d.getUTCDate()}, ${String(d.getUTCHours()).padStart(2, '0')}:00 UTC`;

  if (status === 'ended') return `Ended ${fmt(endDate)}`;
  if (status === 'live') return `Ends ${fmt(endDate)}`;
  return `Starts ${fmt(startDate)}`;
}

export function apiToCampaign(api: CompetitionApiResponse): Campaign {
  const startDate = new Date(api.startDate);
  const endDate = new Date(api.endDate);
  return {
    id: String(api.id),
    name: api.name,
    prizePool: api.prizePool,
    rewardBreakdown: api.rewardBreakdown || '',
    status: api.status,
    startDate,
    endDate,
    dateLabel: generateDateLabel(api.status, startDate, endDate),
    description: api.description || '',
  };
}
