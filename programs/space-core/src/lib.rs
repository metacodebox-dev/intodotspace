// ============================================================================
// SPACE PREDICTION MARKET — space_core
// ============================================================================
//
// Entry point for the Anchor program. Each instruction in #[program] is a thin
// wrapper that delegates to a free function in `instructions::<area>`, where
// the corresponding `#[derive(Accounts)]` context lives alongside the body.
// State accounts and the SpaceError enum live in their own modules so the IDL
// surface (29 instructions, 7 accounts, SpaceError) is exactly what the
// deployed program at `DKRg9skUuewV1wdbVD6tpnoHtbWWy2Chq7EKdpPRY6Eh` exposes.

use anchor_lang::prelude::*;

pub mod constants;
pub mod errors;
pub mod helpers;
pub mod instructions;
pub mod state;

// Anchor's #[program] macro resolves `Context<T>` types, `#[account]`
// structs, and the `__client_accounts_*` helper modules that
// `#[derive(Accounts)]` emits next to each context — all of these must be
// reachable at the crate root. The glob re-exports below satisfy that.
//
// Side effect: glob re-exporting `instructions::*` brings the
// implementation functions (e.g. `initialize_config`) to crate root in the
// value namespace, which clashes with the wrapper functions Anchor emits
// from #[program] at the same scope. Rust prints "ambiguous glob
// re-exports" warnings for each — harmless (call sites use qualified
// paths) but noisy. Cleaning them up would require either renaming every
// implementation function or enumerating ~60 explicit re-exports
// (29 contexts + 29 `__client_accounts_*` modules + state types);
// neither is worth the churn for an audit handoff.
pub use constants::*;
pub use errors::*;
pub use instructions::*;
pub use state::*;

declare_id!("DKRg9skUuewV1wdbVD6tpnoHtbWWy2Chq7EKdpPRY6Eh");

#[program]
pub mod space_core {
    use super::*;

