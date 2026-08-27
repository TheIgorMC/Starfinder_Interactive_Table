# Rules Data Pipeline — Archives of Nethys (aonsrd.com)

No public API exists for SF1e AoN. Data must be imported once and cached
locally, not fetched live per request.

**Prefer the Foundry import (below) over scraping for feats/spells/races/
classes** — same license basis, far higher fidelity (structured
range/duration/save/damage/prerequisites instead of prose to parse, plus a
hand-authored `modifiers` array of pre-designed bonuses), and no scraping
required. The AoN scraper below remains the only option for categories
Foundry doesn't cover yet (Equipment, Themes, ...).

## Approach
1. **Crawl** category index pages (Classes, Feats, Equipment, Races, Rules,
   Skills, Spells, Themes, Vehicles) to enumerate all item URLs.
2. **Scrape** each item detail page, extract structured fields (name,
   description, prerequisites, stats, source book) into JSON.
3. **Derive** structured mechanics (targets/range/area/duration/saving
   throw/requirements) from those fields — see "Structured mechanics" below.
4. **Normalize** into DB tables (one table per category, shared `sources`
   table for book references, since the user owns physical copies and
   licensing is respected via AoN's own OGL/Community Use terms).
5. **Store** as seed data in `aon-cache/` (raw JSON) and import into
   Postgres via a separate import step (not automatic on backend startup).
6. **Re-run** the crawl periodically (manual trigger) to pick up errata/new
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

# 2. Derive structured mechanics (targets/range/duration/etc.) from the
# scraped fields — pure function of `data`, safe to re-run any time you
# improve the parser without re-scraping. See "Structured mechanics" below.
npm run derive:aon

# 3. Validate before it goes anywhere near the Pi
npm run validate:aon
# exits non-zero and lists every problem if anything's malformed

# 4. (optional) import into a local Postgres to sanity-check queries
DATABASE_URL=postgres://sf:sf@localhost:5432/sf npm run import:aon

# 5. Sync the validated cache to the Pi's data volume — this is the same
# host path docker-compose.yml bind-mounts into the backend container at
# /app/aon-cache, so nothing needs restarting for the container to see it.
rsync -av aon-cache/ orangepi@<pi-ip>:/mnt/data_ssd/nas_share/SIT/aon-cache/

# 6. On the Pi, import into the running stack's Postgres — run *inside*
# the backend container, not on the Pi's host shell: the container already
# has DATABASE_URL pointed at the `db` service (Postgres isn't exposed to
# the host at all — there's no `ports:` entry for it in docker-compose.yml),
# and /app/aon-cache is where the cache landed in step 5.
cd /mnt/emmc/stacks/starfinder-tool   # wherever the stack's docker-compose.yml lives
docker compose exec backend node scripts/import-aon-cache.js /app/aon-cache
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

## Structured mechanics

Alongside the free-text `data` (rules prose), every `aon_entries` row also
has a `mechanics` JSONB column (`007_aon_mechanics.sql`) — a machine-readable
categorization of the entry's actual game mechanics, for a future character
engine to consume directly instead of re-parsing prose at runtime. Example:
Magic Missile's `data.targets` is the prose `"up to three creatures, no two
of which can be more than 15 ft. apart"`; its `mechanics.targeting` is:

```json
{
  "type": "creature",
  "count": { "min": 1, "max": 3 },
  "constraints": [{ "type": "maxDistanceBetweenTargets", "value": 15, "unit": "ft" }]
}
```

The full shape (`targeting`/`range`/`area`/`duration`/`savingThrow`/
`spellResistance`/`actions`/`requirements`/`tags`) is documented in
`backend/src/mechanics-schema.js`, along with `validateMechanics()` (a loose
structural check — `kind`/`type` accept any string, so new mechanical
concepts don't need a migration, but recognized shapes like `and`/`or`/`raw`
conditions are checked) and `normalizeMechanics()` (fills in defaults).

`backend/src/mechanics-parser.js` is the **best-effort, conservative**
extractor that turns the already-scraped scalar fields into that shape:
spells' `range`/`area`/`duration`/`savingThrow`/`spellResistance`/`targets`,
and feats' `prerequisites` (`Str 13` → `{type:"abilityScore",ability:"str",
min:13}`, `Base attack bonus +1` → `{type:"babMin",value:1}`, a bare name →
`{type:"hasFeat",name}`). It never guesses at free-form Benefit/Description
prose — anything it can't confidently parse is kept as a `raw` fallback
(`{type:"raw", text}` / `{unit:"raw", raw}`) so no information is lost, and
nothing is silently wrong. `npm run derive:aon` runs it over every cached
entry; re-run it any time the parser improves, no re-scrape needed.

This is a categorization layer, not a rules engine — it doesn't apply
anything to a character automatically (see the README's "On automatic rule
effects" section). It's the structured data that engine would read from.

## Foundry import (primary source — 8,921 entries across 26 categories)

A local checkout of the community [FoundryVTT Starfinder
system](https://github.com/foundryvtt-starfinder/foundryvtt-starfinder)
(MIT-licensed code, Paizo Community Use Policy content — same legal basis
as scraping AoN) ships every rulebook item as structured JSON: range/area/
duration/save/damage are already-enumerated fields, not prose to guess at,
and every item carries a hand-authored `modifiers` array — pre-designed,
formula-capable bonuses (e.g. Deadly Aim's `"max(1, floor(@attributes.
baseAttackBonus.value/2))"`) that are exactly the parametrized effect a
character engine needs. This is the primary data source now — the AoN
scraper above is a fallback for categories Foundry doesn't cover.

