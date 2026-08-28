# 14 - Automated Rules Engine — Design Doc v1

Status: **Phase 1 (§4, §4.1) implemented and tested; Phases 2-6 not
started.** Open design questions in §9 are resolved. This lays out the
concepts and a phased plan for review before any code is written — same
role `10-galaxy-mapgen.md` played before GalaxyGen's first line of code.

## 1. What this is

Today, `mechanics.modifiers[]`/`mechanics.actions[]` exist on every AoN
entry (feats, spells, gear, conditions — see `04-data-pipeline-aon.md`)
and are now considerably more trustworthy than they were before this
session's grounded-audit pass. But nothing *reads* them at runtime. A
character's HP/SP/RP are plain numbers a player nudges with +/- steppers;
taking a feat that grants a skill bonus doesn't move any number on the
sheet; nothing tracks how long a buff lasts. This doc scopes the engine
that closes that gap: given a character (their permanent build) and a set
of currently-active effects (temporary conditions/buffs), compute their
real current stats, resolve incoming damage against those stats, and
track effect durations and per-turn action economy (standard/move/swift/
full/reaction) against a full initiative order.

**Explicitly out of scope for this doc**: battle-map geometry — AoE
shapes, range-limited targeting, movement enforcement, vision/darkvision/
fog-of-war. That's a separate, later design doc (flagged when this whole
initiative first came up) — a different problem (spatial reasoning on a
grid) from what's scoped here (arithmetic and state over a character
sheet). Nothing here should assume battle-map geometry exists yet.

## 2. Reconciling with "the GM decides, the app doesn't auto-enforce"

`12-project-scope-overview.md` §8 states this as a running theme, and
`03-features-scope.md` explicitly defers "automated rules enforcement"
past v1. This doc doesn't reverse that principle — it draws a sharper
line through it than "automated vs. not":

- **In scope: automating arithmetic/bookkeeping that follows
  deterministically from a fact already established.** The GM says "the
  ooze hits Kira for 18 damage" — a judgment call they already made
  (the attack connects, the amount rolled). What SP/HP split that 18
  resolves into, after resistances, is not a judgment call, it's
  arithmetic the game already defines — currently done by hand, error-prone,
  and exactly the kind of thing computers are for. Same logic for a
  buff's duration: the GM decides to cast the spell; how many rounds it
  lasts before expiring is not a decision, it's a countdown.
- **Still out of scope: automating judgment calls.** Whether an attack
  hits, whether a condition narratively makes sense to apply, whether a
  house rule overrides the printed one — none of that is this engine's
  job, and every irreversible step (see §6) still surfaces a GM
  confirmation before committing. **Correction from an earlier draft of
  this doc**: that confirmation step is not reusing an existing pattern —
  checked live, Campaign entries and Compendium sourcing have no approve/
  pending workflow, and the character sheet's HP/SP steppers write
  immediately on click (`frontend/src/components/CharacterSheet.jsx:94`,
  the `Pool` component). No confirm-before-write UI exists anywhere in the
  app today; this doc is what builds the first one, starting with damage
  resolution (§7).

Concretely: this engine computes numbers and proposes state changes; a
human still triggers every input and confirms every output. Nothing here
should ever silently change a character's sheet without that.

## 3. Current state (grounded in the actual schema, not assumed)

`characters` (`migrations/001_init.sql`, `008_character_sheet.sql`) is
flat scalar columns for pools/defenses (`hp_cur`, `hp_max`, `sp_cur`,
`eac`, `bab`, `save_fort`, ...) plus JSONB blobs for `skills`/`feats`/
`spells`/`equipment`/`conditions` — a snapshot of a character's *build*,
not a live combat state. `battle_sessions`/`tokens` have no round counter
and no initiative order at all. There is no table anywhere for "an effect
currently active on a character." All three are real gaps this doc's
phased plan (§7) has to fill, not just the computation logic on top.

