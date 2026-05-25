//! MatchState — ephemeral PDA created by validate_match and consumed by the
//! buyer/seller execute_*_match instructions. Decouples match validation from
//! execution so the two sides can settle in separate transactions.

use anchor_lang::prelude::*;

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