### Running it

```bash
cd WebApp/starfinder-tool/backend
npm install   # cheerio is used here too, for stripping Foundry's rich text

# Reads Docs/ReferenceFoundry/foundryvtt-starfinder-development/src/items
# (a gitignored local checkout — see .gitignore) into aon-cache/, in the
# same shape scrape-aon.js produces. No arguments = every folder listed
# below. Override the source with --src=path if your checkout lives
# elsewhere; pass specific folder names to import a subset, e.g.:
npm run import:foundry -- feats spells races classes
npm run import:foundry               # everything (8,921 entries, ~10s)

# Then the same downstream steps as scraping:
npm run validate:aon
DATABASE_URL=postgres://sf:sf@localhost:5432/sf npm run import:aon
```

Do **not** also run `derive:aon` on Foundry-imported entries — `foundry-
import.js` already populates `mechanics` directly from Foundry's structured
fields (marking each entry `mechanicsSource: "foundry"`), and `derive-
mechanics.js` skips those rather than overwrite them with its own,
lower-fidelity regex-based guess (that fallback parser only still matters
for anything imported via the AoN scraper instead). Don't run both
importers for the same category+name — whichever runs `import:aon` last
wins (the `aon_entries` unique key is `(category, name)`).

`foundry-import.js` also normalizes source book abbreviations (`CRB` →
`Starfinder Core Rulebook`, `COM` → `Character Operations Manual`, `CRB.
277` and `CRB pg. 42` and `CRB, p. 60` all → the same book+page, ...) so
the Compendium's source filter doesn't end up with duplicate buckets for
the same book across categories that format their `source` field
differently. Unrecognized codes (mostly adventure-path references, e.g.
`AP #36`) pass through as-is — extend `SOURCE_BOOKS` in `foundry-import.js`
if you spot one worth mapping.

### Category reference

Every category below is a Foundry `type` value, except where the same
`type` is reused for multiple concepts (Foundry uses `type: "feat"` for
actual feats *and* every class/racial/archetype/theme/universal feature;
`type: "effect"` for both Conditions and reusable Effects) — those are
split into distinct `category` values by source folder instead, via
`categoryFor()`/`FOLDER_CATEGORY_OVERRIDE` in `foundry-import.js` /
`import-foundry.js`, so a character engine can tell "a feat you chose" from
"a trait your race granted you automatically".

