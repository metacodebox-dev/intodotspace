// ============================================================================
// LIQUIDATION INSTRUCTIONS
// ============================================================================

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer};

use crate::constants::{BASIS_POINTS, LIQUIDATION_PENALTY_BPS, LIQUIDATION_STEP_BPS, MAINTENANCE_MARGIN_BPS};
use crate::errors::SpaceError;
use crate::instructions::contexts::*;
use crate::state::MarketStatus;

/// Liquidate an underwater position (partial liquidation).
///
/// Per Space docs: https://docs.into.space/en/architecture/leverage
/// - Partial liquidation: 25% steps
/// - 10% penalty to insurance fund
/// - Check if still underwater after each step
pub fn liquidate_position(ctx: Context<LiquidatePosition>, current_price: u64) -> Result<()> {
    let position = &mut ctx.accounts.position;
    let market = &mut ctx.accounts.market;
    let insurance = &mut ctx.accounts.insurance_fund;

    require!(
        market.status == MarketStatus::Active as u8,
        SpaceError::MarketNotActive
    );

    // Calculate position value at current price
    let position_value = (position.shares * current_price) / BASIS_POINTS;
    let entry_value = (position.shares * position.avg_entry_price) / BASIS_POINTS;

    // Calculate PnL
    let pnl = if position.side == 0 {
        // Long: profit if price goes up
        position_value as i64 - entry_value as i64
    } else {
        // Short: profit if price goes down
        entry_value as i64 - position_value as i64
    };

    // Calculate equity (collateral + PnL)
    let equity = (position.collateral as i64 + pnl).max(0) as u64;

    // Calculate maintenance margin requirement (10%)
    let maintenance_requirement = (position_value * MAINTENANCE_MARGIN_BPS) / BASIS_POINTS;

    // Check if position is liquidatable
    require!(
        equity < maintenance_requirement,
        SpaceError::PositionNotLiquidatable
    );

    // Partial liquidation: liquidate 25% of position
    let liquidation_amount = (position.shares * LIQUIDATION_STEP_BPS) / BASIS_POINTS;
    let liquidation_value = (liquidation_amount * current_price) / BASIS_POINTS;

    // Calculate penalty (10% of liquidation value)
    let penalty = (liquidation_value * LIQUIDATION_PENALTY_BPS) / BASIS_POINTS;

    // Update position
    position.shares = position.shares.saturating_sub(liquidation_amount);
    position.collateral = position
        .collateral
        .saturating_sub(liquidation_value.saturating_add(penalty));

    // Add penalty to insurance fund
    insurance.balance += penalty;

    // Pay liquidator reward (5% of penalty)
    let liquidator_reward = penalty / 2;

    // Transfer reward to liquidator
    let market_key = market.key();
    let vault_seeds = &[
        b"vault_authority",
        market_key.as_ref(),
        &[ctx.bumps.vault_authority],
    ];
    let vault_signer = &[&vault_seeds[..]];

    let transfer_cpi = Transfer {
        from: ctx.accounts.market_vault.to_account_info(),
        to: ctx.accounts.liquidator_usdc.to_account_info(),
        authority: ctx.accounts.vault_authority.to_account_info(),
    };
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            transfer_cpi,
            vault_signer,
        ),
        liquidator_reward,
    )?;

    // Check if position is fully liquidated
    if position.shares == 0 {
        position.collateral = 0;
    }

    Ok(())
}





