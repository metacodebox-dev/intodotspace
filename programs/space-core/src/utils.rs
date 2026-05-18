// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

use crate::constants::{BASE_TAKER_FEE_BPS, BASIS_POINTS, MAX_TAKER_FEE_BPS, MAX_LEVERAGE};
use crate::errors::SpaceError;
use crate::state::{Config, Market, MarketStatus};
use anchor_lang::prelude::*;

/// Calculate dynamic taker fee based on market probability.
///
/// Per Space docs: Takers pay dynamic fees based on market probability
/// - Higher fees for more extreme probabilities (near 0 or 100%)
/// - Lower fees for prices near 50%
pub fn calculate_dynamic_fee(market_price: u64) -> Result<u64> {
    // Calculate distance from 50%
    let mid_point = BASIS_POINTS / 100; // 100% in basis points
    let distance = if market_price > mid_point {
        market_price - mid_point
    } else {
        mid_point - market_price
    };

    // Fee increases as price moves away from 50%
    // Base: 0.1% at 50%, up to 2% at extremes
    let fee_multiplier = (distance.checked_mul(100).ok_or(SpaceError::InvalidAmount)?) / mid_point; // 0 at 50%, 100 at extremes
    let fee_diff = MAX_TAKER_FEE_BPS.checked_sub(BASE_TAKER_FEE_BPS).ok_or(SpaceError::InvalidAmount)?;
    let additional_fee = (fee_diff.checked_mul(fee_multiplier).ok_or(SpaceError::InvalidAmount)?) / 100;

    BASE_TAKER_FEE_BPS.checked_add(additional_fee).ok_or(SpaceError::InvalidAmount)
}

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

/// Check if protocol is paused
pub fn check_protocol_not_paused(config: &Config) -> Result<()> {
    require!(!config.paused, SpaceError::ProtocolPaused);
    Ok(())
}

/// Validate market is active
pub fn validate_market_active(market: &Market) -> Result<()> {
    require!(market.status == MarketStatus::Active as u8, SpaceError::MarketNotActive);
    Ok(())
}

/// Validate price is within valid range (1-10000 basis points)
pub fn validate_price(price: u64) -> Result<()> {
    require!(price >= 1 && price <= BASIS_POINTS, SpaceError::InvalidPrice);
    Ok(())
}

/// Validate leverage is within valid range (1-10)
pub fn validate_leverage(leverage: u8) -> Result<()> {
    require!(leverage >= 1 && leverage <= MAX_LEVERAGE, SpaceError::InvalidLeverage);
    Ok(())
}

/// Validate amount is greater than zero
pub fn validate_amount(amount: u64) -> Result<()> {
    require!(amount > 0, SpaceError::InvalidAmount);
    Ok(())
}

/// Validate outcome ID is valid for market
pub fn validate_outcome(market: &Market, outcome_id: u8) -> Result<()> {
    require!(outcome_id < market.num_outcomes, SpaceError::InvalidOutcome);
    Ok(())
}

/// Validate market hasn't ended
pub fn validate_market_not_ended(market: &Market) -> Result<()> {
    let clock = Clock::get()?;
    require!(clock.unix_timestamp < market.end_date, SpaceError::MarketNotActive);
    Ok(())
}

/// Calculate notional value with overflow protection
pub fn calculate_notional(quantity: u64, price: u64) -> Result<u64> {
    quantity.checked_mul(price)
        .and_then(|v| v.checked_div(BASIS_POINTS))
        .ok_or(SpaceError::InvalidAmount.into())
}

/// Calculate required margin with overflow protection
pub fn calculate_required_margin(notional: u64, leverage: u8, initial_margin_bps: u64) -> Result<u64> {
    let leverage_u64 = leverage as u64;
    require!(leverage_u64 > 0, SpaceError::InvalidLeverage);
    
    let margin_from_leverage = notional.checked_div(leverage_u64).ok_or(SpaceError::InvalidAmount)?;
    let min_margin = notional.checked_mul(initial_margin_bps)
        .and_then(|v| v.checked_div(BASIS_POINTS))
        .ok_or(SpaceError::InvalidAmount)?;
    
    Ok(margin_from_leverage.max(min_margin))
}

/// Calculate fee amount with overflow protection
pub fn calculate_fee(amount: u64, fee_bps: u64) -> Result<u64> {
    amount.checked_mul(fee_bps)
        .and_then(|v| v.checked_div(BASIS_POINTS))
        .ok_or(SpaceError::InvalidAmount.into())
}

/// Safely calculate PnL with overflow protection
pub fn calculate_pnl(position_value: u64, entry_value: u64, side: u8) -> Result<i64> {
    let pnl = if side == 0 {
        // Long position: profit when position_value > entry_value
        position_value.checked_sub(entry_value).ok_or(SpaceError::InvalidAmount)? as i64
    } else {
        // Short position: profit when entry_value > position_value
        entry_value.checked_sub(position_value).ok_or(SpaceError::InvalidAmount)? as i64
    };
    Ok(pnl)
}



