-- 007_aon_mechanics.sql — structured, machine-readable mechanics alongside
-- the existing free-text `data`. See backend/src/mechanics-schema.js for the
-- shape (targeting/range/area/duration/savingThrow/actions/requirements).
ALTER TABLE aon_entries ADD COLUMN IF NOT EXISTS mechanics JSONB NOT NULL DEFAULT '{}';
CREATE INDEX IF NOT EXISTS aon_entries_mechanics_idx ON aon_entries USING GIN (mechanics);
