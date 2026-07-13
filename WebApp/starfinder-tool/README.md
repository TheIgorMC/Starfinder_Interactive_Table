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
4. Copy `.env.example` → `.env` (inside `WebApp/starfinder-tool/`), set `DB_PASSWORD`
5. In Dockge: the stack appears automatically → Deploy
6. Open `http://<pi-ip>:7600`
7. To update: `git pull` in the repo, then redeploy the stack in Dockge

Note: `MapCreator/` elsewhere in the repo is a separate offline tool and is
not part of this stack — it doesn't run on the Pi.

## Device roles

| Route | Device |
|---|---|
| `/gm` | PC — GM console + "Connect tracker" button (Web Serial, Chrome/Edge) |
| `/player` | Player tablet / mobile — character sheets |
| `/tablet` | GM tablet — mood board (scenario art, featured characters), driven from `/gm` |
| `/display` | Projector — fullscreen read-only battle map, auto-follows the latest active session |

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
cd backend && DATABASE_URL=postgres://sf:sf@localhost:5432/sf npm run dev

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
- [ ] AoN scraper (table `aon_entries` is ready; importer is next task)
- [ ] ESP32 firmware (spec in docs/07-modules-and-peripherals.md)
