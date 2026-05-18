// ============================================================================
// MARKET RESOLUTION INSTRUCTIONS
// ============================================================================

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Transfer};

use crate::constants::{BASIS_POINTS, CHALLENGE_PERIOD_SLOTS, MAX_PRICE_CHANGE_PER_MINUTE_BPS, MIN_TWAP_SAMPLES};
use crate::errors::SpaceError;
use crate::instructions::contexts::*;
use crate::state::{MarketStatus, ResolutionType};

/// Submit TWAP data point for deterministic resolution.
///
/// Per Space docs: https://docs.into.space/en/resolution/deterministic
/// - 15-minute TWAP window
/// - Pyth Network primary, Switchboard fallback
/// - Max 1% price change per minute
pub fn submit_twap_data(
    ctx: Context<SubmitTwapData>,
    price: u64,
    timestamp: i64,
) -> Result<()> {
    let market = &ctx.accounts.market;
    let twap_state = &mut ctx.accounts.twap_state;

    require!(
        market.status == MarketStatus::Active as u8,
        SpaceError::MarketNotActive
    );
    require!(
        market.resolution_type == ResolutionType::Deterministic as u8,
        SpaceError::InvalidResolutionType
    );

    // Verify oracle is approved
    require!(
        ctx.accounts
            .oracle_registry
            .approved_oracles
            .contains(&ctx.accounts.oracle.key()),
        SpaceError::InvalidOracle
    );

    // Check price clamping (max 1% change per minute)
    if twap_state.sample_count > 0 {
        let last_price = twap_state.last_price;
        let max_change = (last_price * MAX_PRICE_CHANGE_PER_MINUTE_BPS) / BASIS_POINTS;
        require!(
            price <= last_price + max_change && price >= last_price.saturating_sub(max_change),
            SpaceError::PriceChangeExceeded
        );
    }

    // Add data point
    twap_state.total_price_time += price / 100; // Convert to 2 decimal places
    twap_state.total_time += 1;
    twap_state.sample_count += 1;
    twap_state.last_price = price;
    twap_state.last_timestamp = timestamp;

    Ok(())
}

/// Resolve market using TWAP.
///
/// Per Space docs: TWAP calculation over 15-minute window
pub fn resolve_deterministic(
    ctx: Context<ResolveDeterministic>,
    target_price: u64, // The price threshold for resolution
) -> Result<()> {
    let market =  &ctx.accounts.twap_state;
    let twap_state = &mut ctx.accounts.market;
    let clock = Clock::get()?;

    require!(
        market.status == MarketStatus::Active as u8,
        SpaceError::MarketNotActive
    );
    require!(
        market.resolution_type == ResolutionType::Deterministic as u8,
        SpaceError::InvalidResolutionType
    );
    require!(
        clock.unix_timestamp >= market.end_date,
        SpaceError::MarketNotEnded
    );
    require!(
        twap_state.sample_count > MIN_TWAP_SAMPLES,
        SpaceError::InsufficientTwapSamples
    );

    // Calculate TWAP
    let twap = twap_state.total_price_time / twap_state.total_time;

    // Determine winning outcome
    let winning_outcome = if twap >= target_price { 0 } else { 1 };

    market.status = MarketStatus::Resolving as u8;
    market.resolved_outcome = Some(winning_outcome);
    market.resolve_slot = Some(clock.slot);

    Ok(())
}

/// Resolve market via oracle (with multisig).
///
/// Per Space docs: https://docs.into.space/en/resolution/oracle
/// - 2-of-3 operator multisig
/// - Challenge period (24-48 hours)
pub fn resolve_oracle(
    ctx: Context<ResolveOracle>,
    winning_outcome_id: u8,
    evidence_hash: [u8; 32],
) -> Result<()> {
    let market = &mut ctx.accounts.market;
    let clock = Clock::get()?;

    require!(
        market.status == MarketStatus::Active as u8,
        SpaceError::MarketNotActive
    );
    require!(
        market.resolution_type == ResolutionType::Oracle as u8,
        SpaceError::InvalidResolutionType
    );
    require!(
        winning_outcome_id < market.num_outcomes,
        SpaceError::InvalidOutcome
    );
    require!(
        ctx.accounts
            .oracle_registry
            .approved_oracles
            .contains(&ctx.accounts.resolver.key()),
        SpaceError::InvalidOracle
    );
    require!(!ctx.accounts.config.paused, SpaceError::ProtocolPaused);

    market.status = MarketStatus::Resolving as u8;
    market.resolved_outcome = Some(winning_outcome_id);
    market.resolution_source = Some(ctx.accounts.resolver.key());
    market.resolve_slot = Some(clock.slot);
    market.evidence_hash = Some(evidence_hash);

    Ok(())
}

