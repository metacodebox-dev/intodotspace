-- Migration: add_redeemed_shares_to_positions
-- Description: Persist the share count from a successful redeem_shares so the
--              resolved-positions tab can show historical payouts after the
--              redemption flow zeroes `shares` and flips `is_open` to false.
-- Date: 2026-04-28

ALTER TABLE positions
ADD COLUMN IF NOT EXISTS redeemed_shares VARCHAR(255) DEFAULT NULL;

COMMENT ON COLUMN positions.redeemed_shares IS 'Shares (6-dec base units, BigInt-as-string) the user redeemed at market resolution. Persists after `shares` is zeroed by the redemption flow so the resolved-positions tab can still display historical payouts. NULL = never redeemed.';
