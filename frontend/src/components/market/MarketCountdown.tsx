import { useEffect, useState } from 'react';

interface MarketCountdownProps {
  /** ISO string or Date for the market's end time. */
  endDate: string | Date;
  /** Optional CSS class for the wrapping span. */
  className?: string;
}

/**
 * Live countdown to a market's end time.
 *  - More than 24h out: "Ends in N day(s)" (static, rounds up)
 *  - 24h or less out: live HH:MM:SS that ticks every second
 *  - At or past end:   "Ended"
 *
 * The setInterval is gated to only run when the remaining time is < 24h to
 * keep idle market lists cheap — most markets end days from now and don't
 * need a per-second re-render.
 */
export function MarketCountdown({ endDate, className }: MarketCountdownProps) {
  const endTimeMs =
    typeof endDate === 'string' ? new Date(endDate).getTime() : endDate.getTime();

  const [now, setNow] = useState<number>(() => Date.now());

  // Whether we need a live ticker (under 24h remaining).
  const remainingMs = endTimeMs - now;
  const isUnder24h = remainingMs > 0 && remainingMs <= 24 * 60 * 60 * 1000;

  useEffect(() => {
    if (!isUnder24h) {
      // Still poll once a minute so the component can flip into live-ticker
      // mode the moment the 24h boundary crosses without a page reload.
      const id = setInterval(() => setNow(Date.now()), 60_000);
      return () => clearInterval(id);
    }
    const id = setInterval(() => setNow(Date.now()), 1_000);
    return () => clearInterval(id);
  }, [isUnder24h]);

  if (remainingMs <= 0) {
    return <span className={className}>Ended</span>;
  }

  if (isUnder24h) {
    const totalSeconds = Math.floor(remainingMs / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    const pad = (n: number) => n.toString().padStart(2, '0');
    return (
      <span className={className}>
        Ends in {pad(hours)}:{pad(minutes)}:{pad(seconds)}
      </span>
    );
  }

  // > 24h remaining: round up so 1.2 days reads as "2 days" and 0.4 days
  // (which would also be < 24h and never reach this branch) doesn't.
  const days = Math.ceil(remainingMs / (1000 * 60 * 60 * 24));
  return (
    <span className={className}>
      Ends in {days} {days === 1 ? 'day' : 'days'}
    </span>
  );
}
