/**
 * Singleton WebSocket Manager
 * Ensures only ONE WebSocket connection is created and shared across all components
 */

// Get WebSocket URL - validate it's correct for production
function getWebSocketUrl(): string {
  const wsUrl = process.env.NEXT_PUBLIC_WS_URL || 'ws://localhost:3001/ws';
  
  // Log the URL being used (important for debugging)
  console.log('[WebSocketManager] WebSocket URL configuration:', {
    envVar: process.env.NEXT_PUBLIC_WS_URL || 'NOT SET (using default)',
    resolvedUrl: wsUrl,
    isProduction: process.env.NODE_ENV === 'production',
    currentProtocol: typeof window !== 'undefined' ? window.location.protocol : 'unknown',
  });
  
  // Warn if using ws:// on a production HTTPS site (mixed content issue)
  if (typeof window !== 'undefined') {
    const isHttps = window.location.protocol === 'https:';
    const isWs = wsUrl.startsWith('ws://');
    
    if (isHttps && isWs) {
      console.error('[WebSocketManager] ⚠️ SECURITY WARNING: Using ws:// on HTTPS site will be blocked by browser!');
      console.error('[WebSocketManager] Change NEXT_PUBLIC_WS_URL to wss:// in production');
      console.error('[WebSocketManager] Current URL:', wsUrl);
    }
  }
  
  return wsUrl;
}

const WS_URL = getWebSocketUrl();

/**
 * Get human-readable meaning of WebSocket close codes
 */
function getCloseCodeMeaning(code: number): string {
  const meanings: Record<number, string> = {
    1000: 'Normal Closure',
    1001: 'Going Away',
    1002: 'Protocol Error',
    1003: 'Unsupported Data',
    1006: 'Abnormal Closure (no close frame)',
    1007: 'Invalid Data',
    1008: 'Policy Violation',
    1009: 'Message Too Big',
    1010: 'Extension Error',
    1011: 'Internal Server Error',
    1012: 'Service Restart',
    1013: 'Try Again Later',
    1014: 'Bad Gateway',
    1015: 'TLS Handshake Failed',
  };
  return meanings[code] || `Unknown code: ${code}`;
}

interface WebSocketMessage {
  type: string;
  [key: string]: any;
}

class WebSocketManager {
  private ws: WebSocket | null = null;
  private isConnected = false;
  private reconnectAttempts = 0;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private subscriptions = new Set<string>();
  private messageHandlers = new Map<string, Set<(data: any) => void>>();
  private connectionCallbacks = new Set<() => void>();
  private disconnectCallbacks = new Set<() => void>();
  private errorCallbacks = new Set<(error: string) => void>();
  private publicKey: string | null = null;

  connect(publicKey?: string | null) {
    console.log('[WebSocketManager] connect() called', {
      hasWs: !!this.ws,
      readyState: this.ws?.readyState,
      isConnected: this.isConnected,
      publicKey: publicKey?.slice(0, 8) + '...',
    });

    // If already connected, just update publicKey if needed
    if (this.ws?.readyState === WebSocket.OPEN) {
      console.log('[WebSocketManager] Already connected, updating publicKey if needed');
      if (publicKey && publicKey !== this.publicKey) {
        this.publicKey = publicKey;
        this.authenticate();
      }
      return;
    }

    // If connecting, don't create another connection - just store publicKey
    if (this.ws?.readyState === WebSocket.CONNECTING) {
      console.log('[WebSocketManager] Already connecting, storing publicKey');
      if (publicKey) {
        this.publicKey = publicKey;
      }
      return;
    }

    // If WebSocket exists but is in CLOSING or CLOSED state, clean it up first
    if (this.ws && (this.ws.readyState === WebSocket.CLOSING || this.ws.readyState === WebSocket.CLOSED)) {
      console.log('[WebSocketManager] Cleaning up old connection before creating new one');
      this.ws = null;
      this.isConnected = false;
    }

    // Create new connection
    console.log('[WebSocketManager] Creating new connection');
    this.createConnection(publicKey);
  }

