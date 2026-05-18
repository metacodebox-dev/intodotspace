-- Add claim_type column to faucet_claims table to support SOL faucet
ALTER TABLE faucet_claims ADD COLUMN IF NOT EXISTS claim_type VARCHAR(10) NOT NULL DEFAULT 'usdc';

-- Drop old index and create new composite index with claim_type
DROP INDEX IF EXISTS idx_faucet_claims_wallet_claimed;
CREATE INDEX IF NOT EXISTS idx_faucet_claims_wallet_type_claimed ON faucet_claims(wallet_address, claim_type, claimed_at DESC);
