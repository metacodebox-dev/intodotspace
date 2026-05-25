//! Market account + per-outcome and price-history sub-structs.
//!
//! Field order is part of the account layout and must not change. The v2
//! fields (quote_mint / quote_decimals / version) are appended last;
//! migrate_market_v1_to_v2 backfills them on accounts created under v1.

use anchor_lang::prelude::*;

use crate::constants::{MAX_OUTCOME_LABEL_LEN, MAX_PRICE_SNAPSHOTS};

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
