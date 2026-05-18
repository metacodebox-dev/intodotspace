import { useSharedPositions, SharedPosition } from '@/context/PositionsContext';

// Re-export the type for backward compatibility
export type UserPosition = SharedPosition;

/**
 * Hook to get real-time user position updates.
 * Now delegates to the shared PositionsProvider (single fetch, shared state).
 */
export function useUserPositionsWebSocket() {
  const { positions, loading, error, liquidationWarnings, refetch } = useSharedPositions();
  return { positions, loading, error, liquidationWarnings, refetch };
}
