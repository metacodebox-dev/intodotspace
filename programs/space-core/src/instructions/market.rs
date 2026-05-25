//! Market lifecycle: create, vault initialization, v1→v2 migration, and
//! adding outcomes to an existing market.
//!
//! Handler bodies copied verbatim from the original lib.rs.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::{invoke, invoke_signed};
use anchor_lang::solana_program::system_instruction;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use spl_token::instruction as token_instruction;

use crate::constants::{
    quote_scale, DEFAULT_CREATOR_FEE_BPS, MARKET_VERSION_V2, MAX_OUTCOME_LABEL_LEN,
    MIN_INITIAL_COLLATERAL,
};
use crate::errors::SpaceError;
use crate::state::{Config, Market, MarketOutcome, MarketStatus};

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct InitializeMarketCore<'info> {
    #[account(
        init,
        payer = creator,
        space = 8 + Market::LEN,
        seeds = [b"market", creator.key().as_ref(), &market_id.to_le_bytes()],
        bump
    )]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub creator: Signer<'info>,
    /// CHECK: Mint authority PDA
    #[account(seeds = [b"mint_authority", market.key().as_ref()], bump)]
    pub mint_authority: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct InitializeMarketVaults<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub creator: Signer<'info>,
    #[account(mut)]
    pub creator_usdc: Account<'info, TokenAccount>,
    pub usdc_mint: Account<'info, Mint>,
    /// CHECK: Vault authority PDA
    #[account(seeds = [b"vault_authority", market.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    /// CHECK: Market vault - will be initialized
    #[account(mut)]
    pub market_vault: UncheckedAccount<'info>,
    /// CHECK: Margin vault authority PDA
    #[account(seeds = [b"margin_vault_authority", market.key().as_ref()], bump)]
    pub margin_vault_authority: UncheckedAccount<'info>,
    /// CHECK: Margin vault - will be initialized
    #[account(mut)]
    pub margin_vault: UncheckedAccount<'info>,
    /// CHECK: Liquidity vault authority PDA
    #[account(seeds = [b"liquidity_vault_authority", market.key().as_ref()], bump)]
    pub liquidity_vault_authority: UncheckedAccount<'info>,
    /// CHECK: Liquidity vault - will be initialized
    #[account(mut)]
    pub liquidity_vault: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct MigrateMarketV1ToV2<'info> {
    /// CHECK: Taken as AccountInfo so we can realloc and backfill the v2
    /// fields (quote_mint, quote_decimals, version) before any Anchor-level
    /// deserialization attempts to read them from out-of-bounds bytes on a
    /// pre-v2 allocation. Market discriminator is validated by
    /// Market::try_deserialize inside the handler.
    #[account(mut)]
    pub market: AccountInfo<'info>,
    /// Quote mint to record on the migrated market. Caller must pass the mint
    /// that matches the token the market's vaults were actually created with;
    /// a mismatch will cause subsequent token transfers to fail at runtime.
    pub quote_mint: Account<'info, Mint>,
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    /// Either the market's `creator` or `config.admin`; verified in handler
    /// after the market struct is deserialized.
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AddMarketOutcome<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub authority: Signer<'info>,
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    /// CHECK: Mint authority PDA
    #[account(seeds = [b"mint_authority", market.key().as_ref()], bump)]
    pub mint_authority: UncheckedAccount<'info>,
    pub system_program: Program<'info, System>,
    pub token_program: Program<'info, Token>,
    pub rent: Sysvar<'info, Rent>,
}

