-- Migration: create_orders_table
-- Description: Create orders table for CLOB order book
-- Date: 2024-01-01

-- Create orders table for CLOB order book
CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  market_id VARCHAR(255) NOT NULL,
  outcome_id INTEGER NOT NULL,
  side VARCHAR(4) NOT NULL CHECK (side IN ('buy', 'sell')),
  type VARCHAR(6) NOT NULL CHECK (type IN ('market', 'limit')),
  price INTEGER NOT NULL, -- Basis points (0-10000)
  size BIGINT NOT NULL, -- In lamports
  filled BIGINT NOT NULL DEFAULT 0, -- Amount filled in lamports
  leverage INTEGER NOT NULL DEFAULT 1,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'open', 'partially_filled', 'filled', 'cancelled')),
  user_id VARCHAR(255) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

-- Indexes for efficient order book queries
CREATE INDEX IF NOT EXISTS idx_orders_market_outcome_status ON orders(market_id, outcome_id, status);
CREATE INDEX IF NOT EXISTS idx_orders_user ON orders(user_id);
CREATE INDEX IF NOT EXISTS idx_orders_status_type_side_price ON orders(status, type, side, price);






