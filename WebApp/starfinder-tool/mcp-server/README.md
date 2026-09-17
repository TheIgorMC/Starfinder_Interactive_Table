# MCP server

A remote MCP server (Streamable HTTP + OAuth 2.1) that lets an AI client —
primarily claude.ai's custom connector — import, edit and manage campaign
data, the compendium hand-review workflow, characters, and the mood
tablet/projector, through the same backend REST API the web UI uses.

## How it fits together

```
Claude (claude.ai)  --OAuth 2.1, HTTPS-->  mcp-server (this)  --X-Service-Token-->  backend  -->  Postgres
                                                  |
                                             (its own 3 tables:
                                              mcp_oauth_clients/codes/tokens)
```

- **Auth to the MCP server itself**: OAuth 2.1 with Dynamic Client
  Registration (RFC 7591) + PKCE. This server *is* the authorization
  server — no external IdP. There is exactly one account: the GM, checked
  against the real backend login (`POST /api/auth/login`) via a plain HTML
  login page (`src/login.js`) the first time a client connects. No
  per-player accounts here; see the auth-model decision in the project
  history if that ever needs to change.
- **Auth from mcp-server to backend**: a static shared secret
  (`MCP_SERVICE_TOKEN`), sent as the `X-Service-Token` header. The backend
  (`backend/src/auth.js`) treats a request carrying it as the GM — same
  role, same permissions as a logged-in GM browser session. Every tool call
  goes through the backend's normal REST routes (`src/backend-client.js`),
  so it gets the same validation and WebSocket broadcasts as the web UI —
  this process never talks to the app's own tables directly.
- **OAuth state** (registered clients, in-flight authorization codes,
  access/refresh tokens) lives in three tables this process creates itself
  on boot (`src/db.js`, `ensureSchema()`) in the *same* Postgres the backend
  uses, but never touches the backend's own tables.

## Environment variables

| Var | Example | Notes |
|---|---|---|
| `DATABASE_URL` | `postgres://sf:sf@db:5432/sf` | same DB as the backend |
| `PORT` | `3100` | |
| `BACKEND_URL` | `http://backend:3000` | internal docker-network URL |
| `MCP_SERVICE_TOKEN` | (random hex) | **must match** the backend's `MCP_SERVICE_TOKEN` |
| `MCP_PUBLIC_URL` | `https://sit-mcp.example.com` | the exact public origin, HTTPS, no trailing slash |
| `MCP_SESSION_SECRET` | (random hex) | signs the GM login cookie |

Generate secrets with `openssl rand -hex 32`. All of these are set in
`docker-compose.yml` from the repo-root `.env` (see `.env.example`).

This container expects to sit behind a reverse proxy that terminates TLS
at `MCP_PUBLIC_URL` and forwards to its port (`7601` by default in
`docker-compose.yml`) — it only speaks plain HTTP itself.

## Adding it to claude.ai

1. Deploy (`docker compose up -d mcp`) with a reverse proxy pointed at
   `MCP_PUBLIC_URL`.
2. In claude.ai: Settings → Connectors → Add custom connector, paste
   `MCP_PUBLIC_URL` (the server advertises everything else — metadata,
   registration endpoint — automatically).
3. Claude registers itself as an OAuth client and opens the authorize URL;
   you'll see this server's login page (GM username/password, the same
   ones `scripts/create-user.js` set up) once, then Claude is connected.

## Tools

See `src/tools.js` — compendium search/get, the review workflow
(list/get/update), the campaign wiki (list/get/upsert/link/import a .tgn
export), characters (list/get/update — inventory, HP, everything on the
sheet), and pushing to the mood tablet/projector/mood lights.
