// ============================================================================
// SPACE PREDICTION MARKET
// Deployed and tested version synced from lib_solana_playground_FINAL.rs
// ============================================================================

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::{invoke, invoke_signed};
use anchor_lang::solana_program::system_instruction;
use anchor_spl::token::{self, Burn, Mint, MintTo, Token, TokenAccount, Transfer};
use spl_token::instruction as token_instruction;

declare_id!("DKRg9skUuewV1wdbVD6tpnoHtbWWy2Chq7EKdpPRY6Eh");

pub const BASIS_POINTS: u64 = 10_000;
pub const USDC_DECIMALS: u64 = 1_000_000;
pub const MIN_INITIAL_COLLATERAL: u64 = 1_000 * USDC_DECIMALS;
pub const SHARE_DECIMALS: u8 = 6;

/// Scaling factor that converts a share-denominated amount (shares are always
/// 6 decimals) into a quote-token-denominated amount for markets where the
/// quote token has more decimals than shares. Returns 1 for quote tokens with
/// ≤ 6 decimals (USDC and legacy markets: byte-identical to pre-v2 behavior),
/// 1000 for SPACE (9 decimals), etc. Callers multiply share-derived amounts
/// by this factor when moving them across a quote-denominated transfer.
#[inline]
pub fn quote_scale(quote_decimals: u8) -> u64 {
    if quote_decimals <= SHARE_DECIMALS { 1 } else { 10u64.pow((quote_decimals - SHARE_DECIMALS) as u32) }
}

// Current Market account layout version. Bump when making breaking struct changes.
pub const MARKET_VERSION_V2: u8 = 2;
pub const MAX_LEVERAGE: u8 = 10;
pub const INITIAL_MARGIN_BPS: u64 = 1000;
pub const MAINTENANCE_MARGIN_BPS: u64 = 1000;
pub const LIQUIDATION_PENALTY_BPS: u64 = 1000;
pub const LIQUIDATION_STEP_BPS: u64 = 2500;
pub const BUY_FEE_MAX_BPS: u64 = 200;
pub const BUY_FEE_MIN_BPS: u64 = 2;
pub const BUY_FEE_ALPHA: u64 = 130;
pub const SELL_FEE_PEAK_BPS: u64 = 100;
pub const SELL_FEE_MIN_BPS: u64 = 2;
pub const SELL_FEE_SIGMA: u64 = 2500;

pub const MAKER_FEE_BPS: u64 = 0;
pub const DEFAULT_PROTOCOL_FEE_BPS: u64 = 10;
pub const DEFAULT_CREATOR_FEE_BPS: u64 = 20;
pub const DEFAULT_INSURANCE_FEE_BPS: u64 = 10;
pub const MAX_OUTCOME_LABEL_LEN: usize = 100;
// Orders remain active until cancelled by users or market ends
// Set to a very large value (100 years) to effectively disable expiration
pub const MAX_ORDER_AGE_SECONDS: i64 = 3153600000; // ~100 years in seconds
pub const MAX_PRICE_SNAPSHOTS: usize = 100;
pub const CHALLENGE_PERIOD_SLOTS: u64 = 1000;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum MarketStatus {
    Active = 0,
    Resolving = 1,
    Disputed = 2,
    Finalized = 3,
    Invalid = 4,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum OrderStatus {
    Open = 0,
    PartiallyFilled = 1,
    Filled = 2,
    Cancelled = 3,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum OrderType {
    Limit = 0,
    Market = 1,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ResolutionType {
    TWAP = 0,
    Oracle = 1,
    Manual = 2,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum PositionType {
    Spot = 0,
    Leveraged = 1,
}

#[account]
pub struct Market {
    pub creator: Pubkey,
    pub market_id: u64,
    pub title: String,
    pub description: String,
    pub category: u8,
    pub status: u8,
    pub resolution_type: u8,
    pub num_outcomes: u8,
    pub outcomes: Vec<MarketOutcome>,
    pub no_mint: Pubkey,
    pub end_date: i64,
    pub created_at: i64,
    pub total_volume: u64,
    pub total_minted: u64,
    pub total_maker_rewards: u64,
    pub total_leverage_provided: u64,
    pub resolved_outcome: Option<u8>,
    pub resolution_source: Option<Pubkey>,
    pub resolve_slot: Option<u64>,
    pub evidence_hash: Option<[u8; 32]>,
    pub challenge_bond: u64,
    pub challenger: Option<Pubkey>,
    pub challenge_timestamp: Option<i64>,
    pub creator_fee_bps: u64,
    pub is_invalid: bool,
    pub resolve_timestamp: Option<i64>,
    pub price_snapshots: Vec<PriceSnapshot>,
    // ---- v2 fields (appended; migrate_market_v1_to_v2 backfills on old accounts) ----
    pub quote_mint: Pubkey,
    pub quote_decimals: u8,
    pub version: u8,
}

impl Market {
    pub const LEN: usize = 32
        + 8
        + 4
        + 200
        + 4
        + 1000
        + 1
        + 1
        + 1
        + 1
        + 4
        + (10 * MarketOutcome::LEN)
        + 32
        + 8
        + 8
        + 8
        + 8
        + 8
        + 2
        + 34
        + 10
        + 34
        + 8
        + 2
        + 34
        + 10
        + 34
        + 8
        + 1
        + 4
        + (MAX_PRICE_SNAPSHOTS * 16)
        + 32  // quote_mint
        + 1   // quote_decimals
        + 1;  // version
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MarketOutcome {
    pub id: u8,
    pub label: String,
    pub last_price: u64,
}

impl MarketOutcome {
    pub const LEN: usize = 1 + 4 + MAX_OUTCOME_LABEL_LEN + 2;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct PriceSnapshot {
    pub timestamp: i64,
    pub price: u64,
}

#[account]
pub struct PendingOrder {
    pub user: Pubkey,
    pub market: Pubkey,
    pub outcome_id: u8,
    pub side: u8,
    pub price: u64,
    pub quantity: u64,
    pub filled_quantity: u64,
    pub margin: u64,
    pub margin_used: u64,
    pub leverage: u8,
    pub status: u8,
    pub created_at: i64,
    pub order_id: u64,
    pub order_type: u8,
    pub is_maker: bool,
    pub fee_paid: u64,
    // Leveraged close fields - when closing a leveraged position via market sell
    pub is_leveraged_close: bool,
    pub borrowed_amount_to_repay: u64, // Total borrowed amount from position to repay
    pub collateral_to_return: u64,     // User's collateral to return after debt repayment
    pub position_key: Pubkey,          // Reference to the position being closed
}

impl PendingOrder {
    // Updated: +1 (bool) +8 (borrowed) +8 (collateral) +32 (position_key) = +49 bytes
    pub const LEN: usize =
        32 + 32 + 1 + 1 + 1 + 8 + 8 + 8 + 8 + 8 + 1 + 1 + 8 + 8 + 1 + 8 + 1 + 8 + 8 + 32;
}

#[account]
pub struct Position {
    pub user: Pubkey,
    pub market: Pubkey,
    pub outcome_id: u8,
    pub side: u8,
    pub shares: u64,
    pub avg_entry_price: u64,
    pub leverage: u8,
    pub collateral: u64,
    pub borrowed_amount: u64,
    pub position_type: u8,      // PositionType enum (0 = Spot, 1 = Leveraged)
    pub liquidation_price: u64, // ONLY meaningful for leveraged (0 for spot)
    pub is_open: bool,          // Whether position is active
    pub token_type: u8,         // 0 = YES, 1 = NO — separates YES/NO into distinct PDAs
}

impl Position {
    pub const LEN: usize = 32 + 32 + 1 + 1 + 8 + 8 + 1 + 8 + 8 + 1 + 8 + 1 + 1;
    /// Old position data length (before token_type was added)
    pub const OLD_LEN: usize = 32 + 32 + 1 + 1 + 8 + 8 + 1 + 8 + 8 + 1 + 8 + 1;

    /// Deserialize position data with backward compatibility for old format (no token_type).
    /// Old positions have OLD_LEN bytes; new positions have LEN bytes.
    /// For old format, token_type defaults to 0 (YES).
    pub fn deserialize_compat(data_after_discriminator: &[u8]) -> std::result::Result<Position, ProgramError> {
        // Try new format first (has token_type)
        if let Ok(pos) = Position::deserialize(&mut &*data_after_discriminator) {
            return Ok(pos);
        }
        // Fallback: old format — append token_type=0 and try again
        if data_after_discriminator.len() == Self::OLD_LEN {
            let mut extended = data_after_discriminator[..Self::OLD_LEN].to_vec();
            extended.push(0u8); // default token_type = 0 (YES)
            return Position::deserialize(&mut extended.as_slice())
                .map_err(|_| ProgramError::InvalidAccountData);
        }
        Err(ProgramError::InvalidAccountData)
    }

    /// Minimum data length to attempt deserialization (old or new format)
    pub fn min_data_len() -> usize {
        8 + Self::OLD_LEN // discriminator + old format
    }
}

/// Derive position PDA, trying new format (7 seeds with token_type) first,
/// then old format (6 seeds without token_type) as fallback.
/// Returns (pda, bump, is_new_format).
fn find_position_pda_compat(
    user: &Pubkey,
    market: &Pubkey,
    outcome_id: u8,
    side: u8,
    position_type: u8,
    token_type: u8,
    program_id: &Pubkey,
    account_key: &Pubkey,
) -> (Pubkey, u8, bool) {
    // Try new PDA (with token_type seed)
    let (new_pda, new_bump) = Pubkey::find_program_address(
        &[
            b"position",
            user.as_ref(),
            market.as_ref(),
            &[outcome_id],
            &[side],
            &[position_type],
            &[token_type],
        ],
        program_id,
    );
    if new_pda == *account_key {
        return (new_pda, new_bump, true);
    }
    // Fallback: old PDA (without token_type seed)
    let (old_pda, old_bump) = Pubkey::find_program_address(
        &[
            b"position",
            user.as_ref(),
            market.as_ref(),
            &[outcome_id],
            &[side],
            &[position_type],
        ],
        program_id,
    );
    (old_pda, old_bump, false)
}

#[account]
pub struct Config {
    pub admin: Pubkey,
    pub paused: bool,
    pub max_global_oi: u128,
    pub protocol_fee_bps: u64,
    pub creator_fee_bps: u64,
    pub insurance_fee_bps: u64,
}

impl Config {
    pub const LEN: usize = 32 + 1 + 16 + 8 + 8 + 8;
}

#[account]
pub struct OracleRegistry {
    pub approved_oracles: Vec<Pubkey>,
}

impl OracleRegistry {
    pub const LEN: usize = 4 + (10 * 32);
}

#[account]
pub struct InsuranceFund {
    pub balance: u64,
}

impl InsuranceFund {
    pub const LEN: usize = 8;
}

#[account]
pub struct MatchState {
    pub buy_order_id: u64,
    pub sell_order_id: u64,
    pub match_price: u64,
    pub match_quantity: u64,
    pub fill_quantity: u64,
    pub trade_value: u64,
    pub buy_order_user: Pubkey,
    pub sell_order_user: Pubkey,
    pub outcome_id: u8,
    pub executed: bool,
    pub buy_executed: bool,
    pub sell_executed: bool,
    pub buy_is_maker: bool,
    pub sell_is_maker: bool,
}

impl MatchState {
    pub const LEN: usize = 8 + 8 + 8 + 8 + 8 + 8 + 32 + 32 + 1 + 1 + 1 + 1 + 1 + 1;
}

#[error_code]
pub enum SpaceError {
    #[msg("Bad outcomes")]
    InvalidOutcomes,
    #[msg("Not active")]
    MarketNotActive,
    #[msg("Bad outcome")]
    InvalidOutcome,
    #[msg("Bad price")]
    InvalidPrice,
    #[msg("Bad amount")]
    InvalidAmount,
    #[msg("Bad leverage")]
    InvalidLeverage,
    #[msg("Low liquidity")]
    InsufficientInitialLiquidity,
    #[msg("Low shares")]
    InsufficientShares,
    #[msg("Low margin")]
    InsufficientMargin,
    #[msg("Bad order")]
    InvalidOrder,
    #[msg("Paused")]
    ProtocolPaused,
    #[msg("Not liquidatable")]
    PositionNotLiquidatable,
    #[msg("Denied")]
    Unauthorized,
    #[msg("Label long")]
    LabelTooLong,
    #[msg("Expired")]
    OrderExpired,
    #[msg("Price OOB")]
    MatchPriceOutOfBounds,
    #[msg("Owner mismatch")]
    TokenAccountOwnershipMismatch,
    #[msg("Mint mismatch")]
    TokenAccountMintMismatch,
    #[msg("Slippage")]
    SlippageExceeded,
    #[msg("Resolved")]
    MarketAlreadyResolved,
    #[msg("Challenge active")]
    ChallengePeriodNotExpired,
    #[msg("Bad resolution")]
    InvalidResolution,
    #[msg("Convert fail")]
    InsufficientSharesForConversion,
    #[msg("Low vault")]
    InsufficientVaultBalance,
    #[msg("Bad PDA")]
    InvalidPDA,
    #[msg("Market already migrated to v2")]
    AlreadyMigrated,
    #[msg("Active leveraged position exists - must settle position first")]
    ActiveLeveragedPositionExists,
    #[msg("Not finalized")]
    MarketNotFinalized,
    #[msg("Cannot liquidate spot position")]
    CannotLiquidateSpot,
    #[msg("Position has no debt")]
    NoDebt,
    #[msg("Position type mismatch")]
    PositionTypeMismatch,
    #[msg("Invalid spot leverage (must be 1)")]
    InvalidSpotLeverage,
    #[msg("Position is not open")]
    PositionNotOpen,
    #[msg("Invalid spot debt (spot positions must have 0 debt)")]
    InvalidSpotDebt,
    #[msg("Cannot sell leveraged position as spot")]
    CannotSellLeveragedAsSpot,
    #[msg("Cannot close spot position as leveraged")]
    CannotCloseSpotAsLeveraged,
    #[msg("Account not initialized")]
    AccountNotInitialized,
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

fn calculate_buy_fee(probability_bps: u64) -> u64 {
    let p = probability_bps.min(BASIS_POINTS);
    let p_percent = p / 100;
    let p_squared = p_percent.saturating_mul(p_percent);
    let p_to_alpha = (p_percent
        .saturating_mul(100)
        .saturating_add(p_squared.saturating_mul(3)))
        / 100;
    let p_to_alpha_percent = p_to_alpha.min(100);
    let one_minus_power = 100_u64.saturating_sub(p_to_alpha_percent);
    let fee_range = BUY_FEE_MAX_BPS.saturating_sub(BUY_FEE_MIN_BPS);
    let dynamic_component = fee_range.saturating_mul(one_minus_power) / 100;
    BUY_FEE_MIN_BPS.saturating_add(dynamic_component)
}

fn calculate_sell_fee(probability_bps: u64) -> u64 {
    let p = probability_bps.min(BASIS_POINTS);
    let distance_from_50_bps = if p > 5000 { p - 5000 } else { 5000 - p };
    let sigma_squared = (SELL_FEE_SIGMA.saturating_mul(SELL_FEE_SIGMA)) / 100;
    let distance_squared = distance_from_50_bps.saturating_mul(distance_from_50_bps);
    let distance_squared_bps = distance_squared / sigma_squared.max(1);
    let x_normalized = distance_squared_bps / 200;
    let x = x_normalized.min(200);

    let gaussian_factor = if x == 0 {
        100
    } else if x < 50 {
        let x_squared = (x.saturating_mul(x)) / 100;
        100_u64.saturating_sub(x).saturating_add(x_squared / 200)
    } else {
        let x_squared = (x.saturating_mul(x)) / 100;
        let x_cubed = (x_squared.saturating_mul(x)) / 100;
        let cubic_term = x_cubed / 600;
        100_u64
            .saturating_sub(x)
            .saturating_add((x_squared / 200).saturating_sub(cubic_term))
    }
    .min(100)
    .max(0);

    let fee_range = SELL_FEE_PEAK_BPS.saturating_sub(SELL_FEE_MIN_BPS);
    let dynamic_component = fee_range.saturating_mul(gaussian_factor) / 100;
    SELL_FEE_MIN_BPS.saturating_add(dynamic_component)
}

/// Calculate liquidation price for a leveraged position
/// Returns the price (in basis points) at which the position becomes liquidatable
/// For long positions (side = 0): liquidation_price is the price below which liquidation occurs
/// For short positions (side = 1): liquidation_price is the price above which liquidation occurs
fn calculate_liquidation_price(
    entry_price: u64,
    leverage: u8,
    side: u8,
    maintenance_margin_bps: u64,
) -> Result<u64> {
    if leverage <= 1 {
        return Ok(0); // Spot positions have no liquidation price
    }

    let leverage_u64 = leverage as u64;

    // Simplified liquidation price calculation
    // For long: liquidation when price drops by (1 - maintenance_margin/leverage) factor
    // For short: liquidation when price rises by similar factor
    if side == 0 {
        // Long position: price must drop enough to trigger liquidation
        // Simplified: price_drop = entry_price * (1 - maintenance_margin_bps / (leverage * 100))
        let margin_factor = (maintenance_margin_bps * 100) / (leverage_u64 * BASIS_POINTS);
        let price_drop_bps = BASIS_POINTS.saturating_sub(margin_factor);
        let liquidation_price = (entry_price * price_drop_bps) / BASIS_POINTS;
        Ok(liquidation_price.max(0))
    } else {
        // Short position: price must rise enough to trigger liquidation
        let margin_factor = (maintenance_margin_bps * 100) / (leverage_u64 * BASIS_POINTS);
        let price_rise_bps = BASIS_POINTS.saturating_sub(margin_factor);
        let liquidation_price = (entry_price * (BASIS_POINTS + price_rise_bps)) / BASIS_POINTS;
        Ok(liquidation_price.min(BASIS_POINTS * 2)) // Cap at 200% to prevent overflow
    }
}

fn calculate_dynamic_fee(market_price: u64, side: u8) -> u64 {
    if side == 0 {
        calculate_buy_fee(market_price)
    } else {
        calculate_sell_fee(market_price)
    }
}

fn add_price_snapshot(market: &mut Market, outcome_id: u8, price: u64) {
    let clock = Clock::get().unwrap();
    let snapshot = PriceSnapshot {
        timestamp: clock.unix_timestamp,
        price,
    };
    market.price_snapshots.push(snapshot);
    if market.price_snapshots.len() > MAX_PRICE_SNAPSHOTS {
        market.price_snapshots.remove(0);
    }
    if (outcome_id as usize) < market.outcomes.len() {
        market.outcomes[outcome_id as usize].last_price = price;
    }
}

// ============================================================================
// ACCOUNT CONTEXTS
// ============================================================================

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
#[instruction(order_id: u64, outcome_id: u8)]
pub struct PlaceBuyOrder<'info> {
    pub market: Box<Account<'info, Market>>,
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(mut)]
    pub user_usdc: Box<Account<'info, TokenAccount>>,
    #[account(init, payer = user, space = 8 + PendingOrder::LEN, seeds = [b"order", user.key().as_ref(), &order_id.to_le_bytes()], bump)]
    pub pending_order: Account<'info, PendingOrder>,
    /// CHECK: Order escrow authority PDA
    #[account(seeds = [b"order_escrow_authority", user.key().as_ref(), &order_id.to_le_bytes()], bump)]
    pub order_escrow_authority: UncheckedAccount<'info>,
    #[account(init, payer = user, token::mint = usdc_mint, token::authority = order_escrow_authority, seeds = [b"order_escrow", user.key().as_ref(), &order_id.to_le_bytes()], bump)]
    pub order_escrow: Box<Account<'info, TokenAccount>>,
    pub usdc_mint: Box<Account<'info, Mint>>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
#[instruction(order_id: u64, outcome_id: u8)]
pub struct PlaceYesLimitSellOrder<'info> {
    pub market: Account<'info, Market>,
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(
        init,
        payer = user,
        space = 8 + PendingOrder::LEN,
        seeds = [b"order", user.key().as_ref(), &order_id.to_le_bytes()],
        bump
    )]
    pub pending_order: Account<'info, PendingOrder>,
    #[account(mut)]
    pub user_yes_account: Account<'info, TokenAccount>,
    /// CHECK: Share escrow authority PDA
    #[account(seeds = [b"share_escrow_authority", user.key().as_ref(), &order_id.to_le_bytes()], bump)]
    pub share_escrow_authority: UncheckedAccount<'info>,
    /// CHECK: Share escrow - will be initialized if needed
    #[account(mut, seeds = [b"share_escrow", user.key().as_ref(), &order_id.to_le_bytes()], bump)]
    pub share_escrow_yes: UncheckedAccount<'info>,
    #[account(mut)]
    pub yes_mint: Account<'info, Mint>,
    /// CHECK: User's YES position account (side=0) - used to verify no outstanding leverage debt
    /// Can be either spot (position_type=0) or leveraged (position_type=1) position
    /// Seeds constraint removed to allow frontend to pass the correct PDA based on which position exists
    /// The account will be manually verified in the instruction
    pub user_position: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(order_id: u64, outcome_id: u8)]
pub struct PlaceNoLimitSellOrder<'info> {
    pub market: Box<Account<'info, Market>>,
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    #[account(mut)]
    pub user: Signer<'info>,
    #[account(init, payer = user, space = 8 + PendingOrder::LEN, seeds = [b"order", user.key().as_ref(), &order_id.to_le_bytes()], bump)]
    pub pending_order: Account<'info, PendingOrder>,
    #[account(mut)]
    pub user_no_account: Box<Account<'info, TokenAccount>>,
    /// CHECK: Share escrow authority PDA
    #[account(seeds = [b"share_escrow_authority", user.key().as_ref(), &order_id.to_le_bytes()], bump)]
    pub share_escrow_authority: UncheckedAccount<'info>,
    /// CHECK: Share escrow - will be initialized if needed
    #[account(mut, seeds = [b"share_escrow_no", user.key().as_ref(), &order_id.to_le_bytes()], bump)]
    pub share_escrow_no: UncheckedAccount<'info>,
    /// NO mint: validated in instruction body (per-outcome PDA or shared)
    #[account(mut)]
    pub no_mint: Box<Account<'info, Mint>>,
    /// CHECK: User's NO position account - used to verify no outstanding leverage debt
    /// The account will be manually verified in the instruction
    pub user_position: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

#[derive(Accounts)]
#[instruction(buy_order_id: u64, sell_order_id: u64)]
pub struct ValidateMatch<'info> {
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
    #[account(
        init,
        payer = keeper,
        space = 8 + MatchState::LEN,
        seeds = [b"match", market.key().as_ref(), &buy_order_id.to_le_bytes(), &sell_order_id.to_le_bytes()],
        bump
    )]
    pub match_state: Account<'info, MatchState>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteYesBuyerMatch<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub match_state: Account<'info, MatchState>,
    #[account(mut)]
    pub buy_order: Account<'info, PendingOrder>,
    #[account(mut)]
    pub keeper: Signer<'info>,
    /// CHECK: Buy order escrow
    #[account(mut)]
    pub buy_order_escrow: UncheckedAccount<'info>,
    /// CHECK: Sell share escrow for YES
    #[account(mut)]
    pub sell_share_escrow_yes: UncheckedAccount<'info>,
    /// CHECK: YES mint
    #[account(mut)]
    pub yes_mint: UncheckedAccount<'info>,
    #[account(mut)]
    pub buy_user_outcome_account: Account<'info, TokenAccount>,
    /// CHECK: Buy position PDA
    #[account(mut)]
    pub buy_position: UncheckedAccount<'info>,
    /// CHECK: Market vault
    #[account(mut)]
    pub market_vault: UncheckedAccount<'info>,
    /// CHECK: Margin vault
    #[account(mut)]
    pub margin_vault: UncheckedAccount<'info>,
    /// CHECK: Liquidity vault
    #[account(mut)]
    pub liquidity_vault: UncheckedAccount<'info>,
    /// CHECK: Buy order escrow authority
    pub buy_order_escrow_authority: UncheckedAccount<'info>,
    /// CHECK: Sell share escrow authority
    pub sell_share_escrow_authority: UncheckedAccount<'info>,
    /// CHECK: Vault authority
    pub vault_authority: UncheckedAccount<'info>,
    /// CHECK: Margin vault authority
    pub margin_vault_authority: UncheckedAccount<'info>,
    /// CHECK: Liquidity vault authority
    pub liquidity_vault_authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteNoBuyerMatch<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub match_state: Account<'info, MatchState>,
    #[account(mut)]
    pub buy_order: Account<'info, PendingOrder>,
    #[account(mut)]
    pub keeper: Signer<'info>,
    /// CHECK: Buy order escrow
    #[account(mut)]
    pub buy_order_escrow: UncheckedAccount<'info>,
    /// CHECK: Sell share escrow for NO
    #[account(mut)]
    pub sell_share_escrow_no: UncheckedAccount<'info>,
    /// CHECK: NO mint
    #[account(mut)]
    pub no_mint: UncheckedAccount<'info>,
    #[account(mut)]
    pub buy_user_outcome_account: Account<'info, TokenAccount>,
    /// CHECK: Buy position PDA
    #[account(mut)]
    pub buy_position: UncheckedAccount<'info>,
    /// CHECK: Market vault
    #[account(mut)]
    pub market_vault: UncheckedAccount<'info>,
    /// CHECK: Margin vault
    #[account(mut)]
    pub margin_vault: UncheckedAccount<'info>,
    /// CHECK: Liquidity vault
    #[account(mut)]
    pub liquidity_vault: UncheckedAccount<'info>,
    /// CHECK: Buy order escrow authority
    pub buy_order_escrow_authority: UncheckedAccount<'info>,
    /// CHECK: Sell share escrow authority
    pub sell_share_escrow_authority: UncheckedAccount<'info>,
    /// CHECK: Vault authority
    pub vault_authority: UncheckedAccount<'info>,
    /// CHECK: Margin vault authority
    pub margin_vault_authority: UncheckedAccount<'info>,
    /// CHECK: Liquidity vault authority
    pub liquidity_vault_authority: UncheckedAccount<'info>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct ExecuteSellerMatch<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub match_state: Account<'info, MatchState>,
    #[account(mut)]
    pub sell_order: Account<'info, PendingOrder>,
    #[account(mut)]
    pub keeper: Signer<'info>,
    /// CHECK: Sell share escrow for YES
    #[account(mut)]
    pub sell_share_escrow_yes: UncheckedAccount<'info>,
    /// CHECK: Sell share escrow for NO
    #[account(mut)]
    pub sell_share_escrow_no: UncheckedAccount<'info>,
    #[account(mut)]
    pub sell_user_usdc_account: Account<'info, TokenAccount>,
    /// CHECK: Market vault
    #[account(mut)]
    pub market_vault: UncheckedAccount<'info>,
    /// CHECK: Sell share escrow authority
    pub sell_share_escrow_authority: UncheckedAccount<'info>,
    /// CHECK: Vault authority
    pub vault_authority: UncheckedAccount<'info>,
    /// CHECK: Liquidity vault - required for leveraged close orders to repay debt
    #[account(mut)]
    pub liquidity_vault: UncheckedAccount<'info>,
    /// CHECK: Liquidity vault authority - required for leveraged close orders
    pub liquidity_vault_authority: UncheckedAccount<'info>,
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
    /// CHECK: Order escrow authority PDA
    #[account(seeds = [b"order_escrow_authority", user.key().as_ref(), &order_id.to_le_bytes()], bump)]
    pub order_escrow_authority: UncheckedAccount<'info>,
    #[account(mut, seeds = [b"order_escrow", user.key().as_ref(), &order_id.to_le_bytes()], bump)]
    pub order_escrow: Account<'info, TokenAccount>,
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(order_id: u64)]
pub struct CancelSellOrder<'info> {
    #[account(mut)]
    pub pending_order: Account<'info, PendingOrder>,
    #[account(mut)]
    pub user: Signer<'info>,
    /// CHECK: User YES account
    #[account(mut)]
    pub user_yes_account: UncheckedAccount<'info>,
    /// CHECK: Share escrow authority PDA
    #[account(seeds = [b"share_escrow_authority", user.key().as_ref(), &order_id.to_le_bytes()], bump)]
    pub share_escrow_authority: UncheckedAccount<'info>,
    /// CHECK: Share escrow
    #[account(mut, seeds = [b"share_escrow", user.key().as_ref(), &order_id.to_le_bytes()], bump)]
    pub share_escrow_yes: UncheckedAccount<'info>,
    /// Position account (required for leveraged close orders to restore shares/collateral/debt)
    /// CHECK: Optional - only needed for leveraged close orders
    #[account(mut)]
    pub position: UncheckedAccount<'info>,
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
#[instruction(order_id: u64)]
pub struct CancelNoSellOrder<'info> {
    #[account(mut)]
    pub pending_order: Account<'info, PendingOrder>,
    #[account(mut)]
    pub user: Signer<'info>,
    /// CHECK: User NO account
    #[account(mut)]
    pub user_no_account: UncheckedAccount<'info>,
    /// CHECK: Share escrow authority PDA
    #[account(seeds = [b"share_escrow_authority", user.key().as_ref(), &order_id.to_le_bytes()], bump)]
    pub share_escrow_authority: UncheckedAccount<'info>,
    /// CHECK: Share escrow for NO
    #[account(mut, seeds = [b"share_escrow_no", user.key().as_ref(), &order_id.to_le_bytes()], bump)]
    pub share_escrow_no: UncheckedAccount<'info>,
    /// Position account (required for leveraged close orders to restore shares/collateral/debt)
    /// CHECK: Optional - only needed for leveraged close orders
    #[account(mut)]
    pub position: UncheckedAccount<'info>,
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    pub token_program: Program<'info, Token>,
}

