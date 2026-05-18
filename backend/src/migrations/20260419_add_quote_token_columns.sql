-- Add quote-token columns so USDC and SPACE markets can coexist.
-- Existing rows keep working via USDC defaults; on-chain values are the source of truth
-- and can be re-synced with the backfill script in scripts/backfillMarketQuoteInfo.ts.
ALTER TABLE markets ADD COLUMN IF NOT EXISTS quote_mint VARCHAR(44) NOT NULL DEFAULT 'CqdmbJnQxMNNTGZzsBhEPTSzH52Pwa5DRvpVjZ2Us92t';
ALTER TABLE markets ADD COLUMN IF NOT EXISTS quote_decimals SMALLINT NOT NULL DEFAULT 6;
ALTER TABLE markets ADD COLUMN IF NOT EXISTS quote_symbol VARCHAR(16) NOT NULL DEFAULT 'USDC';

-- Power the "Space Markets" tab query path without a full scan.
CREATE INDEX IF NOT EXISTS idx_markets_quote_symbol ON markets (quote_symbol);
