# 16 — Fantasy Atlas (`/fantasy`)

A medieval region-map generator and editor that sits next to the galaxy tools. It covers one territory of a few hundred kilometres (not planets or galaxies). It is reachable from the launcher, from the GM console's "Fantasy Atlas" tab, and at `/fantasy`. The GM edits; players get a read-only view of the maps the GM shares, with travel times and the coin converter.

It is inspired by [Azgaar's Fantasy Map Generator](https://azgaar.github.io/Fantasy-Map-Generator/), on the generation side (heightmap → rivers → biomes → burgs → routes) and in the parchment look. It is scaled down to a single region, so every place can carry a description and pictures.

## Where things live

| What | Where |
|---|---|
| Storage | `fantasy_maps` table (`migrations/022`): one JSON document per map, `version` for optimistic saves |
| API | `backend/src/routes/fantasy.js`: `GET /api/fantasy` (list), `GET/PUT/DELETE /api/fantasy/:id`, `POST /api/fantasy`. A PUT with a stale `baseVersion` → 409. Every write broadcasts `fantasy:updated` |
| Pictures | media library, category `fantasy` (`POST /api/media/fantasy`, served at `/api/media/files/fantasy/…`) |
| Generator & logic | `frontend/src/fantasy/lib/` — `generate.js`, `names.js`, `travel.js`, `currency.js`, `path.js` (A*), `model.js` (data model, encode/decode). Pure JS; tests: `node --test src/fantasy/lib/fantasy.test.js` from `frontend/` |
| Rendering | `frontend/src/fantasy/render.js`: terrain is painted once into an off-screen canvas (8 px per cell) and only repainted where the brush touches. Rivers, roads, places, labels and routes are vector, redrawn every frame |
| UI | `FantasyApp.jsx` (shell, save, undo, tools), `MapView.jsx` (canvas input), `Inspector.jsx`, `TravelPanel.jsx`, `Treasury.jsx`, `IndexPanel.jsx`, `GeneratorDialog.jsx`, `fantasy.css` |

## Map document

Coordinates are in cells. One cell is `kmPerCell` km; the GM sets this as "width of the map in km".

- `terrain.h` holds the heights, one byte per cell, base64-encoded.
- `terrain.b` holds the biome codes, one character per cell: `O` sea, `L` lake, `G` plains, `A` farmland, `F` forest, `D` deep forest, `T` taiga, `H` hills, `M` mountains, `S` snowy peaks, `W` marsh, `R` desert.
- `settlements`, `pois`, `roads`, `rivers` and `labels` are arrays. Every entry carries `{ id, name, description, images[], gmNotes, hidden }`.
- `currency` is `{ currencies: [{ name, realm, rate, denominations: [{ name, abbr, metal, value }] }], feePct }`.
- `playerVisible` shares the map with players. The player API strips entries marked `hidden` and all `gmNotes`.
- `style` is `parchment` or `atlas`.

A medium map (240×160) is about 120 KB.

## Generation

The generator runs these steps in order:

1. **Heightmap.** fBm value noise, shaped by the chosen template (coast, peninsula, island, archipelago, inland, highlands). Ridged noise adds mountain chains.
2. **Sea level.** Taken from the template's land share, so the land fraction is stable.
3. **Lakes.** Depressions are filled with priority-flood. The deepest basins become lakes, up to about 4% of the map.
4. **Rivers.** Drainage runs on the filled surface. Rivers are the top 2.5% of flow accumulation, traced from source to sea or lake.
5. **Climate.** Moisture comes from noise plus distance to water; temperature from latitude and elevation.
6. **Biomes.** Relief is assigned by land-height percentile, so the "mountains" slider means the same share of land on every template.
7. **Settlements.** Each site is scored on fertility, river, coast and lake. A capital (central), cities, towns and villages are placed with minimum distances. Castles favour hills. Farmland is laid around the settled places.
8. **Roads.** All roads are traced with A* over a terrain cost grid. Rivers cost a bridge, and existing roads are cheap to reuse, so lanes merge into highways.
   - Royal roads form a minimum spanning tree between the capital and the cities.
   - Each town joins the network with a road.
   - Villages and castles join it with cart tracks.
9. **Points of interest.** Caves, mines, ruins, towers, shrines, abbeys, dungeons, lairs, standing stones, a battlefield, roadside inns and lighthouses.
10. **Labels.** Forests, ranges, hills, marshes, deserts, seas and lakes are labelled at their innermost cell.

Names come from four cultures (`names.js`): anglo, italic (`Borgo Ardano`, `Rocca Vitenza`, `Monti di …`), nordic and elvish.

## Editing (GM)

**Tools:**
- **V** select (move places by dragging)
- **S** settlement
- **P** place
- **R** road (auto-trace follows the terrain)
- **I** river
- **B** terrain brush (any biome, water included)
- **L** label
- **M** travel

**Shortcuts:**
- **Del** deletes the selection.
- **Esc** cancels or deselects.
- **Enter** or a double-click finishes a road or river.
- **Ctrl+Z / Ctrl+Shift+Z** undo / redo.
- **Ctrl+S** saves. Saving is manual, as in the Galaxy Editor.

**Editing roads and rivers:** select one, then drag its red points. Alt+click a point to remove it.

**Map-level actions:** "Rebuild roads" re-traces only the generated roads; roads you drew are kept. "Regenerate…" keeps the coinage, the map description and the sharing flag.

## Travel times (`travel.js`)

Each mode is routed separately with A* on travel time, so a cart keeps to the roads while a rider cuts across the plains. "As the crow flies" samples the straight line instead.

| Mode | km/h on a good road | Hours a day |
|---|---|---|
| On foot | 4.8 | 8 |
| Horse | 6.5 | 8 |
| Courier (relay horses) | 12 | 10 |
| Wagon | 3.5 | 8 |
| Carriage | 5.5 | 8 |
| River boat | 5 | 10 |
| Ship | 8 | 24 |

- **Road factors:** royal road ≥ road > cart track > footpath. Footpaths are closed to carts.
- **Off-road factors:** set per biome. Wagons cannot cross deep forest, mountains or marsh. A carriage needs a road.
- **Fords:** a river cell without a road (no bridge) costs time.
- **Paces:** slow ×⅔, fast ×4⁄3, forced march +4 h a day.

## Coins (`currency.js`)

Each currency lists its coins, valued in its own smallest coin. Its `rate` is what one of those is worth in the first currency's smallest coin. The converter shows:
- the amount as the fewest coins;
- the amount in every denomination;
- the amount in every other currency, after the money-changer's fee.

The purse totals a handful of coins.

Presets:
- the standard pp/gp/ep/sp/cp;
- £sd (240 pence to the pound);
- Florentine (fiorino/lira/grosso/soldo/denaro);
- an "imperial" crown/mark/penny.

Each settlement can name its local coinage.

## Not built yet

- Political borders and realms (the label tool can name regions by hand).
- City plans for a settlement, in the spirit of Watabou's Medieval Fantasy City Generator.
- Sea routes between ports.
- MCP tools for the atlas.
