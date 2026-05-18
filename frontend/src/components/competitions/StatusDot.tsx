import { Campaign } from './types';

export function StatusDot({ status }: { status: Campaign['status'] }) {
  const color =
    status === 'live'
      ? 'bg-green-500'
      : status === 'upcoming'
      ? 'bg-yellow-400'
      : 'bg-blue-300';
  const glow =
    status === 'live'
      ? 'bg-green-500/40'
      : status === 'upcoming'
      ? 'bg-yellow-400/40'
      : 'bg-blue-300/40';

  return (
    <span className="relative inline-flex h-2.5 w-2.5 flex-shrink-0">
      <span
        className={`absolute inline-flex h-full w-full animate-ping rounded-full ${glow}`}
      />
      <span
        className={`relative inline-flex h-2.5 w-2.5 rounded-full ${color}`}
      />
    </span>
  );
}
