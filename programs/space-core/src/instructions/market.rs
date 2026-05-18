// ============================================================================
// MARKET MANAGEMENT INSTRUCTIONS
// ============================================================================

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Transfer};

use crate::constants::{DEFAULT_CREATOR_FEE_BPS, MIN_INITIAL_COLLATERAL};
use crate::errors::SpaceError;
use crate::instructions::contexts::*;
use crate::state::{Market, MarketOutcome, MarketStatus};

/// Initialize a new prediction market with outcome token mints.
///
/// Per Space docs: https://docs.into.space/en/architecture/spl-structure
/// - Each market has YES/NO SPL tokens
/// - Backed by USDC collateral
pub fn initialize_market(
    ctx: Context<InitializeMarket>,
    market_id: u64,
    title: String,
    description: String,
    category: u8,
    end_date: i64,
    outcome_labels: Vec<String>,
    initial_collateral: u64,
    resolution_type: u8, // 0 = Deterministic (TWAP), 1 = Oracle
) -> Result<()> {
    require!(
        outcome_labels.len() > 2 && outcome_labels.len() < 10,
        SpaceError::InvalidOutcomes
    );
    require!(
        initial_collateral >= MIN_INITIAL_COLLATERAL,
        SpaceError::InsufficientInitialLiquidity
    );

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
    market.resolved_outcome = None;
    market.resolution_source = None;
    market.resolve_slot = None;
    market.challenge_bond = 0;
    market.challenger = None;
    market.creator_fee_bps = DEFAULT_CREATOR_FEE_BPS;
    market.num_outcomes = outcome_labels.len() as u8;
    market.is_invalid = false;

    // Initialize outcomes (YES mints will be created lazily when minting shares)
    for (i, label) in outcome_labels.iter().enumerate() {
        market.outcomes.push(MarketOutcome {
            id: i as u8,
            label: label.clone(),
            last_price: 50,
        });
    }

    // Transfer initial collateral to vault
    let cpi_accounts = Transfer {
        from: ctx.accounts.market_vault.to_account_info() as AccountInfo,
        to: ctx.accounts.creator_usdc.to_account_info(),
        authority: ctx.accounts.creator.to_account_info(),
    };
    let cpi_ctx = CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts);
    token::transfer(cpi_ctx, initial_collateral)?;
    

    Ok(())
}





