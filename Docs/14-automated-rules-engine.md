# 14 - Automated Rules Engine — Design Doc v1

Status: **proposal, not started.** This lays out the concepts and a phased
plan for review before any code is written — same role `10-galaxy-mapgen.md`
played before GalaxyGen's first line of code.

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
track effect durations against a turn/round counter.

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
  confirmation before committing, same review-gate pattern already used
  elsewhere in the app (Campaign entries, Compendium sourcing).

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

A small, sandboxed evaluator for formula strings like
`max(1, floor(@attributes.baseAttackBonus.value/2))` or a duration formula
like `@details.cl.value` (rounds). **Not `eval()`** — a restricted
recursive-descent parser supporting: `@`-path lookups against the
Character Context, arithmetic, `max`/`min`/`floor`/`ceil`, and dice
notation (`1d6`) *as a formula component*, not as a replacement for
physical dice. That distinction matters and is worth stating plainly:
players roll IRL (per the project's own stated design, `12-project-scope-
overview.md` assumes physical presence) — this evaluator is for things
*the system* computes on its own (a spell's duration in rounds, a DC, a
scaling bonus), never for rolling an attack or damage roll a human is
expected to roll and report.

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
   GM confirmation before writing it — same review-gate pattern as
   everywhere else in the app, not a silent auto-write.

## 8. Duration & turn tracking

Needs a minimal round/turn concept that plainly doesn't exist yet
(§3) — not necessarily a *full* initiative tracker (ordering combatants,
delay/ready actions, etc. — that's its own scoping question, §9) but at
minimum a per-encounter round counter and an "advance round" action that:
decrements every active effect's remaining duration, auto-expires
anything that hits zero, and surfaces expirations to the GM as a visible
notification rather than a silent disappearance ("Shaken expired on
Kira").

## 9. Open design questions

Left genuinely open rather than resolved by guessing — worth a decision
before or during Phase 3 (§10), not blocking Phases 1-2:

- **Where do active effects live?** A dedicated table (joined to both
  `characters` and `battle_sessions`, since effects are inherently
  encounter-scoped) reads as more correct than another JSONB blob on
  `characters` — but this is a real schema call, not decided here.
- **Does duration tracking need a full initiative *order*, or just a
  round counter?** A bare "Next Round" button is far cheaper than
  building turn order, delay/ready, etc. and might be enough for
  duration purposes alone — full initiative is its own feature
  (`12-project-scope-overview.md` §9 already lists it separately as
  not-yet-built) that this doc doesn't need to bundle in.
- **How does this relate to the still-missing "attach a Compendium entry
  to a character" UI?** Effective-stat computation (§5) needs it for
  *permanent* modifiers (a taken feat); it's not needed for the
  Phase-3-and-later *active-effects* half, which can start from
  manually-applied conditions regardless. Worth deciding whether that UI
  becomes an explicit prerequisite phase here or ships as its own
  unrelated piece of work.
- **Class resource pools** (`@resources.<classKey>.<name>.value` —
  Stellar Mode, Evolution Track, Entropic Pool, ...) — referenced by some
  formulas per `Docs/04-data-pipeline-aon.md`'s Modifiers glossary, but
  what tracks *those* isn't scoped here at all yet.

## 10. Phased delivery roadmap

Ordered so each phase is independently useful and later phases build on
state already established, same intent as GalaxyGen's phasing.

1. **Character Context + formula evaluator** (§4, §4.1) — no UI change,
   a pure computation layer with real test coverage (feed it a known
   character + known formula, assert the resolved number). Everything
   else depends on this being right first.
2. **Effective stat computation, read-only** (§5) — surface computed vs.
   base values on the character sheet for *permanent* modifiers only
   (feats/gear already on the sheet). Depends on §9's "attach a Compendium
   entry" question being resolved one way or another — flag this
   explicitly when scoping the phase in detail, don't discover it mid-build.
3. **Active effects data model + manual GM UI** (§6) — a GM can apply/
   remove a named effect (starting from conditions, which already carry
   real `mechanics.modifiers`) and see it factor into §5's computation.
   No duration/expiry yet — that's Phase 5.
4. **Damage resolution flow** (§7) — GM enters damage taken, sees the
   proposed SP/HP split (with resistances applied from Phase 3's active
   effects), confirms.
5. **Round counter + duration expiry** (§8) — the piece Phase 3's active
   effects were missing: a duration actually counts down and effects
   expire, visibly, as rounds advance.
