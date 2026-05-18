-- Add token_type column to positions table to distinguish YES from NO positions
ALTER TABLE positions ADD COLUMN IF NOT EXISTS token_type VARCHAR(4) NOT NULL DEFAULT 'yes';
