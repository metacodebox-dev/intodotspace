//! Instruction handlers grouped by area. Each submodule contains its
//! `#[derive(Accounts)]` context structs alongside the corresponding `pub fn`
//! handlers. The top-level `#[program]` block in `lib.rs` re-exports these as
//! thin wrappers so Anchor's IDL generator picks them up.

pub mod config;
pub mod liquidation;
pub mod market;
pub mod matching;
pub mod orders;
pub mod positions;
pub mod resolution;
pub mod shares;

pub use config::*;
pub use liquidation::*;
pub use market::*;
pub use matching::*;
pub use orders::*;
pub use positions::*;
pub use resolution::*;
pub use shares::*;
