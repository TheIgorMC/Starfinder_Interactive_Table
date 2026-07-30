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

## Status: Phase 4 done, curated + background actors (§13 of the design doc)

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

**Phase 4 (notable actors & organizations, curated + background, done)**:
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
  system inspector lists who's there. It's full-weight/bright if any
  curated (`authored`) actor is there, dimmed/smaller if only background
  (`generated`) presence exists, per §3 stage 10
- "Export SDF" now also writes `actors/` and `organizations/` entry trees
- **Background actors (§6.1, the follow-up slice)**: a "Generate background
  actors" pass in the toolbar auto-seeds cheap, procedurally-named
  `origin: "generated"` actors — density scales with **both** a system's
  population band (more populous → more officials/merchants/functionaries)
  and any faction contest there (the system's owner, plus every faction
  with a meaningful contested share, each gets its own local rep on top of
  the population-driven baseline). Fully automatic, no per-actor review.
  Re-running it rerolls every background actor from scratch but never
  touches curated (`authored`) ones — the sidebar's Actors list keeps
  curated actors visible and collapses background ones behind a "Show N
  background actors" toggle so a populated galaxy's curated content isn't
  buried

**Navigation & phase cleanup pass**:
- The sidebar is now tabbed (Sectors / Factions / Actors / Organizations)
  instead of one long scroll — selecting something on the canvas, or
  starting to draw/place one, jumps to the right tab automatically.
- Field heatmap and faction territory overlays now default **off** — a
  fresh project shows the plain map; color is opt-in via the Layers/Field
  checkboxes, not the default view.
- Faction cards now have editable **relationships** (per-other-faction
  slider, -1 to 1, §9) and **tolerated crimes** (free-text tag list) —
  previously data-shape-only fields with no UI.
- Actor cards now have editable **reputation** (per-faction slider, -1 to
  1, mirrors faction relationships) — same previous gap.
- A faction anchored to a home system can now be **un-anchored** via a
  button on its card, without deleting and recreating it.
- An organization's home system/sector are now mutually exclusive in the
  UI — setting one clears the other, matching the design doc's
  one-or-the-other-or-neither framing.
- New **System tool**: click inside a drawn sector to hand-place a single
  new system there (rolled from the painted fields at that point, locked
  immediately) — §3 stage 4's other half, previously only reachable by
  locking/renaming an already-generated system.
- New **Hyperlane tool**: click two systems to toggle a direct edge
  between them, independent of a full "Generate hyperlanes" regen.
- `Docs/11-AI-integration.md` §6 now specifies the exact
  `query_galaxy`/`create_actor`/`create_organization`/`apply_event`/
  `project_timestep` request/response shapes and the closed effect-op
  vocabulary, matched field-for-field against the current SDF export —
  nothing implemented yet, but Phase 6 has a frozen contract to build
  against instead of re-deriving it from the design doc each time.

Not yet built: events, broadcasts, the AI interface, planet/surface
generation — see §13 for the full phase breakdown.

### Known simplifications so far

- Sector vertices can't be dragged/edited after creation — delete and
  redraw if a boundary needs to change. (Still open — the one item from
  this list not yet addressed; everything else below it has a fix.)
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
- "Generate hyperlanes" still replaces the whole graph each time (with a
  confirmation) — but the new **Hyperlane tool** now lets you manually
  toggle a single edge on or off afterward without a full regen (see
  "Placing/generating hyperlanes" below).
- Hyperlane risk is still derived from Dominion security alone (lower
  security along the route → higher risk) as a stand-in — the design
  doc's real formula also factors in faction relations, and while
  `relationships` is now editable (Factions tab), it isn't fed into
  hyperlane risk or war-chance yet. Per-edge length/risk/capacity live
  only in the project's in-memory `hyperlanes` list for
  rendering/inspection — SDF export still follows §7's plan of a plain
  symmetric slug list on each system, not a separate edge category.
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
- Locking protects an *existing* generated system, and the new **System
  tool** now also covers §3 stage 4's other half — hand-placing a brand
  new system at an arbitrary point inside a sector, rolled from whatever's
  painted there and locked immediately.
