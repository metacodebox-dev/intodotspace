'use client';

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode, useMemo } from 'react';
import { useAuth } from './AuthContext';

// Level thresholds - must match backend
export const LEVEL_THRESHOLDS = {
  iron: 0,
  bronze: 50000,
  silver: 120000,
  gold: 250000,
  platinum: 350000,
  diamond: 500000,
} as const;

export type UserLevel = keyof typeof LEVEL_THRESHOLDS;

export const LEVEL_COLORS: Record<UserLevel, { text: string; bg: string; border: string }> = {
  iron: { text: 'text-stone-400', bg: 'bg-stone-400/20', border: 'border-stone-400/30' },
  bronze: { text: 'text-orange-400', bg: 'bg-orange-400/20', border: 'border-orange-400/30' },
  silver: { text: 'text-gray-300', bg: 'bg-gray-300/20', border: 'border-gray-300/30' },
  gold: { text: 'text-yellow-400', bg: 'bg-yellow-400/20', border: 'border-yellow-400/30' },
  platinum: { text: 'text-cyan-300', bg: 'bg-cyan-300/20', border: 'border-cyan-300/30' },
  diamond: { text: 'text-purple-400', bg: 'bg-purple-400/20', border: 'border-purple-400/30' },
};

export const LEVEL_ICONS: Record<UserLevel, string> = {
  iron: '/assets/achievement/Iron.png',
  bronze: '/assets/achievement/Bronze.png',
  silver: '/assets/achievement/Silver.png',
  gold: '/assets/achievement/Gold.png',
  platinum: '/assets/achievement/Platinum.png',
  diamond: '/assets/achievement/Diamond.png',
};

export interface UserPointsInfo {
  walletAddress: string;
  referralCode: string;
  totalPoints: number;
  referralPoints: number;
  tradingPoints: number;
  bonusPoints: number;
  level: UserLevel;
  totalReferrals: number;
  totalTrades: number;
  isNewUser: boolean;
  nextLevel: UserLevel | null;
  pointsToNextLevel: number;
  levelProgress: number;
  rank: number;
}

export interface ReferralInfo {
  id: number;
  referredWallet: string;
  pointsAwarded: number;
  status: string;
  createdAt: string;
  completedAt: string | null;
}

export interface ReferralStats {
  totalReferrals: number;
  completedReferrals: number;
  pendingReferrals: number;
  totalPointsEarned: number;
  referrals: ReferralInfo[];
}

interface SpacePointsContextValue {
  pointsInfo: UserPointsInfo | null;
  referralStats: ReferralStats | null;
  isLoading: boolean;
  error: string | null;
  showReferralModal: boolean;
  pendingReferralCode: string | null;
  refreshPoints: () => Promise<void>;
  applyReferralCode: (code: string) => Promise<{ success: boolean; message: string }>;
  dismissReferralModal: () => Promise<void>;
  claimDailyBonus: () => Promise<{ success: boolean; points?: number; message: string }>;
  validateReferralCode: (code: string) => Promise<boolean>;
  fetchReferralStats: () => Promise<void>;
  setShowReferralModal: (show: boolean) => void;
}

const SpacePointsContext = createContext<SpacePointsContextValue | undefined>(undefined);

const API_BASE_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

interface SpacePointsProviderProps {
  children: ReactNode;
}