Also still missing, and a real prerequisite for parts of this (see §7):
the README's own note that "the `feats` JSONB column already exists...
but there's currently no UI to attach a Compendium entry to a character."
Effective-stat computation (§5) needs *something* linking a character to
the specific Compendium entries granting their permanent modifiers —
today that link doesn't exist in a structured way for feats/gear, only as
free text.

## 4. Core concept: the Character Context

**Implemented**: `backend/src/rules-engine/character-context.js`. Built
and tested against the real `characters` schema/JSONB shapes (grounded
against `Docs/Example-Hephaistos-Joe.json` and `foundry-import.js`'s
`SKILL_NAMES`), not assumed — two real gaps surfaced doing that and are
called out in the code rather than papered over:

- `characters.class` is one flat, possibly-multiclass display string
  (`"Mechanic / Operative"`) with no per-class level breakdown stored
  anywhere. A single-class character's `classes[key].levels` is accurate;
  a multiclass character's *every* class reports the character's *total*
  level (a real overstatement for any class that isn't their only one).
  Fixing this needs a schema change (a `classes[]` table), out of scope
  for this pure computation layer.
- `characters.skills` is keyed by full skill name (`"Acrobatics"`), but
  every formula addresses `@skills.<3-letter-abbr>`. Two named
  specializations of the same base skill (`"Profession (Chef)"` and
  `"Profession (Pilot)"`) both collapse onto the single `pro` @-path —
  Foundry's own convention has no way to address a specific
  specialization, so this is a real limitation of the upstream formula
  vocabulary itself, not a bug in the join.
- Only `attributes.speed.land` is populated — `characters.speed` is the
  only speed column that exists (no flying/swimming/climbing/burrowing).
  A formula referencing one of those correctly throws in
  `evaluateFormula` rather than silently resolving to 0.

Every Foundry-derived formula (`Docs/04-data-pipeline-aon.md` → "The
Modifiers system") is written against a fixed `@`-path vocabulary —
`@abilities.str.mod`, `@attributes.baseAttackBonus.value`,
`@classes.<key>.levels`, `@skills.<abbr>.ranks`, `@details.level.value`,
`@details.cl.value`, and more. Nothing today builds that namespace from a
stored `characters` row — this is the single foundational piece
everything else depends on:

```js
buildCharacterContext(character) → {
  abilities: { str: { value, mod }, dex: {...}, ... },
  attributes: { baseAttackBonus: { value }, speed: { land: {...}, ... } },
  details: { level: { value }, cl: { value } },        // cl = caster level, per class
  classes: { soldier: { levels: 7 }, ... },
  skills: { acr: { ranks, mod }, ... },
  resources: { ... },                                   // class resource pools (§9, tunable)
}
```

Pure function, no side effects, cheap to call — the input to both the
formula evaluator (§4.1) and effective-stat computation (§5).

### 4.1 Formula evaluator

**Implemented**: `backend/src/rules-engine/formula-evaluator.js`, with
real test coverage in the matching `.test.js` (`npm test` in
`backend/`, Node's built-in `node --test` runner — no new dependency).

A small, sandboxed evaluator for formula strings like
`max(1, floor(@attributes.baseAttackBonus.value/2))` or a duration formula
like `@details.cl.value` (rounds). **Not `eval()`** — a restricted
recursive-descent parser. `@`-path lookups against the Character Context
and `+-*/` arithmetic were always the core; the function/operator set
below is not what this doc originally guessed at (`max`/`min`/`floor`/
`ceil` only) — checked live against all 184 distinct `@`-formulas
actually present across `aon-cache`'s `modifiers[]`/`duration` fields,
that original set covered barely half of them. What's actually needed,
and implemented:

- `max`/`min`/`floor`/`ceil`/`round`/`sign` — plain math.
- `eq`/`ne`/`gt`/`gte`/`lt`/`lte`/`ternary`/`lookup`/`lookupRange` —
  ported **verbatim** from the Foundry system's own
  `Roll.registerMathFunctions()` (`src/module/rolls/roll.js:91-124` in
  the local checkout), not reimplemented from a guess at their
  semantics — `lookupRange` in particular is a step function (the result
  attached to the highest threshold not greater than the input value)
  that a handful of class-scaling formulas (Envoy, Operative, Solarian,
  Evolutionist, Nanocyte) depend on getting exactly right.
- Dice notation (`1d6`) *as a formula component*, not as a replacement
  for physical dice — that distinction matters and is worth stating
  plainly: players roll IRL (per the project's own stated design,
  `12-project-scope-overview.md` assumes physical presence) — this
  evaluator is for things *the system* computes on its own (a spell's
  duration in rounds, a DC, a scaling bonus), never for rolling an
  attack or damage roll a human is expected to roll and report. Also
  covers **computed** dice counts/sides (`(floor(@item.level/3))d4`,
  `1d(ternary(gte(@classes.envoy.levels, 13), 8, 6))`), confirmed live
  as a real pattern across Solarian/Operative formulas, not a
  hypothetical.

Anything outside this grammar (property access, string literals, any
function not in the list above) is a syntax error, not a silent no-op —
confirmed live: `process.exit()` and `require('fs')` both throw rather
than doing anything.

## 5. Effective stat computation

Given a character's permanent build (their chosen feats/gear/race
traits — once linked, see §3) plus whatever's in their active-effects
list (§6), compute their *actual* current numbers. The stacking rule is
already documented, not something this doc invents: `mechanics-schema.js`
— "group active modifiers by `(effectType, type)` and take the max within
each typed group before summing across groups" (untyped/circumstance/
dodge always stack). This section is mostly "go implement exactly that,"
plus caching/recompute-on-change since it'll run often (every sheet
render, every effect toggle).

