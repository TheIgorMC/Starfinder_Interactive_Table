-- 008_character_sheet.sql — fields needed for the full character sheet
-- (credits/currency, active conditions). skills/feats/spells/equipment
-- already exist as JSONB from 001_init.sql — this only widens what the
-- Hephaistos importer puts in them (see backend/src/hephaistos.js), no
-- schema change needed for those.
ALTER TABLE characters
  ADD COLUMN IF NOT EXISTS credits INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS conditions JSONB NOT NULL DEFAULT '{}';
