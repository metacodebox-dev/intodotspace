// ============================================================================
// ENUMS
// ============================================================================

use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum MarketStatus {
    Active = 0,
    Resolving = 1,
    Disputed = 2,
    Finalized = 3,
    Invalid = 4,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum OrderStatus {
    Open = 0,
    PartiallyFilled = 1,
    Filled = 2,
    Cancelled = 3,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ResolutionType {
    Deterministic = 0, // TWAP-based for crypto markets
    Oracle = 1,        // Multisig oracle for other markets
}





