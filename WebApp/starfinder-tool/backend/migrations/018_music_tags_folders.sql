-- 018_music_tags_folders.sql — let a music/SFX track carry free-form tags
-- (for cross-cutting filtering — "combat", "tense", "tavern") and a single
-- flat folder (for grouping — "Session 3", "Boss themes"). Both are
-- meaningful for any media category, not just music, so they live on the
-- shared `media` table rather than a music-only one.
ALTER TABLE media ADD COLUMN IF NOT EXISTS tags TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE media ADD COLUMN IF NOT EXISTS folder TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS media_folder_idx ON media (folder) WHERE folder <> '';
