//! Limit-order placement and cancellation: buy orders escrow USDC margin,
//! YES/NO sell orders escrow the seller's shares, cancellation returns
//! escrowed assets and (for leveraged-close sells) restores the underlying
//! position state.
//!
//! Handler bodies copied verbatim from the original lib.rs.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::solana_program::system_instruction;
use anchor_spl::token::{self, Mint, Token, TokenAccount, Transfer};
use spl_token::instruction as token_instruction;

use crate::constants::{quote_scale, BASIS_POINTS, INITIAL_MARGIN_BPS, MAX_LEVERAGE};
use crate::errors::SpaceError;
use crate::helpers::find_position_pda_compat;
use crate::state::{
    Config, Market, MarketStatus, OrderStatus, OrderType, PendingOrder, Position, PositionType,
};

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
