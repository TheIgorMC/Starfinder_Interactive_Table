# Galaxy Map Generator ("MapGen") — Design Doc v1

Status: **proposal, not started.** This is a structure for review before any
code is written.

## 1. What this is

An offline, workstation-run tool (same category as `MapCreator` — not part
of the Orange Pi / Dockge stack) that procedurally generates a galaxy: star
systems, the hyperlanes between them, the factions that control them, and
the sectors that group them. It's a **world-builder**, not a live-session
tool — GMs run it ahead of time, curate the output, and export it as content
SIT can serve.

Long-term intent (per the request): this should grow into a full
scale-invariant universe generator — galaxy → sector → system → planet →
surface (settlements, roads) — all procedurally generated, with the same
core primitives (nodes, edges, density fields) reused at every scale, and
eventually able to **react to described events** like a living simulator
(§9). This doc scopes **galaxy + sector + system + hyperlane + factions +
actors + events** as the v1 slice, and lays out the model so the smaller
scales (planets, surfaces) slot in without a redesign. §13 breaks delivery
into phased, independently-demoable chunks.

### Relationship to the rest of the repo

- Lives in its own top-level folder (`GalaxyGen/`), workstation-only,
  resource-heavy generation and local LLM inference (§10) are both fine
  here. Its stack is chosen on its own merits, not coupled to
  `MapCreator` — `MapCreator` is a separate, unstarted placeholder whose
  own future is an open question independent of this doc; nothing here
  should assume it exists or that they share scaffolding. Default pick: a
  plain Vite + React app run locally, matching the rest of the frontend
  stack and needing no desktop-app packaging — revisit only if a real
  packaging need (offline installer, native file-system access beyond
  what a browser grants, etc.) shows up later.
- Output is **content**, not code: it exports to the SDF content tree
  (`Docs/06-data-format-sdf.md`) under new categories (`systems`, `sectors`,
  `factions`, `organizations`, `actors`, `events`, `broadcasts` — schemas
  in §7). SIT's backend already serves arbitrary categories with zero code
  changes, so the web app just needs new *views*, not new plumbing.
- SIT never writes back into this tool's output — one-way, same
  read-only content contract any future offline tool in this repo would
  follow.

## 2. Core concepts

### 2.1 Galaxy
The top-level container: a seed, a 2D bounding area (galaxy map is
abstract/schematic, not literal astronomical scale), and everything below.

### 2.2 Density fields ("brushes")
Before any system exists, the galaxy is a set of continuous scalar fields
sampled over 2D space, painted by the GM with a brush tool (radius,
strength, falloff):

| Field | Range | Drives |
|---|---|---|
| Population density | 0–1 | System population, system count in area, planet colonization odds (future) |
| Commercial value (export) | 0–1 | What systems in the area produce/sell |
| Commercial need (import) | 0–1 | What systems in the area demand/buy |
| Hyperlane density | 0–1 | How richly connected systems in the area are |
| Dominion security | 0–1 | Baseline neutral government presence, input to war-chance (§4) |

Faction control and faction security are **not** hand-painted fields — they
are generated from faction seed points + strength (§4), since they need to
compete against each other rather than blend independently like the fields
above. War-chance is computed (§4), not painted directly.

These fields are the **single source of truth** generation reads from —
painting is done first (or iteratively, repaint-and-regenerate), and system
placement/stats/hyperlane density all derive from sampling the field at a
point plus noise. This keeps "denser here, sparser there" a one-brush-stroke
edit instead of hand-editing dozens of systems.

Implementation note: store each field as a coarse grid (e.g. 128×128 over
the galaxy bounds) of floats; brush strokes do a falloff-weighted blend into
the grid cells under the cursor; generation bilinear-samples the grid at any
point. Cheap, resolution-independent from the visual canvas.

### 2.3 Star systems
A system is a point in galaxy space with:
- Identity: name (generated, editable), seed, star type/class
- Stats sampled from the density fields at its position (± noise/jitter so
  neighboring systems aren't identical): population, export goods, import
  needs
- Contents placeholder: `bodies: []` — empty in v1, reserved for the future
  planet-generation pass (§8)
- `station_only: bool` — supports the requested "no full colony, just a
  station/outpost" case even before per-planet generation exists (a system
  can be marked as having no habitable colonization, only infrastructure)
- Faction ownership (§4), sector membership (§5)

### 2.4 Hyperlanes
Logical (not spatial-literal) edges between two systems. Generation target:
plausible-looking connectivity, not a literal straight-line graph —
every system reachable, denser clusters in high-hyperlane-density areas,
no absurd long-haul edges cutting across empty space unless deliberately
placed. Algorithm (§3, hyperlane generation stage) uses a proximity graph
pruned/thickened by the density field, same idea as the population brush
driving system placement.

Each hyperlane carries: length (derived), a danger/risk rating (derived from
war-chance + faction relations along the route), and optionally a capacity/
traffic tag for flavor (major trade route vs backwater spur).

## 3. Generation pipeline

Deterministic given a seed; re-running with the same seed + same brush state
reproduces the same galaxy. Each stage is individually re-rollable (e.g.
"reroll hyperlanes, keep systems") so curation doesn't mean starting over.

1. **Galaxy setup** — seed, bounds, brush grids initialized to a default
   (flat, or a simple radial falloff from center as a starting point).
2. **Sector drawing** — GM draws sector polygons marking which parts of the
   galaxy are colonized (§5); everything outside any sector stays empty
   space and is skipped by every later stage.
3. **Brush pass** — GM paints population/commercial/hyperlane/dominion-
   security fields, typically constrained to sector areas. Can be revisited
   at any time; later stages re-derive from whatever the fields currently
   look like.
4. **System placement** — Poisson-disc sampling *within sector polygons
   only*, weighted by the population field (denser field = smaller minimum
   spacing), so cluster/void shape follows the paint without manual
   placement. GM can also hand-place/lock individual systems that
   generation won't move or overwrite.
5. **System detail generation** — per system: sample local field values,
   apply noise, roll star type/name/population band/export-import
   tags from weighted tables. Sector focus (§5) biases the weighted tables
   for systems inside that sector.
6. **Hyperlane generation** — build a Delaunay triangulation over system
   positions, then prune edges using relative-neighborhood/Gabriel-graph
   rules for a natural look, then add back edges in high-hyperlane-density
   regions until local connectivity matches the field. Connectivity check
   (single connected component) runs after pruning; if disconnected, the
   cheapest bridging edge(s) are added back.
7. **Faction seeding & control resolution** — GM places major faction
   cores with a strength value; control fields resolve as a
   weighted-Voronoi contest between them (§4). A second pass then **fully
   automatically** seeds small local factions into any region where no
   single faction clears the ownership threshold, so borders end up
   fragmented rather than just "contested-by-two" — driven by GM-tunable
   parameters (density, minimum strength, threshold), not a per-faction
   review step. GM can still delete/edit any auto-seeded faction after the
   fact like any other generated content.
8. **Security & war-chance resolution** — Dominion security field +
   per-faction security/tolerance + aggression differentials resolve into a
   `war_chance` value per system/border, per §4's formula.
