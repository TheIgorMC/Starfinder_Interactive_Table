# 15 — Settlement generators: outposts, cities, stations

Status: **design note + scaffolding** (2026-09). The current district layout
(`galaxy-core/lib/settlement.js`, shared by the galaxy viewer and the Galaxy
Editor's Cities tab) is only right for **small outposts**. Cities and stations get their own
generators later; this doc records the split so the code doesn't drift into
one renderer pretending to fit all three.

## The three settlement styles

| Style | Where | Look | Generator | Status |
|---|---|---|---|---|
| `outpost` | small settlements on moons / rocky / ice worlds, extraction sites, gas-giant platforms | districts as **domes** ("bubbles") joined by tunnels/rail/shuttles; floating platforms on gas giants | `layoutSettlement()` in `settlement.js` (seeded relaxation + MST transit) | **done** — this is the current system, kept as is |
| `city` | real cities on planets, city-planets (ecumenopolis), capitals | own functional, procedural design (street grid / blocks / zoning / arteries) | Galaxy Editor **City Gen** tab → `galaxy-core/lib/cityGen.js` | **skeleton only** — until it exists, cities render with the outpost layout, flagged as *provisional* |
| `station` | orbital stations, mining platforms, ships | prefab blocks on a 2 m grid, deck by deck (see below) | Galaxy Editor **Station Gen** tab → `galaxy-core/lib/stationGen.js` | **v1 done** (2026-09) — generator, editor, MCP; viewer rendering still to do |

## How a site picks its style

`settlementStyle(body, site)` in `galaxy-core/lib/settlement.js`:

1. an explicit `site.style` (`"outpost" | "city" | "station"`, set in the Cities tab) wins;
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
- Cities tab: per-site **Layout style** selector (auto / outpost / city / station).
- Galaxy Editor tabs **City Gen** and **Station Gen** (placeholders describing
  inputs/outputs) and stub modules `cityGen.js` / `stationGen.js` exporting
  the entry points above (they return `null` for now).
- Viewer: settlement panel shows the style and a "provisional layout" note for city/station.

## Station Gen (v1, 2026-09)

`galaxy-core/lib/stationGen.js`, tab **Station Gen**, MCP `galaxy_generate_station_layout`,
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
