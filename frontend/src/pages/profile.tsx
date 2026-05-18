import Head from 'next/head';
import { Layout } from '@/components/Layout';
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { useWalletModal } from '@solana/wallet-adapter-react-ui';
import { useAuth } from '@/context/AuthContext';
import { useSpacePoints, LEVEL_COLORS, LEVEL_THRESHOLDS, LEVEL_ICONS, UserLevel } from '@/context/SpacePointsContext';
import Image from 'next/image';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { getAccount, getAssociatedTokenAddress } from '@solana/spl-token';
import { USDC_MINT, SPACE_MINT, SPACE_DECIMALS } from '@/utils/solana';
import { formatNumber } from '@/types/formateNumbers';
import { achievements, getUnlockedAchievements } from '@/utils/achievement';

export default function Profile() {
  const { connected, publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const { isAuthenticated, isLoading, signIn, error, tokenExpired, token } = useAuth();
  const { pointsInfo, referralStats, fetchReferralStats } = useSpacePoints();
  const router = useRouter();
  const [signingIn, setSigningIn] = useState(false);
  const [twitterProfile, setTwitterProfile] = useState<{
    name: string | null;
    username: string | null;
    avatarUrl: string | null;
  } | null>(null);
  const [twitterLoading, setTwitterLoading] = useState(false);
  const [twitterError, setTwitterError] = useState<string | null>(null);
  const [xSuccess, setXSuccess] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [userUsdcBalance, setUserUsdcBalance] = useState<number | null>(null);
  const [userSpaceBalance, setUserSpaceBalance] = useState<number | null>(null);
  const [checkingBalance, setCheckingBalance] = useState(false);
  const { connection } = useConnection();
  const [totalVolume, setTotalVolume] = useState<number>(0);
  const [allTimePnL, setAllTimePnL] = useState<number>(0);
  const [lifetimeRewards, setLifetimeRewards] = useState<number>(0);
  const [loadingStats, setLoadingStats] = useState(false);
  const apiBaseUrl = useMemo(() => process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001', []);

  useEffect(() => {
    if (!connected || !publicKey) {
      setUserUsdcBalance(null);
      setUserSpaceBalance(null);
      return;
    }

    const checkBalance = async () => {
      setCheckingBalance(true);
      try {
        // USDC balance
        const userUsdcATA = await getAssociatedTokenAddress(USDC_MINT, publicKey);
        getAccount(connection, userUsdcATA)
          .then((a) => setUserUsdcBalance(Number(a.amount)))
          .catch(() => setUserUsdcBalance(0));

        // SPACE (SPC) balance — separate try so a missing ATA on one token
        // doesn't zero out the other.
        const userSpaceATA = await getAssociatedTokenAddress(SPACE_MINT, publicKey);
        getAccount(connection, userSpaceATA)
          .then((a) => setUserSpaceBalance(Number(a.amount)))
          .catch(() => setUserSpaceBalance(0));
      } finally {
        setCheckingBalance(false);
      }
    };

    checkBalance();
    const interval = setInterval(checkBalance, 30000);
    return () => clearInterval(interval);
  }, [connected, publicKey, connection]);

  // Fetch referral stats on mount
  useEffect(() => {
    if (isAuthenticated) {
      fetchReferralStats();
    }
  }, [isAuthenticated, fetchReferralStats]);

  // Fetch volume and PnL stats
  const fetchVolumeAndPnL = useCallback(async () => {
    if (!publicKey || !isAuthenticated) return;
    
    setLoadingStats(true);
    try {
      const [volumePnLResponse, rewardsResponse] = await Promise.all([
        fetch(`${apiBaseUrl}/api/v1/users/${publicKey.toString()}/volume-pnl`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }),
        fetch(`${apiBaseUrl}/api/v1/users/${publicKey.toString()}/lifetime-rewards`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        }),
      ]);
      
      if (volumePnLResponse.ok) {
        const data = await volumePnLResponse.json();
        setTotalVolume(data.totalVolume || 0);
        setAllTimePnL(data.allTimePnL || 0);
      } else if (volumePnLResponse.status !== 401) {
        console.error('Failed to load volume and PnL');
      }
      
      if (rewardsResponse.ok) {
        const rewardsData = await rewardsResponse.json();
        setLifetimeRewards(rewardsData.lifetimeRewards || 0);
      } else if (rewardsResponse.status !== 401) {
        console.error('Failed to load lifetime rewards');
      }
    } catch (err) {
      console.error('Failed to load stats:', err);
      // Don't show error on initial load
    } finally {
      setLoadingStats(false);
    }
  }, [publicKey, isAuthenticated, apiBaseUrl, token]);

  // Fetch volume and PnL on mount and set up 30-minute interval
  useEffect(() => {
    if (isAuthenticated && publicKey) {
      // Fetch immediately
      fetchVolumeAndPnL();
      
      // Set up 30-minute interval (30 * 60 * 1000 = 1800000 ms)
      const interval = setInterval(fetchVolumeAndPnL, 30 * 60 * 1000);
      
      return () => clearInterval(interval);
    }
  }, [isAuthenticated, publicKey, fetchVolumeAndPnL]);

  // Copy referral link
  const handleCopyReferralLink = useCallback(async () => {
    if (!pointsInfo?.referralCode) return;
    const link = `${typeof window !== 'undefined' ? window.location.origin : ''}/?ref=${pointsInfo.referralCode}`;
    try {
      await navigator.clipboard.writeText(link);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    } catch (err) {
      console.error('Failed to copy:', err);
    }
  }, [pointsInfo?.referralCode]);

  // Get level progress info
  const levelInfo = useMemo(() => {
    if (!pointsInfo) return null;
    const levels: UserLevel[] = ['iron', 'bronze', 'silver', 'gold', 'platinum', 'diamond'];
    const currentIndex = levels.indexOf(pointsInfo.level);
    const currentThreshold = LEVEL_THRESHOLDS[pointsInfo.level];
    const nextLevel = currentIndex < levels.length - 1 ? levels[currentIndex + 1] : null;
    const nextThreshold = nextLevel ? LEVEL_THRESHOLDS[nextLevel] : pointsInfo.totalPoints;
    const progress = nextLevel 
      ? ((pointsInfo.totalPoints - currentThreshold) / (nextThreshold - currentThreshold)) * 100
      : 100;
    const progressDots = Math.floor((progress / 100) * 30);
    
    return {
      currentLevel: pointsInfo.level,
      nextLevel,
      currentThreshold,
      nextThreshold,
      progress: Math.min(Math.max(progress, 0), 100),
      progressDots,
    };
  }, [pointsInfo]);

  const unlockedAchievements = useMemo(() => {
    if (!pointsInfo) return new Set<string>();
    return getUnlockedAchievements({
      isNewUser: pointsInfo.isNewUser,
      totalTrades: pointsInfo.totalTrades,
      totalPoints: pointsInfo.totalPoints,
    });
  }, [pointsInfo]);

  // Handle X callback query params
  useEffect(() => {
    const xStatus = router.query.x as string | undefined;
    if (xStatus) {
      // Clear the query param from URL
      router.replace('/profile', undefined, { shallow: true });
      
      if (xStatus === 'connected') {
        setXSuccess(true);
        setTimeout(() => setXSuccess(false), 3000);
        // Refetch profile after successful connection
        if (token) {
          fetchTwitterProfileFn();
        }
      } else if (xStatus === 'denied') {
        setTwitterError('You denied access to your X account');
        setTimeout(() => setTwitterError(null), 5000);
      } else if (xStatus === 'expired') {
        setTwitterError('Session expired. Please try again.');
        setTimeout(() => setTwitterError(null), 5000);
      } else if (xStatus === 'error' || xStatus === 'token_error' || xStatus === 'profile_error') {
        setTwitterError('Failed to connect X account. Please try again.');
        setTimeout(() => setTwitterError(null), 5000);
      }
    }
  }, [router.query.x]);

  const handleConnectWallet = useCallback(() => {
    setVisible(true);
  }, [setVisible]);

  const handleSignIn = useCallback(async () => {
    setSigningIn(true);
    try {
      await signIn();
    } catch (err) {
      console.error('Failed to sign in:', err);
    } finally {
      setSigningIn(false);
    }
  }, [signIn]);

  const fetchTwitterProfileFn = useCallback(async () => {
    if (!token) return;
    setTwitterLoading(true);
    setTwitterError(null);
    try {
      const response = await fetch(`${apiBaseUrl}/api/x/profile`, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
      if (!response.ok) {
        if (response.status === 401) {
          // Token expired, don't show error
          return;
        }
        throw new Error('Failed to load X profile');
      }
      const data = await response.json();
      if (data.connected) {
        setTwitterProfile({
          name: data.profile?.name || null,
          username: data.profile?.username || null,
          avatarUrl: data.profile?.avatarUrl || null,
        });
      } else {
        setTwitterProfile(null);
      }
    } catch (err) {
      console.error('Failed to load X profile:', err);
      // Don't show error on initial load
    } finally {
      setTwitterLoading(false);
    }
  }, [apiBaseUrl, token]);

  // Alias for useEffect dependency
  const fetchTwitterProfile = fetchTwitterProfileFn;

  const handleConnectX = useCallback(async () => {
    if (!token) return;
    setTwitterLoading(true);
    setTwitterError(null);
    try {
      const response = await fetch(`${apiBaseUrl}/api/x/connect`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error?.message || 'Failed to start X connect');
      }
      const data = await response.json();
      if (data.authUrl) {
        window.location.href = data.authUrl;
      }
    } catch (err) {
      console.error('Failed to connect X:', err);
      setTwitterError(err instanceof Error ? err.message : 'Failed to connect X account');
      setTwitterLoading(false);
    }
  }, [apiBaseUrl, token]);

  useEffect(() => {
    if (isAuthenticated && token) {
      fetchTwitterProfile();
    }
  }, [fetchTwitterProfile, isAuthenticated, token]);

  // Show connect wallet prompt if not connected
  if (!connected) {
    return (
      <Layout>
        <div className="text-center py-32">
          <div className="w-20 h-20 mx-auto mb-6 rounded-full bg-space-gray-800 flex items-center justify-center">
            <svg className="w-10 h-10 text-space-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M3 10h18M7 15h1m4 0h1m-7 4h12a3 3 0 003-3V8a3 3 0 00-3-3H6a3 3 0 00-3 3v8a3 3 0 003 3z" />
            </svg>
          </div>
          <h1 className="text-3xl font-bold text-white mb-4">Connect Your Wallet</h1>
          <p className="text-space-gray-400 mb-8 max-w-md mx-auto">
            Please connect your wallet to view your profile and access all features.
          </p>
          <button
            onClick={handleConnectWallet}
            className="px-6 py-3 bg-space-primary hover:bg-space-secondary text-white font-semibold rounded-lg transition-colors inline-flex items-center gap-2"
          >
            <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1" />
            </svg>
            Connect Wallet
          </button>
        </div>
      </Layout>
    );
  }

  // Show sign in prompt if connected but not authenticated
  if (!isAuthenticated && !isLoading) {
    return (
      <Layout>
        <div className="text-center py-32">
          <div className={`w-20 h-20 mx-auto mb-6 rounded-full ${tokenExpired ? 'bg-amber-500/20' : 'bg-space-gray-800'} flex items-center justify-center`}>
            {tokenExpired ? (
              <svg className="w-10 h-10 text-amber-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
            ) : (
              <svg className="w-10 h-10 text-space-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z" />
              </svg>
            )}
          </div>
          <h1 className="text-3xl font-bold text-white mb-4">
            {tokenExpired ? 'Session Expired' : 'Sign In Required'}
          </h1>
          <p className="text-space-gray-400 mb-8 max-w-md mx-auto">
            {tokenExpired 
              ? 'Your session has expired. Please sign in again to continue.'
              : 'Your wallet is connected. Please sign in to verify ownership and access your profile.'
            }
          </p>
          {error && (
            <div className="mb-6 px-4 py-3 bg-red-500/10 border border-red-500/30 rounded-lg text-red-400 text-sm max-w-md mx-auto">
              {error}
            </div>
          )}
          <button
            onClick={handleSignIn}
            disabled={signingIn}
            className={`px-6 py-3 ${tokenExpired ? 'bg-amber-600 hover:bg-amber-500' : 'bg-space-primary hover:bg-space-secondary'} disabled:opacity-50 disabled:cursor-not-allowed text-white font-semibold rounded-lg transition-colors inline-flex items-center gap-2`}
          >
            {signingIn ? (
              <>
                <svg className="w-5 h-5 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
                Signing In...
              </>
            ) : (
              <>
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1" />
                </svg>
                {tokenExpired ? 'Sign In Again' : 'Sign In with Wallet'}
              </>
            )}
          </button>
          <p className="text-xs text-space-gray-500 mt-4 max-w-sm mx-auto">
            This will prompt you to sign a message to verify wallet ownership. No transaction will be made.
          </p>
        </div>
      </Layout>
    );
  }

  // Show loading state
  if (isLoading) {
    return (
      <Layout>
        <div className="animate-pulse">
          {/* Profile Header Skeleton */}
          <div className="rounded-xl p-6 border border-[#262626] mb-6 bg-[#141414]">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-4">
                <div className="w-20 h-20 rounded-lg bg-[#262626]"></div>
                <div className="space-y-2">
                  <div className="h-5 w-40 bg-[#262626] rounded-md"></div>
                  <div className="h-4 w-28 bg-[#1F1F1F] rounded-md"></div>
                  <div className="h-7 w-32 bg-[#1F1F1F] rounded-md"></div>
                </div>
              </div>
              <div className="h-10 w-32 bg-[#1F1F1F] rounded-lg"></div>
            </div>
          </div>

          {/* Stats Row Skeleton */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
            {Array.from({ length: 4 }).map((_, index) => (
              <div key={index} className="rounded-lg p-5 border border-[#262626] bg-[#141414]">
                <div className="h-3 w-24 bg-[#262626] rounded mb-3"></div>
                <div className="h-5 w-20 bg-[#1F1F1F] rounded"></div>
              </div>
            ))}
          </div>

          {/* Three Column Layout Skeleton */}
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Rank Card Skeleton */}
            <div className="rounded-xl p-8 border border-[#262626] bg-[#141414]">
              <div className="h-4 w-16 bg-[#262626] rounded mb-6"></div>
              <div className="flex items-center space-x-3 mb-6">
                <div className="w-16 h-16 rounded-full bg-[#262626]"></div>
                <div className="space-y-2">
                  <div className="h-3 w-24 bg-[#1F1F1F] rounded"></div>
                  <div className="h-5 w-16 bg-[#262626] rounded"></div>
                </div>
              </div>
              <div className="h-3 w-full bg-[#1F1F1F] rounded mb-3"></div>
              <div className="flex justify-between mb-6">
                <div className="h-3 w-16 bg-[#1F1F1F] rounded"></div>
                <div className="h-3 w-16 bg-[#1F1F1F] rounded"></div>
              </div>
              <div className="h-px w-full bg-[#262626] mb-4"></div>
              <div className="h-4 w-24 bg-[#262626] rounded mb-3"></div>
              <div className="flex items-center space-x-2">
                <div className="w-16 h-16 rounded-lg bg-[#262626]"></div>
                <div className="w-16 h-16 rounded-lg bg-[#1F1F1F]"></div>
                <div className="w-16 h-16 rounded-lg bg-[#262626]"></div>
              </div>
            </div>

            {/* Balance Card Skeleton */}
            <div className="rounded-xl border border-[#262626] bg-[#141414] overflow-hidden">
              <div className="p-6 space-y-4">
                <div className="h-3 w-16 bg-[#262626] rounded"></div>
                <div className="h-5 w-28 bg-[#1F1F1F] rounded"></div>
                <div className="h-3 w-16 bg-[#262626] rounded"></div>
                <div className="h-5 w-28 bg-[#1F1F1F] rounded"></div>
              </div>
              <div className="p-4">
                <div className="h-11 w-full bg-[#1F1F1F] rounded-lg"></div>
              </div>
            </div>

            {/* Referrals Card Skeleton */}
            <div className="rounded-xl border border-[#262626] bg-[#141414] overflow-hidden">
              <div className="p-6 space-y-3 bg-[#1F1F1F]">
                <div className="w-8 h-8 rounded bg-[#262626]"></div>
                <div className="h-5 w-40 bg-[#262626] rounded"></div>
                <div className="h-3 w-full bg-[#262626] rounded"></div>
                <div className="h-3 w-3/4 bg-[#262626] rounded"></div>
              </div>
              <div className="p-4">
                <div className="h-10 w-full bg-[#1F1F1F] rounded-lg mb-4"></div>
                <div className="h-11 w-full bg-[#262626] rounded-lg"></div>
              </div>
            </div>
          </div>
        </div>
      </Layout>
    );
  }

  const stats = [
    { 
      label: 'All Time Volume', 
      value: loadingStats ? '...' : `$${formatNumber(totalVolume.toFixed(2))}`, 
      highlight: false 
    },
    { 
      label: 'All Time PnL', 
      value: loadingStats ? '...' : `${allTimePnL >= 0 ? '+' : ''}$${formatNumber(allTimePnL.toFixed(2))}`, 
      highlight: false 
    },
    { label: 'Number of Trades', value: (pointsInfo?.totalTrades || 0).toLocaleString(), highlight: false },
    { 
      label: 'Lifetime Rewards', 
      value: loadingStats ? '...' : `$${formatNumber(lifetimeRewards.toFixed(2))}`, 
      highlight: true 
    },
  ];

  return (
    <>
      <Head>
        <title>Profile - Space</title>
        <meta name="description" content="View your profile and achievements" />
      </Head>

      <Layout>
        {/* Profile Header Card */}
        <div className="rounded-xl p-4 sm:p-6 border border-[#262626] mb-6">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div className="flex flex-col sm:flex-row items-center sm:items-center gap-4 text-center sm:text-left">
              {/* Avatar */}
              <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-lg bg-white overflow-hidden flex items-center justify-center flex-shrink-0">
                {twitterLoading ? (
                  <div className="w-full h-full bg-[#262626] animate-pulse" />
                ) : twitterProfile?.avatarUrl ? (
                  <Image
                    src={twitterProfile.avatarUrl}
                    alt="Profile"
                    width={80}
                    height={80}
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-[#ffffff] flex items-center justify-center text-2xl text-white">
                    
                  </div>
                )}
              </div>
              <div className="flex flex-col items-center sm:items-start">
                <div className="flex items-center space-x-2 mb-1">
                  {twitterLoading ? (
                    <div className="h-7 sm:h-8 w-32 sm:w-40 bg-[#262626] rounded animate-pulse" />
                  ) : (
                    <>
                      <h1 className="text-xl sm:text-2xl font-bold text-white">
                        {twitterProfile?.name || (publicKey ? `${publicKey.toString().slice(0, 4)}...${publicKey.toString().slice(-4)}` : 'Anonymous')}
                      </h1>
                      {twitterProfile?.username && (
                        <Image src="/assets/verified-profile.svg" alt="Verified" width={1000} height={1000} className="w-4 h-4 sm:w-5 sm:h-5 object-cover" />
                      )}
                    </>
                  )}
                </div>
                <p className="text-xs sm:text-sm text-space-gray-400 mb-2">Joined Jan 2026</p>
                <div className="flex flex-wrap items-center justify-center sm:justify-start gap-2">
                  {twitterProfile?.username ? (
                    <span className="px-3 py-1.5 bg-[#191919] text-space-gray-300 border border-[#262626] text-xs font-medium rounded-lg flex items-center space-x-1.5">
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                      </svg>
                      <span>{twitterProfile.username}</span>
                    </span>
                  ) : (
                    <button
                      onClick={handleConnectX}
                      disabled={twitterLoading}
                      className="px-3 py-1.5 bg-[#191919] text-space-gray-200 border border-[#262626] text-xs font-medium rounded-lg flex items-center space-x-1.5 hover:bg-[#222222] transition-colors disabled:opacity-60"
                    >
                      <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
                      </svg>
                      <span>{twitterLoading ? 'Connecting...' : 'Connect X'}</span>
                    </button>
                  )}
                  {twitterError && (
                    <span className="text-xs text-red-400">{twitterError}</span>
                  )}
                </div>
              </div>
            </div>
            {/* <button className="w-full sm:w-auto px-4 py-2.5 hover:bg-space-gray-600 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center space-x-2 border border-[#262626]">
              <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
              </svg>
              <span>Edit Profile</span>
            </button> */}
          </div>
        </div>

        {/* Stats Row */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {stats.map((stat, index) => (
            <div className='relative'>
              <Image
                src="/assets/trades-profile.svg"
                alt="Trades"
                width={1000}
                height={1000}
                className="absolute top-0 left-0 w-full h-full object-cover"
              />
              <div key={index} className="rounded-lg p-5 relative z-10 border border-[#262626]">
                <p className="text-xs font-medium text-space-gray-400 mb-2">{stat.label}</p>
                <p className={`text-xl font-bold text-white}`}>
                  {stat.value}
                </p>
              </div>

            </div>
          ))}
        </div>

        {/* Three Column Layout */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          {/* Rank Card */}
          <div className="rounded-xl lg:p-8 p-6 relative">
            <Image src="/assets/level-profile.svg" alt="Rank" width={1000} height={1000} className="absolute top-0 left-0 lg:w-full w-screen  rounded-xl" />
            <div className='relative z-10 w-full h-full'>
            <div className="flex items-center gap-1 mb-4 relative z-10">
              <Image src="/assets/rank-profile.svg" alt="Rank" width={1000} height={1000} className="w-5 h-5 object-cover" />
              <span className="text-sm font-semibold text-white">Rank</span>
            </div>

            {/* Gold Star Badge */}
            <div className="flex items-center space-x-3 mb-2 relative z-10">
              <div className=" flex items-center justify-center">
              <Image src={pointsInfo ? LEVEL_ICONS[pointsInfo.level] : LEVEL_ICONS.iron} alt="Rank" width={1000} height={1000} className="w-20 h-20 object-cover rounded-lg" />
              </div>
              <div className='flex flex-col items-start'>
                {levelInfo?.nextLevel ? (
                  <p className="text-sm text-[#A3A3A3] mb-0.5">Next: <span className='text-white capitalize'>{levelInfo.nextLevel}</span></p>
                ) : (
                  <p className="text-sm text-[#A3A3A3] mb-0.5">Max Level!</p>
                )}
                <p className={`text-2xl font-bold capitalize ${
                  pointsInfo?.level === 'iron' ? 'text-[#A8A8A8]' :
                  pointsInfo?.level === 'bronze' ? 'text-[#CD7F32]' :
                  pointsInfo?.level === 'silver' ? 'text-[#C0C0C0]' :
                  pointsInfo?.level === 'gold' ? 'text-[#FBE944]' :
                  pointsInfo?.level === 'platinum' ? 'text-[#00CED1]' :
                  pointsInfo?.level === 'diamond' ? 'text-[#B9F2FF]' : 'text-[#A8A8A8]'
                }`}>{pointsInfo?.level || 'Iron'}</p>
              </div>
            </div>

            {/* Progress Dots */}
            <div className="mb-4 relative z-10">
              <div className="flex items-center justify-between space-x-1 mb-2 relative w-full">
                {[...Array(30)].map((_, i) => (
                  <div
                    key={i}
                    className={`w-1 h-2 rounded-full ${i < (levelInfo?.progressDots ?? 0) ? 'bg-[#FBE944]' : 'bg-[#3B3B3B]'}`}
                  />
                ))}
                <div 
                  className='z-10 absolute -top-3 transition-all duration-300'
                  style={{ left: `${Math.max(5, Math.min(95, ((levelInfo?.progressDots ?? 0) / 30) * 100))}%`, transform: 'translateX(-50%)' }}
                >
                <Image src="/assets/progress-profile.png" alt="Progress" width={1000} height={1000} className=" select-none active:scale-105 hover:scale-105 transition-all duration-300 h-8 w-auto" />
                  
                </div>
              </div>
              <div className="flex items-center justify-between text-xs text-space-gray-400">
                <span>{(pointsInfo?.totalPoints ?? 0).toLocaleString()} PTS</span>
                <span>{(levelInfo?.nextThreshold ?? 50000).toLocaleString()} PTS</span>
              </div>
            </div>
              <div className='h-1 border-t border-[#262626] w-full my-4 relative z-10' />
            {/* Achievements */}
            <div>
              <p className="text-sm font-semibold text-white mb-3">Achievements</p>
              <div className="flex items-center space-x-2">

               {Object.values(achievements).map((achv) => {
                  const unlocked = unlockedAchievements.has(achv.id);
                  return (
                    <div key={achv.id} className="relative group cursor-pointer">
                      <div className={`w-20 h-20 rounded-lg flex items-center justify-center ${unlocked ? 'bg-[#262626]/50' : 'bg-[#262626]/30'}`}>
                        <Image
                          src={achv.image}
                          alt={achv.name}
                          width={100}
                          height={100}
                          className={`w-16 h-16 object-contain ${unlocked ? '' : 'opacity-30 grayscale'}`}
                        />
                      </div>
                      <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none bg-[#1a1a1a] border border-[#262626] text-xs text-gray-300 px-2 py-1 rounded z-20">
                        {achv.name}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
            </div>
          </div>

          {/* Balance Card */}
          <div className="rounded-xl overflow-hidden flex flex-col relative lg:h-auto h-96 lg:mt-0 mt-16">
            <Image
              src="/assets/wallet-profile.svg"
              alt="USDC"
              width={1000}
              height={1000}
              className="absolute top-0 left-0 w-screen"
            />
            <div className="relative z-10 flex flex-col h-full w-full justify-between py-4 px-4">

              <div className='flex flex-col lg:gap-5 gap-4 items-start px-16 pt-2'>
                <div className='flex flex-col items-start'>
                  <p className='text-sm text-[#FFFFFF]/40'>SPC</p>
                  <p className='text-base font-semibold text-white'>
                    {checkingBalance
                      ? '...'
                      : userSpaceBalance !== null
                        ? formatNumber((userSpaceBalance / Math.pow(10, SPACE_DECIMALS)).toFixed(2))
                        : '0'}
                  </p>
                </div>
                <div className='flex flex-col items-start'>
                  <p className='text-sm text-[#FFFFFF]/40'>USDC</p>
                  <p className='text-base font-semibold text-white'>{checkingBalance ? '...' : userUsdcBalance !== null ? `$${formatNumber((userUsdcBalance / 1e6).toFixed(2))}` : '$0.00'}</p>
                </div>
              </div>

              <button className="w-full px-4 py-3 bg-white hover:bg-gray-100 text-space-gray-900 font-semibold rounded-lg transition-colors flex items-center justify-center space-x-2">
                <Image src="/assets/claim-profile.svg" alt="Claim" width={1000} height={1000} className="w-5 h-5" />
                <span>Claim</span>
              </button>

            </div>


          </div>

          {/* Referrals Card */}
          <div className=" rounded-xl border border-[#262626] overflow-hidden flex flex-col">
            {/* Blue Gradient Header */}
            <div className="bg-[#3E8FF1] h-56 p-4 flex flex-col justify-between gap-5">
              <div className="w-7 h-7 flex items-center justify-center mb-4">
                <Image src="/assets/referral-profile.svg" alt="Referrals" width={1000} height={1000} className="w-full h-full object-cover" />
              </div>
              <div className='flex flex-col gap-2'>
                <h3 className="text-xl font-bold text-white">Earn with Referrals</h3>
                <p className="text-sm text-sky-100">
                  Invite your friends to trade the future with Space, and get rewarded for growing our community in the process.
                </p>

              </div>
            </div>

            {/* Referral Link */}
            <div className="p-4 flex-1">
              <div className="bg-[#191919] rounded-lg px-4 py-3">
                <p className="text-sm text-space-gray-300 font-mono truncate">
                  {typeof window !== 'undefined' ? `${window.location.origin}/?ref=${pointsInfo?.referralCode || '...'}` : `https://into.space/?ref=${pointsInfo?.referralCode || '...'}`}
                </p>
              </div>
            </div>

            {/* Copy Link Button */}
            <div className="p-4 pt-0">
              <button 
                onClick={handleCopyReferralLink}
                className="w-full px-4 py-3 bg-white hover:bg-gray-100 text-space-gray-900 font-semibold rounded-lg transition-colors flex items-center justify-center space-x-2"
              >
                {copySuccess ? (
                  <>
                    <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                    </svg>
                    <span>Copied!</span>
                  </>
                ) : (
                  <>
                    <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                    </svg>
                    <span>Copy Link</span>
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      </Layout>
    </>
  );
}






