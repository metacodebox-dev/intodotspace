//! Share-token primitives: mint complete YES/NO pairs against collateral,
//! burn pairs to redeem collateral, and (legacy markets only) convert NO
//! shares into YES shares for a different outcome.
//!
//! Handler bodies copied verbatim from the original lib.rs.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};

use crate::constants::quote_scale;
use crate::errors::SpaceError;
use crate::state::{Config, Market, MarketStatus};

#[derive(Accounts)]
#[instruction(outcome_id: u8)]
pub struct MintShares<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub user_usdc: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"yes_mint", market.key().as_ref(), &[outcome_id]], bump)]
    pub yes_mint: Account<'info, Mint>,
    /// NO mint: for new markets (per-outcome NO) validated in instruction body via PDA;
    /// for old markets validated against market.no_mint
    #[account(mut)]
    pub no_mint: Account<'info, Mint>,
    #[account(mut, constraint = user_yes_account.owner == user.key() @ SpaceError::TokenAccountOwnershipMismatch)]
    pub user_yes_account: Account<'info, TokenAccount>,
    #[account(mut, constraint = user_no_account.owner == user.key() @ SpaceError::TokenAccountOwnershipMismatch)]
    pub user_no_account: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"vault", market.key().as_ref()], bump)]
    pub market_vault: Account<'info, TokenAccount>,
    /// CHECK: Vault authority PDA
    #[account(seeds = [b"vault_authority", market.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    /// CHECK: Mint authority PDA
    #[account(seeds = [b"mint_authority", market.key().as_ref()], bump)]
    pub mint_authority: UncheckedAccount<'info>,
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(outcome_id: u8)]
pub struct BurnShares<'info> {
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
    #[account(mut, constraint = user_yes_account.owner == user.key() @ SpaceError::TokenAccountOwnershipMismatch)]
    pub user_yes_account: Account<'info, TokenAccount>,
    #[account(mut, constraint = user_no_account.owner == user.key() @ SpaceError::TokenAccountOwnershipMismatch)]
    pub user_no_account: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"vault", market.key().as_ref()], bump)]
    pub market_vault: Account<'info, TokenAccount>,
    /// CHECK: Vault authority PDA
    #[account(seeds = [b"vault_authority", market.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(to_outcome_id: u8)]
pub struct ConvertShares<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub user: Signer<'info>,
    /// NO mint: validated in instruction body
    #[account(mut)]
    pub no_mint: Account<'info, Mint>,
    #[account(mut, seeds = [b"yes_mint", market.key().as_ref(), &[to_outcome_id]], bump)]
    pub to_yes_mint: Account<'info, Mint>,
    #[account(mut, constraint = no_account.owner == user.key() @ SpaceError::TokenAccountOwnershipMismatch, constraint = no_account.mint == no_mint.key() @ SpaceError::TokenAccountMintMismatch)]
    pub no_account: Account<'info, TokenAccount>,
    #[account(mut, constraint = to_yes_account.owner == user.key() @ SpaceError::TokenAccountOwnershipMismatch)]
    pub to_yes_account: Account<'info, TokenAccount>,
    /// CHECK: Mint authority PDA
    #[account(seeds = [b"mint_authority", market.key().as_ref()], bump)]
    pub mint_authority: UncheckedAccount<'info>,
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    pub token_program: Program<'info, Token>,
}

pub fn mint_shares(ctx: Context<MintShares>, outcome_id: u8, amount: u64) -> Result<()> {
    // Check protocol is not paused
    require!(!ctx.accounts.config.paused, SpaceError::ProtocolPaused);

    let market = &mut ctx.accounts.market;
    require!(
        market.status == MarketStatus::Active as u8,
        SpaceError::MarketNotActive
    );
    require!(outcome_id < market.num_outcomes, SpaceError::InvalidOutcome);
    require!(amount > 0, SpaceError::InvalidAmount);

    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp < market.end_date,
        SpaceError::MarketNotActive
    );

    // Validate NO mint: per-outcome PDA for new markets, shared mint for old markets
    if market.no_mint == Pubkey::default() {
        // New model: per-outcome NO mint
        let (expected_no_mint, _) = Pubkey::find_program_address(
            &[b"no_mint", market.key().as_ref(), &[outcome_id]],
            ctx.program_id,
        );
        require!(
            ctx.accounts.no_mint.key() == expected_no_mint,
            SpaceError::TokenAccountMintMismatch
        );
    } else {
        // Old model: shared NO mint
        require!(
            ctx.accounts.no_mint.key() == market.no_mint,
            SpaceError::TokenAccountMintMismatch
        );
    }

    require!(
        ctx.accounts.user_yes_account.mint == ctx.accounts.yes_mint.key(),
        SpaceError::TokenAccountMintMismatch
    );
    require!(
        ctx.accounts.user_no_account.mint == ctx.accounts.no_mint.key(),
        SpaceError::TokenAccountMintMismatch
    );

    // `amount` is in share base units (6 decimals). Scale up to quote base
    // units when moving collateral so SPACE (9 dec) markets receive 1000x
    // the USDC figure; USDC markets (scale=1) stay byte-identical.
    let scale = quote_scale(market.quote_decimals);
    let quote_amount = amount
        .checked_mul(scale)
        .ok_or(SpaceError::InvalidAmount)?;

    let cpi_accounts = Transfer {
        from: ctx.accounts.user_usdc.to_account_info(),
        to: ctx.accounts.market_vault.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    token::transfer(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
        quote_amount,
    )?;

    // Mint YES and NO shares
    let market_key = market.key();
    let seeds = &[
        b"mint_authority",
        market_key.as_ref(),
        &[ctx.bumps.mint_authority],
    ];
    let signer = &[&seeds[..]];

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

    market.total_minted = market.total_minted.saturating_add(quote_amount);
    Ok(())
}

