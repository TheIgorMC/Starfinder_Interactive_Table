# Rules Data Pipeline — Archives of Nethys (aonsrd.com)

No public API exists for SF1e AoN. Data must be imported once and cached
locally, not fetched live per request.

## Approach
1. **Crawl** category index pages (Classes, Feats, Equipment, Races, Rules,
   Skills, Spells, Themes, Vehicles) to enumerate all item URLs.
2. **Scrape** each item detail page, extract structured fields (name,
   description, prerequisites, stats, source book) into JSON.
3. **Normalize** into DB tables (one table per category, shared `sources`
   table for book references, since the user owns physical copies and
   licensing is respected via AoN's own OGL/Community Use terms).
4. **Store** as seed data in `/mnt/data_ssd/nas_share/SIT/aon-cache/` (raw
   JSON) and import into Postgres on backend startup/migration.
5. **Re-run** the crawl periodically (manual trigger) to pick up errata/new
   books — site changelog shows infrequent updates, no need for automation.

## Respecting the source
- Attribute content per AoN/Paizo Community Use Policy — link back to
  source page per item where feasible.
- This is for personal/private use with owned physical rulebooks, not
  redistribution.

## Suggested first-pass scope for iteration 1
Start narrow, expand later:
- Classes + archetypes
- Feats
- Equipment (weapons, armor, gear)
- Races/themes
- Core rules glossary (conditions, actions)

Spells and full setting/lore data can follow in iteration 2 once the
scraper/import pattern is proven.
