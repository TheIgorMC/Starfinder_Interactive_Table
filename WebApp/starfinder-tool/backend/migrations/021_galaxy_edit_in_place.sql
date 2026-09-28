-- 021_galaxy_edit_in_place.sql — the galaxy project is now edited in place
-- by SIT itself (the Galaxy Editor in the GM console, and the galaxy MCP
-- tools), no longer only re-imported wholesale. `version` bumps on every
-- save and is the optimistic-concurrency check (a save based on an older
-- version is rejected instead of silently overwriting newer edits).
ALTER TABLE galaxy_projects ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE galaxy_projects ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT now();
