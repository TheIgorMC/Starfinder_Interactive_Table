-- 009_game_sessions.sql — session planning: a GM-facing container tying
-- together which lore (campaign_entries — events/locations/NPCs/factions/
-- objects), media (maps/mood images/tokens/portraits), and prebuilt battle
-- encounters (battle_sessions) are relevant to a specific table night.
--
-- Deliberately its own table rather than another campaign_entries `type`:
-- a session needs a lifecycle (planned/active/completed) and multi-links to
-- two other tables (media, battle_sessions) that campaign_links can't reach
-- (it only connects campaign_entries to itself).
--
-- "game session" (a planning container for a table night) vs. "battle
-- session" (`battle_sessions` — a single encounter's grid+tokens, what the
-- rest of the app just calls "session"/"encounter"): a game session can
-- plan to use several battle sessions. Kept the longer name specifically to
-- avoid colliding with the existing `session:*` WS broadcast types.

CREATE TABLE IF NOT EXISTS game_sessions (
  id             SERIAL PRIMARY KEY,
  name           TEXT NOT NULL,
  session_date   TEXT NOT NULL DEFAULT '',   -- freeform, real-world or in-game
  summary        TEXT NOT NULL DEFAULT '',
  notes          TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'planned' CHECK (status IN ('planned', 'active', 'completed')),
  filter_enabled BOOLEAN NOT NULL DEFAULT true, -- GM can turn off auto-filtering while active without ending it
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Only one session can be active at a time — every row that IS active has
-- the same indexed value, so a second one collides with the unique index.
CREATE UNIQUE INDEX IF NOT EXISTS game_sessions_single_active
  ON game_sessions (status) WHERE status = 'active';

CREATE TABLE IF NOT EXISTS game_session_entries (
  session_id INT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  entry_id   INT NOT NULL REFERENCES campaign_entries(id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, entry_id)
);

CREATE TABLE IF NOT EXISTS game_session_media (
  session_id INT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  media_id   INT NOT NULL REFERENCES media(id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, media_id)
);

CREATE TABLE IF NOT EXISTS game_session_encounters (
  session_id        INT NOT NULL REFERENCES game_sessions(id) ON DELETE CASCADE,
  battle_session_id INT NOT NULL REFERENCES battle_sessions(id) ON DELETE CASCADE,
  PRIMARY KEY (session_id, battle_session_id)
);