/// Challenge a market resolution.
///
/// Per Space docs: 24-48 hour challenge period
pub fn challenge_resolution(ctx: Context<ChallengeResolution>, bond_amount: u64) -> Result<()> {
    let market = &mut ctx.accounts.market;
    let clock = Clock::get()?;

    require!(
        market.status == MarketStatus::Resolving as u8,
        SpaceError::MarketNotResolving
    );

    // Check we're still in challenge period
    let resolve_slot = market.resolve_slot.ok_or(SpaceError::MarketNotResolving)?;
    require!(
        clock.slot <= resolve_slot + CHALLENGE_PERIOD_SLOTS,
        SpaceError::ChallengePeriodEnded
    );

    // Require minimum bond (1% of market collateral)
    let min_bond = market.total_minted / 100;
    require!(
        bond_amount >= min_bond,
        SpaceError::InsufficientChallengeBond
    );

    // Transfer bond
    let cpi_accounts = Transfer {
        from: ctx.accounts.challenger_usdc.to_account_info(),
        to: ctx.accounts.market_vault.to_account_info(),
        authority: ctx.accounts.challenger.to_account_info(),
    };
    token::transfer(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
        bond_amount,
    )?;

    market.status = MarketStatus::Disputed as u8;
    market.challenge_bond = bond_amount;
    market.challenger = Some(ctx.accounts.challenger.key());

    Ok(())
}

/// Mark market as invalid.
///
/// Per Space docs: https://docs.into.space/en/resolution/invalid
/// - Used when market cannot be resolved fairly
/// - All trades unwound, fees refunded
pub fn mark_invalid(ctx: Context<MarkInvalid>) -> Result<()> {
    let market = &mut ctx.accounts.market;

    require!(
        ctx.accounts.config.admin == ctx.accounts.admin.key(),
        SpaceError::Unauthorized
    );
    require!(
        market.status == MarketStatus::Disputed as u8,
        SpaceError::InvalidMarketStatus
    );

    market.status = MarketStatus::Invalid as u8;
    market.is_invalid = true;

    Ok(())
}

/// Finalize market after challenge period.
pub fn finalize_market(ctx: Context<FinalizeMarket>) -> Result<()> {
    let market = &mut ctx.accounts.market;
    let clock = Clock::get()?;

    require!(
        market.status == MarketStatus::Resolving as u8
            || market.status == MarketStatus::Disputed as u8,
        SpaceError::InvalidMarketStatus
    );

    let resolve_slot = market.resolve_slot.ok_or(SpaceError::MarketNotResolving)?;
    require!(
        clock.slot > resolve_slot + CHALLENGE_PERIOD_SLOTS,
        SpaceError::ChallengePeriodActive
    );

    market.status = MarketStatus::Finalized as u8;

    Ok(())
}

/// Redeem shares after market resolution.
///
/// Per Space docs:
/// - Winning shares = $1
/// - Losing shares = $0
pub fn redeem_shares(ctx: Context<RedeemShares>, outcome_id: u8) -> Result<()> {
    let market = &ctx.accounts.market;

    require!(
        market.status == MarketStatus::Finalized as u8,
        SpaceError::MarketNotFinalized
    );

    let winning_outcome = market.resolved_outcome.ok_or(SpaceError::InvalidOutcome)?;
    let yes_balance = ctx.accounts.user_yes_account.amount;
    let no_balance = ctx.accounts.user_no_account.amount;

    let mut payout: u64 = 0;

    // Calculate payout based on outcome
    if market.is_invalid {
        // Invalid market: return original value (YES + NO back)
        payout = yes_balance + no_balance;
    } else if outcome_id == winning_outcome {
        // YES shares of winning outcome = $1 each
        payout = yes_balance;
    } else if market.num_outcomes == 2 {
        // For binary markets: NO shares of losing outcome = $1
        payout = no_balance;
    }

    // Burn shares
    if yes_balance > 0 {
        let burn_yes = Burn {
            mint: ctx.accounts.yes_mint.to_account_info(),
            from: ctx.accounts.user_yes_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        token::burn(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), burn_yes),
            yes_balance,
        )?;
    }

    if no_balance > 0 {
        let burn_no = Burn {
            mint: ctx.accounts.no_mint.to_account_info(),
            from: ctx.accounts.user_no_account.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        token::burn(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), burn_no),
            no_balance,
        )?;
    }

    // Transfer payout
    if payout > 0 {
        let market_key = market.key();
        let vault_seeds = &[
            b"vault_authority",
            market_key.as_ref(),
            &[ctx.bumps.vault_authority],
        ];
        let vault_signer = &[&vault_seeds[..]];

        let transfer_cpi = Transfer {
            from: ctx.accounts.market_vault.to_account_info(),
            to: ctx.accounts.user_usdc.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                transfer_cpi,
                vault_signer,
            ),
            payout,
        )?;
    }

    Ok(())
}





