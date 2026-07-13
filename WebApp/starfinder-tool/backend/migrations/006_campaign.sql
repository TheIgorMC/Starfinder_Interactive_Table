-- 006_campaign.sql — replaces homebrew_entries with a proper campaign
-- system: typed entries (events/locations/npcs/factions/objects) plus
-- relationships between them. Media (images) are an optional attachment,
-- not the point — an entry can be pure lore text with no image at all.
-- Safe to drop homebrew_entries: no real deployment ever ran a migration
-- against it (this table was added the same week it's being replaced).

DROP TABLE IF EXISTS homebrew_entries;

CREATE TABLE IF NOT EXISTS campaign_entries (
  id                SERIAL PRIMARY KEY,
  type              TEXT NOT NULL CHECK (type IN ('event', 'location', 'npc', 'faction', 'object')),
  name              TEXT NOT NULL,
  summary           TEXT NOT NULL DEFAULT '',
  body              TEXT NOT NULL DEFAULT '',
  image_id          INT REFERENCES media(id) ON DELETE SET NULL,
  event_date        TEXT NOT NULL DEFAULT '',   -- freeform in-game date, only meaningful for type='event'
  visible_to_players BOOLEAN NOT NULL DEFAULT false,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at        TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS campaign_entries_type_idx ON campaign_entries (type);

-- Directional, but the API surfaces a link from both ends (e.g. "member of"
-- from NPC->faction also shows as an incoming link on the faction's page).
CREATE TABLE IF NOT EXISTS campaign_links (
  id       SERIAL PRIMARY KEY,
  from_id  INT NOT NULL REFERENCES campaign_entries(id) ON DELETE CASCADE,
  to_id    INT NOT NULL REFERENCES campaign_entries(id) ON DELETE CASCADE,
  relation TEXT NOT NULL DEFAULT '',
  UNIQUE (from_id, to_id, relation)
);
