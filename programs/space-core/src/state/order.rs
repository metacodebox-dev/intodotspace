// ============================================================================
// ORDER STATE
// ============================================================================

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
    pub leverage: u8,
    pub status: u8,
    pub created_at: i64,
    pub order_id: u64,
    pub is_maker: bool,
    pub fee_paid: u64,
}

impl PendingOrder {
    pub const LEN: usize = 32 + 32 + 1 + 1 + 1 + 8 + 8 + 8 + 1 + 1 + 8 + 8 + 1 + 8;
}

#[account]
pub struct Position {
    pub user: Pubkey,
    pub market: Pubkey,
    pub outcome_id: u8,
    pub side: u8,
    pub shares: u64,
    pub avg_entry_price: u64,
    pub borrowed_amount: u64, // Amount borrowed from liquidity vault for leveraged positions
}

impl Position {
    pub const LEN: usize = 32 + 32 + 1 + 1 + 8 + 8 + 1 + 8 + 8;
}



