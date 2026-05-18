-- Migration: Add total_trades column to space_points
-- Optimized for 1M+ users - uses atomic increment for concurrent updates

ALTER TABLE space_points 
ADD COLUMN IF NOT EXISTS total_trades INTEGER NOT NULL DEFAULT 0;

-- Index for leaderboard sorting by trades
CREATE INDEX IF NOT EXISTS idx_space_points_total_trades ON space_points(total_trades DESC);

COMMENT ON COLUMN space_points.total_trades IS 'Total number of filled trades by this user';
