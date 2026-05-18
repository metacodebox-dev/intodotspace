CREATE TABLE IF NOT EXISTS comments (
  id BIGSERIAL PRIMARY KEY,
  market_id BIGINT NOT NULL,
  wallet_address VARCHAR(64) NOT NULL,
  text TEXT NOT NULL,
  stars INTEGER NOT NULL DEFAULT 0,
  report_count INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comments_market_id ON comments(market_id);
CREATE INDEX IF NOT EXISTS idx_comments_wallet_address ON comments(wallet_address);
CREATE INDEX IF NOT EXISTS idx_comments_market_status ON comments(market_id, status);

CREATE TABLE IF NOT EXISTS comment_stars (
  id BIGSERIAL PRIMARY KEY,
  comment_id BIGINT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  wallet_address VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_comment_stars_unique ON comment_stars(comment_id, wallet_address);
CREATE INDEX IF NOT EXISTS idx_comment_stars_comment_id ON comment_stars(comment_id);

CREATE TABLE IF NOT EXISTS comment_reports (
  id BIGSERIAL PRIMARY KEY,
  comment_id BIGINT NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  wallet_address VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_comment_reports_unique ON comment_reports(comment_id, wallet_address);
CREATE INDEX IF NOT EXISTS idx_comment_reports_comment_id ON comment_reports(comment_id);
