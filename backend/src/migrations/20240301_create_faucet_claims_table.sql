CREATE TABLE IF NOT EXISTS faucet_claims (
    id BIGSERIAL PRIMARY KEY,
    wallet_address VARCHAR(64) NOT NULL,
    amount BIGINT NOT NULL DEFAULT 500000000,
    tx_signature VARCHAR(128),
    status VARCHAR(20) NOT NULL DEFAULT 'completed' CHECK (status IN ('pending', 'completed', 'failed')),
    claimed_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    created_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_faucet_claims_wallet ON faucet_claims(wallet_address);
CREATE INDEX IF NOT EXISTS idx_faucet_claims_wallet_claimed ON faucet_claims(wallet_address, claimed_at DESC);
CREATE INDEX IF NOT EXISTS idx_faucet_claims_status ON faucet_claims(status)
