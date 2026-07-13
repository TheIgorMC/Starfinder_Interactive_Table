-- 005_media.sql — GM media library (maps, mood images, token/portrait art)
-- and freeform homebrew/lore entries.

CREATE TABLE IF NOT EXISTS media (
  id            SERIAL PRIMARY KEY,
  category      TEXT NOT NULL CHECK (category IN ('map', 'mood', 'token', 'portrait')),
  filename      TEXT NOT NULL,           -- stored name on disk, under uploads/<category>/
  original_name TEXT NOT NULL DEFAULT '',
  label         TEXT NOT NULL DEFAULT '',
  uploaded_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS media_category_idx ON media (category);

CREATE TABLE IF NOT EXISTS homebrew_entries (
  id         SERIAL PRIMARY KEY,
  category   TEXT NOT NULL,             -- freeform, GM-defined: 'npc', 'lore', 'item', ...
  name       TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  image_id   INT REFERENCES media(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS homebrew_category_idx ON homebrew_entries (category);

ALTER TABLE tokens ADD COLUMN IF NOT EXISTS image_url TEXT NOT NULL DEFAULT '';
ALTER TABLE characters ADD COLUMN IF NOT EXISTS portrait_url TEXT NOT NULL DEFAULT '';
