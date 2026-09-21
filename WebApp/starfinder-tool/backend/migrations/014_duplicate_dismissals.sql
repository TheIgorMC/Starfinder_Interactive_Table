-- 014_duplicate_dismissals.sql — lets a GM tell the duplicates tool "these
-- are two different things, not the same entry twice" for a cross-type
-- group (e.g. a faction and a quest legitimately named after each other),
-- so it stops resurfacing that exact pair every time the panel opens.
-- Keyed by the group's sorted entry ids: if the same set of ids groups
-- together again later, it stays dismissed; if the set changes (an entry
-- added/removed), it's a different group and needs a fresh look.
CREATE TABLE IF NOT EXISTS campaign_duplicate_dismissals (
  id         SERIAL PRIMARY KEY,
  entry_ids  INT[] NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
