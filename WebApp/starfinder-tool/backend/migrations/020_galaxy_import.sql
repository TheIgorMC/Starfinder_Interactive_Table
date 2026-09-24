-- 020_galaxy_import.sql — GalaxyGen project import (Docs/10-galaxy-mapgen.md)
-- and its link into the Campaign lore wiki.
--
-- galaxy_projects holds the raw GalaxyGen project JSON verbatim (systems,
-- sectors, factions, actors, organizations, companies, shipModels,
-- hyperlanes, ...) as one blob per import — SIT never edits this, it's a
-- read-only reference the GM re-imports wholesale to update. Only the most
-- recently imported project is considered "current" (single row kept in
-- practice, enforced in the route layer, not here).
CREATE TABLE IF NOT EXISTS galaxy_projects (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  seed TEXT,
  imported_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  data JSONB NOT NULL
);

-- A campaign_entries row (location/npc/faction/...) can optionally point at
-- the galaxy entity it corresponds to — a typed ref like "system:kreel-1",
-- "faction:milly-family", "actor:<slug>", "organization:<slug>",
-- "company:<slug>". Entities that only exist in the galaxy sim (the vast
-- majority — background actors, uncurated systems) get no campaign_entries
-- row at all; this column is purely the link for the ones that do.
ALTER TABLE campaign_entries ADD COLUMN IF NOT EXISTS galaxy_ref TEXT;