#[derive(Accounts)]
pub struct ClosePosition<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(mut)]
    pub position: Account<'info, Position>,
    #[account(mut)]
    pub user: Signer<'info>,
    /// CHECK: User USDC account, validated via constraints
    #[account(mut)]
    pub user_usdc: UncheckedAccount<'info>,
    /// CHECK: Mint account, validated via constraints
    #[account(mut)]
    pub yes_mint: UncheckedAccount<'info>,
    /// CHECK: Mint account, validated via constraints
    #[account(mut)]
    pub no_mint: UncheckedAccount<'info>,
    /// CHECK: User YES token account - only required for YES positions (outcome_id=0), validated in instruction
    #[account(mut)]
    pub user_yes_account: UncheckedAccount<'info>,
    /// CHECK: User NO token account - only required for NO positions (outcome_id=1), validated in instruction
    #[account(mut)]
    pub user_no_account: UncheckedAccount<'info>,
    /// CHECK: Market vault, validated via seeds constraint
    #[account(mut, seeds = [b"vault", market.key().as_ref()], bump)]
    pub market_vault: UncheckedAccount<'info>,
    /// CHECK: Vault authority PDA
    #[account(seeds = [b"vault_authority", market.key().as_ref()], bump)]
    pub vault_authority: UncheckedAccount<'info>,
    #[account(mut, seeds = [b"margin_vault", market.key().as_ref()], bump)]
    pub margin_vault: Account<'info, TokenAccount>,
    /// CHECK: Margin vault authority PDA
    #[account(seeds = [b"margin_vault_authority", market.key().as_ref()], bump)]
    pub margin_vault_authority: UncheckedAccount<'info>,
    /// CHECK: Liquidity vault, validated via seeds constraint
    #[account(mut, seeds = [b"liquidity_vault", market.key().as_ref()], bump)]
    pub liquidity_vault: UncheckedAccount<'info>,
    /// CHECK: Liquidity vault authority PDA
    #[account(seeds = [b"liquidity_vault_authority", market.key().as_ref()], bump)]
    pub liquidity_vault_authority: UncheckedAccount<'info>,
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    pub token_program: Program<'info, Token>,
}

/// Context for closing a leveraged position by placing a market sell order
/// This properly sells shares on the market instead of burning them
#[derive(Accounts)]
#[instruction(order_id: u64)]
pub struct CloseLeveragedPosition<'info> {
    #[account(mut)]
    pub market: Account<'info, Market>,
    #[account(
        mut,
        constraint = position.user == user.key() @ SpaceError::Unauthorized,
        constraint = position.market == market.key() @ SpaceError::InvalidOrder,
        constraint = position.shares > 0 @ SpaceError::InvalidAmount,
        constraint = position.borrowed_amount > 0 @ SpaceError::InvalidOrder  // Must have borrowed amount
    )]
    pub position: Account<'info, Position>,
    #[account(mut)]
    pub user: Signer<'info>,
    /// The sell order to be created for this leveraged close
    #[account(
        init,
        payer = user,
        space = 8 + PendingOrder::LEN,
        seeds = [b"order", user.key().as_ref(), &order_id.to_le_bytes()],
        bump
    )]
    pub pending_order: Account<'info, PendingOrder>,
    /// User's token account for the shares being sold (YES or NO based on outcome_id)
    #[account(mut)]
    pub user_share_account: Account<'info, TokenAccount>,
    /// Share escrow authority PDA
    /// CHECK: Validated via seeds
    #[account(seeds = [b"share_escrow_authority", user.key().as_ref(), &order_id.to_le_bytes()], bump)]
    pub share_escrow_authority: UncheckedAccount<'info>,
    /// Share escrow for the shares being sold
    /// CHECK: Will be initialized in instruction, PDA validated manually based on outcome_id
    #[account(mut)]
    pub share_escrow: UncheckedAccount<'info>,
    /// The mint for the shares being sold
    #[account(mut)]
    pub share_mint: Account<'info, Mint>,
    #[account(seeds = [b"config"], bump)]
    pub config: Account<'info, Config>,
    pub token_program: Program<'info, Token>,
    pub system_program: Program<'info, System>,
    pub rent: Sysvar<'info, Rent>,
}

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

// Resolution contexts
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

/// Context for adding a new outcome to an existing market (per-outcome NO model only)
/// YES and NO mints for the new outcome are created via remaining_accounts
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

// ============================================================================
// PROGRAM MODULE - All instruction handlers
// ============================================================================

#[program]
pub mod space_core {
    use super::*;

    // Include all instruction implementations from the deployed version
    // This file is getting long, so we'll include the key instruction signatures
    // The full implementation matches lib_solana_playground_FINAL.rs

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

    // Note: The following instructions are stubs - full implementation matches lib_solana_playground_FINAL.rs
    // For brevity, I'm including signatures. Copy full implementations from your deployed file.

    pub fn place_buy_order(
        ctx: Context<PlaceBuyOrder>,
        order_id: u64,
        outcome_id: u8,
        price: u64,
        quantity: u64,
        leverage: u8,
    ) -> Result<()> {
        // Check protocol is not paused
        require!(!ctx.accounts.config.paused, SpaceError::ProtocolPaused);

        // Full implementation in lib_solana_playground_FINAL.rs lines 1181-1250
        require!(
            price >= 1 && price <= BASIS_POINTS,
            SpaceError::InvalidPrice
        );
        require!(
            leverage >= 1 && leverage <= MAX_LEVERAGE,
            SpaceError::InvalidLeverage
        );
        require!(quantity > 0, SpaceError::InvalidAmount);

        let market = &ctx.accounts.market;
        let scale = quote_scale(market.quote_decimals);

        // notional in quote base units: quantity (share base units, 6 dec)
        // * price (bps) / 10000 * quote_scale. For USDC (scale=1) this is
        // byte-identical to the pre-v2 formula.
        if leverage > 1 {
            let notional = quantity
                .checked_mul(price)
                .and_then(|x| x.checked_div(BASIS_POINTS))
                .and_then(|x| x.checked_mul(scale))
                .ok_or(SpaceError::InvalidAmount)?;
            let new_total = market
                .total_leverage_provided
                .checked_add(notional)
                .ok_or(SpaceError::InvalidAmount)?;
            require!(
                new_total as u128 <= ctx.accounts.config.max_global_oi,
                SpaceError::InvalidAmount
            );
        }
        require!(
            market.status == MarketStatus::Active as u8,
            SpaceError::MarketNotActive
        );
        require!(outcome_id < market.num_outcomes, SpaceError::InvalidOutcome);

        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp < market.end_date,
            SpaceError::MarketNotActive
        );

        let notional = quantity
            .checked_mul(price)
            .and_then(|x| x.checked_div(BASIS_POINTS))
            .and_then(|x| x.checked_mul(scale))
            .ok_or(SpaceError::InvalidAmount)?;
        let leverage_u64 = leverage as u64;
        require!(leverage_u64 > 0, SpaceError::InvalidLeverage);
        let required_margin = notional
            .checked_div(leverage_u64)
            .ok_or(SpaceError::InvalidAmount)?;
        let min_margin = (notional
            .checked_mul(INITIAL_MARGIN_BPS)
            .ok_or(SpaceError::InvalidAmount)?)
            / BASIS_POINTS;
        let required_margin = required_margin.max(min_margin);
        require!(required_margin > 0, SpaceError::InsufficientMargin);

        let cpi_accounts = Transfer {
            from: ctx.accounts.user_usdc.to_account_info(),
            to: ctx.accounts.order_escrow.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        token::transfer(
            CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
            required_margin,
        )?;

        let order = &mut ctx.accounts.pending_order;
        order.user = ctx.accounts.user.key();
        order.market = ctx.accounts.market.key();
        order.outcome_id = outcome_id;
        order.side = 0;
        order.price = price;
        order.quantity = quantity;
        order.filled_quantity = 0;
        order.margin = required_margin;
        order.margin_used = 0;
        order.leverage = leverage;
        order.status = OrderStatus::Open as u8;
        order.created_at = clock.unix_timestamp;
        order.order_id = order_id;
        order.order_type = OrderType::Limit as u8;
        order.is_maker = true;
        order.fee_paid = 0;
        // Default values for leveraged close fields (not a leveraged close order)
        order.is_leveraged_close = false;
        order.borrowed_amount_to_repay = 0;
        order.collateral_to_return = 0;
        order.position_key = Pubkey::default();

        Ok(())
    }

