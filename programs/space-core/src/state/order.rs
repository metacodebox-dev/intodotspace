//! PendingOrder account — limit/market orders sitting on the book or in flight
//! through a match. Field order is part of the on-chain layout.

use anchor_lang::prelude::*;

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
    // Leveraged close fields — populated when closing a leveraged position via market sell.
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