| Category | Count | Source folder | What it is |
|---|---:|---|---|
| `feat` | 431 | `feats` | Feats a player chooses |
| `spell` | 586 | `spells` | Spells |
| `race` | 190 | `races` | Playable species (+ variants) |
| `class` | 17 | `classes` | The 13 classes + Drone, etc. |
| `archetype` | 46 | `archetypes` | Archetype flavor + requirements |
| `theme` | 60 | `themes` | Themes (ability mod + theme skill) |
| `class-feature` | 2,148 | `class-features` | Per-level class features (Fighting Style, Gear Boost, ...) |
| `racial-feature` | 621 | `racial-features` | Racial traits (Constructed, Darkvision, ...) |
| `archetype-feature` | 248 | `archetype-features` | Archetype-granted features |
| `theme-feature` | 197 | `theme-features` | Theme Knowledge and level benefits |
| `universal-creature-rule` | 79 | `universal-creature-rules` | Monster special abilities (Grab, Trample, ...) — reference text, mostly for GM use |
| `condition` | 39 | `conditions` | Status conditions (Prone, Shaken, Staggered, ...) |
| `effect` | 56 | `effects` | Reusable buffs/debuffs not tied to a specific condition |
| `weapon` | 1,782 | `equipment` | Weapons |
| `armor` | 304 | `equipment` | Armor (light/heavy/power) — `type: "equipment"` items that have `system.armor` populated |
| `augmentation` | 500 | `equipment` | Cybernetics, biotech, magitech, personal upgrades |
| `technological` | 342 | `equipment` | Tech items |
| `magic` | 264 | `equipment` | Magic items |
| `consumable` | 252 | `equipment` | Serums, drugs, spell gems, ... |
| `hybrid` | 237 | `equipment` | Hybrid-tech items |
| `upgrade` | 166 | `equipment` | Armor upgrades |
| `fusion` | 119 | `equipment` | Weapon fusions |
| `goods` | 111 | `equipment` | General gear |
| `ammunition` | 55 | `equipment` | Ammunition |
| `shield` | 34 | `equipment` | Shields |
| `weaponAccessory` | 26 | `equipment` | Weapon accessories |
| `container` | 11 | `equipment` | Bags, cases, ... |
| `rule` | 335 | `rules` | Core rulebook reference glossary — Actions in Combat, Afflictions, Environment, Skills, Combat Basics, Character Advancement, Downtime, Galactic Trade, ... (46 chapters, one entry per page/topic within each) |
| `setting` | 67 | `setting` | Pact Worlds lore — deities and planets/locations, one entry each |
| `table` | 46 | `tables` | Random/reference tables (racial subtypes, critical hit/fumble effects, treasure) |

