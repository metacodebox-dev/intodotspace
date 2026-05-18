-- Add avg_fill_price column to orders table
-- Stores the weighted average fill price in basis points
ALTER TABLE orders ADD COLUMN IF NOT EXISTS avg_fill_price INTEGER DEFAULT NULL
