-- 017_drop_music_source_url.sql — undoes 016. The Suno-page auto-resolver
-- this backed turned out unworkable (Suno never exposes a real audio URL
-- to an unauthenticated request, by design), so there's no more source
-- page distinct from a track's own url worth keeping around.
ALTER TABLE media DROP COLUMN IF EXISTS source_url;
