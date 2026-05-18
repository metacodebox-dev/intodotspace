-- Migration: Add token_type column to orders table
-- Separates YES and NO order books for the same outcome

-- Add token_type column as VARCHAR (Sequelize handles enum validation at app level)
-- Default 'yes' for backward compatibility with existing orders
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS token_type VARCHAR(3) DEFAULT 'yes';

-- Add index for efficient order book queries filtered by token_type
CREATE INDEX IF NOT EXISTS idx_orders_market_outcome_token_type_status
ON orders(market_id, outcome_id, token_type, status);

-- Comment
COMMENT ON COLUMN orders.token_type IS 'YES or NO shares - separates YES and NO order books for same outcome';