## 6. Active effects

New concept, distinct from permanent build data: a list of currently-live
modifiers on a character, each with:

- **Source** — which feat/condition/spell/item/effect granted it (a typed
  ref into `aon_entries`, reusing the Compendium's own category/name key).
- **The modifier itself** — the existing `Modifier` shape verbatim
  (`mechanics-schema.js`), so no new bonus vocabulary is invented; an
  active effect is just "one of this entry's `mechanics.modifiers[]`,
  currently turned on."
- **Granted-at** — round/timestamp it started.
- **Duration** — a *resolved* value (rounds/minutes/permanent), computed
  once via §4.1 from the granting entry's duration formula at the moment
  it's applied (so "1 round per caster level" becomes a concrete number
  the instant the GM confirms the spell was cast, not re-evaluated every
  tick).
- **Enabled** — mirrors Foundry's own convention already present on the
  `Modifier` shape; lets a GM toggle something off without deleting the
  record (useful for "the effect is real but temporarily suppressed").

## 7. Damage resolution

The concrete worked example from the original ask: GM states "Character X
takes 18 kinetic damage" (the hit/miss/amount judgment already made,
same as §2). The engine:

1. Reads X's current active-effects list for `energy-resistance`/
   `damage-reduction` modifiers matching the stated damage type, reduces
   the 18 accordingly.
2. Applies what's left: **Stamina Points absorb before Hit Points** (the
   actual SF1e rule, not a design choice this doc is making) — reduce
   `sp_cur` first, any remainder spills to `hp_cur`.
3. Surfaces the proposed split (e.g. "6 → SP (0 remaining), 12 → HP") for
   GM confirmation before writing it, via the new confirm-before-write UI
   this doc introduces (§2) — not a silent auto-write.

## 8. Initiative & duration tracking

Resolved (§9) as a **full initiative order**, not just a bare round
counter — schema sketch in §9. Three GM actions on a `battle_session`:

- **Start Combat** — GM enters each combatant's rolled initiative (players
  roll IRL, per the project's own physical-presence design — this is data
  entry, not a die roll the app performs) and locks that order into
  `initiative_order`; sets `round = 1`, `current_turn_index = 0`,
  `combat_active = true`.
