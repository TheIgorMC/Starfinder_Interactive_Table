# Station Interiors — export v0.1

20 modules in 5 families (Housing H, Food F, Technical T, Leisure L, Circulation V) plus 2 system sheets.

| Folder / file | Use |
|---|---|
| `modules.json` | Machine-readable spec for the generator: footprint, height, connectors (face + cells + width), utility spine, trunk level, zone rectangles in U, requirements, exclusions, variants. Also the unit conventions, zone colours, scale ladder, trunk hierarchy, placement rules and housing mix weights. |
| `plans_svg/` | Plan drawings only, vector, one per module (dark background). Coordinates inside are in U, scaled by the group transform. |
| `boards_png/` | Full boards at 2× (plan + spec panel), for reference. |
| `Station-Interiors-catalog.pdf` | All 22 boards in one PDF, one per page. |
| `source_dc/` | Original editable board sources (.dc.html) from the design canvas. |

Coordinate conventions (also in `modules.json → conventions`):
- 1U = 2 m cube; interior sub-grid 0.5U; deck pitch 1U.
- Origin = north-west corner; x → east, y → south; rects are `[x, y, w, h]` in U.
- Cells `[col, row]` zero-based (board label A1 = `[0, 0]`).
- Personnel connectors are 1 m wide, centred on the listed cell edge; cargo/plaza connectors span all listed cells.
- `"TBD"` marks values still to decide (reactor output, lift capacity, stock days…).
