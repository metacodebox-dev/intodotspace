// Frontend Market types (matching API response format)

export interface MarketOutcome {
  id: number;
  label: string;
  share_price: number; // Basis points (0-10000) - deprecated, use lastPrice
  lastPrice?: number; // Last traded price from order book (basis points)
  total_shares: number;
  liquidity: number; // Micro-USDC (6 decimals)
  imageUrl?: string | null; // Supabase Storage URL for outcome photo
  subtitle?: string | null; // Optional subtitle (e.g., party, team)
}

export interface Market {
  id: string;
  title: string;
  description: string;
  imageUrl?: string | null; // Market cover image URL (Supabase Storage)
  image_url?: string | null; // Alternative naming for backward compatibility
  category: string;
  status: string;
  is_multi_outcome?: boolean; // Optional for backward compatibility
  isMultiOutcome?: boolean; // Alternative naming
  outcomes: MarketOutcome[];
  end_date: string; // ISO 8601
  created_at: string; // ISO 8601
  total_volume: number; // Micro-USDC (6 decimals)
  total_liquidity: number; // Micro-USDC (6 decimals)
  creator?: string;
  resolved_outcome?: number;
  resolvedOutcome?: number; // Alternative naming
  resolution_source?: number;
  noMint?: string; // On-chain noMint pubkey; all-zeros = new per-outcome NO model
  // Auto-market (Binance-driven) fields
  autoResolve?: boolean;
  timeframeSecs?: number | null;  // 900 (15m) or 3600 (1h)
  strikePrice?: number | null;    // Strike price in cents at market creation
  priceFeed?: string | null;      // "btcusdt", "ethusdt", "solusdt"
  resolveAt?: string | null;      // ISO 8601
  // Quote token — USDC or SPACE. Defaults to USDC for legacy rows.
  quoteMint?: string;
  quoteDecimals?: number;
  quoteSymbol?: string;
}

/**
 * Check if market uses the new per-outcome NO mint model (Polymarket model).
 * New-model markets store PublicKey.default() (all zeros) in noMint,
 * while old-model markets store a real shared NO mint pubkey.
 * If noMint is not available, assume new model.
 */
export function isNewModelMarket(market: Market): boolean {
  if (!market.noMint) return true; // If not provided, assume new model
  const ALL_ZEROS = '11111111111111111111111111111111';
  return market.noMint === ALL_ZEROS;
}

