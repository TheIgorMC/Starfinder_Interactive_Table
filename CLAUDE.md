# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Repo layout

- `WebApp/starfinder-tool/` — the actual deployed app (backend + frontend + docker-compose). Everything below refers to this unless noted.
- `Docs/` — design docs (`01-architecture.md` through `14-automated-rules-engine.md`), plus `Docs/ReferenceFoundry/` (a gitignored local checkout of the community FoundryVTT Starfinder system, used as an import source — see "The aon-cache data pipeline" below).
- `GalaxyGen/`, `MapCreator/` — separate offline tools, not part of the deployed stack.
- `DataEntry/` — a normalized-draft authoring pipeline for race/class/archetype/theme data (`normalize-entries.js` → `DataEntry/output/`). **Nothing imports this anywhere** — not into the database, not back into `aon-cache/`. It's a parallel, disconnected authoring effort; don't assume it affects what's served. See `Docs/04-data-pipeline-aon.md`.

## Commands

All from `WebApp/starfinder-tool/backend/` unless noted.

```bash
# local dev (no Docker) — needs a local Postgres
DATABASE_URL=postgres://sf:sf@localhost:5432/sf SESSION_SECRET=dev-only npm run dev
node scripts/create-user.js gm gm gmpass   # first-run: create a login

# frontend, separate terminal
cd ../frontend && npm run dev   # Vite proxies /api and /ws to :3000

# tests (backend only — node's built-in runner, no separate test framework)
npm test                                  # node --test src — currently src/rules-engine/*.test.js
node --test src/rules-engine/formula-evaluator.test.js   # single file

# frontend build (no dev-time lint/typecheck configured anywhere in this repo)
cd frontend && npm run build
```

There is no lint script in either `package.json` — don't invent one.

### The aon-cache data pipeline

Rules content (feats/spells/races/equipment/conditions/...) is imported from two sources into `aon-cache/` (gitignored — regenerate, don't hand-edit expecting it to persist across a re-import) and from there into Postgres:

```bash
node scripts/import-foundry.js [folder...] [--src=path]   # preferred: reads Docs/ReferenceFoundry/foundryvtt-starfinder-development/src/items by default
node scripts/scrape-aon.js                                 # fallback for categories Foundry doesn't cover (Equipment, Themes, rules/setting/tables)
node scripts/validate-aon-cache.js
node scripts/import-aon-cache.js                            # THE step that actually pushes aon-cache/ into the live `aon_entries` table — needs DATABASE_URL
```

Grounded consistency checker (re-verifies derived `mechanics.*` fields against each entry's own source text via a **local** Ollama model — never trusts an LLM verdict blindly, never checks against "real Starfinder rules" from model memory):

```bash
node scripts/audit-normalized.js <category> --random --seed=N   # any aon-cache/ folder name, or "races" (→ the disconnected DataEntry draft) / "races-raw" (→ actual aon-cache/races)
```

Needs Ollama reachable at `--ollama-url` (default `http://localhost:11434/v1`); start it yourself with `ollama serve` if it's down. Findings land in `DataEntry/output/_audits/<category>/_findings.json` (also gitignored) — `aon-cache/` itself is left untouched by an audit run; fixes found this way get applied by hand to the specific `aon-cache/**/*.json` file. Full history of what's been audited, what was fixed, and every false-positive pattern the local model reliably falls into is in `Docs/04-data-pipeline-aon.md` — read it before re-running an audit on a category, it'll save you from rediscovering the same checker bugs.

## Architecture

**Server is the single source of truth.** All clients (GM PC, player tablets, projector, GM's mood-board tablet) are plain browser tabs against the Pi backend — no client install. State lives server-side; clients read via REST/WS and write via REST POST, and the backend broadcasts changes over WebSocket (`src/ws.js`) so every connected client stays in sync with no polling.

**Device roles are just routes**, not separate deployments — one React app, `/gm` `/player` `/display` `/tablet` `/compendium`, gated by login where noted (see `WebApp/starfinder-tool/README.md` → "Device roles" table for the exact who-needs-login matrix). `frontend/src/views/GM.jsx`'s `useMiniTracker` hook reads a custom PCB over the **browser's** Web Serial API directly (no local bridge script) and POSTs coordinates to `/api/battlemap/tracker/position`.

**Auth** (`src/auth.js`): signed-but-not-encrypted session cookie (HMAC-SHA256 over a JSON payload), no server-side session store. `SESSION_SECRET` unset → a random one is generated at boot, silently logging out everyone on every restart — fine for dev, a real problem if it happens in production (see `.env.example`). One GM account (sees/controls everything) + one character per player account, enforced server-side, not just in the UI.

**Two-tier rules-content pipeline**, detailed in `Docs/04-data-pipeline-aon.md`:
`aon-cache/` (gitignored, Foundry-import or AoN-scrape output, `{data, mechanics}` per entry) → `import-aon-cache.js` → Postgres `aon_entries` table → `/api/aon`. Foundry-sourced entries carry a real `mechanics.modifiers[]` array of formula-capable bonuses (`mechanicsSource: "foundry"`); AoN-scraped entries get a lighter regex-based `mechanics-parser.js` pass instead (`mechanicsSource: "derived"`, and `derive-mechanics.js` explicitly skips anything already Foundry-sourced rather than downgrading it). Both shapes are documented together in `Docs/04-data-pipeline-aon.md` → "The Modifiers system".

**Automated rules engine** (`src/rules-engine/`, design doc `Docs/14-automated-rules-engine.md`): Phase 1 only (Character Context builder + a sandboxed formula evaluator for the `@`-path formula strings Foundry modifiers carry — deliberately not `eval()`, a fixed-grammar recursive-descent parser). Nothing past this is built yet: no UI reads a Compendium entry onto a character, no effective-stat computation, no active-effects tracking, no damage resolution, no initiative. Taking a feat/item does not move any number on a character sheet automatically — state is tracked manually. Don't assume otherwise; check the doc's §10 phased roadmap for what's actually landed vs. still planned.

**Migrations** (`backend/migrations/*.sql`) run automatically at boot (`db.js`'s `migrate()`), tracked in a `_migrations` table, applied in filename order inside a transaction. Add a new numbered file; don't edit an already-applied one.

## Deployed instance — account management

Deployed on an Orange Pi via Docker + Dockge (`Docs/02-deployment-dockge.md`). No self-registration UI — every account is created/reset via a CLI script run inside the backend container:

```bash
docker compose exec backend node scripts/create-user.js gm alice "newpassword"
docker compose exec backend node scripts/create-user.js player bob "newpassword" [characterId]
```

**Password reset = re-run this with the existing username.** It's an upsert (`ON CONFLICT (username) DO UPDATE`), so the same command creates *or* resets.

**Gotcha, easy to get wrong**: the upsert always overwrites `character_id` with whatever you pass — omit it on a *player* reset and it sets their link to `NULL`, silently unlinking their character. For a GM reset this doesn't matter (GMs have no `character_id`). For a player, look up their current `character_id` first (e.g. `docker compose exec db psql -U sf -d sf -c "SELECT id, username, character_id FROM users WHERE username='bob'"`) and pass it explicitly, or the player will see the "create your character" prompt again on next login instead of their existing sheet.

There's no email/self-service flow at all — a locked-out user has to ask whoever runs the Pi to run this command for them.
