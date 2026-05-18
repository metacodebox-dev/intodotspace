-- Migration: Change order_id from INTEGER to BIGINT
-- Date.now() returns millisecond timestamps (e.g., 1772278376433) which exceed INTEGER max (2,147,483,647)

ALTER TABLE orders
ALTER COLUMN order_id TYPE BIGINT;
