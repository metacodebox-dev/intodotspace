//! Two-phase order matching:
//!   1. validate_match creates a MatchState PDA recording price/quantity/maker
//!      flags after checking compatibility between a buy_order and sell_order.
//!   2. execute_yes_buyer_match / execute_no_buyer_match settle the buyer half
//!      (mint or transfer shares, debit margin/borrow, update position).
//!   3. execute_seller_match settles the seller half (payout USDC, repay debt
//!      on leveraged closes, record fees, update volume and snapshots).
//!
//! Handler bodies copied verbatim from the original lib.rs.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::{invoke, invoke_signed};
use anchor_lang::solana_program::system_instruction;
use anchor_spl::token::{self, Token, TokenAccount, Transfer};

use crate::constants::{
    quote_scale, BASIS_POINTS, MAINTENANCE_MARGIN_BPS, MAKER_FEE_BPS, MAX_ORDER_AGE_SECONDS,
};
use crate::errors::SpaceError;
use crate::helpers::{
    add_price_snapshot, calculate_dynamic_fee, calculate_liquidation_price,
    find_position_pda_compat,
};
use crate::state::{
    Config, Market, MarketStatus, MatchState, OrderStatus, OrderType, PendingOrder, Position,
    PositionType,
};

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
