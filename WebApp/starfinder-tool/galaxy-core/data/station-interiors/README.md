# Station Interiors — block library

`blocks.json` (schema `station-interiors/blocks v0.2`) is the library the
station generator fills station blocks with: 150 modules in 9 families
(H housing, F food, T technical, L leisure, V circulation, D docking,
C command, K cargo, P processing), each described by primitives — zones,
items (box/bed/round/cross/dash/solid), partitions, connectors, utility
spine, hull face — in U (1U = 2 m cube; origin NW corner, x east, y south).
`height` is in U too; modules taller than a station block (one drawn deck ≈
2U, more for two-deck blocks and multi-level decks) are never placed there.

`blocks_generator.py` builds `blocks.json`. After regenerating, rebuild the
JS module the app loads:

```bash
python3 blocks_generator.py            # writes out/blocks.json
cp out/blocks.json blocks.json
node -e 'const d=require("./blocks.json");require("fs").writeFileSync("../../lib/stationKitBlocks.js","// generated from data/station-interiors/blocks.json\nexport const KIT_BLOCKS = "+JSON.stringify(d)+";\n")'
```

GM edits and new designs made in the Galaxy Editor (MODULES workspace) are
stored in the galaxy project (`project.stationKit`), not here; the
workspace's EXPORT JSON writes the merged library in this same format.