pub fn burn_shares(ctx: Context<BurnShares>, outcome_id: u8, amount: u64) -> Result<()> {
    // Check protocol is not paused
    require!(!ctx.accounts.config.paused, SpaceError::ProtocolPaused);

    let market = &mut ctx.accounts.market;
    require!(
        market.status == MarketStatus::Active as u8,
        SpaceError::MarketNotActive
    );
    require!(outcome_id < market.num_outcomes, SpaceError::InvalidOutcome);
    require!(amount > 0, SpaceError::InvalidAmount);

    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp < market.end_date,
        SpaceError::MarketNotActive
    );

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

    require!(
        ctx.accounts.user_yes_account.mint == ctx.accounts.yes_mint.key(),
        SpaceError::TokenAccountMintMismatch
    );
    require!(
        ctx.accounts.user_no_account.mint == ctx.accounts.no_mint.key(),
        SpaceError::TokenAccountMintMismatch
    );
    require!(
        ctx.accounts.user_yes_account.amount >= amount,
        SpaceError::InsufficientShares
    );
    require!(
        ctx.accounts.user_no_account.amount >= amount,
        SpaceError::InsufficientShares
    );

    // Burn YES and NO shares
    let burn_yes = Burn {
        mint: ctx.accounts.yes_mint.to_account_info(),
        from: ctx.accounts.user_yes_account.to_account_info(),
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

    let scale = quote_scale(market.quote_decimals);
    let quote_amount = amount
        .checked_mul(scale)
        .ok_or(SpaceError::InvalidAmount)?;

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
        quote_amount,
    )?;

    market.total_minted = market.total_minted.saturating_sub(quote_amount);
    Ok(())
}

pub fn convert_shares(
    ctx: Context<ConvertShares>,
    to_outcome_id: u8,
    amount: u64,
) -> Result<()> {
    // Check protocol is not paused
    require!(!ctx.accounts.config.paused, SpaceError::ProtocolPaused);

    let market = &ctx.accounts.market;

    // Disable conversion for new per-outcome NO model
    // With per-outcome NO mints, conversion is not needed (each outcome is independent)
    require!(
        market.no_mint != Pubkey::default(),
        SpaceError::InvalidOutcomes
    );

    // Validate NO mint for old model
    require!(
        ctx.accounts.no_mint.key() == market.no_mint,
        SpaceError::TokenAccountMintMismatch
    );

    require!(
        market.status == MarketStatus::Active as u8,
        SpaceError::MarketNotActive
    );

    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp < market.end_date,
        SpaceError::MarketNotActive
    );

    require!(
        to_outcome_id < market.num_outcomes,
        SpaceError::InvalidOutcome
    );
    require!(amount > 0, SpaceError::InvalidAmount);
    require!(market.num_outcomes > 2, SpaceError::InvalidOutcomes);

    require!(
        ctx.accounts.to_yes_account.mint == ctx.accounts.to_yes_mint.key(),
        SpaceError::TokenAccountMintMismatch
    );

    require!(
        ctx.accounts.no_account.amount >= amount,
        SpaceError::InsufficientSharesForConversion
    );

    // Burn NO tokens (shared across all outcomes)
    let burn_no = Burn {
        mint: ctx.accounts.no_mint.to_account_info(),
        from: ctx.accounts.no_account.to_account_info(),
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
        to: ctx.accounts.to_yes_account.to_account_info(),
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
