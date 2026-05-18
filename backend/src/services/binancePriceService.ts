import WebSocket from 'ws';

export interface PriceData {
  symbol: string;   // "BTCUSDT"
  price: number;    // e.g. 64321.50
  timestamp: number; // ms
}

const SYMBOLS = ['btcusdt', 'ethusdt', 'solusdt'] as const;
type Symbol = typeof SYMBOLS[number];

const RECONNECT_BASE_MS = 1000;
const RECONNECT_MAX_MS = 30000;
const STALENESS_THRESHOLD_MS = 30000;

/**
 * Persistent Binance WebSocket price feed for BTC, ETH, SOL.
 * Maintains latest price per symbol in memory.
 */
export class BinancePriceService {
  private prices: Map<string, PriceData> = new Map();
  private ws: WebSocket | null = null;
  private reconnectAttempts = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private running = false;

  start() {
    if (this.running) return;
    this.running = true;
    this.connect();
    console.log('[BinancePrice] Service started');
  }

  stop() {
    this.running = false;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    console.log('[BinancePrice] Service stopped');
  }

  /** Get latest price for a symbol. Returns null if stale or missing. */
  getPrice(symbol: string): PriceData | null {
    const key = symbol.toLowerCase();
    const data = this.prices.get(key);
    if (!data) return null;
    if (Date.now() - data.timestamp > STALENESS_THRESHOLD_MS) return null;
    return data;
  }

  /** Returns true if price is fresh (< STALENESS_THRESHOLD_MS old) */
  isFresh(symbol: string): boolean {
    return this.getPrice(symbol) !== null;
  }

  /** Get all current prices */
  getAllPrices(): PriceData[] {
    return Array.from(this.prices.values()).filter(
      (p) => Date.now() - p.timestamp < STALENESS_THRESHOLD_MS
    );
  }

  private connect() {
    if (!this.running) return;

    // Combined stream for all symbols
    const streams = SYMBOLS.map((s) => `${s}@trade`).join('/');
    const url = `wss://stream.binance.com:9443/stream?streams=${streams}`;

    try {
      this.ws = new WebSocket(url);

      this.ws.on('open', () => {
        this.reconnectAttempts = 0;
        console.log('[BinancePrice] WebSocket connected');
      });

      this.ws.on('message', (raw: WebSocket.Data) => {
        try {
          const msg = JSON.parse(raw.toString());
          if (msg.data && msg.data.e === 'trade') {
            const trade = msg.data;
            const symbol = (trade.s as string).toLowerCase();
            this.prices.set(symbol, {
              symbol: trade.s,
              price: parseFloat(trade.p),
              timestamp: trade.T || Date.now(),
            });
          }
        } catch {
          // Ignore parse errors on individual messages
        }
      });

      this.ws.on('close', (code: number) => {
        console.warn(`[BinancePrice] WebSocket closed (code ${code})`);
        this.scheduleReconnect();
      });

      this.ws.on('error', (err: Error) => {
        console.error('[BinancePrice] WebSocket error:', err.message);
        // 'close' event will fire after this and trigger reconnect
      });
    } catch (err: any) {
      console.error('[BinancePrice] Failed to connect:', err.message);
      this.scheduleReconnect();
    }
  }

  private scheduleReconnect() {
    if (!this.running || this.reconnectTimer) return;
    const delay = Math.min(
      RECONNECT_BASE_MS * Math.pow(2, this.reconnectAttempts),
      RECONNECT_MAX_MS
    );
    this.reconnectAttempts++;
    console.log(`[BinancePrice] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.connect();
    }, delay);
  }
}

// Singleton
export const binancePriceService = new BinancePriceService();