9. **Actor placement** — background actors (§6.1) are auto-seeded fully
   automatically, scaled by **both** system population and faction
   presence at that point (a populous system draws more background
   officials/merchants; a system with active faction contest draws more
   faction reps/functionaries per side, roughly proportional to each
   contesting faction's local control share) — see §6.1 for the formula
   shape. Curated actors (named, full detail) are added separately by the
   GM directly or via the AI creation surface (§9.1), at any time, not
   gated to this stage.
10. **(Future) Planet + surface generation** — see §8.

Every stage writes into the same in-memory galaxy graph; the UI lets the GM
inspect/override before moving to the next stage or exporting.

## 4. Factions

Factions are **not** sector-bound — a faction's territory is its own
continuous coverage field over the galaxy, independent of sector
boundaries, and can spread across several sectors or hold only a sliver of
one.

- A faction: name, color, government flavor tag, an **aggression** stat
  (0–1), and a **strength/reach** stat that governs how large a
  contiguous territory it can plausibly hold.
- **Control field**: like the density brushes in §2.2, each faction has an
  implicit control value (0–1) at every point in space, generated (not
  hand-painted per faction) from faction "seed" locations + strength,
  falling off with distance and competing against neighboring factions'
  fields (closest/strongest seed wins the point, similar to a weighted
  Voronoi diagram rather than a hard polygon).
- **Ownership rule**: a system is "owned" by a faction only where that
  faction's control value is ~100% at that point (no meaningful
  competition nearby). Anywhere control is split between two or more
  factions, the system is **contested**, not owned — this is the norm
  near borders, not an edge case.
- **Border fragmentation**: because control strength falls off with
  distance from a faction's core, border regions are naturally where
  control is weakest and most contested — generation should seed
  *more, smaller* factions in these low-single-faction-coverage areas
  rather than stretching one big faction thin. Concretely: after the
  major/core factions are seeded, a second faction-seeding pass runs
  **fully automatically** (no per-faction GM approval step, §12) in
  regions where no single faction's control clears a threshold,
  populating them with small local factions (warlords, independent
  outposts, minor houses) instead of leaving the area contested-by-two —
  governed entirely by tunable generation parameters (target density,
  minimum viable strength, the coverage threshold itself).
- **The Dominion**: one special, implicit faction representing the
  overarching government of the entire colonized region (not a sector, not
  a normal faction with a control field/territory — it's the baseline
  authority everywhere within colonized space, see §5). It doesn't compete
  for territory and isn't part of the aggression/war-chance contest; it
  exists for the security model below.
- Disputed/contested systems (claimed by two+ factions, or sitting in a
  low-single-faction-coverage border zone) are a first-class state.

### Security (two layers)

Every point in colonized space has two independent security values, both
0–1:

- **Dominion security** — the baseline government presence. Neutral: it
  enforces the same rules everywhere it's present (crime is crime), and is
  generally higher in the colonized core, thinner toward the frontier. This
  is itself a density field (§2.2-style), painted or derived from distance-
  to-core.
- **Faction security** — the local controlling faction's own enforcement
  in its territory. Not neutral: each faction can carry a `tolerated`
  tag list (e.g. a faction might tolerate smuggling or piracy against
  rivals but crack down on anything targeting its own citizens), so
  "high faction security" doesn't necessarily mean "safe for everyone,"
  just "well-policed by that faction's standards."

### War-chance

`war_chance` at a border point is a function of:

1. **Aggression differential** between the two (or more) contesting
   factions — a highly aggressive small faction pressing against a calmer
   neighbor raises it more than two low-aggression factions abutting each
   other.
2. **Local security (inverse)** — combined Dominion + faction security at
   that point pushes war-chance down; a heavily garrisoned Dominion
   world stays stable even between two aggressive factions, while an
   unguarded frontier system between two weak, aggressive minor factions
   is exactly where conflict should be likely.
3. Small/newly-seeded border factions (§4 above) therefore run naturally
   hot: low individual strength correlates with low security investment,
   which is precisely the "smaller factions in low-security systems are
   more aggressive" behavior requested — it falls out of the model rather
   than needing a special-cased rule.

Low result → border friction stays diplomatic (flavor hooks: trade
disputes, sanctions, smuggling tolerated by one side). High → active
conflict flag on the system, a state only — this tool marks *where*
conflict is plausible, it doesn't simulate combat.

**`war_chance` is always computed, never hand-set.** It's derived purely
from the galaxy's own data (control shares, aggression, security) per the
formula above, recomputed by GalaxyGen's engine any time one of those
inputs changes (initial generation, or any committed event that touches
control/aggression/security, §9). It's exported as a stored field on each
system (§7) because SIT's backend is a passive content server — it never
reimplements this formula, it just serves whatever GalaxyGen last
computed. Nothing in the AI event vocabulary (§9) can write to
`war_chance` directly; only its inputs.

## 5. Sectors

A sector is a **macro-region of the colonized part of the galaxy** — not
the whole galaxy. Most of the galaxy bounds (§2.1) is unclaimed/unexplored
space; sectors mark out the areas that have been settled and are worth
generating systems/hyperlanes/factions in. (Practically: system placement
in §3 step 4 only samples within sector boundaries, not the full galaxy
canvas — the empty space between/around sectors is deliberate, not a
generation gap.)

- A sector is a hand-drawn polygon boundary on the galaxy map (GM tool:
  draw/edit vertices, like a simple polygon editor) with a name and a
  **focus** tag (e.g. `mining`, `agriculture`, `industry`, `research`,
  `trade hub`, `frontier`).
- Sector focus is metadata that propagates downward: any system (and, once
  §8 lands, any planet) whose position falls inside the sector polygon
  inherits the focus as a default for its own generation — a `mining`
  sector biases its systems/planets toward extraction activity, resource
  exports, station-heavy (rather than full-colony) worlds, etc. Systems can
  still override the inherited default individually.
- Sectors are the natural container for the brush fields too: the brush
  tool can optionally be constrained to "paint within selected sector" so
  large-scale adjustments stay tidy.
- Sectors are purely a generation/organization boundary — they do **not**
  imply faction ownership (§4). A sector commonly contains territory from
  several factions, contested zones, and Dominion-secured core worlds all
  at once; a sector spanning a fragmented border is the normal case, not a
  special one.

## 6. Notable individuals & groups ("Actors")

Distinct from factions (§4), which are territory-holding political powers.
Actors are individual people or small groups that never own territory but
matter for **event involvement** — a faction leader, a system governor, a
bounty hunter, a smuggling ring, a mercenary company, a cult, a
corporation's local rep.

- Identity: name, `kind` (`individual` | `group`), flavor/role tag.
- **Affiliation**: a faction slug, or independent (`null`).
- **Location**: a system slug (base of operations). Most actors are
  anchored; `mobile: true` actors (roaming ships, traveling agents) instead
  carry a *last-known* location, updated by the `relocate` effect (§9) when
  an event moves them.
- **Influence** (0–1): rough scale of how much weight this actor carries —
  used the same way faction `strength` is, as a soft ceiling on how large
  an effect this actor alone can plausibly cause.
