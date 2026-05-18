import { useMemo } from 'react';
import { useSharedPositions } from '@/context/PositionsContext';

/**
 * Hook to calculate total portfolio value from open positions.
 * Derives from shared positions context — no additional API calls.
 */
export function usePortfolioValue() {
  const { positions, loading } = useSharedPositions();

  const portfolioValue = useMemo(() => {
    // Aggregate per-position in human quote units using each position's own
    // quote_decimals (6 for USDC, 9 for SPACE). NOTE: summing across quote
    // tokens is unit-mixed — callers treat this as a USD-equivalent today,
    // which is only correct while all positions share the same quote.
    // TODO: return a per-quote breakdown and convert SPACE→USD via oracle.
    let totalHuman = 0;
    for (const position of positions) {
      const quoteDecimals = (position as any).quoteDecimals ?? 6;
      const divisor = Math.pow(10, quoteDecimals);
      const collateralHuman = (Number(position.collateral) || 0) / divisor;
      // `position.pnl` is already human quote units (see PositionsContext).
      const pnlHuman = position.pnl ? parseFloat(position.pnl) : 0;
      totalHuman += collateralHuman + pnlHuman;
    }
    return totalHuman;
  }, [positions]);

  return { portfolioValue, loading };
}
