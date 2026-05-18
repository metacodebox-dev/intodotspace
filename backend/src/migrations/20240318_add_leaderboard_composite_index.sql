-- Migration: add_leaderboard_composite_index
-- Description: Add composite index on (total_points DESC, total_trades DESC) for optimal leaderboard ranking
-- Date: 2026-03-18

CREATE INDEX IF NOT EXISTS idx_space_points_leaderboard ON space_points (total_points DESC, total_trades DESC);
