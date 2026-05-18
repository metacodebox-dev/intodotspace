// ============================================================================
// CONSTANTS
// ============================================================================

/// Price scale: 10000 = $1.00 (basis points)
pub const BASIS_POINTS: u64 = 10_000;

/// USDC has 6 decimals, so $1 = 1_000_000
pub const USDC_DECIMALS: u64 = 1_000_000;

/// Minimum initial collateral (5000 USDC)
pub const MIN_INITIAL_COLLATERAL: u64 = 5_000 * USDC_DECIMALS;

/// Maximum leverage (per Space docs)
pub const MAX_LEVERAGE: u8 = 10;

/// Initial margin requirement (20% per Space docs)
pub const INITIAL_MARGIN_BPS: u64 = 2000;

/// Maintenance margin requirement (10% per Space docs)
pub const MAINTENANCE_MARGIN_BPS: u64 = 1000;

/// Liquidation penalty to insurance fund (10%)
pub const LIQUIDATION_PENALTY_BPS: u64 = 1000;

/// Partial liquidation step (25% per Space docs)
pub const LIQUIDATION_STEP_BPS: u64 = 2500;

/// Dispute window (~24 hours at 2s/slot)
pub const DISPUTE_WINDOW_SLOTS: u64 = 43_200;

/// Challenge period (24-48 hours, using 24h default)
pub const CHALLENGE_PERIOD_SLOTS: u64 = 43_200;

/// TWAP window duration (15 minutes = 450 slots at 2s/slot)
pub const TWAP_WINDOW_SLOTS: u64 = 450;

/// Minimum TWAP samples required (2 per minute for 15 min = 30)
pub const MIN_TWAP_SAMPLES: u64 = 30;

/// Maximum price change per minute for TWAP (1%)
pub const MAX_PRICE_CHANGE_PER_MINUTE_BPS: u64 = 100;

/// Oracle deviation threshold for multi-feed protection (2%)
pub const ORACLE_DEVIATION_THRESHOLD_BPS: u64 = 200;

/// Base taker fee (minimum)
pub const BASE_TAKER_FEE_BPS: u64 = 10; // 0.1%

/// Maximum taker fee
pub const MAX_TAKER_FEE_BPS: u64 = 200; // 2%

/// Default protocol fee
pub const DEFAULT_PROTOCOL_FEE_BPS: u64 = 10;

/// Default creator fee
pub const DEFAULT_CREATOR_FEE_BPS: u64 = 20;





