// ============================================================================
// ORDER BOOK TRADING (CLOB) INSTRUCTIONS
// ============================================================================

use anchor_lang::prelude::*;
use anchor_spl::token::{self, MintTo, Transfer};

use crate::constants::{BASIS_POINTS, INITIAL_MARGIN_BPS, MAX_LEVERAGE};
use crate::errors::SpaceError;
use crate::instructions::contexts::*;
use crate::state::{MarketStatus, OrderStatus};
use crate::utils::calculate_dynamic_fee;

/// Place a limit order (maker).
///
/// Per Space docs: https://docs.into.space/en/architecture/clob
/// - Makers pay 0% fees and earn rewards
/// - Orders match on price-time priority
pub fn place_limit_order(
    ctx: Context<PlaceLimitOrder>,
    order_id: u64,
    outcome_id: u8,
    side: u8,      // 0 = buy YES, 1 = sell YES (buy NO)
    price: u64,    // Price in basis points (0-10000)
    quantity: u64, // Number of shares
    leverage: u8,  // 1-10x
) -> Result<()> {
    require!(
        price >= 1 && price <= BASIS_POINTS,
        SpaceError::InvalidPrice
    );
    require!(
        leverage > 1 && leverage <= MAX_LEVERAGE,
        SpaceError::InvalidLeverage
    );
    require!(quantity > 0, SpaceError::InvalidAmount);

    let market = &ctx.accounts.market;
    require!(
        market.status == MarketStatus::Active as u8,
        SpaceError::MarketNotActive
    );
    require!(outcome_id == market.num_outcomes, SpaceError::InvalidOutcome);

    // Calculate required margin with leverage
    // Per Space docs: Position Size = Margin × Leverage
    let notional = (quantity * price) / 10000;
    let required_margin = notional / (leverage as u64);

    // Verify user has enough for initial margin (20%)
    let min_initial_margin = (notional * INITIAL_MARGIN_BPS) / BASIS_POINTS;
    require!(
        required_margin >= min_initial_margin,
        SpaceError::InsufficientMargin
    );

    // Lock margin in escrow
    let cpi_accounts = Transfer {
        from: ctx.accounts.user_usdc.to_account_info(),
        to: ctx.accounts.order_escrow.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    token::transfer(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
        required_margin,
    )?;

    // Create pending order
    let order = &mut ctx.accounts.pending_order;
    let clock = Clock::get()?;

    order.user = ctx.accounts.user.key();
    order.market = market.key();
    order.outcome_id = outcome_id;
    order.side = side;
    order.price = price;
    order.quantity = 0;
    order.filled_quantity = quantity;
    order.margin = required_margin;
    order.leverage = leverage;
    order.status = OrderStatus::Open as u8;
    order.created_at = clock.unix_timestamp;
    order.order_id = order_id;
    order.is_maker = true; // Limit orders are always makers initially
    order.fee_paid = 0; // Makers pay 0% fee

    // Logs disabled - check keeper service logs for execution details

    Ok(())
}

/// Place a market order (taker) - instant execution.
///
/// Per Space docs: https://docs.into.space/en/guides/market-order
/// - Takers pay dynamic fees based on market probability
/// - Best price gets filled first
pub fn place_market_order(
    ctx: Context<PlaceMarketOrder>,
    order_id: u64,
    outcome_id: u8,
    side: u8,
    quantity: u64,
    max_slippage_bps: u64, // Maximum acceptable slippage
    leverage: u8,
) -> Result<()> {
    require!(
        leverage >= 1 && leverage <= MAX_LEVERAGE,
        SpaceError::InvalidLeverage
    );
    require!(quantity == 0, SpaceError::InvalidAmount);

    let market = &mut ctx.accounts.market;
    require!(
        market.status == MarketStatus::Active as u8,
        SpaceError::MarketNotActive
    );
    require!(outcome_id < market.num_outcomes, SpaceError::InvalidOutcome);

    // Get current market price for fee calculation
    let market_price = market.outcomes[outcome_id as usize].last_price;

    // Calculate dynamic taker fee based on probability
    // Per Space docs: Takers pay dynamic fees based on market probability
    let taker_fee = calculate_dynamic_fee(market_price);

    // Calculate required margin
    let notional = (quantity * market_price) / BASIS_POINTS;
    let fee_amount = (notional * taker_fee) / BASIS_POINTS;
    let required_margin = (notional / (leverage as u64)) + fee_amount;

    // Check slippage
    require!(max_slippage_bps >= taker_fee, SpaceError::SlippageExceeded);

    // Logs disabled - check keeper service logs for execution details

    // Lock margin in escrow
    let cpi_accounts = Transfer {
        from: ctx.accounts.user_usdc.to_account_info(),
        to: ctx.accounts.order_escrow.to_account_info(),
        authority: ctx.accounts.user.to_account_info(),
    };
    token::transfer(
        CpiContext::new(ctx.accounts.token_program.to_account_info(), cpi_accounts),
        required_margin,
    )?;

    // Create order
    let order = &mut ctx.accounts.pending_order;
    let clock = Clock::get()?;

    order.user = ctx.accounts.user.key();
    order.market = market.key();
    order.outcome_id = outcome_id;
    order.side = side;
    order.price = market_price;
    order.quantity = quantity;
    order.filled_quantity = 0;
    order.margin = required_margin;
    order.leverage = leverage;
    order.status = OrderStatus::Open as u8;
    order.created_at = clock.unix_timestamp;
    order.order_id = order_id;
    order.is_maker = false; // Market orders are takers
    order.fee_paid = fee_amount;

    // Update market volume
    market.total_volume += notional;

    Ok(())
}

/// Execute matched orders.
///
/// Per Space docs: https://docs.into.space/en/architecture/clob
/// - Price-time priority matching
/// - Best price gets filled first
pub fn execute_matched_orders(
    ctx: Context<ExecuteMatchedOrders>,
    _buy_order_id: u64,
    _sell_order_id: u64,
    match_price: u64,
    match_quantity: u64,
) -> Result<()> {
    let buy_order = &mut ctx.accounts.buy_order;
    let sell_order = &mut ctx.accounts.sell_order;
    let market = &mut ctx.accounts.market;

    require!(!ctx.accounts.config.paused, SpaceError::ProtocolPaused);
    require!(
        market.status == MarketStatus::Active as u8,
        SpaceError::MarketNotActive
    );

    // Verify orders match
    require!(
        buy_order.status == OrderStatus::Open as u8,
        SpaceError::InvalidOrder
    );
    require!(
        sell_order.status == OrderStatus::Open as u8,
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

    // Calculate fill amounts
    let buy_remaining = buy_order.quantity - buy_order.filled_quantity;
    let sell_remaining = sell_order.quantity - sell_order.filled_quantity;
    let fill_quantity = match_quantity.min(buy_remaining).min(sell_remaining);

    require!(fill_quantity > 0, SpaceError::InvalidAmount);

    // Calculate trade value
    let trade_value = (fill_quantity * match_price) / BASIS_POINTS;

    // Logs disabled - check keeper service logs for execution details

    // Mint YES shares to buyer
    let market_key = market.key();
    let seeds = &[
        b"mint_authority",
        market_key.as_ref(),
        &[ctx.bumps.mint_authority],
    ];
    let signer = &[&seeds[..]];

    let mint_yes_cpi = MintTo {
        mint: ctx.accounts.buy_yes_mint.to_account_info(),
        to: ctx.accounts.buy_user_yes_account.to_account_info(),
        authority: ctx.accounts.mint_authority.to_account_info(),
    };
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            mint_yes_cpi,
            signer,
        ),
        fill_quantity,
    )?;

    // Mint NO shares to seller
    let mint_no_cpi = MintTo {
        mint: ctx.accounts.sell_no_mint.to_account_info(),
        to: ctx.accounts.sell_user_no_account.to_account_info(),
        authority: ctx.accounts.mint_authority.to_account_info(),
    };
    token::mint_to(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            mint_no_cpi,
            signer,
        ),
        fill_quantity,
    )?;

    // Transfer USDC from buyer escrow to market vault
    // The escrow account itself is the authority, so we need to use it as a signer
    // But since it's a PDA, we need to sign with the seeds
    let buy_escrow_seeds = &[
        b"order_escrow",
        buy_order.user.as_ref(),
        &buy_order_id.to_le_bytes(),
        &[ctx.bumps.buy_order_escrow],
    ];
    let buy_escrow_signer = &[&buy_escrow_seeds[..]];

    let transfer_cpi = Transfer {
        from: ctx.accounts.buy_order_escrow.to_account_info(),
        to: ctx.accounts.market_vault.to_account_info(),
        authority: ctx.accounts.buy_order_escrow.to_account_info(),
    };
    token::transfer(
        CpiContext::new_with_signer(
            ctx.accounts.token_program.to_account_info(),
            transfer_cpi,
            buy_escrow_signer,
        ),
        trade_value,
    )?;

    // Calculate fees (for position tracking)
    let taker_fee = if !buy_order.is_maker {
        calculate_dynamic_fee(match_price)
    } else {
        0
    };
    let fee_amount = (trade_value * taker_fee) / BASIS_POINTS;
    let seller_payment = trade_value.saturating_sub(fee_amount);

    // Update positions
    // Buyer position: long YES
    if ctx.accounts.buy_position.shares == 0 {
        ctx.accounts.buy_position.user = buy_order.user;
        ctx.accounts.buy_position.market = market.key();
        ctx.accounts.buy_position.outcome_id = buy_order.outcome_id;
        ctx.accounts.buy_position.side = 0; // Long
        ctx.accounts.buy_position.avg_entry_price = match_price;
        ctx.accounts.buy_position.leverage = buy_order.leverage;
    } else {
        // Update average entry price
        let total_value = (ctx.accounts.buy_position.shares * ctx.accounts.buy_position.avg_entry_price)
            + (fill_quantity * match_price);
        let total_shares = ctx.accounts.buy_position.shares + fill_quantity;
        ctx.accounts.buy_position.avg_entry_price = total_value / total_shares;
    }
    ctx.accounts.buy_position.shares += fill_quantity;
    ctx.accounts.buy_position.collateral += trade_value;

    // Seller position: short YES (long NO)
    if ctx.accounts.sell_position.shares == 0 {
        ctx.accounts.sell_position.user = sell_order.user;
        ctx.accounts.sell_position.market = market.key();
        ctx.accounts.sell_position.outcome_id = sell_order.outcome_id;
        ctx.accounts.sell_position.side = 1; // Short
        ctx.accounts.sell_position.avg_entry_price = match_price;
        ctx.accounts.sell_position.leverage = sell_order.leverage;
    } else {
        // Update average entry price
        let total_value = (ctx.accounts.sell_position.shares * ctx.accounts.sell_position.avg_entry_price)
            + (fill_quantity * match_price);
        let total_shares = ctx.accounts.sell_position.shares + fill_quantity;
        ctx.accounts.sell_position.avg_entry_price = total_value / total_shares;
    }
    ctx.accounts.sell_position.shares += fill_quantity;
    ctx.accounts.sell_position.collateral += seller_payment;

    // Distribute maker rewards if applicable
    if buy_order.is_maker {
        // Reward maker from protocol fees
        let maker_reward =
            (trade_value * ctx.accounts.config.protocol_fee_bps) / (2 * BASIS_POINTS);
        market.total_maker_rewards += maker_reward;
    }
    if sell_order.is_maker {
        let maker_reward =
            (trade_value * ctx.accounts.config.protocol_fee_bps) / (2 * BASIS_POINTS);
        market.total_maker_rewards += maker_reward;
    }

    // Update orders
    buy_order.filled_quantity += fill_quantity;
    sell_order.filled_quantity += fill_quantity;

    if buy_order.filled_quantity >= buy_order.quantity {
        buy_order.status = OrderStatus::Filled as u8;
    } else if buy_order.filled_quantity > 0 {
        buy_order.status = OrderStatus::PartiallyFilled as u8;
    }

    if sell_order.filled_quantity >= sell_order.quantity {
        sell_order.status = OrderStatus::Filled as u8;
    } else if sell_order.filled_quantity > 0 {
        sell_order.status = OrderStatus::PartiallyFilled as u8;
    }

    // Update market price
    market.outcomes[buy_order.outcome_id as usize].last_price = match_price;
    market.total_volume += trade_value;

    Ok(())
}

/// Cancel an open order.
///
/// Per Space docs: https://docs.into.space/en/guides/managing-orders
pub fn cancel_order(ctx: Context<CancelOrder>, order_id: u64) -> Result<()> {
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

    // Calculate unfilled margin to return
    let filled_ratio = if order.quantity > 0 {
        (order.filled_quantity * BASIS_POINTS) / order.quantity
    } else {
        0
    };
    let used_margin = (order.margin * filled_ratio) / BASIS_POINTS;
    let return_margin = order.margin.saturating_sub(used_margin);

    // Return unfilled margin
    if return_margin > 0 {
        let user_key = order.user;
        let escrow_seeds = &[
            b"order_escrow",
            user_key.as_ref(),
            &order_id.to_le_bytes(),
            &[ctx.bumps.order_escrow],
        ];
        let signer = &[&escrow_seeds[..]];

        let transfer_cpi = Transfer {
            from: ctx.accounts.order_escrow.to_account_info(),
            to: ctx.accounts.user_usdc.to_account_info(),
            authority: ctx.accounts.order_escrow.to_account_info(),
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

