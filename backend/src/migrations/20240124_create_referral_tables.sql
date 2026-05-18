-- Migration: Create referral system tables
-- Optimized for 1 million+ users with proper indexing

-- Create space_points table for tracking user points and levels
CREATE TABLE IF NOT EXISTS space_points (
    id BIGSERIAL PRIMARY KEY,
    wallet_address VARCHAR(64) NOT NULL UNIQUE,
    referral_code VARCHAR(16) NOT NULL UNIQUE,
    total_points INTEGER NOT NULL DEFAULT 0,
    referral_points INTEGER NOT NULL DEFAULT 0,
    trading_points INTEGER NOT NULL DEFAULT 0,
    bonus_points INTEGER NOT NULL DEFAULT 0,
    level VARCHAR(20) NOT NULL DEFAULT 'bronze' CHECK (level IN ('bronze', 'silver', 'gold', 'platinum', 'diamond')),
    referred_by VARCHAR(64),
    total_referrals INTEGER NOT NULL DEFAULT 0,
    is_new_user BOOLEAN NOT NULL DEFAULT true,
    last_daily_bonus_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Create referrals table for tracking individual referrals
CREATE TABLE IF NOT EXISTS referrals (
    id BIGSERIAL PRIMARY KEY,
    referrer_wallet VARCHAR(64) NOT NULL,
    referred_wallet VARCHAR(64) NOT NULL UNIQUE,
    referral_code VARCHAR(16) NOT NULL,
    points_awarded INTEGER NOT NULL DEFAULT 0,
    status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'expired')),
    completed_at TIMESTAMP WITH TIME ZONE,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Performance indexes for space_points
CREATE INDEX IF NOT EXISTS idx_space_points_wallet ON space_points(wallet_address);
CREATE INDEX IF NOT EXISTS idx_space_points_referral_code ON space_points(referral_code);
CREATE INDEX IF NOT EXISTS idx_space_points_total_points ON space_points(total_points DESC);
CREATE INDEX IF NOT EXISTS idx_space_points_level_points ON space_points(level, total_points DESC);
CREATE INDEX IF NOT EXISTS idx_space_points_referred_by ON space_points(referred_by) WHERE referred_by IS NOT NULL;

-- Performance indexes for referrals
CREATE INDEX IF NOT EXISTS idx_referrals_referrer ON referrals(referrer_wallet);
CREATE INDEX IF NOT EXISTS idx_referrals_referred ON referrals(referred_wallet);
CREATE INDEX IF NOT EXISTS idx_referrals_code ON referrals(referral_code);
CREATE INDEX IF NOT EXISTS idx_referrals_referrer_status ON referrals(referrer_wallet, status);
CREATE INDEX IF NOT EXISTS idx_referrals_created ON referrals(created_at DESC);

COMMENT ON TABLE space_points IS 'Stores user SpacePoints, levels, and referral codes - optimized for 1M+ users';
COMMENT ON TABLE referrals IS 'Tracks individual referral relationships and points awarded';
COMMENT ON INDEX idx_space_points_total_points IS 'Optimized for leaderboard queries';
COMMENT ON INDEX idx_referrals_referrer_status IS 'Optimized for referral stats queries';
