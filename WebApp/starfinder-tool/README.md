# Starfinder Companion Tool — Iteration 1

## Deploy on Orange Pi (Dockge)

1. Clone the repo on the Pi (once): `git clone <repo-url> /mnt/data_ssd/repos/Starfinder_Interactive_Table`
2. Symlink this folder into Dockge's stacks root (Dockge doesn't scan nested subfolders):
   ```
   ln -s /mnt/data_ssd/repos/Starfinder_Interactive_Table/WebApp/starfinder-tool \
         /mnt/emmc/stacks/starfinder-tool
   ```
3. Create data dirs:
   ```
   sudo mkdir -p /mnt/data_ssd/nas_share/SIT/{db,uploads,aon-cache,content}
   ```
4. Copy `.env.example` → `.env` (inside `WebApp/starfinder-tool/`), set `DB_PASSWORD` **and `SESSION_SECRET`** (`openssl rand -hex 32`)
5. In Dockge: the stack appears automatically → Deploy
6. Create login accounts (see below) — nobody can use `/gm` or `/player` until you do
7. Open `http://<pi-ip>:7600`
8. To update: `git pull` in the repo, then redeploy the stack in Dockge

Note: `MapCreator/` elsewhere in the repo is a separate offline tool and is
not part of this stack — it doesn't run on the Pi.

## Accounts / login

`/gm` and `/player` (and `/compendium`) require signing in — there's no
self-registration UI, accounts are created via a CLI script run inside the
backend container:

```bash
# one GM account
docker compose exec backend node scripts/create-user.js gm alice "hunter2"

# one account per player — character gets linked automatically the first
# time they log in and create it (or pass an existing character id)
docker compose exec backend node scripts/create-user.js player bob "hunter2"
```

