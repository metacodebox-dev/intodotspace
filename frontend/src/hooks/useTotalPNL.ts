import { useMemo } from 'react';
import { useSharedPositions } from '@/context/PositionsContext';

/**
 * Hook to calculate total PNL from all open positions.
 * Derives from shared positions context — no additional API calls.
 */
export function useTotalPNL() {
  const { positions, loading } = useSharedPositions();

  const totalPNL = useMemo(() => {
    let total = 0;
    for (const position of positions) {
      if (position.currentPrice && position.avgEntryPrice) {
        const shares = Number(position.shares);
        const sharesInUSDC = shares / 1e6;
        const entryValue = (sharesInUSDC * position.avgEntryPrice) / 10000;
        const currentValue = (sharesInUSDC * position.currentPrice) / 10000;

        const isLong = position.side === 0;
        total += isLong ? currentValue - entryValue : entryValue - currentValue;
      } else if (position.pnl) {
        total += parseFloat(position.pnl);
      }
    }
    return total;
  }, [positions]);

  return { totalPNL, loading };
}
