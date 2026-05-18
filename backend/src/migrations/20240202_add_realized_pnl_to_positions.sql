-- Migration: add_realized_pnl_to_positions
-- Description: Add realizedPnl field to track PnL when positions are closed
-- Date: 2024-02-02

ALTER TABLE positions 
ADD COLUMN IF NOT EXISTS realized_pnl VARCHAR(255) DEFAULT NULL;

COMMENT ON COLUMN positions.realized_pnl IS 'Realized PnL in USDC (as string) when position was closed. NULL for open positions.';

