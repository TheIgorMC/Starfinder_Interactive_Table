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
core primitives (nodes, edges, density fields) reused at every scale. This
doc scopes **galaxy + sector + system + hyperlane** as the v1 slice, and
lays out the model so the smaller scales (planets, surfaces) slot in without
a redesign.

### Relationship to the rest of the repo

- Lives in its own top-level folder (`GalaxyGen/`, mirroring `MapCreator/`),
  workstation-only, resource-heavy generation is fine.
- Output is **content**, not code: it exports to the SDF content tree
  (`Docs/06-data-format-sdf.md`) under new categories (`systems`, `sectors`,
  `factions` — schemas in §6). SIT's backend already serves arbitrary
  categories with zero code changes, so the web app just needs new *views*,
  not new plumbing.
- SIT never writes back into this tool's output — one-way, same contract
  `MapCreator` will eventually use for battle maps.

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
  planet-generation pass (§7)
- `station_only: bool` — supports the requested "no full colony, just a
  station/outpost" case even before per-planet generation exists (a system
  can be marked as having no habitable colonization, only infrastructure)
- Faction ownership (§4), sector membership (§5)

### 2.4 Hyperlanes
Logical (not spatial-literal) edges between two systems. Generation target:
plausible-looking connectivity, not a literal straight-line graph —
every system reachable, denser clusters in high-hyperlane-density areas,
no absurd long-haul edges cutting across empty space unless deliberately
placed. Algorithm (§3.4) uses a proximity graph pruned/thickened by the
density field, same idea as the population brush driving system placement.

Each hyperlane carries: length (derived), a danger/risk rating (derived from
war tension + faction relations along the route), and optionally a capacity/
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
7. **Faction seeding & control resolution** — GM places (or auto-seeds)
   major faction cores with a strength value; control fields resolve as a
   weighted-Voronoi contest between them (§4). A second pass then seeds
   small local factions into any region where no single faction clears the
   ownership threshold, so borders end up fragmented rather than just
   "contested-by-two."
8. **Security & war-chance resolution** — Dominion security field +
   per-faction security/tolerance + aggression differentials resolve into a
   `war_chance` value per system/border, per §4's formula.
9. **(Future) Planet + surface generation** — see §7.

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
  major/core factions are seeded, a second faction-seeding pass runs in
  regions where no single faction's control clears a threshold,
  populating them with small local factions (warlords, independent
  outposts, minor houses) instead of leaving the area contested-by-two.
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
  §7 lands, any planet) whose position falls inside the sector polygon
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

## 6. Export format (SDF)

Following `Docs/06-data-format-sdf.md`'s "define the payload here first"
rule, three new categories:

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

`hyperlanes` are not their own category — they're a symmetric reference
list on each `system` entry (as above), which is enough for SIT to render
edges without needing a fourth category. Revisit only if hyperlanes need
their own metadata beyond what §3.4 stores per-edge (danger/capacity) — in
that case a thin `hyperlanes/<slug>` category referencing two system slugs
is a small, backwards-compatible addition.

## 7. Future scope (not v1, but shapes the model above)

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

## 8. AI-agent event interface

