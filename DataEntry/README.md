# Data Entry Tool (planned)

A standalone Python GUI for hand-authoring Compendium JSON files (races
first, other categories later) — a guided form instead of raw JSON editing,
so entries come out structurally consistent and pre-validated. Not part of
the `WebApp/starfinder-tool` stack or the Orange Pi deployment (same idea as
`../MapCreator`): it runs on a workstation and produces JSON files that
later get imported into the app the normal way.

This doc is step one: pin down the schema and the GUI plan before writing
any GUI code. `race.schema.json` is a companion JSON Schema (draft-07) file
in `schema/` that both documents the shape formally and can be used to
validate files at save time. `lookups/` holds the closed-vocabulary lists
(sizes, creature types, abilities, skills, saves, conditions, sourcebooks)
that back every dropdown in the eventual GUI — see below.

## Lookups — the controlled vocabularies

Before the race form itself, the fields that need **autocomplete instead of
free text** need a single source of truth for their valid values. That's
`lookups/*.json` — one file per vocabulary, each `{ "_provenance": "...",
"values": [...] }`. The GUI's Comboboxes will populate directly from these
files (not hardcoded in Python), so adding a value later means editing JSON,
not code. Provenance matters here because these lists come from three very
different levels of confidence:

| File | Values | Confidence |
|---|---|---|
| `sizes.json` | 9: fine → colossal | High — standard d20/SF1e ladder, already what `race.schema.json` enforces for `size` |
| `abilities.json` | 6: `str/dex/con/int/wis/cha` + labels | High — copied verbatim from `frontend/src/lib/sfCalc.js` (the app's own canonical form) |
| `skills.json` | 20 skills, each with a `slug` and `key_ability` | High for names/key_ability (from `sfCalc.js` SKILLS) — the `slug` field (e.g. `life_science`) is a **new convention introduced here**, since the one reference file only ever exercised single-word slugs. Note: Profession's `key_ability` is the app's own fallback ("wis"), not a rule — profession's real key ability is chosen per-profession |
| `saves.json` | 3: fortitude/reflex/will | Matches `human.json`'s own convention (long words). Flagged as inconsistent with the rest of the app, which mostly uses short keys (`fort/ref/will`) — deliberate, not an oversight |
| `conditions.json` | 35 conditions | High — verbatim from `CharacterSheet.jsx`'s `STANDARD_CONDITIONS`, so a race's condition-reducing trait always names something the character sheet actually tracks |
| `sourcebooks.json` | 16 source codes + full titles | High — derived from `foundry-import.js`'s `SOURCE_BOOKS` map, same codes the Foundry importer already normalizes |
| `creature_types.json` | 13 types (aberration → vermin) | **Unverified.** Nothing in this codebase enumerates creature types — the Foundry importer and AoN scraper both pass `type`/`subtype` through as free text. This list is from general SF1e knowledge, not scraped from anything here. Check it against your actual rulebooks and edit the file directly if anything's off — it's the one list in this batch you shouldn't take on faith |

`race.schema.json` cross-references these where it can enforce them as a
closed enum (`type` now validates against the 13 creature types; `size`
already did). Skill/condition/sourcebook fields inside `bonus[]` stay as
plain strings in the schema with a description pointing at the relevant
lookup file — the actual enforcement for those is meant to happen at the
GUI layer (the Combobox only offers valid values), not doubled up in JSON
Schema, so there's one place to add a new skill or condition, not two.
`ability` effects (`bonus[].id` when `type: "ability"`, e.g.
`lowlight_vision`) are deliberately **not** in `lookups/` — racial special
abilities aren't a closed set the way skills or conditions are; that field
stays free text and just grows as new races need a new one.

## Where this fits

- Hand-authored files are the source of truth going forward (per the note
  that the existing scraped/Foundry-imported data has quality problems).
  This tool is what produces them.
- Files live at `\\orangepi3b\archivio\Archivio_V2\<slug>.json` today, one
  per race, flat. Worth revisiting once more categories exist — e.g. a
  `races/`, `classes/`, `feats/` split — but the tool should default to
  today's flat convention until that's decided.
- Getting these into the actual app (`aon_entries` table) is a separate,
  later step — a small importer script, not part of this tool. This tool's
  only job is producing clean JSON.

## Race schema (normalized)

Based on `human.json` as the reference "dream" shape, with one change: **all
modifier/quantity values are integers**, never strings like `"+2"`. The
reference file mixes both (`"special": "+2"` but `alternate_abilities[1].str:
"+2"` vs `alternate_abilities[0].str: -2` in the same object) — that
inconsistency is exactly the kind of thing hand-editing raw JSON lets slip
through, and exactly what a form-based GUI with typed number fields
eliminates by construction. Validating `human.json` against
`schema/race.schema.json` produces 9 errors, all `'+2' is not of type
'integer'` — normalizing those to `2` validates clean.

| Field | Type | Notes |
|---|---|---|
| `name` | string | slug, lowercase, matches filename |
| `type` | enum | creature type, e.g. `humanoid` — see `lookups/creature_types.json` |
| `subtype` | string | free text, e.g. `human` — not a closed vocabulary |
| `size` | enum | see `lookups/sizes.json` |
| `hp` | integer | racial HP |
| `ability_modifiers` | object | `str/dex/con/int/wis/cha`: integer, or the literal `"any"` (player picks); `special`: integer, the amount applied to each `"any"` slot |
| `bonus_feats` | object, optional | `qty` (int), `condition` (`level`/`always`), `condition_spec` (int, e.g. the level), `description` |
| `trait` | object | the race's one default fixed trait: `id`, `description` |
| `alternate_abilities[]` | array, optional | swaps the *entire* `ability_modifiers` block; each has `name`, `id`, `source`, `page`, `description`, `ability_modifiers` |
| `alternate_traits[]` | array, optional | swaps out `trait` (or another alt trait); each has `id`, `name`, `source`, `page`, `description`, `bonus[]`, `replaces` (id it swaps out) |
| `alternate_traits[].bonus[]` | array | typed effect objects — see below |
| `description_rulebook` | object | prose block: `race_description`, `race_likely[]`, `race_seen_by_others[]`, `description_physical`, `home_world`, `society_alignment`, `relations`, `adventurers`, `names` |

`bonus[]` effect shapes (tagged by `type`) — this is a small, **extensible**
effect vocabulary; when a new alternate trait needs an effect this list
doesn't cover, add a new `type` and document its shape here and in the
schema rather than overloading an existing one:

| `type` | Fields |
|---|---|
| `skill` | `value` (skill slug from `lookups/skills.json`), `qty` (int), `notes` (string or null) |
| `ability` | `id` (special-ability slug, e.g. `lowlight_vision` — free text, not in `lookups/`), `mode` (`add`) |
| `save` | `id` (from `lookups/saves.json`), `qty` (int), `target` (optional situational tag) |
| `condition` | `value` (condition key from `lookups/conditions.json`), `mode` (`reduce`/`immune`), `qty` (int) |

## GUI plan

**Stack: `tkinter` + `ttk`**, stdlib only — no install step, fine for an
internal single-user form tool. `jsonschema` (one pip package) for
save-time validation against `race.schema.json`.

**Build it schema-driven, not hand-laid-out.** The whole point of pinning
the schema first is that a form generator can walk it and produce widgets,
so adding a field later (or a whole new category — class, feat, spell) means
editing the schema, not rewriting Tkinter layout code:

| Schema shape | Widget |
|---|---|
| short string | `ttk.Entry` |
| long prose string | `tk.Text`, scrollable, a few rows tall |
| enum | `ttk.Combobox`, values loaded from the matching `lookups/*.json` at startup |
| integer | `ttk.Spinbox` or a validated `ttk.Entry` (digits + optional leading `-`) |
| `abilityValue` (int or `"any"`) | `ttk.Combobox` with `any` plus a small integer range, editable |
| object (e.g. `trait`, `ability_modifiers`) | a labeled `ttk.LabelFrame` grouping its fields |
| array of objects (e.g. `alternate_traits`, `bonus[]`) | a `ttk.Treeview` list + Add/Edit/Remove buttons opening a sub-form dialog for one item; the sub-form for `bonus[]` swaps its fields based on the chosen `type` (mirrors the schema's `if/then` branches) |
| array of strings (e.g. `race_likely`) | simple list editor: `ttk.Treeview` (single column) + Add/Remove, edit-in-place on double-click |

Recommended structure once building starts:

```
DataEntry/
  README.md              <- this file
  schema/
    race.schema.json
  lookups/
    sizes.json, creature_types.json, abilities.json,
    skills.json, saves.json, conditions.json, sourcebooks.json
  app.py                  <- entry point, opens the main window
  formgen.py               <- schema -> widget-tree builder (the reusable part)
  widgets/
    ability_modifiers.py   <- reusable 6-ability sub-form (used at top level AND inside alternate_abilities)
    repeating_list.py       <- generic Treeview + Add/Edit/Remove list editor
  io.py                    <- load/save/validate against schema/*.json, and load lookups/*.json for Comboboxes
```

The `AbilityModifiers` sub-form and the generic repeating-list editor are
worth building as reusable pieces from day one, since `ability_modifiers`
appears twice in this schema alone (top level and inside each alternate
ability), and every future category (classes, feats, spells) will need its
own repeating array sections.

## Open questions (before writing GUI code)

- `lookups/creature_types.json` is unverified (see table above) — worth a
  pass against your actual sourcebooks before the race form leans on it as
  a closed enum, since a wrong/missing type would block saving a real race.
- Per-category subfolder layout in `Archivio_V2`, or keep it flat? Affects
  the file-save path logic.
- Should the tool also *load* an existing file for editing (not just create
  new ones)? Given races will get corrections over time, probably yes —
  worth deciding before `io.py` is written, not after.
- Once class/feat/spell schemas are ready, does each get its own
  `*.schema.json` + its own sub-form, sharing `formgen.py`/`repeating_list.py`?
  (Recommended — keeps the pattern consistent as categories grow.)

## Next step

Say the word and I'll scaffold `app.py`/`formgen.py` per the plan above,
starting with just the race form (enough to replace hand-editing
`human.json`-shaped files), then extend to other categories once their
reference JSONs exist.
