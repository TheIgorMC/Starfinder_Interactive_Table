-- 002_aon_source_index.sql — index for per-source filtering of aon_entries

CREATE INDEX IF NOT EXISTS aon_entries_source_idx ON aon_entries (source);
