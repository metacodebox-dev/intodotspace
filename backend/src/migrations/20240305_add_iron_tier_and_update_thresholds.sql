-- Migration: add_iron_tier_and_update_thresholds
-- Description: Drop old level check constraint to allow 'iron' value
-- Date: 2026-03-12

-- Drop the old check constraint that only allows bronze/silver/gold/platinum/diamond
ALTER TABLE space_points DROP CONSTRAINT IF EXISTS "space_points_level_check";
ALTER TABLE space_points DROP CONSTRAINT IF EXISTS "space_points_level_check1";