Goal: let a GM (or an AI agent doing worldbuilding on the GM's behalf)
describe an in-fiction event in plain language — "the Kreel Clans lost a
major battle to the Free Traders Coalition at Kreel's Reach," "a minor
trade dispute broke out near Absalom Junction" — and have the tool apply a
proportionate, deterministic change to galaxy state. Magnitude is the lever
for "big events shift factions/politics, small ones don't."

The design keeps the LLM narrow on purpose: it **classifies**, it doesn't
**mutate**. State like control fields, security, and war-chance are already
derived/interlocking values (§4) — letting an LLM write to them directly
invites an inconsistent galaxy (e.g. it edits `war_chance` but forgets to
touch the aggression/security inputs it's derived from). So the agent's
only job is to turn event text into a small structured record using a
fixed, closed vocabulary of effect ops; a plain deterministic **effect
engine** (regular code) applies it, clamped by magnitude, and re-derives
anything downstream.

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
    "magnitude": "major",
    "scope": ["system:kreels-reach", "faction:free-traders-coalition", "faction:kreel-clans"],
    "effects": [
      { "op": "adjust_control", "target": "kreels-reach", "faction": "free-traders-coalition", "delta": 0.3 },
      { "op": "adjust_relationship", "a": "free-traders-coalition", "b": "kreel-clans", "delta": -0.25 },
      { "op": "adjust_aggression", "faction": "kreel-clans", "delta": -0.1 }
    ],
    "narrative": "Free-form GM/agent text describing what happened — flavor/history only, not read by the effect engine."
  }
}
```

- `magnitude`: fixed enum `minor | moderate | major | historic`. Each tier
  maps to a max-delta clamp per effect op (a small config table, GM-
  tunable) — e.g. `minor` caps `adjust_control` at ±0.05, `major` allows up
  to ±0.35, `historic` can flip ownership outright. The agent doesn't need
  to land an exact number, only classify magnitude correctly; the clamp is
  what actually prevents a misjudged "minor" event from cascading into a
  faction collapse.
- `effects`: a closed vocabulary of ops, not arbitrary field writes —
  `adjust_control`, `adjust_relationship`, `adjust_aggression`,
  `adjust_security`, `set_owner` (see open question below), `adjust_focus`
  (nudge a sector's focus weighting), `add_tag`/`remove_tag`. Anything
  outside this vocabulary simply can't be expressed, which keeps the
  agent's surface area — and therefore what can go wrong — small and
  reviewable.
- `scope`: every entity slug the event touches, giving a queryable history
  later ("show every event that touched this faction").

### Pipeline

1. GM (or agent) writes the event as plain text.
2. **Classify** (the one LLM-touching step): given the event text plus the
   current exported galaxy state (so the agent references real slugs, not
   invented ones), produce a draft event record — scope, magnitude,
   effects — restricted to the op vocabulary above.
3. **Review** (GM, default-on): the draft is shown as a diff before commit
   — e.g. "Kreel Clans control at Kreel's Reach: 0.55 → 0.25; relationship
   FTC↔KC: 0.10 → −0.15" — same propose-then-approve pattern as
   border-faction auto-seeding (§10, open question 3).
4. **Apply** (deterministic): the effect engine applies clamped deltas to
   live state and re-derives everything downstream (control field →
   ownership/contested recompute → `war_chance` recompute), since those
   stay derived values per §4 rather than independently stored.
5. **Log**: the event itself is exported as an `events/<slug>` entry —
   append-only. Replaying all events in timestamp order against the base
   generated galaxy reproduces current state, which gives undo (drop the
   last event, re-fold) and a browsable campaign timeline for free.

## 9. UI shape (sketch, for review)

- Canvas-based map view (2D, pan/zoom). Target scale is **500–1000 systems,
  up to ~2000** — comfortably within plain Canvas2D if rendering is
  reasonably careful (viewport culling, batched draws), but PixiJS is the
  safer default given hyperlane edges roughly double the draw count and
  several overlay layers (§ toggles below) can be on at once; worth
  prototyping both early rather than assuming. React shell around it to
  match the rest of the frontend stack.
- Layer toggles: any brush field, faction control overlay (rendered as
  soft-edged territory blobs from the control field, not hard polygons —
  contested zones should visually read as blended/striped between
  factions), Dominion security, sector boundaries, hyperlane graph — each
  independently on/off so the map doesn't turn to noise.
- Tool palette: brush (per field, radius/strength/falloff), system
  place/lock, sector polygon draw, faction seed placement (position +
  strength), hyperlane manual add/remove (override generated edges).
- Inspector panel: click a system/sector/faction → editable property panel
  on the side, same "click node, edit panel" pattern as the rest of SIT's
  UI conventions (`Docs/08-ui-tabs.md` style, though this tool is standalone
  so it doesn't need to reuse that exact component). Clicking a contested
  system should show the control breakdown (§6's `contested_by` list) and
  the computed `war_chance`, not just a single owner.
- Seed controls: global seed, per-stage reroll buttons, lock/pin individual
  systems so a reroll doesn't discard curated work.
- Export button: writes the SDF tree for GM review/copy into the content
  root described in `Docs/06-data-format-sdf.md`.

## 10. Open questions for review

1. Folder/stack: same conventions as `MapCreator` (Electron? plain Vite
   React app run locally?) — worth deciding once, since both are
   workstation offline tools and could plausibly share scaffolding.
2. Should `war_chance` be a stored/exported field (as sketched in §6) or
   computed on read by SIT's backend from faction relationships + security?
   Storing it is simpler for v1; computing it live is more correct if
   relationships or security change after export.
3. Auto-seeding of small border factions (§4, generation stage 7): fully
   automatic (generator decides how many/where based on low-coverage
   regions), fully manual (GM places every faction), or automatic-with-
   review (generator proposes, GM approves/deletes/renames before export)?
   Automatic-with-review is the likely default but worth confirming.
4. Galaxy scale is settled at **500–1000 systems (up to 2000 max)** — this
   is now baked into §9's rendering approach; flag if that range changes
   materially since it affects the Canvas2D-vs-PixiJS call.
5. `set_owner` in §8's event vocabulary — should ownership flips require
   `historic` magnitude explicitly, or should any magnitude be allowed to
   flip ownership when its clamped delta happens to cross the ownership
   threshold naturally (e.g. a system already at 0.92 control gets a
   `minor` +0.05 nudge and crosses 0.95)? Leaning toward the latter
   (ownership change is emergent from the numbers, not a separately
   gated action) but flagging since it changes how "safe" minor events
   really are near a threshold.
6. Review step in §8 (draft event → GM approval before commit): always
   required, or skippable for `minor`-magnitude events so small flavor
   events don't need a click-through every time? Same shape as question 3
   above — worth deciding once whether this tool defaults to
   propose-and-review or auto-commit-below-a-threshold.
