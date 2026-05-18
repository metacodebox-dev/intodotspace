-- Migration: Add image_url column to markets table
-- This supports market cover images stored in Supabase Storage

ALTER TABLE markets
ADD COLUMN IF NOT EXISTS image_url VARCHAR(500) DEFAULT NULL;

-- Add partial index for faster filtering by markets with images
CREATE INDEX IF NOT EXISTS idx_markets_has_image ON markets (image_url) WHERE image_url IS NOT NULL;

-- Comment for documentation
COMMENT ON COLUMN markets.image_url IS 'Market cover image URL stored in Supabase Storage';
