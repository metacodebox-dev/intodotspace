// ============================================================================
// INSTRUCTION CONTEXTS
// ============================================================================

use anchor_lang::prelude::*;
use anchor_spl::associated_token::AssociatedToken;
use anchor_spl::token::{Mint, Token, TokenAccount};

use crate::state::*;

#[derive(Accounts)]
#[instruction(market_id: u64)]
pub struct InitializeMarket<'info> {
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

    #[account(mut)]
    pub creator_usdc: Account<'info, TokenAccount>,

    #[account(
        init,
        payer = creator,
        mint::decimals = 6,
        mint::authority = mint_authority,
        seeds = [b"no_mint", market.key().as_ref()],
        bump
    )]
    pub no_mint: Account<'info, Mint>,

    /// CHECK: Mint authority PDA
    #[account(seeds = [b"mint_authority", market.key().as_ref()], bump)]
    pub mint_authority: UncheckedAccount<'info>,

    #[account(
        init,
        payer = creator,
        token::mint = usdc_mint,
        token::authority = vault_authority,
        seeds = [b"vault", market.key().as_ref()],
        bump
    )]
    pub market_vault: Account<'info, TokenAccount>,

    /// CHECK: Vault authority PDA
    #[account(seeds = [b"vault_authority", market.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,

    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(outcome_id: u8)]
pub struct MintShares<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub user_usdc: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = user,
        mint::decimals = 6,
        mint::authority = mint_authority,
        seeds = [b"yes_mint", market.key().as_ref(), &[outcome_id]],
        bump
    )]
    pub yes_mint: Account<'info, Mint>,
    #[account(mut, constraint = no_mint.key() == market.no_mint)]
    pub no_mint: Account<'info, Mint>,
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = yes_mint,
        associated_token::authority = user
    )]
    pub user_yes_account: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = user,
        associated_token::mint = no_mint,
        associated_token::authority = user
    )]
    pub user_no_account: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"vault", market.key().as_ref()], bump)]
    pub market_vault: Account<'info, TokenAccount>,
    /// CHECK: Mint authority PDA
    #[account(seeds = [b"mint_authority", market.key().as_ref()], bump)]
    pub mint_authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub associated_token_program: Program<'info, AssociatedToken>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
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
    #[account(mut)]
    pub yes_mint: Account<'info, Mint>,
    #[account(mut, constraint = no_mint.key() == market.no_mint)]
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
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ConvertShares<'info> {
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut, constraint = no_mint.key() == market.no_mint)]
    pub no_mint: Account<'info, Mint>,
    #[account(mut)]
    pub to_yes_mint: Account<'info, Mint>,
    #[account(mut)]
    pub user_no_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub user_to_yes_account: Account<'info, TokenAccount>,
    /// CHECK: Mint authority PDA
    #[account(seeds = [b"mint_authority", market.key().as_ref()], bump)]
    pub mint_authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(order_id: u64)]
pub struct PlaceLimitOrder<'info> {
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub user_usdc: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = user,
        space = 8 + PendingOrder::LEN,
        seeds = [b"order", user.key().as_ref(), &order_id.to_le_bytes()],
        bump
    )]
    pub pending_order: Account<'info, PendingOrder>,
    #[account(
        init,
        payer = user,
        token::mint = usdc_mint,
        token::authority = order_escrow,
        seeds = [b"order_escrow", user.key().as_ref(), &order_id.to_le_bytes()],
        bump
    )]
    pub order_escrow: Account<'info, TokenAccount>,
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(order_id: u64)]
pub struct PlaceMarketOrder<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub user_usdc: Account<'info, TokenAccount>,
    #[account(
        init,
        payer = user,
        space = 8 + PendingOrder::LEN,
        seeds = [b"order", user.key().as_ref(), &order_id.to_le_bytes()],
        bump
    )]
    pub pending_order: Account<'info, PendingOrder>,
    #[account(
        init,
        payer = user,
        token::mint = usdc_mint,
        token::authority = order_escrow,
        seeds = [b"order_escrow", user.key().as_ref(), &order_id.to_le_bytes()],
        bump
    )]
    pub order_escrow: Account<'info, TokenAccount>,
    pub usdc_mint: Account<'info, Mint>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(buy_order_id: u64, sell_order_id: u64)]
