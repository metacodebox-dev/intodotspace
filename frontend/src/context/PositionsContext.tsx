import { createContext, useContext, useState, useEffect, useCallback, useRef, ReactNode } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { useWebSocket } from '@/hooks/useWebSocket';
import axios from 'axios';
import { displayQuoteSymbol } from '@/utils/solana';

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

const MIN_FETCH_INTERVAL_MS = 10_000; // 10 seconds between fetches

export interface SharedPosition {
  id: string;
  market: string;
  marketId: string;
  marketTitle?: string;
  outcomeId: number;
  side: number;
  shares: string;
  avgEntryPrice: number;
  leverage: number;
  collateral: string;
  currentPrice?: number;
  positionValue?: string;
  pnl?: string;
  pnlPercent?: number;
  liquidationPrice?: number;
  equity?: string;
  isLiquidatable?: boolean;
  positionType?: number;
  tokenType?: string;
  borrowedAmount?: string;
  isOpen?: boolean;
  marketAddress?: string;
  /** Shares redeemed at market resolution (BigInt as string, 6-dec lamports).
   *  Set by the redemption flow so the resolved-positions tab can show the
   *  historical payout after `shares` has been zeroed. NULL = never redeemed. */
  redeemedShares?: string | null;
  // Quote-token metadata — populated by backend so cross-market portfolio views
  // can render per-row symbol/decimals without a round-trip to /markets.
  quoteMint?: string | null;
  quoteDecimals?: number;
  quoteSymbol?: string;
}

interface LiquidationWarning {
  positionId: string;
  marketId: string;
  liquidationPrice: number;
  currentPrice: number;
  equity: string;
}

interface PositionsContextValue {
  positions: SharedPosition[];
  loading: boolean;
  error: Error | null;
  liquidationWarnings: LiquidationWarning[];
  refetch: () => void;
}

const PositionsContext = createContext<PositionsContextValue>({
  positions: [],
  loading: true,
  error: null,
  liquidationWarnings: [],
  refetch: () => {},
});

export function PositionsProvider({ children }: { children: ReactNode }) {
  const { publicKey, connected } = useWallet();
  const { isConnected, subscribe, unsubscribe, onMessage } = useWebSocket();
  const [positions, setPositions] = useState<SharedPosition[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<Error | null>(null);
  const [liquidationWarnings, setLiquidationWarnings] = useState<LiquidationWarning[]>([]);

  const lastFetchRef = useRef<number>(0);
  const fetchInFlightRef = useRef<Promise<void> | null>(null);

  const fetchPositions = useCallback(async (force = false) => {
    if (!connected || !publicKey) return;

    // Throttle: skip if last fetch was < MIN_FETCH_INTERVAL_MS ago (unless forced)
    const now = Date.now();
    if (!force && now - lastFetchRef.current < MIN_FETCH_INTERVAL_MS) {
      return;
    }

    // Deduplicate: if already fetching, return that promise
    if (fetchInFlightRef.current) {
      return fetchInFlightRef.current;
    }

    const doFetch = async () => {
      try {
        lastFetchRef.current = Date.now();
        const response = await axios.get(`${API_URL}/api/v1/positions/user/${publicKey.toString()}`);
        const allPositions: SharedPosition[] = response.data.positions || [];

        // Filter active positions (shares > 0) and rewrite quote symbol for
        // UI display (SPACE → SPC). Internal symbol stays "SPACE" in backend.
        const active = allPositions
          .filter((p) => Number(p.shares) > 0)
          .map((p) => p.quoteSymbol ? { ...p, quoteSymbol: displayQuoteSymbol(p.quoteSymbol) } : p);
        setPositions(active);
        setLoading(false);
        setError(null);
      } catch (err: any) {
        console.error('[PositionsProvider] Error fetching positions:', err);
        setError(err instanceof Error ? err : new Error('Failed to fetch positions'));
        setLoading(false);
      } finally {
        fetchInFlightRef.current = null;
      }
    };

    fetchInFlightRef.current = doFetch();
    return fetchInFlightRef.current;
  }, [connected, publicKey]);

  // Public refetch (throttled)
  const refetch = useCallback(() => {
    fetchPositions(false);
  }, [fetchPositions]);

  // Initial fetch
  useEffect(() => {
    if (!connected || !publicKey) {
      setPositions([]);
      setLoading(false);
      return;
    }
    fetchPositions(true);
  }, [connected, publicKey, fetchPositions]);

  // Listen for window 'positions-refresh' events (fired after trades)
  useEffect(() => {
    if (!connected || !publicKey) return;

    const handleRefresh = () => {
      setTimeout(() => fetchPositions(true), 2000);
    };

    window.addEventListener('positions-refresh', handleRefresh);
    return () => window.removeEventListener('positions-refresh', handleRefresh);
  }, [connected, publicKey, fetchPositions]);

  // WebSocket: subscribe and handle updates
  useEffect(() => {
    if (!connected || !publicKey || !isConnected) return;

    const userId = publicKey.toString();
    subscribe('user_positions', { userId });
    subscribe('liquidations', { userId });

    const cleanupPosition = onMessage('position_update', (data: any) => {
      if (data.user_id && data.user_id !== userId) return;

      if (data.action === 'refetch') {
        setTimeout(() => {
          fetchPositions(true);
          window.dispatchEvent(new Event('positions-refresh'));
        }, 1500);
        return;
      }

      // Granular update
      if (data.position_id && data.shares !== undefined) {
        setPositions((prev) => {
          const shares = Number(data.shares);
          if (shares === 0) {
            return prev.filter((p) => p.id !== data.position_id);
          }
          return prev.map((p) =>
            p.id === data.position_id
              ? { ...p, shares: data.shares, currentPrice: data.current_price, pnl: data.unrealized_pnl }
              : p
          );
        });
      }
    });

    const cleanupLiquidation = onMessage('liquidation', (data: any) => {
      if (data.user_id !== userId) return;
      setLiquidationWarnings((prev) => {
        const existing = prev.find((w) => w.positionId === data.position_id);
        const warning: LiquidationWarning = {
          positionId: data.position_id,
          marketId: data.market_id,
          liquidationPrice: data.liquidation_price,
          currentPrice: data.current_price,
          equity: data.equity,
        };
        if (existing) {
          return prev.map((w) => (w.positionId === data.position_id ? warning : w));
        }
        return [...prev, warning];
      });

      if ('Notification' in window && Notification.permission === 'granted') {
        new Notification('Liquidation Warning', {
          body: `Position ${data.position_id.slice(0, 8)}... is at risk of liquidation!`,
        });
      }
    });

    return () => {
      unsubscribe('user_positions', { userId });
      unsubscribe('liquidations', { userId });
      cleanupPosition();
      cleanupLiquidation();
    };
  }, [connected, publicKey?.toString(), isConnected]);

  // Request notification permission
  useEffect(() => {
    if ('Notification' in window && Notification.permission === 'default') {
      Notification.requestPermission();
    }
  }, []);

  return (
    <PositionsContext.Provider value={{ positions, loading, error, liquidationWarnings, refetch }}>
      {children}
    </PositionsContext.Provider>
  );
}

/**
 * Single shared hook for all position consumers.
 * Replaces useUserPositionsWebSocket, usePortfolioValue, useTotalPNL direct API calls.
 */
export function useSharedPositions() {
  return useContext(PositionsContext);
}
