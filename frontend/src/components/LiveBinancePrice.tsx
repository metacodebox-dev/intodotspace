import { useEffect, useRef, useState } from 'react';

interface Props {
  symbol: string;        // "btcusdt", "ethusdt", "solusdt"
  strikePrice?: number;  // In cents (optional — shown as reference line)
  compact?: boolean;     // smaller display
}

const SYMBOL_LABEL: Record<string, string> = {
  btcusdt: 'BTC',
  ethusdt: 'ETH',
  solusdt: 'SOL',
};

/**
 * Live Binance price ticker via the backend's price feed API.
 * Polls every 2s and shows % change vs strike with directional arrow.
 */
export function LiveBinancePrice({ symbol, strikePrice, compact = false }: Props) {
  const [price, setPrice] = useState<number | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const prevPriceRef = useRef<number | null>(null);
  const [flash, setFlash] = useState<'up' | 'down' | null>(null);

  useEffect(() => {
    if (!symbol) return;

    const apiBase = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:3001';

    const fetchPrice = async () => {
      try {
        const res = await fetch(`${apiBase}/api/auto-market/prices/${symbol.toLowerCase()}`);
        if (!res.ok) {
          setError('stale');
          return;
        }
        const data = await res.json();
        if (typeof data.price === 'number') {
          if (prevPriceRef.current !== null && data.price !== prevPriceRef.current) {
            setFlash(data.price > prevPriceRef.current ? 'up' : 'down');
            setTimeout(() => setFlash(null), 400);
          }
          prevPriceRef.current = data.price;
          setPrice(data.price);
          setUpdatedAt(data.timestamp);
          setError(null);
        }
      } catch (e: any) {
        setError(e.message || 'fetch failed');
      }
    };

    fetchPrice();
    const id = setInterval(fetchPrice, 2000);
    return () => clearInterval(id);
  }, [symbol]);

  const strikeDollars = strikePrice ? strikePrice / 100 : null;
  const pctChange = strikeDollars && price ? ((price - strikeDollars) / strikeDollars) * 100 : null;
  const isUp = pctChange !== null && pctChange >= 0;

  if (error && !price) {
    return (
      <div className={`text-xs text-space-gray-500 ${compact ? '' : 'p-2'}`}>
        Price feed unavailable
      </div>
    );
  }

  const label = SYMBOL_LABEL[symbol.toLowerCase()] || symbol.toUpperCase();

  const flashClass = flash === 'up'
    ? 'ring-2 ring-green-500/50 transition-all'
    : flash === 'down'
      ? 'ring-2 ring-red-500/50 transition-all'
      : '';

  if (compact) {
    return (
      <div className={`inline-flex items-center gap-2 px-3 py-1.5 rounded-lg bg-space-gray-700/60 border border-space-gray-600 ${flashClass}`}>
        <span className="text-xs text-space-gray-400">{label}</span>
        <span className="font-mono text-sm font-semibold text-white">
          {price !== null ? `$${price.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}` : '—'}
        </span>
        {pctChange !== null && (
          <span className={`text-xs font-semibold ${isUp ? 'text-green-400' : 'text-red-400'}`}>
            {isUp ? '▲' : '▼'} {Math.abs(pctChange).toFixed(2)}%
          </span>
        )}
      </div>
    );
  }

  return (
    <div className={`bg-gradient-to-br from-space-gray-800 to-space-gray-900 rounded-xl p-4 border border-space-gray-700 ${flashClass}`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="inline-block w-2 h-2 rounded-full bg-green-500 animate-pulse"></span>
          <span className="text-xs font-medium text-space-gray-400 uppercase tracking-wider">
            Live {label}/USDT
          </span>
        </div>
        {updatedAt && (
          <span className="text-[10px] text-space-gray-500">
            {new Date(updatedAt).toLocaleTimeString()}
          </span>
        )}
      </div>
      <div className="flex items-baseline gap-3">
        <div className="font-mono text-2xl font-bold text-white">
          {price !== null ? `$${price.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}` : '—'}
        </div>
        {pctChange !== null && (
          <div className={`flex items-baseline gap-1 text-sm font-semibold ${isUp ? 'text-green-400' : 'text-red-400'}`}>
            <span>{isUp ? '▲' : '▼'}</span>
            <span>{Math.abs(pctChange).toFixed(3)}%</span>
          </div>
        )}
      </div>
      {strikeDollars !== null && (
        <div className="mt-2 text-xs text-space-gray-500">
          Strike: <span className="text-space-gray-300 font-mono">${strikeDollars.toLocaleString('en-US', { maximumFractionDigits: 2, minimumFractionDigits: 2 })}</span>
        </div>
      )}
    </div>
  );
}
