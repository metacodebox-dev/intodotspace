import { useState, useEffect, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useWallet } from '@solana/wallet-adapter-react';

export interface Notification {
  id: string;
  type: string;
  title: string;
  message: string;
  data?: Record<string, any>;
  priority: string;
  read: boolean;
  readAt?: string;
  createdAt: string;
}

interface UseNotificationsReturn {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  error: string | null;
  fetchNotifications: () => Promise<void>;
  addNotification: (notification: Notification) => void;
  markAsRead: (id: string) => Promise<void>;
  markAllAsRead: () => Promise<void>;
  deleteNotification: (id: string) => Promise<void>;
}

export function useNotifications(limit: number = 10): UseNotificationsReturn {
  const { isAuthenticated, token } = useAuth();
  const { publicKey } = useWallet();
  const [notifications, setNotifications] = useState<Notification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  const userId = publicKey?.toString();

  const fetchNotifications = useCallback(async () => {
    if (!isAuthenticated || !userId) {
      setNotifications([]);
      setUnreadCount(0);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      // Fetch notifications
      const notificationsResponse = await fetch(
        `${apiBaseUrl}/api/notifications?userId=${userId}&limit=${limit}&unreadOnly=false`,
        { headers }
      );

      if (!notificationsResponse.ok) {
        throw new Error('Failed to fetch notifications');
      }

      const notificationsData = await notificationsResponse.json();
      const fetchedNotifications = notificationsData.notifications || [];
      
      console.log('[Notifications] Fetched from server:', {
        count: fetchedNotifications.length,
        unreadCount: notificationsData.unreadCount,
        notificationIds: fetchedNotifications.map((n: Notification) => n.id)
      });
      
      // Merge with existing notifications, avoiding duplicates
      setNotifications((prev) => {
        console.log('[Notifications] Merging - existing:', prev.length, 'fetched:', fetchedNotifications.length);
        
        const existingIds = new Set(prev.map(n => n.id));
        const newNotifications = fetchedNotifications.filter((n: Notification) => !existingIds.has(n.id));
        
        const fetchedIds = new Set(fetchedNotifications.map((n: Notification) => n.id));
        
        // Existing notifications that are still on server (update them)
        const existingOnServer = prev.filter(n => fetchedIds.has(n.id));
        
        // Existing notifications NOT on server (keep them - these are likely WebSocket notifications not yet synced)
        const existingNotOnServer = prev.filter(n => !fetchedIds.has(n.id));
        
        console.log('[Notifications] Merge breakdown:', {
          new: newNotifications.length,
          existingOnServer: existingOnServer.length,
          existingNotOnServer: existingNotOnServer.length
        });
        
        // Combine: new from server first, then existing (both on and not on server)
        const combined = [...newNotifications, ...existingOnServer, ...existingNotOnServer];
        
        // Sort by createdAt descending and limit
        const sorted = combined
          .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
          .slice(0, limit);
        
        console.log('[Notifications] After merge:', sorted.length, 'notifications');
        return sorted;
      });
      
      // Update unread count from server (more accurate)
      setUnreadCount(notificationsData.unreadCount || 0);
    } catch (err: any) {
      console.error('Error fetching notifications:', err);
      setError(err.message || 'Failed to fetch notifications');
    } finally {
      setLoading(false);
    }
  }, [isAuthenticated, userId, token, limit, apiBaseUrl]);

  const fetchUnreadCount = useCallback(async () => {
    if (!isAuthenticated || !userId) return;

    try {
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(
        `${apiBaseUrl}/api/notifications/unread-count?userId=${userId}`,
        { headers }
      );

      if (response.ok) {
        const data = await response.json();
        setUnreadCount(data.count || 0);
      }
    } catch (err) {
      console.error('Error fetching unread count:', err);
    }
  }, [isAuthenticated, userId, token, apiBaseUrl]);

  const markAsRead = useCallback(async (id: string) => {
    if (!isAuthenticated || !userId) return;

    try {
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${apiBaseUrl}/api/notifications/${id}/read`, {
        method: 'PATCH',
        headers,
        body: JSON.stringify({ userId }),
      });

      if (response.ok) {
        setNotifications((prev) =>
          prev.map((n) => (n.id === id ? { ...n, read: true } : n))
        );
        setUnreadCount((prev) => Math.max(0, prev - 1));
      }
    } catch (err) {
      console.error('Error marking notification as read:', err);
    }
  }, [isAuthenticated, userId, token, apiBaseUrl]);

  const markAllAsRead = useCallback(async () => {
    if (!isAuthenticated || !userId) return;

    try {
      const headers: HeadersInit = {
        'Content-Type': 'application/json',
      };

      if (token) {
        headers['Authorization'] = `Bearer ${token}`;
      }

      const response = await fetch(`${apiBaseUrl}/api/notifications/read-all`, {
        method: 'PATCH',
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
  }, [isAuthenticated, userId, token, apiBaseUrl]);

  const addNotification = useCallback((notification: Notification) => {
    console.log('[Notifications] addNotification called with:', {
      id: notification.id,
      type: notification.type,
      title: notification.title,
      read: notification.read,
      hasData: !!notification.data
    });
    
    setNotifications((prev) => {
      console.log('[Notifications] Current list before add:', prev.length, 'notifications');
      
      // Check if notification already exists (avoid duplicates) - check by ID
      const existsById = prev.some((n) => n.id === notification.id);
      
      if (existsById) {
        console.log('[Notifications] Duplicate notification detected (by ID), skipping:', notification.id);
        return prev;
      }
      
      // Also check for similar notifications (same order, same type, within 10 seconds)
      const existsBySimilarity = prev.some((n) => 
        n.type === notification.type && 
        n.data?.orderId === notification.data?.orderId &&
        n.data?.orderId && // Only check if orderId exists
        Math.abs(new Date(n.createdAt).getTime() - new Date(notification.createdAt).getTime()) < 10000 // Within 10 seconds
      );
      
      if (existsBySimilarity) {
        console.log('[Notifications] Duplicate notification detected (by similarity), skipping:', notification.id);
        return prev;
      }
      
      // Add new notification at the beginning of the list
      const updated = [notification, ...prev].slice(0, limit);
      console.log('[Notifications] Successfully added notification. New list:', {
        id: notification.id,
        type: notification.type,
        title: notification.title,
        totalNotifications: updated.length,
        firstNotification: updated[0]?.id
      });
      return updated;
    });
    
    // Update unread count if notification is unread
    if (!notification.read) {
      setUnreadCount((prev) => {
        const newCount = prev + 1;
        console.log('[Notifications] Unread count updated:', prev, '->', newCount);
        return newCount;
      });
    }
  }, [limit]);

  const deleteNotification = useCallback(async (id: string) => {
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
        // Update unread count if needed
        fetchUnreadCount();
      }
    } catch (err) {
      console.error('Error deleting notification:', err);
    }
  }, [isAuthenticated, userId, token, apiBaseUrl, fetchUnreadCount]);

  // Fetch on mount and when dependencies change
  useEffect(() => {
    // Only fetch on initial mount, not on every dependency change
    // This prevents clearing WebSocket notifications
    if (isAuthenticated && userId) {
      console.log('[Notifications] Initial fetch on mount');
      fetchNotifications();
      fetchUnreadCount();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAuthenticated, userId]); // Only depend on auth state, not the functions

  // Poll for unread count updates every 30 seconds
  useEffect(() => {
    if (!isAuthenticated || !userId) return;

    const interval = setInterval(() => {
      fetchUnreadCount();
    }, 30000);

    return () => clearInterval(interval);
  }, [isAuthenticated, userId, fetchUnreadCount]);

  return {
    notifications,
    unreadCount,
    loading,
    error,
    fetchNotifications,
    addNotification,
    markAsRead,
    markAllAsRead,
    deleteNotification,
  };
}

