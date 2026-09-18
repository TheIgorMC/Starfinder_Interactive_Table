-- 013_drop_campaign_summary.sql — campaign_entries.summary was a
-- hand-maintained one-line blurb, separate from `body`, that routinely
-- drifted stale after an edit and (for tgn-imported entries) had a history
-- of buggy auto-generation. Removed for good: any short preview needed now
-- (e.g. the AI-draft assistant's context index) is derived from `body` on
-- the spot instead (see tgn-import.js's bodyExcerpt()) — nothing to store,
-- nothing to go stale.
ALTER TABLE campaign_entries DROP COLUMN IF EXISTS summary;
