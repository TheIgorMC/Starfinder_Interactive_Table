-- 011_campaign_tgn_import.sql — lets campaign_entries be populated from a
-- Tangent (.tgn) campaign export (see src/tgn-import.js), tracked by the
-- entry's original id inside that file so a re-import doesn't create
-- duplicates. Also adds 'quest' as a type: Tangent's QUEST column doesn't
-- map cleanly onto the existing 'event' type (a quest isn't a point in
-- time, it's an ongoing thread with its own status).
ALTER TABLE campaign_entries ADD COLUMN IF NOT EXISTS external_id TEXT UNIQUE;

ALTER TABLE campaign_entries DROP CONSTRAINT IF EXISTS campaign_entries_type_check;
ALTER TABLE campaign_entries ADD CONSTRAINT campaign_entries_type_check
  CHECK (type IN ('event', 'location', 'npc', 'faction', 'object', 'quest'));
