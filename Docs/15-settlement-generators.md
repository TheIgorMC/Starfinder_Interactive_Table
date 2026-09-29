# 15 — Settlement generators: outposts, cities, stations

Status: **design note + scaffolding** (2026-09). The current district layout
(`galaxy-core/lib/settlement.js`, shared by the galaxy viewer and the Galaxy
Editor's surface-site editor, SYSTEM workspace) is only right for **small outposts**. Cities and stations get their own
generators later; this doc records the split so the code doesn't drift into
one renderer pretending to fit all three.

## The three settlement styles

| Style | Where | Look | Generator | Status |
|---|---|---|---|---|
| `outpost` | small settlements on moons / rocky / ice worlds, extraction sites, gas-giant platforms | districts as **domes** ("bubbles") joined by tunnels/rail/shuttles; floating platforms on gas giants | `layoutSettlement()` in `settlement.js` (seeded relaxation + MST transit) | **done** — this is the current system, kept as is |
| `city` | real cities on planets, city-planets (ecumenopolis), capitals | own functional, procedural design (street grid / blocks / zoning / arteries) | `galaxy-core/lib/cityGen.js` (will live in the SYSTEM workspace's site editor) | **skeleton only** — until it exists, cities render with the outpost layout, flagged as *provisional* |
| `station` | orbital stations, mining platforms, ships | prefab blocks on a 2 m grid, deck by deck (see below) | Galaxy Editor **STATIONS** workspace → `galaxy-core/lib/stationGen.js` | **v1 done** (2026-09) — generator, editor, MCP; viewer rendering still to do |

## How a site picks its style

`settlementStyle(body, site)` in `galaxy-core/lib/settlement.js`:

1. an explicit `site.style` (`"outpost" | "city" | "station"`, set in the site editor) wins;
2. a body of kind `orbital station` → `station`;
3. an ecumenopolis body, or a site whose `kind` is `city`/`government`, or the procedural capital (`cap`) → `city`;
4. everything else → `outpost`.

`layoutSettlement()` returns `style` alongside the districts; the renderer
dispatches on it (`SettlementView.district()`), so a new style only needs a
new draw/layout branch, not a rewrite. Outposts always draw domes (floating
platforms on gas giants). `city` and `station` currently fall back to the old
generic drawing and the viewer labels them "provisional layout".

## Contract for the future generators

Both generators produce the same district-level data the viewer already
consumes, so routing, panels, transit legend, hidden (GM-only) districts and
player redaction keep working unchanged:

```js
// site.layout (new, optional) — written by City Gen / Station Gen
{
  style: "city" | "station",
  seed: "…",                 // regenerate deterministically
  districts: [{ name, type, hidden?, host?, sitRef?, x, y, shape? }], // zones
  // style-specific geometry, owned by its generator:
  city:    { blocks: [...], arteries: [...] },
  station: { modules: [...], rings: [...], docks: [...] },
}
```

- Districts stay the unit of navigation and GM notes; the generator decides
  their geometry (`shape`), the viewer only needs `x/y` + `shape` to draw.
- Hidden districts must still never move visible ones (player and GM see
  the same layout; hidden ones are stripped server-side for players).
- Station zoning follows the same district logic as outposts/cities once
  the modules exist (one district = one functional zone).

## Scaffolding in place

- `settlementStyle()` + style dispatch in `galaxy-core/lib/settlement.js`.
- Site editor (SYSTEM workspace → body → Surface sites): per-site **Layout style** selector (auto / outpost / city / station).
- Stub module `cityGen.js` (returns `null` for now); `stationGen.js` is built (below).
- Viewer: settlement panel shows the style and a "provisional layout" note for city/station.

## Station Gen (v1, 2026-09)

`galaxy-core/lib/stationGen.js`, workspace **STATIONS** (also reachable from a station body in the SYSTEM workspace), MCP `galaxy_generate_station_layout`,
`galaxy_get_station_layout`, `galaxy_find_venues`, `galaxy_update_venue`.

- **Grid**: 1 unit = 2 m × 2 m. Units are standard, blocks are not: a module
  size is derived from the hull length (1 unit on a light freighter, ~400 on a
  megastation), so a layout always has a few hundred blocks at most.
- **Blocks**: one purpose each — transit, bridge, habitation, dining,
  commercial, recreation, medical, security, research, factory, cargo,
  hangar, technical, generator, engine. Geometry first (cells merged into
  rectangles), then each block gets the type that fits its position and is
  furthest below its floor-area target (`MIX` per purpose; habitation follows
  the headcount in m²/person).
- **Shapes**: `orbital` (hub + branching corridors, grows in every direction,
  commerce near the core, docks at the rim), `vessel` (tapered bow with the
  bridge, hangars amidships, engines/technical aft, generators scattered on
  big hulls, shops only with passengers or big crews), `mining` (cube, cross
  corridors, hangars on the faces, one mess and few shops). `colossal`
  (Gemini-like city-ships) → city generator, `generateStation` returns null.
- **Sizes**: stations from the body (`lengthM`, `population`, `docks`,
  `sizeClass`); ships from the SF1e frame size (length ranges in
  `SIZE_LENGTH_M`) and the model's crew, plus passengers by role.
- **Decks**: at most 8 drawn decks; on tall hulls one drawn deck stands for
  several physical ones (`decks[].levels`). Lifts at corridor junctions shared
  by several decks.
- **Stored** as `layout` on the station body (system gets curated/`locked`) or
  on the company's notable ship: blocks, doors, lifts, venues — ~3–150 KB.
- **Detail on demand**: `blockDetail()` derives rooms (cabins, shop fronts,
  berths…) from block + seed when the plan is zoomed in; nothing stored.
- **Venues**: named shops/pubs/etc. in dining, commercial and recreation
  blocks (`layout.shops`, capped at 160 and scaled to the people aboard); a
  big block's other shop fronts get derived names in the detail view. Menus
  and inventories are a later step (same idea: derived from the seed).
- **Editing**: move/resize by drag (grid snap), numeric x/y/w/h, change type,
  add/delete blocks, rename/add/remove venues. Doors are recomputed after
  every edit (`recomputeDoors`). Hiding blocks from players: not decided yet.

### v2 (2026-09): sections, two-deck blocks, the Station Interiors kit

- **Sections.** Every block belongs to one zone — command, habitation,
  commerce, research, industry, docking, engineering — and each zone is one
  contiguous region cut from an archetype ordering by floor area: vessels in
  transverse slices bow → stern (through all decks), mining platforms in
  layers top → bottom (hangars on the faces of the bottom layers), orbital
  stations as a core ring (command + commerce) around the hub, a docking ring
  at the rim and angular wings in between. Inside a zone the same ordering
  splits it by type, so food courts, shops and arcades are clusters too.
- **Stacked decks.** Module rectangles are merged once on the widest deck and
  reused on every deck they fit, so decks line up; stacked twins of hangars,
  engines, reactors, cargo holds, assembly bays and atria merge into
  **two-deck blocks** (`block.span`, editable). Doors carry their deck.
- **Interiors = the Station Interiors kit** (`galaxy-core/data/station-interiors/`,
  converted to `lib/stationKit.js` + `lib/stationKitPlans.js`):
  `lib/stationInterior.js → blockInterior(layout, block, clip)` fills a block
  with kit modules — clusters of ≤16U with a cross hall and a V1 stair at the
  head of each (rule V2), rows of [band][1U hall][band], modules turned so a
  connector faces the hall. Habitation uses the kit housing mix for the
  station's scale (outpost/station/hub/mega) plus an F1 mess per 3 H0 racks
  and L0 nooks; dining F2+F3/F1/F0; recreation L3 park/L2/L1/L0; technical
  T2/T1/T0; generator blocks get the T3 reactor hall (the only place reactors
  go, which keeps SLEEP away from them, rule X1). Derived per cluster × band
  seed and only for the visible clip, never stored. Types without kit modules
  (cargo, hangar, bridge, shops, security, medical, research, factory) still
  show generic rooms. Not applied yet: WET/spine adjacency (R4), T1/T2 on
  block mains every 32U, V2/V3 cores and trunks as geometry, wealth shift (W1).
- **Editor.** Modules appear as zone-tinted cells from ~4 px/U and as the
  kit's plan drawings from ~14 px/U; venues label their mess/bar/gym. Drag
  pans (a block only moves once selected); pan uses screen deltas and one
  update per frame.

### v3 (2026-09): block library v0.2 + module designer

- **Library.** `galaxy-core/data/station-interiors/blocks.json` (built by
  `blocks_generator.py`, loaded as `lib/stationKitBlocks.js`) replaces the v0.1
  kit: 150 modules in 9 families (H housing, F food, T technical, L leisure,
  V circulation, D docking, C command, K cargo, P processing), each made of
  primitives (zones, items, partitions, connectors, spine, hull), with
  `scale` / `wealth` tags and a `height` in U. Plans are drawn from the
  primitives (`frontend/src/galaxy-editor/kit/KitPlan.jsx`), not from images.
- **GM designs.** `lib/stationLibrary.js → libraryFor(project)` merges the
  library with `project.stationKit = { blocks: {id: block}, disabled: [id] }`:
  a project block with a library id replaces that design, any other id adds a
  new one; disabled ids are skipped by the generator.
- **MODULES workspace** (Galaxy Editor): browse/search by family, edit a
  module on its U grid (snap 0.5 / 0.25 / 0.05U) — drag zones, items, walls
  and doors, resize from the corner, Del removes — and every property
  (size, height, capacity, spine, hull, scale, wealth, description, tags);
  checks as in the generator script; New / Duplicate / Reset to library /
  Disable in generator; EXPORT JSON (same schema) and IMPORT.
- **Generator.** `blockInterior(layout, block, clip, lib)` maps block types
  to families (habitation→H, dining→F, recreation→L, commercial→markets,
  diners, bars, casinos…, technical/generator→T, hangar→D, cargo→K,
  factory→P + fab halls, bridge→C, security/research/medical → picked ids),
  filters by the station's scale and wealth (auto from its purpose, or set
  per layout in STATIONS → Wealth) and by **height**: the block allows
  `span × levels × 2U` (one drawn deck ≈ 2U), so 4U reactor halls, 6U atria
  and 8U flight decks only appear in tall/two-deck blocks. Modules of ≥48U²
  are placed as anchors at the head of the block, the rest in hall-facing
  bands; tall modules show their height.
