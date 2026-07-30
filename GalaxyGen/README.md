# Galaxy MapGen

Procedural galaxy/star-system/hyperlane generator for the Starfinder
Companion Tool (`../WebApp/starfinder-tool`). See
`../Docs/10-galaxy-mapgen.md` for the full design doc (data model,
generation pipeline, brush/faction/sector system, export schemas, delivery
roadmap) — this app is being built phase by phase against that doc.

Runs on a workstation — not part of the Orange Pi deployment, not included
in the Dockge stack. Stack decisions are independent of `../MapCreator`
(whose own future is undecided). Exports content following
`../Docs/06-data-format-sdf.md`.

## Status: Phase 4, curated half done (§13 of the design doc)

**Phase 1** — canvas, density fields, sectors:
- Pan/zoom 2D canvas over the galaxy bounds
- Sector polygon drawing tool (click to place vertices, name + assign a
  focus tag, delete)
- Brush tool painting the five density fields (population, export, import,
  hyperlane density, Dominion security) onto a 128×128 grid per field,
  rendered as a heatmap; optional "constrain to selected sector"
- Autosave to browser `localStorage`, plus explicit Save/Load of a project
  `.json` file

**Phase 2 (system & hyperlane generation, done)**:
- Variable-density Poisson-disc placement of systems inside sector
  polygons only, weighted by the painted population field (denser →
  tighter spacing) — GM-tunable min/max spacing
- Per-system detail rolls: star type, population band (also decides
  station-only vs. colonized), and export/import goods biased by the
  sector's focus tag (e.g. `mining` → ore/metals; `administrative` →
  diplomatic delegations, flagged high-security-transit, since it trades
  in people, not cargo)
- Hyperlane graph: Delaunay triangulation over system positions, pruned to
  a Gabriel graph for a natural look, with pruned edges added back in
  areas where the painted Hyperlane density field is high, and a
  connectivity guarantee (single connected component) as a safety net
- Click a system (Select tool) to inspect it in the sidebar, including its
  connected hyperlanes
- "Export SDF" now writes both `sectors/` and `systems/` entry trees

**Phase 3 (factions, control, security, war-chance, done)**:
- Faction tool: click to drop a control seed, name it, pick a color, set a
  government flavor tag, and roll aggression/strength — GM-authored major
  powers
- Control-field resolution (§4): a weighted-Voronoi-style contest where
  every faction's influence peaks at 1 at its own seed and falls off with
  distance at a rate set by its strength (bigger strength = bigger
  territory, not a stronger claim at the core). A system is owned only
  where one faction clears ~85% share; anywhere else with meaningful
  presence is contested, not owned; nothing meaningful present falls back
  to plain Dominion territory
- Border-fragmentation auto-seed pass: fully automatic, no per-faction
  approval — finds contiguous colonized regions where no authored faction
  clears a 50% share and scatters small local factions across each region
  (roughly one per ~900 uncovered grid cells, spread out via farthest-point
  sampling so a single huge gap gets several minors, not one giant "minor"
  faction swallowing the whole thing), tagged "(auto)" in the list
- Dual security + war-chance (§4): faction security derives from how
  solidly the locally dominant faction holds a point and how strong it is
  overall; `war_chance` combines the two top contesting factions'
  aggression (average + differential, so two calm factions abutting stays
  calm) against combined Dominion + faction security (well-secured points
  stay stable even between aggressive neighbors)
- Territory overlay (Layers toggle) — a soft, per-faction-colored heatmap
  read of the live control contest, plus a dashed amber ring on any
  contested system right on the map
- Click a faction seed (Select tool) to inspect/tune its aggression and
  strength inline, or delete it
- "Export SDF" now also writes a `factions/` entry tree
- System names are now editable inline in the inspector (slug stays fixed,
  so hyperlane/control references elsewhere never go stale) — lets a GM
  hand-curate any generated system without full manual placement tooling
- A "Show field heatmap" toggle (Field section) hides the density-field
  overlay so the map underneath — sectors, systems, hyperlanes, faction
  territory — reads cleanly without the paint layer in the way
- Faction seeds can anchor directly to a system: click near an existing
  system with the Faction tool (violet ring) instead of open ground. An
  anchored faction holds that one system outright — `control.owner` is
  forced to that faction, no external contest, regardless of how strong a
  rival seed sits nearby — matching a deliberately-placed capital rather
  than just "closest/strongest seed wins the point" (§4). Un-anchored
  automatically if its home system is ever removed (sector deletion or a
  full system regen)
