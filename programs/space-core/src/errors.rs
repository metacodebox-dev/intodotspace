// ============================================================================
// ERRORS
// ============================================================================

use anchor_lang::prelude::*;

#[error_code]
pub enum SpaceError {
    #[msg("Invalid number of outcomes (must be 2-10)")]
    InvalidOutcomes,
    #[msg("Market is not active")]
    MarketNotActive,
    #[msg("Invalid outcome ID")]
    InvalidOutcome,
    #[msg("Invalid price (must be 1-10000 basis points)")]
    InvalidPrice,
    #[msg("Invalid amount")]
    InvalidAmount,
    #[msg("Invalid leverage (must be 1-10)")]
    InvalidLeverage,
    #[msg("Insufficient initial liquidity")]
    InsufficientInitialLiquidity,
    #[msg("Insufficient shares")]
    InsufficientShares,
    #[msg("Insufficient margin")]
    InsufficientMargin,
    #[msg("Invalid order")]
    InvalidOrder,
    #[msg("Protocol is paused")]
    ProtocolPaused,
    #[msg("Oracle not approved")]
    InvalidOracle,
    #[msg("Oracle already exists")]
    OracleAlreadyExists,
    #[msg("Too many oracles")]
    TooManyOracles,
    #[msg("Market not in resolving state")]
    MarketNotResolving,
    #[msg("Challenge period still active")]
    ChallengePeriodActive,
    #[msg("Challenge period has ended")]
    ChallengePeriodEnded,
    #[msg("Insufficient challenge bond")]
    InsufficientChallengeBond,
    #[msg("Market not finalized")]
    MarketNotFinalized,
    #[msg("Invalid market status")]
    InvalidMarketStatus,
    #[msg("Invalid resolution type")]
    InvalidResolutionType,
    #[msg("Market has not ended")]
    MarketNotEnded,
    #[msg("Insufficient TWAP samples")]
    InsufficientTwapSamples,
    #[msg("Price change exceeded maximum")]
    PriceChangeExceeded,
    #[msg("Slippage exceeded")]
    SlippageExceeded,
    #[msg("Position not liquidatable")]
    PositionNotLiquidatable,
    #[msg("Unauthorized")]
    Unauthorized,
    #[msg("Token account ownership mismatch")]
    TokenAccountOwnershipMismatch,
    #[msg("Token account mint mismatch")]
    TokenAccountMintMismatch,
    #[msg("Insufficient vault balance")]
    InsufficientVaultBalance,
    #[msg("Outcome label too long (max 100 chars)")]
    LabelTooLong,
    #[msg("Invalid resolution state")]
    InvalidResolution,
    #[msg("Challenge period has not expired")]
    ChallengePeriodNotExpired,
    #[msg("Active leveraged position exists - must settle position first")]
    ActiveLeveragedPositionExists,
    #[msg("Invalid PDA derivation")]
    InvalidPDA,
}



