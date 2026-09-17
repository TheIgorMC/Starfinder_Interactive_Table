-- 010_aon_review.sql — manual hand-validation tracking for aon_entries.
-- The AI import/parse pipeline (Foundry import + AoN scrape + mechanics
-- parser) is good enough to bootstrap from but not trusted blindly; this
-- lets a GM work through every entry against its AoN page and record the
-- verdict, independent of re-running the importer (which would just
-- overwrite these columns' siblings, not these).
ALTER TABLE aon_entries ADD COLUMN IF NOT EXISTS review_status TEXT NOT NULL DEFAULT 'unreviewed';
-- 'unreviewed' | 'approved' | 'flagged'
ALTER TABLE aon_entries ADD COLUMN IF NOT EXISTS review_notes TEXT NOT NULL DEFAULT '';
ALTER TABLE aon_entries ADD COLUMN IF NOT EXISTS reviewed_by TEXT NOT NULL DEFAULT '';
ALTER TABLE aon_entries ADD COLUMN IF NOT EXISTS reviewed_at TIMESTAMPTZ;

CREATE INDEX IF NOT EXISTS aon_entries_review_status_idx ON aon_entries (review_status);
