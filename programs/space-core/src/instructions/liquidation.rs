//! Partial liquidation of underwater leveraged positions. Hard-rejects spot
//! positions; only leveraged positions with debt are eligible. Pays a fixed
//! penalty into the insurance vault and half of that to the liquidator.
//!
//! Handler body copied verbatim from the original lib.rs.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::{
    quote_scale, BASIS_POINTS, LIQUIDATION_PENALTY_BPS, LIQUIDATION_STEP_BPS,
    MAINTENANCE_MARGIN_BPS,
};
use crate::errors::SpaceError;
use crate::state::{InsuranceFund, Market, MarketStatus, Position, PositionType};

#[derive(Accounts)]
pub struct LiquidatePosition<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub position: Account<'info, Position>,
    #[account(mut)]
    pub insurance_fund: Account<'info, InsuranceFund>,
    #[account(mut, seeds = [b"insurance_vault"], bump)]
    pub insurance_vault: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"vault", market.key().as_ref()], bump)]
    pub market_vault: Account<'info, TokenAccount>,
    /// CHECK: Vault authority PDA
    #[account(seeds = [b"vault_authority", market.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut)]
    pub liquidator_usdc: Account<'info, TokenAccount>,
    pub liquidator: Signer<'info>,
    pub token_program: Program<'info, Token>,
}

pub fn liquidate_position(ctx: Context<LiquidatePosition>) -> Result<()> {
    let position = &mut ctx.accounts.position;
    let market = &mut ctx.accounts.market;
    let insurance = &mut ctx.accounts.insurance_fund;

    require!(
        market.status == MarketStatus::Active as u8,
        SpaceError::MarketNotActive
    );

    // 🔒 CRITICAL SAFETY GATE: Hard-reject spot positions
    require!(
        position.position_type == PositionType::Leveraged as u8,
        SpaceError::CannotLiquidateSpot
    );

    // Ensure position has debt (leveraged positions must have borrowed_amount > 0)
    require!(position.borrowed_amount > 0, SpaceError::NoDebt);

    // Ensure position is open
    require!(position.is_open, SpaceError::PositionNotOpen);

    // In the per-outcome-NO model, NO-token positions are stored with side=0 and
    // token_type=1; their effective price is (BASIS_POINTS - YES_price).
    let yes_price = market.outcomes[position.outcome_id as usize].last_price;
    let is_no_token_new_model =
        position.token_type == 1 && market.no_mint == Pubkey::default();
    let current_price = if is_no_token_new_model {
        BASIS_POINTS.saturating_sub(yes_price)
    } else {
        yes_price
    };

    // All *_value / *_notional amounts are quote base units
    // (shares × bps / 10000 × quote_scale). liquidation_amount stays in
    // share base units. For USDC (scale=1) this matches pre-v2 behavior.
    let scale = quote_scale(market.quote_decimals);
    let position_value = position
        .shares
        .checked_mul(current_price)
        .and_then(|x| x.checked_div(BASIS_POINTS))
        .and_then(|x| x.checked_mul(scale))
        .ok_or(SpaceError::InvalidAmount)?;
    let entry_value = position
        .shares
        .checked_mul(position.avg_entry_price)
        .and_then(|x| x.checked_div(BASIS_POINTS))
        .and_then(|x| x.checked_mul(scale))
        .ok_or(SpaceError::InvalidAmount)?;

    let pnl = if position.side == 0 {
        position_value as i64 - entry_value as i64
    } else {
        entry_value as i64 - position_value as i64
    };
    let equity = (position.collateral as i64 + pnl).max(0) as u64;

    let maintenance_requirement = position_value
        .checked_mul(MAINTENANCE_MARGIN_BPS)
        .and_then(|x| x.checked_div(BASIS_POINTS))
        .ok_or(SpaceError::InvalidAmount)?;
    require!(
        equity < maintenance_requirement,
        SpaceError::PositionNotLiquidatable
    );
    let liquidation_amount = position
        .shares
        .checked_mul(LIQUIDATION_STEP_BPS)
        .and_then(|x| x.checked_div(BASIS_POINTS))
        .ok_or(SpaceError::InvalidAmount)?;
    let liquidation_value = liquidation_amount
        .checked_mul(current_price)
        .and_then(|x| x.checked_div(BASIS_POINTS))
        .and_then(|x| x.checked_mul(scale))
        .ok_or(SpaceError::InvalidAmount)?;
    let penalty = liquidation_value
        .checked_mul(LIQUIDATION_PENALTY_BPS)
        .and_then(|x| x.checked_div(BASIS_POINTS))
        .ok_or(SpaceError::InvalidAmount)?;
    let position_notional = position
        .shares
        .checked_mul(position.avg_entry_price)
        .and_then(|x| x.checked_div(BASIS_POINTS))
        .and_then(|x| x.checked_mul(scale))
        .ok_or(SpaceError::InvalidAmount)?;
    let liquidation_notional = liquidation_amount
        .checked_mul(position.avg_entry_price)
        .and_then(|x| x.checked_div(BASIS_POINTS))
        .and_then(|x| x.checked_mul(scale))
        .ok_or(SpaceError::InvalidAmount)?;
    let margin_for_liquidation = if position_notional > 0 {
        ((position.collateral as u128)
            .saturating_mul(liquidation_notional as u128)
            / (position_notional as u128)) as u64
    } else {
        0
    };

    // Update position
    position.shares = position.shares.saturating_sub(liquidation_amount);
    position.collateral = position.collateral.saturating_sub(margin_for_liquidation);

    insurance.balance += penalty;
    let market_key = market.key();
    let vault_seeds = &[
        b"vault_authority",
        market_key.as_ref(),
        &[ctx.bumps.vault_authority],
    ];
    let vault_signer = &[&vault_seeds[..]];

    let penalty_transfer = Transfer {
        from: ctx.accounts.market_vault.to_account_info(),
        to: ctx.accounts.insurance_vault.to_account_info(),
        authority: ctx.accounts.vault_authority.to_account_info(),
    };
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            penalty_transfer,
            vault_signer,
        ),
        penalty,
    )?;
    let liquidator_reward = penalty / 2;

    let reward_transfer = Transfer {
        from: ctx.accounts.market_vault.to_account_info(),
        to: ctx.accounts.liquidator_usdc.to_account_info(),
        authority: ctx.accounts.vault_authority.to_account_info(),
    };
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            reward_transfer,
            vault_signer,
        ),
        liquidator_reward,
    )?;

    if position.shares == 0 {
        position.collateral = 0;
    }

    Ok(())
}
