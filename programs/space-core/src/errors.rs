//! Program error codes. Variant order and #[msg] strings are part of the IDL
//! and must not change without coordinating with downstream consumers.

use anchor_lang::prelude::*;

#[error_code]
pub enum SpaceError {
    #[msg("Bad outcomes")]
    InvalidOutcomes,
    #[msg("Not active")]
    MarketNotActive,
    #[msg("Bad outcome")]
    InvalidOutcome,
    #[msg("Bad price")]
    InvalidPrice,
    #[msg("Bad amount")]
    InvalidAmount,
    #[msg("Bad leverage")]
    InvalidLeverage,
    #[msg("Low liquidity")]
    InsufficientInitialLiquidity,
    #[msg("Low shares")]
    InsufficientShares,
    #[msg("Low margin")]
    InsufficientMargin,
    #[msg("Bad order")]
    InvalidOrder,
    #[msg("Paused")]
    ProtocolPaused,
    #[msg("Not liquidatable")]
    PositionNotLiquidatable,
    #[msg("Denied")]
    Unauthorized,
    #[msg("Label long")]
    LabelTooLong,
    #[msg("Expired")]
    OrderExpired,
    #[msg("Price OOB")]
    MatchPriceOutOfBounds,
    #[msg("Owner mismatch")]
    TokenAccountOwnershipMismatch,
    #[msg("Mint mismatch")]
    TokenAccountMintMismatch,
    #[msg("Slippage")]
    SlippageExceeded,
    #[msg("Resolved")]
    MarketAlreadyResolved,
    #[msg("Challenge active")]
    ChallengePeriodNotExpired,
    #[msg("Bad resolution")]
    InvalidResolution,
    #[msg("Convert fail")]
    InsufficientSharesForConversion,
    #[msg("Low vault")]
    InsufficientVaultBalance,
    #[msg("Bad PDA")]
    InvalidPDA,
    #[msg("Market already migrated to v2")]
    AlreadyMigrated,
    #[msg("Active leveraged position exists - must settle position first")]
    ActiveLeveragedPositionExists,
    #[msg("Not finalized")]
    MarketNotFinalized,
    #[msg("Cannot liquidate spot position")]
    CannotLiquidateSpot,
    #[msg("Position has no debt")]
    NoDebt,
    #[msg("Position type mismatch")]
    PositionTypeMismatch,
    #[msg("Invalid spot leverage (must be 1)")]
    InvalidSpotLeverage,
    #[msg("Position is not open")]
    PositionNotOpen,
    #[msg("Invalid spot debt (spot positions must have 0 debt)")]
    InvalidSpotDebt,
    #[msg("Cannot sell leveraged position as spot")]
    CannotSellLeveragedAsSpot,
    #[msg("Cannot close spot position as leveraged")]
    CannotCloseSpotAsLeveraged,
    #[msg("Account not initialized")]
    AccountNotInitialized,
}
