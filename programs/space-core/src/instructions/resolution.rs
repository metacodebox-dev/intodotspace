//! Market resolution lifecycle: oracle-driven resolve, finalize after the
//! challenge window, dispute, mark-invalid, and post-finalization share
//! redemption.
//!
//! Handler bodies copied verbatim from the original lib.rs.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};

use crate::constants::{quote_scale, CHALLENGE_PERIOD_SLOTS};
use crate::errors::SpaceError;
use crate::state::{
    Config, Market, MarketStatus, OracleRegistry, Position, PositionType, ResolutionType,
};

#[derive(Accounts)]
pub struct ResolveOracle<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(seeds = [b"oracle_registry"], bump)]
    pub oracle_registry: Account<'info, OracleRegistry>,
    pub resolver: Signer<'info>,
}

#[derive(Accounts)]
pub struct FinalizeMarket<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
pub struct ChallengeResolutionCtx<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub challenger: Signer<'info>,
    #[account(mut)]
    pub challenger_usdc: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"vault", market.key().as_ref()], bump)]
    pub market_vault: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct MarkInvalidCtx<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
#[instruction(outcome_id: u8)]
pub struct RedeemShares<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub user_usdc: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"yes_mint", market.key().as_ref(), &[outcome_id]], bump)]
    pub yes_mint: Account<'info, Mint>,
    /// NO mint: validated in instruction body (per-outcome PDA or shared)
    #[account(mut)]
    pub no_mint: Account<'info, Mint>,
    #[account(mut)]
    pub user_yes_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_no_account: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"vault", market.key().as_ref()], bump)]
    pub market_vault: Account<'info, TokenAccount>,
    /// CHECK: Vault authority PDA
    #[account(seeds = [b"vault_authority", market.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    /// CHECK: Liquidity vault for repaying borrowed amounts (may not be initialized for old markets)
    #[account(mut, seeds = [b"liquidity_vault", market.key().as_ref()], bump)]
    pub liquidity_vault: UncheckedAccount<'info>,
    /// CHECK: Liquidity vault authority PDA
    #[account(seeds = [b"liquidity_vault_authority", market.key().as_ref()], bump)]
    pub liquidity_vault_authority: UncheckedAccount<'info>,
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    pub token_program: Program<'info, Token>,
}

pub fn resolve_oracle(
    ctx: Context<ResolveOracle>,
    winning_outcome_id: u8,
    evidence_hash: [u8; 32],
) -> Result<()> {
    let market = &mut ctx.accounts.market;
    let config = &ctx.accounts.config;
    let clock = Clock::get()?;

    require!(
        market.resolution_type == ResolutionType::Oracle as u8,
        SpaceError::InvalidResolution
    );
    require!(
        market.status == MarketStatus::Active as u8,
        SpaceError::MarketNotActive
    );
    require!(
        market.resolved_outcome.is_none(),
        SpaceError::MarketAlreadyResolved
    );
    require!(
        winning_outcome_id < market.num_outcomes,
        SpaceError::InvalidOutcome
    );

    let is_admin = ctx.accounts.resolver.key() == config.admin;
    let is_creator = ctx.accounts.resolver.key() == market.creator;
    let is_approved = ctx
        .accounts
        .oracle_registry
        .approved_oracles
        .contains(&ctx.accounts.resolver.key());

    require!(
        is_admin || is_creator || is_approved,
        SpaceError::Unauthorized
    );
    require!(!config.paused, SpaceError::ProtocolPaused);

    market.resolved_outcome = Some(winning_outcome_id);
    market.status = MarketStatus::Resolving as u8;
    market.resolution_source = Some(ctx.accounts.resolver.key());
    market.resolve_slot = Some(clock.slot);
    market.evidence_hash = Some(evidence_hash);

    Ok(())
}

