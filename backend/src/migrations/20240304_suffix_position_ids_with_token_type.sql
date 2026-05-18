-- Widen the id column to accommodate the :yes/:no suffix (44 + 4 = 48)
ALTER TABLE positions ALTER COLUMN id TYPE VARCHAR(48);

-- Append :yes or :no suffix to position IDs so YES and NO positions on the same
-- outcome get separate DB rows. Previously they shared the same on-chain PDA as the ID.
-- Only update IDs that don't already have a suffix.
UPDATE positions
SET id = id || ':' || token_type
WHERE id NOT LIKE '%:yes' AND id NOT LIKE '%:no';
