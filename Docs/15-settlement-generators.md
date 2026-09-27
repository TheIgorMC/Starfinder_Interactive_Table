# 15 — Settlement generators: outposts, cities, stations

Status: **design note + scaffolding** (2026-09). The current district layout
(`settlement.js`, shared by the SIT galaxy viewer and GalaxyGen's Cities
tab) is only right for **small outposts**. Cities and stations get their own
generators later; this doc records the split so the code doesn't drift into
one renderer pretending to fit all three.

## The three settlement styles

| Style | Where | Look | Generator | Status |
|---|---|---|---|---|
| `outpost` | small settlements on moons / rocky / ice worlds, extraction sites, gas-giant platforms | districts as **domes** ("bubbles") joined by tunnels/rail/shuttles; floating platforms on gas giants | `layoutSettlement()` in `settlement.js` (seeded relaxation + MST transit) | **done** — this is the current system, kept as is |
| `city` | real cities on planets, city-planets (ecumenopolis), capitals | own functional, procedural design (street grid / blocks / zoning / arteries) | GalaxyGen **City Gen** tab → `GalaxyGen/src/lib/cityGen.js` | **skeleton only** — until it exists, cities render with the outpost layout, flagged as *provisional* |
| `station` | orbital stations (incl. ring stations) | own procedural station generator (modules, rings, spokes, docks), then split into zones with the same district logic | GalaxyGen **Station Gen** tab → `GalaxyGen/src/lib/stationGen.js` | **skeleton only** |

## How a site picks its style

`settlementStyle(body, site)` in `settlement.js` (both copies):

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

- `settlementStyle()` + style dispatch in `settlement.js` (web app + GalaxyGen copies).
- Cities tab: per-site **Layout style** selector (auto / outpost / city / station).
- GalaxyGen tabs **City Gen** and **Station Gen** (placeholders describing
  inputs/outputs) and stub modules `cityGen.js` / `stationGen.js` exporting
  the entry points above (they return `null` for now).
- Viewer: settlement panel shows the style and a "provisional layout" note for city/station.
