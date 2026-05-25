//! Position account — open spot or leveraged exposure for a (user, market,
//! outcome, side, position_type, token_type) tuple.
//!
//! Backward-compat: old position accounts predate the token_type field. They
//! were created with a 6-seed PDA and serialize to OLD_LEN bytes.
//! Position::deserialize_compat understands both layouts.

use anchor_lang::prelude::*;

#[account]
pub struct Position {
    pub user: Pubkey,
    pub market: Pubkey,
    pub outcome_id: u8,
    pub side: u8,
    pub shares: u64,
    pub avg_entry_price: u64,
    pub leverage: u8,
    pub collateral: u64,
    pub borrowed_amount: u64,
    pub position_type: u8,      // PositionType enum (0 = Spot, 1 = Leveraged)
    pub liquidation_price: u64, // ONLY meaningful for leveraged (0 for spot)
    pub is_open: bool,          // Whether position is active
    pub token_type: u8,         // 0 = YES, 1 = NO — separates YES/NO into distinct PDAs
}

impl Position {
    pub const LEN: usize = 32 + 32 + 1 + 1 + 8 + 8 + 1 + 8 + 8 + 1 + 8 + 1 + 1;
    /// Old position data length (before token_type was added)
    pub const OLD_LEN: usize = 32 + 32 + 1 + 1 + 8 + 8 + 1 + 8 + 8 + 1 + 8 + 1;

    /// Deserialize position data with backward compatibility for old format (no token_type).
    /// Old positions have OLD_LEN bytes; new positions have LEN bytes.
    /// For old format, token_type defaults to 0 (YES).
    pub fn deserialize_compat(
        data_after_discriminator: &[u8],
    ) -> std::result::Result<Position, ProgramError> {
        // Try new format first (has token_type)
        if let Ok(pos) = Position::deserialize(&mut &*data_after_discriminator) {
            return Ok(pos);
        }
        // Fallback: old format — append token_type=0 and try again
        if data_after_discriminator.len() == Self::OLD_LEN {
            let mut extended = data_after_discriminator[..Self::OLD_LEN].to_vec();
            extended.push(0u8); // default token_type = 0 (YES)
            return Position::deserialize(&mut extended.as_slice())
                .map_err(|_| ProgramError::InvalidAccountData);
        }
        Err(ProgramError::InvalidAccountData)
    }

    /// Minimum data length to attempt deserialization (old or new format)
    pub fn min_data_len() -> usize {
        8 + Self::OLD_LEN // discriminator + old format
    }
}
