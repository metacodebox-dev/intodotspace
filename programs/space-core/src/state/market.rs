// ============================================================================
// MARKET STATE
// ============================================================================

use anchor_lang::prelude::*;

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
    pub resolved_outcome: Option<u8>,
    pub resolution_source: Option<Pubkey>,
    pub resolve_slot: Option<u64>,
    pub evidence_hash: Option<[u8; 32]>,
    pub challenge_bond: u64,
    pub challenger: Option<Pubkey>,
    pub creator_fee_bps: u64,
    pub is_invalid: bool,
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
        + 34
        + 8
        + 1;
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone)]
pub struct MarketOutcome {
    pub id: u8,
    pub label: String,
    pub last_price: u64, // Last traded price (for fee calculation)
}

impl MarketOutcome {
    pub const LEN: usize = 1 + 4 + 100 + 8; // id + label string + last_price
}





