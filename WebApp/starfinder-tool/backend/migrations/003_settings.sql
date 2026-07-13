-- 003_settings.sql — generic key/value store for GM-configured app settings
-- (e.g. which sourcebooks the table owns, for the compendium's default filter)

CREATE TABLE IF NOT EXISTS settings (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL DEFAULT 'null',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
