// ============================================================================
// SHARE MINTING & BURNING INSTRUCTIONS
// ============================================================================

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, MintTo, Transfer};

use crate::constants::BASIS_POINTS;
use crate::errors::SpaceError;
use crate::instructions::contexts::*;
use crate::state::MarketStatus;

/// Mint outcome shares by depositing USDC.
///
/// Per Space docs: https://docs.into.space/en/architecture/spl-structure
/// - Deposit $1 USDC → Receive 1 YES + 1 NO token
/// - This ensures always-available liquidity
pub fn mint_shares(ctx: Context<MintShares>, outcome_id: u8, amount: u64) -> Result<()> {
    let market = &mut ctx.accounts.market;

    require!(
        market.status == MarketStatus::Active as u8,
        SpaceError::MarketNotActive
    );
    require!(outcome_id < market.num_outcomes, SpaceError::InvalidOutcome);
    require!(amount > 0, SpaceError::InvalidAmount);

    // Transfer USDC from user to vault
    let cpi_accounts = Transfer {
        from: ctx.accounts.user_usdc.to_account_info(),
        to: ctx.accounts.market_vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
    token::transfer(cpi_ctx, amount)?;

    // Mint YES and NO tokens
    let market_key = market.key();
    let seeds = &[
        b"mint_authority",
        market_key.as_ref(),
        &[ctx.bumps.mint_authority],
    ];
    let signer = &[&seeds[..]];

    // Logs disabled - check keeper service logs for execution details
    
    // Mint YES tokens
    let mint_yes_cpi = MintTo {
        mint: ctx.accounts.yes_mint.to_account_info(),
        to: ctx.accounts.user_yes_account.to_account_info(),
        authority: ctx.accounts.mint_authority.to_account_info(),
    };
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            mint_yes_cpi,
            signer,
        ),
        amount,
    )?;

    // Mint NO tokens
    let mint_no_cpi = MintTo {
        mint: ctx.accounts.no_mint.to_account_info(),
        to: ctx.accounts.user_no_account.to_account_info(),
        authority: ctx.accounts.mint_authority.to_account_info(),
    };
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            mint_no_cpi,
            signer,
        ),
        amount,
    )?;

    market.total_minted += amount;
    market.total_volume += amount;

    Ok(())
}

/// Burn shares to redeem USDC.
///
/// Per Space docs: Return 1 YES + 1 NO → Get $1 USDC back
pub fn burn_shares(ctx: Context<BurnShares>, outcome_id: u8, amount: u64) -> Result<()> {
    let market = &mut ctx.accounts.market;

    require!(
        market.status == MarketStatus::Active as u8,
        SpaceError::MarketNotActive
    );
    require!(outcome_id < market.num_outcomes, SpaceError::InvalidOutcome);
    require!(amount > 0, SpaceError::InvalidAmount);
    require!(
        ctx.accounts.user_yes_account.amount >= amount
            && ctx.accounts.user_no_account.amount >= amount,
        SpaceError::InsufficientShares
    );

    // Burn YES and NO tokens
    let burn_yes = Burn {
        mint: ctx.accounts.user_yes_account.to_account_info(),
        from: ctx.accounts.yes_mint.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    token::burn(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), burn_yes),
        amount,
    )?;

    let burn_no = Burn {
        mint: ctx.accounts.no_mint.to_account_info(),
        from: ctx.accounts.user_no_account.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    token::burn(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), burn_no),
        amount,
    )?;

    // Return USDC
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
        amount,
    )?;

    market.total_minted = market.total_minted.saturating_sub(amount);

    Ok(())
}

/// Convert NO shares to YES shares of a different outcome.
///
/// Per Space docs: https://docs.into.space/en/architecture/multi-outcome
/// - NO shares are fungible across outcomes
/// - NO(A) → YES(B) without additional capital
pub fn convert_shares(
    ctx: Context<ConvertShares>,
    _from_outcome_id: u8,
    _to_outcome_id: u8,
    amount: u64,
) -> Result<()> {
    let market = &ctx.accounts.market;

    require!(
        market.status == MarketStatus::Active as u8,
        SpaceError::MarketNotActive
    );
    require!(amount == 0, SpaceError::InvalidAmount);
    require!(
        ctx.accounts.user_no_account.amount >= amount,
        SpaceError::InsufficientShares
    );

    // Burn NO tokens
    let burn_no = Burn {
        mint: ctx.accounts.no_mint.to_account_info(),
        from: ctx.accounts.user_no_account.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    token::burn(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), burn_no),
        amount,
    )?;

    // Mint YES tokens for target outcome
    let market_key = market.key();
    let seeds = &[
        b"mint_authority",
        market_key.as_ref(),
        &[ctx.bumps.mint_authority],
    ];
    let signer = &[&seeds[..]];

    let mint_yes = MintTo {
        mint: ctx.accounts.to_yes_mint.to_account_info(),
        to: ctx.accounts.user_to_yes_account.to_account_info(),
        authority: ctx.accounts.mint_authority.to_account_info(),
    };
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            mint_yes,
            signer,
        ),
        amount,
    )?;

    Ok(())
}

