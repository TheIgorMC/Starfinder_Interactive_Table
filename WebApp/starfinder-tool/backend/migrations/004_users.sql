-- 004_users.sql — simple login accounts: one GM, one per player.
-- A player account is linked to exactly one character; the GM account
-- isn't linked to any and can see/manage everything.

CREATE TABLE IF NOT EXISTS users (
  id            SERIAL PRIMARY KEY,
  username      TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL CHECK (role IN ('gm', 'player')),
  character_id  INT REFERENCES characters(id) ON DELETE SET NULL,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- a player account may only ever be linked to one character
CREATE UNIQUE INDEX IF NOT EXISTS users_character_id_idx ON users (character_id) WHERE character_id IS NOT NULL;
