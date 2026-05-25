//! On-chain enums stored as u8 in account fields. Discriminant values are
//! part of the wire format — do not reorder.

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
pub enum OrderType {
    Limit = 0,
    Market = 1,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum ResolutionType {
    TWAP = 0,
    Oracle = 1,
    Manual = 2,
}

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq)]
pub enum PositionType {
    Spot = 0,
    Leveraged = 1,
}
