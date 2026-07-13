# SIT Standard Data Format (SDF) — v1

Contract between offline data-creator tools and the Starfinder Interactive
Tool (SIT). Any tool that follows this spec produces content SIT can serve
with **zero code changes** — the backend content module is category-agnostic.

## Location

All content lives under the content root, mounted into the backend at
`/app/content` (host: `/mnt/data_ssd/nas_share/SIT/content`).

```
content/
  <category>/               # e.g. planets, maps, handouts, npcs, systems
    <slug>/                 # kebab-case unique id, e.g. absalom-station
      entry.json            # REQUIRED — the entry definition
      *.png|jpg|webp|...    # assets, referenced relatively from entry.json
```

Rules:
- `<category>`: lowercase, plural, `[a-z0-9-]+`. New categories may be added
  freely; SIT discovers them automatically.
- `<slug>`: lowercase kebab-case, unique within its category, stable forever
  (it is the entry's ID — renaming breaks references).
- One entry = one folder. Everything the entry needs sits inside its folder.

## entry.json — common envelope

Every entry, regardless of category, MUST include:

```json
{
  "sdf": 1,
  "type": "planet",
  "name": "Absalom Station",
  "summary": "One-line description shown in lists.",
  "tags": ["pact-worlds", "station"],
  "assets": {
    "thumbnail": "thumb.webp",
    "hero": "hero.webp"
  },
  "data": { }
}
```

| Field | Type | Req | Notes |
|---|---|---|---|
| `sdf` | int | ✔ | Spec version. Currently `1`. |
| `type` | string | ✔ | Singular category name (`planet`, `map`, ...). |
| `name` | string | ✔ | Display name. |
| `summary` | string | ✔ | ≤200 chars, for list views. |
| `tags` | string[] | – | Free-form, used for filtering/search. |
| `assets` | object | – | Keys are roles, values are paths **relative to the entry folder**. No `..`, no absolute paths, no URLs. |
| `data` | object | ✔ | Category-specific payload (schemas below). May be `{}`. |

Asset URLs at runtime: `/api/content/assets/<category>/<slug>/<relative-path>`.

## Category payloads (`data`)

### type: "planet"
```json
{
  "system": "Pact Worlds",
  "diameter": "×1",
  "gravity": "1 g",
  "atmosphere": "Normal",
  "day": "24 hours",
  "year": "365 days",
  "population": "2 million",
  "government": "Autocracy",
  "description": "Long-form markdown text.",
  "poi": [
    { "name": "The Spike", "description": "..." }
  ]
}
```
All fields optional strings unless noted; unknown extra fields are preserved
and ignored by SIT (forward-compatible).

### type: "map"
```json
{
  "kind": "battle",           
  "grid": { "w": 30, "h": 20, "cell_ft": 5 },
  "image": "map.webp",        
  "walls": [],                 
  "spawns": [ { "label": "P1", "x": 2, "y": 3 } ]
}
```
- `kind`: `"battle"` (grid combat) or `"scenic"` (no grid; art/regional map).
- `image`: relative path, also listable in `assets`.
- `walls`, `spawns`: optional; reserved for fog-of-war and quick setup.

### type: "handout"
```json
{
  "body": "Markdown text shown to players.",
  "reveal": "gm"               
}
```
`reveal`: `"gm"` | `"players"` — default visibility.

### New categories
Define the payload in this doc first, then start producing entries. SIT
serves anything; views are added per category as needed.

## Validation rules (creator tools MUST enforce)

1. `entry.json` is valid UTF-8 JSON, `sdf: 1` present.
2. All asset paths exist inside the entry folder.
3. `slug` matches `[a-z0-9]+(-[a-z0-9]+)*`.
4. Images: prefer `.webp`, max 4096px on the long edge.
5. Text fields: markdown allowed in `description`/`body` only.

## API surface (read-only)

```
GET /api/content/categories            → ["planets","maps",...]
GET /api/content/<category>            → [ {slug, ...entry}, ... ]
GET /api/content/<category>/<slug>     → {slug, ...entry}
GET /api/content/assets/<cat>/<slug>/<path>  → static file
```

SIT never writes to the content tree — it is owned by the offline tools.
Drop new folders in, they appear immediately (no restart, no import step).
