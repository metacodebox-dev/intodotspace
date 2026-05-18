-- Competition system tables
-- Supports dynamic competition management with configurable rewards

-- Competitions table
CREATE TABLE IF NOT EXISTS competitions (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  description TEXT,
  prize_pool VARCHAR(100) NOT NULL,
  reward_breakdown VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'upcoming' CHECK (status IN ('upcoming', 'live', 'ended')),
  start_date TIMESTAMPTZ NOT NULL,
  end_date TIMESTAMPTZ NOT NULL,
  created_by VARCHAR(100),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Per-rank reward configuration
CREATE TABLE IF NOT EXISTS competition_rewards (
  id BIGSERIAL PRIMARY KEY,
  competition_id BIGINT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  reward VARCHAR(255) NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(competition_id, rank)
);

-- Frozen leaderboard results for ended competitions
CREATE TABLE IF NOT EXISTS competition_leaderboard (
  id BIGSERIAL PRIMARY KEY,
  competition_id BIGINT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL,
  wallet_address VARCHAR(100) NOT NULL,
  username VARCHAR(100),
  points BIGINT NOT NULL DEFAULT 0,
  reward VARCHAR(255),
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(competition_id, rank)
);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_competitions_status ON competitions(status);
CREATE INDEX IF NOT EXISTS idx_competitions_dates ON competitions(start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_competition_rewards_competition_id ON competition_rewards(competition_id);
CREATE INDEX IF NOT EXISTS idx_competition_leaderboard_competition_id ON competition_leaderboard(competition_id);