- **Status**: `active` | `deceased` | `disbanded` | `unknown`.
- **Reputation**: per-faction standing (mirrors faction `relationships`),
  so an actor can be trusted by one faction and hunted by another.

Why actors matter for events: many meaningful in-fiction events are
actor-driven, not faction-driven — "a notorious pirate captain starts
raiding the trade route," "the Governor of Kreel's Reach is assassinated."
Without a slug for that captain/governor, the event classification step
(§9) has nothing concrete to point `scope` at, and effects like "this
system's security drops because its garrison commander was killed" can't
be expressed at all — it would have to be smeared across the whole owning
faction, which is both less accurate and harder to walk back later. Actors
are also the natural target for **localized** effects: a governor's
assassination can swing that governor's home system hard without moving
the owning faction's broader territory — that distinction is exactly why
actors are their own entity rather than folded into factions.

### 6.1 Two generation tiers: background vs. curated

A galaxy with 500–2000 systems plausibly has thousands of politicians,
officials, and minor figures — far more than a GM can hand-place. So actors
are generated in two tiers, distinguished by an `origin` field:

- **Background** (`origin: "generated"`) — auto-seeded in bulk, cheap,
  fully automatic (no per-actor review): procedural name, a role tag
  (`senator`, `guild-rep`, `garrison-captain`, ...), affiliation, location,
  and a low influence value. Density scales with **both** inputs from §12:
  system population (more populous systems get more background
  officials/merchants/functionaries) **and** faction presence at that
  point (a system with active multi-faction contest gets more faction reps
  — roughly one small batch per faction with meaningful control share
  there, so a hot border system ends up with several factions' worth of
  minor officials, not just the population-driven baseline). A system with
  low population and a single uncontested owner gets the fewest background
  actors; a populous, contested border system gets the most. These exist
  so the galaxy *feels* populated and so an event/query has someone
  plausible to point at, not because the GM authored them.
- **Curated** (`origin: "authored"`) — created deliberately, by the GM
  directly or via the MCP/LLM interface (§9.1) on the GM's explicit
  instruction, e.g. *"add a politician to the Libertarian Party in Vernak,
  called Aria Valeran."* These get full detail, are individually reviewed
  like any other creation, and are never auto-pruned.
- **Promotion**: when an event elevates a background actor into real
  narrative significance (they trigger or are the target of a `moderate`+
  event), the effect engine flips their `origin` to `authored` so they
  stop being eligible for any future background-cleanup pass and their
  identity is now "locked in." A background actor never needs a *name*
  the GM chose until this happens — cheap procedural names are fine for
  the anonymous majority, and only promoted ones need to hold up under
  scrutiny.
- Background actors are the appropriate target for periodic pruning/
  regeneration (e.g. reroll all `generated`-origin actors on a full galaxy
  regen without touching anything `authored`) — exact lifecycle policy is
  a remaining tunable detail for Phase 4 (§12, §13), not a design
  question.

### 6.2 Parties & organizations (non-territorial)

Not every named group is a territorial power. "The Libertarian Party in
Vernak" is a local political party, not a faction with a control field
contesting territory (§4) — folding it into the Faction model would force
it to participate in the control-field contest and war-chance calculus it
has no business being part of. Instead, a lightweight **organization**
entity: name, ideology/flavor tag, an optional home system or sector
(local groups) or none (galaxy-spanning movements/guilds), a required
`parent_faction` (see below), and a member list of actor slugs. No control
field, no aggression, no territory.

An actor's `affiliation` field can point to either a `faction:` or a
`party:` slug (or `null` for unaffiliated) — see §7 for the updated schema.
This is also where the request's "shift political parties" language lives
literally: a `major`/`historic` event can move an organization's local
influence or membership, distinct from — and usually smaller in blast
radius than — a full faction-territory shift.

**On-the-fly creation always hooks onto a pre-existing faction (§12).**
Neither `create_actor` nor `create_organization` (§9.1) can ever mint a
brand-new territorial *Faction* — factions only ever come from the
generation pipeline (§3/§4), never from the AI creation surface. Every
organization created this way must set `parent_faction` to a faction slug
that already exists in the galaxy (or `dominion`) — a new local party is
always understood as operating within/aligned to an established faction's
sphere, never as a fully freestanding, untethered political entity. In
practice this makes the Aria Valeran flow (§9.1) two nested creations: the
new organization still needs the GM's request (or the classification step)
to resolve which existing faction it belongs under, and that resolution is
part of what shows up in the review diff before commit.

Actors are optional and GM-curation-heavy at the *curated* tier — a lean
galaxy with no hand-authored actors still works. Background actors,
conversely, are expected to exist in bulk once Phase 4 (§13) ships, purely
so the AI layer (§9) always has someone concrete to reference.

## 7. Export format (SDF)

Following `Docs/06-data-format-sdf.md`'s "define the payload here first"
rule, seven new categories:

### `systems/<slug>/entry.json`
```json
{
  "sdf": 1,
  "type": "system",
  "name": "Kreel's Reach",
  "summary": "Mining outpost system on the Vast Expanse border.",
  "tags": ["frontier", "mining", "border"],
  "data": {
    "position": { "x": 412, "y": 88 },
    "star_type": "K-type orange",
    "population": "outpost (< 500)",
    "station_only": true,
    "export": ["ore", "refined metals"],
    "import": ["food", "medical supplies"],
    "sector": "vast-expanse",
    "control": {
      "owner": null,
      "contested_by": [
        { "faction": "free-traders-coalition", "share": 0.55 },
        { "faction": "kreel-clans", "share": 0.4 }
      ]
    },
    "security": { "dominion": 0.15, "faction": 0.3 },
    "hyperlanes": ["absalom-junction", "the-drift"],
    "war_chance": 0.35,
    "bodies": []
  }
}
```
`control.owner` is only set when one faction's share clears the ownership
threshold (§4); otherwise it's `null` and `contested_by` lists everyone
with meaningful presence. A fully Dominion-secure interior world with no
faction contest would have `control: { "owner": "dominion", "contested_by": [] }`.

### `sectors/<slug>/entry.json`
```json
{
  "sdf": 1,
  "type": "sector",
  "name": "Vast Expanse",
  "summary": "Frontier mining sector along the coalition border.",
  "tags": ["frontier", "mining"],
  "data": {
    "boundary": [[380, 40], [460, 40], [460, 140], [380, 140]],
    "focus": "mining"
  }
}
```
No `controlling_factions` field — sectors are a generation/organization
boundary only (§5); ownership lives per-system on `control` above, since a
sector routinely mixes several factions' territory.

