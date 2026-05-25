//! Program-wide constants and the share→quote scaling helper.
//!
//! Values are copied verbatim from the original monolithic lib.rs so the
//! deployed program behaves identically after this refactor. Any change here
//! is a protocol-level change — bump MARKET_VERSION_V2 and migrate accordingly.

pub const BASIS_POINTS: u64 = 10_000;
pub const USDC_DECIMALS: u64 = 1_000_000;
pub const MIN_INITIAL_COLLATERAL: u64 = 1_000 * USDC_DECIMALS;
pub const SHARE_DECIMALS: u8 = 6;

/// Scaling factor that converts a share-denominated amount (shares are always
/// 6 decimals) into a quote-token-denominated amount for markets where the
/// quote token has more decimals than shares. Returns 1 for quote tokens with
/// ≤ 6 decimals (USDC and legacy markets: byte-identical to pre-v2 behavior),
/// 1000 for SPACE (9 decimals), etc. Callers multiply share-derived amounts
/// by this factor when moving them across a quote-denominated transfer.
#[inline]
pub fn quote_scale(quote_decimals: u8) -> u64 {
    if quote_decimals <= SHARE_DECIMALS {
        1
    } else {
        10u64.pow((quote_decimals - SHARE_DECIMALS) as u32)
    }
}

// Current Market account layout version. Bump when making breaking struct changes.
pub const MARKET_VERSION_V2: u8 = 2;
pub const MAX_LEVERAGE: u8 = 10;
pub const INITIAL_MARGIN_BPS: u64 = 1000;
pub const MAINTENANCE_MARGIN_BPS: u64 = 1000;
pub const LIQUIDATION_PENALTY_BPS: u64 = 1000;
pub const LIQUIDATION_STEP_BPS: u64 = 2500;
pub const BUY_FEE_MAX_BPS: u64 = 200;
pub const BUY_FEE_MIN_BPS: u64 = 2;
pub const BUY_FEE_ALPHA: u64 = 130;
pub const SELL_FEE_PEAK_BPS: u64 = 100;
pub const SELL_FEE_MIN_BPS: u64 = 2;
pub const SELL_FEE_SIGMA: u64 = 2500;

pub const MAKER_FEE_BPS: u64 = 0;
pub const DEFAULT_PROTOCOL_FEE_BPS: u64 = 10;
pub const DEFAULT_CREATOR_FEE_BPS: u64 = 20;
pub const DEFAULT_INSURANCE_FEE_BPS: u64 = 10;
pub const MAX_OUTCOME_LABEL_LEN: usize = 100;

// Orders remain active until cancelled by users or market ends.
// Set to a very large value (100 years) to effectively disable expiration.
pub const MAX_ORDER_AGE_SECONDS: i64 = 3_153_600_000; // ~100 years in seconds
pub const MAX_PRICE_SNAPSHOTS: usize = 100;
pub const CHALLENGE_PERIOD_SLOTS: u64 = 1000;
