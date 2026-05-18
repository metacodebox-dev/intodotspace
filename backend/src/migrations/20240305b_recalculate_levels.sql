-- Migration: recalculate_levels
-- Description: Recalculate user levels with new iron tier thresholds
-- Date: 2026-03-12

-- Recalculate all user levels based on new thresholds
UPDATE space_points SET level = CASE
  WHEN total_points >= 500000 THEN 'diamond'
  WHEN total_points >= 350000 THEN 'platinum'
  WHEN total_points >= 250000 THEN 'gold'
  WHEN total_points >= 120000 THEN 'silver'
  WHEN total_points >= 50000 THEN 'bronze'
  ELSE 'iron'
END;
