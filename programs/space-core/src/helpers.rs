//! Shared math and PDA helpers used by multiple instruction handlers.
//!
//! All bodies are copied verbatim from the original monolithic lib.rs to
//! preserve on-chain behavior. Anything here is pub(crate) — these are
//! implementation details, not part of the IDL surface.

use anchor_lang::prelude::*;

use crate::constants::{
    BASIS_POINTS, BUY_FEE_MAX_BPS, BUY_FEE_MIN_BPS, MAX_PRICE_SNAPSHOTS, SELL_FEE_MIN_BPS,
    SELL_FEE_PEAK_BPS, SELL_FEE_SIGMA,
};
use crate::state::{Market, PriceSnapshot};

/// Derive position PDA, trying new format (7 seeds with token_type) first,
/// then old format (6 seeds without token_type) as fallback.
/// Returns (pda, bump, is_new_format).
pub(crate) fn find_position_pda_compat(
    user: &Pubkey,
    market: &Pubkey,
    outcome_id: u8,
    side: u8,
    position_type: u8,
    token_type: u8,
    program_id: &Pubkey,
    account_key: &Pubkey,
) -> (Pubkey, u8, bool) {
    // Try new PDA (with token_type seed)
    let (new_pda, new_bump) = Pubkey::find_program_address(
        &[
            b"position",
            user.as_ref(),
            market.as_ref(),
            &[outcome_id],
            &[side],
            &[position_type],
            &[token_type],
        ],
        program_id,
    );
    if new_pda == *account_key {
        return (new_pda, new_bump, true);
    }
    // Fallback: old PDA (without token_type seed)
    let (old_pda, old_bump) = Pubkey::find_program_address(
        &[
            b"position",
            user.as_ref(),
            market.as_ref(),
            &[outcome_id],
            &[side],
            &[position_type],
        ],
        program_id,
    );
    (old_pda, old_bump, false)
}

pub(crate) fn calculate_buy_fee(probability_bps: u64) -> u64 {
    let p = probability_bps.min(BASIS_POINTS);
    let p_percent = p / 100;
    let p_squared = p_percent.saturating_mul(p_percent);
    let p_to_alpha = (p_percent
        .saturating_mul(100)
        .saturating_add(p_squared.saturating_mul(3)))
        / 100;
    let p_to_alpha_percent = p_to_alpha.min(100);
    let one_minus_power = 100_u64.saturating_sub(p_to_alpha_percent);
    let fee_range = BUY_FEE_MAX_BPS.saturating_sub(BUY_FEE_MIN_BPS);
    let dynamic_component = fee_range.saturating_mul(one_minus_power) / 100;
    BUY_FEE_MIN_BPS.saturating_add(dynamic_component)
}

pub(crate) fn calculate_sell_fee(probability_bps: u64) -> u64 {
    let p = probability_bps.min(BASIS_POINTS);
    let distance_from_50_bps = if p > 5000 { p - 5000 } else { 5000 - p };
    let sigma_squared = (SELL_FEE_SIGMA.saturating_mul(SELL_FEE_SIGMA)) / 100;
    let distance_squared = distance_from_50_bps.saturating_mul(distance_from_50_bps);
    let distance_squared_bps = distance_squared / sigma_squared.max(1);
    let x_normalized = distance_squared_bps / 200;
    let x = x_normalized.min(200);

    let gaussian_factor = if x == 0 {
        100
    } else if x < 50 {
        let x_squared = (x.saturating_mul(x)) / 100;
        100_u64.saturating_sub(x).saturating_add(x_squared / 200)
    } else {
        let x_squared = (x.saturating_mul(x)) / 100;
        let x_cubed = (x_squared.saturating_mul(x)) / 100;
        let cubic_term = x_cubed / 600;
        100_u64
            .saturating_sub(x)
            .saturating_add((x_squared / 200).saturating_sub(cubic_term))
    }
    .min(100)
    .max(0);

    let fee_range = SELL_FEE_PEAK_BPS.saturating_sub(SELL_FEE_MIN_BPS);
    let dynamic_component = fee_range.saturating_mul(gaussian_factor) / 100;
    SELL_FEE_MIN_BPS.saturating_add(dynamic_component)
}

/// Calculate liquidation price for a leveraged position.
/// Returns the price (in basis points) at which the position becomes liquidatable.
/// For long positions (side = 0): liquidation_price is the price below which liquidation occurs.
/// For short positions (side = 1): liquidation_price is the price above which liquidation occurs.
pub(crate) fn calculate_liquidation_price(
    entry_price: u64,
    leverage: u8,
    side: u8,
    maintenance_margin_bps: u64,
) -> Result<u64> {
    if leverage <= 1 {
        return Ok(0); // Spot positions have no liquidation price
    }

    let leverage_u64 = leverage as u64;

    // Simplified liquidation price calculation
    // For long: liquidation when price drops by (1 - maintenance_margin/leverage) factor
    // For short: liquidation when price rises by similar factor
    if side == 0 {
        // Long position: price must drop enough to trigger liquidation
        // Simplified: price_drop = entry_price * (1 - maintenance_margin_bps / (leverage * 100))
        let margin_factor = (maintenance_margin_bps * 100) / (leverage_u64 * BASIS_POINTS);
        let price_drop_bps = BASIS_POINTS.saturating_sub(margin_factor);
        let liquidation_price = (entry_price * price_drop_bps) / BASIS_POINTS;
        Ok(liquidation_price.max(0))
    } else {
        // Short position: price must rise enough to trigger liquidation
        let margin_factor = (maintenance_margin_bps * 100) / (leverage_u64 * BASIS_POINTS);
        let price_rise_bps = BASIS_POINTS.saturating_sub(margin_factor);
        let liquidation_price = (entry_price * (BASIS_POINTS + price_rise_bps)) / BASIS_POINTS;
        Ok(liquidation_price.min(BASIS_POINTS * 2)) // Cap at 200% to prevent overflow
    }
}

pub(crate) fn calculate_dynamic_fee(market_price: u64, side: u8) -> u64 {
    if side == 0 {
        calculate_buy_fee(market_price)
    } else {
        calculate_sell_fee(market_price)
    }
}

pub(crate) fn add_price_snapshot(market: &mut Market, outcome_id: u8, price: u64) {
    let clock = Clock::get().unwrap();
    let snapshot = PriceSnapshot {
        timestamp: clock.unix_timestamp,
        price,
    };
    market.price_snapshots.push(snapshot);
    if market.price_snapshots.len() > MAX_PRICE_SNAPSHOTS {
        market.price_snapshots.remove(0);
    }
    if (outcome_id as usize) < market.outcomes.len() {
        market.outcomes[outcome_id as usize].last_price = price;
    }
}
