import { useEffect, useRef, useCallback } from 'react';
import { useAuth } from '@/context/AuthContext';
import { useWallet } from '@solana/wallet-adapter-react';

interface NotificationMessage {
  type: string;
  notification?: {
    id: string;
    type: string;
    title: string;
    message: string;
    data?: Record<string, any>;
    priority: string;
    read: boolean;
    createdAt: string;
  };
  timestamp?: string;
}

export function useNotificationsWebSocket(
  onNotification: (notification: NotificationMessage['notification']) => void
) {
  const { isAuthenticated, token } = useAuth();
  const { publicKey, connected } = useWallet();
  const wsRef = useRef<WebSocket | null>(null);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const reconnectAttempts = useRef(0);
  const maxReconnectAttempts = 5;
  const onNotificationRef = useRef(onNotification);

  // Keep callback ref updated
  useEffect(() => {
    onNotificationRef.current = onNotification;
  }, [onNotification]);

  const apiBaseUrl = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';
  const wsUrl = apiBaseUrl.replace(/^http/, 'ws') + '/ws';
  const userId = publicKey?.toString();

  const connect = useCallback(() => {
    if (!isAuthenticated || !connected || !userId || wsRef.current?.readyState === WebSocket.OPEN) {
      return;
    }

    try {
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        console.log('[Notifications WebSocket] Connected');
        reconnectAttempts.current = 0;

        // Authenticate
        ws.send(
          JSON.stringify({
            type: 'auth',
            pubkey: userId,
          })
        );

        // Subscribe to notifications
        ws.send(
          JSON.stringify({
            type: 'subscribe',
            channel: 'notifications',
            user_id: userId,
          })
        );
      };

      ws.onmessage = (event) => {
        try {
          const message: NotificationMessage = JSON.parse(event.data);
          console.log('[Notifications WebSocket] Message received:', message.type, message.notification?.type);

          if (message.type === 'notification' && message.notification) {
            console.log('[Notifications WebSocket] Processing notification:', {
              id: message.notification.id,
              type: message.notification.type,
              title: message.notification.title,
            });
            // Use ref to avoid dependency issues
            onNotificationRef.current(message.notification);
          } else if (message.type === 'connected' || message.type === 'subscribed') {
            console.log('[Notifications WebSocket]', message.type);
          } else if (message.type === 'ping') {
            // Respond to ping
            ws.send(JSON.stringify({ type: 'pong' }));
          }
        } catch (err) {
          console.error('[Notifications WebSocket] Error parsing message:', err);
        }
      };

      ws.onerror = (error) => {
        console.error('[Notifications WebSocket] Error:', error);
      };

      ws.onclose = () => {
        console.log('[Notifications WebSocket] Disconnected');
        wsRef.current = null;

        // Attempt to reconnect
        if (reconnectAttempts.current < maxReconnectAttempts) {
          reconnectAttempts.current++;
          const delay = Math.min(1000 * Math.pow(2, reconnectAttempts.current), 30000);
          reconnectTimeoutRef.current = setTimeout(() => {
            connect();
          },           delay);
        }
      };
    } catch (err) {
      console.error('[Notifications WebSocket] Connection error:', err);
    }
  }, [isAuthenticated, connected, userId, wsUrl]);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
      reconnectTimeoutRef.current = null;
    }

    if (wsRef.current) {
      wsRef.current.close();
      wsRef.current = null;
    }
  }, []);

  useEffect(() => {
    if (isAuthenticated && connected && userId) {
      connect();
    } else {
      disconnect();
    }

    return () => {
      disconnect();
    };
  }, [isAuthenticated, connected, userId, connect, disconnect]);

  return { connect, disconnect };
}

