# Galaxy viewer

Full-screen, Elite-style viewer for the campaign's galaxy project, ported
from the ARTS galaxy-viewer design handoff. Routes (any logged-in user):

| Route | View |
|---|---|
| `/galaxy?system=<slug>` | Galaxy map (Powers / Security / Conflict / Sectors / Populace / Trade) |
| `/galaxy/system/<sys>?body=<slug>` | System — realistic orrery or schematic |
| `/galaxy/system/<sys>/<body>?site=<id>` | Planet surface — globe, sites, transit |
| `/galaxy/system/<sys>/<body>/<site>` | Settlement — districts + local transit |

One component per view; below 768px (`useIsMobile`) the side panel becomes a
bottom sheet, layer buttons become a chip row and the schematic goes vertical.
Canvas renderers (`*-view.js`, `galaxy-map.js`, `settlement.js`) are plain JS
classes that own their rAF loop — pan/zoom never re-renders React.

Data comes from `GET /api/galaxy/compact` (`backend/src/galaxy-compact.js`),
short keys: `sys[]` = `{s slug, n name, x, y, i importance, st star, sc sector,
pop, so stationOnly, ow owner, cb [[faction, share]], sd/sf security, war, t,
ex, im, b bodies}`, `ln` = `[aIdx, bIdx, capacity 0|1|2, risk]`, bodies
`{k kind, n, s, p parent, st status, au, auo, a, pd, r, t, sites, ...}`.
Hidden districts are stripped server-side for players.

The settlement layout/renderer lives in `galaxy-core/lib/settlement.js`
(vite alias `@galaxy-core`), shared with the Galaxy Editor's Cities tab.

Settlement styles (`settlementStyle()` in `galaxy-core/lib/settlement.js`, see
`Docs/15-settlement-generators.md`): only `outpost` (domes / floating
platforms) is final. `city` and `station` render with the same layout
flagged "provisional" until their Galaxy Editor generators exist.
