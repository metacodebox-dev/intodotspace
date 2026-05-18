-- Beta Access Audit Table
-- 
-- This table is for audit purposes only.
-- The source of truth for access grants is Redis.
-- This table logs all successful redemptions for compliance and debugging.

-- Create beta_access table for audit
CREATE TABLE IF NOT EXISTS beta_access (
    id SERIAL PRIMARY KEY,
    
    -- Code information
    code VARCHAR(32) NOT NULL,
    code_normalized VARCHAR(32) NOT NULL,
    
    -- Wallet that redeemed the code
    wallet_address VARCHAR(64) NOT NULL,
    
    -- Redemption metadata
    redeemed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    ip_hash VARCHAR(32), -- Hashed for privacy
    
    -- Token info (hash only, not the actual token)
    token_hash VARCHAR(128),
    token_expires_at TIMESTAMP WITH TIME ZONE,
    
    -- Audit fields
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    
    -- Constraints
    CONSTRAINT uq_beta_code_normalized UNIQUE (code_normalized),
    CONSTRAINT uq_beta_wallet UNIQUE (wallet_address)
);

-- Indexes for queries
CREATE INDEX IF NOT EXISTS idx_beta_access_wallet ON beta_access(wallet_address);
CREATE INDEX IF NOT EXISTS idx_beta_access_redeemed_at ON beta_access(redeemed_at);
CREATE INDEX IF NOT EXISTS idx_beta_access_code_normalized ON beta_access(code_normalized);

-- Add comment
COMMENT ON TABLE beta_access IS 'Audit log for beta code redemptions. Source of truth is Redis.';