pub struct ExecuteMatchedOrders<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub buy_order: Account<'info, PendingOrder>,
    #[account(mut)]
    pub sell_order: Account<'info, PendingOrder>,
    #[account(mut)]
    pub keeper: Signer<'info>,
    
    // Buyer accounts
    #[account(
        mut,
        seeds = [b"order_escrow", buy_order.user.as_ref(), &buy_order_id.to_le_bytes()],
        bump
    )]
    pub buy_order_escrow: Account<'info, TokenAccount>,
    #[account(mut)]
    pub buy_yes_mint: Account<'info, Mint>,
    #[account(mut, constraint = buy_no_mint.key() == market.no_mint)]
    pub buy_no_mint: Account<'info, Mint>,
    #[account(mut)]
    pub buy_user_yes_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub buy_user_no_account: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = keeper,
        space = 8 + Position::LEN,
        seeds = [b"position", buy_order.user.as_ref(), market.key().as_ref(), &[buy_order.outcome_id]],
        bump
    )]
    pub buy_position: Account<'info, Position>,
    
    // Seller accounts
    #[account(
        mut,
        seeds = [b"order_escrow", sell_order.user.as_ref(), &sell_order_id.to_le_bytes()],
        bump
    )]
    pub sell_order_escrow: Account<'info, TokenAccount>,
    #[account(mut)]
    pub sell_yes_mint: Account<'info, Mint>,
    #[account(mut, constraint = sell_no_mint.key() == market.no_mint)]
    pub sell_no_mint: Account<'info, Mint>,
    #[account(mut)]
    pub sell_user_yes_account: Account<'info, TokenAccount>,
    #[account(mut)]
    pub sell_user_no_account: Account<'info, TokenAccount>,
    #[account(
        init_if_needed,
        payer = keeper,
        space = 8 + Position::LEN,
        seeds = [b"position", sell_order.user.as_ref(), market.key().as_ref(), &[sell_order.outcome_id]],
        bump
    )]
    pub sell_position: Account<'info, Position>,
    
    // Market accounts
    #[account(mut)]
    pub market_vault: Account<'info, TokenAccount>,
    /// CHECK: Mint authority PDA
    #[account(seeds = [b"mint_authority", market.key().as_ref()], bump)]
    pub mint_authority: UncheckedAccount<'info>,
    /// CHECK: Vault authority PDA
    #[account(seeds = [b"vault_authority", market.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(order_id: u64)]
pub struct CancelOrder<'info> {
    #[account(mut)]
    pub pending_order: Account<'info, PendingOrder>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub user_usdc: Account<'info, TokenAccount>,
    #[account(mut, seeds = [b"order_escrow", user.key().as_ref(), &order_id.to_le_bytes()], bump)]
    pub order_escrow: Account<'info, TokenAccount>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct LiquidatePosition<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub position: Account<'info, Position>,
    #[account(mut)]
    pub insurance_fund: Account<'info, InsuranceFund>,
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

#[derive(Accounts)]
pub struct SubmitTwapData<'info> {
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub twap_state: Account<'info, TwapState>,
    #[account(seeds = [b"oracle_registry"], bump)]
    pub oracle_registry: Account<'info, OracleRegistry>,
    pub oracle: Signer<'info>,
}

#[derive(Accounts)]
pub struct ResolveDeterministic<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    pub twap_state: Account<'info, TwapState>,
    pub resolver: Signer<'info>,
}

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
pub struct ChallengeResolution<'info> {
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
pub struct MarkInvalid<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    pub admin: Signer<'info>,
}

#[derive(Accounts)]
pub struct FinalizeMarket<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
}

#[derive(Accounts)]
#[instruction(outcome_id: u8)]
pub struct RedeemShares<'info> {
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub user_usdc: Account<'info, TokenAccount>,
    #[account(mut)]
    pub yes_mint: Account<'info, Mint>,
    #[account(mut, constraint = no_mint.key() == market.no_mint)]
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
    /// CHECK: Liquidity vault for repaying borrowed amounts
    #[account(mut, seeds = [b"liquidity_vault", market.key().as_ref()], bump)]
    pub liquidity_vault: Account<'info, TokenAccount>,
    /// CHECK: Liquidity vault authority PDA
    #[account(seeds = [b"liquidity_vault_authority", market.key().as_ref()], bump)]
    pub liquidity_vault_authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct InitializeConfig<'info> {
    #[account(init, payer = admin, space = 8 + Config::LEN, seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct AdminOnly<'info> {
    #[account(mut, seeds = [b"config"], bump, has_one = admin)]
    pub config: Account<'info, Config>,
    pub admin: Signer<'info>,
    #[account(mut, seeds = [b"oracle_registry"], bump)]
    pub oracle_registry: Account<'info, OracleRegistry>,
}

#[derive(Accounts)]
pub struct InitializeOracleRegistry<'info> {
    #[account(init, payer = admin, space = 8 + OracleRegistry::LEN, seeds = [b"oracle_registry"], bump)]
    pub oracle_registry: Account<'info, OracleRegistry>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct InitializeInsuranceFund<'info> {
    #[account(init, payer = admin, space = 8 + InsuranceFund::LEN, seeds = [b"insurance_fund"], bump)]
    pub insurance_fund: Account<'info, InsuranceFund>,
    #[account(mut)]
    pub admin: Signer<'info>,
    pub system_program: Program<'info, System>,
}

