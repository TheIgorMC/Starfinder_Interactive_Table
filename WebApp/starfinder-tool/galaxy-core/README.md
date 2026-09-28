# galaxy-core

The galaxy library shared by every part of SIT — the former standalone
`GalaxyGen/` app's engine, merged into the stack so there is **one tool**:

| Folder | What | Used by |
|---|---|---|
| `lib/` | generators (sectors/fields/systems/bodies/hyperlanes/factions/actors/ships/events), `project.js` (schema + normalize), `sdf.js` (SDF entry builders), `settlement.js` (settlement layout + renderer), `cityGen.js`/`stationGen.js` (skeletons, `Docs/15-settlement-generators.md`) | frontend Galaxy Editor + viewer, backend (via tools) |
| `tools/` | galaxy MCP tool definitions (name, description, zod shape, handler) + `runner.js` | backend executes them (`POST /api/galaxy/tool/:name`), mcp-server registers them as `galaxy_*` proxies |
| `samples/` | old GalaxyGen project snapshots (ARTS r1–r4), importable from the Galaxy Data tab | — |

Rules:

- **No dependencies, no bare imports.** It's imported by relative path
  (`../../galaxy-core/...` from backend/mcp-server, `@galaxy-core/...` vite
  alias in the frontend), so it can't resolve packages. The tool modules
  need zod: each host injects its own with `setZod(z)` from `tools/zod.js`,
  and only then imports the tool modules (they build shapes at load time).
- Pure functions over a project object; generators return a new project,
  never mutate. The one stored project is edited in place by the Galaxy
  Editor and the tools — see the Galaxy section of `../README.md`.
- Docker: every image is built with the stack root as context and copies
  this folder to `/galaxy-core` (see the Dockerfiles).

`FEATURES.md` is the old GalaxyGen feature log (phases 1–6), kept for
reference; the design doc is `Docs/10-galaxy-mapgen.md`.