export function SpacePointsProvider({ children }: SpacePointsProviderProps) {
  const { isAuthenticated, token, user } = useAuth();
  
  const [pointsInfo, setPointsInfo] = useState<UserPointsInfo | null>(null);
  const [referralStats, setReferralStats] = useState<ReferralStats | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showReferralModal, setShowReferralModal] = useState(false);
  const [pendingReferralCode, setPendingReferralCode] = useState<string | null>(null);

  // Check for referral code in URL on mount
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const urlParams = new URLSearchParams(window.location.search);
      const refCode = urlParams.get('ref');
      if (refCode) {
        setPendingReferralCode(refCode.toUpperCase());
        // Clean up URL
        const newUrl = new URL(window.location.href);
        newUrl.searchParams.delete('ref');
        window.history.replaceState({}, '', newUrl.toString());
      }
    }
  }, []);

  // Fetch points when authenticated
  const refreshPoints = useCallback(async () => {
    if (!isAuthenticated || !token) return;

    setIsLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_BASE_URL}/api/referrals/points`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (!response.ok) {
        throw new Error('Failed to fetch points');
      }

      const data = await response.json();
      if (data.success) {
        setPointsInfo(data.data);
        
        // Show referral modal for new users
        if (data.data.isNewUser) {
          setShowReferralModal(true);
        }
      }
    } catch (err) {
      console.error('Error fetching points:', err);
      setError(err instanceof Error ? err.message : 'Failed to fetch points');
    } finally {
      setIsLoading(false);
    }
  }, [isAuthenticated, token]);

  // Fetch referral stats
  const fetchReferralStats = useCallback(async () => {
    if (!isAuthenticated || !token) return;

    try {
      const response = await fetch(`${API_BASE_URL}/api/referrals/stats`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      if (response.ok) {
        const data = await response.json();
        if (data.success) {
          setReferralStats(data.data);
        }
      }
    } catch (err) {
      console.error('Error fetching referral stats:', err);
    }
  }, [isAuthenticated, token]);

  // Apply referral code
  const applyReferralCode = useCallback(async (code: string): Promise<{ success: boolean; message: string }> => {
    if (!isAuthenticated || !token) {
      return { success: false, message: 'Please sign in first' };
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/referrals/apply`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ referralCode: code.toUpperCase() }),
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, message: data.error?.message || 'Failed to apply referral code' };
      }

      // Refresh points after successful referral
      await refreshPoints();
      setShowReferralModal(false);
      setPendingReferralCode(null);

      return { success: true, message: data.message };
    } catch (err) {
      return { success: false, message: 'Network error. Please try again.' };
    }
  }, [isAuthenticated, token, refreshPoints]);

  // Dismiss referral modal
  const dismissReferralModal = useCallback(async () => {
    if (!token) {
      setShowReferralModal(false);
      return;
    }

    try {
      await fetch(`${API_BASE_URL}/api/referrals/dismiss`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    } catch (err) {
      console.error('Error dismissing referral modal:', err);
    }

    setShowReferralModal(false);
    setPendingReferralCode(null);
    
    // Update local state
    if (pointsInfo) {
      setPointsInfo({ ...pointsInfo, isNewUser: false });
    }
  }, [token, pointsInfo]);

  // Claim daily bonus
  const claimDailyBonus = useCallback(async (): Promise<{ success: boolean; points?: number; message: string }> => {
    if (!isAuthenticated || !token) {
      return { success: false, message: 'Please sign in first' };
    }

    try {
      const response = await fetch(`${API_BASE_URL}/api/referrals/daily-bonus`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const data = await response.json();

      if (!response.ok) {
        return { success: false, message: data.error?.message || 'Failed to claim bonus' };
      }

      // Refresh points after claiming bonus
      await refreshPoints();

      return { success: true, points: data.points, message: data.message };
    } catch (err) {
      return { success: false, message: 'Network error. Please try again.' };
    }
  }, [isAuthenticated, token, refreshPoints]);

  // Validate referral code
  const validateReferralCode = useCallback(async (code: string): Promise<boolean> => {
    try {
      const response = await fetch(`${API_BASE_URL}/api/referrals/validate/${code.toUpperCase()}`);
      const data = await response.json();
      return data.valid === true;
    } catch {
      return false;
    }
  }, []);

  // Auto-fetch points when authenticated
  useEffect(() => {
    if (isAuthenticated && token) {
      refreshPoints();
    } else {
      // Clear state when logged out
      setPointsInfo(null);
      setReferralStats(null);
      setShowReferralModal(false);
    }
  }, [isAuthenticated, token, refreshPoints]);

  // Auto-apply pending referral code when points are loaded for new user
  useEffect(() => {
    if (pendingReferralCode && pointsInfo?.isNewUser && isAuthenticated) {
      // Don't auto-apply, just show the modal with the code pre-filled
      setShowReferralModal(true);
    }
  }, [pendingReferralCode, pointsInfo?.isNewUser, isAuthenticated]);

  const value = useMemo<SpacePointsContextValue>(() => ({
    pointsInfo,
    referralStats,
    isLoading,
    error,
    showReferralModal,
    pendingReferralCode,
    refreshPoints,
    applyReferralCode,
    dismissReferralModal,
    claimDailyBonus,
    validateReferralCode,
    fetchReferralStats,
    setShowReferralModal,
  }), [
    pointsInfo,
    referralStats,
    isLoading,
    error,
    showReferralModal,
    pendingReferralCode,
    refreshPoints,
    applyReferralCode,
    dismissReferralModal,
    claimDailyBonus,
    validateReferralCode,
    fetchReferralStats,
  ]);

  return (
    <SpacePointsContext.Provider value={value}>
      {children}
    </SpacePointsContext.Provider>
  );
}

export function useSpacePoints(): SpacePointsContextValue {
  const context = useContext(SpacePointsContext);
  
  if (context === undefined) {
    throw new Error('useSpacePoints must be used within a SpacePointsProvider');
  }
  
  return context;
}

export { SpacePointsContext };
