import Head from 'next/head';
import { Layout } from '@/components/Layout';
import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useWallet } from '@solana/wallet-adapter-react';
import { formatTimeAgo, getNotificationIcon, formatNotificationMessage } from '@/utils/notificationUtils';
import { Notification } from '@/hooks/useNotifications';
import { formatNumber } from '@/types/formateNumbers';

// Helper function to format size numbers (converts lamports to shares)
// Shares are stored in lamports (1,000,000 lamports = 1 share)
function formatSize(num: number | string): string {
  const n = typeof num === 'string' ? parseFloat(num.replace(/,/g, '')) : num;
  if (isNaN(n)) return String(num);
  
  // Convert lamports to shares (divide by 1,000,000)
  const shares = n / 1000000;
  
  // Format with up to 3 decimal places, removing trailing zeros
  return shares.toLocaleString('en-US', { 
    maximumFractionDigits: 3,
    minimumFractionDigits: 0
  });
}

const ITEMS_PER_PAGE = 20;

export default function NotificationsPage() {
  const { isAuthenticated, token, user } = useAuth();
  const { publicKey } = useWallet();
  const userId = user?.walletAddress || publicKey?.toString();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [unreadCount, setUnreadCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);
  const [filter, setFilter] = useState<'all' | 'unread' | 'trade_buy' | 'trade_sell' | 'order_filled'>('all');

  const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

  const fetchNotifications = useCallback(async (page: number = 1, filterType: string = 'all') => {
    if (!isAuthenticated || !userId) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const offset = (page - 1) * ITEMS_PER_PAGE;
      const limit = ITEMS_PER_PAGE;
      const unreadOnly = filterType === 'unread';
      const type = filterType !== 'all' && filterType !== 'unread' ? filterType : undefined;

      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const queryParams = new URLSearchParams({
        userId: userId,
        limit: limit.toString(),
        offset: offset.toString(),
        ...(unreadOnly && { unreadOnly: 'true' }),
        ...(type && { type }),
      });

      const response = await fetch(`${apiBaseUrl}/api/notifications?${queryParams}`, {
        headers,
      });

      if (!response.ok) {
        throw new Error('Failed to fetch notifications');
      }

      const data = await response.json();
      setNotifications(data.notifications || []);
      setUnreadCount(data.unreadCount || 0);
      setTotal(data.pagination?.total || 0);
      setTotalPages(Math.ceil((data.pagination?.total || 0) / ITEMS_PER_PAGE));
    } catch (err: any) {
      console.error('Error fetching notifications:', err);
      setError(err.message || 'Failed to fetch notifications');
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, userId, token, apiBaseUrl]);

  const markAsRead = async (id: string) => {
    if (!isAuthenticated || !userId) return;

    try {
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${apiBaseUrl}/api/notifications/${id}/read`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ userId }),
      });

      if (response.ok) {
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, read: true, readAt: new Date().toISOString() } : n))
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }
    } catch (err) {
      console.error('Error marking notification as read:', err);
    }
  };

  const markAllAsRead = async () => {
    if (!isAuthenticated || !userId) return;

    try {
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${apiBaseUrl}/api/notifications/read-all`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ userId }),
      });

      if (response.ok) {
        setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
        setUnreadCount(0);
      }
    } catch (err) {
      console.error('Error marking all as read:', err);
    }
  };

  const deleteNotification = async (id: string) => {
    if (!isAuthenticated || !userId) return;

    try {
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${apiBaseUrl}/api/notifications/${id}`, {
        method: 'DELETE',
        headers,
        body: JSON.stringify({ userId }),
      });

      if (response.ok) {
        setNotifications((prev) => prev.filter((n) => n.id !== id));
        setTotal((prev) => Math.max(0, prev - 1));
      }
    } catch (err) {
      console.error('Error deleting notification:', err);
    }
  };

  useEffect(() => {
    fetchNotifications(currentPage, filter);
  }, [currentPage, filter, fetchNotifications]);

  if (!isAuthenticated) {
    return (
      <Layout>
        <div className="min-h-screen bg-[#0A0A0A] flex items-center justify-center">
          <div className="text-center">
            <h1 className="text-2xl font-bold text-white mb-4">Please connect your wallet</h1>
            <p className="text-space-gray-400">You need to be logged in to view notifications</p>
          </div>
        </div>
      </Layout>
    );
  }

  return (
    <Layout>
      <Head>
        <title>Notifications - Space Prediction</title>
      </Head>

      <div className="min-h-screen py-8">
        <div className="max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
          {/* Header */}
          <div className="mb-6">
            <div className="flex items-start justify-between gap-3 mb-4">
              <div className="min-w-0">
                <h1 className="text-2xl sm:text-3xl font-bold text-white mb-1 sm:mb-2">Notifications</h1>
                <p className="text-sm sm:text-base text-space-gray-400">
                  {total > 0 ? (
                    <>
                      {total} {total === 1 ? 'notification' : 'notifications'}
                      {unreadCount > 0 && (
                        <span className="ml-2 text-white font-medium">
                          ({unreadCount} unread)
                        </span>
                      )}
                    </>
                  ) : (
                    'No notifications'
                  )}
                </p>
              </div>
              {unreadCount > 0 && (
                <button
                  onClick={markAllAsRead}
                  className="px-3 sm:px-4 py-1.5 sm:py-2 bg-space-gray-800 hover:bg-space-gray-700 text-white text-xs sm:text-sm font-medium rounded-lg transition-colors whitespace-nowrap flex-shrink-0"
                >
                  Mark all as read
                </button>
              )}
            </div>

            {/* Filters */}
            <div className="flex flex-wrap gap-2 mt-4">
              <button
                onClick={() => {
                  setFilter('all');
                  setCurrentPage(1);
                }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filter === 'all'
                    ? 'bg-white text-[#0A0A0A]'
                    : 'bg-space-gray-800 text-space-gray-300 hover:bg-space-gray-700'
                }`}
              >
                All
              </button>
              <button
                onClick={() => {
                  setFilter('unread');
                  setCurrentPage(1);
                }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filter === 'unread'
                    ? 'bg-white text-[#0A0A0A]'
                    : 'bg-space-gray-800 text-space-gray-300 hover:bg-space-gray-700'
                }`}
              >
                Unread {unreadCount > 0 && `(${unreadCount})`}
              </button>
              <button
                onClick={() => {
                  setFilter('trade_buy');
                  setCurrentPage(1);
                }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filter === 'trade_buy'
                    ? 'bg-white text-[#0A0A0A]'
                    : 'bg-space-gray-800 text-space-gray-300 hover:bg-space-gray-700'
                }`}
              >
                Buy Orders
              </button>
              <button
                onClick={() => {
                  setFilter('trade_sell');
                  setCurrentPage(1);
                }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filter === 'trade_sell'
                    ? 'bg-white text-[#0A0A0A]'
                    : 'bg-space-gray-800 text-space-gray-300 hover:bg-space-gray-700'
                }`}
              >
                Sell Orders
              </button>
              <button
                onClick={() => {
                  setFilter('order_filled');
                  setCurrentPage(1);
                }}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  filter === 'order_filled'
                    ? 'bg-white text-[#0A0A0A]'
                    : 'bg-space-gray-800 text-space-gray-300 hover:bg-space-gray-700'
                }`}
              >
                Filled Orders
              </button>
            </div>
          </div>

          {/* Notifications List */}
          {loading ? (
            <div className="bg-[#1F1F1F] border border-space-gray-800 rounded-xl p-8 text-center">
              <p className="text-space-gray-400">Loading notifications...</p>
            </div>
          ) : error ? (
            <div className="bg-[#1F1F1F] border border-space-gray-800 rounded-xl p-8 text-center">
              <p className="text-red-400">{error}</p>
              <button
                onClick={() => fetchNotifications(currentPage, filter)}
                className="mt-4 px-4 py-2 bg-white text-[#0A0A0A] rounded-lg font-medium hover:bg-space-gray-200 transition-colors"
              >
                Retry
              </button>
            </div>
          ) : notifications.length === 0 ? (
            <div className="bg-[#1F1F1F] border border-space-gray-800 rounded-xl p-12 text-center">
              <div className="text-space-gray-400 mb-4">
                <svg className="w-16 h-16 mx-auto mb-4 opacity-50" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 17h5l-1.405-1.405A2.032 2.032 0 0118 14.158V11a6.002 6.002 0 00-4-5.659V5a2 2 0 10-4 0v.341C7.67 6.165 6 8.388 6 11v3.159c0 .538-.21 1.055-.595 1.436L4 17h5m6 0v1a3 3 0 11-6 0v-1m6 0H9" />
                </svg>
                <p className="text-lg font-medium text-white mb-2">No notifications</p>
                <p className="text-sm">
                  {filter === 'unread'
                    ? "You're all caught up! No unread notifications."
                    : filter !== 'all'
                    ? `No ${filter.replace('_', ' ')} notifications found.`
                    : "You don't have any notifications yet."}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              {notifications.map((notification) => (
                <div
                  key={notification.id}
                  className={`bg-[#1F1F1F] border rounded-xl p-3 sm:p-4 transition-all hover:border-space-gray-600 ${
                    notification.read
                      ? 'border-space-gray-800'
                      : 'border-space-gray-700 bg-[#252525]'
                  }`}
                >
                  <div className="flex items-start gap-3 sm:gap-4">
                    {/* Icon */}
                    <div className="flex-shrink-0 mt-1">
                      {getNotificationIcon(notification.type)}
                    </div>

                    {/* Content */}
                    <div className="flex-1 min-w-0 overflow-hidden">
                      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-2 sm:gap-4 mb-2">
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center flex-wrap gap-2 mb-1">
                            <h3 className="text-sm sm:text-base font-semibold text-white break-words">
                              {notification.title}
                            </h3>
                            {!notification.read && (
                              <span className="w-2 h-2 rounded-full bg-white flex-shrink-0"></span>
                            )}
                            <span
                              className={`px-2 py-0.5 rounded text-xs font-medium flex-shrink-0 ${
                                notification.priority === 'urgent'
                                  ? 'bg-red-500/20 text-red-400'
                                  : notification.priority === 'high'
                                  ? 'bg-orange-500/20 text-orange-400'
                                  : notification.priority === 'normal'
                                  ? 'bg-blue-500/20 text-blue-400'
                                  : 'bg-space-gray-700 text-space-gray-400'
                              }`}
                            >
                              {notification.priority}
                            </span>
                          </div>
                          <p className="text-xs sm:text-sm text-space-gray-300 mb-2 break-words">
                            {formatNotificationMessage(notification)}
                          </p>
                          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-space-gray-500">
                            <span className="flex-shrink-0">{formatTimeAgo(notification.createdAt)}</span>
                            {notification.data?.marketTitle && (
                              <span className="text-space-gray-600 hidden sm:inline">•</span>
                            )}
                            {notification.data?.marketTitle && (
                              <span className="truncate max-w-[200px] sm:max-w-xs">
                                Market: {notification.data.marketTitle}
                              </span>
                            )}
                            {notification.data?.orderId && (
                              <>
                                <span className="text-space-gray-600 hidden sm:inline">•</span>
                                <span className="font-mono text-space-gray-400">
                                  Order: {notification.data.orderId.slice(0, 8)}...
                                </span>
                              </>
                            )}
                          </div>
                        </div>

                        {/* Actions */}
                        <div className="flex items-center gap-2 flex-shrink-0">
                          {!notification.read && (
                            <button
                              onClick={() => markAsRead(notification.id)}
                              className="px-3 py-1.5 text-xs font-medium text-space-gray-400 hover:text-white bg-space-gray-800 hover:bg-space-gray-700 rounded-lg transition-colors"
                              title="Mark as read"
                            >
                              Mark read
                            </button>
                          )}
                          <button
                            onClick={() => deleteNotification(notification.id)}
                            className="p-1.5 text-space-gray-500 hover:text-red-400 transition-colors"
                            title="Delete"
                          >
                            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                            </svg>
                          </button>
                        </div>
                      </div>

                      {/* Additional Details */}
                      {notification.data && Object.keys(notification.data).length > 0 && (
                        <div className="mt-3 pt-3 border-t border-space-gray-800">
                          <details className="group">
                            <summary className="cursor-pointer text-xs text-space-gray-400 hover:text-white transition-colors">
                              View details
                            </summary>
                            <div className="mt-2 p-3 bg-[#191919] rounded-lg">
                              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">
                                {notification.data.price !== undefined && (
                                  <div>
                                    <span className="text-space-gray-500">Price:</span>
                                    <span className="ml-2 text-white font-mono">
                                      {((notification.data.price || 0) / 100).toFixed(2)}¢
                                    </span>
                                  </div>
                                )}
                                {notification.data.size !== undefined && (
                                  <div>
                                    <span className="text-space-gray-500">Size:</span>
                                    <span className="ml-2 text-white font-mono">
                                      {formatSize(notification.data.size)}
                                    </span>
                                  </div>
                                )}
                                {notification.data.outcomeId !== undefined && (
                                  <div>
                                    <span className="text-space-gray-500">Outcome:</span>
                                    <span className="ml-2 text-white">
                                      {notification.data.outcomeLabel || `Outcome ${notification.data.outcomeId}`}
                                    </span>
                                  </div>
                                )}
                                {notification.data.side && (
                                  <div>
                                    <span className="text-space-gray-500">Side:</span>
                                    <span className="ml-2 text-white capitalize">
                                      {notification.data.side}
                                    </span>
                                  </div>
                                )}
                                {notification.data.tokenType && (
                                  <div>
                                    <span className="text-space-gray-500">Token Type:</span>
                                    <span className={`ml-2 font-medium ${
                                      notification.data.tokenType === 'yes' ? 'text-green-400' : 'text-red-400'
                                    }`}>
                                      {notification.data.tokenType.toUpperCase()}
                                    </span>
                                  </div>
                                )}
                                {notification.data.transactionHash && (
                                  <div className="col-span-2">
                                    <span className="text-space-gray-500">Transaction:</span>
                                    <span className="ml-2 text-white font-mono text-[10px] break-all">
                                      {notification.data.transactionHash}
                                    </span>
                                  </div>
                                )}
                              </div>
                            </div>
                          </details>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Pagination */}
          {totalPages > 1 && (
            <div className="mt-6 flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="text-xs sm:text-sm text-space-gray-400 text-center sm:text-left">
                Showing {(currentPage - 1) * ITEMS_PER_PAGE + 1} to{' '}
                {Math.min(currentPage * ITEMS_PER_PAGE, total)} of {total}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => setCurrentPage((prev) => Math.max(1, prev - 1))}
                  disabled={currentPage === 1}
                  className="px-3 sm:px-4 py-2 bg-space-gray-800 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-space-gray-700 transition-colors"
                >
                  Prev
                </button>
                <div className="flex items-center gap-1">
                  {Array.from({ length: Math.min(3, totalPages) }, (_, i) => {
                    let pageNum;
                    if (totalPages <= 3) {
                      pageNum = i + 1;
                    } else if (currentPage <= 2) {
                      pageNum = i + 1;
                    } else if (currentPage >= totalPages - 1) {
                      pageNum = totalPages - 2 + i;
                    } else {
                      pageNum = currentPage - 1 + i;
                    }
                    return (
                      <button
                        key={pageNum}
                        onClick={() => setCurrentPage(pageNum)}
                        className={`w-9 h-9 sm:w-10 sm:h-10 rounded-lg text-sm font-medium transition-colors ${
                          currentPage === pageNum
                            ? 'bg-white text-[#0A0A0A]'
                            : 'bg-space-gray-800 text-white hover:bg-space-gray-700'
                        }`}
                      >
                        {pageNum}
                      </button>
                    );
                  })}
                </div>
                <button
                  onClick={() => setCurrentPage((prev) => Math.min(totalPages, prev + 1))}
                  disabled={currentPage === totalPages}
                  className="px-3 sm:px-4 py-2 bg-space-gray-800 text-white rounded-lg text-sm font-medium disabled:opacity-50 disabled:cursor-not-allowed hover:bg-space-gray-700 transition-colors"
                >
                  Next
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </Layout>
  );
}