- Systems carry an `important` value (0–1, slider in the inspector, "Mark
  as landmark" sets it straight to 1.0): the zoom level needed to reveal a
  system's name label scales down with importance, so a 1.0 landmark
  always shows its label, a 0.0 system needs several times the initial
  zoom-to-fit view before it appears, and everything between graduates
  smoothly — keeps a big galaxy from turning into a wall of overlapping
  names at the default view while still giving higher-importance systems
  priority as you zoom in. The threshold scales off the actual fit-to-
  bounds zoom rather than a fixed number, so it holds regardless of galaxy
  size or window size. System dots are small to begin with, and dim
  further once their label is showing (unless selected) so the name reads
  cleanly instead of competing with a bright dot underneath it. System
  generation also rolls a realistic importance
  value per system automatically (mostly low, occasional standouts, biased
  up slightly by population band), with a spatial pass that dampens a
  system's roll near an already-important neighbor so landmarks don't
  cluster next to each other
- Systems can be **locked** (checkbox in the inspector — renaming or
  tuning importance sets it automatically): a locked system's position,
  name, and every other field survive a future "Generate systems" regen
  untouched, and any hyperlane or faction anchor pointing at it survives
  too, since its id/slug never change. Regeneration only replaces unlocked
  systems and places new ones in the gaps around locked ones — hand
  curation is no longer wiped out by every regen

**Phase 4 (notable actors & organizations, curated half done)**:
- Actors (§6): notable people/groups that never hold territory but matter
  for future event targeting — a governor, a pirate captain, a
  corporation's local rep. Created via a form (name, individual/group,
  role flavor tag, location anchored to an existing system, affiliation,
  mobile flag, influence) — no canvas placement tool, since an actor's
  "position" is just whatever system it's based at
- Organizations (§6.2): non-territorial parties/guilds/movements — name,
  ideology tag, a required parent faction (or Dominion) whose sphere they
  operate within, an optional home system or sector (or neither, for a
  galaxy-spanning movement), and local influence. No control field, no
  aggression — they never enter the Faction contest (§4)
- An actor's `affiliation` points at either `faction:<slug>` or
  `party:<slug>` (or neither) — this is the single source of truth for
  membership; an organization's member list is always derived by scanning
  actors for it, so the two can never drift out of sync
- Placing/relocating an actor onto a system locks that system too (same
  "hand-curation protects it from regen" rule as renaming), and deleting a
  faction/organization gracefully falls back any actor's affiliation or
  organization's parent-faction reference rather than leaving it dangling
- A small green dot marks any system with 1+ actors on the map itself; the
  system inspector lists who's there
- "Export SDF" now also writes `actors/` and `organizations/` entry trees

Not yet built: background/bulk actor auto-seeding (§6.1 — the design doc's
own roadmap calls this a follow-up slice of Phase 4 once the curated half
is solid, not a separate phase), events, broadcasts, the AI interface,
planet/surface generation — see §13 for the full phase breakdown.

### Known simplifications so far

- Sector vertices can't be dragged/edited after creation — delete and
  redraw if a boundary needs to change.
- Galaxy bounds (width/height) are only set when starting a new project,
  not editable live against existing painted data (avoids distorting
  already-painted grids).
- "Generate systems" replaces every *unlocked* system each time (confirms
  first if any unlocked ones exist) and prunes any hyperlane/faction
  anchor that pointed at one of them, since their id/slug are gone. Locked
  systems, and anything referencing them, survive untouched. Freshly
  regenerated (unlocked) systems still lose whatever `control`/`security.
  faction`/`war_chance` they had — click Generate factions again to
  re-resolve those for the new arrivals.
