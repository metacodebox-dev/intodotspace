//! Protocol singleton initialization: Config, InsuranceFund, OracleRegistry,
//! and adding entries to the oracle registry.
//!
//! All handler bodies are copied verbatim from the original lib.rs.

use anchor_lang::prelude::*;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};

use crate::errors::SpaceError;
use crate::state::{Config, InsuranceFund, OracleRegistry};

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(init, payer = admin, space = 8 + Config::LEN, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeInsuranceFund<'info> {
    #[account(init, payer = admin, space = 8 + InsuranceFund::LEN, seeds = [b"insurance_fund"], bump)]
    pub insurance_fund: Account<'info, InsuranceFund>,
    #[account(
        init,
        payer = admin,
        token::mint = usdc_mint,
        token::authority = insurance_authority,
        seeds = [b"insurance_vault"],
        bump
    )]
    pub insurance_vault: Account<'info, TokenAccount>,
    /// CHECK: Insurance authority PDA
    #[account(seeds = [b"insurance_authority"], bump)]
    pub insurance_authority: UncheckedAccount<'info>,
    pub usdc_mint: Account<'info, Mint>,
    #[account(mut)]
    pub admin: Signer<'info>,
    #[account(mut)]
    pub admin_usdc: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
pub struct InitializeOracleRegistry<'info> {
    #[account(
        init,
        payer = admin,
        space = 8 + OracleRegistry::LEN,
        seeds = [b"oracle_registry"],
        bump
    )]
    pub oracle_registry: Account<'info, OracleRegistry>,
    #[account(seeds = [b"config"], bump, has_one = admin)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AddApprovedOracle<'info> {
    #[account(mut, seeds = [b"oracle_registry"], bump)]
    pub oracle_registry: Account<'info, OracleRegistry>,
    #[account(seeds = [b"config"], bump, has_one = admin)]
    pub config: Account<'info, Config>,
    pub admin: Signer<'info>,
}

pub fn initialize_config(
    ctx: Context<InitializeConfig>,
    max_global_oi: u128,
    protocol_fee_bps: u64,
    creator_fee_bps: u64,
    insurance_fee_bps: u64,
) -> Result<()> {
    let config = &mut ctx.accounts.config;
    config.admin = ctx.accounts.admin.key();
    config.paused = false;
    config.max_global_oi = max_global_oi;
    config.protocol_fee_bps = protocol_fee_bps;
    config.creator_fee_bps = creator_fee_bps;
    config.insurance_fee_bps = insurance_fee_bps;
    Ok(())
}

pub fn initialize_insurance_fund(
    ctx: Context<InitializeInsuranceFund>,
    initial_balance: u64,
) -> Result<()> {
    ctx.accounts.insurance_fund.balance = initial_balance;
    let cpi_accounts = Transfer {
        from: ctx.accounts.admin_usdc.to_account_info(),
        to: ctx.accounts.insurance_vault.to_account_info(),
        authority: ctx.accounts.admin.to_account_info(),
    };
    token::transfer(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
        initial_balance,
    )?;
    Ok(())
}

pub fn initialize_oracle_registry(ctx: Context<InitializeOracleRegistry>) -> Result<()> {
    ctx.accounts.oracle_registry.approved_oracles = Vec::new();
    Ok(())
}

pub fn add_approved_oracle(ctx: Context<AddApprovedOracle>, oracle: Pubkey) -> Result<()> {
    let registry = &mut ctx.accounts.oracle_registry;
    if !registry.approved_oracles.contains(&oracle) {
        require!(
            registry.approved_oracles.len() < 10,
            SpaceError::InvalidAmount
        );
        registry.approved_oracles.push(oracle);
    }
    Ok(())
}