pub fn finalize_market(ctx: Context<FinalizeMarket>) -> Result<()> {
    let market = &mut ctx.accounts.market;
    let clock = Clock::get()?;

    require!(
        market.status == MarketStatus::Resolving as u8
            || market.status == MarketStatus::Disputed as u8,
        SpaceError::InvalidResolution
    );
    require!(
        market.resolved_outcome.is_some(),
        SpaceError::InvalidResolution
    );

    let resolve_slot = market.resolve_slot.ok_or(SpaceError::InvalidResolution)?;
    require!(
        clock.slot > resolve_slot + CHALLENGE_PERIOD_SLOTS,
        SpaceError::ChallengePeriodNotExpired
    );

    market.status = MarketStatus::Finalized as u8;
    Ok(())
}

pub fn challenge_resolution(
    ctx: Context<ChallengeResolutionCtx>,
    bond_amount: u64,
) -> Result<()> {
    let market = &mut ctx.accounts.market;
    let clock = Clock::get()?;

    require!(
        market.status == MarketStatus::Resolving as u8,
        SpaceError::InvalidResolution
    );
    require!(
        market.resolved_outcome.is_some(),
        SpaceError::InvalidResolution
    );
    require!(market.challenger.is_none(), SpaceError::InvalidResolution);

    let resolve_slot = market.resolve_slot.ok_or(SpaceError::InvalidResolution)?;
    require!(
        clock.slot <= resolve_slot + CHALLENGE_PERIOD_SLOTS,
        SpaceError::InvalidResolution
    );

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

pub fn mark_invalid(ctx: Context<MarkInvalidCtx>) -> Result<()> {
    let market = &mut ctx.accounts.market;
    let config = &ctx.accounts.config;

    require!(
        ctx.accounts.admin.key() == config.admin,
        SpaceError::Unauthorized
    );

    market.status = MarketStatus::Invalid as u8;
    market.is_invalid = true;

    Ok(())
}

/// Redeem winning shares after market finalization
pub fn redeem_shares(ctx: Context<RedeemShares>, outcome_id: u8) -> Result<()> {
    // Check protocol is not paused
    require!(!ctx.accounts.config.paused, SpaceError::ProtocolPaused);

    let market = &ctx.accounts.market;
    let user = ctx.accounts.user.key();
    let market_key = market.key();
    let program_id = ctx.program_id;

    // SECURITY CHECK 1: Market must be finalized
    require!(
        market.status == MarketStatus::Finalized as u8,
        SpaceError::MarketNotFinalized
    );

    // SECURITY CHECK 2: Validate outcome_id is valid
    let winning_outcome = market.resolved_outcome.ok_or(SpaceError::InvalidOutcome)?;
    if market.no_mint == Pubkey::default() {
        // New model: any outcome can be redeemed (winning YES or losing NO)
        require!(outcome_id < market.num_outcomes, SpaceError::InvalidOutcome);
    } else {
        // Old model: only winning outcome or binary losing outcome
        require!(
            outcome_id == winning_outcome
                || (market.num_outcomes == 2 && outcome_id != winning_outcome),
            SpaceError::InvalidOutcome
        );
    }

    // Validate NO mint: per-outcome PDA for new markets, shared mint for old markets
    if market.no_mint == Pubkey::default() {
        let (expected_no_mint, _) = Pubkey::find_program_address(
            &[b"no_mint", market.key().as_ref(), &[outcome_id]],
            ctx.program_id,
        );
        require!(
            ctx.accounts.no_mint.key() == expected_no_mint,
            SpaceError::TokenAccountMintMismatch
        );
    } else {
        require!(
            ctx.accounts.no_mint.key() == market.no_mint,
            SpaceError::TokenAccountMintMismatch
        );
    }

    // SECURITY CHECK 3: Calculate total borrowed amount from leveraged positions
    // Instead of blocking redemption, we'll automatically repay borrowed amounts from the payout
    // This allows users to claim winnings while ensuring vault is repaid
    let mut total_borrowed_amount: u64 = 0;
    let mut positions_to_close: Vec<(Pubkey, Position)> = Vec::new();

    // Check position accounts passed in remaining_accounts
    for account_info in ctx.remaining_accounts.iter() {
        // Try to deserialize as Position account (backward compat for old format)
        if let Ok(data) = account_info.try_borrow_data() {
            if data.len() >= Position::min_data_len() {
                if let Ok(position_data) = Position::deserialize_compat(&data[8..]) {
                    // Verify this position belongs to the user and market
                    if position_data.user == user
                        && position_data.market == market_key
                        && position_data.shares > 0
                        && position_data.borrowed_amount > 0
                    {
                        // Found leveraged position with debt - accumulate for repayment
                        let borrowed = position_data.borrowed_amount;
                        let outcome = position_data.outcome_id;
                        let side = position_data.side;
                        let shares = position_data.shares;
                        total_borrowed_amount = total_borrowed_amount.saturating_add(borrowed);
                        positions_to_close.push((account_info.key(), position_data));
                        msg!("Found leveraged position. Outcome: {}, Side: {}, Shares: {}, Borrowed: {} lamports. Will repay from redemption payout.",
                             outcome, side, shares, borrowed);
                    }
                }
            }
        }
    }

    // Also check by deriving expected PDAs (double-check in case accounts not passed)
    // Check all outcomes for Spot/Leveraged, both token types, and old PDA format
    for outcome_check in 0..market.num_outcomes {
        for side_check in 0..2u8 {
            for position_type_check in 0..2u8 {
                // Check new PDA format (with token_type) for both YES and NO
                // AND old PDA format (without token_type) for backward compat
                let mut pdas_to_check: Vec<Pubkey> = Vec::new();
                for token_type_check in 0..2u8 {
                    let (new_pda, _) = Pubkey::find_program_address(
                        &[b"position", user.as_ref(), market_key.as_ref(),
                          &[outcome_check], &[side_check], &[position_type_check], &[token_type_check]],
                        program_id,
                    );
                    pdas_to_check.push(new_pda);
                }
                // Old PDA format (without token_type)
                let (old_pda, _) = Pubkey::find_program_address(
                    &[b"position", user.as_ref(), market_key.as_ref(),
                      &[outcome_check], &[side_check], &[position_type_check]],
                    program_id,
                );
                pdas_to_check.push(old_pda);

                for expected_pda in &pdas_to_check {
                    let position_account_info = ctx.remaining_accounts.iter()
                        .find(|acc| acc.key() == *expected_pda);

                    if let Some(position_info) = position_account_info {
                        if let Ok(data) = position_info.try_borrow_data() {
                            if data.len() >= Position::min_data_len() {
                                if let Ok(position_data) = Position::deserialize_compat(&data[8..]) {
                                    if position_data.user == user
                                        && position_data.market == market_key
                                        && position_data.position_type == PositionType::Leveraged as u8
                                        && position_data.shares > 0
                                        && position_data.borrowed_amount > 0
                                    {
                                        if !positions_to_close.iter().any(|(pda, _)| *pda == position_info.key()) {
                                            let borrowed = position_data.borrowed_amount;
                                            let outcome = position_data.outcome_id;
                                            let side = position_data.side;
                                            total_borrowed_amount = total_borrowed_amount.saturating_add(borrowed);
                                            positions_to_close.push((position_info.key(), position_data));
                                            msg!("Found leveraged position via PDA check. Outcome: {}, Side: {}, Borrowed: {} lamports.", outcome, side, borrowed);
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    if total_borrowed_amount > 0 {
        msg!(
            "Total borrowed amount to repay: {} lamports from {} leveraged position(s)",
            total_borrowed_amount,
            positions_to_close.len()
        );
    }

    // SECURITY CHECK 4: Validate token account ownership
    require!(
        ctx.accounts.user_yes_account.owner == user,
        SpaceError::TokenAccountOwnershipMismatch
    );
    require!(
        ctx.accounts.user_no_account.owner == user,
        SpaceError::TokenAccountOwnershipMismatch
    );
    require!(
        ctx.accounts.user_usdc.owner == user,
        SpaceError::TokenAccountOwnershipMismatch
    );

    // SECURITY CHECK 5: Validate token account mints
    require!(
        ctx.accounts.user_yes_account.mint == ctx.accounts.yes_mint.key(),
        SpaceError::TokenAccountMintMismatch
    );
    require!(
        ctx.accounts.user_no_account.mint == ctx.accounts.no_mint.key(),
        SpaceError::TokenAccountMintMismatch
    );

    let yes_balance = ctx.accounts.user_yes_account.amount;
    let no_balance = ctx.accounts.user_no_account.amount;

    // SECURITY CHECK 6: Calculate payout and validate
    let mut payout_shares: u64 = 0;

    if market.is_invalid {
        // Invalid market: full refund of all shares
        payout_shares = yes_balance + no_balance;
    } else if market.no_mint == Pubkey::default() {
        // NEW MODEL (per-outcome NO): Polymarket-style payouts
        if outcome_id == winning_outcome {
            // Winning outcome: YES = $1, NO = $0
            payout_shares = yes_balance;
        } else {
            // Losing outcome: YES = $0, NO = $1
            payout_shares = no_balance;
        }
    } else {
        // OLD MODEL (shared NO): legacy behavior
        if outcome_id == winning_outcome {
            payout_shares = yes_balance;
        } else if market.num_outcomes == 2 {
            payout_shares = no_balance;
        }
        // Multi-outcome old model: losing = $0 (original behavior)
    }

    // Validate payout is reasonable
    require!(
        payout_shares > 0 || (yes_balance == 0 && no_balance == 0),
        SpaceError::InvalidAmount
    );

    // Convert share-denominated payout to quote base units before any vault
    // math; position.borrowed_amount is already stored in quote base units.
    let scale = quote_scale(market.quote_decimals);
    let payout = payout_shares
        .checked_mul(scale)
        .ok_or(SpaceError::InvalidAmount)?;

    // SECURITY CHECK 7: Validate vault has sufficient balance before any operations
    // Must have enough to cover both payout AND borrowed amounts
    let total_needed = payout.saturating_add(total_borrowed_amount);
    require!(
        ctx.accounts.market_vault.amount >= total_needed,
        SpaceError::InsufficientVaultBalance
    );

    // Burn YES shares
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

    // Burn NO shares
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

    // Step 1: Repay borrowed amounts to liquidity vault (if any)
    if total_borrowed_amount > 0 {
        // Validate liquidity_vault is a valid token account before using it
        require!(
            *ctx.accounts.liquidity_vault.owner == ctx.accounts.token_program.key(),
            SpaceError::InvalidPDA
        );

        let market_key = market.key();
        let vault_seeds = &[
            b"vault_authority",
            market_key.as_ref(),
            &[ctx.bumps.vault_authority],
        ];
        let vault_signer = &[&vault_seeds[..]];

        // Repay borrowed amount from market_vault to liquidity_vault
        let repay_cpi = Transfer {
            from: ctx.accounts.market_vault.to_account_info(),
            to: ctx.accounts.liquidity_vault.to_account_info(),
            authority: ctx.accounts.vault_authority.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                repay_cpi,
                vault_signer,
            ),
            total_borrowed_amount,
        )?;

        msg!(
            "Repaid {} lamports to liquidity vault from redemption payout",
            total_borrowed_amount
        );

        // Close positions by clearing their borrowed_amount (they'll be closed when shares are burned)
        // Note: Positions are effectively closed since shares are burned above
        // The position accounts will be closed in a future update or remain as zero balances
    }

    // Step 2: Transfer remaining payout to user (after repaying borrowed amounts)
    let user_payout = payout.saturating_sub(total_borrowed_amount.min(payout));

    if user_payout > 0 {
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
            user_payout,
        )?;

        msg!(
            "Redeemed {} USDC for outcome {} - Repaid {} borrowed, user received {}",
            payout,
            outcome_id,
            total_borrowed_amount,
            user_payout
        );
    } else if total_borrowed_amount > payout {
        msg!("Redeemed {} USDC for outcome {} - All payout ({}) used to repay borrowed amount ({})",
             payout, outcome_id, payout, total_borrowed_amount);
    }

    Ok(())
}