Rules: one GM account (sees/controls everything), one character per player
account (enforced server-side — a player can create exactly one character,
then it's permanently linked to their login). Re-running the script for an
existing username resets that user's password.

`/display` (projector) and `/tablet` (GM's mood board) are **not** behind
login — they're shared physical screens, not per-person devices, and only
show what the GM explicitly pushes to them (battle map, mood board, and a
GM-curated subset of character summaries — never full sheets or notes).

## Media library

Maps, mood-screen images, token art, and character portraits, uploaded from
the GM console's **Media Library** tab. Files land under the same
`uploads/` volume already mounted at `/app/uploads` (i.e.
`/mnt/data_ssd/nas_share/SIT/uploads/{map,mood,token,portrait}/` on the
Pi) — no extra volume or setup needed. Uploaded images are served publicly
(no login) since the projector/tablet displaying them have none either;
nothing sensitive lives there.

## Campaign system

The GM console's **Campaign** tab is a small in-house wiki: events,
locations, NPCs, factions, and objects, each with a name/summary/body,
an optional image (from the media library, not required — plenty of lore
entries are just text), and freeform relationships to other entries (e.g.
"member of", "located in", "owned by" — shown from both ends). Every entry
defaults to GM-only; a "visible to players" checkbox reveals a specific one.
This intentionally replaces having a separate external tool for campaign
notes.

The **Characters** sub-tab covers both real PCs (from the `characters`
table, importable from Hephaistos below) and NPCs (campaign entries) side
by side, since both are "characters" from a GM's perspective.

## Importing characters from Hephaistos

The GM console's Campaign → Characters tab can import a character JSON
exported from [Hephaistos](https://hephaistos.online), a popular SF1e
character builder — either upload the `.json` file or paste its contents.
Maps ability scores, HP/SP/RP, EAC/KAC, saves, BAB, initiative, speed,
skills, feats, and inventory onto our `characters` schema. Optionally
assign the imported character directly to an existing player account (skip
this for NPCs, or when the player will self-link it by logging in first).

## On "automatic" rule effects

The Compendium surfaces full rules text (a feat's Benefit, a race's traits,
etc.) but does not parse that prose into structured mechanical effects or
auto-apply anything to a character sheet — e.g. taking a feat with a skill
bonus doesn't move the character's numbers on its own. This is a genuinely
hard, open-ended problem (reliably turning free-form rules text into
structured modifiers), and `03-features-scope.md` explicitly defers
"automated rules enforcement" past v1: state is tracked manually for now.
The `feats` JSONB column already exists on `characters` for storing which
feats a character has taken, but there's currently no UI to attach a
Compendium entry to a character — that's the natural next step if you want
manual-but-convenient tracking (effect text visible on the sheet) short of
full automation.

## Device roles

| Route | Device |
|---|---|
| `/gm` | PC — GM console + "Connect tracker" button (Web Serial, Chrome/Edge). **GM login required.** |
| `/player` | Player tablet / mobile — character sheet, scoped to the logged-in player's own character. **Player login required.** |
| `/tablet` | GM tablet — mood board (scenario art, featured characters), driven from `/gm`. No login (shared screen). |
| `/display` | Projector — fullscreen read-only battle map, auto-follows the latest active session. No login (shared screen). |
| `/compendium` | Any device — searchable rules lookup (feats/spells/races/classes) over `/api/aon`, filterable by category and source book. **Any login required** (GM or player). |

## Mini tracker protocol (placeholder)

`/gm` reads the PCB over Web Serial at 115200 baud, expecting ASCII lines:

```
POS,<tracker_id>,<x>,<y>\n
```

Adjust the regex/parsing in `frontend/src/views/GM.jsx` (`useMiniTracker`)
when firmware protocol is finalized. Bind a physical mini to a token by
setting the token's *Tracker ID* when adding it. Coordinates are POSTed to
`/api/battlemap/tracker/position` and broadcast to all clients over WS.

## Local dev (no Docker)

```
# terminal 1 — needs a local Postgres, or: docker run -e POSTGRES_PASSWORD=sf -e POSTGRES_USER=sf -e POSTGRES_DB=sf -p 5432:5432 postgres:16-alpine
cd backend && DATABASE_URL=postgres://sf:sf@localhost:5432/sf SESSION_SECRET=dev-only npm run dev
node scripts/create-user.js gm gm gmpass   # then log in with gm/gmpass

# terminal 2
cd frontend && npm install && npm run dev   # Vite proxies /api and /ws to :3000
```

## Iteration 1 status (vs roadmap doc)

- [x] Compose stack (backend, frontend, db) with SSD volume mapping
- [x] Express REST scaffold + WS broadcast
- [x] Postgres + migration runner
- [x] React routes `/gm` `/player` `/display` with live WS sync
- [x] Battle map grid, token add/move (click-to-move), projector auto-sync
- [x] Web Serial tracker hook + `/tracker/position` endpoint
- [x] Minimal character sheet (abilities, pools, defenses) with live +/- editing
- [x] Scene module: projector/tablet channels, mood presets, ESP32 light node registry
- [x] Content module: serves SDF data packs (see docs/06-data-format-sdf.md)
- [x] AoN scraper + validator + importer, with per-entry source book/page and full rules text (`backend/scripts/`, Feats + Spells + Races + Classes; see docs/04-data-pipeline-aon.md)
- [x] `/api/aon` search endpoint — filter by category, source book (single or a set), name (`backend/src/routes/aon.js`)
- [x] `/api/settings` generic key/value store, used for the GM's "owned sourcebooks" config (`backend/src/routes/settings.js`, `003_settings.sql`)
- [x] Compendium view (`/compendium`): browse/search/filter imported AoN data by category and source book, full effect text, defaults to GM's owned sources (`frontend/src/views/Compendium.jsx`)
- [x] GM "Owned sourcebooks" panel — sets the Compendium's default source filter (`frontend/src/components/SourcesConfig.jsx`)
- [x] Login system: one GM account + one account per player (auto-linked to their character), signed session cookies, server-side ownership checks on every character/battlemap/settings route (`backend/src/auth.js`, `004_users.sql`, `scripts/create-user.js`)
- [x] GM console restructured into tabs — Battle Map / Scene & Mood / Media Library / Campaign / Sources (`frontend/src/views/GM.jsx`)
- [x] Media library: upload/browse/delete maps, mood-screen images, token art, character portraits (`backend/src/routes/media.js`, `frontend/src/components/MediaLibrary.jsx`); wired into map images, token art (rendered on the battle map), and character portraits
- [x] Campaign system: typed entries (events/locations/NPCs/factions/objects) with relationships between them, GM-only by default with a per-entry "visible to players" flag (`backend/src/routes/campaign.js`, `006_campaign.sql`, `frontend/src/components/Campaign.jsx`)
- [x] Hephaistos character import: GM can import a character JSON export from hephaistos.online, optionally assigning it straight to a player account (`backend/src/hephaistos.js`, `POST /api/characters/import/hephaistos`)
- [ ] ESP32 firmware (spec in docs/07-modules-and-peripherals.md)
- [ ] Automatic rule effects (e.g. a feat's numeric bonus auto-applying to a character) — not implemented, see note below