pub fn initialize_market_core(
    ctx: Context<InitializeMarketCore>,
    market_id: u64,
    title: String,
    description: String,
    category: u8,
    end_date: i64,
    outcome_labels: Vec<String>,
    resolution_type: u8,
) -> Result<()> {
    require!(
        outcome_labels.len() >= 2 && outcome_labels.len() <= 10,
        SpaceError::InvalidOutcomes
    );

    for label in &outcome_labels {
        require!(
            label.len() <= MAX_OUTCOME_LABEL_LEN,
            SpaceError::LabelTooLong
        );
    }

    let market = &mut ctx.accounts.market;
    let clock = Clock::get()?;

    market.creator = ctx.accounts.creator.key();
    market.market_id = market_id;
    market.title = title;
    market.description = description;
    market.category = category;
    market.status = MarketStatus::Active as u8;
    market.resolution_type = resolution_type;
    market.end_date = end_date;
    market.created_at = clock.unix_timestamp;
    market.total_volume = 0;
    market.total_minted = 0;
    market.total_maker_rewards = 0;
    market.total_leverage_provided = 0;
    market.resolved_outcome = None;
    market.resolution_source = None;
    market.resolve_slot = None;
    market.resolve_timestamp = None;
    market.challenge_bond = 0;
    market.challenger = None;
    market.challenge_timestamp = None;
    market.creator_fee_bps = DEFAULT_CREATOR_FEE_BPS;
    market.num_outcomes = outcome_labels.len() as u8;
    market.is_invalid = false;
    market.price_snapshots = Vec::new();

    for (i, label) in outcome_labels.iter().enumerate() {
        market.outcomes.push(MarketOutcome {
            id: i as u8,
            label: label.clone(),
            last_price: 5000,
        });
    }

    // Per-outcome NO mints: set sentinel value to indicate new model
    market.no_mint = Pubkey::default();

    // Initialize YES mints AND NO mints via remaining accounts
    // Layout: [0..N) = YES mints, [N..2N) = NO mints, [2N] = creator, [2N+1] = token_program, [2N+2] = system_program
    let num_outcomes = outcome_labels.len();
    let expected_remaining = (2 * num_outcomes) + 3;
    if ctx.remaining_accounts.len() >= expected_remaining {
        let market_key = market.key();
        let rent = Rent::get()?;
        let mint_space: usize = 82;
        let mint_lamports = rent.minimum_balance(mint_space);

        let creator_key = ctx.accounts.creator.key();
        let token_program_key = ctx.accounts.token_program.key();
        let mint_authority_key = ctx.accounts.mint_authority.key();
        let program_id = *ctx.program_id;

        // Create YES mints (indices 0..num_outcomes)
        for i in 0..num_outcomes {
            let yes_mint_info = &ctx.remaining_accounts[i];
            let yes_mint_seeds: &[&[u8]] = &[b"yes_mint", market_key.as_ref(), &[i as u8]];
            let (expected_yes_mint, bump) =
                Pubkey::find_program_address(yes_mint_seeds, &program_id);
            require!(
                yes_mint_info.key() == expected_yes_mint,
                SpaceError::InvalidOutcome
            );

            let bump_slice = &[bump];
            let signer_seeds: &[&[u8]] =
                &[b"yes_mint", market_key.as_ref(), &[i as u8], bump_slice];

            let creator_info = ctx.remaining_accounts[2 * num_outcomes].clone();
            let yes_mint_info_clone = ctx.remaining_accounts[i].clone();
            let system_program_info = ctx.remaining_accounts[2 * num_outcomes + 2].clone();

            invoke_signed(
                &system_instruction::create_account(
                    &creator_key,
                    &yes_mint_info.key(),
                    mint_lamports,
                    mint_space as u64,
                    &token_program_key,
                ),
                &[
                    creator_info,
                    yes_mint_info_clone.clone(),
                    system_program_info,
                ],
                &[signer_seeds],
            )?;

            invoke_signed(
                &token_instruction::initialize_mint2(
                    &token_program_key,
                    &yes_mint_info.key(),
                    &mint_authority_key,
                    None,
                    6,
                )?,
                &[yes_mint_info_clone],
                &[],
            )?;
        }

        // Create NO mints (indices num_outcomes..2*num_outcomes)
        for i in 0..num_outcomes {
            let no_mint_info = &ctx.remaining_accounts[num_outcomes + i];
            let no_mint_seeds: &[&[u8]] = &[b"no_mint", market_key.as_ref(), &[i as u8]];
            let (expected_no_mint, bump) =
                Pubkey::find_program_address(no_mint_seeds, &program_id);
            require!(
                no_mint_info.key() == expected_no_mint,
                SpaceError::InvalidOutcome
            );

            let bump_slice = &[bump];
            let signer_seeds: &[&[u8]] =
                &[b"no_mint", market_key.as_ref(), &[i as u8], bump_slice];

            let creator_info = ctx.remaining_accounts[2 * num_outcomes].clone();
            let no_mint_info_clone = ctx.remaining_accounts[num_outcomes + i].clone();
            let system_program_info = ctx.remaining_accounts[2 * num_outcomes + 2].clone();

            invoke_signed(
                &system_instruction::create_account(
                    &creator_key,
                    &no_mint_info.key(),
                    mint_lamports,
                    mint_space as u64,
                    &token_program_key,
                ),
                &[
                    creator_info,
                    no_mint_info_clone.clone(),
                    system_program_info,
                ],
                &[signer_seeds],
            )?;

            invoke_signed(
                &token_instruction::initialize_mint2(
                    &token_program_key,
                    &no_mint_info.key(),
                    &mint_authority_key,
                    None,
                    6,
                )?,
                &[no_mint_info_clone],
                &[],
            )?;
        }
    }

    Ok(())
}

