-- Migration: drop_unused_faucet_claims_indexes
-- Description: Drop 6 unused/duplicate indexes on faucet_claims to reclaim ~109 MB.
--   All 6 indexes show 0 scans in pg_stat_user_indexes; the kept composite
--   `faucet_claims_wallet_address_claim_type_claimed_at` covers the query pattern
--   (658k+ scans). Sequelize's auto-created indexes duplicate the manually-defined
--   `idx_*` indexes (and vice versa), so each pair has one redundant copy.
-- Date: 2026-05-16

DROP INDEX IF EXISTS idx_faucet_claims_wallet_type_claimed;
DROP INDEX IF EXISTS faucet_claims_wallet_address_claimed_at;
DROP INDEX IF EXISTS idx_faucet_claims_wallet;
DROP INDEX IF EXISTS faucet_claims_wallet_address;
DROP INDEX IF EXISTS idx_faucet_claims_status;
DROP INDEX IF EXISTS faucet_claims_status;

ANALYZE faucet_claims;