    // ---- Market lifecycle --------------------------------------------------

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
        instructions::market::initialize_market_core(
            ctx,
            market_id,
            title,
            description,
            category,
            end_date,
            outcome_labels,
            resolution_type,
        )
    }

    pub fn initialize_market_vaults(
        ctx: Context<InitializeMarketVaults>,
        initial_collateral: u64,
    ) -> Result<()> {
        instructions::market::initialize_market_vaults(ctx, initial_collateral)
    }

    pub fn migrate_market_v1_to_v2(ctx: Context<MigrateMarketV1ToV2>) -> Result<()> {
        instructions::market::migrate_market_v1_to_v2(ctx)
    }

    /// Add a new outcome to an existing market (per-outcome NO model only)
    /// Space for up to 10 outcomes is pre-allocated in the Market account
    /// remaining_accounts: [yes_mint, no_mint, creator, token_program, system_program]
    pub fn add_market_outcome(
        ctx: Context<AddMarketOutcome>,
        label: String,
    ) -> Result<()> {
        instructions::market::add_market_outcome(ctx, label)
    }

    // ---- Protocol singletons ----------------------------------------------

    pub fn initialize_config(
        ctx: Context<InitializeConfig>,
        max_global_oi: u128,
        protocol_fee_bps: u64,
        creator_fee_bps: u64,
        insurance_fee_bps: u64,
    ) -> Result<()> {
        instructions::config::initialize_config(
            ctx,
            max_global_oi,
            protocol_fee_bps,
            creator_fee_bps,
            insurance_fee_bps,
        )
    }

    pub fn initialize_insurance_fund(
        ctx: Context<InitializeInsuranceFund>,
        initial_balance: u64,
    ) -> Result<()> {
        instructions::config::initialize_insurance_fund(ctx, initial_balance)
    }

    pub fn initialize_oracle_registry(ctx: Context<InitializeOracleRegistry>) -> Result<()> {
        instructions::config::initialize_oracle_registry(ctx)
    }

    pub fn add_approved_oracle(ctx: Context<AddApprovedOracle>, oracle: Pubkey) -> Result<()> {
        instructions::config::add_approved_oracle(ctx, oracle)
    }

    // ---- Shares -----------------------------------------------------------

    pub fn mint_shares(ctx: Context<MintShares>, outcome_id: u8, amount: u64) -> Result<()> {
        instructions::shares::mint_shares(ctx, outcome_id, amount)
    }

    pub fn burn_shares(ctx: Context<BurnShares>, outcome_id: u8, amount: u64) -> Result<()> {
        instructions::shares::burn_shares(ctx, outcome_id, amount)
    }

    /// Convert NO shares to YES shares of a target outcome (1:1).
    /// Per Space docs: NO shares are fungible across outcomes.
    /// Burning NO is equivalent to gaining YES exposure on a different outcome.
    pub fn convert_shares(
        ctx: Context<ConvertShares>,
        to_outcome_id: u8,
        amount: u64,
    ) -> Result<()> {
        instructions::shares::convert_shares(ctx, to_outcome_id, amount)
    }

    // ---- Resolution -------------------------------------------------------

    pub fn resolve_oracle(
        ctx: Context<ResolveOracle>,
        winning_outcome_id: u8,
        evidence_hash: [u8; 32],
    ) -> Result<()> {
        instructions::resolution::resolve_oracle(ctx, winning_outcome_id, evidence_hash)
    }

    pub fn finalize_market(ctx: Context<FinalizeMarket>) -> Result<()> {
        instructions::resolution::finalize_market(ctx)
    }

    pub fn challenge_resolution(
        ctx: Context<ChallengeResolutionCtx>,
        bond_amount: u64,
    ) -> Result<()> {
        instructions::resolution::challenge_resolution(ctx, bond_amount)
    }

    pub fn mark_invalid(ctx: Context<MarkInvalidCtx>) -> Result<()> {
        instructions::resolution::mark_invalid(ctx)
    }

    /// Redeem winning shares after market finalization
    pub fn redeem_shares(ctx: Context<RedeemShares>, outcome_id: u8) -> Result<()> {
        instructions::resolution::redeem_shares(ctx, outcome_id)
    }

    // ---- Orders & matching ------------------------------------------------

    pub fn place_buy_order(
        ctx: Context<PlaceBuyOrder>,
        order_id: u64,
        outcome_id: u8,
        price: u64,
        quantity: u64,
        leverage: u8,
    ) -> Result<()> {
        instructions::orders::place_buy_order(ctx, order_id, outcome_id, price, quantity, leverage)
    }

    pub fn place_yes_limit_sell_order(
        ctx: Context<PlaceYesLimitSellOrder>,
        order_id: u64,
        outcome_id: u8,
        price: u64,
        quantity: u64,
        leverage: u8,
    ) -> Result<()> {
        instructions::orders::place_yes_limit_sell_order(
            ctx, order_id, outcome_id, price, quantity, leverage,
        )
    }

    pub fn place_no_limit_sell_order(
        ctx: Context<PlaceNoLimitSellOrder>,
        order_id: u64,
        outcome_id: u8,
        price: u64,
        quantity: u64,
        leverage: u8,
    ) -> Result<()> {
        instructions::orders::place_no_limit_sell_order(
            ctx, order_id, outcome_id, price, quantity, leverage,
        )
    }

    pub fn validate_match(
        ctx: Context<ValidateMatch>,
        buy_order_id: u64,
        sell_order_id: u64,
        match_price: u64,
        match_quantity: u64,
    ) -> Result<()> {
        instructions::matching::validate_match(
            ctx,
            buy_order_id,
            sell_order_id,
            match_price,
            match_quantity,
        )
    }

    pub fn execute_yes_buyer_match(ctx: Context<ExecuteYesBuyerMatch>) -> Result<()> {
        instructions::matching::execute_yes_buyer_match(ctx)
    }

    pub fn execute_no_buyer_match(ctx: Context<ExecuteNoBuyerMatch>) -> Result<()> {
        instructions::matching::execute_no_buyer_match(ctx)
    }

    pub fn execute_seller_match(ctx: Context<ExecuteSellerMatch>) -> Result<()> {
        instructions::matching::execute_seller_match(ctx)
    }

    pub fn cancel_order(ctx: Context<CancelOrder>, order_id: u64) -> Result<()> {
        instructions::orders::cancel_order(ctx, order_id)
    }

    pub fn cancel_sell_order(ctx: Context<CancelSellOrder>, order_id: u64) -> Result<()> {
        instructions::orders::cancel_sell_order(ctx, order_id)
    }

    pub fn cancel_no_sell_order(ctx: Context<CancelNoSellOrder>, order_id: u64) -> Result<()> {
        instructions::orders::cancel_no_sell_order(ctx, order_id)
    }

    // ---- Position close & liquidation ------------------------------------

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
        shares_to_close: u64,
        min_price: u64,
    ) -> Result<()> {
        instructions::positions::close_leveraged_position(
            ctx,
            order_id,
            shares_to_close,
            min_price,
        )
    }

    /// Close a position (for finalized markets or non-leveraged positions only).
    /// For active markets with leverage, use close_leveraged_position instead.
    pub fn close_position(ctx: Context<ClosePosition>) -> Result<()> {
        instructions::positions::close_position(ctx)
    }

    pub fn liquidate_position(ctx: Context<LiquidatePosition>) -> Result<()> {
        instructions::liquidation::liquidate_position(ctx)
    }
}
