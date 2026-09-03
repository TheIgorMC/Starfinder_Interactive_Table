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

Every run also writes one consolidated `DataEntry/output/_audits/
<category>/_findings.json` — the thing to actually come back to later
(by a human or a future Claude session), rather than re-grepping hundreds
of per-entry sidecar files or scrolling back through console output that's
already gone. Same path regardless of whether the category went through
`normalize-entries.js` or was audited directly against `aon-cache/`. Each
finding carries `"status": "open"` — flip it by hand (or have a future
pass flip it) as items get reviewed; the file is plain JSON, no tooling
required to track progress across sessions. Re-running a category
overwrites its `_findings.json` with the new run's results, so treat it as
"current state of that category's open items," not an append-only log.

`--random` (or `--seed=N`, which implies it) shuffles the file list with a
seeded PRNG (`seededShuffle()`) before applying `--limit` — without it, a
small sample keeps landing on whichever entries sort first alphabetically,
which (confirmed live) can systematically miss the entries that actually
have something to check. A fixed seed makes two runs of the same command
comparable — useful for confirming a code change actually changed the
result on the *same* entries, not just a different random sample.

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

Follow-up run at real sample size (`--random --seed=N`, 8 entries/category
instead of 2 — `seededShuffle()` in `audit-normalized.js`, since the first
two entries alphabetically kept landing on ones with nothing to check)
found two more confirmed real upstream bugs, independently verified
against the raw entry, not just trusted from the model's note:
- `racial-features/lithic.json` (a Quorlu trait): `modifiers[0].
  valueAffected` says `"fire"`, but both the prose *and that same
  modifier's own `notes` field* say the bonus applies to Bleed/Disease/
  Poison saves — `valueAffected` contradicts its own sibling field, not
  just the prose.
- `theme-features/starship-savant.json`: `effectType: "all-skills"` with
  an empty `condition` field reads as a blanket +1 to every skill check,
  but the prose (and again that modifier's own `notes`) says it only
  applies "if you're trained in a skill required for a crew action" — the
  qualifier exists in English in `notes` but was never extracted into the
  structured `condition` field the Modifier shape has specifically for
  this.

Also caught a real bug in the *checker's own prompt*, not the data:
rendering a raw `effectType` key verbatim ("all-attacks") produced a
claim the model read as contradicting a source sentence about "attack
rolls" even though they mean the same thing
(`conditions/dazzled.json`) — fixed with an `EFFECT_TYPE_PHRASES`
translation table in `audit-item.js` (not exhaustive, just the values
from "The Modifiers system" below); re-verified the same entry no longer
false-flags.

#### The false-positive flood, and five rounds of fixing it properly

Running the item-audit at real scale (a full, un-limited category, not a
2-8 entry sample) surfaced a much bigger version of the same problem —
one run came back with 131 "mismatches" out of 621 `racial-features`,
which turned out to be almost entirely one bug, not 131 real Foundry
errors. Documented in full because the *process* matters as much as the
fixes: every one of these was caught by re-verifying a suspicious-looking
result against the raw entry before trusting it, the same discipline
applied throughout this pipeline — a checker that's occasionally wrong is
expected and fine (see the structural-blind-spot note above); a checker
whose wrongness is silently trusted and reported as findings is not.

1. **`valueAffected` blindly concatenated onto a phrase that already means
   "applies broadly"** — `effectType: "all-skills"` + `valueAffected: "per"`
   rendered as `"per all skill checks"`, nonsense the model correctly
   rejected, but rejecting a garbled sentence isn't finding a real error.
   Fixed by never building a valueAffected-qualified sentence for
   `all-skills`/`saves`/`all-attacks`/`all-damage`/`all-speeds`/
   `damage-reduction` (`BROAD_EFFECT_TYPES` in `audit-item.js`); a non-empty
   `valueAffected` on one of these is instead logged as a **deterministic
   anomaly** (no LLM call, no judgment call — the contradiction is provable
   from the two fields alone).
2. **Even without that conflict, "all X" was still routinely an overclaim**
   — this dataset uses `saves`/`all-skills` loosely, with the real
   (usually narrower) scope living only in free-text `notes`, never the
   structured `condition` field. An explicit system-prompt instruction
   ("missing conditions aren't mismatches") measurably helped but was
   **confirmed unreliable on this 8B model** — `racial-features/
   battle-hardened.json`'s `ac`+`"both"` bonus still got flagged after the
   instruction was added. Fixed the same deterministic way as (1): `ac`
   with `valueAffected` in `{both, eac, kac}` (a normal, expected value
   there, unlike the broad types) is skipped entirely rather than sent to
   the LLM with a claim this data shape can't fairly support.
3. **Damage-action formulas sent verbatim** — `Deals 1d3 + @abilities.str.mod
   + lookupRange(@details.level.value, 0, 3, floor(@details.level.value/2))
   piercing damage` compared against prose that says "1-1/2 × level damage
   bonus" is a category error (implementation syntax vs. natural-language
   description of the same formula), not a value check. Fixed by only
   sending damage claims whose formula is plain dice notation
   (`SIMPLE_FORMULA_RE` — digits, `d`, `+`, `-`, whitespace only); anything
   with an `@`-path or function call is skipped.
