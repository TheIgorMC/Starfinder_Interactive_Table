# Roadmap — Iteration 1 (handoff scope)

Goal: a working skeleton proving the architecture end-to-end, not full
feature completeness.

## Milestone checklist

1. **Infra**
   - [ ] docker-compose stack boots on Orange Pi via Dockge (backend, frontend, db)
   - [ ] Volumes correctly mapped to `/mnt/data_ssd/nas_share/SIT/...`

2. **Backend skeleton**
   - [ ] Express app with REST scaffold
   - [ ] WebSocket server broadcasting a test event
   - [ ] Postgres connection + migration tool (e.g. Prisma or Knex) set up

3. **Frontend skeleton**
   - [ ] React + Vite app with 3 routes: `/gm`, `/player`, `/display`
   - [ ] WS client hook, shows live connection status
   - [ ] Basic battle map view (static grid, manually placed test tokens)

4. **Mini tracker proof of concept**
   - [ ] `/gm` route requests Web Serial port, reads raw UART frames
   - [ ] Parses one test coordinate frame from the PCB
   - [ ] POSTs to `/api/battlemap/.../position`, confirms `/display` updates live

5. **Data pipeline proof of concept**
   - [x] Scraper pulls categories (Feats 477, Spells 615, Races 143, Classes 14) from aonsrd.com, incl. per-entry source book/page
   - [x] Normalized JSON stored in `aon-cache/`
   - [x] Imported into DB, queryable from `/api/aon` (filter by category/source/name)

6. **Character sheet (minimal)**
   - [ ] Create a character with core fields (abilities, class, level, HP)
   - [ ] Sheet view on `/player` route, live stat display

## Out of scope for iteration 1
Stores/inventory, full spell system, fog of war, session logs — these come
after the skeleton above is validated end-to-end.

## Reference docs
- `01-architecture.md` — system topology
- `02-deployment-dockge.md` — deployment/compose spec
- `03-features-scope.md` — full v1 feature target (for context, not iteration 1 scope)
- `04-data-pipeline-aon.md` — rules import approach
