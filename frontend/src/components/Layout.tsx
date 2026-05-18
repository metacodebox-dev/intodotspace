import {
  ReactNode,
  useState,
  useRef,
  useEffect,
  useCallback,
  useMemo,
} from "react";
import Link from "next/link";
import { useWallet } from "@solana/wallet-adapter-react";
import { useWalletModal } from "@solana/wallet-adapter-react-ui";
import { useRouter } from "next/router";
import Image from "next/image";
import { useAuth } from "@/context/AuthContext";
import { useSpacePoints, LEVEL_COLORS, LEVEL_ICONS } from "@/context/SpacePointsContext";
import { ReferralModal } from "./ReferralModal";
import { isAdminWallet } from "../utils/admin";
import { usePortfolioValue } from "@/hooks/usePortfolioValue";
import { useNotifications } from "@/hooks/useNotifications";
import { useNotificationsWebSocket } from "@/hooks/useNotificationsWebSocket";
import {
  formatTimeAgo,
  getNotificationIcon,
  formatNotificationMessage,
} from "@/utils/notificationUtils";

interface LayoutProps {
  children: ReactNode;
}

export function Layout({ children }: LayoutProps) {
  const { connected, publicKey } = useWallet();
  const { setVisible } = useWalletModal();
  const {
    isAuthenticated,
    isLoading: authLoading,
    signIn,
    signOutAndDisconnect,
    error: authError,
    tokenExpired,
    token,
  } = useAuth();
  const router = useRouter();
  const [notificationOpen, setNotificationOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [copySuccess, setCopySuccess] = useState(false);
  const [signingIn, setSigningIn] = useState(false);
  // Initialize avatar from sessionStorage immediately to prevent flash
  const [profileAvatar, setProfileAvatar] = useState<string | null>(() => {
    if (typeof window !== "undefined") {
      const cached = sessionStorage.getItem("profile_avatar");
      return cached && cached !== "null" ? cached : null;
    }
    return null;
  });
  const notificationRef = useRef<HTMLDivElement>(null);
  const profileRef = useRef<HTMLDivElement>(null);
  const closeTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const profileCloseTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const apiBaseUrl = useMemo(
    () => process.env.NEXT_PUBLIC_API_URL || "http://localhost:3001",
    [],
  );
  const avatarFetched = useRef(false);
  const previousPublicKey = useRef<string | null>(null);

  // Detect wallet change and reset avatar
  useEffect(() => {
    const currentKey = publicKey?.toString() || null;

    if (
      previousPublicKey.current &&
      currentKey &&
      previousPublicKey.current !== currentKey
    ) {
      // Wallet changed - clear avatar cache and reset
      setProfileAvatar(null);
      sessionStorage.removeItem("profile_avatar");
      avatarFetched.current = false;
    }

    previousPublicKey.current = currentKey;
  }, [publicKey]);

  // Fetch Twitter profile avatar - only on initial load, not on page navigation
  useEffect(() => {
    if (!isAuthenticated || !token) {
      setProfileAvatar(null);
      return;
    }

    // If we already have cached avatar and already fetched, skip
    if (profileAvatar && avatarFetched.current) return;

    // Fetch from API in background
    const fetchAvatar = async () => {
      avatarFetched.current = true;
      try {
        const response = await fetch(`${apiBaseUrl}/api/x/profile`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (response.ok) {
          const data = await response.json();
          if (data.connected && data.profile?.avatarUrl) {
            setProfileAvatar(data.profile.avatarUrl);
            sessionStorage.setItem("profile_avatar", data.profile.avatarUrl);
          } else {
            setProfileAvatar(null);
            sessionStorage.setItem("profile_avatar", "null");
          }
        }
      } catch {
        // Keep existing cached avatar on error
      }
    };
    fetchAvatar();
  }, [isAuthenticated, token, apiBaseUrl, profileAvatar]);

  // Handle hover with delay for better UX - Notifications
  const handleMouseEnter = () => {
    if (closeTimeoutRef.current) {
      clearTimeout(closeTimeoutRef.current);
      closeTimeoutRef.current = null;
    }
    setNotificationOpen(true);
  };

  const handleMouseLeave = () => {
    closeTimeoutRef.current = setTimeout(() => {
      setNotificationOpen(false);
    }, 150); // 150ms delay before closing
  };

  // Handle hover with delay for better UX - Profile
  const handleProfileMouseEnter = () => {
    if (profileCloseTimeoutRef.current) {
      clearTimeout(profileCloseTimeoutRef.current);
      profileCloseTimeoutRef.current = null;
    }
    setProfileOpen(true);
  };

  const handleProfileMouseLeave = () => {
    profileCloseTimeoutRef.current = setTimeout(() => {
      setProfileOpen(false);
    }, 150); // 150ms delay before closing
  };

  // Copy wallet address to clipboard
  const handleCopyAddress = useCallback(async () => {
    if (publicKey) {
      try {
        await navigator.clipboard.writeText(publicKey.toString());
        setCopySuccess(true);
        setTimeout(() => setCopySuccess(false), 2000);
      } catch (err) {
        console.error("Failed to copy address:", err);
      }
    }
  }, [publicKey]);

  // Handle change wallet
  const handleChangeWallet = useCallback(() => {
    setProfileOpen(false);
    setVisible(true);
  }, [setVisible]);

  // Handle connect wallet (open wallet modal)
  const handleConnectWallet = useCallback(() => {
    setVisible(true);
  }, [setVisible]);

  // Handle sign in
  const handleSignIn = useCallback(async () => {
    setSigningIn(true);
    try {
      await signIn();
    } catch (err) {
      console.error("Failed to sign in:", err);
    } finally {
      setSigningIn(false);
    }
  }, [signIn]);

  // Handle disconnect (signs out AND disconnects wallet - merged action)
  const handleDisconnect = useCallback(async () => {
    setProfileOpen(false);
    sessionStorage.removeItem("profile_avatar"); // Clear avatar cache
    avatarFetched.current = false;
    try {
      await signOutAndDisconnect();
    } catch (err) {
      console.error("Failed to disconnect:", err);
    }
  }, [signOutAndDisconnect]);

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (closeTimeoutRef.current) {
        clearTimeout(closeTimeoutRef.current);
      }
      if (profileCloseTimeoutRef.current) {
        clearTimeout(profileCloseTimeoutRef.current);
      }
    };
  }, []);

  const navItems = [
    { href: "/", label: "Markets", active: router.pathname === "/" },
    {
      href: "/leaderboard",
      label: "Leaderboard",
      active: router.pathname === "/leaderboard",
    },
    {
      href: "/competitions",
      label: "Competitions",
      active: router.pathname === "/competitions",
    },
    { href: "/earn", label: "Earn", active: router.pathname === "/earn" },
    { href: "/faucet", label: "Faucet", active: router.pathname === "/faucet" },
  ];

  const howToTradeItems: { icon: ReactNode; label: string; slug: string }[] = [
    {
      slug: "how-to-buy",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 3h1.386c.51 0 .955.343 1.087.835l.383 1.437M7.5 14.25a3 3 0 00-3 3h15.75m-12.75-3h11.218c1.121-2.3 2.1-4.684 2.924-7.138a60.114 60.114 0 00-16.536-1.84M7.5 14.25L5.106 5.272M6 20.25a.75.75 0 11-1.5 0 .75.75 0 011.5 0zm12.75 0a.75.75 0 11-1.5 0 .75.75 0 011.5 0z" />
        </svg>
      ),
      label: "How to buy",
    },
    {
      slug: "how-to-buy-with-leverage",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M2.25 18L9 11.25l4.306 4.307a11.95 11.95 0 015.814-5.519l2.74-1.22m0 0l-5.94-2.28m5.94 2.28l-2.28 5.941" />
        </svg>
      ),
      label: "How to buy with leverage",
    },
    {
      slug: "how-to-place-a-limit-order",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h3.75M9 15h3.75M9 18h3.75m3 .75H18a2.25 2.25 0 002.25-2.25V6.108c0-1.135-.845-2.098-1.976-2.192a48.424 48.424 0 00-1.123-.08m-5.801 0c-.065.21-.1.433-.1.664 0 .414.336.75.75.75h4.5a.75.75 0 00.75-.75 2.25 2.25 0 00-.1-.664m-5.8 0A2.251 2.251 0 0113.5 2.25H15a2.25 2.25 0 012.15 1.586m-5.8 0c-.376.023-.75.05-1.124.08C9.095 4.01 8.25 4.973 8.25 6.108V8.25m0 0H4.875c-.621 0-1.125.504-1.125 1.125v11.25c0 .621.504 1.125 1.125 1.125h9.75c.621 0 1.125-.504 1.125-1.125V9.375c0-.621-.504-1.125-1.125-1.125H8.25zM6.75 12h.008v.008H6.75V12zm0 3h.008v.008H6.75V15zm0 3h.008v.008H6.75V18z" />
        </svg>
      ),
      label: "How to place a limit order",
    },
    {
      slug: "order-book-explained",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6.042A8.967 8.967 0 006 3.75c-1.052 0-2.062.18-3 .512v14.25A8.987 8.987 0 016 18c2.305 0 4.408.867 6 2.292m0-14.25a8.966 8.966 0 016-2.292c1.052 0 2.062.18 3 .512v14.25A8.987 8.987 0 0018 18a8.967 8.967 0 00-6 2.292m0-14.25v14.25" />
        </svg>
      ),
      label: "Order book explained",
    },
    {
      slug: "how-to-sell",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 6v12m-3-2.818l.879.659c1.171.879 3.07.879 4.242 0 1.172-.879 1.172-2.303 0-3.182C13.536 12.219 12.768 12 12 12c-.725 0-1.45-.22-2.003-.659-1.106-.879-1.106-2.303 0-3.182s2.9-.879 4.006 0l.415.33M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
      ),
      label: "How to sell",
    },
    {
      slug: "why-my-order-did-not-fill",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9.879 7.519c1.171-1.025 3.071-1.025 4.242 0 1.172 1.025 1.172 2.687 0 3.712-.203.179-.43.326-.67.442-.745.361-1.45.999-1.45 1.827v.75M21 12a9 9 0 11-18 0 9 9 0 0118 0zm-9 5.25h.008v.008H12v-.008z" />
        </svg>
      ),
      label: "Why my order did not fill",
    },
    {
      slug: "market-order-vs-limit-order",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M12 3v17.25m0 0c-1.472 0-2.882.265-4.185.75M12 20.25c1.472 0 2.882.265 4.185.75M18.75 4.97A48.416 48.416 0 0012 4.5c-2.291 0-4.545.16-6.75.47m13.5 0c1.01.143 2.01.317 3 .52m-3-.52l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.988 5.988 0 01-2.031.352 5.988 5.988 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L18.75 4.971zm-16.5.52c.99-.203 1.99-.377 3-.52m0 0l2.62 10.726c.122.499-.106 1.028-.589 1.202a5.989 5.989 0 01-2.031.352 5.989 5.989 0 01-2.031-.352c-.483-.174-.711-.703-.59-1.202L5.25 4.971z" />
        </svg>
      ),
      label: "Market order vs Limit order",
    },
    {
      slug: "win-loss-after-market-resolution",
      icon: (
        <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1.5}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M16.5 18.75h-9m9 0a3 3 0 013 3h-15a3 3 0 013-3m9 0v-3.375c0-.621-.503-1.125-1.125-1.125h-.871M7.5 18.75v-3.375c0-.621.504-1.125 1.125-1.125h.872m5.007 0H9.497m5.007 0a7.454 7.454 0 01-.982-3.172M9.497 14.25a7.454 7.454 0 00.981-3.172M5.25 4.236c-.982.143-1.954.317-2.916.52A6.003 6.003 0 007.73 9.728M5.25 4.236V4.5c0 2.108.966 3.99 2.48 5.228M5.25 4.236V2.721C7.456 2.41 9.71 2.25 12 2.25c2.291 0 4.545.16 6.75.47v1.516M18.75 4.236c.982.143 1.954.317 2.916.52A6.003 6.003 0 0016.27 9.728M18.75 4.236V4.5c0 2.108-.966 3.99-2.48 5.228m0 0a6.003 6.003 0 01-5.54 0" />
        </svg>
      ),
      label: "Win/loss after market resolution",
    },
  ];

  // Check if user is admin (in production, verify against on-chain admin list)
  const isAdmin = isAdminWallet(connected, publicKey);

  // Get SpacePoints data
  const { pointsInfo } = useSpacePoints();

  // Get portfolio value dynamically
  const { portfolioValue: portfolioValueNumber, loading: portfolioLoading } =
    usePortfolioValue();

  // Get notifications
  const {
    notifications,
    unreadCount,
    markAsRead,
    markAllAsRead,
    fetchNotifications,
    addNotification,
  } = useNotifications(10);

  // Handle real-time notifications via WebSocket
  useNotificationsWebSocket((notification) => {
    if (notification) {
      console.log("[Layout] WebSocket notification received:", {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        read: notification.read,
        createdAt: notification.createdAt,
      });

      // Ensure notification has all required fields
      const fullNotification: Notification = {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        message: notification.message || "",
        data: notification.data || {},
        priority: notification.priority || "normal",
        read: notification.read || false,
        createdAt: notification.createdAt,
      };

      // Add notification immediately to the list
      addNotification(fullNotification);

      // Don't fetch all notifications - it will overwrite with stale data
      // The notification is already added, just need to sync unread count
    } else {
      console.warn(
        "[Layout] WebSocket notification received but is null/undefined",
      );
    }
  });

  // User data from SpacePoints or defaults
  const portfolioValue =
    connected && !portfolioLoading
      ? `$${(portfolioValueNumber || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
      : connected && portfolioLoading
        ? "..."
        : "$0";
  const points = pointsInfo ? pointsInfo.totalPoints.toLocaleString() : "0";
  const rank = pointsInfo
    ? pointsInfo.level.charAt(0).toUpperCase() + pointsInfo.level.slice(1)
    : "Iron";
  const levelColors = pointsInfo
    ? LEVEL_COLORS[pointsInfo.level]
    : LEVEL_COLORS.iron;
  const levelIcon = pointsInfo
    ? LEVEL_ICONS[pointsInfo.level]
    : LEVEL_ICONS.iron;

  return (
    <>
      {/* Referral Modal for new users */}
      <ReferralModal />

      <div className="min-h-screen h-full lg:pb-0 pb-16 bg-space-dark text-white">
        {/* Header */}
        <header className="fixed top-0 left-0 right-0 z-50 bg-space-dark border-b border-space-gray-800">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
            <div className="flex items-center justify-between h-16">
              {/* Logo and Navigation */}
              <div className="flex items-center space-x-8">
                <Link href="/" className="flex items-center space-x-2">
                  <Image
                    src="/assets/space.svg"
                    alt="Logo"
                    width={1000}
                    height={1000}
                    className="h-7 w-auto"
                  />
                </Link>

                {/* Navigation */}
                <nav className="hidden md:flex items-center space-x-1">
                  {navItems.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className={`text-sm font-medium transition-colors px-3 py-2 rounded-lg ${
                        item.active
                          ? "text-white bg-[#262626]"
                          : "text-space-gray-400 hover:text-white"
                      }`}
                    >
                      {item.label}
                    </Link>
                  ))}

                  {/* How to trade dropdown */}
                  <div className="relative group">
                    <button className="text-sm font-medium transition-colors px-3 py-2 rounded-lg text-space-gray-400 hover:text-white whitespace-nowrap">
                      How to trade
                    </button>
                    <div className="absolute top-full left-0 pt-1 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all duration-200">
                      <div className="bg-[#1a1a1a] border border-[#2a2a2a] rounded-xl py-2 min-w-[280px] shadow-xl">
                        {howToTradeItems.map((item) => (
                          <Link
                            key={item.slug}
                            href={`/how-to-trade/${item.slug}`}
                            className="w-full text-left px-4 py-2.5 flex items-center gap-3 text-sm text-[#d4d4d4] hover:bg-[#262626] hover:text-white transition-colors"
                          >
                            {item.icon}
                            {item.label}
                          </Link>
                        ))}
                      </div>
                    </div>
                  </div>
                </nav>
              </div>

              {/* Right Side - Search, Stats, Actions */}
              <div className="flex items-center space-x-4">
                {/* User Stats - Only show for authenticated users */}
                {connected && isAuthenticated && (
                  <div className="hidden xl:flex items-center text-sm">
                    <Link
                      href="/portfolio"
                      className="hover:opacity-80 transition-opacity flex flex-col items-end border-r border-space-gray-400/20 pr-4 pl-3"
                    >
                      <span className="text-space-gray-400 text-xs font-[500]">
                        PORTFOLIO{" "}
                      </span>
                      <span className="text-space-success font-[500] text-base">
                        {portfolioValue}
                      </span>
                    </Link>

                    <div className="flex flex-col items-end border-r border-space-gray-400/20 pr-4 pl-3">
                      <span className="text-space-gray-400 text-xs font-[500]">
                        POINTS{" "}
                      </span>
                      <span className="text-white font-[500] text-base">
                        {points}
                      </span>
                    </div>

                    <div className="flex items-center gap-2 border-r border-space-gray-400/20 pr-4 pl-3">
                      <div className="flex flex-col items-end">
                        <span className="text-space-gray-400 text-xs font-[500]">
                          RANK{" "}
                        </span>
                        <span
                          className={`${levelColors.text} font-[500] text-base`}
                        >
                          {rank}
                        </span>
                      </div>
                      {pointsInfo && (
                        <Image
                          src={levelIcon}
                          alt={`${rank} Rank`}
                          width={1000}
                          height={1000}
                          className="h-10 w-auto rounded-md"
                        />
                      )}
                    </div>
                  </div>
                )}

                {/* Notifications - Only show for authenticated users */}
                {connected && isAuthenticated && (
                  <div
                    className="relative"
                    ref={notificationRef}
                    onMouseEnter={handleMouseEnter}
                    onMouseLeave={handleMouseLeave}
                  >
                    <button className="relative p-2 text-space-gray-400 hover:text-white transition-colors bg-[#191919] rounded-lg h-10 w-10 flex items-center justify-center">
                      <Image
                        src="/assets/notification.svg"
                        alt="Notification"
                        width={1000}
                        height={1000}
                        className="h-5 w-auto"
                      />
                      {unreadCount > 0 && (
                        <span className="absolute -top-1 -right-1 text-xs h-4 w-4 flex items-center justify-center rounded-full bg-gradient-to-b from-[#ED4228CC] to-[#ED4228] font-medium text-white">
                          {unreadCount > 99 ? "99+" : unreadCount}
                        </span>
                      )}
                    </button>

                    {/* Hover Bridge - invisible element to bridge gap between button and dropdown */}
                    <div className="absolute top-full left-0 right-0 h-3"></div>

                    {/* Notification Dropdown */}
                    <div
                      className={`absolute right-0 top-full pt-1 w-80 z-50 transition-all duration-200 ease-out origin-top-right ${
                        notificationOpen
                          ? "opacity-100 scale-100 translate-y-0 shadow-2xl"
                          : "opacity-0 scale-95 -translate-y-2 pointer-events-none"
                      }`}
                    >
                      {/* Pointer Arrow */}
                      <div
                        className={`absolute -top-1 right-4 w-4 h-4 bg-[#1F1F1F] border-l border-t border-space-gray-800 transform rotate-45 transition-all duration-200 ${
                          notificationOpen ? "opacity-100" : "opacity-0"
                        }`}
                      ></div>

                      {/* Dropdown Content */}
                      <div className="bg-[#1F1F1F] border border-space-gray-800 rounded-xl shadow-xl overflow-hidden">
                        {/* Header */}
                        <div className="px-4 py-3 border-b border-space-gray-800 flex items-center justify-between">
                          <h3 className="text-sm font-semibold text-white">
                            Notifications
                          </h3>
                          {unreadCount > 0 && (
                            <button
                              onClick={markAllAsRead}
                              className="text-xs text-space-gray-400 hover:text-white transition-colors"
                            >
                              Mark all as read
                            </button>
                          )}
                        </div>

                        {/* Notifications List */}
                        <div className="max-h-80 overflow-y-auto">
                          {notifications.length === 0 ? (
                            <div className="px-4 py-8 text-center">
                              <p className="text-sm text-space-gray-400">
                                No notifications
                              </p>
                            </div>
                          ) : (
                            notifications.map((notification) => (
                              <div
                                key={notification.id}
                                onClick={() => {
                                  if (!notification.read) {
                                    markAsRead(notification.id);
                                  }
                                }}
                                className={`px-4 py-3 hover:bg-[#262626] transition-colors cursor-pointer ${
                                  !notification.read
                                    ? "border-l-2 border-white bg-white/5"
                                    : "border-l-2 border-transparent"
                                }`}
                              >
                                <div className="flex items-start gap-3">
                                  <div className="w-9 h-9 rounded-full bg-space-gray-800 flex items-center justify-center flex-shrink-0">
                                    {getNotificationIcon(notification.type)}
                                  </div>
                                  <div className="flex-1 min-w-0">
                                    <p className="text-sm text-white font-medium">
                                      {notification.title}
                                    </p>
                                    <p className="text-xs text-space-gray-400 mt-0.5 line-clamp-2">
                                      {formatNotificationMessage(notification)}
                                    </p>
                                    <p className="text-xs text-space-gray-500 mt-1">
                                      {formatTimeAgo(notification.createdAt)}
                                    </p>
                                  </div>
                                  {!notification.read && (
                                    <div className="w-2 h-2 rounded-full bg-white flex-shrink-0 mt-1.5"></div>
                                  )}
                                </div>
                              </div>
                            ))
                          )}
                        </div>

                        {/* Footer */}
                        <div className="px-4 py-3 border-t border-space-gray-800 bg-[#191919]">
                          <Link
                            href="/notifications"
                            className="text-xs text-space-gray-400 hover:text-white transition-colors font-medium flex items-center justify-center gap-1"
                            onClick={() => setNotificationOpen(false)}
                          >
                            View all notifications
                            <svg
                              className="w-3 h-3"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M9 5l7 7-7 7"
                              />
                            </svg>
                          </Link>
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Deposit Button - Only show for authenticated users */}
                {connected && isAuthenticated && (
                  <div className="relative group hidden md:block">
                    <button className="px-4 py-2 bg-white hover:bg-space-gray-100 text-black text-sm font-semibold rounded-lg transition-colors">
                      Deposit
                    </button>

                    {/* Tooltip */}
                    <div className="absolute -bottom-8 left-1/2 -translate-x-1/2 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none bg-[#1a1a1a] border border-[#262626] text-xs text-gray-300 px-2 py-1 rounded z-20">
                      Coming soon
                    </div>
                  </div>
                )}

                {/* Wallet Button - Show when NOT connected */}
                {!connected && (
                  <button
                    onClick={handleConnectWallet}
                    className="px-4 py-2 bg-white hover:bg-space-gray-100 text-black text-sm font-semibold rounded-lg transition-colors flex items-center gap-2"
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M13.828 10.172a4 4 0 00-5.656 0l-4 4a4 4 0 105.656 5.656l1.102-1.101m-.758-4.899a4 4 0 005.656 0l4-4a4 4 0 00-5.656-5.656l-1.1 1.1"
                      />
                    </svg>
                    <span>Connect Wallet</span>
                  </button>
                )}

                {/* Sign In Button - Show when connected but NOT authenticated (or token expired) */}
                {connected && !isAuthenticated && !authLoading && (
                  <button
                    onClick={handleSignIn}
                    disabled={signingIn}
                    className={`px-4 py-2 bg-white hover:bg-space-gray-100 disabled:opacity-50 disabled:cursor-not-allowed text-black text-sm font-semibold rounded-lg transition-colors flex items-center gap-2 ${tokenExpired ? "border border-amber-300/40" : ""}`}
                  >
                    {signingIn ? (
                      <>
                        <svg
                          className="w-4 h-4 animate-spin"
                          fill="none"
                          viewBox="0 0 24 24"
                        >
                          <circle
                            className="opacity-25"
                            cx="12"
                            cy="12"
                            r="10"
                            stroke="currentColor"
                            strokeWidth="4"
                          ></circle>
                          <path
                            className="opacity-75"
                            fill="currentColor"
                            d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                          ></path>
                        </svg>
                        <span>Signing In...</span>
                      </>
                    ) : tokenExpired ? (
                      <>
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"
                          />
                        </svg>
                        <span>Session Expired</span>
                      </>
                    ) : (
                      <>
                        <svg
                          className="w-4 h-4"
                          fill="none"
                          viewBox="0 0 24 24"
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            strokeWidth={2}
                            d="M11 16l-4-4m0 0l4-4m-4 4h14m-5 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h7a3 3 0 013 3v1"
                          />
                        </svg>
                        <span>Sign In</span>
                      </>
                    )}
                  </button>
                )}

                {/* Auth Error Toast */}
                {authError && (
                  <div className="absolute top-16 right-4 bg-red-500/90 text-white text-sm px-4 py-2 rounded-lg shadow-lg z-50 animate-pulse">
                    {authError}
                  </div>
                )}

                {/* Profile Avatar with Dropdown - Show when authenticated */}
                {connected && isAuthenticated && (
                  <div
                    className="relative"
                    ref={profileRef}
                    onMouseEnter={handleProfileMouseEnter}
                    onMouseLeave={handleProfileMouseLeave}
                  >
                    <button className="w-10 h-10 rounded-md bg-space-gray-100 hover:bg-space-gray-200 transition-colors flex items-center justify-center overflow-hidden">
                      {profileAvatar ? (
                        <Image
                          src={profileAvatar}
                          alt="Profile"
                          width={40}
                          height={40}
                          className="w-full h-full object-cover"
                        />
                      ) : (
                        <span className="text-sm font-semibold text-black">
                          {publicKey?.toString().charAt(0).toUpperCase() || "A"}
                        </span>
                      )}
                    </button>

                    {/* Hover Bridge */}
                    <div className="absolute top-full left-0 right-0 h-3"></div>

                    {/* Profile Dropdown */}
                    <div
                      className={`absolute right-0 top-full pt-1 w-56 z-50 transition-all duration-200 ease-out origin-top-right ${
                        profileOpen
                          ? "opacity-100 scale-100 translate-y-0 shadow-2xl"
                          : "opacity-0 scale-95 -translate-y-2 pointer-events-none"
                      }`}
                    >
                      {/* Pointer Arrow */}
                      <div
                        className={`absolute -top-1 right-4 w-4 h-4 bg-[#1F1F1F] border-l border-t border-space-gray-800 transform rotate-45 transition-all duration-200 ${
                          profileOpen ? "opacity-100" : "opacity-0"
                        }`}
                      ></div>

                      {/* Dropdown Content */}
                      <div className="bg-[#1F1F1F] border border-space-gray-800 rounded-xl shadow-xl overflow-hidden">
                        {/* Wallet Address Header */}
                        <div className="px-4 py-3 border-b border-space-gray-800">
                          <div className="flex items-center justify-between mb-1">
                            <p className="text-xs text-space-gray-400">
                              Connected Wallet
                            </p>
                          </div>
                          <p className="text-sm text-white font-mono truncate">
                            {publicKey?.toString().slice(0, 4)}...
                            {publicKey?.toString().slice(-4)}
                          </p>
                        </div>

                        {/* Menu Items */}
                        <div className="py-1">
                          {/* Your Profile */}
                          <Link
                            href="/profile"
                            className="flex items-center gap-3 px-4 py-2.5 text-sm text-space-gray-300 hover:text-white hover:bg-[#262626] transition-colors"
                            onClick={() => setProfileOpen(false)}
                          >
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                              />
                            </svg>
                            <span>Your Profile</span>
                          </Link>

                          {/* Copy Address */}
                          <button
                            onClick={handleCopyAddress}
                            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-space-gray-300 hover:text-white hover:bg-[#262626] transition-colors"
                          >
                            {copySuccess ? (
                              <>
                                <svg
                                  className="w-4 h-4 text-space-success"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M5 13l4 4L19 7"
                                  />
                                </svg>
                                <span className="text-space-success">
                                  Copied!
                                </span>
                              </>
                            ) : (
                              <>
                                <svg
                                  className="w-4 h-4"
                                  fill="none"
                                  viewBox="0 0 24 24"
                                  stroke="currentColor"
                                >
                                  <path
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth={2}
                                    d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"
                                  />
                                </svg>
                                <span>Copy Address</span>
                              </>
                            )}
                          </button>

                          {/* Change Wallet */}
                          <button
                            onClick={handleChangeWallet}
                            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-space-gray-300 hover:text-white hover:bg-[#262626] transition-colors"
                          >
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M8 7h12m0 0l-4-4m4 4l-4 4m0 6H4m0 0l4 4m-4-4l4-4"
                              />
                            </svg>
                            <span>Change Wallet</span>
                          </button>
                        </div>

                        {/* Disconnect (signs out and disconnects wallet) */}
                        <div className="border-t border-space-gray-800 py-1">
                          <button
                            onClick={handleDisconnect}
                            className="w-full flex items-center gap-3 px-4 py-2.5 text-sm text-red-400 hover:text-red-300 hover:bg-[#262626] transition-colors"
                          >
                            <svg
                              className="w-4 h-4"
                              fill="none"
                              viewBox="0 0 24 24"
                              stroke="currentColor"
                            >
                              <path
                                strokeLinecap="round"
                                strokeLinejoin="round"
                                strokeWidth={2}
                                d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1"
                              />
                            </svg>
                            <span>Disconnect</span>
                          </button>
                        </div>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        </header>

        {/* Main Content */}
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 pb-6 pt-20">
          {children}
        </main>

        {/* Mobile Bottom Navigation */}
        <nav className="fixed bottom-0 left-0 right-0 bg-space-gray-800 border-t border-space-gray-700 md:hidden z-50">
          <div className="flex items-center justify-around h-16">
            <Link
              href="/"
              className={`flex flex-col items-center justify-center flex-1 py-2 ${
                router.pathname === "/"
                  ? "text-white"
                  : "text-space-gray-400"
              }`}
            >
              <svg
                className="w-6 h-6 mb-1"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
              <span className="text-xs font-medium">Markets</span>
            </Link>
            <Link
              href="/portfolio"
              className={`flex flex-col items-center justify-center flex-1 py-2 ${
                router.pathname === "/portfolio"
                  ? "text-white"
                  : "text-space-gray-400"
              }`}
            >
              <svg
                className="w-6 h-6 mb-1"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M21 13.255A23.931 23.931 0 0112 15c-3.183 0-6.22-.62-9-1.745M16 6V4a2 2 0 00-2-2h-4a2 2 0 00-2 2v2m4 6h.01M5 20h14a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
                />
              </svg>
              <span className="text-xs font-medium">Portfolio</span>
            </Link>
            <Link
              href="/leaderboard"
              className={`flex flex-col items-center justify-center flex-1 py-2 ${
                router.pathname === "/leaderboard"
                  ? "text-white"
                  : "text-space-gray-400"
              }`}
            >
              <svg
                className="w-6 h-6 mb-1"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M9 19v-6a2 2 0 00-2-2H5a2 2 0 00-2 2v6a2 2 0 002 2h2a2 2 0 002-2zm0 0V9a2 2 0 012-2h2a2 2 0 012 2v10m-6 0a2 2 0 002 2h2a2 2 0 002-2m0 0V5a2 2 0 012-2h2a2 2 0 012 2v14a2 2 0 01-2 2h-2a2 2 0 01-2-2z"
                />
              </svg>
              <span className="text-xs font-medium">Leaderboard</span>
            </Link>
            <Link
              href="/profile"
              className={`flex flex-col items-center justify-center flex-1 py-2 ${
                router.pathname === "/profile"
                  ? "text-white"
                  : "text-space-gray-400"
              }`}
            >
              <svg
                className="w-6 h-6 mb-1"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M16 7a4 4 0 11-8 0 4 4 0 018 0zM12 14a7 7 0 00-7 7h14a7 7 0 00-7-7z"
                />
              </svg>
              <span className="text-xs font-medium">Profile</span>
            </Link>
          </div>
        </nav>
      </div>
    </>
  );
}