4. **The same `valueAffected`-gluing bug, one level down, for the *narrow*
   types** — unlike the broad types above, `skill`/`save` are *supposed*
   to be narrowed by `valueAffected` (that's the whole point), but the raw
   abbreviation code was still glued on unparsed: `"per" + "skill"` →
   `"per skill"` instead of "Perception checks". Confirmed across multiple
   `conditions` entries (`dazzled`, `blinded`, `asleep`, `deafened`, ...),
   all flagged as "mismatch" against prose that plainly names the skill.
   Fixed with a `describeTarget()` helper that decodes the abbreviation via
   `SKILL_NAMES` (exported from `foundry-import.js` — reused, not
   duplicated) and a small `SAVE_NAMES` map (`fort`/`ref`/`will`); also
   fixed the `energy-resistance` phrasing ("fire energy resistance" →
   "resistance to fire damage") while in there, a smaller instance of the
   same awkward-concatenation pattern.
5. **The model penalizing a claim for not saying "untyped"** — a bonus
   *type* (untyped/racial/morale/...) is a game-mechanical classification
   rulebook prose never states explicitly ("+2 to X", never "+2 untyped
   bonus to X") — "untyped" specifically means *no* type word was used,
   so its absence in the source is exactly what confirms it, not a reason
   to flag mismatch. Fixed with an explicit system-prompt clause.

Each fix was verified on the specific entries that surfaced it before
being trusted (not just "the count went down") — e.g. round 2 confirmed
`battle-hardened`/`stable` stopped false-flagging while `sheltering`
(which was never wrong) still correctly passed. Round-by-round mismatch
counts on the same full re-run, `racial-features` (the largest, noisiest
category): 131 → 87 → 66 (rounds 1-2 fixed) → still 66 after round 3 (that
fix mainly affected `archetype-features`' damage-formula-heavy entries) →
final small-sample spot checks after rounds 4-5 showed further real
improvement (e.g. a 7-entry `conditions` sample dropped from 5 flagged to
2, both now plausible genuine findings) but weren't re-run at full scale
in this session — left for a future run using the same `--random --seed=N`
commands documented above.

#### The 61 anomalies: root cause and fix

Every anomaly flagged across `conditions`/`effects`/`racial-features`
(61 total) turned out to share one root cause, confirmed by reading every
one's own `notes` field rather than assuming from the pattern alone: a
"broad" modifier (`all-skills`/`saves`/`all-attacks`/`all-damage`/
`all-speeds`) with a non-empty `valueAffected` that's never actually
meaningful there — `halfling-luck.json`'s "+1 to all saving throws"
(unconditional, per its own `notes`) carries `valueAffected: "int"`;
`orbital-adaptation.json`'s "+2 vs radiation" save carries `valueAffected:
"analog"` — a weapon property code, not a save-related concept at all.
The values are drawn from unrelated vocabularies (skill codes, ability
codes, AC-selector codes, weapon-property codes) with zero correlation to
what each modifier's own `notes` says it actually does — reads like a
single shared/reused dropdown field in the Foundry authoring sheet
retaining whatever was last selected in a different context, not
per-entry data-entry mistakes.

**Fixed at the source**: `valueAffected` cleared to `""` on all 57
confirmed cases (54 files) directly in `aon-cache/`. This is a deliberate
exception to "aon-cache stays a clean, regeneratable output of the
importers" (`import-foundry.js`/`scrape-aon.js` would silently reintroduce
the wrong values on a future full re-import of these three folders) — the
tradeoff was judged worth it because a wrong value actively misleads
anything reading `mechanics.modifiers` downstream (the Compendium, a
future rules engine, ...), while an absent one honestly represents "the
real scope isn't captured in structured data, see `notes`." No
information was lost — `notes` (the actual source of truth for these
entries' real scope, e.g. "against Fear effects") was never touched.
Verified clean afterward, not just assumed: re-running the audit against
all three categories shows 0 anomalies, confirming no cases were missed
and the fix didn't need a second pass.

Also fixed in the same pass: `damage-reduction` was wrongly included in
the "broad" effectType set to begin with — confirmed live,
`racial-features/incompressible.json`'s "DR 5/piercing or slashing" uses
`valueAffected` as the bypass type, completely standard SF1e notation,
not a contradiction. Every DR modifier with a bypass type was getting a
false "anomaly" (and, separately, was never even being checked at all,
since the broad-type branch always skips claim generation) until this was
removed from `BROAD_EFFECT_TYPES`.

#### `equipment` (~4,200 entries): a reliability gap at scale, and real finds

Running the full `equipment` category (not a sample) surfaced a reliability
problem invisible at small sample sizes: **47% of its 392 initial
"mismatch" verdicts (184) had a note that was itself the model explaining
the source never addresses the claim at all** ("source text does not
mention damage type or dice value") — a textbook "uncertain" per the
system prompt's own instruction, mislabeled anyway. Spot-checked a
representative sample rather than assumed: every one of the 184 (including
the 59 whose note contained a contrastive word like "but", which could in
principle have been hiding a real contradiction) turned out to be genuine
vagueness, not a disguised real bug. Same class of soft-instruction
unreliability found twice before at smaller scale (missing conditions,
`ac`'s `both`/`eac`/`kac`) — this time the fix is a deterministic
*post-processing* correction rather than excluding the check outright
(`reclassifySilentMismatches()` in `audit-item.js`, matched against a
`SILENT_NOTE_RE` pattern), since equipment *does* sometimes restate a real
number and the question is worth asking, just not worth trusting the
model's own verdict label on unreviewed. Applied retroactively to the
already-completed run too (`scripts/lib` has no reprocessing script
committed — this was a one-off against the sidecar files directly) rather
than re-spending the hours re-running the LLM pass just for a
reclassification. `SILENT_NOTE_RE` needed widening once more after a
clean full re-run with every other fix applied: "never mentions"/"has no
description" used the same silence meaning as the original pattern in
different words and slipped through — caught by spot-checking the
*surviving* mismatches after the "fixed" run, not assuming the fix was
complete just because the count dropped. Final numbers after all of the
above, the full un-sampled category: 4,203 checked, 2,644 with nothing
checkable, **180 mismatches, 49 anomalies**, 5 call failures (down from
392 raw mismatches on the very first pass).

Of the mismatches that survived reclassification, spot-checking
surfaced two more real, distinct issues — one in this checker, one in the
data:
- **A phrasing bug of this file's own**: Foundry represents healing the
  same shape as damage — a `damage`-kind action whose `damageTypes`
  includes `"healing"` — so the claim builder said "Deals 6d8 healing
  damage" for an item that restores 6d8 Hit Points, backwards phrasing an
  otherwise-correct value. Fixed by rendering healing actions as "Restores
  N Hit Points" instead. (A first attempt hedged with "... Hit Points (or
  Stamina Points)" to cover items that heal SP instead — confirmed live
  this backfired, the model flagging the unrequested hedge as unsupported
  when a source only ever mentions HP. Reverted to plain "Hit Points";
  an item that actually restores SP will now show a real mismatch instead
  of a false one from an unearned hedge.)
- **A real, confirmed upstream data bug, small and bounded**: exactly 10
  `equipment` entries use `effectType: "cmd"` (Combat Maneuver Defense) —
  checked all 10 individually rather than assuming from one, and every
  single one's own `name` or `notes` field explicitly says "KAC" (e.g.
  `kalo-shredder-slipstream-class.json`'s modifier is literally *named*
  "KAC bonus against Disarm" while tagged `effectType: "cmd"`, a
  different stat). Fixed by correcting all 10 to `effectType: "ac"`,
  `valueAffected: "kac"` — matching what each entry's own text already
  said, not a guess.

**Confirmed not a bug, working as intended**: `equipment/
sciatic-agonizer.json` flagged a mismatch (claims "modifier of 0" to
speed, source describes "doubling" it) that turned out to be the Foundry
data *admitting* it's an intentionally-incomplete placeholder — its own
prose ends with "Please change the modifiers to your current movement
speeds, to account for doubling them." A flat modifier can't express a
multiplier without knowing the character's current speed first. The audit
correctly surfaced the discrepancy; there's nothing here to fix beyond
what already exists (a human/GM needs to hand-set this one per-character),
which is exactly the checker doing its job — not every flagged item has a
data-side fix, and this one shouldn't be "resolved" by suppressing it.

**Equipment's own 49 anomalies were the same `conditions`/`effects`/
`racial-features` pattern from earlier, not yet applied here** — an
oversight caught only when directly asked "are these fixed" rather than
assumed from the earlier fix's existence. Verified before fixing, not
just pattern-matched by category name: sampled several of equipment's 49
and confirmed each one's `notes` describes something with zero relation
to its spurious `valueAffected` (e.g. `godheart-talavet.json`'s "+X to
recall knowledge" carrying `valueAffected: "com"` — Computers, unrelated).
Cleared all 49 the same way (`valueAffected` → `""`), count matched
exactly (49 found, 49 cleared) — see git history for the exact list
rather than duplicating it here.

**Anomaly fix verified, not just assumed**: a follow-up full re-run (after
an earlier attempt was abandoned partway through for time) confirms
0/4,203 anomalies — the fix generalizes across the whole category, not
just the sample checked while diagnosing it.

**Honest status on the rest, not a completed audit**: **the 181
mismatches were not all individually reviewed.** A representative sample
(~35-45 of the ~180, plus the 10 confirmed `cmd`→`ac` cases) was checked
against raw `aon-cache` data to confirm no further *systematic* checker
bug remained — that sample was mostly genuine, which is a reasonable
basis for trusting the *category* of finding, but it is not the same as
having verified all of them individually. They remain exactly where the
whole point of this pipeline says they should:
`DataEntry/output/_audits/equipment/_findings.json`, each `"status":
"open"`, ready to pick back up (same `--random --seed=N` commands
documented above) rather than something silently marked resolved.

**A recurring pattern that survived every fix, and looks like a real,
independent data issue rather than checker noise**: a modifier's own
`name` field sometimes doesn't match its parent entry at all —
`racial-features/wilderness-runner.json`'s modifier is labeled `"Memory
Gap"`; `archetype-features/mystic-decoder-ex.json`'s is labeled `"Cultural
Studies (Ex)"`; `racial-features/pheromone-cloud.json`'s is labeled
`"Ancestral Knowledge"` while its own prose is about a Fortitude-save
effect with no mention of Acrobatics (what the mislabeled modifier
claims). Confirmed three independent times, never chased to a single root
cause — reads like copy-paste from an unrelated entry during the Foundry
conversion. Worth a targeted look across the dataset at some point rather
than something this checker should try to auto-fix.

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
Foundry-sourced signal agreeing on the same wrong answer. This section
originally cited `dessamar-instar.json` as the proof: its normalized-
draft text and structured field both said "-2 Con, +2 Dex", consistent
with each other, matching the physical rulebook's "+2 Con, -2 Dex" only
by inversion, supposedly catchable only by hand.

**Correction, made directly against the raw served data**: that claim
doesn't hold up. Checking `aon-cache/races/dessamar-instar.json` — the
file `import-aon-cache.js` actually pushes to the live database, not the
normalized draft this claim was originally about — its own `data.effect`
prose plainly states "+2 Con, +2 Wis, -2 Dex", agreeing with the physical
book. Only `mechanics.abilityModifiers` had it backwards. Prose and
structured field *disagreed* here, in exactly the ordinary shape this
checker is built to catch — and once a checker was actually pointed at
this raw data (`audit-race-raw.js`, added specifically because the
normalized draft nothing imports isn't what's served — see below), it
did catch it, no human page-flip required. Left uncorrected for a while
this session anyway, on the strength of a claim about a different field
that was never independently re-verified before being repeated. The
general point — this checker cannot catch every Foundry-sourced signal
agreeing on the same wrong answer, because there's nothing left to
disagree with — still stands as a real limitation in principle; this
just wasn't a real example of it. The checker also isn't itself
infallible even when grounded: the same original run flagged a real
*false positive* on this same race, misreading a source snippet that
plainly said "+2 dexterity" as saying "-2". Treat every `_audit` finding
(mismatch or clean) as a lead for human review, not a verdict — and
re-verify a claim directly before repeating it, not just because it
already appears in this document.

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
- `dessamar-instar.json`: see the correction above — the raw served
  data's own prose and structured field disagreed after all; fixed once a
  checker was pointed at the right file (`audit-race-raw.js`, below).
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

#### `class-features` (2,148 entries): two new checker gaps, two confirmed upstream bugs

Same grounded checker, run against the last remaining large `aon-cache/`
category. First full pass: 2,148 checked, 167 mismatches, 8 anomalies, 5
call failures.

**Anomalies**: all 8 inspected individually rather than assumed from the
category name. 6 were the same spurious-`valueAffected` pattern fixed
earlier in `conditions`/`effects`/`racial-features`/`equipment` (a broad
`effectType` carrying a `valueAffected` unrelated to its own `notes`) —
cleared the same way (`valueAffected` → `""`). The other 2
(`burn-enchantment-su`, `gravitic-reinforcement-su`) were **deliberately
left uncleared**: both carry `valueAffected: "lowest"` on a `saves`
`effectType`, and unlike every other anomaly in this pattern, `"lowest"`
genuinely matches their own `notes` — both describe a real "bonus to your
lowest saving throw" mechanic, not a leftover dropdown artifact. Clearing
these would have deleted real information. A re-run after the fix
confirmed exactly 2 anomalies remain, both these two — the fix
generalized correctly and nothing was missed.

**A new, confirmed upstream data bug, the same shape as equipment's
`cmd`-vs-`ac` find**: 5 `class-features` entries also use
`effectType: "cmd"` for what their own text calls AC. Checked all 5
individually against their full `data.effect` prose before fixing, not
pattern-matched from the equipment precedent: `cellular-redoubt-ex`,
`chaoskin`, `gravity-anchor-su`, `shed-skin-ex`, `unyielding-bulwark-ex`
all explicitly say "AC" or "KAC" in their own text. Fixed by correcting
`effectType` to `"ac"` and `valueAffected` to `"kac"` or `"both"` —
matching what each entry's own text said, not a guess.

**A checker gap of this file's own, caught before the final run**: complex
formulas (`ternary(...)`, `lookupRange(...)`, `@`-paths) were already
excluded from damage-action claims (`SIMPLE_FORMULA_RE`, from the
racial-features round) but not from `mechanics.modifiers[].modifier` —
so a modifier whose raw value was a formula string, not a number, still
got compared to prose as if it were a fixed claim. Fixed by adding the
same plain-number guard (`/^[+-]?\d+(\.\d+)?$/`) to `modifierClaims()` in
[audit-item.js](../WebApp/starfinder-tool/backend/scripts/lib/audit-item.js).
Verified on a targeted 4-entry sample before the full re-run, not assumed:
all 4 (including `shed-skin-ex`, one of the 5 `cmd`→`ac` fixes above)
correctly returned "no checkable claims" post-fix.

Final numbers after all three fixes, full category re-run: 2,148 checked,
2,023 with nothing checkable, **57 mismatches, 45 uncertain, 2 anomalies**,
2 call failures — down from 167 raw mismatches and 8 anomalies on the
first pass.

**Spot-checking the surviving 57 surfaced one new checker false-positive
class and two genuine upstream bugs — not fixed this round, documented
here instead**, since the session was closing out and none of the three
generalizes as cleanly as the earlier fixes:

- **A new false-positive pattern, not yet fixed**: several entries were
  flagged for saying "modifier" when the source text says "gain"/
  "increase"/"grant" instead. Checked directly against `aon-cache`, not
  assumed: `exploratory-form-ex`'s own data is a plain `+30`/`+15` constant
  modifier to climb/swim speed, and its source text says "gain ... a climb
  speed of 30 feet" and "increase that speed by 15 feet" — the same fact,
  different verb. The checker's system prompt has no clause telling the
  model these are equivalent, so it treats the wording mismatch as a
  substantive one. Affects roughly 10 of the 57 (`exploratory-form-ex` x4,
  `elemental-first-lesson` x3, plus similar wording nitpicks on flat
  resistance/DR values in `springy-sheath`, `shock-absorption-ex`,
  `fiend-third-lesson`). Left as `_findings.json` entries rather than
  patched, since a same-session prompt tweak risks the same
  soft-instruction unreliability found twice before (missing conditions,
  `ac`'s subtypes) — worth a dedicated pass with its own verification, not
  a rushed addition here.
- **A real, confirmed upstream data bug**: `tenebrous-bulwark-su`'s own
  `mechanics.actions` has `formula: "0"` for its cold-damage action, while
  its own `data.effect` text describes a dynamic amount — "additional cold
  damage equal to half the number of Hit Points you lost." A flat `"0"`
  can't express that. Left unfixed (the schema has no way to encode "half
  HP lost" as a formula here without a broader change), but confirmed via
  direct read of the source file, not just the checker's say-so.
- **A real, confirmed upstream data bug**: `hungering-conflagration-sp`
  has two damage actions — `13d12` fire and `5d6` fire — but its own
  `data.effect` text only ever mentions "5d6 fire damage." The `13d12`
  entry has no basis anywhere in this entry's own source text; likely a
  leftover from the base spell (Chain Surge) this feature modifies, copied
  in during Foundry's conversion. Left unfixed rather than guessed at —
  deleting or correcting it would require knowing Chain Surge's true base
  damage, which isn't in this entry's own grounding text.

**Update: all 57 mismatches were individually hand-checked**, unlike every
prior category in this pipeline (equipment's 180, conditions/effects/
racial-features' smaller counts — all sampled, never exhaustively
reviewed). Asked directly whether the data was actually good rather than
just "count went down," so this round got the full treatment: every one
of the 37 distinct entries behind the 57 findings read against its own
`aon-cache` source text, using
[audit-item.js](../WebApp/starfinder-tool/backend/scripts/lib/audit-item.js)'s
own `buildItemAuditPrompt()` (imported directly, not re-implemented) to
get the *exact* claim each finding's `mechanics[N]` field refers to —
necessary because `N` indexes the filtered claim list, not the entry's
raw `modifiers`/`actions` array, and a first attempt at this hand-check
that assumed otherwise misattributed several claims to the wrong raw
object (caught by a re-derived claim not matching the finding's recorded
one, e.g. `dimension-of-time-greater-anchor`'s real offending modifier
turned out to be a second, differently-shaped one further down its array,
not the first).

Result, all 57 accounted for:
- **8 confirmed, unambiguous data bugs, fixed**: `protean-second-lesson`
  (modifier `4` → `2`, source plainly says "+2 bonus on saving throws", no
  dynamic-scaling excuse); `focused-resilience-ex`'s Reflex and Will
  modifiers (`type` `circumstance` → `enhancement` — both the source text
  *and* the modifier's own `notes` field say enhancement; the sibling
  Fortitude modifier already had this right, so this was a two-thirds
  copy/paste slip); `dimension-of-time-greater-anchor` (a modifier's
  `effectType`/`valueAffected` said `skill`/`acr` — Acrobatics — while its
  own `notes` field describes a saves-against-specific-conditions bonus;
  fixed to `effectType: "saves"`, matching how every other broad
  conditional save bonus in this dataset is represented); `strength-in-
  silence-ex` (`effectType: "skill"` when the source is explicit this is
  "+1 insight bonus to the attack roll" — fixed to `all-attacks`);
  `circle-of-devastation-su` and `powerful-propulsion-su` (both had empty
  `damageTypes` on a damage action despite the source unconditionally
  naming a type — "force" and "bludgeoning"/"force" respectively — filled
  in); `unwieldy-opportunist-ex-powerhouse-style-3rd` (`effectType:
  "weapon-property-damage"` when the source describes an attack-roll
  penalty, not damage — fixed to `weapon-property-attacks`); and
  `choreography-of-death-ex` (the reverse mislabel — `effectType:
  "weapon-attacks"` when the source is explicit this is a damage-roll
  bonus — fixed to `weapon-damage`). Every fix re-verified by re-running
  `buildItemAuditPrompt()` against the corrected file: each now produces
  a claim that matches its own source text exactly, with no new anomalies
  introduced.
- **~26 confirmed false positives or already-known acceptable
  limitations, left as-is** — the checker was right to ask, wrong to flag:
  a "reduce the penalty by 1" phrased as "+1 modifier" (mathematically the
  same thing in an additive stack, `staccato-strut-ex`); the checker
  matching a claim against the wrong sentence in a multi-clause source
  text (`aquatic-propulsion-ex`'s stated +1 to combat maneuvers is real
  and separate from the underwater attack-penalty clause the checker
  compared it to; `the-bigger-they-are-ex`'s flat "+5" is the size-
  escalation clause, not the base "5d6" the checker matched it to;
  `blazing-orbit-su`'s two damage actions are two genuinely separate
  effects — scaling flame damage and a flat burning-condition tick — not
  one value stated two ways); the "grant"/"gain" vs. "modifier" wording
  gap identified earlier (confirmed on direct reading: `exploratory-form-
  ex` x4, `elemental-first-lesson` x3 of its x4 — the 4th, Fire, has a
  real separate bug: source calls it an *enhancement* bonus, data says
  `untyped`, not yet fixed); a condition that's real but lives only in
  `notes` rather than the structured `condition` field, the same
  established false-positive class from earlier rounds
  (`adaptive-camouflage-ex`, `rebounding-bludgeon-ex`); this file's own
  translation of `bulk` as "carrying capacity" not matching the source's
  own "bulk limit" wording (`personal-modification-ex` — a self-inflicted
  phrasing gap, not a data problem); and flat resistance/DR values being
  compared against the word "modifier" when the source just states a flat
  number with no bonus-type language at all (`shock-absorption-ex`,
  `springy-sheath`'s resistance modifier, `fiend-third-lesson`).
- **~10 confirmed instances of one known, documented, and intentional
  limitation**: a value that legitimately varies by another dynamic stat
  (an attack-roll bonus, a spell's level) stored as today's flat-number
  snapshot rather than a live formula, because this schema has no way to
  express "equals your bonus to X" as data. Some of these entries say so
  explicitly in their own source text — `fiend-first-lesson`/
  `celestial-first-lesson`'s DR and `primal-defense-ex`'s DR/ER modifiers
  all carry an explicit in-game instruction to hand-edit the value
  ("DR must be edited in the Modifiers tab..."), the same acknowledged-
  placeholder pattern already confirmed once before in equipment
  (`sciatic-agonizer.json`) — `alien-archive-ex` is a second confirmed
  instance of that exact pattern (its own text: "change the Trick Attack
  bonus to the used skill"). Others (`intuitive-deconstruction-ex`,
  `push-off-ex`, `hold-on-tight-ex`, `energy-reflection-ex`) don't say so
  explicitly but are the same shape. None of these are wrong, exactly —
  they're accurate defaults for an inherently per-character value — so
  none were changed.
- **3 genuine bugs confirmed but deliberately left unfixed**, because no
  confident fix exists without inventing a value: `tenebrous-bulwark-su`
  and `hungering-conflagration-sp` (both above, unchanged from the
  original finding), plus `primal-defense-ex`'s specific case is worth
  separating from the acknowledged-placeholder bucket above — its default
  is `0`, not a plausible 1st-level value the way `fiend-first-lesson`'s
  `1` is, so it's a slightly worse placeholder even though it's the same
  underlying pattern.
- **A new pattern surfaced, not yet investigated**: `fiend-first-lesson`,
  `celestial-first-lesson`, and `fiend-third-lesson` — three near-
  identical "gain DR/resistance N" class features — carry three different,
  unconfirmed bonus `type` values (`circumstance`, `circumstance`,
  `morale`) that none of their own source text actually states. Same
  *shape* of problem as the spurious-`valueAffected` anomaly pattern
  fixed earlier this session (a Foundry dropdown value that doesn't trace
  back to anything in the entry's own text), but manifesting on the
  `type` field instead, which the deterministic anomaly check doesn't
  examine. Not fixed or counted as anomalies this round — flagged here as
  a lead for a future pass, the same way this pipeline has always
  surfaced findings rather than silently absorbing them.

The fixes above are the only aon-cache changes from this hand-check; the
`_findings.json` still lists all 57 (each `"status": "open"`) as the
running record — flipping status on the ones now resolved is future
bookkeeping, not required for the data itself to be correct.

#### Second pass: re-running and hand-checking every other audited category

Asked directly whether the whole of `aon-cache` could be called complete.
It can't — six categories (`feats`, `races`, `rules`, `setting`, `spells`,
`tables`, ~1,655 entries) have never been run through this checker at
all, and every audited category except `class-features` still had its
*original* LLM-flagged mismatches sitting unreviewed, several run before
this session's later checker fixes (silence reclassification, the
complex-formula-in-modifiers skip) existed. Re-ran the six smaller/
medium audited categories with mismatches — `conditions`, `effects`,
`themes`, `theme-features`, `archetype-features`, `racial-features` —
explicitly excluding `equipment` (too large for this pass) and
`class-features` (already fully hand-checked above). Reprocessing alone
dropped every count: conditions 4→2, effects 4→2, themes 1→1,
theme-features 15→13, archetype-features 23→16 (+1 call failure),
racial-features 68→51 (+4 call failures).

All 85 surviving mismatches, across 43 distinct entries, were then hand-
checked the same way as `class-features` — `buildItemAuditPrompt()`
imported directly to get the exact claim each finding refers to, each
entry's own `aon-cache` file read in full. The 5 call-failure entries
(never given any verdict at all) were hand-checked too, on the reasoning
that an unrun check is exactly as much of an unknown as a flagged one.

**The standout finding: the spurious-`valueAffected` pattern (fixed
earlier this session on broad `effectType`s like `saves`/`all-skills`,
where a Foundry dropdown value bleeds in from something unrelated) is not
limited to the types the deterministic anomaly check examines.** It
showed up repeatedly on `melee-attacks`, `ranged-attacks`, `initiative`,
`hit-points`, and `melee-damage` modifiers too — types the anomaly check
never looks at, so these were invisible until an LLM read the actual
sentence and rejected the nonsense: `grappler`'s +2 grapple-maneuver
bonus carried `valueAffected: "cold"` (a race with nothing thematically
related to cold); `frenzy`'s melee attack bonus carried `"reflex"` (a
save code, not an attack-roll qualifier); `cooperative-wrikreechee`
carried `"sen"` (Sense Motive, on a ranged-attack bonus for providing
covering fire); `scrappy-ysoki`'s Hit Point bonus carried `"acr"`
(Acrobatics); `hill-giant`'s bull-rush/grapple bonus carried `"fire"`;
`skittish` carried both `"reflex"` on an Initiative bonus and `"ste"` on
a melee-attack bonus in the same entry; `snag` carried `"both"` (an
AC-specific code) and `"reflex"` on its two melee-attack modifiers;
`early-stage-adaptation` and `malleable-limbs` (both call-failures, never
even checked) carried `"dip"` and `"both"` respectively, same shape.
**11 instances, 9 entries, all cleared to `""`.**

**A second, more serious variant of the same root problem, confirmed
once**: `racial-features/tough-hide.json` — named for a Maraquoi trait
("+2 species bonus to Survival checks" per its own `data.effect`) —
carried a modifier named `"Tough Hide"` whose own `notes` field read
"Megalonyxas gain DR 5/—" (a *different race's* trait, wholesale). Not a
stray field value this time but an entire modifier's content transplanted
from an unrelated entry — the same "modifier name doesn't match its
parent" pattern flagged as a lead in the equipment section above, now
confirmed with a concrete instance. Fixed by replacing the modifier's
content to match this entry's own source text (`+2 racial modifier to
Survival checks`), not by guessing what the DR-5 modifier should have
said or where it belonged.

**Plain value/type bugs, unambiguous against source, fixed**:
`conditions/fatigued.json` (bulk penalty `-2`, source says "reduced by
1"); `racial-features/sneaky-halfling.json` (`+1` Stealth, source says
"+2"); `racial-features/hydrobody.json` (land speed `25`, source says
"a land speed of 30 feet" — its stated swim speed of 30 feet has no
modifier at all, left as a documented gap rather than inventing one);
`racial-features/scrounger.json` (the Survival bonus typed `untyped`
while its two siblings from the same sentence are correctly `racial`);
`racial-features/hill-giant.json` (an AC bonus against combat maneuvers
using `effectType: "acp"` — Armor Check Penalty, a different stat
entirely — instead of `"ac"`); `racial-features/stony-plates.json` (four
energy-resistance siblings all correctly say `1` per "energy resistance
1"; the cold one anomalously said `5`); `racial-features/phantasm.json`
(`valueAffected: "eng"` — Engineering — when the source is unambiguous:
"+4 species bonus to Stealth checks"); `racial-features/malleable-
limbs.json` (a `+10-foot enhancement bonus` per source, typed `untyped`;
a `+4 species bonus`, typed `untyped` instead of the `racial` every
sibling in this category uses for "species bonus"); and
`archetype-features/psychic-crush-greater-phrenic-power-su.json` (empty
`damageTypes` on an action whose source explicitly says "nonlethal
damage"). Every one of these fixes re-verified the same way as
`class-features`'s: re-running `buildItemAuditPrompt()` against the
corrected file produces a claim (or correctly no claim) that matches the
entry's own source text, with no new anomalies.

**New false-positive patterns confirmed, not fixed** (same "checker
right to ask, wrong to flag" character as every prior round):
- **"Reduce a penalty by N" phrasing = "+N modifier"**, the same
  equivalence already established for `staccato-strut-ex` in
  class-features, confirmed again on `racial-features/head-frill.json`
  ("reducing any armor check penalty... by 1" ↔ `+1 modifier to acp`).
- **Toggleable alternates are situational *totals*, not additive
  stacks** — clarified by `racial-features/thermal-consumption.json`,
  whose own top-level notes make it explicit ("System does not currently
  allow stacking... emulate by editing the modifier"): a base value and a
  toggleable alternate (e.g. `high-mountain-native`'s "+2 Athletics" vs.
  "+6 Athletics to climb", `survivor`'s "+2" vs. "+3 underground") are
  each meant to be enabled *instead of* the other for that specific
  circumstance, not summed. The checker doesn't know this convention and
  flags the "narrower condition, different value" shape as a mismatch
  every time — the same established "condition lives in `notes`" pattern,
  just clarified with more precision this round.
- **"Choose one skill/damage type from a list" as several discrete
  alternate entries** — the same pattern already confirmed on
  `power-sphere-su`/`scour-soul-divine-niche` in class-features, seen
  again on `theme-features/hurl-debris.json` (ten precomputed `Nd6`
  actions, one exact instantiation of "1d6 per bulk" for each bulk value
  3 through 12 — not ten contradictions of one one value) and
  `archetype-features/not-today.json` (three skill-specific rerolls,
  Engineering/Mysticism/Computers, standing in for "whatever skill the
  trap actually required").
- **A translation gap in this checker's own vocabulary**: `conditions/
  entangled.json`'s `0.5` multiplier to `effectType: "multiply-all-
  speeds"` is exactly "move at half speed" (0.5× = half) — correct data,
  but `EFFECT_TYPE_PHRASES` has no entry for this one effectType (used
  nowhere else in the dataset), so the raw key leaked into the claim
  sentence unreadably. Left alone rather than patched for a single call
  site.

**Known limitations reconfirmed, not fixed** (a value that can't be a
flat number without inventing one): `effects/effect-dead-lift.json`
("treat your Strength score as 4× higher for calculating carry
capacity" has no flat bulk-bonus equivalent without knowing the
character's base Strength); `theme-features/dragon-skin.json` (energy
resistance against "that type of damage" — whichever type triggers it
first, not a fixed one); `archetype-features/overclocked-systems-ex.json`
and `magic-moves-su.json` (both explicitly say "edit... in the Modifier
tab," the same acknowledged-placeholder pattern as `class-features`'s
`fiend-first-lesson`).

**Coverage after this pass**: `class-features` (fully hand-checked, both
rounds) and these six categories (re-run, hand-checked, fixed) now rest
on solidly verified ground. `equipment`, `feats`, `races`, `spells`,
`rules`, `setting`, and `tables` were all addressed in the pass documented
immediately below, closing out every remaining category.

#### Closing the gap: `equipment` fully hand-checked, six new categories audited

Asked directly to finish the job: hand-check every `equipment` mismatch
(previously only sampled) and bring `feats`, `races`, `rules`, `setting`,
`spells`, and `tables` — six categories with zero prior coverage — up to
the same standard, "since they'll be used in game a lot."

**`equipment`, full re-run**: 4,203 checked, 2,650 with nothing checkable,
**186 mismatches, 1,269 uncertain**, 4 call failures. All 186 mismatches
hand-checked the same way as every category above (`buildItemAuditPrompt()`
imported directly for correct claim indexing), plus the 4 call-failure
entries read directly against their own source — an unrun check is as
much of an unknown as a flagged one. The 1,269 "uncertain" verdicts were
not individually reviewed (by definition, the source text doesn't address
those claims one way or the other — there's nothing to adjudicate without
inventing an answer).

Result: **9 confirmed bugs, fixed across 10 files** — `squirming-entrails`
mk-4/mk-5 (a modifier's own `notes` field says "Athletics checks to
balance," `valueAffected` said Acrobatics — same self-contradiction shape
found repeatedly in racial-features); all five `corpseskin` mk-1 through
mk-5 (a Disguise modifier typed `untyped` when its own `notes` field says
"+5 **competence** bonus" — only mk-4 was flagged as a mismatch, but the
identical modifier with the identical wrong type exists verbatim in all
five, so all five were fixed for consistency); `ring-of-the-ninth-truth`
(`valueAffected: "lowest"` on a "functions as a mk 3 ring of resistance"
item — a standard, well-documented SF1e item that grants a flat bonus to
*all* saves, not the "lowest" mechanic that (correctly) appears on the
two racial features found earlier this session — fixed to the broad
`saves` type with no `valueAffected`, matching how "applies broadly" is
represented everywhere else in this dataset); `shock-fist-aurora` (base
damage carried a stray `"cold"` alongside `"electricity"`, inconsistent
with its own scaling and critical-hit sibling actions, which are both
pure electricity); and `eohi-boots` (`effectType: "acp"` — Armor Check
Penalty — when the source says "AC," a different stat entirely).

The rest resolved as already-established false-positive patterns from
earlier in this session — wording nitpicks on flat resistance values,
the checker matching the wrong sentence in multi-clause items (most
`flametongue-*`/`shock-fist-*` critical-arc claims: the item's own
one-line summary, e.g. "Damage 4d8 F Critical Arc 2d8 F," states both
values, and the claim is correctly about the *second* one, which the
model kept comparing against the first), condition-lives-in-notes, and
choice-of-several patterns (`probability-tendril`'s d10 effect table,
`ablative-insulation`'s "resistance to all energy types" represented as
five discrete per-type entries). One new pattern confirmed:
several `graviton-pistol-*` variants and `scrambler-pistol/rifle-*`
variants have a damage action with no basis anywhere in their own (very
short, pure-flavor) `data.effect` text — the same "flavor text carries no
mechanical numbers at all" asymmetry already documented for equipment,
not a bug in the structured data, which comes from Foundry's own stat
block rather than the scraped blurb.

**`feats` (431 entries, first audit)**: 431 checked, 383 with nothing
checkable, 22 mismatches, 5 uncertain, 0 anomalies, 0 call failures. All
22 hand-checked. **3 confirmed bugs, fixed**: `arcane-riposte` (all 6
level-scaled damage actions had empty `damageTypes` despite the source's
unconditional "this damage has the force descriptor" — filled in
`["force"]` on all 6); `stand-strong-combat-teamwork` (a melee-attack
modifier carried `valueAffected: "acr"` — Acrobatics — with no connection
to the source at all, the same spurious-value pattern found repeatedly
in racial-features, just not caught by the deterministic anomaly check
since `melee-attacks` isn't a broad type); and `polymorphic-titan` (its
Colossal-form ability-skills modifier was typed `untyped` while its own
sibling ability-check modifier — same sentence, same value — was
correctly `enhancement`). The rest were the same established
false-positive shapes: condition-in-notes, skill-choice enumeration,
and rules-knowledge translations the source doesn't spell out verbatim
but are standard SF1e mappings (poison → Fortitude, charm/compulsion →
Will).

**`spells` (586 entries, first audit)**: 586 checked, 483 with nothing
checkable, 16 mismatches, 9 uncertain, 0 anomalies, 0 call failures. All
16 hand-checked. **7 confirmed bugs, fixed**: five spells (`petal-storm`,
`hurl-forcedisk`, `force-blast`, `fist-of-damoritosh`, `magic-missile` ×3
actions) had empty `damageTypes` despite the source unconditionally
naming exactly one type each (slashing or force) — unlike equipment's
choice-of-type entries, these spells never offer the caster a choice, so
there's no "which alternative" ambiguity excusing the gap; `ice-prison`
(formula `8d8`, source explicitly and unambiguously says "8d6 cold
damage"); and `mystic-cure` (its 4th-level bonus-healing action was
`4d8`, but the source's own table lists 5d8/7d8/9d8 for 4th/5th/6th level
— `4d8` matches none of the three, `5d8` does). The rest were the
established "two genuinely different, individually-correct conditional
outcomes" pattern (`crush-skull`'s pass/fail damage, `temporal-wave`'s
standard-vs-full-action damage) and one instance of the model misreading
Starfinder's own "Burning Xd6" shorthand as a duration rather than a
per-round damage die.

**`races` (190 entries, first audit — via `audit-race.js`, not
`audit-item.js`, since races go through the normalize-entries.js draft
pipeline)**: 190 checked, 0 with nothing checkable, 43 mismatches, 13
uncertain, 0 anomalies, 0 call failures. All 43 hand-checked directly
against `DataEntry/output/races/*.json` (the normalized drafts) and each
race's own region-extracted overview text. **2 confirmed bugs, fixed
across 7 files**: every `osharu` variant (`osharu`, `osharu-gengen`,
`osharu-deepmarsh`, `osharu-mire-dweller`) listed "Monster Hunter" as a
default trait despite it never being mentioned anywhere in any of their
(otherwise near-identical) overview text — removed from all four; every
`ghoran` variant (`ghoran-oakling`, `ghoran-sapling`, `ghoran-willower`)
listed both "Photosynthesis" (correct) *and* "Psychosynthesis" (not a
real trait, not mentioned anywhere, almost certainly a corrupted
duplicate) — the latter removed from all three. The rest of the findings
split into two buckets, both already-documented: the pipeline's own
"known, not-yet-fixed gaps" list from earlier this session (choice-of-
several defaults, subspecies/stage-conditional defaults, variable size,
`alkainan`'s still-empty `traits: []`) predicted almost exactly what this
first race audit would flag, now confirmed rather than merely
anticipated; and a **newly-confirmed systematic checker false positive**
specific to `audit-race.js`'s alternate-trait claims — every
`alternate_traits[N].replaces` claim checked (11 instances across
`lashunta-*` ×4, `half-elf-elven-inclined`, `kasatha-akitonian-settler`
×2, `tiefling` ×4) was flagged as a mismatch despite that trait's own
snippet explicitly ending in a sentence like "This replaces student." —
the model doesn't reliably treat an explicit "this replaces X" statement
as confirming the claim's stated replacement, the same class of soft-
instruction unreliability found repeatedly elsewhere this session, just
newly identified in this checker.

**`rules` (335) and `setting` (67)**: no `mechanics.modifiers`/`actions`
exist in either category at all (confirmed by direct inspection — these
are pure reference/lore prose with nothing structured to cross-check
against), so `audit-item.js`'s grounded-claim methodology fundamentally
doesn't apply here; there is no "structured field vs. prose" divergence
to catch because there's no separate structured field. Evaluated instead
with what *is* possible for pure prose: a heuristic scan for scraping
artifacts (raw HTML tags, truncation, repeated-character corruption) —
3 hits in `rules`, all false positives on inspection (padding whitespace
from a table-to-text conversion, and a skills-summary table's dense run
of legitimate ✓ checkmarks) — plus a manual read of a random sample from
each. Clean, aside from one likely single-character typo worth a second
look: `setting/centus-ii-centus-ii.json` says atmosphere "Thick and
**toix**" (almost certainly "toxic") — not corrected, since I can't
confirm the intended word with certainty from data alone.

**`tables` (46) — a real, confirmed gap, now fixed**: a deterministic
range-consistency check (do each table's `min`/`max` result ranges
exactly cover 1 through the formula's max, no gaps or overlaps) found
**17 of 46 tables (37%) were functionally empty** — every result row had
the correct roll range but a **blank `name`**, meaning the actual
roll-result text was never captured. This included **every critical hit
and critical fumble table** (`critical-hit`/`critical-fumble` ×
`energy`/`kinetic`/`spell`/`extreme`, 8 tables — arguably the single
most-rolled table group in actual SF1e combat), `starship-critical-
damage-effects`, `chaos-ammo`, `confusion-table`, four `drift-crisis-
treasure-*` tables, and `roll-table-wall-of-warped-time`.

Root cause traced against the live source
(github.com/foundryvtt-starfinder/foundryvtt-starfinder,
`src/items/tables`), not guessed at from the code alone — a first look at
[`mapFoundryRollTable()`](../WebApp/starfinder-tool/backend/src/foundry-import.js:604)
suggested the culprit was an unresolved `documentUuid` reference, which
turned out to be wrong in the specifics: Foundry's roll-table results
come in two different shapes, and the code only handled one of them.
`type: "document"` results (race/subspecies tables) really do carry the
label directly in `name` (e.g. `"Android"`), with `documentUuid` as inert
extra metadata — the original code's assumption was correct for these,
which is why 29 of 46 tables were already fine. But `type: "text"`
results — every one of the 17 broken tables — carry `name: ""` and put
the actual label in `description` instead, as Foundry rich-text HTML
(e.g. `"<b>Degloved</b> Normal damage..."`), a shape the mapper never
handled at all. Confirmed by fetching the raw source directly rather
than assuming; also caught that the local reference checkout at
`Docs/ReferenceFoundry/foundryvtt-starfinder-development/` — which an
earlier pass through this same session claimed wasn't present on this
machine — was there all along and current, just missed by an
insufficiently broad search.

**Fixed**: `mapFoundryRollTable()` now falls back to `description` (run
through the same `foundryTextToPlain()` every other field already uses
for Foundry's rich-text HTML) whenever `name` is blank, rather than
assuming `name` is always where the value lives. Re-ran
`node scripts/import-foundry.js tables` against the real local checkout
— no GitHub fetching needed once it turned out to be present — and
confirmed **0 of 46 tables have any blank result names anymore**,
`critical-fumble-energy.json`'s 53 results now read like
`"I hope my insurance covers this! Apply the wound critical hit effect to
yourself..."` instead of `""`. Re-ran the range-consistency check too:
same pre-existing, benign quirks as before (two of the critical tables'
"53" max results include two extra rows Foundry itself uses as UI links
to the physical Critical Hit/Fumble card product and the "Extreme"
table variant, not real roll outcomes — harmless, the real 1–53 range is
still fully and correctly covered), nothing newly broken.

**Coverage after this second pass**: every category in `aon-cache` has
now been either fully hand-checked (`class-features`, `equipment`,
`conditions`, `effects`, `themes`, `theme-features`, `archetype-features`,
`racial-features`, `feats`, `spells`) or evaluated by whatever method
actually applies to its content shape (`rules`, `setting`, `tables`).
`races` needed one more round — see immediately below — since what got
hand-checked here was the normalized draft, not what's actually served.
That is not the same claim as "100% correct" — this checker can only
catch Foundry's data disagreeing with itself, never every signal
agreeing on the same wrong answer in principle — and every category
still has mismatches left as "uncertain" or "match" without individual
human review. But every category has now had the level of scrutiny this
pipeline is capable of giving it, and every finding — fixed, false
positive, or genuine-but-unfixable — is documented above rather than
silently absorbed.

#### `races`, again: the normalized-draft check wasn't checking what's served

Asked directly whether all imported data was "verified, checked, valid in
the aon cache." Tracing the actual serving path
([`import-aon-cache.js`](../WebApp/starfinder-tool/backend/scripts/import-aon-cache.js))
surfaced a real gap the answer above glossed over: `races`' hand-check
used `audit-race.js` against `DataEntry/output/races/*.json` — the
normalized draft `normalize-entries.js` builds, decomposed into
`ability_modifiers`/`size`/`traits`/`alternate_traits`. Nothing imports
that draft anywhere — not into the database, not back into `aon-cache`.
What actually gets pushed into the live `aon_entries` table is the raw
`aon-cache/races/*.json` entry instead: a single `data.effect` prose
blob plus `mechanics.abilityModifiers` (an `[{ability, value}]` array)
and `mechanics.tags` — confirmed live that `mechanics.modifiers` is empty
on every race, so traits exist only as unparsed prose in what's actually
served, nothing there to build a checkable claim from at all. The
`osharu`/`ghoran` fixes from the round above are real, but they landed in
a pipeline nothing currently reads.

New [`audit-race-raw.js`](../WebApp/starfinder-tool/backend/scripts/lib/audit-race-raw.js)
checks the one thing the raw shape actually has to check — ability score
adjustments — against the race's own prose, reusing the same
"Ability Adjustments ... Alternate Traits" region-extraction approach
proven out in `audit-race.js`. First run: 27 of 190 mismatches. Almost
all of them turned out to be a bug in this brand-new checker itself:
named sub-variant races (`Osharu (Gengen)`, `Kasatha (Nomad)`, `Human
(Gravity Dweller)`, ...) bundle their *entire* base race's page as their
own `data.effect`, with the variant's real numbers appearing much later
under an "Alternate Ability Adjustments" heading — grabbing the first
"Ability Adjustments" occurrence in the file (correct for
`audit-race.js`'s already-narrowed input, wrong here) silently grabbed
the base race's generic line instead every time. Confirmed directly, not
assumed: `human-gravity-dweller`'s stored `{str:+2, dex:+2, cha:-2}`
turned out to exactly match a sentence three "Ability Adjustments"
occurrences later than the one originally checked — *"These humans have
ability adjustments of +2 Strength, +2 Dexterity, and –2 Charisma"* —
under a "Gravity Dweller" sub-heading the first pass never reached.

Fixed by extracting the variant name from the entry's own `name` field
(the parenthetical, or the segment after the last comma for nested
variants like `Lashunta (Damaya, Hunter Legacy)`) and searching for a
paragraph naming that specific variant, instead of the first occurrence
of the heading. Re-ran: **27 mismatches down to 2**. Both of the
survivors hand-checked directly against the full raw file, not the
checker's verdict:
- **A real, confirmed bug — the same shape as `dessamar-instar`,
  independently found**: `gnome-bleachling.json` and `gnome-feychild.json`
  both stored `constitution: +2` where the source's shared base line
  ("Ability Adjustments+2 Wis, -2 Str, +2 Int") and the sibling
  `gnome-driftborn-gnebling.json` (which correctly has `wisdom`, not
  `constitution`, for the same shared base) both confirm it should be
  `wisdom`. Fixed in both files.
- **A confirmed false positive, a residual instance of the same
  extraction gap**: `gnome-driftborn-gnebling`'s own variant name,
  "Gnebling," never literally appears as a distinguishing term in the
  text, so extraction fell back to the generic first-occurrence path —
  which for gnomes lands on the *other* sibling's ("Dimorphic") base
  line, not "Driftborn"'s own "They gain +2 Dexterity. This replaces
  dimorphic." Read directly: stored `{wis:+2, str:-2, dex:+2}` correctly
  combines the shared base with Driftborn's own `+2 Dex` override — not
  a data bug, left as-is.

`races` now rests on the same footing as every other category: hand-
checked against the data that's actually served, not a disconnected
draft.

#### `mechanics.requirements` (feats/archetypes prerequisites): a real gap the audit never covered

Every round above checked `mechanics.modifiers`/`actions`/`abilityModifiers`
— never `mechanics.requirements`, the structured form of a feat's
Prerequisites line. Asked directly whether this meant prerequisites
couldn't be filtered on (e.g. for a combat-feat browser), and the honest
answer was worse than "unverified": checking it directly turned up two
real, confirmed, previously-unknown bugs, one in each of the two places a
requirement gets built.

**Bug 1, in `parsePrereqClause()` (`mechanics-parser.js`)**: its "is this a
feat name" check was just "starts with a capital letter, no punctuation"
— which is ordinary sentence-starting capitalization, true of nearly any
short clause regardless of content. Confirmed live across all 431 feats:
of 117 distinct clauses classified `hasFeat` before this fix, roughly
half weren't feat names at all — "Key ability score 19", "Mysticism 5
ranks", "Fly speed with average maneuverability or better", even a bare
race name ("Anassanoi"). Anything filtering "does this character have
the prerequisite feat X" would have silently and wrongly gated on
made-up feat names. Root cause: clauses split on `,`/`;` only carry a
trailing period if they were the *last* clause in the original sentence
(cut short by the split, not truncation) — so "Key ability score 19,
caster level 7." split into "Key ability score 19" (no period, wrongly
matched the loose feat-name shape) and " caster level 7." (kept its
period, correctly fell through to `raw`). Fixed by: adding a `skillRank`
type (`{skill, ranks}`) and a `trainedSkill` type (bare skill name, no
rank) — the single largest missing bucket, since a common prerequisite
shape ("Mysticism 5 ranks") had no home before this at all and fell
through to the equally-wrong `hasFeat` guess; extending `abilityScore` to
accept spelled-out ability names ("Strength 15") alongside abbreviations
("Str 15"); extending `minLevel` to accept bare "Level N" and "Character
level N" in addition to "5th level"; and tightening the `hasFeat` check
itself to reject any clause containing a digit or one of a list of
telltale non-feat-name words ("ranks", "score", "trait", "speed", "class
skill", "proficiency", ...), falling back to `raw` instead of guessing —
consistent with this file's own stated design ("prose it can't
confidently parse is kept as a `raw` fallback rather than guessed at").
Result across all 431 feats: `hasFeat` 161 → 70 (later 77, see below),
`raw` 432 → 328, `skillRank` and `trainedSkill` (0 before) → 85 and 5.
Applied by regenerating just `mechanics.requirements` from each feat's
existing `data.prerequisites` — not a full re-import — since nothing
else about the entry needed to change. `archetypes` uses the same parser
(`deriveArchetypeMechanics`) — checked too, 0/46 changed, its
prerequisite clauses were already simple enough not to trigger this bug.

**Bug 2, in `extractPrerequisitesFromText()` (`foundry-import.js`)**, found
while spot-checking the `raw` bucket for clauses that looked like they
shouldn't be there: 45 of 431 feats had their entire "Benefit: ..."
description text leaking into `data.prerequisites` itself, upstream of
the parser entirely — `bear-hug.json`'s prerequisites, for one, was 223
characters of the full feat description, not just its actual
prerequisite. Root cause traced against the real Foundry source, not
guessed: `bear-hug`'s own `system.requirements` field is empty, so the
importer falls back to regexing "Prerequisites: ..." out of the
description text, stopping at the next newline. But Foundry's source has
"Prerequisites: ..." and "Benefit: ..." as two separate `<p>` tags, and
`foundryTextToPlain()`'s HTML→text conversion doesn't reliably insert a
newline between block elements — so the newline-only stop condition ran
straight through into the entire rest of the feat, which then got fed to
`parsePrerequisites()` as if it were one comma-separated requirements
list, producing the garbled multi-clause `raw` entries visible in the
sample above (`crescendo-of-violence-combat.json`'s prerequisites, before
the fix, included an entire sentence about morale bonuses). Fixed by
stopping at a literal "Benefit:" as well as a newline — the near-
universal next heading in this format. Required a full
`node scripts/import-foundry.js feats` re-run (not just the surgical
requirements-only patch above) since this fixes `data.prerequisites`
itself, not just its derived `mechanics.requirements` — which meant
reapplying the three feats fixes from the earlier `equipment`/`feats`
hand-check round that a fresh import would otherwise have silently
reverted (`arcane-riposte`, `stand-strong-combat-teamwork`,
`polymorphic-titan`); reapplied and reverified against the fresh import,
not assumed to still be there. Confirmed after both fixes: 0/431 feats
have "Benefit:" leaking into `prerequisites` anymore.

Neither bug was novel-pattern-wise — both are the same "conservative
fallback would have been safer than confidently guessing wrong" lesson
this whole document keeps relearning in new fields — but neither had
ever been looked at before this, because no prior round in this pipeline
checked `mechanics.requirements` at all. Worth remembering: "every
category has been checked" was never the same claim as "every field in
every category has been checked," and it's worth periodically asking
which fields still haven't been.

#### `normalizeSource()`: several raw page-citation shapes never matched

Spotted live in the Compendium: entries citing the same book under
different-looking `source` values (`"CRB, p"` next to `"Starfinder Core
Rulebook"`), which both fragments the source filter dropdown into
duplicate buckets *and* silently breaks the GM's "Only my sources" filter
— `ownedSources.includes(r.source)` in `Compendium.jsx` does an exact
string match, so a book the GM has checked off as owned under its correct
name stops matching any entry whose `source` field got mangled into a
different string for the same book.

`normalizeSource()`'s original regex assumed one page-marker shape
(`pg`/`p` + optional `.`/`,` + digits) and silently degraded to storing
the *whole raw string* as the book name whenever real data deviated from
it. Collected every distinct raw `system.source` string and "Source:"
journal paragraph across the whole Foundry checkout (1,596 of them) and
diffed old-vs-new output to find every shape that broke, rather than
fixing one observed case and hoping the regex generalized:

- **A page *range* using "pp." instead of "pg"/"p"** (`"CRB, pp.
  316-317"`) — the alternation only knew `pg`/`p`, so on `"pp."` it fell
  through to matching a single stray `p`, corrupting the book capture to
  `"CRB, p"`. All 13 rules/setting entries citing a multi-page range hit
  this.
- **A period landing before the page token instead of after the book
  code** (`"GEM. pg 33"`, `"TR. pg 34"`) — left `"GEM."`/`"TR."` as the
  book name instead of resolving to the full title.
- **A page token with no digits at all** (`"EN pg."`, page left blank
  upstream) — the mandatory `\d+` never matched, so the whole raw string
  including the dangling `pg.` was stored as-is instead of at least
  resolving the book part.
- **A bare `"BOOK, ###"` citation with no `pg`/`p` token whatsoever**
  (`"CRB, 179"`, equipment/grenade_arrow_ii.json and its two siblings).
- **A free-text prefix in front of the real code**
  (`"Ysoki - CRB pg. 54"`, racial-features/cheek_pouches.json) — stored
  `"Ysoki - CRB"` as the book instead of recognizing `CRB` after the dash.

Rewrote `normalizeSource()` around a single permissive separator
(`[.,\s]*`) between the page token and its digits instead of one exact
punctuation shape, added the bare-`"BOOK, ###"` and dash-prefix fallbacks,
and confirmed via the full before/after diff that exactly 20 of the 1,596
distinct raw strings changed output — all genuine fixes, zero
regressions (one apparent 21st diff was an artifact of the throwaway test
script's own text extraction, not a real Foundry input). Six raw strings
that still don't parse to a page (`"Operative - Alternate Class
Feature"` and five siblings for other classes) are confirmed *not* a
parsing bug: that literally is the entire raw `system.source` value
Foundry stores for those alternate-class-feature entries — there never
was a book/page to extract, so passing it through unchanged is correct.

Also confirmed and deliberately left alone: a handful of raw Alien
Archive citations (`"AA#, p. 147"`, `"AA31, p. 51"`, `"AA#29, p. 53"`)
that don't specify which of the four Alien Archive volumes they mean (or,
for `"AA31"`, may be an upstream typo for `AA3`) — guessing the volume
risks attributing content to the wrong book, so these stay as their raw
code rather than being silently mapped to a possibly-wrong title.

Re-ran the same surgical resync used earlier in this document (recompute
via `mapFoundryItem()`/`mapFoundryJournalPage()`, merge only the affected
fields into the existing `aon-cache` entry) across all 16 Foundry-sourced
categories, extended this time to also sync `source`/`data.sourcePage`
(previously the resync only touched `data.effect`). 24 entries changed;
spot-checked that every `mechanics.*` hand-fix from earlier in this
document survived. Distinct `source` values across the whole cache: 211
→ 201.

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
