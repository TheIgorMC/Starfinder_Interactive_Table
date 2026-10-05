# 16 — Fantasy Atlas (`/fantasy`)

A medieval region-map generator and editor. It covers one territory of a few hundred kilometres (not planets or galaxies).

It lives in the SIT stack but is a **separate, public feature**. It is not in the launcher or in the GM console, and is reached **only by direct link** (`/fantasy?map=…`).

- **Readers:** anyone with the link sees a map marked *public* (`playerVisible`) read-only, with travel times and the coin converter. No login is needed.
- **The GM:** logged in, opens `/fantasy` to list, generate and edit maps.
- **Hidden content:** private maps answer 404 to everyone else, and hidden items and GM notes are stripped from the public view.
- **New maps:** start public; untick the box to keep a draft private.

It is inspired by [Azgaar's Fantasy Map Generator](https://azgaar.github.io/Fantasy-Map-Generator/), on the generation side (heightmap → rivers → biomes → burgs → routes) and in the parchment look. It is scaled down to a single region, so every place can carry a description and pictures.

## Where things live

| What | Where |
|---|---|
| Storage | `fantasy_maps` table (`migrations/022`): one JSON document per map, `version` for optimistic saves |
| API | `backend/src/routes/fantasy.js`: `GET /api/fantasy/:id` is public (no login; GM gets the full map, everyone else only public maps, stripped). `GET /api/fantasy` (list), `POST`, `PUT /:id` and `DELETE /:id` are GM-only. A PUT with a stale `baseVersion` → 409. Every write broadcasts `fantasy:updated` |
| Pictures | media library, category `fantasy` (`POST /api/media/fantasy`, served at `/api/media/files/fantasy/…`) |
| Generator & logic | `galaxy-core/fantasy/` (shared: frontend via `@galaxy-core/fantasy/…`, backend and MCP server by path) — `generate.js`, `names.js`, `travel.js`, `currency.js`, `path.js` (A*), `model.js` (data model, encode/decode), `tools.js` (MCP tools). Pure JS; tests: `node --test galaxy-core/fantasy/fantasy.test.js` |
| MCP tools | `galaxy-core/fantasy/tools.js` → run by the backend at `POST /api/fantasy/tool/:name` (GM / service token) → exposed by the MCP server as `fantasy_*` |
| Rendering | `frontend/src/fantasy/render.js`: terrain is painted once into an off-screen canvas (8 px per cell) and only repainted where the brush touches. Rivers, roads, places, labels and routes are vector, redrawn every frame |
| UI | `FantasyApp.jsx` (shell, save, undo, tools), `MapView.jsx` (canvas input), `Inspector.jsx`, `TravelPanel.jsx`, `Treasury.jsx`, `IndexPanel.jsx`, `GeneratorDialog.jsx`, `fantasy.css` |

## Map document

Coordinates are in cells. One cell is `kmPerCell` km; the GM sets this as "width of the map in km".

- `terrain.h` holds the heights, one byte per cell, base64-encoded.
- `terrain.b` holds the biome codes, one character per cell: `O` sea, `L` lake, `G` plains, `A` farmland, `F` forest, `D` deep forest, `T` taiga, `H` hills, `M` mountains, `S` snowy peaks, `W` marsh, `R` desert.
- `settlements`, `pois`, `roads`, `rivers`, `labels` and `events` are arrays. Every entry carries `{ id, name, description, images[], links[], refs[], gmNotes, hidden }`.
- `books` holds `[{ title, author, url, hidden, chapters: [{ n, title, url, summary, hidden }] }]`.
- `currency` is `{ currencies: [{ name, realm, rate, denominations: [{ name, abbr, metal, value }] }], feePct }`.
- `playerVisible` makes the map public: readable by link, without login. The public API strips entries marked `hidden`, all `gmNotes`, and hidden books and chapters.
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

### Custom name sets

You can give the generator example names of one invented language, in three lists: **towns** (`samples`), **places / features** (`places`) and **people** (`people`). Each category gets a character-level Markov chain, Azgaar's "namesbase" idea. It learns from all three lists, with its own examples weighted ×3, so even three town names give usable results. The chain is order 2 for short lists, which gives more variety, and order 3 for 25+ names, which stays closer to the originals. When a short list runs out of fresh names, two roots are joined (Xeredon + Kashr → Xerekashr) instead of numbering them. `namer.person()` gives people's names: in the dialog preview, from `name_ideas`, and for writing. Stored as `options.names = { samples, places, people, mode, base }`:
- `mode: "inspire"` invents new names in the style of the list.
- `mode: "use"` gives the listed names to the settlements first (most important first), then invents.
- `base` is the culture whose wording dresses features: "Bosco di X", "X Wood"… `plain` uses the bare name, which suits invented languages.

Where to set it:
- the generator dialog;
- the map's properties ("Names for new places"), which the editor uses when you place something new;
- the MCP tools `name_ideas` and `set_name_set` (the latter can also rename what is already on the map).

### From a draft

`generateMap({ guide })` rebuilds a draft. A **guide** is rows of characters stretched over the map, with the legend in `GUIDE_HELP`:

| Char | Meaning |
|---|---|
| `~` | sea |
| `o` | lake |
| `.` | plains |
| `,` | farmland |
| `f` / `F` | forest / deep forest |
| `t` | taiga |
| `h` | hills |
| `m` / `M` | mountains / snowy peaks |
| `s` | marsh |
| `d` | desert |
| space | land, the climate decides |
| `#` | ink, filled in from the neighbouring cells |

How the guide is turned into a map:
- The map keeps the draft's proportions.
- Water touching the edge becomes sea; enclosed water becomes a lake.
- Land rises with the distance from the shore, plus the hills and mountains the guide marks.
- Rivers, climate and the unmarked land are generated as usual.

`places` (`{ name, type, fx, fy }`, with fractions 0–1 of the map) puts the draft's own towns exactly where they are, nudged onto land. `labels` writes its names; a generated label of the same kind nearby is dropped. `extraSettlements: false` keeps only the given towns.

**In the editor**, "From a draft" in the generator dialog loads a picture: a sketch, a scan or another tool's export.
- `frontend/src/fantasy/draft.js` shrinks it to the grid and groups its colours with k-means, using farthest-point seeding so that small areas of a distinct colour keep their own group.
- It guesses a terrain for each colour; anti-aliased edge colours follow the nearer big colour. The GM confirms or changes each guess, with a live preview.
- The picture is uploaded and kept as the map's **tracing layer** (`underlay: { url, opacity, visible }`). It is drawn over the terrain for the GM only and stripped from the public API, so the GM can place their towns on it.

**Over MCP**, `generate_map` takes `guide`, `places`, `labels`, `names` and `extra_settlements`, so a draft shown to Claude can be rebuilt from a description of it.

## Editing (GM)

**Tools:**
- **V** select (move places by dragging)
- **S** settlement
- **P** place
- **R** road (auto-trace follows the terrain)
- **I** river
- **B** terrain brush (any biome, water included)
- **L** label
- **E** event
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

## Book, links and events

**The book.** The Book tab holds the book(s) the GM is writing.
- A book has a title, an author and a link. Each chapter has a title, a link to its text (Google Doc, wiki, PDF…) and a summary.
- Any place, road, river, label or event can cite chapters, with an optional page or note: `refs: [{ book, chapter, note }]`.
- An open chapter lists everything that cites it, and those items glow on the map.
- Hidden books and chapters are stripped from the player API.

**Links in descriptions.** Every description and chapter summary is Markdown.
- `[text](https://…)` opens in a new tab.
- `[[Name]]` (or `[[Name|shown text]]`) links to whatever on this map carries that name: a place, an event, a book or a chapter.
- Each item also has a `links: [{ label, url }]` list.

**Deep links.**
- `/fantasy?map=<id>&sel=<collection>:<id>` opens the map, selects the item and centres on it.
- `/fantasy?map=<id>&ch=<chapter id>` opens the chapter.
- `/fantasy?map=<id>&book=<book id>` opens the Book tab, and `/fantasy?map=<id>` opens the map itself.
- No login is needed to follow a link to a public map.
- The address bar follows the selection (full-screen view only).
- 🔗 in any inspector copies the link, ready to paste into the manuscript.

**Events.** Events (`events[]`) have:
- `date`: free text, in the campaign's own calendar;
- `sort`: a number used to order them, e.g. the year;
- `type`: battle, siege, founding, plague, treaty, coronation…;
- `places`: links to the places involved;
- an optional pin on the map (`x`/`y`);
- plus the usual description, pictures, citations and links.

They are created with the Event tool (E) by clicking the map, or from the Timeline tab without a pin. The Timeline lists them in order and filters by kind or text. A place's inspector shows "What happened here".

## MCP tools (`fantasy_*`)

The definitions are in `galaxy-core/fantasy/tools.js`. The backend runs them one at a time against the stored map; a tool that changes the map saves it with a version bump and broadcasts `fantasy:updated`, so an open editor reloads, or flags a conflict if it has unsaved edits.

**Conventions:**
- Positions are in **km from the north-west corner**: `x_km` east, `y_km` south. Alternatively pass `near: "<place>"` plus `dx_km` / `dy_km`.
- Any item can be given by id or by name.
- `mapId` defaults to the most recently edited map.
- Every item returned carries its `link`: `SIT_PUBLIC_URL` + `/fantasy?map=…&sel=…`, or a relative link when `SIT_PUBLIC_URL` is unset.

**The tools:**
- **Maps:** `list_maps`, `generate_map` (also from a draft: guide grid, places, labels, custom names), `get_map`, `set_map_info`.
- **Names:** `name_ideas` (invent names in the style of examples), `set_name_set` (a map's naming style, optionally renaming what is there).
- **Finding things:** `search`, `get_item`. `get_item` returns everything about one item: description, notes, pictures, links, cited chapters, events there, terrain and the nearest settlements.
- **Adding:** `add_settlement`, `add_place`, `add_label`, `add_event`, `add_road`. `add_road` follows the terrain between named places.
- **Editing:** `update_item`, `add_link`, `delete_item`, `paint_terrain`.
- **The book:** `upsert_book`, `upsert_chapter`, `cite`.
- **Calculators:** `travel_time` (every mode, at a pace), `convert_currency`.

## Not built yet

- Political borders and realms (the label tool can name regions by hand).
- City plans for a settlement, in the spirit of Watabou's Medieval Fantasy City Generator.
- Sea routes between ports.
