-- Migration: add_comment_tracking_columns
-- Description: Add daily comment count and last comment bonus date for comment point caps
-- Date: 2026-03-12

ALTER TABLE space_points ADD COLUMN IF NOT EXISTS daily_comment_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE space_points ADD COLUMN IF NOT EXISTS last_comment_bonus_date DATE;
