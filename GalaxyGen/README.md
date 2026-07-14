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

## Status: Phase 1 (§13 of the design doc)

Canvas + density fields + sectors, no procedural generation yet:

- Pan/zoom 2D canvas over the galaxy bounds
- Sector polygon drawing tool (click to place vertices, name + assign a
  focus tag, delete)
- Brush tool painting the five density fields (population, export, import,
  hyperlane density, Dominion security) onto a 128×128 grid per field,
  rendered as a heatmap; optional "constrain to selected sector"
- Autosave to browser `localStorage`, plus explicit Save/Load of a project
  `.json` file
- "Export sectors (SDF)" writes real `sectors/<slug>/entry.json` files via
  the File System Access API where supported (Chromium), falling back to a
  single combined JSON download otherwise

Not yet built (later phases): systems, hyperlanes, factions, actors,
organizations, events, broadcasts, the AI interface, planet/surface
generation — see §13 for the full phase breakdown.

### Known Phase 1 simplifications

- Sector vertices can't be dragged/edited after creation — delete and
  redraw if a boundary needs to change.
- Galaxy bounds (width/height) are only set when starting a new project,
  not editable live against existing painted data (avoids distorting
  already-painted grids).

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
| Select | Click a sector to select it — needed to enable "constrain to selected sector" for the brush, or before deleting/editing it. |
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
   the × button in the sector list deletes an existing sector.

**Saving your work**
- Everything autosaves to the browser's local storage as you go (per
  browser/profile — it won't follow you to a different machine).
- **Save .json** / **Load .json** in the sidebar export/import the whole
  project (seed, bounds, sectors, all five field grids) as a portable file.
- **Export sectors (SDF)** writes real `sectors/<slug>/entry.json` files
  (Chrome/Edge: pick a `content/` folder and it writes the tree directly;
  other browsers get a single combined JSON to split by hand).
- **New** starts a fresh galaxy (asks for confirmation if you have
  unsaved sectors).

There's nothing to generate yet (systems, hyperlanes, factions — later
phases) — Phase 1 is just the canvas, the density fields, and sector
boundaries per `Docs/10-galaxy-mapgen.md` §13.
