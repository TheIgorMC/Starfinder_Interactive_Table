-- 012_character_lore_link.sql — an optional link from a statted character
-- (characters — PCs and any GM-made NPC with a full sheet: HP/SP/RP,
-- abilities, equipment, usable on the battle map) to its campaign wiki
-- entry (campaign_entries, type='npc' — narrative-only: name, portrait,
-- prose). The two are deliberately separate concepts: a wiki NPC doesn't
-- need a statblock to exist (most never fight), and a statted NPC doesn't
-- need a wiki page (a one-off mook). This is purely optional, one-way,
-- and nullable — set only when a GM wants "this lore character's stats
-- are over there."
ALTER TABLE characters ADD COLUMN IF NOT EXISTS lore_entry_id INT REFERENCES campaign_entries(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS characters_lore_entry_idx ON characters (lore_entry_id) WHERE lore_entry_id IS NOT NULL;
