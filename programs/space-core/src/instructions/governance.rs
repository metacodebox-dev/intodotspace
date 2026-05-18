// ============================================================================
// GOVERNANCE INSTRUCTIONS
// ============================================================================

use anchor_lang::prelude::*;

use crate::errors::SpaceError;
use crate::instructions::contexts::*;

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

pub fn pause_protocol(ctx: Context<AdminOnly>, paused: bool) -> Result<()> {
    ctx.accounts.config.paused = paused;
    Ok(())
}

pub fn initialize_oracle_registry(
    ctx: Context<InitializeOracleRegistry>,
    initial_oracles: Vec<Pubkey>,
) -> Result<()> {
    require!(initial_oracles.len() <= 10, SpaceError::TooManyOracles);
    ctx.accounts.oracle_registry.approved_oracles = initial_oracles;
    Ok(())
}

pub fn add_oracle(ctx: Context<AdminOnly>, oracle: Pubkey) -> Result<()> {
    let oracles = &mut ctx.accounts.oracle_registry.approved_oracles;
    require!(oracles.len() < 10, SpaceError::TooManyOracles);
    require!(!oracles.contains(&oracle), SpaceError::OracleAlreadyExists);
    oracles.push(oracle);
    Ok(())
}

pub fn remove_oracle(ctx: Context<AdminOnly>, oracle: Pubkey) -> Result<()> {
    let oracles = &mut ctx.accounts.oracle_registry.approved_oracles;
    let index = oracles
        .iter()
        .position(|&x| x == oracle)
        .ok_or(SpaceError::InvalidOracle)?;
    oracles.remove(index);
    Ok(())
}

pub fn initialize_insurance_fund(
    ctx: Context<InitializeInsuranceFund>,
    initial_balance: u64,
) -> Result<()> {
    ctx.accounts.insurance_fund.balance = initial_balance;
    Ok(())
}