A handful of items (59 in `class-features`, 1 in `conditions`) are skipped
rather than crash — mostly drone chassis/mod items and one exotic
condition variant that don't fit any handled Foundry `type`; `import-
foundry.js` prints a skip count per folder so you can see this.

### Journal/table-shaped content (`rule`/`setting`/`table`)

Structurally different from every category above: `rules/` and `setting/`
are Foundry **Journal Entries**, not Items — `{ name, pages: [{ name,
type, text: { content: html } }] }`, core rulebook reference *prose*
(how actions work, environmental rules, deity/planet lore), not a
game-mechanical thing with a `system` block. `tables/` is a third shape
again, a Foundry **Roll Table** — `{ name, formula, results: [{ name,
range, weight }] }`.

`mapFoundryJournalPage()`/`mapFoundryRollTable()` in `foundry-import.js`
handle these (`import-foundry.js` branches per folder — see
`JOURNAL_FOLDER_CATEGORY`/`TABLE_FOLDERS`). One JournalEntry maps to
*several* Compendium entries, one per page (e.g. the "Actions in Combat"
chapter becomes "Standard Actions", "Move Actions", "Full Actions", ... as
separate entries under `data.topic: "Actions in Combat"`) — same
one-concept-per-entry granularity as everything else in the Compendium,
not one giant entry per chapter. `mechanics` stays blank for all three —
this is reference prose/tables, not something with modifiers/actions/
requirements to categorize.

Nearly every rules/setting page opens with a `<p><strong>Source:</strong>
CRB pg. 244</p>` paragraph, parsed into `source`/`data.sourcePage` and
stripped from the body so it isn't duplicated — but this is a plain regex
match on the *first paragraph's* text, not a real structured field the way
`system.source` is on Items, so it has two known gaps: a rules page whose
source line doesn't parse as a real book/page (confirmed:
`rules/afflictions.json`'s "Diseases" page) leaves `source` empty rather
than guessing, and setting pages that put their source inside a stat-block
`<table>` instead of a leading paragraph (confirmed: `setting/
absalom_station.json`) aren't caught by the first-paragraph check at all —
the source text is still present in the body either way, just not split
out into the dedicated fields. Not fixed further since content isn't lost,
only metadata quality in these specific cases.

`tables/` results reference other compendium entries via a Foundry-internal
`documentUuid` (e.g. `Compendium.sfrpg.races.Item.AMBcyDZDtJ1OOzh3`) that
doesn't resolve to anything in our own database — deliberately not
resolved at import time, since `result.name` already carries the
human-readable value (e.g. "Human (Featherlight)") a GM/player actually
needs; only `name`/`min`/`max`/`weight` are kept.

The Compendium view (`frontend/src/views/Compendium.jsx`) has matching
sections — **Rules** (filterable by chapter), **Setting & Lore**, **Random
Tables** (rendered as an actual roll-range table, not the generic field
dump every other category uses, since `results[]` is an array of objects
the generic renderer can't stringify sensibly).

### `data` fields per category

`data.effect` (the description, HTML stripped and Foundry's own
`@UUID[...]{Label}`/`@Check[...]` link syntax resolved to plain labels) and
`data.sourcePage` are present on every category. Beyond that:

- **feat / class-feature / racial-feature / archetype-feature /
  theme-feature / universal-creature-rule** (all share the feat mapper):
  `prerequisites` (text), `combat` (bool, only if `true`)
- **spell**: `school`, `level`, `range`, `area`, `duration`, `savingThrow`,
  `spellResistance`, `targets` (raw text — see mechanics.targeting for the
  parsed version)
- **race**: `abilityScores` (text), `hitPoints`, `sizeAndType`
- **class**: `keyAbilityScore`, `baseAttackBonus`, `savingThrows`,
  `hitPointsPerLevel`, `staminaPointsPerLevel`, `skillRanksPerLevel`,
  `classSkills`
- **theme**: `abilityMod` (text), `themeSkill`
- **archetype**: `requirements` (text)
- **condition / effect**: `effectType` (Foundry's own `system.type`, e.g.
  `"condition"`)
- **every equipment category**: `level`, `price`, `bulk`, plus whichever of
  `weaponType`, `weaponCategory`, `properties`, `armorType`, `eacBonus`,
  `kacBonus`, `maxDexBonus`, `armorCheckPenalty`, `augmentationType`,
  `augmentationSystem`, `consumableType`, `capacity`, `allowedArmorType`,
  `upgradeSlotsUsed` apply to that item

### `mechanics` fields per category

See `backend/src/mechanics-schema.js` for the full shape. Beyond the
fields already covered under "Structured mechanics" above
(`targeting`/`range`/`area`/`duration`/`savingThrow`/`spellResistance`/
`activation`/`requirements`/`tags`), Foundry-sourced entries also populate:

- **`modifiers`** (feats, class/racial/archetype/theme features,
  conditions, effects, spells, and every equipment category) — see "The
  Modifiers system" below. This is the field a character engine cares
  about most.
- **`abilityModifiers`** (`race`: from `abilityMods.parts`; `theme`: from
  the single `abilityMod`) — `[{ ability: "dexterity", value: 2 }, ...]`
- **`armorClass`** (`armor` only) — `{ type, eac, kac, maxDex, acp,
  speedAdjust, upgradeSlots }`. Deliberately separate from `modifiers`:
  Foundry's armor items apply their AC bonus through this dedicated field,
  not through the generic Modifiers system, so this preserves that
  distinction.
- **`weaponProperties`** (`weapon`, and any other equipment category with
  `system.properties` set) — decoded special-property names, e.g.
  `["Automatic", "Two-handed"]`.
- **`actions`** — populated with `{ kind: "damage", formula, damageTypes,
  onCritical? }` for anything with `system.damage`/`system.critical` parts
  (spells, feats, weapons, ...). No other `kind` is populated yet (see the
  README's "On automatic rule effects").

### The Modifiers system

`mechanics.modifiers` is Foundry's own pre-designed bonus system, kept
close to verbatim rather than reinterpreted — see the `Modifier` shape in
`mechanics-schema.js`. Three fields need a glossary to use correctly:

**`modifier`** is a formula string, evaluated with these variable
conventions (seen across the imported data — a character engine needs to
resolve these against the character sheet it maintains):

| Prefix | Meaning | Example |
|---|---|---|
| `@abilities.<str\|dex\|con\|int\|wis\|cha>.mod` / `.value` | Ability modifier / score | `@abilities.str.mod` |
| `@attributes.baseAttackBonus.value` | Character's BAB | Deadly Aim's damage bonus |
| `@attributes.speed.<land\|flying\|swimming\|climbing\|burrowing>.value` | Movement speeds | |
| `@details.level.value` | Character level | |
| `@details.cl.value` | Caster level | |
| `@details.cr` | Challenge rating (NPCs) | |
| `@classes.<classKey>.levels` | Levels in a specific class | `@classes.soldier.levels` |
| `@skills.<skillAbbr>.mod` / `.ranks` | A specific skill's modifier/ranks | `@skills.pil.ranks` |
| `@resources.<classKey>.<resourceName>.value` | Class resource pools (Stellar Mode, Evolution Track, Entropic Pool, ...) | |
| `@item.level` / `@item.properties.<key>` | The item's own fields | |
| `@origin.actor.*` / `@origin.item.*` | The actor/item that granted this modifier (for effects applied by something else) | |

**`type`** is the SF1e bonus type (`untyped`, `insight`, `racial`,
`circumstance`, `enhancement`, `weapon-specialization`, `morale`,
`divine`, `resistance`, `base`, ...) — **this matters for correctness**:
per SF1e rules, same-type bonuses from different sources don't stack (the
highest applies), except `untyped`/`circumstance`/`dodge`, which always
stack. A character engine must group active modifiers by `(effectType,
type)` and take the max within each typed group before summing.

**`effectType`** is what the bonus applies to. Common values: `skill` /
`all-skills` / `ability-skills` (a specific skill, all skills, or all
skills keyed off one ability), `saves` / `save` (all saves / one save),
`ac`, `all-attacks` / `melee-attacks` / `ranged-attacks` / `weapon-attacks`,
`all-damage` / `melee-damage` / `weapon-damage`, `energy-resistance`,
`damage-reduction`, `specific-speed` / `all-speeds`, `initiative`, `cmd`,
`acp`, `bulk`. `valueAffected` narrows further (e.g. which skill or save)
using Foundry's own short codes (skill abbreviations match `SKILL_NAMES`
in `foundry-import.js`).

### Not yet imported

These live in the same Foundry checkout but use a fundamentally different
data shape and aren't wired up:

- **Alien Archives / Creature Companions / Summoned Creatures** (`npc2`
  type, ~850 items) — full monster stat blocks (attacks, skills, senses,
  special abilities, CR), not spell/feat/gear mechanics. Natural fit for
  the Campaign system's NPC importer as a future addition, but needs its
  own schema, not an extension of this one.
- **Starships, Starship Components/Actions, Vehicles, Hazards** — a
  separate combat subsystem (starship combat), out of scope for character
  mechanics.
- **`rules`, `setting`, `tables`** folders — these are Journal Entries, not
  Items (no `system` mechanics block at all, just structured/tabular
  reference text e.g. the conditions glossary, setting lore, random
  tables). Worth importing for the Compendium's reference value, but
  needs a different reader (Journal page tree, not item `system` fields).
- **`characters`** folder (33 items) — sample pregenerated PCs, not rules
  content; use the Hephaistos importer for real character data instead.

## Normalized authoring pipeline (race/class/archetype/theme)

`DataEntry/` (see its own README) hand-authors a stricter, decomposed JSON
shape per race/class/archetype/theme (`DataEntry/schema/*.schema.json`) —
started because a race's Foundry-imported `data.effect` is one undecomposed
prose blob (flavor text + every named trait run together), not because the
underlying mechanics are actually missing. In fact they mostly aren't:
`racial-features/`, `class-features/`, `archetype-features/`, and
`theme-features/` already carry each individual trait/feature as its own
entry with real `mechanics.modifiers`, just not linked back to its parent
race/class/archetype/theme as a single document.

`backend/scripts/normalize-entries.js` does that linking — deterministically,
via regex/join, not an LLM — and only reaches for a local LLM (optional,
`--llm`) for the handful of gaps that are genuinely prose-dependent:

```bash
cd WebApp/starfinder-tool/backend
node scripts/normalize-entries.js races                 # or classes/archetypes/themes/all
node scripts/normalize-entries.js races --limit=5        # useful while testing
node scripts/normalize-entries.js races --llm             # also use a local Ollama for unresolved "replaces" links
  # --ollama-url=http://localhost:11434/v1 --model=qwen3:8b are the defaults,
  # same conventions as GalaxyGen (Docs/11-AI-integration.md)
```

Output goes to `DataEntry/output/<category>/<slug>.json` (gitignored, like
`aon-cache/`) — a **draft for human review**, not a final authored file.
Every entry carries `_source` (which aon-cache slugs it was assembled from)
and `_review` (anything the script — or the LLM step — couldn't confidently
resolve, each with a reason and the raw source text). Nothing here writes
back into `aon-cache/` or the DB import path.

What the deterministic join actually does, per category:
- **Races**: a `racial-feature` entry is a *default* trait if its
  `mechanics.requirements[].hasFeat.name` cleanly names this race (or,
  since a variant race's own name carries a parenthetical the source data
  doesn't — "Android (Companion)"'s traits link via `hasFeat: "Android"`,
  the base species — its base name too; confirmed live, 60/190 races have
  a parenthetical variant name and were all coming back with zero linked
  traits before this was added) and its text has no "This replaces..."
  sentence; it's an *alternate* if that sentence names this race (parsed
  per-clause, since one entry can read "replaces X for aasimars or Y for
  ganzis", or "replaces X and Y" for two traits at once — the schema only
  records one `replaces` id, so the clause that actually resolves to a
  known trait is preferred over always taking the first one listed).
  Shared/generic entries (`hasFeat: "Racial Feature"` — e.g. Darkvision,
  granted to many species) fall back to matching the feature's bare name
  against a heading line in the race's own prose, flagged for review since
  that's weaker evidence.
  Ability score adjustments and size are each cross-checked across up to
  three independent copies of the same fact (the structured
  `mechanics.abilityModifiers`/`data.sizeAndType` fields, `data.
  abilityScores`' separate summary text, and — for ability scores — the
  "Ability Adjustments" line embedded inline in `data.effect`'s prose) —
  see "Real upstream data bugs found this way" below for why agreement
  between two sources isn't itself proof of correctness.
- **Classes/themes**: features link via their own `data.prerequisites` text
  ("6th Level (Envoy)", "12th Level - Guard") or, when that's missing the
  parent name, the feature's own trailing `(ParentName)` or filename.
  Themes' 1st-level "Theme Knowledge" isn't a separate feature entry at all
  — it's embedded in the theme's own base entry under an ALL-CAPS "THEME
  KNOWLEDGE (1ST)" heading — extracted separately.
- **Archetypes**: same linking as classes, but which class feature slot
  each archetype level replaces is essentially never stated in a
  consistently parseable way in the source text (confirmed: 0/248 sampled
  archetype-feature entries name it) — every level always gets a
  `_review` note for `replaces_class_feature` rather than a guess.

The LLM step (`--llm`) is used for exactly one thing today: resolving a
race's alternate-trait `replaces` target when the regex match against
known trait ids fails (e.g. the source phrase doesn't slugify cleanly to
an existing trait name). It's a single short, bounded question per
unresolved trait — not "summarize this page" — via
`backend/scripts/lib/ollama-client.js` (same OpenAI-compatible
`/chat/completions` convention as GalaxyGen's `aiClient.js`, ported to
Node's built-in `fetch`). The system prompt explicitly tells the model
null is a common, correct answer, not a fallback of last resort —
confirmed live this needed to be explicit: without it, the model picked a
real-but-wrong id from the known-trait list rather than admitting no
match (see below). If the endpoint isn't reachable, or a lookup fails
after one retry, the item just stays in `_review` instead of blocking the
run.

Deliberately **not** run through this pipeline: weapons, spells, feats, and
the rest of `equipment/` — those are already fully structured per-item from
the Foundry import (damage, range, price, properties, ability-score
prerequisites all already typed fields, not prose), so there's nothing an
LLM pass would add.

### Grounded consistency checker

`backend/scripts/audit-normalized.js` independently re-checks fields the
normalizer derived against the *same source text they came from* — not
against a local model's memory of Starfinder rules, which an 8B model
doesn't reliably have and would confidently fabricate rather than admit
(the worst failure mode for a checker specifically, since its whole job is
catching errors). Every claim it verifies is grounded in text supplied in
the prompt: ability score adjustments and size against the race's own
overview prose, the default-trait list against the same, and each
alternate trait's `replaces` value against that trait's own description.

```bash
node scripts/audit-normalized.js races --limit=10   # try a few first
node scripts/audit-normalized.js races                # full category
```

Findings write into each entry's `_audit` array (separate from `_review`
— `_review` flags what the normalizer *couldn't* determine, `_audit` flags
fields it *did* confidently fill in that this independent check now
disputes) and print a summary to the console. Like the `--llm` step above,
this needs a local Ollama server reachable at `--ollama-url` (default
`http://localhost:11434/v1`).

**Also covers item-shaped categories that never go through
normalize-entries.js at all** — pass any `aon-cache/` folder name instead
of a normalized category (`node scripts/audit-normalized.js conditions
--limit=5`, `... equipment ...`, `... feats ...`, etc.) and it checks
`mechanics.modifiers[]`/`mechanics.actions[]` (damage) against the
entry's own `data.effect` prose directly, via `scripts/lib/audit-item.js`.
These categories skip normalize-entries.js because there's no decomposition/
linking problem for a single-concept item the way there is for a race's
bundled traits — but that reasoning was about *linking*, not
*correctness*, so it's worth the same grounded check anyway. Findings
write to a sidecar file (`DataEntry/output/_audits/<folder>/<slug>.json`)
rather than into `aon-cache/` itself, which stays a clean, regeneratable
output of the importers.

Smoke-tested (2 entries each, 0 call failures) across every `aon-cache/`
folder, not just conditions/effects/equipment: `feats`, `spells`,
`classes`, `class-features`, `racial-features`, `archetypes`,
`archetype-features`, `themes`, `theme-features`,
`universal-creature-rules`, `rules`, `setting`, `tables`. Three honest
outcomes, not one:
- `archetype-features`/`theme-features` (and, from the first round,
  `conditions`/`effects`/some `equipment`) found real claims and verified
  them correctly.
- `feats`/`spells`/`classes`/`class-features`/`racial-features`/
  `archetypes`/`themes`/`universal-creature-rules`: the first two entries
  alphabetically in each happened to carry no modifiers/damage actions at
  2-item sample size — a sampling artifact, not a coverage gap, since it's
  the identical code path that found and verified claims elsewhere.
- `rules`/`setting`/`tables` will **always** show zero checkable claims —
  `mapFoundryJournalPage()`/`mapFoundryRollTable()` (see "Journal/
  table-shaped content" above) always emit blank mechanics, since these
  are pure reference prose/tables with nothing structured to check by
  design. Documented here so a future zero-claims run against these three
  doesn't get mistaken for the checker being broken.

**Confirmed live, a real and useful asymmetry between categories**:
conditions/effects prose routinely restates exact numbers ("Prone: *You
take a –4 penalty to melee attack rolls*" matches `mechanics.modifiers`
exactly) — a genuinely groundable check, verified working end-to-end.
Most equipment prose (weapons, armor, magic items, goods) is pure flavor
text with zero mechanical numbers in it at all — confirmed by direct
sampling across five equipment subtypes, none restated damage/price/bonus
values in `data.effect`. For those, most claims correctly come back
"uncertain" rather than a false "match" (the prompt is explicit that
silence isn't confirmation) — not a wasted check, since the rare
flavor blurb that *does* state a number contradicting the structured
field is exactly what's worth catching, and a live test caught a genuine
edge case: an augmentation's prose confirmed "+2 to a single ability
score" without naming *which* ability, correctly verdict "uncertain"
rather than either falsely confirming or wrongly flagging the specific
ability the structured data named.

**This has a real, structural blind spot, not just occasional
inaccuracy**: it can only catch Foundry's data disagreeing *with itself*
(prose vs. structured field, or one race's default-trait list vs. what its
own overview text names) — it has no way to catch every available
Foundry-sourced signal agreeing on the same wrong answer. Confirmed live:
`dessamar-instar.json`'s `data.abilityScores` text and structured
`mechanics.abilityModifiers` field both said "-2 Con, +2 Dex", consistent
with each other, and the checker had no basis to flag it — the actual
rulebook says +2 Con, -2 Dex. That one was only caught because a human
checked the physical book. The checker also isn't itself infallible even
when grounded: the same run flagged a real *false positive* on this same
race, misreading a source snippet that plainly said "+2 dexterity" as
saying "-2". Treat every `_audit` finding (mismatch or clean) as a lead
for human review, not a verdict.

**Real upstream data bugs found this way** (fixed in the normalizer, not
worked around):
- `racial-features/reverse-fate.json` and `fiendish-nihilism.json` both
  claim `hasFeat: "Aasimar"` while their own text is entirely about
  ganzis/tieflings — a source-data mislabel; the assembler now
  cross-checks a candidate trait's text against every known race name and
  excludes (with a `_review` note) anything naming a different one.
- `copaxi.json`'s structured `data.sizeAndType` says "fine", its own prose
  says "Copaxis are Medium humanoids" — disagree within the same entry.
  Prose wins on disagreement now (still flagged either way).
- `dessamar-instar.json`: see above — the one bug no internal
  cross-check could have caught, since every Foundry-sourced signal agreed
  on the wrong values. Fixed by hand against the physical rulebook.
- The `--llm` resolver itself had a bug, not the source data: asked to
  match `android-laborer.json`'s "replaces exceptional vision" against
  Android's two known default trait ids (neither of which is "Exceptional
  Vision" — that trait has no `racial-feature` entry in the Foundry
  checkout at all, a genuine gap, not a linking failure), the model
  answered "constructed" — a real id, just the wrong one, so it passed the
  "is this a known id" validation undetected. Fixed by making the prompt
  explicit that null is expected and common, not a failure state.

**Known, not-yet-fixed gaps this surfaced** (real, documented, left as
`_review`/`_audit` items rather than guessed at):
- **Missing source data**: `alkainan.json` has zero `racial-feature`
  entries anywhere in the Foundry checkout, despite its own prose clearly
  describing several traits (Low-Light Vision, Metallic Bloodline, Natural
  Weapons) — nothing to link to; needs hand-authoring via `DataEntry/`.
- **"Choose one of several" defaults**: some races (e.g. `cephalume`, with
  its krikik symbiote options) present a *choice* of otherwise-equivalent
  default traits, not "grant all of them" — the current model has no
  concept between "default" (always granted) and "alternate" (swaps one
  specific thing) for this case.
- **Stage/subspecies-conditional defaults**: races published as several
  life-stage or subspecies variants sharing one base species name (Ghoran
  Sapling/Oakling/Willower) link via the same base `hasFeat` as the
  variant-race fix above intends, but some linked traits/ability
  adjustments only actually apply to *one* stage, not all — the source
  data doesn't distinguish this via `hasFeat`, only in each trait's own
  prose, which isn't parsed for conditions yet. Same underlying category
  as the choice-of-several gap above (a race's stat block isn't always
  "here are your defaults", sometimes it's "pick within this group").
- **Variable size**: a handful of races (e.g. `entu-symbiote`: Small,
  Medium, or Large) don't have one fixed size at all; the schema assumes
  a single `size` value per race.

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