- Deleting a sector still removes every system inside it, locked or not —
  locking only protects against a *systems regen*, not a sector deletion,
  since there'd be no sector left for it to belong to.
- Nothing stops two different factions from anchoring to the same system;
  if it happens, whichever faction comes later in the list wins that
  system outright the next time you generate. A faction can now be
  **un-anchored** from its home system via a button on its card, though
  re-anchoring it to a *different* system still means dropping a new seed.
- Background actor density coefficients (population weight, the "meaningful
  contested share" cutoff, per-system cap) are the tuned defaults from
  initial testing, not calibrated against a real galaxy at the 500-2000
  system scale (§13 flags the exact coefficients as an implementation
  detail, not a design question) — expect to retune `actorGen.js`'s
  constants once a full-scale galaxy is generated.
- Promotion (a background actor flipping to `authored` when an event
  elevates them) isn't implemented — there's no effect engine yet (Phase 5)
  to trigger it.
- If a sector is deleted, any actor based in one of its systems is marked
  unplaced (`location: null`) rather than deleted outright, so the curated
  actor itself isn't lost — but it does need to be manually reassigned to
  a new system afterward.
- The AI/MCP interface itself (§9) still doesn't exist — Phase 6 work.
  What now exists is a frozen **tool contract spec** (`Docs/11-AI-integration.md`
  §6) for `query_galaxy`/`create_actor`/`create_organization`/`apply_event`/
  `project_timestep`, precisely matched against the current SDF field
  names, so that phase can be implemented directly against it without
  re-deriving the shapes.

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
| System | Click inside a drawn sector to hand-place a single new system there, rolled from whatever's painted at that exact point and locked immediately. Clicking outside every sector does nothing. |
| Faction | Click to drop a faction's control seed (a diamond marker) — click again to reposition before naming it in the Factions panel. Click near an existing system instead to anchor the faction to it (violet ring) — that system is then held outright by that faction. |
| Hyperlane | Click a system (cyan ring), then click a second one to toggle a direct hyperlane between them — click the same system twice, or empty space, to cancel. |
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
5. Alternatively, switch to the **System tool** and click a specific point
   inside a sector to hand-place exactly one system there instead — rolled
   from the fields painted at that point, locked immediately (no batch
   regen involved).

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
5. To adjust one connection without a full regen, switch to the
   **Hyperlane tool**: click a system (cyan ring marks it as picked), then
   click a second one to toggle a direct edge between them — add it if
   missing, remove it if already connected. Click the same system twice,
   click empty space, or press Escape to cancel a half-made pick.

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
6. An anchored faction's card has an **Un-anchor from home system** button
   — its home system goes back into the normal control contest the next
   time you generate factions. The card also has editable **relationships**
   (a slider per other faction, -1 to 1) and **tolerated crimes** (a
   free-text tag list) — both exist for future event/war-chance resolution
   (§9) but aren't fed into the live calculations yet.

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
   organization set as their affiliation. An organization's home
   system/sector are mutually exclusive — setting one clears the other.
5. An actor's card also has editable **reputation** (a slider per faction,
   -1 to 1, mirroring faction relationships) — exists for future
   event-driven standing (§9) but isn't fed into anything live yet.

**Generating background actors**
1. Generate systems and (ideally) factions first — background actor
   density is driven by each system's population band and its control/
   contest state, so running this before factions just skips the
   faction-rep half of the count.
2. Click **Generate background actors** in the toolbar. This rerolls every
   `generated`-origin actor from scratch (confirms first if any already
   exist) — anything you've curated by hand is left exactly as it is.
3. The Actors list in the sidebar keeps curated actors visible up top and
   collapses the (often much larger) background batch behind a "Show N
   background actors" toggle; click through to inspect or delete an
   individual one like any other actor.

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
