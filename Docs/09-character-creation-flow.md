# Character creation — guided flow

Source of truth: [AoN Chapter 2: Character Creation](https://www.aonsrd.com/Rules.aspx?ID=30)
(*Starfinder Core Rulebook* pg. 12–41). This doc (a) condenses that chapter
into the steps our wizard must cover, (b) says how each step plugs into
things that already exist in this repo (`owned_sources` setting, `aon_entries`
table, `characters` table/route), and (c) schematizes the new GM-controlled
"new PC wealth limit" setting. It replaces the placeholder version of this
doc — nothing here is built yet; this is the implementation plan.

## 1. What AoN actually specifies

Nine ordered steps (order is a suggestion, not a hard requirement — see
below on why the wizard should still default to enforcing it):

| # | Step | Depends on | Produces |
|---|---|---|---|
| 1 | Concept | — | free text (name, pronouns, description) |
| 2 | Race | — | ability score adjustments, racial HP, languages, racial abilities, size |
| 3 | Theme | — | +1 to one ability score, skill bonus(es), theme feature |
| 4 | Class | — | key ability score, BAB progression, save progression, SP/level, skill ranks/level |
| 5 | Finalize ability scores | Race + Theme + Class known | 6 final scores + modifiers |
| 6 | Apply class | Ability scores final | HP, SP, RP, BAB, saves, 1st-level class features |
| 7 | Skill ranks + feats | Int modifier, class skill list | skill ranks allocated, feats chosen |
| 8 | Buy equipment | none (uses starting credits) | weapons/armor/gear, remaining credits |
| 9 | Finishing details | everything above | alignment, EAC/KAC, attack bonuses, carrying capacity, initiative, languages, homeworld, starship |

Ability scores (step 5) have three methods in AoN; **this implementation
offers only the first two** (point buy, quick array) — the roll 4d6
method is intentionally not built, per the "no die throw method" call:

- **Point buy** ("buying ability scores"): start at 10 all six, apply
  race/theme adjustments, then spend a pool of **10 points** 1-for-1, no
  score may exceed 18 pre-adjustment... actually cap is 18 *after* race/theme
  too (race/theme can't push it over 18 either — excess is lost).
- **Quick array**: pick one of three fixed arrays (Focused
  `18,14,11,10,10,10` / Split `16,16,11,10,10,10` / Versatile
  `14,14,14,11,10,10`), assign values to abilities freely. Race/theme
  adjustments **do not apply** under this method.
- ~~Roll 4d6 drop lowest~~ — not implemented.

Derived stats with fixed formulas the wizard must compute automatically
(this is the "no manual math for the player" requirement from
[03-features-scope.md](03-features-scope.md)):

- **HP** = race base + Σ class HP/level
- **SP** = Σ (class SP/level + Con modifier), floor 0 per level
- **RP** = max(1, floor(level/2) + key ability modifier)
- **EAC/KAC** = 10 + Dex mod + armor bonus (KAC also gets armor's KAC bonus)
- **Skill ranks/level** = max(1, Int mod + class base), class skills get +3
- **Starting credits** = 1,000 (core default) — **this is the value the new
  GM setting overrides**, see §4.

## 2. Where "available sources" already plugs in

`SourcesConfig.jsx` + the `owned_sources` setting
([settings.js](../WebApp/starfinder-tool/backend/src/routes/settings.js))
already exist and are read by the Compendium as a default filter. Character
creation must use the **same** setting, not a separate one:

- Steps 2/3/4 (race, theme, class) and step 7's feat picker all query
  `/api/aon?category=races|themes|classes|feats&sources=<owned_sources>`.
- If `owned_sources` is empty (GM hasn't restricted anything), fall back to
  showing everything — same "uncheck all to show everything" behavior
  `SourcesConfig` already documents.
- Equipment (step 8) filters the same way against
  `category=weapons|armor|augmentations|gear` etc.
- This means the wizard needs **no new backend endpoint** for source
  filtering — it's a consumer of `/api/aon`, exactly like Compendium is.

## 3. New GM setting: starting wealth limit for new PCs

**Problem it solves**: step 8 assumes a fresh 1st-level party (1,000 cr
each). When a new player joins a table with an already-running campaign,
their starting credits should reflect the *current* party's wealth, not the
core rulebook's 1st-level default — otherwise the new PC is either crippled
or absurdly overfunded relative to the group.

**Design**: a settings key, `new_pc_wealth_limit`, following the exact same
generic key/value pattern as `owned_sources` — no schema change needed,
`settings.js` already supports arbitrary keys.

```
{ "value": { "mode": "manual" | "auto", "credits": 4500 } }
```

- `mode: "manual"` — GM types a flat credits number. Simplest case (also
  the only mode needed for `credits: 1000` at campaign start).
- `mode: "auto"` — computed suggestion: GM opens the same settings panel,
  backend returns the current average of `characters.credits` (GM-only
  query, mirrors the `r.get("/", requireGM, …)` handler in
  [characters.js](../WebApp/starfinder-tool/backend/src/routes/characters.js)) plus any equipped-gear value already
  tracked, and the GM can accept or override it before saving. This keeps
  it a GM decision, not silent automation — matches the "automation later,
  v1 tracks state manually" principle in
  [03-features-scope.md](03-features-scope.md).

**Where it surfaces**:
- A new small panel next to `SourcesConfig` in the GM console's Sources tab
  (or its own tab — see [08-ui-tabs.md](08-ui-tabs.md) for how cheap it is
  to add either), reusing the same load/dirty/save pattern already in
  `SourcesConfig.jsx`.
- Step 8 of the wizard reads `/api/settings/new_pc_wealth_limit` and uses
  `.credits` as the starting pool instead of the hardcoded 1,000, showing
  the GM-set number with a short label ("Starting credits: 4,500 — set by
  your GM based on the current party").
- No enforcement beyond the wizard defaulting to it — a GM can still hand-
  edit `characters.credits` afterward via the existing PATCH route, same as
  today.

## 4. Wizard schematic (frontend)

New component `frontend/src/components/CharacterCreationWizard.jsx`, opened
from wherever "create a character" currently lives (today: the bare `POST
/api/characters` a player hits once with no ID — see
[characters.js:71](../WebApp/starfinder-tool/backend/src/routes/characters.js)).
Structure mirrors the tab pattern in
[08-ui-tabs.md](08-ui-tabs.md) but as a **linear stepper** instead of free-
jump tabs, since later steps depend on earlier answers:

```
STEPS = [
  { key: "concept",  label: "Concept" },
  { key: "race",     label: "Race" },
  { key: "theme",    label: "Theme" },
  { key: "class",    label: "Class" },
  { key: "abilities",label: "Ability Scores" },
  { key: "classfeat",label: "Class Features" },   // HP/SP/RP/BAB/saves auto-computed
  { key: "skills",   label: "Skills & Feats" },
  { key: "equipment",label: "Equipment" },
  { key: "finish",   label: "Finishing Details" },
];
```

- One `useState` for `step` index, one `draft` object accumulating answers
  across steps (not committed to the backend until the final step, to avoid
  a half-created character if the player abandons the flow partway).
- Back/Next controls; Next is disabled until the current step's required
  fields are filled. Mobile-first: single column, big tap targets, sticky
  Back/Next bar pinned to the bottom of the viewport (this is the "mobile
  friendly" requirement — most players will be doing this on a phone/tablet
  at the table, not the projector/GM display).
- Each of race/theme/class/feats/equipment steps is a searchable picker over
  `/api/aon`, filtered by `owned_sources` (§2) and by category — reuse
  Compendium's existing search/filter primitives rather than rebuilding.
- The abilities step offers the two methods from §1 as a radio toggle
  (Point Buy / Quick Array), each with its own tiny calculator; switching
  methods resets that step's picks (don't try to convert between methods).
- Derived-stat steps (classfeat, finish) render read-only computed values
  with the formulas from §1 — no input fields, just confirmation before
  Next.
- Final step's "Create Character" button does exactly one
  `POST /api/characters` with the fully assembled `draft` mapped onto the
  existing `FIELDS` list in
  [characters.js:9](../WebApp/starfinder-tool/backend/src/routes/characters.js) — no new backend
  route needed there either, since that endpoint already accepts every
  field the sheet uses (skills/feats/spells/equipment as JSONB, credits,
  etc.).

## 5. What actually needs building (checklist)

- [x] `new_pc_wealth_limit` settings panel (GM console) —
      `frontend/src/components/WealthLimitConfig.jsx`, same pattern as
      `SourcesConfig.jsx`, added next to it in the GM Sources tab
- [x] `CharacterCreationWizard.jsx` — 9-step linear stepper, mobile-first
- [x] Ability-score sub-calculators: point buy, quick array (no roll method)
- [x] Derived-stat computation helpers (HP/SP/RP/EAC/KAC/skill ranks) —
      `frontend/src/lib/sfCalc.js`, shared so `CharacterSheet.jsx` or a
      future level-up flow can reuse the same formulas
- [x] Wire wizard's race/theme/class/feat/equipment pickers to
      `/api/aon?...&sources=<owned_sources>`
- [x] Entry point: `Player.jsx`'s self-service "no character yet" branch now
      renders the wizard instead of the old bare 5-field form

## 6. Explicitly out of scope for this pass

- Leveling up an existing character past 1st level (AoN pg. 26) — separate
  flow, not covered here.
- Starship role assignment (step 9's "Starship" note) — deferred with
  starship combat generally, per
  [03-features-scope.md](03-features-scope.md).
- Enforcing `new_pc_wealth_limit` as a hard cap (blocking overspend) — v1 is
  advisory only, same "GM decides, app doesn't auto-enforce" stance as
  everything else in this doc.
