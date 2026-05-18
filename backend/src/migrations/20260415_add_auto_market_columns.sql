-- Add auto-market columns to markets table
ALTER TABLE markets ADD COLUMN IF NOT EXISTS auto_resolve BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS timeframe_secs INTEGER;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS strike_price BIGINT;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS price_feed VARCHAR(20);
ALTER TABLE markets ADD COLUMN IF NOT EXISTS resolve_at TIMESTAMP;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS resolved_at TIMESTAMP;

-- Index for the auto-resolver cron queries
CREATE INDEX IF NOT EXISTS idx_markets_auto_resolve_status ON markets (auto_resolve, status) WHERE auto_resolve = true;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS seed_order_ids TEXT;
CREATE INDEX IF NOT EXISTS idx_markets_resolve_at ON markets (resolve_at) WHERE auto_resolve = true AND status = 0;
