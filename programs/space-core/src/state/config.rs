// ============================================================================
// CONFIG STATE
// ============================================================================

use anchor_lang::prelude::*;

#[account]
pub struct Config {
    pub admin: Pubkey,
    pub paused: bool,
    pub max_global_oi: u128,
    pub protocol_fee_bps: u64,
    pub creator_fee_bps: u64,
    pub insurance_fee_bps: u64,
}

impl Config {
    pub const LEN: usize = 32 + 1 + 16 + 8 + 8 + 8;
}

#[account]
pub struct OracleRegistry {
    pub approved_oracles: Vec<Pubkey>,
}

impl OracleRegistry {
    pub const LEN: usize = 4 + (10 * 32);
}

#[account]
pub struct InsuranceFund {
    pub balance: u64,
}

impl InsuranceFund {
    pub const LEN: usize = 8;
}

#[account]
pub struct TwapState {
    pub market: Pubkey,
    pub total_price_time: u64,
    pub total_time: u64,
    pub sample_count: u64,
    pub last_price: u64,
    pub last_timestamp: i64,
}

impl TwapState {
    pub const LEN: usize = 32 + 8 + 8 + 8 + 8 + 8;
}





