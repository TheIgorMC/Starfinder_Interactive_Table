-- 015_music.sql — music/SFX support in the existing media library: tracks
-- can now be an uploaded audio file (as before, via `filename`) OR a link
-- (YouTube, Suno, a direct audio URL, ...) via the new `url` column, plus a
-- per-track loop preference the GM can toggle.

ALTER TABLE media ALTER COLUMN filename DROP NOT NULL;
ALTER TABLE media ADD COLUMN IF NOT EXISTS url TEXT;
ALTER TABLE media ADD COLUMN IF NOT EXISTS loop BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE media DROP CONSTRAINT IF EXISTS media_category_check;
ALTER TABLE media ADD CONSTRAINT media_category_check
  CHECK (category IN ('map', 'mood', 'token', 'portrait', 'music', 'sfx'));

ALTER TABLE media DROP CONSTRAINT IF EXISTS media_source_check;
ALTER TABLE media ADD CONSTRAINT media_source_check
  CHECK (filename IS NOT NULL OR url IS NOT NULL);