- **Next Turn** — advances `current_turn_index`. Wrapping past the last
  combatant increments `round` and is also when every active effect's
  `duration_rounds` decrements; anything that hits zero auto-expires and
  surfaces to the GM as a visible notification, not a silent disappearance
  ("Shaken expired on Kira").
- **End Combat** — clears `combat_active` and the turn pointer; permanent
  (`duration_rounds = NULL`) active effects are untouched, round-bound ones
  are left at whatever they decremented to (a GM can still see/clear them
  manually from §6's UI).

Delay/ready actions are explicitly **not** part of this first pass —
ordering and turn advancement only. All three actions broadcast through
the existing WebSocket layer (`backend/src/ws.js`'s `broadcast()`, already
wired into every token mutation in `battlemap.js`) so the projector/tablet
views stay live, same as token movement today.

### Action economy within a turn

In scope alongside turn order, not a separate later add-on — it's the
same "deterministic bookkeeping that follows from a stated fact" as
everything else in §2, and the exact rule is already sitting in the
Compendium's own imported text (`aon_entries`, category `rule`, topic
"Actions in Combat", confirmed live from `aon-cache/rules/
actions-in-combat-actions-in-combat.json`): *"In a normal round, you can
perform one standard action, one move action, and one swift action, or
you can instead perform one full action... You can also take one
reaction each round, even if it isn't your turn... you regain your
reaction at the start of your turn."* That's also exactly the vocabulary
already on every entry's `mechanics.activation.type`
(`backend/src/foundry-import.js:219-221`, `mechanics-schema.js:23`) —
confirmed live across the cache: `action` (=standard, 1,450 entries),
`move` (316), `full` (180), `reaction` (307), `swift` (112), plus `none`/
`other`/`special` and time-based casting times (`round`/`min`/`hour`/
`day`) that aren't per-turn action-economy costs at all.

Tracked per row in `initiative_order` (not globally — a reaction can be
spent on someone else's turn, so each combatant needs their own budget,
not one shared per-round pool): `standard_used`, `move_used`,
`swift_used`, `full_used`, `reaction_used` (all BOOL). Toggling
`full_used` on also marks the other three used (a full action *is* your
standard+move+swift for the round, per the rule text above) — the
downgrade conversions (standard→move, standard/move→swift) don't need
their own state machine, since spending a converted action still just
consumes that slot's boolean regardless of what it was used for. **Next
Turn** (§8 above) resets `standard_used`/`move_used`/`swift_used`/
`full_used` to false for the combatant whose turn is starting, and
`reaction_used` to false as well — matching "you regain your reaction at
the start of your turn" exactly, not a blanket per-round reset for
everyone. A small widget on the current combatant's card lets the
GM/player mark each spent as declared, mirroring `mechanics.activation.
type` on whatever feat/spell/item was used where one exists.

## 9. Resolved design decisions

These were left open in an earlier draft; each is now grounded in the
actual schema/code (not assumed) before being decided.

