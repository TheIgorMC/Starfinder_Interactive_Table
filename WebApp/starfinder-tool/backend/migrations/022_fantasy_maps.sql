-- 022_fantasy_maps.sql — Fantasy Map Generator (/fantasy, Docs/16-fantasy-maps.md).
-- Each map is one JSON document (terrain grid, rivers, settlements, roads,
-- points of interest, currency), edited whole like the galaxy project and
-- saved with the same optimistic `version` check (409 on a stale base).
CREATE TABLE IF NOT EXISTS fantasy_maps (
  id         SERIAL PRIMARY KEY,
  name       TEXT NOT NULL DEFAULT 'Untitled region',
  data       JSONB NOT NULL,
  version    INTEGER NOT NULL DEFAULT 1,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- pictures attached to fantasy places live in the media library too
ALTER TABLE media DROP CONSTRAINT IF EXISTS media_category_check;
ALTER TABLE media ADD CONSTRAINT media_category_check
  CHECK (category IN ('map', 'mood', 'token', 'portrait', 'music', 'sfx', 'fantasy'));