pub fn initialize_market_vaults(
    ctx: Context<InitializeMarketVaults>,
    initial_collateral: u64,
) -> Result<()> {
    // MIN_INITIAL_COLLATERAL is denominated in 6-decimal USDC ($1000).
    // For markets whose quote mint has more decimals (e.g. SPACE, 9 dec)
    // scale the minimum so the required "1000 units of quote" still holds.
    // The parameter is named `usdc_mint` for legacy reasons but functions
    // as the generic quote mint — vault accounts are initialized with it.
    let min_required = MIN_INITIAL_COLLATERAL
        .checked_mul(quote_scale(ctx.accounts.usdc_mint.decimals))
        .ok_or(SpaceError::InvalidAmount)?;
    require!(
        initial_collateral >= min_required,
        SpaceError::InsufficientInitialLiquidity
    );
    require!(
        ctx.accounts.market.status == MarketStatus::Active as u8,
        SpaceError::MarketNotActive
    );
    require!(
        ctx.accounts.market.creator == ctx.accounts.creator.key(),
        SpaceError::Unauthorized
    );

    let market_key = ctx.accounts.market.key();
    let rent = Rent::get()?;
    let token_program_key = ctx.accounts.token_program.key();
    let program_id = *ctx.program_id;
    let creator_key = ctx.accounts.creator.key();
    let usdc_mint_key = ctx.accounts.usdc_mint.key();
    let space = 165;
    let lamports = rent.minimum_balance(space);

    // Validate PDAs
    let (vault_authority, _) =
        Pubkey::find_program_address(&[b"vault_authority", market_key.as_ref()], &program_id);
    require!(
        ctx.accounts.vault_authority.key() == vault_authority,
        SpaceError::InvalidOutcome
    );

    let (margin_vault_authority, _) = Pubkey::find_program_address(
        &[b"margin_vault_authority", market_key.as_ref()],
        &program_id,
    );
    require!(
        ctx.accounts.margin_vault_authority.key() == margin_vault_authority,
        SpaceError::InvalidOutcome
    );

    let (liquidity_vault_authority, _) = Pubkey::find_program_address(
        &[b"liquidity_vault_authority", market_key.as_ref()],
        &program_id,
    );
    require!(
        ctx.accounts.liquidity_vault_authority.key() == liquidity_vault_authority,
        SpaceError::InvalidOutcome
    );

    // Create market vault
    let (expected_market_vault, market_vault_bump) =
        Pubkey::find_program_address(&[b"vault", market_key.as_ref()], &program_id);
    require!(
        ctx.accounts.market_vault.key() == expected_market_vault,
        SpaceError::InvalidOutcome
    );
    let market_vault_signers: &[&[u8]] = &[b"vault", market_key.as_ref(), &[market_vault_bump]];

    invoke_signed(
        &system_instruction::create_account(
            &creator_key,
            &ctx.accounts.market_vault.key(),
            lamports,
            space as u64,
            &token_program_key,
        ),
        &[
            ctx.accounts.creator.to_account_info(),
            ctx.accounts.market_vault.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        &[market_vault_signers],
    )?;
    invoke_signed(
        &token_instruction::initialize_account3(
            &token_program_key,
            &ctx.accounts.market_vault.key(),
            &usdc_mint_key,
            &vault_authority,
        )?,
        &[
            ctx.accounts.market_vault.to_account_info(),
            ctx.accounts.usdc_mint.to_account_info(),
        ],
        &[],
    )?;

    // Create margin vault
    let (expected_margin_vault, margin_vault_bump) =
        Pubkey::find_program_address(&[b"margin_vault", market_key.as_ref()], &program_id);
    require!(
        ctx.accounts.margin_vault.key() == expected_margin_vault,
        SpaceError::InvalidOutcome
    );
    let margin_vault_signers: &[&[u8]] =
        &[b"margin_vault", market_key.as_ref(), &[margin_vault_bump]];

    invoke_signed(
        &system_instruction::create_account(
            &creator_key,
            &ctx.accounts.margin_vault.key(),
            lamports,
            space as u64,
            &token_program_key,
        ),
        &[
            ctx.accounts.creator.to_account_info(),
            ctx.accounts.margin_vault.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        &[margin_vault_signers],
    )?;
    invoke_signed(
        &token_instruction::initialize_account3(
            &token_program_key,
            &ctx.accounts.margin_vault.key(),
            &usdc_mint_key,
            &margin_vault_authority,
        )?,
        &[
            ctx.accounts.margin_vault.to_account_info(),
            ctx.accounts.usdc_mint.to_account_info(),
        ],
        &[],
    )?;

    // Create liquidity vault
    let (expected_liquidity_vault, liquidity_vault_bump) =
        Pubkey::find_program_address(&[b"liquidity_vault", market_key.as_ref()], &program_id);
    require!(
        ctx.accounts.liquidity_vault.key() == expected_liquidity_vault,
        SpaceError::InvalidOutcome
    );
    let liquidity_vault_signers: &[&[u8]] = &[
        b"liquidity_vault",
        market_key.as_ref(),
        &[liquidity_vault_bump],
    ];

    invoke_signed(
        &system_instruction::create_account(
            &creator_key,
            &ctx.accounts.liquidity_vault.key(),
            lamports,
            space as u64,
            &token_program_key,
        ),
        &[
            ctx.accounts.creator.to_account_info(),
            ctx.accounts.liquidity_vault.to_account_info(),
            ctx.accounts.system_program.to_account_info(),
        ],
        &[liquidity_vault_signers],
    )?;
    invoke_signed(
        &token_instruction::initialize_account3(
            &token_program_key,
            &ctx.accounts.liquidity_vault.key(),
            &usdc_mint_key,
            &liquidity_vault_authority,
        )?,
        &[
            ctx.accounts.liquidity_vault.to_account_info(),
            ctx.accounts.usdc_mint.to_account_info(),
        ],
        &[],
    )?;

    // Transfer initial collateral
    let cpi_accounts = Transfer {
        from: ctx.accounts.creator_usdc.to_account_info(),
        to: ctx.accounts.market_vault.to_account_info(),
        authority: ctx.accounts.creator.to_account_info(),
    };
    token::transfer(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
        initial_collateral,
    )?;

    // v2: record the quote token so downstream ixs don't depend on a hardcoded USDC.
    let market = &mut ctx.accounts.market;
    market.quote_mint = ctx.accounts.usdc_mint.key();
    market.quote_decimals = ctx.accounts.usdc_mint.decimals;
    market.version = MARKET_VERSION_V2;

    Ok(())
}

pub fn migrate_market_v1_to_v2(ctx: Context<MigrateMarketV1ToV2>) -> Result<()> {
    let market_ai = ctx.accounts.market.to_account_info();
    let new_size = 8 + Market::LEN;
    let old_size = market_ai.data_len();

    // Pre-v2 accounts were allocated without the new trailing fields; grow
    // them and zero-init the tail so Borsh reads defaults for new fields.
    if old_size < new_size {
        let rent = Rent::get()?;
        let required_lamports = rent.minimum_balance(new_size);
        let current_lamports = market_ai.lamports();
        if current_lamports < required_lamports {
            let top_up = required_lamports - current_lamports;
            invoke(
                &system_instruction::transfer(
                    ctx.accounts.admin.key,
                    market_ai.key,
                    top_up,
                ),
                &[
                    ctx.accounts.admin.to_account_info(),
                    market_ai.clone(),
                    ctx.accounts.system_program.to_account_info(),
                ],
            )?;
        }
        market_ai.realloc(new_size, true)?;
    }

    let mut data = market_ai.try_borrow_mut_data()?;
    let mut market = Market::try_deserialize(&mut &data[..])?;

    // Signer must be either the market's own creator or the config admin.
    let signer_key = ctx.accounts.admin.key();
    require!(
        signer_key == market.creator || signer_key == ctx.accounts.config.admin,
        SpaceError::Unauthorized
    );

    require!(
        market.version != MARKET_VERSION_V2,
        SpaceError::AlreadyMigrated
    );

    market.quote_mint = ctx.accounts.quote_mint.key();
    market.quote_decimals = ctx.accounts.quote_mint.decimals;
    market.version = MARKET_VERSION_V2;

    let mut writer: &mut [u8] = &mut data;
    market.try_serialize(&mut writer)?;

    Ok(())
}

pub fn add_market_outcome(
    ctx: Context<AddMarketOutcome>,
    label: String,
) -> Result<()> {
    require!(!ctx.accounts.config.paused, SpaceError::ProtocolPaused);

    let market = &mut ctx.accounts.market;

    // Only works on new model (per-outcome NO mints)
    require!(
        market.no_mint == Pubkey::default(),
        SpaceError::InvalidOutcomes
    );

    // Market must be active
    require!(
        market.status == MarketStatus::Active as u8,
        SpaceError::MarketNotActive
    );

    // Only admin or market creator can add outcomes
    require!(
        ctx.accounts.authority.key() == market.creator
            || ctx.accounts.authority.key() == ctx.accounts.config.admin,
        SpaceError::Unauthorized
    );

    // Max 10 outcomes (space is pre-allocated)
    require!(market.num_outcomes < 10, SpaceError::InvalidOutcomes);
    require!(label.len() <= MAX_OUTCOME_LABEL_LEN, SpaceError::LabelTooLong);

    let new_outcome_id = market.num_outcomes;
    let market_key = market.key();
    let program_id = *ctx.program_id;

    // remaining_accounts: [yes_mint, no_mint, creator, token_program, system_program]
    require!(ctx.remaining_accounts.len() >= 5, SpaceError::InvalidOutcomes);

    let rent = Rent::get()?;
    let mint_space: usize = 82;
    let mint_lamports = rent.minimum_balance(mint_space);
    let creator_key = ctx.accounts.authority.key();
    let token_program_key = ctx.accounts.token_program.key();
    let mint_authority_key = ctx.accounts.mint_authority.key();

    // Create YES mint for new outcome
    let yes_mint_info = &ctx.remaining_accounts[0];
    let yes_mint_seeds: &[&[u8]] = &[b"yes_mint", market_key.as_ref(), &[new_outcome_id]];
    let (expected_yes_mint, yes_bump) =
        Pubkey::find_program_address(yes_mint_seeds, &program_id);
    require!(
        yes_mint_info.key() == expected_yes_mint,
        SpaceError::InvalidOutcome
    );

    let yes_bump_slice = &[yes_bump];
    let yes_signer_seeds: &[&[u8]] =
        &[b"yes_mint", market_key.as_ref(), &[new_outcome_id], yes_bump_slice];

    invoke_signed(
        &system_instruction::create_account(
            &creator_key,
            &yes_mint_info.key(),
            mint_lamports,
            mint_space as u64,
            &token_program_key,
        ),
        &[
            ctx.remaining_accounts[2].clone(),
            yes_mint_info.clone(),
            ctx.remaining_accounts[4].clone(),
        ],
        &[yes_signer_seeds],
    )?;

    invoke_signed(
        &token_instruction::initialize_mint2(
            &token_program_key,
            &yes_mint_info.key(),
            &mint_authority_key,
            None,
            6,
        )?,
        &[yes_mint_info.clone()],
        &[],
    )?;

    // Create NO mint for new outcome
    let no_mint_info = &ctx.remaining_accounts[1];
    let no_mint_seeds: &[&[u8]] = &[b"no_mint", market_key.as_ref(), &[new_outcome_id]];
    let (expected_no_mint, no_bump) =
        Pubkey::find_program_address(no_mint_seeds, &program_id);
    require!(
        no_mint_info.key() == expected_no_mint,
        SpaceError::InvalidOutcome
    );

    let no_bump_slice = &[no_bump];
    let no_signer_seeds: &[&[u8]] =
        &[b"no_mint", market_key.as_ref(), &[new_outcome_id], no_bump_slice];

    invoke_signed(
        &system_instruction::create_account(
            &creator_key,
            &no_mint_info.key(),
            mint_lamports,
            mint_space as u64,
            &token_program_key,
        ),
        &[
            ctx.remaining_accounts[2].clone(),
            no_mint_info.clone(),
            ctx.remaining_accounts[4].clone(),
        ],
        &[no_signer_seeds],
    )?;

    invoke_signed(
        &token_instruction::initialize_mint2(
            &token_program_key,
            &no_mint_info.key(),
            &mint_authority_key,
            None,
            6,
        )?,
        &[no_mint_info.clone()],
        &[],
    )?;

    // Add outcome to market state
    market.outcomes.push(MarketOutcome {
        id: new_outcome_id,
        label,
        last_price: 5000, // Default 50%
    });
    market.num_outcomes += 1;

    msg!("Added outcome {} to market. Total outcomes: {}", new_outcome_id, market.num_outcomes);
    Ok(())
}
