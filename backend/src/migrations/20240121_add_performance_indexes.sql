-- Migration: add_performance_indexes
-- Description: Production-grade database indexes for 100k+ users
-- Date: 2024-01-21
-- These indexes optimize orderbook queries and WebSocket performance

-- Indexes for orderbook queries (most frequent queries)
CREATE INDEX IF NOT EXISTS idx_orders_market_outcome_status 
ON orders(market_id, outcome_id, status) 
WHERE status IN ('open', 'partially_filled', 'pending');

-- Index for price-based sorting (orderbook aggregation)
CREATE INDEX IF NOT EXISTS idx_orders_market_outcome_price 
ON orders(market_id, outcome_id, price DESC, created_at ASC)
WHERE status IN ('open', 'partially_filled', 'pending') AND type = 'limit';

-- Index for user orders (user-specific queries)
CREATE INDEX IF NOT EXISTS idx_orders_user_status 
ON orders(user_id, status, created_at DESC);

-- Index for pending execution orders
CREATE INDEX IF NOT EXISTS idx_orders_pending_execution 
ON orders(user_id, type, status)
WHERE type = 'limit' AND status IN ('partially_filled', 'filled');

-- Index for order matching (buy orders)
CREATE INDEX IF NOT EXISTS idx_orders_buy_matching 
ON orders(market_id, outcome_id, side, price DESC, created_at ASC)
WHERE side = 'buy' AND status IN ('open', 'partially_filled', 'pending');

-- Index for order matching (sell orders)
CREATE INDEX IF NOT EXISTS idx_orders_sell_matching 
ON orders(market_id, outcome_id, side, price ASC, created_at ASC)
WHERE side = 'sell' AND status IN ('open', 'partially_filled', 'pending');

-- Composite index for market queries
CREATE INDEX IF NOT EXISTS idx_orders_market_composite 
ON orders(market_id, outcome_id, side, type, status, created_at);

-- Index for recent orders (for trade history)
CREATE INDEX IF NOT EXISTS idx_orders_recent 
ON orders(created_at DESC, market_id, outcome_id)
WHERE status = 'filled';

-- Analyze tables after creating indexes
ANALYZE orders;



