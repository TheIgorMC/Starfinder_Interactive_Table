# Starfinder Companion Tool — Architecture

## System Topology

```
                         ┌─────────────────────────────┐
                         │   Orange Pi 3B (server)      │
                         │   Docker + Dockge            │
                         │                              │
                         │  ┌────────────┐              │
                         │  │ Backend API│  Node.js      │
                         │  │ REST + WS  │              │
                         │  └─────┬──────┘              │
                         │        │                     │
                         │  ┌─────┴──────┐              │
                         │  │ Postgres/  │              │
                         │  │ SQLite     │              │
                         │  └────────────┘              │
                         │  ┌────────────┐              │
                         │  │ Static     │  React build │
                         │  │ web app    │              │
                         │  └────────────┘              │
                         └───────────┬──────────────────┘
                                     │ LAN (HTTP + WS)
        ┌────────────────┬──────────┼──────────────┬────────────────┐
        │                │          │              │                │
   ┌────┴────┐      ┌────┴────┐┌────┴─────┐   ┌────┴────┐     ┌─────┴─────┐
   │ Tablet   │      │Projector││   PC     │   │ Mobile  │     │  (future) │
   │ browser  │      │ browser ││ browser  │   │ browser │     │  clients  │
   └──────────┘      └─────────┘└────┬─────┘   └─────────┘     └───────────┘
                                      │ Web Serial API (USB CDC)
                                 ┌────┴─────┐
                                 │ Custom    │
                                 │ mini      │
                                 │ tracker   │
                                 │ PCB (Hall)│
                                 └───────────┘
```

## Key principle: server is the single source of truth

All clients (tablet, projector, PC, mobile) are plain browser tabs pointed at
the Pi. No client-side install, no bridge scripts. State lives on the Pi and
is pushed to clients over WebSocket; clients only ever read from WS/REST and
write via REST POST.

## Miniature tracker — no PC-side software

The PCB communicates over USB CDC (virtual serial port). Instead of a local
bridge script, the **PC's browser reads it directly via the Web Serial API**
(Chrome/Edge only, requires user to grant port access once per session).

Flow:
1. GM opens the web app on PC, clicks "Connect Tracker."
2. Browser requests Web Serial port access → reads UART frames from the PCB.
3. Browser parses Hall-sensor grid coordinates client-side.
4. Browser `POST`s coordinate updates to the Pi (`/api/battlemap/tokens/:id/position`).
5. Pi broadcasts the update over WebSocket to all connected clients (projector, tablet, etc.) so the battle map stays in sync everywhere instantly.

This satisfies "no extra scripts/tools on PC" — everything happens inside
the browser tab already open for the app.

## Components

| Component | Tech | Notes |
|---|---|---|
| Backend API | Node.js + Express | REST endpoints for CRUD (characters, items, maps) |
| Realtime layer | `ws` or Socket.IO | Token positions, initiative, shared map state |
| Database | PostgreSQL (preferred) or SQLite | Postgres recommended for concurrent multi-client writes; SQLite acceptable for v1 simplicity |
| Frontend | React + Vite | Single codebase, routed views per device role (`/gm`, `/player`, `/display`) |
| Rules data | Local cache tables, imported from Archives of Nethys (aonsrd.com) | One-time/periodic import job, not live-fetched per request |
| Mini tracker link | Web Serial API (browser) | No native drivers/scripts on PC |

## Client "roles"

Same React app, different routes/views depending on device role, selected on
first load or via URL:

- `/gm` — PC: full control panel, connects to mini tracker, manages battle map, NPCs, stores
- `/display` — Projector: read-only battle map + fog of war, no UI chrome
- `/player` — Tablet/mobile: character sheet, inventory, initiative, dice
- All routes are the same deployed app — role is just a client-side mode, backend treats all authenticated connections equivalently unless GM-only actions are gated.

## Data flow example (moving a token)

1. PC browser reads new coordinate from PCB via Web Serial.
2. PC `POST /api/battlemap/session/:id/tokens/:tokenId` with `{x, y}`.
3. Backend validates, writes to DB (or in-memory session state), broadcasts `token:moved` over WS.
4. Projector and tablets receive WS event, update map render locally — no polling.
