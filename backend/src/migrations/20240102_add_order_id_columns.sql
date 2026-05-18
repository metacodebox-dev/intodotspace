-- Migration: Add order_id and on_chain_order columns to orders table
-- Run this after clearing old data and before placing new orders

-- Add order_id column (nullable for existing records) - BIGINT for Date.now() timestamps
ALTER TABLE orders
ADD COLUMN IF NOT EXISTS order_id BIGINT;

-- Add on_chain_order column (nullable for existing records)
ALTER TABLE orders 
ADD COLUMN IF NOT EXISTS on_chain_order VARCHAR(255);

-- Add comment
COMMENT ON COLUMN orders.order_id IS 'On-chain order ID used for PDA derivation';
COMMENT ON COLUMN orders.on_chain_order IS 'On-chain pending order PDA address';

-- Create index on order_id for faster lookups
CREATE INDEX IF NOT EXISTS idx_orders_order_id ON orders(order_id);





