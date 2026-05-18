-- Migration: create_positions_table
-- Description: Create positions table to store user positions for fast queries
-- Date: 2024-01-26

CREATE TABLE IF NOT EXISTS positions (
  id VARCHAR(44) PRIMARY KEY, -- PDA address
  market_address VARCHAR(44) NOT NULL,
  market_id VARCHAR(255) NOT NULL,
  "user" VARCHAR(44) NOT NULL,
  outcome_id INTEGER NOT NULL,
  side INTEGER NOT NULL, -- 0 = Long, 1 = Short
  position_type INTEGER NOT NULL, -- 0 = Spot, 1 = Leveraged
  shares VARCHAR(255) NOT NULL, -- BigInt as string (in lamports)
  avg_entry_price INTEGER NOT NULL, -- Basis points
  leverage INTEGER NOT NULL DEFAULT 1,
  collateral VARCHAR(255) NOT NULL, -- BigInt as string (in lamports)
  borrowed_amount VARCHAR(255) NOT NULL DEFAULT '0', -- BigInt as string (in lamports)
  liquidation_price INTEGER, -- Basis points (only for leveraged)
  is_open BOOLEAN NOT NULL DEFAULT true,
  last_updated TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for fast queries
CREATE INDEX IF NOT EXISTS idx_positions_user ON positions("user");
CREATE INDEX IF NOT EXISTS idx_positions_market ON positions(market_address);
CREATE INDEX IF NOT EXISTS idx_positions_user_market ON positions("user", market_address);
CREATE INDEX IF NOT EXISTS idx_positions_user_open ON positions("user", is_open);

-- Index for market lookups
CREATE INDEX IF NOT EXISTS idx_positions_market_outcome ON positions(market_address, outcome_id);


