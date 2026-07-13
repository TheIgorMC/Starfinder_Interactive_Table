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
4. **Store** as seed data in `aon-cache/` (raw JSON) and import into
   Postgres via a separate import step (not automatic on backend startup).
5. **Re-run** the crawl periodically (manual trigger) to pick up errata/new
   books — site changelog shows infrequent updates, no need for automation.

## Running it (local machine, not the Pi)

The scraper hits aonsrd.com directly, so it's run on your own machine —
never on the Pi. Only the validated output gets shipped there.

```
cd WebApp/starfinder-tool/backend
npm install

# 1. Scrape a category into ./aon-cache/<category>/*.json
# Visits the list page, then every item's detail page to pull its source
# book/page (needed for per-source filtering) — so this takes a few minutes
# per category, not a single instant request.
npm run scrape:aon -- feats

# useful while testing: --limit=N caps entry count, --skip-source skips the
# per-entry detail fetch (fast, but source will be blank), --delay=MS
# controls the pause between detail-page requests (default 200ms)
npm run scrape:aon -- feats --limit=10

# 2. Validate before it goes anywhere near the Pi
npm run validate:aon
# exits non-zero and lists every problem if anything's malformed

# 3. (optional) import into a local Postgres to sanity-check queries
DATABASE_URL=postgres://sf:sf@localhost:5432/sf npm run import:aon

# 4. Sync the validated cache to the Pi's data volume
rsync -av aon-cache/ orangepi@<pi-ip>:/mnt/data_ssd/nas_share/SIT/aon-cache/

# 5. On the Pi, import into the running stack's Postgres
DATABASE_URL=postgres://sf:<pw>@localhost:5432/sf npm run import:aon -- /mnt/data_ssd/nas_share/SIT/aon-cache
```

Every entry carries its source book in the top-level `source` field (e.g.
`"Starfinder Core Rulebook"`, `"Character Operations Manual"`) plus
`data.sourcePage` and `data.sourceUrl` (Paizo store link). `source` is
indexed (`002_aon_source_index.sql`) and exposed for filtering via the
backend's `/api/aon` route — see below.

Every entry's detail page is also fetched for its **full rules text**, not
just the short one-line blurb from the list page — e.g. a feat's complete
`Benefit`/`Prerequisites`/`Teamwork Benefit` text, a spell's full
`Description` plus `School`/`Range`/`Duration`/etc., a race's full traits
text, a class's flavor/key-ability/class-skills text. This is a generic
labeled-section parser (`fetchDetail()` in `scrape-aon.js`) that walks each
detail page's content block once and returns every `<b>Label</b>`/`<hN>`
section it finds; each category's `applyDetail(entry, sections)` then picks
the fields relevant to it — see the field list per category below. The
primary rules-text field is always `data.effect`.

### Implemented categories

Each category on aonsrd.com has its own page layout (this is a ~15-year-old
ASP.NET site, not a consistent API), so each one needs a small
`listEntries($, pageUrl)` parser added to `CATEGORIES` in
`backend/scripts/scrape-aon.js`. Implemented and verified so far:

- `feats` — 477 entries, table-based list page. `data.effect` = Benefit text,
  `data.prerequisites` = full Prerequisites text (list-page version was
  truncated), plus `data.teamworkBenefit`/`data.normal`/`data.special` when present
- `spells` — 615 entries, span-list-based list page. `data.effect` =
  Description text, plus `data.school`/`castingTime`/`range`/`area`/
  `duration`/`savingThrow`/`spellResistance`/`classes` when present
- `races` — 143 entries (Core / Core [Legacy] / Other species), table-based;
  ability scores/HP/size/source come straight from the list page, but the
  full racial traits text (`data.effect`) still needs a per-entry detail-page
  fetch — the list table alone doesn't have it
- `classes` — 14 entries (the 13 playable classes + Drone), just a link list
  on the index page; `data.effect` = flavor/key-ability-score/class-skills
  text (the level-progression table itself is skipped — it's tabular, not
  prose). One entry (`Drone`) has no `<b>Source</b>` line on its page in the
  expected place, so its `source` comes back empty — flagged here rather
  than silently guessed

Not yet implemented: Equipment (itself ~10 sub-categories — Weapons, Armor,
Augmentations, Technological Items, Magic Items, Hybrid Items, etc., each
with its own layout and often split further by proficiency/type), Themes,
Archetypes, core rules glossary (conditions, actions). Add these
incrementally the same way — fetch the real index page, find its list
markup, write a `listEntries` for it; `validate:aon`, `import:aon`, and the
`/api/aon` search endpoint are already category-agnostic and need no changes
as categories are added.

`aon-cache/` is git-ignored — scraped AoN content isn't committed to the
repo (see licensing note below).

## Querying by source

`GET /api/aon?category=feat&source=Starfinder+Core+Rulebook&q=adaptive` —
filters by category, exact source book, and name substring (any combination,
all optional), capped at 500 results.
`GET /api/aon/sources?category=feat` — distinct source books with counts,
for building a filter dropdown.
`GET /api/aon/categories` — distinct categories with counts.

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
