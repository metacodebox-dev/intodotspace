import { Campaign } from './types';
import { StatusDot } from './StatusDot';
import { useCountdown } from './useCountdown';

function CountdownDisplay({ targetDate }: { targetDate: Date }) {
  const { days, hours, minutes, seconds } = useCountdown(targetDate);
  return (
    <span className="text-sm text-space-gray-300 font-mono whitespace-nowrap">
      {days}d : {hours}h : {minutes}m : {String(seconds).padStart(2, '0')}s
    </span>
  );
}

export function CampaignCard({
  campaign,
  onClick,
}: {
  campaign: Campaign;
  onClick: () => void;
}) {
  const isLive = campaign.status === 'live';
  const isUpcoming = campaign.status === 'upcoming';

  return (
    <div
      onClick={onClick}
      className="rounded-xl border border-[#262626] bg-[#141414] p-5 hover:border-[#363636] transition-colors cursor-pointer"
    >
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <StatusDot status={campaign.status} />
            <span className="text-sm font-medium text-white">
              {isLive ? 'Live' : isUpcoming ? 'Upcoming' : 'Ended'}
            </span>
            <span className="text-space-gray-500">|</span>
            <span className="text-sm text-white">{campaign.name}</span>
            <span className="text-space-gray-500">|</span>
            <span className="text-sm font-semibold text-yellow-400">
              {campaign.prizePool} Total Prize pool
            </span>
          </div>
          <p className="mt-2 text-sm text-space-gray-500">{campaign.dateLabel}</p>
        </div>
        {isLive && (
          <div className="flex-shrink-0">
            <CountdownDisplay targetDate={campaign.endDate} />
          </div>
        )}
      </div>
    </div>
  );
}
