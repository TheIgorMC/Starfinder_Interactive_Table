# Feature Scope — v1 Target

Guiding rule: **nothing gets cut for simplicity.** Every stat, field, and
subsystem that exists in Starfinder 1e rules must be representable.
"Intuitive" means good UX/IA (progressive disclosure, search, filters,
sensible defaults) — not fewer features.

## 1. World / Navigation
- Setting map(s) of known space, zoomable/pannable
- Points of interest linked to lore entries (pulled from AoN Setting pages)
- In-system navigation aid (system maps, travel time reference)

## 2. Character Creation & Customization
Must cover the full SF1e character sheet, nothing abridged:
- Race/ancestry, theme, class (+ archetypes), level
- All six abilities, full skill list with ranks/class skills
- HP, SP, RP, EAC, KAC, saves, BAB
- Feats (all prerequisites validated against AoN data)
- Spells/known spells per class, spell slots
- Equipment loadout (weapons, armor, augmentations, gear) with encumbrance/bulk
- Starship role assignments if character participates in starship combat
- Free-form notes/backstory field
- Full stat recalculation on any change (no manual math for the player)

## 3. Battle Map / Combat
- Grid-based battle map, projector display (read-only, no UI chrome)
- Token placement/movement synced from PC (manual drag) or from the mini tracker (Hall sensor PCB)
- Fog of war, GM-only layers vs player-visible layers
- Initiative tracker, conditions/status effect icons (full condition list from AoN)
- Range/AoE templates, measurement tools
- Map library (upload/import custom battle maps)

## 4. Stores & Inventory
- NPC/store inventories with buy/sell pricing, stock
- Player inventory synced to character sheet (bulk, currency, item tracking)
- Full equipment catalog imported from AoN (weapons, armor, augmentations, technological items, magic items, hybrid items)
- Crafting/upgrade tracking if relevant to campaign rules in use

## 5. Shared/Cross-cutting
- Dice roller (all standard + exploding/advantage variants used in SF1e)
- Session log / GM notes
- Multi-device role-based views (GM / player / display) — see architecture doc
- Search across all imported rules data (feats, spells, items, races, classes)

## Explicitly deferred (not cut, just not v1)
- Starship combat map (separate from ground battle map) — flag for v2
- Automated rules enforcement (e.g., auto-applying conditions) — v1 tracks state manually, automation later
- Voice/video integration — out of scope entirely, assumes in-person play
