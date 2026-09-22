-- 019_campaign_sort_order.sql — an optional manual position for a campaign
-- entry among its siblings (same parent in the tree, or same type at the
-- root). NULL (the default — every existing row) means "not manually
-- ordered yet": those entries sort naturally by name. Once a GM reorders
-- any entry in a sibling group, the whole group gets explicit values
-- (0, 1, 2, ...) so the chosen order sticks; a still-NULL entry sorts
-- after every explicitly-ordered one in that group until it's touched too.
ALTER TABLE campaign_entries ADD COLUMN IF NOT EXISTS sort_order INT;