    pub fn place_yes_limit_sell_order(
        ctx: Context<PlaceYesLimitSellOrder>,
        order_id: u64,
        outcome_id: u8,
        price: u64,
        quantity: u64,
        leverage: u8,
    ) -> Result<()> {
        // Check protocol is not paused
        require!(!ctx.accounts.config.paused, SpaceError::ProtocolPaused);

        let order_id_bytes = order_id.to_le_bytes();
        let user_key = ctx.accounts.user.key();

        require!(
            price >= 1 && price <= BASIS_POINTS,
            SpaceError::InvalidPrice
        );
        // Sell orders must have leverage = 1 (spot only) - no leveraged selling allowed
        require!(leverage == 1, SpaceError::InvalidLeverage);
        require!(quantity > 0, SpaceError::InvalidAmount);

        // Check both spot and leveraged positions to calculate total available shares
        // Users can sell from either spot or leveraged positions using the spot sell function
        let market_key = ctx.accounts.market.key();
        let program_id = ctx.program_id;

        let mut total_spot_shares: u64 = 0;

        msg!("[SELL_DEBUG] Checking spot position for available shares (leveraged positions cannot be sold using spot sell function)...");
        msg!("[SELL_DEBUG] User key: {}", user_key);
        msg!("[SELL_DEBUG] Market key: {}", market_key);
        msg!("[SELL_DEBUG] Outcome ID: {}", outcome_id);
        msg!("[SELL_DEBUG] Quantity to sell: {}", quantity);

        // Check spot position (position_type = 0, token_type = 0 for YES)
        // Backward compat: accept both new PDA (with token_type) and old PDA (without)
        let (spot_position_pda, _, _is_new_format) = find_position_pda_compat(
            &user_key, &market_key, outcome_id, 0, 0, 0, program_id,
            &ctx.accounts.user_position.key(),
        );

        msg!("[SELL_DEBUG] Provided position PDA: {}", ctx.accounts.user_position.key());
        msg!("[SELL_DEBUG] Expected spot position PDA: {}", spot_position_pda);

        if ctx.accounts.user_position.key() == spot_position_pda
            && ctx.accounts.user_position.lamports() > 0
        {
            if let Ok(position_data) = ctx.accounts.user_position.try_borrow_data() {
                if position_data.len() >= Position::min_data_len() {
                    if let Ok(position) = Position::deserialize_compat(&position_data[8..]) {
                        if position.user == user_key
                            && position.market == market_key
                            && position.outcome_id == outcome_id
                            && position.position_type == PositionType::Spot as u8
                            && position.leverage == 1
                            && position.borrowed_amount == 0
                        {
                            total_spot_shares = position.shares;
                            msg!("[SELL_DEBUG] Found spot position with {} shares", total_spot_shares);
                        }
                    }
                }
            }
        }

        // HARD REQUIREMENT: The position account MUST be the spot position PDA (new or old format)
        let position_account = &ctx.accounts.user_position;
        require!(
            position_account.key() == spot_position_pda,
            SpaceError::InvalidPDA
        );

        // Verify the position account is a valid PDA (either spot or leveraged, old or new format)
        let mut is_valid_position = false;
        let mut provided_position_type: Option<u8> = None;

        for position_type in 0..2u8 {
            let (matched_pda, _, _) = find_position_pda_compat(
                &user_key, &market_key, outcome_id, 0, position_type, 0, program_id,
                &position_account.key(),
            );
            if matched_pda == position_account.key() {
                is_valid_position = true;
                provided_position_type = Some(position_type);
                break;
            }
        }

        // If position account is provided, it must be a valid position PDA
        if position_account.lamports() > 0 && !is_valid_position {
            msg!("[SELL_DEBUG] Invalid position PDA provided");
            return Err(SpaceError::InvalidPDA.into());
        }

        // Read the provided position account to get shares
        // SECURITY: Only allow selling from SPOT positions (position_type = 0, leverage = 1, borrowed_amount = 0)
        // Leveraged positions must be closed using closeLeveragedPosition, not sold using spot sell function
        if position_account.lamports() > 0 {
            if let Ok(position_data) = position_account.try_borrow_data() {
                if position_data.len() >= Position::min_data_len() {
                    if let Ok(position) = Position::deserialize_compat(&position_data[8..]) {
                        if position.user == user_key
                            && position.market == market_key
                            && position.outcome_id == outcome_id
                        {
                            // SECURITY CHECK: Reject leveraged positions
                            if provided_position_type == Some(1) {
                                // User is trying to sell from a leveraged position
                                msg!(
                                    "[SELL_DEBUG] BLOCKED: User provided leveraged position (position_type = 1)"
                                );
                                msg!(
                                    "[SELL_DEBUG] Leveraged position shares: {}, borrowed_amount: {}, leverage: {}",
                                    position.shares,
                                    position.borrowed_amount,
                                    position.leverage
                                );
                                return Err(SpaceError::CannotSellLeveragedAsSpot.into());
                            }

                            // SECURITY CHECK: Reject positions with borrowed_amount > 0 (even if position_type = 0)
                            if position.borrowed_amount > 0 {
                                msg!(
                                    "[SELL_DEBUG] BLOCKED: Position has borrowed_amount = {} (must be 0 for spot selling)",
                                    position.borrowed_amount
                                );
                                return Err(SpaceError::ActiveLeveragedPositionExists.into());
                            }

                            // SECURITY CHECK: Reject positions with leverage > 1
                            if position.leverage > 1 {
                                msg!(
                                    "[SELL_DEBUG] BLOCKED: Position has leverage = {} (must be 1 for spot selling)",
                                    position.leverage
                                );
                                return Err(SpaceError::CannotSellLeveragedAsSpot.into());
                            }

                            // SECURITY CHECK: Ensure position_type = 0 (Spot)
                            if position.position_type != PositionType::Spot as u8 {
                                msg!(
                                    "[SELL_DEBUG] BLOCKED: Position has position_type = {} (must be 0 for spot selling)",
                                    position.position_type
                                );
                                return Err(SpaceError::CannotSellLeveragedAsSpot.into());
                            }

                            // All checks passed - this is a valid spot position
                            match provided_position_type {
                                Some(0) => {
                                    // Spot position - valid for selling
                                    total_spot_shares = position.shares;
                                    msg!(
                                        "[SELL_DEBUG] Valid spot position with {} shares (leverage: {}, borrowed_amount: {}, position_type: {})",
                                        total_spot_shares,
                                        position.leverage,
                                        position.borrowed_amount,
                                        position.position_type
                                    );
                                }
                                _ => {
                                    // This shouldn't happen due to checks above, but handle it anyway
                                    msg!("[SELL_DEBUG] Unexpected position type");
                                    return Err(SpaceError::CannotSellLeveragedAsSpot.into());
                                }
                            }
                        }
                    }
                }
            }
        }

        // Check token account balance - users can sell from token account if they have tokens
        // This handles the case where users minted YES/NO tokens but don't have a position account
        let token_account_balance = ctx.accounts.user_yes_account.amount;
        msg!("[SELL_DEBUG] Token account balance: {}", token_account_balance);
        msg!("[SELL_DEBUG] Spot position shares: {}", total_spot_shares);
        
        // CRITICAL SECURITY: Check if leveraged position exists (new or old PDA format)
        let has_leveraged_position = ctx.remaining_accounts.iter().any(|acc| {
            if acc.lamports() == 0 { return false; }
            // Accept both new PDA (with token_type) and old PDA (without)
            let (matched_pda, _, _) = find_position_pda_compat(
                &user_key, &market_key, outcome_id, 0, 1, 0, program_id, &acc.key(),
            );
            if acc.key() != matched_pda { return false; }
            if let Ok(position_data) = acc.try_borrow_data() {
                if position_data.len() >= Position::min_data_len() {
                    if let Ok(position) = Position::deserialize_compat(&position_data[8..]) {
                        return position.user == user_key
                            && position.market == market_key
                            && position.outcome_id == outcome_id
                            && position.position_type == PositionType::Leveraged as u8
                            && position.shares > 0;
                    }
                }
            }
            false
        });
        
        // CRITICAL SECURITY: Determine available shares based on position existence
        // Rule 1: If user has a spot position, ONLY allow selling from spot position shares
        //         (Token account may contain leveraged shares - we must ignore them)
        // Rule 2: If user has NO spot position AND NO leveraged position, allow selling from token account (minted tokens)
        // Rule 3: If user has leveraged position but no spot position, BLOCK selling from token account
        //         (Token account contains leveraged shares - must use closeLeveragedPosition)
        let total_available_shares = if total_spot_shares > 0 {
            // User has a spot position - ONLY count spot position shares
            // DO NOT use token account balance as it may contain leveraged shares
            msg!("[SELL_DEBUG] User has spot position - ONLY allowing sell from spot position shares (ignoring token account which may contain leveraged shares)");
            total_spot_shares
        } else if has_leveraged_position {
            // User has leveraged position but no spot position
            // Token account contains leveraged shares - CANNOT sell via spot sell function
            msg!("[SELL_DEBUG] User has leveraged position but no spot position - BLOCKING sell from token account (contains leveraged shares)");
            msg!("[SELL_DEBUG] Users with leveraged positions must use closeLeveragedPosition to close them");
            0 // No shares available for spot selling
        } else {
            // No spot position and no leveraged position - token account contains minted tokens
            // This is safe to sell (admin minted tokens or user's own minted tokens)
            msg!("[SELL_DEBUG] No spot position and no leveraged position - allowing sell from token account (minted tokens)");
            token_account_balance
        };
        
        msg!(
            "[SELL_DEBUG] Total available shares: {} (spot position: {}, token account: {})",
            total_available_shares,
            total_spot_shares,
            token_account_balance
        );
        
        // CRITICAL: Validate user has enough shares to sell
        // This is the final check before allowing the order to be placed
        require!(
            total_available_shares >= quantity,
            SpaceError::InsufficientShares
        );
        
        // ADDITIONAL SECURITY: If user has a spot position, verify token account has enough shares
        // This ensures the token account has the shares to transfer (they might be in escrow or elsewhere)
        if total_spot_shares > 0 {
            msg!("[SELL_DEBUG] User has spot position - verifying token account has sufficient shares for transfer...");
            // Token account should have at least as many shares as we're trying to sell
            require!(
                token_account_balance >= quantity,
                SpaceError::InsufficientShares
            );
        }

        // Note: Leveraged positions are now blocked from being sold using spot sell function
        // Users must use closeLeveragedPosition to close leveraged positions

        let market = &ctx.accounts.market;
        let scale = quote_scale(market.quote_decimals);

        // Multi-outcome: allow selling YES shares for any valid outcome
        require!(outcome_id < market.num_outcomes, SpaceError::InvalidOutcome);

        // Check global OI limit for leveraged orders
        if leverage > 1 {
            let notional = quantity
                .checked_mul(price)
                .and_then(|x| x.checked_div(BASIS_POINTS))
                .and_then(|x| x.checked_mul(scale))
                .ok_or(SpaceError::InvalidAmount)?;
            let new_total = market
                .total_leverage_provided
                .checked_add(notional)
                .ok_or(SpaceError::InvalidAmount)?;
            require!(
                new_total as u128 <= ctx.accounts.config.max_global_oi,
                SpaceError::InvalidAmount
            );
        }

        let market_key = market.key();
        let yes_mint_seeds = &[b"yes_mint", market_key.as_ref(), &[outcome_id]];
        let (expected_yes_mint, _) = Pubkey::find_program_address(yes_mint_seeds, ctx.program_id);

        require!(
            ctx.accounts.yes_mint.key() == expected_yes_mint,
            SpaceError::TokenAccountMintMismatch
        );

        let needs_initialization = ctx.accounts.share_escrow_yes.lamports() == 0;

        if needs_initialization {
            let share_escrow_seeds = &[b"share_escrow", user_key.as_ref(), &order_id_bytes];
            let share_escrow_authority_seeds = &[
                b"share_escrow_authority",
                user_key.as_ref(),
                &order_id_bytes,
            ];

            let rent = Rent::get()?;
            let space = 165;
            let lamports = rent.minimum_balance(space);
            let (share_escrow_pda, share_escrow_bump) =
                Pubkey::find_program_address(share_escrow_seeds, ctx.program_id);
            require!(
                share_escrow_pda == ctx.accounts.share_escrow_yes.key(),
                SpaceError::TokenAccountMintMismatch
            );

            let (share_escrow_authority_pda, _) =
                Pubkey::find_program_address(share_escrow_authority_seeds, ctx.program_id);
            require!(
                share_escrow_authority_pda == ctx.accounts.share_escrow_authority.key(),
                SpaceError::TokenAccountMintMismatch
            );

            let share_escrow_signer_seeds = &[
                b"share_escrow",
                user_key.as_ref(),
                &order_id_bytes,
                &[share_escrow_bump],
            ];

            invoke_signed(
                &system_instruction::create_account(
                    &ctx.accounts.user.key(),
                    &ctx.accounts.share_escrow_yes.key(),
                    lamports,
                    space as u64,
                    &ctx.accounts.token_program.key(),
                ),
                &[
                    ctx.accounts.user.to_account_info(),
                    ctx.accounts.share_escrow_yes.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
                &[share_escrow_signer_seeds],
            )?;

            let init_account_ix = token_instruction::initialize_account(
                &ctx.accounts.token_program.key(),
                &ctx.accounts.share_escrow_yes.key(),
                &ctx.accounts.yes_mint.key(),
                &ctx.accounts.share_escrow_authority.key(),
            )?;
            anchor_lang::solana_program::program::invoke(
                &init_account_ix,
                &[
                    ctx.accounts.token_program.to_account_info(),
                    ctx.accounts.share_escrow_yes.to_account_info(),
                    ctx.accounts.yes_mint.to_account_info(),
                    ctx.accounts.share_escrow_authority.to_account_info(),
                    ctx.accounts.rent.to_account_info(),
                ],
            )?;
        }

        require!(
            market.status == MarketStatus::Active as u8,
            SpaceError::MarketNotActive
        );

        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp < market.end_date,
            SpaceError::MarketNotActive
        );

        if !needs_initialization {
            let escrow_data = ctx.accounts.share_escrow_yes.try_borrow_data()?;
            let escrow_mint =
                Pubkey::try_from(&escrow_data[0..32]).map_err(|_| SpaceError::InvalidOutcome)?;
            require!(
                escrow_mint == expected_yes_mint,
                SpaceError::TokenAccountMintMismatch
            );
        }

        require!(
            ctx.accounts.user_yes_account.amount >= quantity,
            SpaceError::InsufficientShares
        );
        require!(
            ctx.accounts.user_yes_account.mint == ctx.accounts.yes_mint.key(),
            SpaceError::TokenAccountMintMismatch
        );

        let transfer_shares_cpi = Transfer {
            from: ctx.accounts.user_yes_account.to_account_info(),
            to: ctx.accounts.share_escrow_yes.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                transfer_shares_cpi,
            ),
            quantity,
        )?;

        let order = &mut ctx.accounts.pending_order;
        let clock = Clock::get()?;
        order.user = ctx.accounts.user.key();
        order.market = market.key();
        order.outcome_id = outcome_id;
        order.side = 1;
        order.price = price;
        order.quantity = quantity;
        order.filled_quantity = 0;
        order.margin = 0;
        order.margin_used = 0;
        order.leverage = leverage;
        order.status = OrderStatus::Open as u8;
        order.created_at = clock.unix_timestamp;
        order.order_id = order_id;
        order.order_type = OrderType::Limit as u8;
        order.is_maker = true;
        order.fee_paid = 0;
        // Default values for leveraged close fields (not a leveraged close order)
        order.is_leveraged_close = false;
        order.borrowed_amount_to_repay = 0;
        order.collateral_to_return = 0;
        order.position_key = Pubkey::default();

