-- Snapshot of each user's total points when a competition goes live.
-- Used to calculate competition-period-only points (current - snapshot).

CREATE TABLE IF NOT EXISTS competition_point_snapshots (
  id BIGSERIAL PRIMARY KEY,
  competition_id BIGINT NOT NULL REFERENCES competitions(id) ON DELETE CASCADE,
  wallet_address VARCHAR(64) NOT NULL,
  points_at_start BIGINT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(competition_id, wallet_address)
);

CREATE INDEX IF NOT EXISTS idx_comp_snapshots_competition_id ON competition_point_snapshots(competition_id);