- **Where do active effects live? → a new dedicated table,
  `active_effects`.** `characters.conditions`
  (`backend/migrations/008_character_sheet.sql:8`) already exists but is
  shaped `{ conditionKey: { active, notes } }`
  (`frontend/src/components/CharacterSheet.jsx:11-19`, `:161-167`) — a
  fixed checklist with no duration/round field and, confirmed by grepping
  the whole codebase for `aon_id`/`aon_entries`, no link to `aon_entries`
  at all. Retrofitting duration into it would break the existing simple
  toggle UI for no benefit, so this is new: `active_effects(id,
  character_id FK, battle_session_id FK NULL, source_category,
  source_name — a ref into aon_entries by (category, name), modifier
  JSONB — a snapshot of one Modifier object from mechanics-schema.js,
  granted_at_round INT, duration_rounds INT NULL — NULL means permanent,
  enabled BOOL, created_at)`. `battle_session_id` is nullable because not
  every active effect is encounter-scoped (e.g. a toggled permanent
  trait). The existing `conditions` checklist stays as-is for now —
  wiring it to also create a real `active_effects` row (with the matching
  `condition` entry's actual `mechanics.modifiers`) is later, separate
  work, not a Phase 4 blocker.

- **Duration tracking → full initiative order, not a bare round
  counter.** Confirmed live: `battle_sessions`
  (`backend/migrations/001_init.sql:43-51`) has no round or turn field
  today, but a WebSocket broadcast layer already exists
  (`backend/src/ws.js`, a `broadcast(type, payload)` helper already wired
  into every token mutation in `backend/src/routes/battlemap.js`) — the
  natural hook for turn/round events too. See §8 for the resulting
  schema and the three GM actions (Start Combat / Next Turn / End
  Combat). This expands `12-project-scope-overview.md` §9's "fully-built
  initiative tracker... not-yet-built" line into an active plan — that
  doc has a matching note pointing back here.

- **Relation to "attach a Compendium entry to a character" → its own
  explicit phase (Phase 2), ahead of effective-stat computation.** This
  turned out to be a bigger gap than originally described: it's not just
  a missing UI — `feats`/`equipment`/`spells` on `characters` are raw
  pass-through arrays from the Hephaistos importer
  (`backend/src/hephaistos.js:82-90`) with **no field anywhere** for an
  `aon_entries` reference. Phase 2 (§10) covers both a Hephaistos-import
  resolver (match imported feat/item names against `aon_entries` at
  import time, best-effort) and a manual attach UI for anything
  unresolved or homebrew. Effective-stat computation (renumbered to
  Phase 3) can't start without this landing first.

- **Class resource pools — still deferred, not scoped by this doc.**
  Confirmed nothing tracks these today beyond the generic `rp_cur`/
  `rp_max` columns (`backend/migrations/001_init.sql:22-23`) — no Stellar
  Mode, Evolution Track, Entropic Pool, or any other `@resources.<key>.*`
  target found anywhere in schema, backend, or frontend. Left open rather
  than guessed at; revisit only if a Phase 1 formula test actually needs
  `@resources.*` to resolve.

## 10. Phased delivery roadmap

Ordered so each phase is independently useful and later phases build on
state already established, same intent as GalaxyGen's phasing.

1. **Character Context + formula evaluator** (§4, §4.1) — **done.** No UI
   change, a pure computation layer with real test coverage (feed it a
   known character + known formula, assert the resolved number).
   Everything else depends on this being right first.
2. **Attach a Compendium entry to a character** (§9) — a Hephaistos-import
   resolver (match imported feat/item names against `aon_entries`) plus a
   manual attach UI for anything unresolved or homebrew. A genuine
   prerequisite, not optional: Phase 3 has nothing to read a permanent
   modifier from without it.
3. **Effective stat computation, read-only** (§5) — surface computed vs.
   base values on the character sheet for *permanent* modifiers (feats/
   gear now linked via Phase 2).
4. **Active effects data model + manual GM UI** (§6) — the new
   `active_effects` table (§9); a GM can apply/remove a named effect
   (starting from conditions, which already carry real
   `mechanics.modifiers`) and see it factor into §5's computation.
   No duration/expiry yet — that's Phase 6.
5. **Damage resolution flow** (§7) — GM enters damage taken, sees the
   proposed SP/HP split (with resistances applied from Phase 4's active
   effects), confirms via the new confirm-before-write UI (§2).
6. **Initiative order + duration expiry** (§8) — the full-initiative
   schema resolved in §9: Start Combat / Next Turn / End Combat, plus the
   piece Phase 4's active effects were missing — a duration actually
   counts down and effects expire, visibly, as turns advance. Action
   economy tracking (§8's "Action economy within a turn") lands in this
   same phase — it depends on the same `initiative_order` rows and the
   same Next Turn action, so there's no reason to split it out further.