        Ok(())
    }

    pub fn place_no_limit_sell_order(
        ctx: Context<PlaceNoLimitSellOrder>,
        order_id: u64,
        outcome_id: u8,
        price: u64,
        quantity: u64,
        leverage: u8,
    ) -> Result<()> {
        // Check protocol is not paused
        require!(!ctx.accounts.config.paused, SpaceError::ProtocolPaused);

        let market_check = &ctx.accounts.market;

        // Validate outcome_id is within range
        require!(outcome_id < market_check.num_outcomes, SpaceError::InvalidOutcome);

        require!(
            price >= 1 && price <= BASIS_POINTS,
            SpaceError::InvalidPrice
        );
        // Sell orders must have leverage = 1 (spot only) - no leveraged selling allowed
        require!(leverage == 1, SpaceError::InvalidLeverage);
        require!(quantity > 0, SpaceError::InvalidAmount);

        // SECURITY: Only allow selling from SPOT positions (position_type = 0, leverage = 1, borrowed_amount = 0)
        // Leveraged positions must be closed using closeLeveragedPosition, not sold using spot sell function
        let position_account = &ctx.accounts.user_position;
        let user_key = ctx.accounts.user.key();
        let market_key = ctx.accounts.market.key();
        let program_id = ctx.program_id;

        // Derive expected spot position PDA (token_type = 1 for NO)
        // Backward compat: accept both new PDA (with token_type) and old PDA (without)
        let (spot_position_pda, _, _) = find_position_pda_compat(
            &user_key, &market_key, outcome_id, 0, 0, 1, program_id,
            &position_account.key(),
        );

        // CRITICAL: The position account MUST be the spot position PDA (new or old format)
        require!(
            position_account.key() == spot_position_pda,
            SpaceError::InvalidPDA
        );

        // Check if spot position exists and validate it's actually a spot position
        let mut total_spot_shares: u64 = 0;

        if position_account.lamports() > 0 {
            if let Ok(position_data) = position_account.try_borrow_data() {
                if position_data.len() >= Position::min_data_len() {
                    if let Ok(position) = Position::deserialize_compat(&position_data[8..]) {
                        if position.user == user_key
                            && position.market == market_key
                            && position.outcome_id == outcome_id
                        {
                            // SECURITY CHECK: Reject leveraged positions
                            if position.position_type != PositionType::Spot as u8 {
                                msg!("[NO_SELL_DEBUG] BLOCKED: Position has position_type = {} (must be 0 for spot selling)", position.position_type);
                                return Err(SpaceError::CannotSellLeveragedAsSpot.into());
                            }
                            
                            // SECURITY CHECK: Reject positions with borrowed_amount > 0
                            if position.borrowed_amount > 0 {
                                msg!("[NO_SELL_DEBUG] BLOCKED: Position has borrowed_amount = {} (must be 0 for spot selling)", position.borrowed_amount);
                                return Err(SpaceError::ActiveLeveragedPositionExists.into());
                            }
                            
                            // SECURITY CHECK: Reject positions with leverage > 1
                            if position.leverage > 1 {
                                msg!("[NO_SELL_DEBUG] BLOCKED: Position has leverage = {} (must be 1 for spot selling)", position.leverage);
                                return Err(SpaceError::CannotSellLeveragedAsSpot.into());
                            }
                            
                            // Valid spot position
                            total_spot_shares = position.shares;
                            msg!("[NO_SELL_DEBUG] Valid spot position with {} shares", total_spot_shares);
                        }
                    }
                }
            }
        }

        // CRITICAL SECURITY: Check if leveraged position exists (new or old PDA format)
        let has_leveraged_position = ctx.remaining_accounts.iter().any(|acc| {
            if acc.lamports() == 0 { return false; }
            let (matched_pda, _, _) = find_position_pda_compat(
                &user_key, &market_key, outcome_id, 0, 1, 1, program_id, &acc.key(),
            );
            if acc.key() != matched_pda { return false; }
            if let Ok(position_data) = acc.try_borrow_data() {
                if position_data.len() >= Position::min_data_len() {
                    if let Ok(position) = Position::deserialize_compat(&position_data[8..]) {
                        return position.user == user_key
                            && position.market == market_key
                            && position.outcome_id == outcome_id
                            && position.position_type == PositionType::Leveraged as u8
                            && position.shares > 0;
                    }
                }
            }
            false
        });
        
        // CRITICAL SECURITY: Determine available shares
        // Rule 1: If user has spot position -> allow selling from spot position shares
        // Rule 2: If no spot position but leveraged position exists -> BLOCK (token account has leveraged shares)
        // Rule 3: If no spot position and no leveraged position -> allow selling from token account (minted tokens)
        let total_available_shares = if total_spot_shares > 0 {
            total_spot_shares
        } else if has_leveraged_position {
            msg!("[NO_SELL_DEBUG] User has leveraged position but no spot position - BLOCKING sell from token account");
            0
        } else {
            msg!("[NO_SELL_DEBUG] No spot position and no leveraged position - allowing sell from token account (minted tokens)");
            ctx.accounts.user_no_account.amount
        };
        
        require!(
            total_available_shares >= quantity,
            SpaceError::InsufficientShares
        );
        
        // Verify token account has enough shares for transfer
        require!(
            ctx.accounts.user_no_account.amount >= quantity,
            SpaceError::InsufficientShares
        );

        let market = &ctx.accounts.market;
        let scale = quote_scale(market.quote_decimals);
        require!(
            market.status == MarketStatus::Active as u8,
            SpaceError::MarketNotActive
        );
        require!(outcome_id < market.num_outcomes, SpaceError::InvalidOutcome);

        // Check global OI limit for leveraged orders
        if leverage > 1 {
            let notional = quantity
                .checked_mul(price)
                .and_then(|x| x.checked_div(BASIS_POINTS))
                .and_then(|x| x.checked_mul(scale))
                .ok_or(SpaceError::InvalidAmount)?;
            let new_total = market
                .total_leverage_provided
                .checked_add(notional)
                .ok_or(SpaceError::InvalidAmount)?;
            require!(
                new_total as u128 <= ctx.accounts.config.max_global_oi,
                SpaceError::InvalidAmount
            );
        }

        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp < market.end_date,
            SpaceError::MarketNotActive
        );

        require!(
            ctx.accounts.user_no_account.amount >= quantity,
            SpaceError::InsufficientShares
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
            ctx.accounts.user_no_account.mint == ctx.accounts.no_mint.key(),
            SpaceError::TokenAccountMintMismatch
        );

        // Manually initialize escrow account if needed (same as YES sell orders)
        let needs_initialization = ctx.accounts.share_escrow_no.lamports() == 0;

        if needs_initialization {
            let share_escrow_seeds = &[b"share_escrow_no", user_key.as_ref(), &order_id.to_le_bytes()];
            let share_escrow_authority_seeds = &[
                b"share_escrow_authority",
                user_key.as_ref(),
                &order_id.to_le_bytes(),
            ];

            let rent = Rent::get()?;
            let space = 165;
            let lamports = rent.minimum_balance(space);
            let (share_escrow_pda, share_escrow_bump) =
                Pubkey::find_program_address(share_escrow_seeds, ctx.program_id);
            require!(
                share_escrow_pda == ctx.accounts.share_escrow_no.key(),
                SpaceError::InvalidPDA
            );

            let (share_escrow_authority_pda, _) =
                Pubkey::find_program_address(share_escrow_authority_seeds, ctx.program_id);
            require!(
                share_escrow_authority_pda == ctx.accounts.share_escrow_authority.key(),
                SpaceError::InvalidPDA
            );

            let share_escrow_signer_seeds = &[
                b"share_escrow_no",
                user_key.as_ref(),
                &order_id.to_le_bytes(),
                &[share_escrow_bump],
            ];

            invoke_signed(
                &system_instruction::create_account(
                    &ctx.accounts.user.key(),
                    &ctx.accounts.share_escrow_no.key(),
                    lamports,
                    space as u64,
                    &ctx.accounts.token_program.key(),
                ),
                &[
                    ctx.accounts.user.to_account_info(),
                    ctx.accounts.share_escrow_no.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
                &[share_escrow_signer_seeds],
            )?;

            let init_account_ix = token_instruction::initialize_account(
                &ctx.accounts.token_program.key(),
                &ctx.accounts.share_escrow_no.key(),
                &ctx.accounts.no_mint.key(),
                &ctx.accounts.share_escrow_authority.key(),
            )?;
            anchor_lang::solana_program::program::invoke(
                &init_account_ix,
                &[
                    ctx.accounts.token_program.to_account_info(),
                    ctx.accounts.share_escrow_no.to_account_info(),
                    ctx.accounts.no_mint.to_account_info(),
                    ctx.accounts.share_escrow_authority.to_account_info(),
                    ctx.accounts.rent.to_account_info(),
                ],
            )?;
        }

        let transfer_shares_cpi = Transfer {
            from: ctx.accounts.user_no_account.to_account_info(),
            to: ctx.accounts.share_escrow_no.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                transfer_shares_cpi,
            ),
            quantity,
        )?;

        let order = &mut ctx.accounts.pending_order;
        let clock = Clock::get()?;
        order.user = ctx.accounts.user.key();
        order.market = ctx.accounts.market.key();
        order.outcome_id = outcome_id;
        order.side = 1;
        order.price = price;
        order.quantity = quantity;
        order.filled_quantity = 0;
        order.margin = 0;
        order.margin_used = 0;
        order.leverage = leverage;
        order.status = OrderStatus::Open as u8;
        order.created_at = clock.unix_timestamp;
        order.order_id = order_id;
        order.order_type = OrderType::Limit as u8;
        order.is_maker = true;
        order.fee_paid = 0;
        // Default values for leveraged close fields (not a leveraged close order)
        order.is_leveraged_close = false;
        order.borrowed_amount_to_repay = 0;
        order.collateral_to_return = 0;
        order.position_key = Pubkey::default();

        Ok(())
    }

    pub fn validate_match(
        ctx: Context<ValidateMatch>,
        buy_order_id: u64,
        sell_order_id: u64,
        match_price: u64,
        match_quantity: u64,
    ) -> Result<()> {
        let buy_order = &ctx.accounts.buy_order;
        let sell_order = &ctx.accounts.sell_order;
        let market = &ctx.accounts.market;

        require!(!ctx.accounts.config.paused, SpaceError::ProtocolPaused);
        require!(
            market.status == MarketStatus::Active as u8,
            SpaceError::MarketNotActive
        );
        require!(buy_order.market == market.key(), SpaceError::InvalidOrder);
        require!(sell_order.market == market.key(), SpaceError::InvalidOrder);

        let clock = Clock::get()?;
        require!(
            clock.unix_timestamp < market.end_date,
            SpaceError::MarketNotActive
        );
        require!(
            clock.unix_timestamp - buy_order.created_at < MAX_ORDER_AGE_SECONDS,
            SpaceError::OrderExpired
        );
        require!(
            clock.unix_timestamp - sell_order.created_at < MAX_ORDER_AGE_SECONDS,
            SpaceError::OrderExpired
        );

        require!(
            (buy_order.status == OrderStatus::Open as u8
                || buy_order.status == OrderStatus::PartiallyFilled as u8)
                && (sell_order.status == OrderStatus::Open as u8
                    || sell_order.status == OrderStatus::PartiallyFilled as u8),
            SpaceError::InvalidOrder
        );
        require!(
            buy_order.side == 0 && sell_order.side == 1,
            SpaceError::InvalidOrder
        );
        require!(
            buy_order.outcome_id == sell_order.outcome_id,
            SpaceError::InvalidOutcome
        );
        require!(
            buy_order.price >= sell_order.price,
            SpaceError::InvalidPrice
        );

        require!(
            match_price <= buy_order.price,
            SpaceError::MatchPriceOutOfBounds
        );
        require!(
            match_price >= sell_order.price,
            SpaceError::MatchPriceOutOfBounds
        );

        let buy_remaining = buy_order.quantity - buy_order.filled_quantity;
        let sell_remaining = sell_order.quantity - sell_order.filled_quantity;
        let fill_quantity = match_quantity.min(buy_remaining).min(sell_remaining);
        require!(fill_quantity > 0, SpaceError::InvalidAmount);

        // trade_value lands in quote base units: (shares * bps / 10000) * quote_scale.
        // For USDC (scale=1) this matches the pre-v2 formula byte-for-byte.
        let scale = quote_scale(market.quote_decimals);
        let trade_value = fill_quantity
            .checked_mul(match_price)
            .and_then(|v| v.checked_div(BASIS_POINTS))
            .and_then(|v| v.checked_mul(scale))
            .ok_or(SpaceError::InvalidAmount)?;

        let buy_is_maker = buy_order.created_at < sell_order.created_at
            || buy_order.order_type == OrderType::Limit as u8;
        let sell_is_maker = sell_order.created_at < buy_order.created_at
            || (sell_order.order_type == OrderType::Limit as u8 && !buy_is_maker);

        let match_state = &mut ctx.accounts.match_state;
        match_state.buy_order_id = buy_order_id;
        match_state.sell_order_id = sell_order_id;
        match_state.match_price = match_price;
        match_state.match_quantity = match_quantity;
        match_state.fill_quantity = fill_quantity;
        match_state.trade_value = trade_value;
        match_state.buy_order_user = buy_order.user;
        match_state.sell_order_user = sell_order.user;
        match_state.outcome_id = buy_order.outcome_id;
        match_state.executed = false;
        match_state.buy_executed = false;
        match_state.sell_executed = false;
        match_state.buy_is_maker = buy_is_maker;
        match_state.sell_is_maker = sell_is_maker;
        ctx.accounts.buy_order.is_maker = buy_is_maker;
        ctx.accounts.sell_order.is_maker = sell_is_maker;

        Ok(())
    }

    pub fn execute_yes_buyer_match(ctx: Context<ExecuteYesBuyerMatch>) -> Result<()> {
        let match_state = &ctx.accounts.match_state;
        // Multi-outcome: allow matching YES buyer for any valid outcome
        let market_ref = &ctx.accounts.market;
        require!(match_state.outcome_id < market_ref.num_outcomes, SpaceError::InvalidOutcome);

        require!(!match_state.executed, SpaceError::InvalidOrder);
        require!(!match_state.buy_executed, SpaceError::InvalidOrder);

        let buy_order = &mut ctx.accounts.buy_order;
        let market = &mut ctx.accounts.market;
        let market_key = market.key();
        let program_id = ctx.program_id;

        let buy_order_id_bytes = match_state.buy_order_id.to_le_bytes();
        let (expected_buy_order_escrow, _) = Pubkey::find_program_address(
            &[
                b"order_escrow",
                match_state.buy_order_user.as_ref(),
                &buy_order_id_bytes,
            ],
            program_id,
        );
        require!(
            expected_buy_order_escrow == ctx.accounts.buy_order_escrow.key(),
            SpaceError::InvalidPDA
        );

        let sell_order_id_bytes = match_state.sell_order_id.to_le_bytes();
        let (expected_sell_share_escrow_yes, _) = Pubkey::find_program_address(
            &[
                b"share_escrow",
                match_state.sell_order_user.as_ref(),
                &sell_order_id_bytes,
            ],
            program_id,
        );
        require!(
            expected_sell_share_escrow_yes == ctx.accounts.sell_share_escrow_yes.key(),
            SpaceError::InvalidPDA
        );

        let expected_yes_mint_pda = Pubkey::find_program_address(
            &[b"yes_mint", market_key.as_ref(), &[match_state.outcome_id]],
            program_id,
        )
        .0;
        require!(
            ctx.accounts.yes_mint.key() == expected_yes_mint_pda,
            SpaceError::TokenAccountMintMismatch
        );
        // Determine position type from order leverage
        let position_type = if buy_order.leverage == 1 {
            PositionType::Spot as u8
        } else {
            PositionType::Leveraged as u8
        };

        msg!("[YES_BUYER_MATCH_DEBUG] Buy order leverage: {}", buy_order.leverage);
        msg!("[YES_BUYER_MATCH_DEBUG] Determined position_type: {} ({} = Spot, {} = Leveraged)", position_type, PositionType::Spot as u8, PositionType::Leveraged as u8);

        let yes_token_type: u8 = 0; // YES buyer match → token_type = 0
        // Backward compat: accept both new PDA (with token_type) and old PDA (without)
        let (expected_position_pda, _position_bump, is_new_pda_format) = find_position_pda_compat(
            &match_state.buy_order_user, &market_key, match_state.outcome_id,
            0, position_type, yes_token_type, program_id,
            &ctx.accounts.buy_position.key(),
        );

        msg!("[YES_BUYER_MATCH_DEBUG] Expected position PDA: {} (new_format={})", expected_position_pda, is_new_pda_format);
        msg!("[YES_BUYER_MATCH_DEBUG] Provided position PDA: {}", ctx.accounts.buy_position.key());

        require!(
            expected_position_pda == ctx.accounts.buy_position.key(),
            SpaceError::InvalidPDA
        );
        let (expected_market_vault, _) =
            Pubkey::find_program_address(&[b"vault", market_key.as_ref()], program_id);
        require!(
            expected_market_vault == ctx.accounts.market_vault.key(),
            SpaceError::InvalidPDA
        );

        let (expected_margin_vault, _) =
            Pubkey::find_program_address(&[b"margin_vault", market_key.as_ref()], program_id);
        require!(
            expected_margin_vault == ctx.accounts.margin_vault.key(),
            SpaceError::InvalidPDA
        );

        let (expected_liquidity_vault, _) =
            Pubkey::find_program_address(&[b"liquidity_vault", market_key.as_ref()], program_id);
        require!(
            expected_liquidity_vault == ctx.accounts.liquidity_vault.key(),
            SpaceError::InvalidPDA
        );

        let (expected_buy_order_escrow_authority, _) = Pubkey::find_program_address(
            &[
                b"order_escrow_authority",
                match_state.buy_order_user.as_ref(),
                &buy_order_id_bytes,
            ],
            program_id,
        );
        require!(
            expected_buy_order_escrow_authority == ctx.accounts.buy_order_escrow_authority.key(),
            SpaceError::InvalidPDA
        );

        let (expected_sell_share_escrow_authority, _) = Pubkey::find_program_address(
            &[
                b"share_escrow_authority",
                match_state.sell_order_user.as_ref(),
                &sell_order_id_bytes,
            ],
            program_id,
        );
        require!(
            expected_sell_share_escrow_authority == ctx.accounts.sell_share_escrow_authority.key(),
            SpaceError::InvalidPDA
        );

        let (expected_vault_authority, _) =
            Pubkey::find_program_address(&[b"vault_authority", market_key.as_ref()], program_id);
        require!(
            expected_vault_authority == ctx.accounts.vault_authority.key(),
            SpaceError::InvalidPDA
        );

        let (expected_margin_vault_authority, _) = Pubkey::find_program_address(
            &[b"margin_vault_authority", market_key.as_ref()],
            program_id,
        );
        require!(
            expected_margin_vault_authority == ctx.accounts.margin_vault_authority.key(),
            SpaceError::InvalidPDA
        );

        let (expected_liquidity_vault_authority, _) = Pubkey::find_program_address(
            &[b"liquidity_vault_authority", market_key.as_ref()],
            program_id,
        );
        require!(
            expected_liquidity_vault_authority == ctx.accounts.liquidity_vault_authority.key(),
            SpaceError::InvalidPDA
        );
        require!(
            ctx.accounts.buy_user_outcome_account.owner == match_state.buy_order_user,
            SpaceError::TokenAccountOwnershipMismatch
        );
        require!(
            ctx.accounts.buy_user_outcome_account.mint == ctx.accounts.yes_mint.key(),
            SpaceError::TokenAccountMintMismatch
        );

        let (escrow_mint, escrow_amount) = {
            let escrow_data = ctx.accounts.sell_share_escrow_yes.try_borrow_data()?;
            let mint =
                Pubkey::try_from(&escrow_data[0..32]).map_err(|_| SpaceError::InvalidOutcome)?;
            let amount = u64::from_le_bytes(
                escrow_data[64..72]
                    .try_into()
                    .map_err(|_| SpaceError::InvalidOutcome)?,
            );
            (mint, amount)
        };

        require!(
            escrow_mint == ctx.accounts.yes_mint.key(),
            SpaceError::TokenAccountMintMismatch
        );
        require!(
            escrow_amount >= match_state.fill_quantity,
            SpaceError::InsufficientShares
        );

        // Load or create YES buyer position account
        let outcome_id_bytes = [match_state.outcome_id];
        let side_bytes = [0u8];
        let position_type_bytes = [position_type];
        let token_type_bytes = [yes_token_type]; // 0 = YES

        let mut buy_position = if ctx.accounts.buy_position.lamports() == 0 {
            // Create NEW position — always use new PDA format (with token_type)
            msg!("[YES_BUYER_MATCH_DEBUG] Creating NEW position account (position_type={}, token_type={})", position_type, yes_token_type);
            let rent = Rent::get()?;
            let space = 8 + Position::LEN;
            let lamports = rent.minimum_balance(space);

            // New positions always use 7-seed format
            let (_, position_bump) = Pubkey::find_program_address(
                &[b"position", match_state.buy_order_user.as_ref(), market_key.as_ref(),
                  &outcome_id_bytes, &side_bytes, &position_type_bytes, &token_type_bytes],
                program_id,
            );

            let position_signer_seeds: &[&[u8]] = &[
                b"position", match_state.buy_order_user.as_ref(), market_key.as_ref(),
                &outcome_id_bytes, &side_bytes, &position_type_bytes, &token_type_bytes,
                &[position_bump],
            ];

            invoke_signed(
                &system_instruction::create_account(
                    ctx.accounts.keeper.key,
                    ctx.accounts.buy_position.key,
                    lamports,
                    space as u64,
                    program_id,
                ),
                &[
                    ctx.accounts.keeper.to_account_info(),
                    ctx.accounts.buy_position.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
                &[position_signer_seeds],
            )?;

            // Validate spot position invariants
            if position_type == PositionType::Spot as u8 {
                require!(buy_order.leverage == 1, SpaceError::InvalidSpotLeverage);
            }

            // Calculate liquidation price for leveraged positions
            let liquidation_price = if position_type == PositionType::Leveraged as u8 {
                calculate_liquidation_price(
                    match_state.match_price,
                    buy_order.leverage,
                    0, // side = 0 for long
                    MAINTENANCE_MARGIN_BPS,
                )?
            } else {
                0
            };

            // Initialize position
            let position_data = Position {
                user: match_state.buy_order_user,
                market: market_key,
                outcome_id: match_state.outcome_id,
                side: 0,
                shares: 0,
                avg_entry_price: 0,
                leverage: buy_order.leverage,
                collateral: 0,
                borrowed_amount: 0,
                position_type,
                liquidation_price,
                is_open: true,
                token_type: yes_token_type, // 0 = YES
            };

            let mut position_account_data = ctx.accounts.buy_position.try_borrow_mut_data()?;
            let discriminator: [u8; 8] = [170, 188, 143, 228, 122, 64, 247, 208];
            position_account_data[0..8].copy_from_slice(&discriminator);
            let serialized = position_data.try_to_vec()?;
            position_account_data[8..8 + serialized.len()].copy_from_slice(&serialized);

            position_data
        } else {
            // EXISTING POSITION - 🔒 CRITICAL: Prevent merging spot and leveraged
            msg!("[YES_BUYER_MATCH_DEBUG] Updating EXISTING position account (position_type={})", position_type);
            let position_data_slice = ctx.accounts.buy_position.try_borrow_data()?;
            let existing_position = Position::deserialize_compat(&position_data_slice[8..])?;

            msg!("[YES_BUYER_MATCH_DEBUG] Existing position - position_type: {}, leverage: {}, borrowed_amount: {}, shares: {}", 
                existing_position.position_type, 
                existing_position.leverage, 
                existing_position.borrowed_amount,
                existing_position.shares
            );
            msg!("[YES_BUYER_MATCH_DEBUG] New order - position_type: {}, leverage: {}", position_type, buy_order.leverage);

            let existing_is_spot = existing_position.position_type == PositionType::Spot as u8;
            let order_is_spot = position_type == PositionType::Spot as u8;

            // HARD REJECT: Cannot merge spot and leveraged
            require!(
                existing_is_spot == order_is_spot,
                SpaceError::PositionTypeMismatch
            );

            // Ensure position is open
            require!(existing_position.is_open, SpaceError::PositionNotOpen);

            existing_position
        };

        let (_expected_signer_pda, sell_share_escrow_authority_bump) = Pubkey::find_program_address(
            &[
                b"share_escrow_authority",
                match_state.sell_order_user.as_ref(),
                &sell_order_id_bytes,
            ],
            program_id,
        );

        let sell_escrow_seeds = &[
            b"share_escrow_authority",
            match_state.sell_order_user.as_ref(),
            &sell_order_id_bytes,
            &[sell_share_escrow_authority_bump],
        ];
        let sell_escrow_signer = &[&sell_escrow_seeds[..]];

        let transfer_cpi = Transfer {
            from: ctx.accounts.sell_share_escrow_yes.to_account_info(),
            to: ctx.accounts.buy_user_outcome_account.to_account_info(),
            authority: ctx.accounts.sell_share_escrow_authority.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                transfer_cpi,
                sell_escrow_signer,
            ),
            match_state.fill_quantity,
        )?;
        let (_, buy_order_escrow_authority_bump) = Pubkey::find_program_address(
            &[
                b"order_escrow_authority",
                match_state.buy_order_user.as_ref(),
                &buy_order_id_bytes,
            ],
            program_id,
        );
        let buy_escrow_seeds = &[
            b"order_escrow_authority",
            match_state.buy_order_user.as_ref(),
            &buy_order_id_bytes,
            &[buy_order_escrow_authority_bump],
        ];
        let buy_escrow_signer = &[&buy_escrow_seeds[..]];
        let buyer_fee = if match_state.buy_is_maker {
            MAKER_FEE_BPS
        } else {
            calculate_dynamic_fee(match_state.match_price, 0)
        };
        let buyer_fee_amount = match_state
            .trade_value
            .checked_mul(buyer_fee)
            .and_then(|x| x.checked_div(BASIS_POINTS))
            .ok_or(SpaceError::InvalidAmount)?;

        // Calculate margin used for this fill proportionally:
        //   margin_used_this_fill = (fill_quantity / order_quantity) * buy_order.margin
        //
        // u64 product overflows on SPACE-denominated markets (quote_decimals=9,
        // quote_scale=1000) once the order notional exceeds ~600 shares —
        // buy_order.margin scales with quote_scale, and fill_quantity ×
        // buy_order.margin can hit ~10^20 (u64::MAX is ~1.8×10^19). The
        // previous u64-checked_mul path silently fell back to 0 on overflow,
        // which made available_margin = 0, borrowed_amount = full trade_value,
        // collateral = 0 on the resulting position record, and on settle the
        // user got nothing because margin_vault never received their funds.
        //
        // u128 intermediate avoids the overflow entirely. The result is
        // mathematically <= buy_order.margin (u64) since fill_quantity <=
        // buy_order.quantity, so the cast back to u64 is provably safe.
        let margin_used_this_fill = if buy_order.quantity > 0 {
            let product = (match_state.fill_quantity as u128)
                .checked_mul(buy_order.margin as u128)
                .ok_or(SpaceError::InvalidAmount)?;
            let result = product / (buy_order.quantity as u128);
            u64::try_from(result).map_err(|_| SpaceError::InvalidAmount)?
        } else {
            0
        };

        let escrow_balance = {
            let escrow_data = ctx.accounts.buy_order_escrow.try_borrow_data()?;
            u64::from_le_bytes(
                escrow_data[64..72]
                    .try_into()
                    .map_err(|_| SpaceError::InvalidOutcome)?,
            )
        };

        let available_margin = escrow_balance.min(margin_used_this_fill);
        let borrowed_amount = match_state.trade_value.saturating_sub(available_margin);

        if buy_order.leverage > 1 {
            if available_margin > 0 {
                let transfer_cpi = Transfer {
                    from: ctx.accounts.buy_order_escrow.to_account_info(),
                    to: ctx.accounts.margin_vault.to_account_info(),
                    authority: ctx.accounts.buy_order_escrow_authority.to_account_info(),
                };
                token::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        transfer_cpi,
                        buy_escrow_signer,
                    ),
                    available_margin,
                )?;
            }

            if borrowed_amount > 0 {
                let liquidity_amount = {
                    let liquidity_data = ctx.accounts.liquidity_vault.try_borrow_data()?;
                    u64::from_le_bytes(
                        liquidity_data[64..72]
                            .try_into()
                            .map_err(|_| SpaceError::InvalidOutcome)?,
                    )
                };

                require!(
                    liquidity_amount >= borrowed_amount,
                    SpaceError::InsufficientVaultBalance
                );

                let market_key = market.key();
                let (_, liquidity_vault_authority_bump) = Pubkey::find_program_address(
                    &[b"liquidity_vault_authority", market_key.as_ref()],
                    program_id,
                );
                let liquidity_vault_seeds = &[
                    b"liquidity_vault_authority",
                    market_key.as_ref(),
                    &[liquidity_vault_authority_bump],
                ];
                let liquidity_vault_signer = &[&liquidity_vault_seeds[..]];

                let borrow_cpi = Transfer {
                    from: ctx.accounts.liquidity_vault.to_account_info(),
                    to: ctx.accounts.market_vault.to_account_info(),
                    authority: ctx.accounts.liquidity_vault_authority.to_account_info(),
                };
                token::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        borrow_cpi,
                        liquidity_vault_signer,
                    ),
                    borrowed_amount,
                )?;
            }
        } else {
            if available_margin > 0 {
                let transfer_cpi = Transfer {
                    from: ctx.accounts.buy_order_escrow.to_account_info(),
                    to: ctx.accounts.market_vault.to_account_info(),
                    authority: ctx.accounts.buy_order_escrow_authority.to_account_info(),
                };
                token::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        transfer_cpi,
                        buy_escrow_signer,
                    ),
                    available_margin,
                )?;
            }
        }

        buy_order.fee_paid += buyer_fee_amount;
        let fill_quantity = match_state.fill_quantity;
        let match_price = match_state.match_price;
        let buy_order_user = match_state.buy_order_user;
        let outcome_id = match_state.outcome_id;
        buy_order.margin_used += available_margin;

        if buy_position.shares == 0 {
            buy_position.user = buy_order_user;
            buy_position.market = market_key;
            buy_position.outcome_id = outcome_id;
            buy_position.side = 0;
            buy_position.avg_entry_price = match_price;
            buy_position.leverage = buy_order.leverage;
            buy_position.position_type = position_type;
            buy_position.is_open = true;
            buy_position.token_type = yes_token_type; // 0 = YES

            // Calculate liquidation price for leveraged positions
            if position_type == PositionType::Leveraged as u8 {
                buy_position.liquidation_price = calculate_liquidation_price(
                    match_price,
                    buy_order.leverage,
                    0, // side = 0 for long
                    MAINTENANCE_MARGIN_BPS,
                )?;
            } else {
                buy_position.liquidation_price = 0;
                // Enforce spot invariants
                require!(buy_order.leverage == 1, SpaceError::InvalidSpotLeverage);
                require!(borrowed_amount == 0, SpaceError::InvalidSpotDebt);
            }
        } else {
            let total_value = (buy_position.shares * buy_position.avg_entry_price)
                + (fill_quantity * match_price);
            let total_shares = buy_position.shares + fill_quantity;
            require!(total_shares > 0, SpaceError::InvalidAmount);
            buy_position.avg_entry_price = total_value / total_shares;

            // Recalculate liquidation price for leveraged positions after adding to position
            if position_type == PositionType::Leveraged as u8 {
                buy_position.liquidation_price = calculate_liquidation_price(
                    buy_position.avg_entry_price,
                    buy_position.leverage,
                    buy_position.side,
                    MAINTENANCE_MARGIN_BPS,
                )?;
            }
        }
        buy_position.shares += fill_quantity;
        buy_position.collateral += available_margin;
        buy_position.borrowed_amount += borrowed_amount;

        // Enforce spot invariants
        if position_type == PositionType::Spot as u8 {
            require!(
                buy_position.borrowed_amount == 0,
                SpaceError::InvalidSpotDebt
            );
            require!(buy_position.leverage == 1, SpaceError::InvalidSpotLeverage);
            require!(
                buy_position.liquidation_price == 0,
                SpaceError::InvalidSpotDebt
            );
        }

        msg!("[YES_BUYER_MATCH_DEBUG] Position updated after fill:");
        msg!(
            "[YES_BUYER_MATCH_DEBUG] Position key: {}",
            ctx.accounts.buy_position.key()
        );
        msg!("[YES_BUYER_MATCH_DEBUG] User: {}", buy_position.user);
        msg!("[YES_BUYER_MATCH_DEBUG] Market: {}", buy_position.market);
        msg!(
            "[YES_BUYER_MATCH_DEBUG] Outcome ID: {}",
            buy_position.outcome_id
        );
        msg!("[YES_BUYER_MATCH_DEBUG] Side: {}", buy_position.side);
        msg!("[YES_BUYER_MATCH_DEBUG] Shares: {}", buy_position.shares);
        msg!(
            "[YES_BUYER_MATCH_DEBUG] Collateral: {}",
            buy_position.collateral
        );
        msg!(
            "[YES_BUYER_MATCH_DEBUG] Borrowed Amount: {}",
            buy_position.borrowed_amount
        );
        msg!(
            "[YES_BUYER_MATCH_DEBUG] Leverage: {}",
            buy_position.leverage
        );
        msg!(
            "[YES_BUYER_MATCH_DEBUG] This fill - borrowed_amount added: {}",
            borrowed_amount
        );
        msg!(
            "[YES_BUYER_MATCH_DEBUG] This fill - available_margin: {}",
            available_margin
        );
        msg!(
            "[YES_BUYER_MATCH_DEBUG] Trade value: {}",
            match_state.trade_value
        );
        msg!(
            "[YES_BUYER_MATCH_DEBUG] Order leverage: {}",
            buy_order.leverage
        );

        // Update global OI when leveraged position is opened (quote base units)
        if buy_order.leverage > 1 {
            let scale = quote_scale(market.quote_decimals);
            let notional = fill_quantity
                .checked_mul(match_price)
                .and_then(|x| x.checked_div(BASIS_POINTS))
                .and_then(|x| x.checked_mul(scale))
                .ok_or(SpaceError::InvalidAmount)?;
            market.total_leverage_provided = market
                .total_leverage_provided
                .checked_add(notional)
                .ok_or(SpaceError::InvalidAmount)?;
        }

        {
            let serialized = buy_position.try_to_vec()?;
            let required_len = 8 + serialized.len();
            // Realloc if old-format account is too small (117 → 118 bytes)
            if ctx.accounts.buy_position.data_len() < required_len {
                let rent = Rent::get()?;
                let new_minimum = rent.minimum_balance(required_len);
                let current_lamports = ctx.accounts.buy_position.lamports();
                if current_lamports < new_minimum {
                    let diff = new_minimum - current_lamports;
                    invoke(
                        &system_instruction::transfer(
                            ctx.accounts.keeper.key,
                            ctx.accounts.buy_position.key,
                            diff,
                        ),
                        &[
                            ctx.accounts.keeper.to_account_info(),
                            ctx.accounts.buy_position.to_account_info(),
                            ctx.accounts.system_program.to_account_info(),
                        ],
                    )?;
                }
                ctx.accounts.buy_position.realloc(required_len, false)?;
            }
            let mut position_account_data = ctx.accounts.buy_position.try_borrow_mut_data()?;
            position_account_data[8..8 + serialized.len()].copy_from_slice(&serialized);
        }

        ctx.accounts.match_state.buy_executed = true;

        buy_order.filled_quantity += fill_quantity;
        if buy_order.filled_quantity >= buy_order.quantity {
            buy_order.status = OrderStatus::Filled as u8;
        } else if buy_order.filled_quantity > 0 {
            buy_order.status = OrderStatus::PartiallyFilled as u8;
        }

        Ok(())
    }

    pub fn execute_no_buyer_match(ctx: Context<ExecuteNoBuyerMatch>) -> Result<()> {
        let match_state = &ctx.accounts.match_state;
        let market_ref = &ctx.accounts.market;

        // Validate outcome_id is within range
        require!(match_state.outcome_id < market_ref.num_outcomes, SpaceError::InvalidOutcome);
        require!(!match_state.executed, SpaceError::InvalidOrder);
        require!(!match_state.buy_executed, SpaceError::InvalidOrder);

        let buy_order = &mut ctx.accounts.buy_order;
        let market = &mut ctx.accounts.market;
        let market_key = market.key();
        let program_id = ctx.program_id;

        let buy_order_id_bytes = match_state.buy_order_id.to_le_bytes();
        let sell_order_id_bytes = match_state.sell_order_id.to_le_bytes();

        let (expected_buy_order_escrow, _) = Pubkey::find_program_address(
            &[
                b"order_escrow",
                match_state.buy_order_user.as_ref(),
                &buy_order_id_bytes,
            ],
            program_id,
        );
        require!(
            expected_buy_order_escrow == ctx.accounts.buy_order_escrow.key(),
            SpaceError::InvalidPDA
        );

        let (expected_sell_share_escrow_no, _) = Pubkey::find_program_address(
            &[
                b"share_escrow_no",
                match_state.sell_order_user.as_ref(),
                &sell_order_id_bytes,
            ],
            program_id,
        );
        require!(
            expected_sell_share_escrow_no == ctx.accounts.sell_share_escrow_no.key(),
            SpaceError::InvalidPDA
        );

        // Validate NO mint: per-outcome PDA for new markets, shared mint for old markets
        if market.no_mint == Pubkey::default() {
            let (expected_no_mint, _) = Pubkey::find_program_address(
                &[b"no_mint", market_key.as_ref(), &[match_state.outcome_id]],
                program_id,
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

        // Determine position type from order leverage
        let position_type = if buy_order.leverage == 1 {
            PositionType::Spot as u8
        } else {
            PositionType::Leveraged as u8
        };

        let no_token_type: u8 = 1; // NO buyer match → token_type = 1
        // Backward compat: accept both new PDA (with token_type) and old PDA (without)
        let (expected_position_pda, _, _is_new_pda_format) = find_position_pda_compat(
            &match_state.buy_order_user, &market_key, match_state.outcome_id,
            0, position_type, no_token_type, program_id,
            &ctx.accounts.buy_position.key(),
        );
        require!(
            expected_position_pda == ctx.accounts.buy_position.key(),
            SpaceError::InvalidPDA
        );

        let (expected_market_vault, _) =
            Pubkey::find_program_address(&[b"vault", market_key.as_ref()], program_id);
        require!(
            expected_market_vault == ctx.accounts.market_vault.key(),
            SpaceError::InvalidPDA
        );

        let (expected_margin_vault, _) =
            Pubkey::find_program_address(&[b"margin_vault", market_key.as_ref()], program_id);
        require!(
            expected_margin_vault == ctx.accounts.margin_vault.key(),
            SpaceError::InvalidPDA
        );

        let (expected_liquidity_vault, _) =
            Pubkey::find_program_address(&[b"liquidity_vault", market_key.as_ref()], program_id);
        require!(
            expected_liquidity_vault == ctx.accounts.liquidity_vault.key(),
            SpaceError::InvalidPDA
        );

        let (expected_buy_order_escrow_authority, _) = Pubkey::find_program_address(
            &[
                b"order_escrow_authority",
                match_state.buy_order_user.as_ref(),
                &buy_order_id_bytes,
            ],
            program_id,
        );
        require!(
            expected_buy_order_escrow_authority == ctx.accounts.buy_order_escrow_authority.key(),
            SpaceError::InvalidPDA
        );

        let (expected_sell_share_escrow_authority, _) = Pubkey::find_program_address(
            &[
                b"share_escrow_authority",
                match_state.sell_order_user.as_ref(),
                &sell_order_id_bytes,
            ],
            program_id,
        );
        require!(
            expected_sell_share_escrow_authority == ctx.accounts.sell_share_escrow_authority.key(),
            SpaceError::InvalidPDA
        );

        let (expected_vault_authority, _) =
            Pubkey::find_program_address(&[b"vault_authority", market_key.as_ref()], program_id);
        require!(
            expected_vault_authority == ctx.accounts.vault_authority.key(),
            SpaceError::InvalidPDA
        );

        let (expected_margin_vault_authority, _) = Pubkey::find_program_address(
            &[b"margin_vault_authority", market_key.as_ref()],
            program_id,
        );
        require!(
            expected_margin_vault_authority == ctx.accounts.margin_vault_authority.key(),
            SpaceError::InvalidPDA
        );

        let (expected_liquidity_vault_authority, _) = Pubkey::find_program_address(
            &[b"liquidity_vault_authority", market_key.as_ref()],
            program_id,
        );
        require!(
            expected_liquidity_vault_authority == ctx.accounts.liquidity_vault_authority.key(),
            SpaceError::InvalidPDA
        );

        require!(
            ctx.accounts.buy_user_outcome_account.owner == match_state.buy_order_user,
            SpaceError::TokenAccountOwnershipMismatch
        );
        require!(
            ctx.accounts.buy_user_outcome_account.mint == ctx.accounts.no_mint.key(),
            SpaceError::TokenAccountMintMismatch
        );

        let (escrow_mint, escrow_amount) = {
            // Check if escrow account is initialized (has lamports and data)
            require!(
                ctx.accounts.sell_share_escrow_no.lamports() > 0,
                SpaceError::InvalidOutcome
            );
            let escrow_data = ctx.accounts.sell_share_escrow_no.try_borrow_data()?;
            // Check if escrow account has enough data (TokenAccount is 165 bytes minimum)
            require!(
                escrow_data.len() >= 72,
                SpaceError::InvalidOutcome
            );
            let mint =
                Pubkey::try_from(&escrow_data[0..32]).map_err(|_| SpaceError::InvalidOutcome)?;
            let amount = u64::from_le_bytes(
                escrow_data[64..72]
                    .try_into()
                    .map_err(|_| SpaceError::InvalidOutcome)?,
            );
            (mint, amount)
        };

        require!(
            escrow_mint == ctx.accounts.no_mint.key(),
            SpaceError::TokenAccountMintMismatch
        );
        require!(
            escrow_amount >= match_state.fill_quantity,
            SpaceError::InsufficientShares
        );

        // Load or create NO buyer position account
        let outcome_id_bytes = [match_state.outcome_id];
        let side_bytes = [0u8];
        let position_type_bytes = [position_type];
        let token_type_bytes = [no_token_type]; // 1 = NO

        let mut buy_position = if ctx.accounts.buy_position.lamports() == 0 {
            // Create NEW position — always use new PDA format (with token_type)
            let rent = Rent::get()?;
            let space = 8 + Position::LEN;
            let lamports = rent.minimum_balance(space);

            let (_, position_bump) = Pubkey::find_program_address(
                &[b"position", match_state.buy_order_user.as_ref(), market_key.as_ref(),
                  &outcome_id_bytes, &side_bytes, &position_type_bytes, &token_type_bytes],
                program_id,
            );
            let position_signer_seeds: &[&[u8]] = &[
                b"position", match_state.buy_order_user.as_ref(), market_key.as_ref(),
                &outcome_id_bytes, &side_bytes, &position_type_bytes, &token_type_bytes,
                &[position_bump],
            ];

            invoke_signed(
                &system_instruction::create_account(
                    ctx.accounts.keeper.key,
                    ctx.accounts.buy_position.key,
                    lamports,
                    space as u64,
                    program_id,
                ),
                &[
                    ctx.accounts.keeper.to_account_info(),
                    ctx.accounts.buy_position.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
                &[position_signer_seeds],
            )?;

            // Validate spot position invariants
            if position_type == PositionType::Spot as u8 {
                require!(buy_order.leverage == 1, SpaceError::InvalidSpotLeverage);
            }

            // Calculate liquidation price for leveraged positions
            let liquidation_price = if position_type == PositionType::Leveraged as u8 {
                calculate_liquidation_price(
                    match_state.match_price,
                    buy_order.leverage,
                    0, // side = 0 for long
                    MAINTENANCE_MARGIN_BPS,
                )?
            } else {
                0
            };

            // Initialize position
            let position_data = Position {
                user: match_state.buy_order_user,
                market: market_key,
                outcome_id: match_state.outcome_id,
                side: 0,
                shares: 0,
                avg_entry_price: 0,
                leverage: buy_order.leverage,
                collateral: 0,
                borrowed_amount: 0,
                position_type,
                liquidation_price,
                is_open: true,
                token_type: no_token_type, // 1 = NO
            };

            let mut position_account_data = ctx.accounts.buy_position.try_borrow_mut_data()?;
            let discriminator: [u8; 8] = [170, 188, 143, 228, 122, 64, 247, 208];
            position_account_data[0..8].copy_from_slice(&discriminator);
            let serialized = position_data.try_to_vec()?;
            position_account_data[8..8 + serialized.len()].copy_from_slice(&serialized);

            position_data
        } else {
            // EXISTING POSITION - 🔒 CRITICAL: Prevent merging spot and leveraged
            let position_data_slice = ctx.accounts.buy_position.try_borrow_data()?;
            let existing_position = Position::deserialize_compat(&position_data_slice[8..])?;

            let existing_is_spot = existing_position.position_type == PositionType::Spot as u8;
            let order_is_spot = position_type == PositionType::Spot as u8;

            // HARD REJECT: Cannot merge spot and leveraged
            require!(
                existing_is_spot == order_is_spot,
                SpaceError::PositionTypeMismatch
            );

            // Ensure position is open
            require!(existing_position.is_open, SpaceError::PositionNotOpen);

            existing_position
        };

        let (_, sell_share_escrow_authority_bump) = Pubkey::find_program_address(
            &[
                b"share_escrow_authority",
                match_state.sell_order_user.as_ref(),
                &sell_order_id_bytes,
            ],
            program_id,
        );
        let sell_escrow_seeds = &[
            b"share_escrow_authority",
            match_state.sell_order_user.as_ref(),
            &sell_order_id_bytes,
            &[sell_share_escrow_authority_bump],
        ];
        let sell_escrow_signer = &[&sell_escrow_seeds[..]];

        let transfer_cpi = Transfer {
            from: ctx.accounts.sell_share_escrow_no.to_account_info(),
            to: ctx.accounts.buy_user_outcome_account.to_account_info(),
            authority: ctx.accounts.sell_share_escrow_authority.to_account_info(),
        };
        token::transfer(
            CpiContext::new_with_signer(
                ctx.accounts.token_program.to_account_info(),
                transfer_cpi,
                sell_escrow_signer,
            ),
            match_state.fill_quantity,
        )?;

        let (_, buy_order_escrow_authority_bump) = Pubkey::find_program_address(
            &[
                b"order_escrow_authority",
                match_state.buy_order_user.as_ref(),
                &buy_order_id_bytes,
            ],
            program_id,
        );
        let buy_escrow_seeds = &[
            b"order_escrow_authority",
            match_state.buy_order_user.as_ref(),
            &buy_order_id_bytes,
            &[buy_order_escrow_authority_bump],
        ];
        let buy_escrow_signer = &[&buy_escrow_seeds[..]];

        let buyer_fee = if match_state.buy_is_maker {
            MAKER_FEE_BPS
        } else {
            calculate_dynamic_fee(match_state.match_price, 0)
        };
        let buyer_fee_amount = match_state
            .trade_value
            .checked_mul(buyer_fee)
            .and_then(|x| x.checked_div(BASIS_POINTS))
            .ok_or(SpaceError::InvalidAmount)?;

        // Proportional margin. SPACE-scaled buy_order.margin (~10^12 for a
        // moderate notional) multiplied by fill_quantity (~10^8) overflows
        // u64 (max ~1.8e19) once the order is sizable. The previous u64
        // path silently returned 0 on overflow, leaving the leveraged path
        // with available_margin=0 and borrowed_amount=full trade_value —
        // which is exactly what stranded users with collateral=0 positions
        // that paid out nothing on settle. u128 fixes it.
        let margin_used_this_fill = if buy_order.quantity > 0 {
            let product = (match_state.fill_quantity as u128)
                .checked_mul(buy_order.margin as u128)
                .ok_or(SpaceError::InvalidAmount)?;
            let result = product / (buy_order.quantity as u128);
            u64::try_from(result).map_err(|_| SpaceError::InvalidAmount)?
        } else {
            0
        };

        let escrow_balance = {
            let escrow_data = ctx.accounts.buy_order_escrow.try_borrow_data()?;
            u64::from_le_bytes(
                escrow_data[64..72]
                    .try_into()
                    .map_err(|_| SpaceError::InvalidOutcome)?,
            )
        };

        let available_margin = escrow_balance.min(margin_used_this_fill);

        let borrowed_amount = match_state.trade_value.saturating_sub(available_margin);

        if buy_order.leverage > 1 {
            if available_margin > 0 {
                let transfer_cpi = Transfer {
                    from: ctx.accounts.buy_order_escrow.to_account_info(),
                    to: ctx.accounts.margin_vault.to_account_info(),
                    authority: ctx.accounts.buy_order_escrow_authority.to_account_info(),
                };
                token::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        transfer_cpi,
                        buy_escrow_signer,
                    ),
                    available_margin,
                )?;
            }

            if borrowed_amount > 0 {
                let liquidity_amount = {
                    let liquidity_data = ctx.accounts.liquidity_vault.try_borrow_data()?;
                    u64::from_le_bytes(
                        liquidity_data[64..72]
                            .try_into()
                            .map_err(|_| SpaceError::InvalidOutcome)?,
                    )
                };

                require!(
                    liquidity_amount >= borrowed_amount,
                    SpaceError::InsufficientVaultBalance
                );

                let (_, liquidity_vault_authority_bump) = Pubkey::find_program_address(
                    &[b"liquidity_vault_authority", market_key.as_ref()],
                    program_id,
                );
                let liquidity_vault_seeds = &[
                    b"liquidity_vault_authority",
                    market_key.as_ref(),
                    &[liquidity_vault_authority_bump],
                ];
                let liquidity_vault_signer = &[&liquidity_vault_seeds[..]];

                let borrow_cpi = Transfer {
                    from: ctx.accounts.liquidity_vault.to_account_info(),
                    to: ctx.accounts.market_vault.to_account_info(),
                    authority: ctx.accounts.liquidity_vault_authority.to_account_info(),
                };
                token::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        borrow_cpi,
                        liquidity_vault_signer,
                    ),
                    borrowed_amount,
                )?;
            }
        } else {
            if available_margin > 0 {
                let transfer_cpi = Transfer {
                    from: ctx.accounts.buy_order_escrow.to_account_info(),
                    to: ctx.accounts.market_vault.to_account_info(),
                    authority: ctx.accounts.buy_order_escrow_authority.to_account_info(),
                };
                token::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        transfer_cpi,
                        buy_escrow_signer,
                    ),
                    available_margin,
                )?;
            }
        }

        // Track fee paid
        buy_order.fee_paid += buyer_fee_amount;

        let fill_quantity = match_state.fill_quantity;
        let match_price = match_state.match_price;
        let buy_order_user = match_state.buy_order_user;
        let outcome_id = match_state.outcome_id;

        buy_order.margin_used += available_margin;
        if buy_position.shares == 0 {
            buy_position.user = buy_order_user;
            buy_position.market = market_key;
            buy_position.outcome_id = outcome_id;
            buy_position.side = 0;
            buy_position.avg_entry_price = match_price;
            buy_position.leverage = buy_order.leverage;
            buy_position.position_type = position_type;
            buy_position.is_open = true;
            buy_position.token_type = no_token_type; // 1 = NO

            // Calculate liquidation price for leveraged positions
            if position_type == PositionType::Leveraged as u8 {
                buy_position.liquidation_price = calculate_liquidation_price(
                    match_price,
                    buy_order.leverage,
                    0, // side = 0 for long
                    MAINTENANCE_MARGIN_BPS,
                )?;
            } else {
                buy_position.liquidation_price = 0;
                // Enforce spot invariants
                require!(buy_order.leverage == 1, SpaceError::InvalidSpotLeverage);
                require!(borrowed_amount == 0, SpaceError::InvalidSpotDebt);
            }
        } else {
            let total_value = (buy_position.shares * buy_position.avg_entry_price)
                + (fill_quantity * match_price);
            let total_shares = buy_position.shares + fill_quantity;
            require!(total_shares > 0, SpaceError::InvalidAmount);
            buy_position.avg_entry_price = total_value / total_shares;

            // Recalculate liquidation price for leveraged positions after adding to position
            if position_type == PositionType::Leveraged as u8 {
                buy_position.liquidation_price = calculate_liquidation_price(
                    buy_position.avg_entry_price,
                    buy_position.leverage,
                    buy_position.side,
                    MAINTENANCE_MARGIN_BPS,
                )?;
            }
        }
        buy_position.shares += fill_quantity;
        buy_position.collateral += available_margin;
        buy_position.borrowed_amount += borrowed_amount;

        // Enforce spot invariants
        if position_type == PositionType::Spot as u8 {
            require!(
                buy_position.borrowed_amount == 0,
                SpaceError::InvalidSpotDebt
            );
            require!(buy_position.leverage == 1, SpaceError::InvalidSpotLeverage);
            require!(
                buy_position.liquidation_price == 0,
                SpaceError::InvalidSpotDebt
            );
        }

        // Update global OI when leveraged position is opened (quote base units)
        if buy_order.leverage > 1 {
            let scale = quote_scale(market.quote_decimals);
            let notional = fill_quantity
                .checked_mul(match_price)
                .and_then(|x| x.checked_div(BASIS_POINTS))
                .and_then(|x| x.checked_mul(scale))
                .ok_or(SpaceError::InvalidAmount)?;
            market.total_leverage_provided = market
                .total_leverage_provided
                .checked_add(notional)
                .ok_or(SpaceError::InvalidAmount)?;
        }

        {
            let serialized = buy_position.try_to_vec()?;
            let required_len = 8 + serialized.len();
            // Realloc if old-format account is too small (117 → 118 bytes)
            if ctx.accounts.buy_position.data_len() < required_len {
                let rent = Rent::get()?;
                let new_minimum = rent.minimum_balance(required_len);
                let current_lamports = ctx.accounts.buy_position.lamports();
                if current_lamports < new_minimum {
                    let diff = new_minimum - current_lamports;
                    invoke(
                        &system_instruction::transfer(
                            ctx.accounts.keeper.key,
                            ctx.accounts.buy_position.key,
                            diff,
                        ),
                        &[
                            ctx.accounts.keeper.to_account_info(),
                            ctx.accounts.buy_position.to_account_info(),
                            ctx.accounts.system_program.to_account_info(),
                        ],
                    )?;
                }
                ctx.accounts.buy_position.realloc(required_len, false)?;
            }
            let mut position_account_data = ctx.accounts.buy_position.try_borrow_mut_data()?;
            position_account_data[8..8 + serialized.len()].copy_from_slice(&serialized);
        }

        ctx.accounts.match_state.buy_executed = true;

        buy_order.filled_quantity += fill_quantity;
        if buy_order.filled_quantity >= buy_order.quantity {
            buy_order.status = OrderStatus::Filled as u8;
        } else if buy_order.filled_quantity > 0 {
            buy_order.status = OrderStatus::PartiallyFilled as u8;
        }

        Ok(())
    }

    pub fn execute_seller_match(ctx: Context<ExecuteSellerMatch>) -> Result<()> {
        let match_state = &mut ctx.accounts.match_state;
        require!(!match_state.executed, SpaceError::InvalidOrder);
        require!(match_state.buy_executed, SpaceError::InvalidOrder);
        require!(!match_state.sell_executed, SpaceError::InvalidOrder);

        // CRITICAL: Set sell_executed immediately to prevent duplicate execution
        // This must be done atomically before any other operations
        // If two transactions try to execute simultaneously, only one will pass the check above
        match_state.sell_executed = true;

        let sell_order = &mut ctx.accounts.sell_order;
        let market = &mut ctx.accounts.market;
        let market_key = market.key();
        let program_id = ctx.program_id;
        let fill_quantity = match_state.fill_quantity;
        let trade_value = match_state.trade_value;
        let match_price = match_state.match_price;
        let outcome_id = match_state.outcome_id;
        let buy_is_maker = match_state.buy_is_maker;
        let sell_is_maker = match_state.sell_is_maker;

        let sell_order_id_bytes = match_state.sell_order_id.to_le_bytes();

        let (expected_sell_share_escrow_yes, _) = Pubkey::find_program_address(
            &[
                b"share_escrow",
                match_state.sell_order_user.as_ref(),
                &sell_order_id_bytes,
            ],
            program_id,
        );
        require!(
            expected_sell_share_escrow_yes == ctx.accounts.sell_share_escrow_yes.key(),
            SpaceError::InvalidPDA
        );

        let (expected_sell_share_escrow_no, _) = Pubkey::find_program_address(
            &[
                b"share_escrow_no",
                match_state.sell_order_user.as_ref(),
                &sell_order_id_bytes,
            ],
            program_id,
        );
        require!(
            expected_sell_share_escrow_no == ctx.accounts.sell_share_escrow_no.key(),
            SpaceError::InvalidPDA
        );

        let (expected_market_vault, _) =
            Pubkey::find_program_address(&[b"vault", market_key.as_ref()], program_id);
        require!(
            expected_market_vault == ctx.accounts.market_vault.key(),
            SpaceError::InvalidPDA
        );

        // Verify authority PDAs manually
        let (expected_sell_share_escrow_authority, _) = Pubkey::find_program_address(
            &[
                b"share_escrow_authority",
                match_state.sell_order_user.as_ref(),
                &sell_order_id_bytes,
            ],
            program_id,
        );
        require!(
            expected_sell_share_escrow_authority == ctx.accounts.sell_share_escrow_authority.key(),
            SpaceError::InvalidPDA
        );

        let (expected_vault_authority, _) =
            Pubkey::find_program_address(&[b"vault_authority", market_key.as_ref()], program_id);
        require!(
            expected_vault_authority == ctx.accounts.vault_authority.key(),
            SpaceError::InvalidPDA
        );

        require!(
            ctx.accounts.sell_user_usdc_account.owner == match_state.sell_order_user,
            SpaceError::TokenAccountOwnershipMismatch
        );

        let vault_amount = {
            let vault_data = ctx.accounts.market_vault.try_borrow_data()?;
            u64::from_le_bytes(
                vault_data[64..72]
                    .try_into()
                    .map_err(|_| SpaceError::InvalidOutcome)?,
            )
        };

        let seller_fee = if sell_is_maker {
            MAKER_FEE_BPS
        } else {
            calculate_dynamic_fee(match_price, 1)
        };
        let seller_fee_amount = trade_value
            .checked_mul(seller_fee)
            .and_then(|x| x.checked_div(BASIS_POINTS))
            .ok_or(SpaceError::InvalidAmount)?;
        let seller_payment = trade_value.saturating_sub(seller_fee_amount);

        require!(
            vault_amount >= seller_payment,
            SpaceError::InsufficientVaultBalance
        );

        let (_, vault_authority_bump) =
            Pubkey::find_program_address(&[b"vault_authority", market_key.as_ref()], program_id);
        let vault_seeds = &[
            b"vault_authority",
            market_key.as_ref(),
            &[vault_authority_bump],
        ];
        let vault_signer = &[&vault_seeds[..]];

        // Check if this is a leveraged close order
        if sell_order.is_leveraged_close {
            // For leveraged close orders:
            // 1. Calculate proportional debt to repay based on fill ratio
            // 2. Transfer debt portion from market_vault to liquidity_vault
            // 3. Transfer remaining proceeds to seller (user equity)

            // Calculate fill ratio for partial fills
            let fill_ratio = if sell_order.quantity > 0 {
                (fill_quantity as u128 * BASIS_POINTS as u128 / sell_order.quantity as u128) as u64
            } else {
                0
            };

            // Calculate proportional debt repayment for this fill
            let debt_to_repay = (sell_order.borrowed_amount_to_repay as u128 * fill_ratio as u128
                / BASIS_POINTS as u128) as u64;

            // Validate liquidity vault
            let (expected_liquidity_vault, _) = Pubkey::find_program_address(
                &[b"liquidity_vault", market_key.as_ref()],
                program_id,
            );
            require!(
                expected_liquidity_vault == ctx.accounts.liquidity_vault.key(),
                SpaceError::InvalidPDA
            );

            // Calculate amounts: proceeds go first to debt repayment
            let debt_payment = debt_to_repay.min(seller_payment);
            let user_payment = seller_payment.saturating_sub(debt_payment);

            // Step 1: Repay debt to liquidity vault (if any debt to repay)
            if debt_payment > 0 {
                let debt_repay_cpi = Transfer {
                    from: ctx.accounts.market_vault.to_account_info(),
                    to: ctx.accounts.liquidity_vault.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                };
                token::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        debt_repay_cpi,
                        vault_signer,
                    ),
                    debt_payment,
                )?;

                msg!(
                    "Leveraged close: repaid {} debt to liquidity vault",
                    debt_payment
                );
            }

            // Step 2: Pay remaining proceeds to user (their equity)
            if user_payment > 0 {
                let user_payout_cpi = Transfer {
                    from: ctx.accounts.market_vault.to_account_info(),
                    to: ctx.accounts.sell_user_usdc_account.to_account_info(),
                    authority: ctx.accounts.vault_authority.to_account_info(),
                };
                token::transfer(
                    CpiContext::new_with_signer(
                        ctx.accounts.token_program.to_account_info(),
                        user_payout_cpi,
                        vault_signer,
                    ),
                    user_payment,
                )?;

                msg!("Leveraged close: paid {} to user as equity", user_payment);
            }

            // Track debt repaid for this fill
            sell_order.borrowed_amount_to_repay = sell_order
                .borrowed_amount_to_repay
                .saturating_sub(debt_payment);

            // Update global OI tracking (quote base units)
            let scale = quote_scale(market.quote_decimals);
            let notional_closed = fill_quantity
                .checked_mul(match_price)
                .and_then(|x| x.checked_div(BASIS_POINTS))
                .and_then(|x| x.checked_mul(scale))
                .ok_or(SpaceError::InvalidAmount)?;
            market.total_leverage_provided = market
                .total_leverage_provided
                .saturating_sub(notional_closed);
        } else {
            // Normal sell order - transfer all proceeds to seller
            let transfer_usdc_cpi = Transfer {
                from: ctx.accounts.market_vault.to_account_info(),
                to: ctx.accounts.sell_user_usdc_account.to_account_info(),
                authority: ctx.accounts.vault_authority.to_account_info(),
            };
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    transfer_usdc_cpi,
                    vault_signer,
                ),
                seller_payment,
            )?;
        }

        sell_order.fee_paid += seller_fee_amount;

        if buy_is_maker {
            let buyer_fee = calculate_dynamic_fee(match_price, 0);
            let buyer_fee_amount = trade_value
                .checked_mul(buyer_fee)
                .and_then(|x| x.checked_div(BASIS_POINTS))
                .ok_or(SpaceError::InvalidAmount)?;
            market.total_maker_rewards = market
                .total_maker_rewards
                .checked_add(buyer_fee_amount)
                .ok_or(SpaceError::InvalidAmount)?;
        }
        if sell_is_maker {
            market.total_maker_rewards += seller_fee_amount;
        }

        sell_order.filled_quantity += fill_quantity;
        if sell_order.filled_quantity >= sell_order.quantity {
            sell_order.status = OrderStatus::Filled as u8;
        } else if sell_order.filled_quantity > 0 {
            sell_order.status = OrderStatus::PartiallyFilled as u8;
        }

        require!(
            (outcome_id as usize) < market.outcomes.len(),
            SpaceError::InvalidOutcome
        );
        require!(outcome_id < market.num_outcomes, SpaceError::InvalidOutcome);

        add_price_snapshot(market, outcome_id, match_price);
        market.total_volume += trade_value;

        // sell_executed was already set at the beginning to prevent race conditions
        // Now mark the entire match as executed
        ctx.accounts.match_state.executed = true;

        Ok(())
    }

    pub fn cancel_order(ctx: Context<CancelOrder>, order_id: u64) -> Result<()> {
        // Check protocol is not paused
        require!(!ctx.accounts.config.paused, SpaceError::ProtocolPaused);

        let order = &mut ctx.accounts.pending_order;
        require!(
            order.status == OrderStatus::Open as u8
                || order.status == OrderStatus::PartiallyFilled as u8,
            SpaceError::InvalidOrder
        );
        require!(
            order.user == ctx.accounts.user.key(),
            SpaceError::Unauthorized
        );

        let escrow_balance = ctx.accounts.order_escrow.amount;

        let return_margin = escrow_balance.min(order.margin);

        if return_margin > 0 {
            let escrow_seeds = &[
                b"order_escrow_authority",
                order.user.as_ref(),
                &order_id.to_le_bytes(),
                &[ctx.bumps.order_escrow_authority],
            ];
            let signer = &[&escrow_seeds[..]];

            let transfer_cpi = Transfer {
                from: ctx.accounts.order_escrow.to_account_info(),
                to: ctx.accounts.user_usdc.to_account_info(),
                authority: ctx.accounts.order_escrow_authority.to_account_info(),
            };
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    transfer_cpi,
                    signer,
                ),
                return_margin,
            )?;
        }

        order.status = OrderStatus::Cancelled as u8;
        Ok(())
    }

    pub fn cancel_sell_order(ctx: Context<CancelSellOrder>, order_id: u64) -> Result<()> {
        // Check protocol is not paused
        require!(!ctx.accounts.config.paused, SpaceError::ProtocolPaused);

        let order = &mut ctx.accounts.pending_order;
        require!(
            order.status == OrderStatus::Open as u8
                || order.status == OrderStatus::PartiallyFilled as u8,
            SpaceError::InvalidOrder
        );
        require!(
            order.user == ctx.accounts.user.key(),
            SpaceError::Unauthorized
        );
        require!(
            order.side == 1, // Must be sell order
            SpaceError::InvalidOrder
        );

        // Handle case where escrow account doesn't exist (old orders placed before escrow initialization fix)
        let escrow_amount = if ctx.accounts.share_escrow_yes.lamports() == 0 {
            // Escrow account was never initialized - no shares to return
            // This can happen with old orders placed before the rent sysvar was added
            0
        } else {
            let escrow_data = ctx.accounts.share_escrow_yes.try_borrow_data()?;
            require!(
                escrow_data.len() >= 72,
                SpaceError::AccountNotInitialized
            );
            
            let escrow_mint =
                Pubkey::try_from(&escrow_data[0..32]).map_err(|_| SpaceError::InvalidOutcome)?;
            let amount = u64::from_le_bytes(
                escrow_data[64..72]
                    .try_into()
                    .map_err(|_| SpaceError::InvalidOutcome)?,
            );

            let user_yes_mint = {
                let user_yes_data = ctx.accounts.user_yes_account.try_borrow_data()?;
                Pubkey::try_from(&user_yes_data[0..32]).map_err(|_| SpaceError::InvalidOutcome)?
            };

            require!(
                escrow_mint == user_yes_mint,
                SpaceError::TokenAccountMintMismatch
            );

            amount
        };

        if escrow_amount > 0 {
            let (expected_share_escrow_authority, share_escrow_authority_bump) =
                Pubkey::find_program_address(
                    &[
                        b"share_escrow_authority",
                        order.user.as_ref(),
                        &order_id.to_le_bytes(),
                    ],
                    ctx.program_id,
                );
            require!(
                expected_share_escrow_authority == ctx.accounts.share_escrow_authority.key(),
                SpaceError::InvalidPDA
            );

            let escrow_seeds = &[
                b"share_escrow_authority",
                order.user.as_ref(),
                &order_id.to_le_bytes(),
                &[share_escrow_authority_bump],
            ];
            let signer = &[&escrow_seeds[..]];

            let transfer_cpi = Transfer {
                from: ctx.accounts.share_escrow_yes.to_account_info(),
                to: ctx.accounts.user_yes_account.to_account_info(),
                authority: ctx.accounts.share_escrow_authority.to_account_info(),
            };
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    transfer_cpi,
                    signer,
                ),
                escrow_amount,
            )?;
        }

        // If this is a leveraged close order, restore the position
        // When close_leveraged_position was called, it:
        // 1. Transferred shares to escrow
        // 2. Reduced position.shares, position.collateral, and position.borrowed_amount
        // Now that we're cancelling, we need to restore these values
        if order.is_leveraged_close && order.position_key != Pubkey::default() {
            require!(
                ctx.accounts.position.key() == order.position_key,
                SpaceError::InvalidPDA
            );
            require!(
                ctx.accounts.position.lamports() > 0,
                SpaceError::AccountNotInitialized
            );

            // Read position with compat deserialization
            let position = {
                let position_data = ctx.accounts.position.try_borrow_data()?;
                require!(
                    position_data.len() >= Position::min_data_len(),
                    SpaceError::AccountNotInitialized
                );
                Position::deserialize_compat(&position_data[8..])?
            };

            let mut position = position;

            // Restore shares (return the unfilled quantity from escrow)
            let unfilled_shares = order.quantity.saturating_sub(order.filled_quantity);
            position.shares = position.shares.saturating_add(unfilled_shares);

            // Restore collateral proportionally
            if order.quantity > 0 {
                let restore_ratio = (unfilled_shares as u128 * BASIS_POINTS as u128
                    / order.quantity as u128) as u64;
                let collateral_to_restore = (order.collateral_to_return as u128
                    * restore_ratio as u128
                    / BASIS_POINTS as u128) as u64;
                position.collateral = position.collateral.saturating_add(collateral_to_restore);
            }

            // Restore borrowed amount proportionally
            if order.quantity > 0 {
                let restore_ratio = (unfilled_shares as u128 * BASIS_POINTS as u128
                    / order.quantity as u128) as u64;
                let borrowed_to_restore = (order.borrowed_amount_to_repay as u128
                    * restore_ratio as u128
                    / BASIS_POINTS as u128) as u64;
                position.borrowed_amount =
                    position.borrowed_amount.saturating_add(borrowed_to_restore);
            }

            // Serialize and write back — handle old-format accounts (117 bytes vs 118)
            let serialized = position.try_to_vec()?;
            let required_len = 8 + serialized.len();
            if ctx.accounts.position.data_len() >= required_len {
                let mut position_data = ctx.accounts.position.try_borrow_mut_data()?;
                position_data[8..8 + serialized.len()].copy_from_slice(&serialized);
            } else {
                // Old-format account — write only what fits (skip token_type at the end)
                let write_len = ctx.accounts.position.data_len() - 8;
                let mut position_data = ctx.accounts.position.try_borrow_mut_data()?;
                position_data[8..8 + write_len].copy_from_slice(&serialized[..write_len]);
            }

            msg!(
                "Restored leveraged position: +{} shares, +{} collateral, +{} borrowed",
                unfilled_shares,
                order.collateral_to_return,
                order.borrowed_amount_to_repay
            );
        }

        order.status = OrderStatus::Cancelled as u8;
        Ok(())
    }

    pub fn cancel_no_sell_order(ctx: Context<CancelNoSellOrder>, order_id: u64) -> Result<()> {
        // Check protocol is not paused
        require!(!ctx.accounts.config.paused, SpaceError::ProtocolPaused);

        let order = &mut ctx.accounts.pending_order;
        require!(
            order.status == OrderStatus::Open as u8
                || order.status == OrderStatus::PartiallyFilled as u8,
            SpaceError::InvalidOrder
        );
        require!(
            order.user == ctx.accounts.user.key(),
            SpaceError::Unauthorized
        );
        require!(
            order.side == 1, // Must be sell order
            SpaceError::InvalidOrder
        );

        // Handle case where escrow account doesn't exist (old orders placed before escrow initialization fix)
        let escrow_amount = if ctx.accounts.share_escrow_no.lamports() == 0 {
            // Escrow account was never initialized - no shares to return
            // This can happen with old orders placed before the rent sysvar was added
            0
        } else {
            let escrow_data = ctx.accounts.share_escrow_no.try_borrow_data()?;
            require!(
                escrow_data.len() >= 72,
                SpaceError::AccountNotInitialized
            );
            
            let escrow_mint =
                Pubkey::try_from(&escrow_data[0..32]).map_err(|_| SpaceError::InvalidOutcome)?;
            let amount = u64::from_le_bytes(
                escrow_data[64..72]
                    .try_into()
                    .map_err(|_| SpaceError::InvalidOutcome)?,
            );

            let user_no_mint = {
                let user_no_data = ctx.accounts.user_no_account.try_borrow_data()?;
                Pubkey::try_from(&user_no_data[0..32]).map_err(|_| SpaceError::InvalidOutcome)?
            };

            require!(
                escrow_mint == user_no_mint,
                SpaceError::TokenAccountMintMismatch
            );

            amount
        };

        if escrow_amount > 0 {
            let (expected_share_escrow_authority, share_escrow_authority_bump) =
                Pubkey::find_program_address(
                    &[
                        b"share_escrow_authority",
                        order.user.as_ref(),
                        &order_id.to_le_bytes(),
                    ],
                    ctx.program_id,
                );
            require!(
                expected_share_escrow_authority == ctx.accounts.share_escrow_authority.key(),
                SpaceError::InvalidPDA
            );

            let escrow_seeds = &[
                b"share_escrow_authority",
                order.user.as_ref(),
                &order_id.to_le_bytes(),
                &[share_escrow_authority_bump],
            ];
            let signer = &[&escrow_seeds[..]];

            let transfer_cpi = Transfer {
                from: ctx.accounts.share_escrow_no.to_account_info(),
                to: ctx.accounts.user_no_account.to_account_info(),
                authority: ctx.accounts.share_escrow_authority.to_account_info(),
            };
            token::transfer(
                CpiContext::new_with_signer(
                    ctx.accounts.token_program.to_account_info(),
                    transfer_cpi,
                    signer,
                ),
                escrow_amount,
            )?;
        }

        // If this is a leveraged close order, restore the position
        // When close_leveraged_position was called, it:
        // 1. Transferred shares to escrow
        // 2. Reduced position.shares, position.collateral, and position.borrowed_amount
        // Now that we're cancelling, we need to restore these values
        if order.is_leveraged_close && order.position_key != Pubkey::default() {
            require!(
                ctx.accounts.position.key() == order.position_key,
                SpaceError::InvalidPDA
            );
            require!(
                ctx.accounts.position.lamports() > 0,
                SpaceError::AccountNotInitialized
            );

            // Read position with compat deserialization
            let position = {
                let position_data = ctx.accounts.position.try_borrow_data()?;
                require!(
                    position_data.len() >= Position::min_data_len(),
                    SpaceError::AccountNotInitialized
                );
                Position::deserialize_compat(&position_data[8..])?
            };

            let mut position = position;

            // Restore shares (return the unfilled quantity from escrow)
            let unfilled_shares = order.quantity.saturating_sub(order.filled_quantity);
            position.shares = position.shares.saturating_add(unfilled_shares);

            // Restore collateral proportionally
            if order.quantity > 0 {
                let restore_ratio = (unfilled_shares as u128 * BASIS_POINTS as u128
                    / order.quantity as u128) as u64;
                let restore_collateral = (order.collateral_to_return as u128
                    * restore_ratio as u128
                    / BASIS_POINTS as u128) as u64;
                position.collateral = position.collateral.saturating_add(restore_collateral);
            }

            // Restore borrowed amount proportionally
            if order.quantity > 0 {
                let restore_ratio = (unfilled_shares as u128 * BASIS_POINTS as u128
                    / order.quantity as u128) as u64;
                let restore_borrowed = (order.borrowed_amount_to_repay as u128
                    * restore_ratio as u128
                    / BASIS_POINTS as u128) as u64;
                position.borrowed_amount = position.borrowed_amount.saturating_add(restore_borrowed);
            }

            // Serialize and write back — handle old-format accounts (117 bytes vs 118)
            let serialized = position.try_to_vec()?;
            let required_len = 8 + serialized.len();
            if ctx.accounts.position.data_len() >= required_len {
                let mut position_data = ctx.accounts.position.try_borrow_mut_data()?;
                position_data[8..8 + serialized.len()].copy_from_slice(&serialized);
            } else {
                // Old-format account — write only what fits (skip token_type at the end)
                let write_len = ctx.accounts.position.data_len() - 8;
                let mut position_data = ctx.accounts.position.try_borrow_mut_data()?;
                position_data[8..8 + write_len].copy_from_slice(&serialized[..write_len]);
            }

            msg!(
                "Restored leveraged position: +{} shares, +{} collateral, +{} borrowed",
                unfilled_shares,
                order.collateral_to_return,
                order.borrowed_amount_to_repay
            );
        }

        order.status = OrderStatus::Cancelled as u8;

        Ok(())
    }

    /// Close a leveraged position by placing a market sell order.
    /// This properly sells shares on the market instead of burning them,
    /// maintaining proper invariants and ensuring debt is repaid from actual sale proceeds.
    ///
    /// Flow:
    /// 1. Create a sell order for the user's leveraged shares at market price
    /// 2. Escrow the shares (transfer to share_escrow)
    /// 3. Mark order as leveraged_close with debt info
    /// 4. When order is matched/filled, execute_seller_match will:
    ///    - Repay borrowed_amount to liquidity_vault from sale proceeds
    ///    - Return remaining proceeds (profit/loss) to user
    ///    - Update position accordingly
    pub fn close_leveraged_position(
        ctx: Context<CloseLeveragedPosition>,
        order_id: u64,
        shares_to_close: u64, // Amount of shares to close (can be partial)
        min_price: u64,       // Minimum acceptable price (slippage protection)
    ) -> Result<()> {
        // Check protocol is not paused
        require!(!ctx.accounts.config.paused, SpaceError::ProtocolPaused);

        // Get position key before mutable borrow
        let position_key = ctx.accounts.position.key();

        let position = &mut ctx.accounts.position;
        let market = &ctx.accounts.market;
        let user_key = ctx.accounts.user.key();
        let order_id_bytes = order_id.to_le_bytes();

        // Market must be active (for finalized markets, use close_position which handles resolution)
        require!(
            market.status == MarketStatus::Active as u8,
            SpaceError::MarketNotActive
        );

        // Must have a leveraged position with borrowed amount
        require!(position.borrowed_amount > 0, SpaceError::InvalidOrder);

        // Validate shares to close
        // Cap to position shares AND available token balance (spot sells may have reduced ATA balance)
        let actual_shares_to_close = shares_to_close
            .min(position.shares)
            .min(ctx.accounts.user_share_account.amount);
        require!(actual_shares_to_close > 0, SpaceError::InsufficientShares);

        // Slippage protection is enforced during order matching (match_price >= sell_order.price)
        // The min_price is stored on the pending order; no on-chain pre-check needed

        // Calculate proportional borrowed amount and collateral to settle
        let close_ratio = if actual_shares_to_close >= position.shares {
            BASIS_POINTS // Full close
        } else {
            (actual_shares_to_close as u128 * BASIS_POINTS as u128 / position.shares as u128) as u64
        };

        let borrowed_to_repay =
            (position.borrowed_amount as u128 * close_ratio as u128 / BASIS_POINTS as u128) as u64;
        let collateral_portion =
            (position.collateral as u128 * close_ratio as u128 / BASIS_POINTS as u128) as u64;

        // Initialize share escrow if needed
        // Determine if this is a NO position by checking share_mint against NO mint PDAs
        // ALL NO positions (binary and multi-outcome) must use share_escrow_no
        // so that execute_no_buyer_match can find tokens at the correct PDA
        let is_no_position = if market.no_mint != Pubkey::default() {
            // Old model: shared NO mint
            ctx.accounts.share_mint.key() == market.no_mint
        } else {
            // New model: per-outcome NO mint PDA
            let (expected_no_mint, _) = Pubkey::find_program_address(
                &[b"no_mint", market.key().as_ref(), &[position.outcome_id]],
                ctx.program_id,
            );
            ctx.accounts.share_mint.key() == expected_no_mint
        };
        let (share_escrow_pda, share_escrow_bump) = if is_no_position {
            // NO position (binary or multi-outcome) - use share_escrow_no
            Pubkey::find_program_address(
                &[b"share_escrow_no", user_key.as_ref(), &order_id_bytes],
                ctx.program_id,
            )
        } else {
            // YES position - use share_escrow
            Pubkey::find_program_address(
                &[b"share_escrow", user_key.as_ref(), &order_id_bytes],
                ctx.program_id,
            )
        };

        require!(
            share_escrow_pda == ctx.accounts.share_escrow.key(),
            SpaceError::InvalidPDA
        );

        let needs_initialization = ctx.accounts.share_escrow.lamports() == 0;

        if needs_initialization {
            let share_escrow_authority_seeds = &[
                b"share_escrow_authority",
                user_key.as_ref(),
                &order_id_bytes,
            ];

            let rent = Rent::get()?;
            let space = 165; // TokenAccount size
            let lamports = rent.minimum_balance(space);

            let (share_escrow_authority_pda, _) =
                Pubkey::find_program_address(share_escrow_authority_seeds, ctx.program_id);

            // Create share escrow account with correct signer seeds based on position type
            let escrow_seed: &[u8] = if is_no_position { b"share_escrow_no" } else { b"share_escrow" };
            invoke_signed(
                &system_instruction::create_account(
                    ctx.accounts.user.key,
                    &share_escrow_pda,
                    lamports,
                    space as u64,
                    &spl_token::id(),
                ),
                &[
                    ctx.accounts.user.to_account_info(),
                    ctx.accounts.share_escrow.to_account_info(),
                    ctx.accounts.system_program.to_account_info(),
                ],
                &[&[
                    escrow_seed,
                    user_key.as_ref(),
                    &order_id_bytes,
                    &[share_escrow_bump],
                ]],
            )?;

            // Initialize token account
            // Note: initialize_account requires: account, mint, authority, rent
            // The authority account must be included in the accounts list
            let init_account_ix = token_instruction::initialize_account(
                &ctx.accounts.token_program.key(),
                &share_escrow_pda,
                &ctx.accounts.share_mint.key(),
                &share_escrow_authority_pda,
            )?;
            anchor_lang::solana_program::program::invoke(
                &init_account_ix,
                &[
                    ctx.accounts.token_program.to_account_info(),
                    ctx.accounts.share_escrow.to_account_info(),
                    ctx.accounts.share_mint.to_account_info(),
                    ctx.accounts.share_escrow_authority.to_account_info(),
                    ctx.accounts.rent.to_account_info(),
                ],
            )?;
        }

        // Transfer shares to escrow
        let transfer_shares_cpi = Transfer {
            from: ctx.accounts.user_share_account.to_account_info(),
            to: ctx.accounts.share_escrow.to_account_info(),
            authority: ctx.accounts.user.to_account_info(),
        };
        token::transfer(
            CpiContext::new(
                ctx.accounts.token_program.to_account_info(),
                transfer_shares_cpi,
            ),
            actual_shares_to_close,
        )?;

        // Create the sell order
        let order = &mut ctx.accounts.pending_order;
        let clock = Clock::get()?;

        order.user = user_key;
        order.market = market.key();
        order.outcome_id = position.outcome_id;
        order.side = 1; // Sell side
                        // For market sell orders, price should be the minimum acceptable price (min_price)
                        // This allows matching at any price >= min_price
        order.price = min_price;
        order.quantity = actual_shares_to_close;
        order.filled_quantity = 0;
        order.margin = 0;
        order.margin_used = 0;
        order.leverage = position.leverage;
        order.status = OrderStatus::Open as u8;
        order.created_at = clock.unix_timestamp;
        order.order_id = order_id;
        order.order_type = OrderType::Market as u8; // Market order for immediate execution
        order.is_maker = false; // Taker since it's a market order
        order.fee_paid = 0;
        // IMPORTANT: Mark this as a leveraged close order
        order.is_leveraged_close = true;
        order.borrowed_amount_to_repay = borrowed_to_repay;
        order.collateral_to_return = collateral_portion;
        order.position_key = position_key;

        // Update position to reflect pending close
        // Note: Position will be fully updated when the sell order is executed
        // For now, we mark the shares as "pending close" by reducing shares
        position.shares = position.shares.saturating_sub(actual_shares_to_close);
        position.collateral = position.collateral.saturating_sub(collateral_portion);
        position.borrowed_amount = position.borrowed_amount.saturating_sub(borrowed_to_repay);

        msg!(
            "Leveraged position close initiated: {} shares at min_price {}, debt to repay: {}",
            actual_shares_to_close,
            min_price,
            borrowed_to_repay
        );

        Ok(())
    }

    /// Close a position (for finalized markets or non-leveraged positions only).
    /// For active markets with leverage, use close_leveraged_position instead.
    pub fn close_position(ctx: Context<ClosePosition>) -> Result<()> {
        // Check protocol is not paused
        require!(!ctx.accounts.config.paused, SpaceError::ProtocolPaused);

        let position = &mut ctx.accounts.position;
        let market = &mut ctx.accounts.market;

        // For active markets with leverage, redirect to close_leveraged_position
        // Burning tokens directly for leveraged positions on active markets creates invariant issues
        if market.status == MarketStatus::Active as u8 && position.borrowed_amount > 0 {
            return Err(SpaceError::ActiveLeveragedPositionExists.into());
        }

        // Allow closing positions on both Active and Finalized markets
        // But for active markets, only non-leveraged positions (no borrowed_amount)
        require!(
            market.status == MarketStatus::Active as u8
                || market.status == MarketStatus::Finalized as u8,
            SpaceError::MarketNotActive
        );
        require!(position.shares > 0, SpaceError::InvalidAmount);
        require!(
            position.user == ctx.accounts.user.key(),
            SpaceError::Unauthorized
        );

        // In the per-outcome-NO model (market.no_mint == default), ALL positions are
        // stored with side=0 (long their token), and token_type distinguishes YES (0)
        // vs NO (1) of outcome_id. NO holders win when outcome_id did NOT win, and
        // their token's market price is (BASIS_POINTS - YES_price).
        let is_no_token_new_model =
            position.token_type == 1 && market.no_mint == Pubkey::default();

        // For finalized markets, use resolved outcome to determine final price
        // For active markets, use current market price (inverted for NO holders)
        let current_price = if market.status == MarketStatus::Finalized as u8 {
            // Market is finalized - use resolved outcome
            if let Some(winning_outcome) = market.resolved_outcome {
                let outcome_won = position.outcome_id == winning_outcome;
                let user_won = if is_no_token_new_model { !outcome_won } else { outcome_won };
                if user_won {
                    // Position won - shares worth $1 each (10000 basis points)
                    BASIS_POINTS
                } else {
                    // Position lost - shares worth $0
                    0
                }
            } else {
                // Market finalized but not resolved (shouldn't happen, but fallback)
                let yes_price = market.outcomes[position.outcome_id as usize].last_price;
                if is_no_token_new_model {
                    BASIS_POINTS.saturating_sub(yes_price)
                } else {
                    yes_price
                }
            }
        } else {
            // Active market - use current price (inverted for NO holders)
            let yes_price = market.outcomes[position.outcome_id as usize].last_price;
            if is_no_token_new_model {
                BASIS_POINTS.saturating_sub(yes_price)
            } else {
                yes_price
            }
        };

        // Calculate PnL with overflow protection. position_value/entry_value
        // are in quote base units (shares × bps / 10000 × quote_scale).
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

        let market_key = market.key();
        let program_id = ctx.program_id;

        // Validate mints and token accounts based on position's outcome_id
        // Validate NO mint: per-outcome PDA for new markets, shared mint for old markets
        if market.no_mint == Pubkey::default() {
            let (expected_no_mint, _) = Pubkey::find_program_address(
                &[b"no_mint", market_key.as_ref(), &[position.outcome_id]],
                program_id,
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

        let available_shares: u64;
        let shares_to_burn: u64;

        // Determine if this position trades NO shares
        // Old model (market.no_mint set): only binary outcome_id=1 is NO
        // New model (market.no_mint == default): NO positions identified by token_type=1.
        // Note: in the new model, ALL positions are stored with side=0 (everyone is "long"
        // their respective YES or NO token); the YES/NO distinction lives in token_type.
        let is_binary_no_position = if market.no_mint == Pubkey::default() {
            // New model: NO positions identified by token_type=1
            position.token_type == 1
        } else {
            // Old model: only binary market outcome_id=1
            market.num_outcomes == 2 && position.outcome_id == 1
        };

        if !is_binary_no_position {
            // YES position (any outcome in multi-outcome, or outcome 0 in binary)
            let expected_yes_mint = Pubkey::find_program_address(
                &[b"yes_mint", market_key.as_ref(), &[position.outcome_id]],
                program_id,
            )
            .0;
            require!(
                ctx.accounts.yes_mint.key() == expected_yes_mint,
                SpaceError::TokenAccountMintMismatch
            );

            // Deserialize and validate user_yes_account in a scope to drop borrow before CPI
            {
                let user_yes_data = ctx.accounts.user_yes_account.try_borrow_data()?;
                require!(user_yes_data.len() >= 165, SpaceError::InvalidAmount);
                let user_yes_account = TokenAccount::try_deserialize(&mut &user_yes_data[..])?;

                require!(
                    user_yes_account.owner == ctx.accounts.user.key(),
                    SpaceError::TokenAccountOwnershipMismatch
                );
                require!(
                    user_yes_account.mint == ctx.accounts.yes_mint.key(),
                    SpaceError::TokenAccountMintMismatch
                );

                available_shares = user_yes_account.amount;
                require!(available_shares > 0, SpaceError::InsufficientShares);
                shares_to_burn = available_shares.min(position.shares);
            }

            // Burn YES tokens
            let burn_yes = Burn {
                mint: ctx.accounts.yes_mint.to_account_info(),
                from: ctx.accounts.user_yes_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            };
            token::burn(
                CpiContext::new(ctx.accounts.token_program.to_account_info(), burn_yes),
                shares_to_burn,
            )?;
        } else {
            // Binary NO position - validate user_no_account
            {
                let user_no_data = ctx.accounts.user_no_account.try_borrow_data()?;
                require!(user_no_data.len() >= 165, SpaceError::InvalidAmount);
                let user_no_account = TokenAccount::try_deserialize(&mut &user_no_data[..])?;

                require!(
                    user_no_account.owner == ctx.accounts.user.key(),
                    SpaceError::TokenAccountOwnershipMismatch
                );
                require!(
                    user_no_account.mint == ctx.accounts.no_mint.key(),
                    SpaceError::TokenAccountMintMismatch
                );

                available_shares = user_no_account.amount;
                require!(available_shares > 0, SpaceError::InsufficientShares);
                shares_to_burn = available_shares.min(position.shares);
            }

            // Burn NO tokens
            let burn_no = Burn {
                mint: ctx.accounts.no_mint.to_account_info(),
                from: ctx.accounts.user_no_account.to_account_info(),
                authority: ctx.accounts.user.to_account_info(),
            };
            token::burn(
                CpiContext::new(ctx.accounts.token_program.to_account_info(), burn_no),
                shares_to_burn,
            )?;
        }

        let shares_to_close = shares_to_burn;

        // Store original values before adjustment
        let original_borrowed_amount = position.borrowed_amount;
        let original_shares = position.shares;
        let borrowed_amount_to_repay: u128;
        let equity: u64;

        // Update position and payout calculations based on actual shares closed
        if shares_to_close < position.shares {
            // Partial close - adjust position proportionally
            let close_ratio =
                (shares_to_close as u128 * BASIS_POINTS as u128) / (position.shares as u128);
            let position_value_closed =
                (position_value as u128 * close_ratio) / (BASIS_POINTS as u128);
            let entry_value_closed = (entry_value as u128 * close_ratio) / (BASIS_POINTS as u128);

            let pnl_adjusted = if position.side == 0 {
                (position_value_closed as i64) - (entry_value_closed as i64)
            } else {
                (entry_value_closed as i64) - (position_value_closed as i64)
            };

            let collateral_closed =
                (position.collateral as u128 * close_ratio) / (BASIS_POINTS as u128);
            borrowed_amount_to_repay =
                (position.borrowed_amount as u128 * close_ratio) / (BASIS_POINTS as u128);

            equity = (collateral_closed as i64 + pnl_adjusted).max(0) as u64;
            position.shares -= shares_to_close;
            position.collateral -= collateral_closed as u64;
            position.borrowed_amount -= borrowed_amount_to_repay as u64;
        } else {
            // Full close - use original calculations
            equity = (position.collateral as i64 + pnl).max(0) as u64;
            borrowed_amount_to_repay = original_borrowed_amount as u128;
        }

        if position.leverage > 1 {
            let vault_seeds = &[
                b"vault_authority",
                market_key.as_ref(),
                &[ctx.bumps.vault_authority],
            ];
            let vault_signer = &[&vault_seeds[..]];

            let margin_vault_seeds = &[
                b"margin_vault_authority",
                market_key.as_ref(),
                &[ctx.bumps.margin_vault_authority],
            ];
            let margin_vault_signer = &[&margin_vault_seeds[..]];

            // Calculate proportional values for partial close
            let (close_position_value, close_entry_value, close_collateral, close_borrowed) =
                if shares_to_close < original_shares {
                    let close_ratio = (shares_to_close as u128 * BASIS_POINTS as u128)
                        / (original_shares as u128);
                    (
                        ((position_value as u128 * close_ratio) / (BASIS_POINTS as u128)) as u64,
                        ((entry_value as u128 * close_ratio) / (BASIS_POINTS as u128)) as u64,
                        ((position.collateral as u128 * close_ratio) / (BASIS_POINTS as u128))
                            as u64,
                        ((borrowed_amount_to_repay * close_ratio) / (BASIS_POINTS as u128)) as u64,
                    )
                } else {
                    (
                        position_value,
                        entry_value,
                        position.collateral,
                        borrowed_amount_to_repay as u64,
                    )
                };

            // Step 1: Repay debt to liquidity_vault from market_vault
            // Position proceeds go toward repaying the borrowed amount
            let debt_repay_from_position = close_position_value.min(close_borrowed);
            if debt_repay_from_position > 0 {
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
                    debt_repay_from_position,
                )?;
            }

            // Step 2: If position didn't cover full debt, margin_vault covers shortfall
            let debt_shortfall = close_borrowed.saturating_sub(close_position_value);
            if debt_shortfall > 0 {
                let margin_vault_balance = ctx.accounts.margin_vault.amount;
                let shortfall_payment = debt_shortfall.min(margin_vault_balance);
                if shortfall_payment > 0 {
                    let shortfall_cpi = Transfer {
                        from: ctx.accounts.margin_vault.to_account_info(),
                        to: ctx.accounts.liquidity_vault.to_account_info(),
                        authority: ctx.accounts.margin_vault_authority.to_account_info(),
                    };
                    token::transfer(
                        CpiContext::new_with_signer(
                            ctx.accounts.token_program.to_account_info(),
                            shortfall_cpi,
                            margin_vault_signer,
                        ),
                        shortfall_payment,
                    )?;
                }
            }

            // Step 3: Calculate user's equity and pay from margin_vault
            // User equity = collateral + PnL (but can't go below 0)
            // PnL = position_value - entry_value
            let close_pnl = close_position_value as i64 - close_entry_value as i64;
            let user_equity = (close_collateral as i64 + close_pnl).max(0) as u64;

            // Subtract any shortfall that was covered from margin
            let user_payout = user_equity.saturating_sub(debt_shortfall);

            if user_payout > 0 {
                let margin_vault_balance = ctx.accounts.margin_vault.amount;
                let actual_payout = user_payout.min(margin_vault_balance);

                if actual_payout > 0 {
                    let payout_cpi = Transfer {
                        from: ctx.accounts.margin_vault.to_account_info(),
                        to: ctx.accounts.user_usdc.to_account_info(),
                        authority: ctx.accounts.margin_vault_authority.to_account_info(),
                    };
                    token::transfer(
                        CpiContext::new_with_signer(
                            ctx.accounts.token_program.to_account_info(),
                            payout_cpi,
                            margin_vault_signer,
                        ),
                        actual_payout,
                    )?;
                }
            }
        } else {
            if equity > 0 {
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
                    equity,
                )?;
            }
        }

        // Only zero out position if fully closed
        if shares_to_close >= original_shares {
            position.shares = 0;
            position.collateral = 0;
            position.borrowed_amount = 0;
        }

        // Update global OI when leveraged position is closed (quote base units)
        if position.leverage > 1 {
            let scale = quote_scale(market.quote_decimals);
            let notional_closed = shares_to_close
                .checked_mul(position.avg_entry_price)
                .and_then(|x| x.checked_div(BASIS_POINTS))
                .and_then(|x| x.checked_mul(scale))
                .ok_or(SpaceError::InvalidAmount)?;
            market.total_leverage_provided = market
                .total_leverage_provided
                .saturating_sub(notional_closed);
        }

        Ok(())
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

    /// Convert NO shares to YES shares of a target outcome (1:1).
    /// Per Space docs: NO shares are fungible across outcomes.
    /// Burning NO is equivalent to gaining YES exposure on a different outcome.
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

    /// Add a new outcome to an existing market (per-outcome NO model only)
    /// Space for up to 10 outcomes is pre-allocated in the Market account
    /// remaining_accounts: [yes_mint, no_mint, creator, token_program, system_program]
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
}
