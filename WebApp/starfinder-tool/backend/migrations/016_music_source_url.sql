-- 016_music_source_url.sql — keep the original page link (e.g. a Suno share
-- page) alongside the resolved, directly-playable `url` a link track was
-- created from, so the GM can still get back to the source.
ALTER TABLE media ADD COLUMN IF NOT EXISTS source_url TEXT;
