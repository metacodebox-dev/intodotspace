//! Position close paths:
//!   - close_position handles spot positions on active markets and any
//!     position on a finalized market (burn shares, pay equity, repay debt
//!     from margin_vault if leveraged).
//!   - close_leveraged_position routes a still-active leveraged position
//!     through the order book as a market sell, so debt is repaid out of
//!     real sale proceeds rather than mark-to-market.
//!
//! Handler bodies copied verbatim from the original lib.rs.

use anchor_lang::prelude::*;
use anchor_lang::solana_program::program::invoke_signed;
use anchor_lang::solana_program::system_instruction;
use anchor_spl::token::{self, Burn, Mint, Token, TokenAccount, Transfer};
use spl_token::instruction as token_instruction;

use crate::constants::{quote_scale, BASIS_POINTS};
use crate::errors::SpaceError;
use crate::state::{
    Config, Market, MarketStatus, OrderStatus, OrderType, PendingOrder, Position,
};

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