- "Generate hyperlanes" likewise replaces the whole graph each time (with
  a confirmation) — no manual add/remove override of individual edges yet
  (planned per the design doc's tool palette, not built yet).
- Hyperlane risk is derived from Dominion security alone (lower security
  along the route → higher risk) as a stand-in; the design doc's real
  formula also factors in faction relations, which need actual relation
  data (`relationships` exists on the faction shape but isn't editable in
  the UI yet, and isn't fed into hyperlane risk or war-chance). Per-edge
  length/risk/capacity live only in the project's in-memory `hyperlanes`
  list for rendering/inspection — SDF export still follows §7's plan of a
  plain symmetric slug list on each system, not a separate edge category.
- "Generate factions" re-seeds every auto-generated ("(auto)") faction
  from scratch each time and recomputes control/security/war-chance for
  every system, but keeps GM-authored factions and their stats as-is —
  editing a faction's aggression/strength doesn't move borders until you
  click Generate factions again.
- Deleting a faction strips it from any system's `control` immediately
  (no stale references), but doesn't re-resolve who picks up the freed
  territory — click Generate factions again for that.
- The territory overlay and border-fragmentation pass both resample the
  control contest at the same 128×128 grid resolution as the density
  fields; it isn't persisted (computed on the fly), so very large faction
  counts (dozens+) could get slow to render, though this hasn't been an
  issue at the scale tested (single digits to low tens of factions).
- No `tolerated_crimes` or `relationships` editing UI yet — both exist on
  the data shape (and export) but are always empty until hand-edited in a
  saved project file or a future UI pass.
- Locking protects an *existing* generated system, but there's still no
  tool to drop a brand-new system at an arbitrary point by hand (§3 stage
  4's "GM can hand-place" half isn't built, only the "lock" half is).
  Renaming/tuning/locking just lets a GM claim an already-generated system
  as a specific curated place.
- Deleting a sector still removes every system inside it, locked or not —
  locking only protects against a *systems regen*, not a sector deletion,
  since there'd be no sector left for it to belong to.
- Nothing stops two different factions from anchoring to the same system;
  if it happens, whichever faction comes later in the list wins that
  system outright the next time you generate. Anchoring also can't be
  edited after the fact (no "un-anchor this faction" button) — delete and
  recreate it to change or remove an anchor.
- No background actor auto-seeding yet (§6.1) — every actor is hand-typed
  one at a time. A galaxy with hundreds of systems will look sparsely
  populated with actors until that follow-up slice exists.
- Actor `reputation` (per-faction standing) exists on the data shape and
  export but has no editing UI yet, same simplification already accepted
  for faction `relationships`/`tolerated_crimes`.
- If a sector is deleted, any actor based in one of its systems is marked
  unplaced (`location: null`) rather than deleted outright, so the curated
  actor itself isn't lost — but it does need to be manually reassigned to
  a new system afterward.
- An organization's `home_system`/`home_sector` are independent dropdowns
  with no mutual-exclusivity enforcement — setting both is allowed even
  though the design doc frames it as one-or-the-other-or-neither.

## Running it

```
cd GalaxyGen
npm install
npm run dev
```

Opens on `http://localhost:5174` (see `vite.config.js`).

## How to use it

**Tool bar (left panel)**

| Tool | What it does |
|---|---|
| Brush | Left-drag to paint the selected Field onto the map; Shift+drag erases. Pick the field (Population, Export, Import, Hyperlane density, Dominion security), radius, and strength above it. |
| Sector | Click to place boundary vertices (need 3+). See "Drawing a sector" below. |
| Faction | Click to drop a faction's control seed (a diamond marker) — click again to reposition before naming it in the Factions panel. Click near an existing system instead to anchor the faction to it (violet ring) — that system is then held outright by that faction. |
| Select | Click a system, faction seed, or a sector to select it (systems, then factions, take priority when they're close together) — needed to inspect a system/faction, enable "constrain to selected sector" for the brush, or before deleting/editing a sector. |
| Pan | Left-drag to move the view. (Middle-mouse-drag pans in any tool; scroll wheel always zooms.) |

**Drawing a sector** — drawing and naming are two separate steps, so you
can lay out the shape first and only decide the name/focus once it's done:
1. Switch to the Sector tool and click to drop vertices — the Sectors
   panel (right) shows a live point count (need 3+) and a **Close
   boundary** button. No name/focus fields yet at this stage.
2. A faint dashed line always previews the closing edge back to your
   first point, and that first point gets a highlighted ring once you
   have 3+ vertices.
3. Hovering near any existing vertex — your own first point, or another
   sector's corner — shows a colored ring: **green** means clicking there
   closes your current shape (same as pressing Enter, or the sidebar's
   **Close boundary** button); **amber** means clicking there snaps onto
   that neighboring sector's exact vertex, so the two sectors share a
   clean border with no gap.
4. Once closed, the sidebar switches to "Boundary closed (N vertices)" and
   *now* shows the Name/Focus form. Fill it in and click **Create
   sector** — or **Edit boundary** to reopen and keep adding points if you
   closed it too early.
5. Escape cancels the whole draft at any point (before or after closing);
   the × button in the sector list deletes an existing sector (and any
   systems already generated inside it).

**Generating systems**
1. Draw at least one sector first — placement only happens inside sector
   polygons, so an empty galaxy generates nothing.
2. In the toolbar's **Generate** section, set min/max spacing (world
   units) — this is the distance between systems at the sparsest
   (unpainted, population 0) vs. densest (fully painted, population 1)
   points. Painting the Population field (Brush tool) before generating is
   what actually shapes where systems cluster.
3. Click **Generate systems**. This replaces every *unlocked* system
   currently in the project (confirms first if any unlocked ones exist),
   so regenerate as many times as you like while still tuning the
   fields/spacing — anything you've locked stays exactly where it is.
4. Switch to the Select tool and click a system to see its rolled details
   (star type, population band, export/import goods — biased by its
   sector's focus) in the sidebar. The name field there is editable, and
   editing it (or the importance slider) automatically **locks** that
   system — it and anything referencing it (hyperlanes, faction anchors)
   will survive the next regen untouched. Toggle **Locked** directly to
   lock/unlock without changing anything else.

**Generating hyperlanes**
1. Generate systems first — hyperlanes connect existing systems, so there's
   nothing to link with fewer than two.
2. Painting the Hyperlane density field (Brush tool) beforehand shapes
   where the graph gets extra, denser connections; sparser areas fall back
   to the plain natural-looking mesh.
3. Click **Generate hyperlanes**. This replaces the whole graph currently
   in the project (confirms first if any exist).
4. Select a system to see the slugs of everything it connects to in the
   sidebar. On the map, brighter thicker lines are "major trade route"
   connections (high hyperlane density along that edge), faint thin ones
   are "backwater spur" connections (low density).

**Placing factions and generating control**
1. Switch to the Faction tool and click on the map to drop a control seed
   — the Factions panel (right, below Sectors) shows a naming form: name,
   color, government flavor tag (free text), aggression, and strength.
   Strength governs territory *size* (how far its influence carries), not
   how solidly it holds its own capital — every faction fully controls its
   own seed point regardless of strength.
2. To make a faction's capital a specific system instead of an arbitrary
   point, click near that system — a violet ring shows it'll anchor there.
   An anchored faction holds that one system outright (`control.owner`
   forced to it, no contest) no matter how strong a rival seed happens to
   sit nearby.
3. Repeat for as many major powers as you want, then click **Generate
   factions**. This auto-seeds small local factions into any colonized
   area where none of your majors clear a meaningful share (tagged
   "(auto)" in the list) and recomputes every system's `control`,
   `security.faction`, and `war_chance` from the full set.
4. Turn on **Show faction territory** (Layers) to see the soft territory
   overlay and each faction's seed marker; contested systems (no single
   faction at ~85%+ share) get a dashed amber ring right on the map, and an
   anchored faction's home system gets a solid ring in that faction's
   color.
5. Select a system to see its control breakdown (owner, or contested-by
   with shares), faction security, and war chance in the sidebar; select a
   faction seed to tweak its aggression/strength inline or delete it.
   Re-click **Generate factions** after any tweak to see it take effect —
   nothing recomputes live as you drag a slider.

**Marking important systems**
- Every system rolls a realistic importance value automatically at
  generation time (mostly low, rare standouts, nearby systems dampened so
  landmarks don't cluster). Select any system to see/adjust its
  **Importance** slider (0–1) in the inspector, or click **Mark as
  landmark** to set it straight to 1.0 — either one locks the system too.
- The zoom level needed to reveal a system's name scales down with its
  importance, relative to the view's initial zoom-to-fit level: a 1.0
  landmark always shows its label; a 0.0 system needs several times the
  initial zoom before it appears; everything between graduates smoothly.
  Keeps a large galaxy from turning into a wall of overlapping text at the
  default view while still surfacing what matters first as you zoom in.

**Adding actors and organizations**
1. Generate at least one system first — actors are always anchored to an
   existing system (or created "Unplaced" and assigned to one later).
2. Click **+ New Organization** first if you want an actor to belong to a
   local party rather than a faction directly — give it a name, ideology
   tag, and a parent faction (or Dominion) whose sphere it operates within.
3. Click **+ New Actor** — name, individual/group, a role flavor tag,
   which system they're based at, and an affiliation (a faction, an
   organization, or none). Placing them at a system locks that system.
4. Select an actor or organization from its list to edit any field
   afterward, or delete it. An organization's member list isn't edited
   directly — it's always whichever actors currently have that
   organization set as their affiliation.

**Saving your work**
- Everything autosaves to the browser's local storage as you go (per
  browser/profile — it won't follow you to a different machine).
- **Save .json** / **Load .json** in the sidebar export/import the whole
  project (seed, bounds, sectors, systems, all five field grids) as a
  portable file.
- **Export SDF** writes real `sectors/<slug>/entry.json`,
  `systems/<slug>/entry.json`, `factions/<slug>/entry.json`,
  `actors/<slug>/entry.json`, and `organizations/<slug>/entry.json` files
  (Chrome/Edge: pick a `content/` folder and it writes the tree directly;
  other browsers get a single combined JSON to split by hand).
- **New** starts a fresh galaxy (asks for confirmation if you have
  unsaved sectors).