  private createConnection(publicKey?: string | null) {
    console.log('[WebSocketManager] Creating connection...', {
      url: WS_URL,
      env: process.env.NODE_ENV,
      hasPublicKey: !!publicKey,
    });

    try {
      this.ws = new WebSocket(WS_URL);
      this.publicKey = publicKey || null;
      
      console.log('[WebSocketManager] WebSocket instance created, readyState:', this.ws.readyState);

      this.ws.onopen = (event) => {
        console.log('[WebSocketManager] Connection opened successfully!', {
          url: WS_URL,
          readyState: this.ws?.readyState,
        });
        this.isConnected = true;
        this.reconnectAttempts = 0;

        // Wait for connection to be fully ready before sending messages
        const sendMessages = () => {
          if (!this.ws || this.ws.readyState !== WebSocket.OPEN) {
            setTimeout(sendMessages, 50);
            return;
          }

          // Authenticate if publicKey is available
          if (this.publicKey) {
            this.authenticate();
          }

          // Wait longer before resubscribing to ensure connection is stable and auth is processed
          setTimeout(() => {
            if (this.ws?.readyState === WebSocket.OPEN) {
              this.resubscribeAll();
            }
          }, 500);
        };

        // Start sending messages after a delay to ensure connection is fully ready
        setTimeout(sendMessages, 200);

        // Notify all connection callbacks
        this.connectionCallbacks.forEach(cb => cb());
      };

      this.ws.onmessage = (event) => {
        try {
          const message: WebSocketMessage = JSON.parse(event.data);

          // Handle ping/pong
          if (message.type === 'ping') {
            this.safeSend({ type: 'pong' });
            return;
          }

          if (message.type === 'pong') {
            return;
          }

          // Handle connection status
          if (message.type === 'connected') {
            console.log('[WebSocketManager] Connected to server');
            return;
          }

          if (message.type === 'auth_success') {
            console.log('[WebSocketManager] Authentication successful');
            return;
          }

          if (message.type === 'subscribed') {
            console.log('[WebSocketManager] Subscription confirmed:', message.channel);
            return;
          }

          // Handle errors
          if (message.type === 'error') {
            console.error('[WebSocketManager] Error:', message);
            const errorMsg = message.message || 'WebSocket error';
            this.errorCallbacks.forEach(cb => cb(errorMsg));
            return;
          }

          // Call registered handlers
          const handlers = this.messageHandlers.get(message.type);
          if (handlers) {
            handlers.forEach(handler => {
              try {
                handler(message);
              } catch (err) {
                console.error('[WebSocketManager] Handler error:', err);
              }
            });
          }
        } catch (err) {
          console.error('[WebSocketManager] Error parsing message:', err);
        }
      };

      this.ws.onerror = (event) => {
        console.error('[WebSocketManager] Connection error:', {
          type: event.type,
          readyState: this.ws?.readyState,
          url: WS_URL,
          error: event,
          timestamp: new Date().toISOString(),
        });
        console.error('[WebSocketManager] Full error details:', event);
        const errorMsg = `WebSocket connection error to ${WS_URL}`;
        this.errorCallbacks.forEach(cb => cb(errorMsg));
      };

      this.ws.onclose = (event) => {
        console.log('[WebSocketManager] Connection closed', {
          code: event.code,
          reason: event.reason || 'No reason provided',
          wasClean: event.wasClean,
          url: WS_URL,
          closeCodeMeaning: getCloseCodeMeaning(event.code),
        });
        this.isConnected = false;
        this.ws = null;

        // Notify disconnect callbacks
        this.disconnectCallbacks.forEach(cb => cb());

        // Don't reconnect if it was a clean close
        if (event.code === 1000 || event.code === 1001) {
          return;
        }

        // Attempt to reconnect
        if (this.reconnectAttempts < 10) {
          const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);
          this.reconnectAttempts++;
          
          this.reconnectTimeout = setTimeout(() => {
            console.log(`[WebSocketManager] Reconnecting (attempt ${this.reconnectAttempts})...`);
            this.connect(this.publicKey);
          }, delay);
        } else {
          const errorMsg = `Failed to reconnect after ${this.reconnectAttempts} attempts`;
          this.errorCallbacks.forEach(cb => cb(errorMsg));
        }
      };
    } catch (err) {
      console.error('[WebSocketManager] Connection error:', err);
      const errorMsg = 'Failed to connect to WebSocket server';
      this.errorCallbacks.forEach(cb => cb(errorMsg));
    }
  }

  /**
   * Safe send wrapper that verifies message sending
   */
  private safeSend(data: any): boolean {
    if (!this.ws) {
      console.error('[WebSocketManager] Cannot send - WebSocket is null');
      return false;
    }

    if (this.ws.readyState !== WebSocket.OPEN) {
      console.error('[WebSocketManager] Cannot send - WebSocket not open. State:', this.ws.readyState);
      return false;
    }

    try {
      console.log(`[WebSocketManager] Sending: ${data.type}`, data.channel ? `channel: ${data.channel}` : '');
      this.ws.send(JSON.stringify(data));
      return true;
    } catch (error) {
      console.error('[WebSocketManager] Error sending message:', error);
      return false;
    }
  }

  private authenticate() {
    if (this.ws?.readyState === WebSocket.OPEN && this.publicKey) {
      const authMsg = { type: 'auth', pubkey: this.publicKey };
      this.safeSend(authMsg);
    } else {
      console.warn('[WebSocketManager] Cannot authenticate - WebSocket not open or no publicKey', {
        readyState: this.ws?.readyState,
        hasPublicKey: !!this.publicKey,
      });
    }
  }

  private resubscribeAll() {
    if (this.ws?.readyState !== WebSocket.OPEN) {
      // Retry after a short delay
      setTimeout(() => this.resubscribeAll(), 100);
      return;
    }
    
    this.subscriptions.forEach((subKey) => {
      const [channel, marketId, outcomeId, userId, tokenType] = subKey.split(':');
      this.safeSend({
        type: 'subscribe',
        channel,
        market_id: marketId || undefined,
        outcome_id: outcomeId ? parseInt(outcomeId) : undefined,
        user_id: userId || undefined,
        token_type: tokenType || undefined,
      });
    });
  }

  subscribe(channel: string, options?: { marketId?: string; outcomeId?: number; userId?: string; tokenType?: 'yes' | 'no' }) {
    const subKey = `${channel}:${options?.marketId || ''}:${options?.outcomeId ?? ''}:${options?.userId || ''}:${options?.tokenType || ''}`;

    if (this.subscriptions.has(subKey)) {
      console.log(`[WebSocketManager] Already subscribed to ${subKey}, re-sending subscribe message`);
      // Even if already subscribed, try to send subscribe message if connection is open
      // This ensures subscription is active even if it was queued before connection
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.safeSend({
          type: 'subscribe',
          channel,
          market_id: options?.marketId,
          outcome_id: options?.outcomeId,
          user_id: options?.userId,
          token_type: options?.tokenType,
        });
      }
      return; // Already subscribed
    }

    this.subscriptions.add(subKey);
    console.log(`[WebSocketManager] Subscribing to ${subKey}, WebSocket state: ${this.ws?.readyState}`);

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.safeSend({
        type: 'subscribe',
        channel,
        market_id: options?.marketId,
        outcome_id: options?.outcomeId,
        user_id: options?.userId,
        token_type: options?.tokenType,
      });
    } else {
      console.log(`[WebSocketManager] WebSocket not open yet, subscription queued for ${subKey}`);
    }
  }

  unsubscribe(channel: string, options?: { marketId?: string; outcomeId?: number; userId?: string; tokenType?: 'yes' | 'no' }) {
    const subKey = `${channel}:${options?.marketId || ''}:${options?.outcomeId ?? ''}:${options?.userId || ''}:${options?.tokenType || ''}`;
    this.subscriptions.delete(subKey);

    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify({
        type: 'unsubscribe',
        channel,
        market_id: options?.marketId,
        outcome_id: options?.outcomeId,
        user_id: options?.userId,
        token_type: options?.tokenType,
      }));
    }
  }

  onMessage(type: string, handler: (data: any) => void): () => void {
    if (!this.messageHandlers.has(type)) {
      this.messageHandlers.set(type, new Set());
    }
    this.messageHandlers.get(type)!.add(handler);

    return () => {
      const handlers = this.messageHandlers.get(type);
      if (handlers) {
        handlers.delete(handler);
        if (handlers.size === 0) {
          this.messageHandlers.delete(type);
        }
      }
    };
  }

  onConnect(callback: () => void): () => void {
    this.connectionCallbacks.add(callback);
    return () => this.connectionCallbacks.delete(callback);
  }

  onDisconnect(callback: () => void): () => void {
    this.disconnectCallbacks.add(callback);
    return () => this.disconnectCallbacks.delete(callback);
  }

  onError(callback: (error: string) => void): () => void {
    this.errorCallbacks.add(callback);
    return () => this.errorCallbacks.delete(callback);
  }

  disconnect() {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    this.isConnected = false;
  }

  getIsConnected() {
    return this.isConnected;
  }
}

// Export singleton instance
export const wsManager = new WebSocketManager();

// Auto-connect on module load (for immediate connection)
// This ensures WebSocket is available even before React components mount
if (typeof window !== 'undefined') {
  console.log('[WebSocketManager] Module loaded, attempting auto-connect...');
  // Small delay to ensure DOM is ready
  setTimeout(() => {
    if (!wsManager.getIsConnected()) {
      console.log('[WebSocketManager] Auto-connecting WebSocket...');
      wsManager.connect();
    }
  }, 100);
}