### `factions/<slug>/entry.json`
```json
{
  "sdf": 1,
  "type": "faction",
  "name": "Free Traders Coalition",
  "summary": "Loose merchant confederation, frontier border factions.",
  "tags": ["mercantile"],
  "data": {
    "color": "#c98a2b",
    "government": "confederation",
    "aggression": 0.2,
    "strength": 0.4,
    "control_seed": { "x": 430, "y": 60 },
    "tolerated_crimes": ["smuggling"],
    "relationships": { "stellar-hegemony": -0.4, "kreel-clans": 0.1 }
  }
}
```
`strength` + `control_seed` are the inputs to the control-field contest in
§4 (weighted Voronoi against other factions' seeds). The Dominion is not
exported as a `factions/` entry — it has no territory contest or
aggression/relationship stats, it's the implicit baseline everywhere in
colonized space, represented only via `security.dominion` on systems.

### `organizations/<slug>/entry.json`
```json
{
  "sdf": 1,
  "type": "organization",
  "name": "Vernak Libertarian Party",
  "summary": "Local political party advocating reduced Dominion oversight.",
  "tags": ["political-party", "local"],
  "data": {
    "ideology": "libertarian",
    "parent_faction": "dominion",
    "home_system": "vernak",
    "home_sector": null,
    "members": ["aria-valeran"],
    "local_influence": 0.2
  }
}
```
No control field, no aggression, no territory (§6.2) — organizations never
participate in the Faction contest in §4. `parent_faction` is required
(§6.2, §12) and names whose sphere the organization operates within — not
necessarily ideological alignment: this party campaigns *against* Dominion
oversight while still operating in Dominion-controlled Vernak, so
`parent_faction: "dominion"` correctly says "exists within Dominion
territory," not "supports the Dominion."

### `actors/<slug>/entry.json`
```json
{
  "sdf": 1,
  "type": "actor",
  "name": "Governor Yeselle Tarn",
  "summary": "Dominion-appointed governor of Kreel's Reach.",
  "tags": ["government", "dominion"],
  "data": {
    "kind": "individual",
    "origin": "authored",
    "affiliation": "faction:dominion",
    "location": "kreels-reach",
    "mobile": false,
    "influence": 0.4,
    "status": "active",
    "reputation": { "free-traders-coalition": 0.1, "kreel-clans": -0.5 }
  }
}
```
`affiliation` is a typed slug reference — `faction:<slug>`, `party:<slug>`
(§6.2), or `null` for unaffiliated. `origin` is `"generated"` (background,
§6.1) or `"authored"` (curated); a background actor promoted by an event
flips this to `"authored"` in place, keeping the same slug so existing
references stay valid.

### `events/<slug>/entry.json`
Schema and rationale in §9 (event record shape).

### `broadcasts/<slug>/entry.json`
Schema and rationale in §9.4 — ambient news/flavor content, distinct from
`events/` because it doesn't carry mechanical effects and isn't folded
into state replay.

`hyperlanes` are not their own category — they're a symmetric reference
list on each `system` entry (as above), which is enough for SIT to render
edges without needing an eighth category. Revisit only if hyperlanes need
their own metadata beyond what §3's hyperlane stage stores per-edge
(danger/capacity) — in that case a thin `hyperlanes/<slug>` category
referencing two system slugs is a small, backwards-compatible addition.

## 8. Future scope (not v1, but shapes the model above)

Explicitly deferred, called out so v1's data model doesn't box them out:

- **Planet generation inside a system** — populate `system.data.bodies[]`
  with rolled planets/moons/belts/stations, each getting its own
  habitability/resource-type roll influenced by the system's inherited
  sector focus (§5).
- **Colonization resolution** — decide which bodies in a system are
  colonized (population, government) vs extraction-only (station/outpost
  tending automated or minimal-crew mining/gathering, no surface
  settlement) vs untouched.
- **Surface maps** — for colonized planets or major stations, a second
  generation pass at a smaller scale reusing the *same* node/edge/density
  pattern from this doc: settlements as nodes (like systems), roads as
  edges (like hyperlanes), a local density field for population/land use
  instead of the galaxy-scale brushes. This is why §2–3 are written in
  terms of generic "nodes/edges/density fields" rather than
  system/hyperlane-specific logic — the same engine should serve both
  scales with different parameters, not a parallel implementation.
- Likely a shared "procedural graph generator" module used by both the
  galaxy pass and the future surface pass, rather than duplicating the
  Poisson-disc + Delaunay + density-sampling logic twice.

## 9. AI-agent event interface

Goal: let a GM (or an AI agent doing worldbuilding on the GM's behalf) talk
to the galaxy in plain language and have the tool respond with a
proportionate, deterministic change to state. Two distinct kinds of request
fall out of this:

- **Creation commands** — "add a politician to the Libertarian Party in
  Vernak, called Aria Valeran" (§9.1). Mints a new entity.
- **Events, at a chosen time-scale** — "the Kreel Clans lost a major battle
  to the Free Traders Coalition at Kreel's Reach" (a discrete happening),
  or "given current conditions, estimate how the Vast Expanse looks in a
  month" (a forward projection over a duration, §9.2). Changes existing
  entities.

Magnitude is the lever for "big events shift factions/politics, small ones
don't" — but within that lever, the actual numbers should be as specific
and well-grounded as the description supports, not just "hit the tier's
ceiling," and magnitude is deliberately independent from how much in-fiction
time an event spans (§9.2) — a catastrophe can be `historic` in a single
day; a slow month of nothing much is still `minor`.

The design keeps the LLM narrow on purpose: it **classifies and proposes**,
it doesn't **mutate**. State like control fields, security, and war-chance
are already derived/interlocking values (§4) — letting an LLM write to them
directly invites an inconsistent galaxy (e.g. it edits `war_chance` but
forgets to touch the aggression/security inputs it's derived from). So the
agent's job is to turn a request into a small structured call using a
fixed, closed vocabulary — either a creation command or an event's effect
ops, each delta specific; a plain deterministic **effect engine** (regular
code) validates, clamps, applies it, and re-derives anything downstream.

### 9.1 MCP / tool-call surface

Rather than one bespoke "classify event text" black box, the effect engine
is exposed as a small set of MCP tools any LLM client can call — this is
what makes ad hoc creation commands like the Aria Valeran example possible
without a separate code path from the event pipeline:

| Tool | Purpose | Review before commit? |
|---|---|---|
| `query_galaxy` | Read-only: fetch current state for any scope (system/faction/actor/org), plus recent event history — how the agent gets grounded context before proposing anything (§9's "more data in → better output" principle) | n/a (read-only) |
| `create_actor` | Mint a curated actor (§6.1) — name, kind, role, `affiliation`, `location` | Yes, but lightweight (single-entity diff) |
| `create_organization` | Mint a party/organization (§6.2) — `parent_faction` must resolve to an existing faction | Yes |
| `apply_event` | Submit a discrete, point-in-time event (§9.2 "authored" mode) | Yes, full diff (§9 pipeline) |
| `project_timestep` | Request a forward simulation over a duration (§9.2 "projection" mode) | Per-event, following the magnitude-based rule above — always decomposes into several linked events (§9.2), each reviewed or auto-committed individually |

Worked example — *"add a politician to the Libertarian Party in Vernak,
called Aria Valeran"*:
1. Agent calls `query_galaxy` for `system:vernak` and `party:vernak-*` to
   check whether a matching organization already exists, and to find which
   faction controls/is present at Vernak (needed for `parent_faction`, per
   §6.2/§12 — creation always hooks onto a pre-existing faction, never
   mints one).
2. If the party isn't found, the agent's proposal includes **both** a
   `create_organization` call (Vernak Libertarian Party, `parent_faction`
   set to whatever faction `query_galaxy` found controlling Vernak) and a
   `create_actor` call (Aria Valeran, `kind: individual`, `role: politician`,
   `affiliation: party:vernak-libertarian-party`, `location: vernak`,
   `origin: authored`) — bundled as one reviewable proposal rather than two
   separate silent writes, so the GM sees "this will also create a new
   party under \<faction\>" up front instead of it happening implicitly.
3. GM reviews, commits. Both entities exist with real slugs from then on.

If the GM's instruction had instead referenced an organization that already
exists, step 2 only proposes the `create_actor` call. Fuzzy-matching a
close-but-not-exact existing slug instead of proposing a new entity is a
smaller remaining implementation detail (default: always propose "create
new" explicitly rather than silently merge — safer, avoids conflating two
things the GM meant separately) — not a blocking design question, but flag
if a specific fuzzy-match behavior is wanted before Phase 6 (§13).

### 9.2 Time-stepped events: authored vs. projection

Two request modes, both producing the same event record shape (below), set
via `data.mode`:

- **`"authored"`** — a specific, described happening at a point in time.
  Magnitude drives effect size regardless of how short the elapsed time is
  — *"a black hole appeared from the Drift and destroyed 3 systems"* is
  `historic` magnitude on a `timestep` of a single day: three
  `set_system_status` effects (`destroyed`), which cascade — severed
  hyperlanes to/from those systems, and a re-derive pass on every
  neighboring system's `war_chance`/security/trade stats now that a
  neighbor and its control/population simply no longer exist.
- **`"projection"`** — a forward simulation request over a stated duration,
  not a specific narrated happening: *"given these conditions, estimate
  behavior in a month"*. **Resolved (§12): a projection always decomposes
  into several smaller linked events sharing the requested timeframe,
  never one rolled-up aggregate record** — "many events always, makes it
  easier to track." The classification step reasons over current
  aggression/security/tension/economic values across the requested scope
  and proposes a *set* of ordinary event records (each with its own
  smaller magnitude, its own effects, its own `timestamp` within the
  projected window) — e.g. one `minor` event for a slight uptick in
  `war_chance` on an already-tense border, a separate `minor` event for a
  trade-driven `adjust_control` nudge — rather than a single opaque
  "the border got 12% worse" blob. This keeps every change individually
  attributable and replayable (§9 pipeline step 5) exactly like any other
  event, and reuses the `minor`-skips-review behavior above so a batch of
  small projected events doesn't require a click-through per item. This
  mode is what the ambient/tick simulation stretch goal (Phase 8, §13)
  also runs on, just GM-triggered here instead of automatic.

### 9.3 Two-pass generation: broad selection, then deep detail

A galaxy at this scale (500–2000 systems, plus a large pool of background
actors, §6.1) is too much to hand an LLM as raw context on every request —
so every LLM-touching call in §9.1's surface actually runs as two passes
internally, not one:

- **Pass 1 — broad/coherence pass.** Cheap and wide. Input is a *compact
  index* of the galaxy — names, slugs, tags, rough stats, not full
  records — plus the request. Output is a short candidate list: which
  systems/factions/actors/organizations are plausibly relevant or coherent
  for this request (e.g. "which actors could plausibly be involved in a
  smuggling story near Absalom Junction" or "which sectors would a month's
  projection meaningfully touch given current tension levels"). This pass
  optimizes for *filtering*, not final content, and can lean on cheap
  retrieval (embedding similarity over entity summaries) rather than a full
  LLM call wherever that's sufficient — see §10 for what's realistic on
  local hardware.
- **Pass 2 — deep/detail pass.** Input is the *full* detail record for
  only the pass-1 shortlist (now small enough to fit comfortably in
  context) plus the original request. Output is the actual structured
  result: an event record (§9's effect ops + deltas + confidence) or a
  broadcast (§9.4). Because pass 2 only reasons over a handful of
  fully-detailed entities instead of the whole galaxy, it can be specific
  and grounded instead of inventing plausible-sounding but unanchored
  details.

This shape answers "the more data it has, the better" from a resource
standpoint too: pass 1 is what makes it *possible* to give pass 2 rich,
full detail without blowing the context budget — broad-then-narrow, not
one pass trying to do both jobs at once. Every tool in §9.1 (`apply_event`,
`project_timestep`, `create_actor`, and the broadcast generation in §9.4)
runs this same two-stage shape; it's described once here rather than
per-tool.

### 9.4 Broadcasts: ambient news & flavor content

Mechanical events (§9's effect ops) are how the galaxy's *state* changes.
But most of what a news outlet reports on any given day doesn't rise to
the level of a state-changing event at all — a massacre gets real
coverage and real effects, but the same bulletin also runs a piece on the
latest fashion trend or a new gadget release, and neither of those needs
to move a single delta. Both kinds matter at the table: the massacre is
plot, the gadget piece is texture — and texture is what makes a callback
possible ("the players see a billboard for the same gadget they heard
about on the news a few days before").

Broadcasts are a separate, lighter-weight SDF category (`broadcasts/<slug>`,
schema below) rather than a variant of `events/`, because their job is
different: they don't fold into the replay/state-reconstruction described
in §9's pipeline step 5, they're pure GM-facing prop content, generated
and logged so it can be **retrieved and reused** later instead of
reinvented — that reuse is the entire point (the billboard callback only
works if the tool remembers it already established that gadget).

```json
{
  "sdf": 1,
  "type": "broadcast",
  "name": "Pulseweave Gauntlet launch covered on Absalom Wire",
  "summary": "Consumer tech piece — new haptic gauntlet from a Vernak startup.",
  "tags": ["culture", "consumer-tech", "filler"],
  "data": {
    "timestamp": "3025-04-09",
    "outlet": "Absalom Wire",
    "topic": "consumer-tech",
    "source_event": null,
    "mentions": ["system:vernak", "organization:pulseweave-dynamics"],
    "headline": "Vernak's Pulseweave Dynamics unveils the Gauntlet Mk. II",
    "body": "Short broadcast/news-copy text (a couple sentences) — a table prop, not a full article.",
    "reusable": true
  }
}
```

- **`source_event`**: `null` for pure flavor content invented from ambient
  galaxy texture (sector focus, faction flavor, economic tags — no
  mechanical event behind it), or an `events/<slug>` reference when the
  broadcast is *coverage of* a real mechanical event (the massacre report
  would set `source_event: "battle-of-kreels-reach"`). Same generation
  request can plausibly produce a batch mixing both kinds — that's the
  "massacre alongside the fashion piece" pattern.
- **`mentions`**: same typed-slug scope list as events (§9), used to
  answer "what have we already established about X" — before generating
  new flavor content, pass 1 (§9.3) should check existing broadcasts
  mentioning the request's candidate entities so a second, contradictory
  gadget launch doesn't get invented for the same company next session.
- **`reusable`**: whether this broadcast is a good candidate for a later
  callback prop (billboard, overheard conversation) — most flavor content
  defaults `true`; a one-off breaking-news bulletin about a now-resolved
  event might be marked `false` once it's stale.
- Generation entry point: GM requests "today's news for \<sector/system\>"
  (or it's offered alongside committing a mechanical event, so the GM can
  optionally spin up coverage of what just happened in the same step).
  Runs through §9.3's two-pass shape: pass 1 shortlists which
  entities/topics are plausible subjects, pass 2 writes the actual
  headline/short body for each. **Deliberately kept simple per §12**: just
  generate a small batch (a handful — "one real story, a few filler
  pieces," not a dense simulated media landscape), each item short (a
  headline plus a couple sentences, table-prop length, not an article) —
  no proactive scheduling, no retention/cleanup system. It's flavor, not
  another subsystem to maintain.
- No GM review gate is required by default the way mechanical events get
  one (§9 pipeline step 3) — broadcasts don't touch state, so a wrong or
  odd one is low-stakes and easy to delete after the fact. The GM can still
  skim/edit the batch before it's logged if desired.

### Event record shape

New SDF category, `events/<slug>/entry.json`:

```json
{
  "sdf": 1,
  "type": "event",
  "name": "Battle of Kreel's Reach",
  "summary": "Free Traders Coalition routs Kreel Clan raiders at Kreel's Reach.",
  "tags": ["conflict", "border"],
  "data": {
    "timestamp": "3025-04-11",
    "timestep": { "amount": 1, "unit": "day" },
    "mode": "authored",
    "magnitude": "major",
    "scope": [
      "system:kreels-reach",
      "faction:free-traders-coalition",
      "faction:kreel-clans",
      "actor:governor-yeselle-tarn"
    ],
    "effects": [
      { "op": "adjust_control", "target": "kreels-reach", "faction": "free-traders-coalition", "delta": 0.27, "confidence": 0.8 },
      { "op": "adjust_relationship", "a": "free-traders-coalition", "b": "kreel-clans", "delta": -0.22, "confidence": 0.8 },
      { "op": "adjust_aggression", "faction": "kreel-clans", "delta": -0.08, "confidence": 0.6 },
      { "op": "adjust_reputation", "actor": "governor-yeselle-tarn", "faction": "free-traders-coalition", "delta": 0.1, "confidence": 0.5 }
    ],
    "narrative": "Free-form GM/agent text describing what happened — flavor/history only, not read by the effect engine."
  }
}
```
`timestep` and `mode` are what §9.2 hangs on: `timestep` is purely
descriptive elapsed in-fiction time, independent of `magnitude` (effect
size). A catastrophe event would set `timestep: { "amount": 1, "unit": "day" }`
alongside `magnitude: "historic"` and three `set_system_status` effects;
see §9.2 for the full worked example.

- **`magnitude`**: fixed enum `minor | moderate | major | historic`. Each
  tier maps to a max-effect **envelope** per op (a small config table,
  GM-tunable) — e.g. `minor` caps `adjust_control` at ±0.05, `major` allows
  up to ±0.35, `historic` can flip ownership outright. This is a hard
  ceiling, not a target — see delta precision below.
- **Delta precision vs. the magnitude envelope**: within its tier's
  envelope, the agent is expected to output the *specific* value it judges
  right for the event, not just max out the ceiling — a scuffle that
  "chases off some raiders" and a "decisive rout" might both be
  `minor`-to-`moderate` but should land at different points inside the
  range. This is the direct answer to "allow a specific delta to appear":
  magnitude bounds how big an effect *can* be, the description's detail is
  what determines how big it actually *is*.
- **`confidence`** (0–1, per effect): how well-grounded the number is in
  the source description and available context. **Confirmed (§12): the
  effect engine always pulls low-confidence deltas toward the midpoint of
  a narrower sub-range automatically** rather than trusting the AI's raw
  number at face value — this is engine-side, not just a note surfaced to
  the GM — while high-confidence, richly-detailed events are allowed to
  use more of the envelope. This operationalizes "the more data it has,
  the better": a one-line rumor and a detailed battle report can both be
  classified as `major`, but only the detailed one gets trusted for a
  precise, larger-magnitude number.
- **`effects`**: a closed vocabulary of ops, not arbitrary field writes.
  Faction/system ops: `adjust_control`, `adjust_relationship`,
  `adjust_aggression`, `adjust_security`, `set_owner`, `set_system_status`
  (`active | destroyed | quarantined | uninhabitable` — destroyed/
  quarantined cascades: severs that system's hyperlane edges and forces a
  security/war-chance re-derive on every former neighbor), `adjust_focus`
  (nudge a sector's focus weighting). Actor/org ops (§6): `adjust_influence`,
  `set_affiliation`, `relocate`, `set_status`, `adjust_reputation`.
  Generic: `add_tag`/`remove_tag`. Anything outside this vocabulary simply
  can't be expressed, which keeps the agent's surface area — and therefore
  what can go wrong — small and reviewable.
- **Ownership flips (`set_owner`, §12)**: not gated to `historic`
  magnitude — any magnitude *can* flip ownership, but only if it earns it.
  Two independent gates both have to clear: (1) the normal magnitude
  envelope for `adjust_control` above, and (2) a separate, fixed
  **minimum ownership-flip delta** (a tunable constant, proposed default
  ~0.15) that a control shift must clear on its own before `set_owner` is
  allowed to fire, regardless of tier. This is what "need a high delta
  though" means in practice: a `minor` event capped at ±0.05 can never
  flip ownership at all (its ceiling doesn't reach the flip threshold), a
  `moderate`/`major` event only flips it if the *specific* delta chosen
  (not just the tier) is large enough, and a system already sitting right
  at the edge of the ownership boundary doesn't tip over from a trivial
  nudge — the flip has to be earned by the event itself, not by proximity
  to the line.
- **`scope`**: every entity slug the event touches (systems, factions,
  actors), giving a queryable history later ("show every event that
  touched this actor" or "this faction's last five border incidents").

### Pipeline

1. GM (or agent) writes the request as plain text — a creation command, a
   discrete event, or a projection request (§9.1–9.2).
2. **Classify** (the LLM-touching step, via `query_galaxy` + the
   appropriate tool call from §9.1's surface, internally run as the
   broad-then-deep two-pass shape in §9.3): given the request, pass 1
   shortlists which entities are plausibly relevant, then pass 2 reasons
   over their full detail — live stats, recent event history from the log,
   and profiles of any actors/organizations involved — to produce a draft:
   a creation call, or an event record with scope, `timestep`/`mode`,
   magnitude, and effects with specific deltas + confidence, restricted to
   the op vocabulary above. More context in → more precise, more
   confidently-scored effects out; sparse input should widen the range of
   plausible deltas and lower confidence, not force a guess.
3. **Review**: required for `moderate`/`major`/`historic` events — the
   draft is shown as a diff before commit, e.g. "Kreel Clans control at
   Kreel's Reach: 0.55 → 0.28 (confidence 0.8); relationship FTC↔KC:
   0.10 → −0.12 (confidence 0.8)." **`minor`-magnitude events skip this
   gate by default (§12)** and auto-commit straight to step 4 — low enough
   stakes (envelope-capped, and never enough to flip ownership per the
   dedicated flip threshold above) that a click-through on every small
   flavor-adjacent event isn't worth the friction. Still visible after the
   fact in the event log (§9 pipeline step 5) for a GM who wants to catch
   something after it lands.
4. **Apply** (deterministic): the effect engine validates each effect
   against its op's magnitude envelope, applies the (possibly
   confidence-adjusted) delta to live state, and re-derives everything
   downstream — control field → ownership/contested recompute →
   `war_chance` recompute — since those stay derived values per §4 rather
   than independently stored.
5. **Log**: the event itself is exported as an `events/<slug>` entry —
   append-only. Replaying all events in timestamp order against the base
   generated galaxy reproduces current state, which gives undo (drop the
   last event, re-fold) and a browsable campaign timeline for free.

## 10. Model & inference strategy

Explicitly in scope, not an assumed detail: this may need to run on local
hardware, so model choice is a real design constraint, not an
implementation footnote. Target machine: **32GB system RAM (DDR4) + 8GB
VRAM (GDDR6) GPU** — a real but modest budget that shapes the two-pass
split in §9.3 directly rather than being incidental to it.

### What fits

- **~7B models, quantized (Q4_K_M or similar GGUF), fit entirely in 8GB
  VRAM** with room for a reasonable context window — fast, GPU-resident,
  good for anything latency-sensitive.
- **13B–34B models can run CPU-offloaded** (llama.cpp-style partial GPU
  offload, remainder in system RAM) within a 32GB budget, but noticeably
  slower — acceptable for a call the GM is willing to wait a few seconds
  to tens of seconds for, not for anything that needs to feel interactive.
- Running **several distinct large models concurrently** (a literal
  multi-model Mixture-of-Agents ensemble) does not fit this budget — 8GB
  VRAM holds one small model comfortably, not three.

### How this maps onto §9.3's two passes

The broad/deep split isn't just a context-budget trick — it's also the
right place to draw the hardware line:

- **Pass 1 (broad/coherence)** should stay cheap and GPU-resident: a small
  quantized model (~7B) for anything that genuinely needs LLM judgment,
  backed by plain embedding-similarity retrieval (not an LLM call at all)
  for pure shortlisting where similarity search is sufficient. This pass
  should feel fast since it may run on every request.
- **Pass 2 (deep/detail)** can afford to be slower and heavier, since it
  runs once per accepted request on an already-narrowed entity set: a
  larger CPU-offloaded model, or — closer to a genuine **Mixture-of-Agents**
  approach within this hardware budget — the *same* small GPU-resident
  model called multiple times with different roles (propose → critique for
  internal consistency → finalize) and the results reconciled, rather than
  several different large models running side by side. This "self-MoA"
  (one small model, multiple sequential passes/personas) is the realistic
  version of MoA on 8GB of VRAM; true multi-model MoA is a stretch goal at
  best on this hardware, worth revisiting only if the target machine
  changes.

### Selectable backend, local or cloud (§12)

Because §9.1 already exposes the effect engine as MCP tools rather than a
bespoke API tied to one model, "which model answers the tool calls" is a
swappable backend by construction — and **this is a firm requirement, not
just an architectural nicety**: the GM should be able to pick, per
deployment (or even per pass — pass 1 local, pass 2 cloud, say), whether
`query_galaxy`/`create_actor`/`apply_event`/`project_timestep` are served
by a local llama.cpp/Ollama-served model or a hosted API model. Concretely:
a settings panel (§11) exposing a model backend choice per pass, not a
hardcoded pick baked in at build time. This also means the local-hardware
constraint (32GB/8GB above) doesn't gate anything else — Phase 6 (§13) can
ship and be used against a hosted model day one, with local models as a
selectable, benchmarked-in-Phase-7 alternative behind the same setting,
not a blocking dependency.

### Not decided here

Concrete model picks aren't locked in by this doc — that needs actual
benchmarking once Phase 7 (§13) is reached (candidates worth trying: a
~7B instruction-tuned GGUF for pass 1, a 13B–14B for pass 2, both
swappable, both selectable alongside whichever hosted API model(s) the
tool also supports).

## 11. UI shape (sketch, for review)

- Canvas-based map view (2D, pan/zoom). Target scale is **500–1000 systems,
  up to ~2000** — comfortably within plain Canvas2D if rendering is
  reasonably careful (viewport culling, batched draws), but PixiJS is the
  safer default given hyperlane edges roughly double the draw count and
  several overlay layers (below) can be on at once; worth prototyping both
  early rather than assuming. React shell around it to match the rest of
  the frontend stack.
- Layer toggles: any brush field, faction control overlay (rendered as
  soft-edged territory blobs from the control field, not hard polygons —
  contested zones should visually read as blended/striped between
  factions), Dominion security, sector boundaries, hyperlane graph, actor
  markers (dimmed/smaller for `generated`-origin, full-weight for
  `authored`, §6.1) — each independently on/off so the map doesn't turn to
  noise.
- Tool palette: brush (per field, radius/strength/falloff), system
  place/lock, sector polygon draw, faction seed placement (position +
  strength), actor/organization placement, hyperlane manual add/remove
  (override generated edges).
- Inspector panel: click a system/sector/faction/actor/organization →
  editable property panel on the side, same "click node, edit panel"
  pattern as the rest of SIT's UI conventions (`Docs/08-ui-tabs.md` style,
  though this tool is standalone so it doesn't need to reuse that exact
  component). Clicking a contested system should show the control
  breakdown (§7's `contested_by` list) and the computed `war_chance`, not
  just a single owner.
- **AI/chat panel**: where the GM types creation commands, events, and
  projection requests (§9.1); shows the tool-call surface's proposed diff
  inline before commit, same review step as the rest of §9.
- **Event log panel**: chronological list of committed events, filterable
  by scope (system/faction/actor/organization) and by `mode`
  (authored/projection, §9.2); each entry expands to its diff and
  narrative text — the browsable timeline described in §9.
- **Broadcasts panel** ("today's news"): separate from the event log since
  broadcasts (§9.4) aren't state changes — a scrollable feed of generated
  news/flavor items, filterable by outlet/topic/mentioned entity, with a
  one-click "generate coverage" action next to any just-committed
  mechanical event and a "generate filler for \<sector\>" action for pure
  ambient content. This is the panel a GM skims mid-session for a prop
  line ("what's been in the news lately") or a callback.
- **Model settings panel**: per-pass backend selector (§10) — local
  (points at a running llama.cpp/Ollama endpoint) or cloud (hosted API
  model + key), independently for pass 1 and pass 2, not a single global
  toggle.
- Seed controls: global seed, per-stage reroll buttons, lock/pin individual
  systems so a reroll doesn't discard curated work.
- Export button: writes the SDF tree for GM review/copy into the content
  root described in `Docs/06-data-format-sdf.md`.

## 12. Design decisions

All prior open questions are resolved as of this revision; kept here as a
decisions log (with pointers to where each is reflected in the doc) rather
than deleted, so the reasoning stays visible. A short list of genuinely
unresolved *sub-details* — tunable constants rather than open design
choices — follows at the end.

1. **Stack**: chosen independently of `MapCreator` (§1) — default is a
   plain Vite + React app, no Electron packaging unless a real need
   emerges later.
2. **`war_chance`**: always computed by GalaxyGen from control/aggression/
   security, exported as a stored field on each system (§4) — never
   hand-edited, and nothing in the AI event vocabulary can write to it
   directly, only to its inputs.
3. **Border-faction auto-seeding** (§3 stage 7, §4): fully automatic,
   parameter-driven, no per-faction GM approval gate.
4. **Galaxy scale**: confirmed at 500–1000 systems, up to 2000 max (§11).
5. **Ownership flips** (§9, `set_owner`): not gated to `historic`
   magnitude — any magnitude can flip ownership, but only if the specific
   delta chosen clears a dedicated minimum ownership-flip threshold
   (proposed default ~0.15) independent of the magnitude envelope. "Need a
   high delta though" is enforced as this second, explicit gate.
6. **Review gate** (§9 pipeline step 3): required for `moderate`+ events;
   `minor`-magnitude events auto-commit without a GM click-through (still
   visible after the fact in the event log).
7. **Background actor density** (§6.1, §3 stage 9): scales with both
   system population and faction presence/contest at that point.
8. **Confidence handling** (§9): the effect engine always pulls
   low-confidence deltas toward a conservative sub-range automatically —
   engine-side, not just surfaced for GM judgment.
9. **On-the-fly creation** (§9.1, §6.2): `create_actor`/`create_organization`
   can never mint a brand-new territorial Faction — every organization
   requires `parent_faction` to resolve to an existing faction (or
   `dominion`); factions only ever come from the generation pipeline.
10. **Projection output shape** (§9.2): always decomposes into several
    smaller linked ordinary events sharing the projected timeframe, never
    a single aggregate record — keeps every change individually
    attributable and replayable.
11. **Broadcast volume** (§9.4): deliberately small — a handful of short,
    table-prop-length items per request, no proactive scheduling, no
    retention/cleanup system. Flavor only, not a subsystem to maintain.
12. **Model backend** (§10, §11): local and cloud are both first-class,
    independently selectable per pass via a settings panel — not a
    build-time pick, not local-only, not cloud-only.

### Remaining tunable constants (not design choices, just numbers to pick in playtesting)

- The exact ownership-flip minimum delta (point 5 above) — proposed
  default ~0.15, needs validation once Phase 5's effect engine (§13)
  exists to tune against.
- The exact background-actor density formula's coefficients (point 7
  above) — "scales with population and faction presence" is decided; the
  precise per-system count and its pruning/regen lifecycle on a full
  galaxy reroll is an implementation detail for Phase 4 (§13).

## 13. Delivery roadmap (phased, one tangible step per chunk)

Ordered so each phase is independently demoable and later phases only
build on state shapes already locked in earlier — no rework. The tool only
becomes a genuine "reacts to described events" simulator at Phase 6;
everything before it is what that simulator needs to exist first. Every
phase's output is real, exportable SDF content SIT can already serve with
zero backend changes — nothing here is throwaway work waiting on a "real"
release.

1. **Canvas & fields (no generation yet)** — seed/bounds setup, sector
   polygon drawing tool, brush painting for the density fields (§2.2) with
   grid storage + heatmap visualization. Deliverable: GM can mark colonized
   regions and paint population/commercial/hyperlane/security densities
   and see them rendered. No systems exist yet — this is purely the
   substrate everything else samples from.
2. **System & hyperlane generation** — Poisson-disc system placement
   inside sectors, per-system detail rolls, Delaunay+prune hyperlane graph
   with a connectivity guarantee, inspector panel for a system. Export
   `systems`/`sectors` per §7. Deliverable: press Generate, get a
   populated, fully connected galaxy that visibly reflects the painted
   fields, re-rollable per stage.
3. **Factions, control, security, war-chance** — faction seed placement +
   strength, weighted-Voronoi control resolution, border-fragmentation
   auto-seed pass, dual security model, war-chance formula (§4), territory
   overlay rendering. Export `factions`. Deliverable: map shows
   territory/contested zones, every system carries a computed
   `war_chance`, inspector shows the control breakdown.
4. **Notable actors & organizations** — actor data model (§6): manual
   (curated) placement first, affiliation (to a faction or a new
   lightweight `organization` entity, §6.2), location, influence,
   reputation, inspector support. Export `actors`/`organizations`.
   Deliverable: GM can plant named people/groups and local parties tied to
   systems/factions and see/edit them on the map — this is what gives
   future events something specific to point at besides "a faction."
   Bulk/background auto-seeding (§6.1) is a follow-up slice of this same
   phase once the manual side is solid, not a separate phase — it reuses
   the identical data shape, just generated instead of hand-entered.
5. **Manual event log & effect engine (no AI yet)** — event record schema
   including `timestep`/`mode` (§9.2), closed effect-op vocabulary (§9,
   including `set_system_status` and its cascade), deterministic effect
   engine that applies clamped deltas and re-derives dependent state
   (control → ownership → war-chance), append-only `events` export,
   replay/undo by re-folding the log. GM fills events by hand via a form —
   no LLM involved yet. Deliverable: GM logs "Battle of Kreel's Reach" (or
   a destructive `set_system_status` event) by picking ops/targets/deltas
   in a UI, sees a diff, commits, and can later replay history to
   reconstruct any past state. This phase has to be solid before AI
   touches anything, since it's the safety rail the AI writes through.
6. **AI tool-call layer (hosted model first)** — expose the MCP surface
   from §9.1 (`query_galaxy`, `create_actor`, `create_organization`,
   `apply_event`, `project_timestep`), single-pass to start against a
   hosted API model for correctness before optimizing for local inference.
   Deliverable: GM types a sentence — a creation command, a point-in-time
   event, or an "estimate behavior in a month" projection — and gets a
   structured, magnitude/timestep-aware proposal to approve or edit. This
   is the point the tool becomes the "reacts to described events"
   simulator from the original request.
7. **Two-pass architecture, broadcasts, and local-model validation** —
   split classification into the broad/deep two passes (§9.3); add the
   broadcast generation flow (§9.4: flavor/news content mixed with
   coverage of real events, `mentions`-based continuity so callbacks work);
   benchmark local model options for each pass against the hardware target
   in §10 and swap the backend behind the same tool surface. Deliverable:
   "generate today's news for this sector" produces a believable mixed
   batch (one real story, several filler pieces) referencing actual
   galaxy entities, running acceptably on the target local hardware — with
   the per-pass local/cloud selector (§12) as the built-in fallback if
   local quality doesn't hold up for a given pass.
8. **Ambient/tick simulation (stretch, only after Phase 7 is solid)** — an
   optional "advance time" action that runs `project_timestep`-style logic
   *unprompted*, generating small ambient events and broadcasts on its own
   from current tension/security/aggression levels without the GM asking.
   Turns the tool from "reacts/projects when told" into "quietly evolves
   between sessions." Explicitly a stretch goal — Phase 6's on-demand
   projection already covers the "estimate behavior in a month" use case.
9. **Planet/body generation & surfaces** — unchanged from §8: planet rolls
   inside systems, colonization resolution, surface-scale generation
   reusing the same node/edge/density engine. Comes after the galaxy-scale
   simulator (phases 1–7) is proven, per the scope note in §1.
