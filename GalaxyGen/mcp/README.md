# GalaxyGen MCP server

An MCP (Model Context Protocol) server that lets an AI tool — Claude Code,
Claude Desktop, any MCP client — drive GalaxyGen's actual galaxy generators
(`../src/lib/systemGen.js`, `planetGen.js`, `hyperlaneGen.js`,
`factionGen.js`, `actorGen.js`, ...) directly, without the browser app open.
Built because local LLMs (the app's own AI tab, `Docs/11-AI-integration.md`)
don't have the context window for large galaxy-authoring jobs — this gives
a much larger model (or a human working through one) the same generation
and editing power over a project file that the app's UI has.

## The contract: file-based, not live-app-sync

This server operates on a **project `.json` file on disk** — the exact
same format the app's own "Save .json"/"Load .json" buttons read and
write. It does **not** talk to a running browser tab. That means:

- `load_project` reads a file into this server's memory; every other tool
  mutates that in-memory copy; `save_project` writes it back out.
- Nothing touches disk until `save_project` is explicitly called — you can
  make a dozen tool calls, inspect the result, and only save once you're
  happy (or not at all).
- If the app is open in a browser on the *same* file, the two won't see
  each other's changes live — reload the page after this server saves, or
  re-run `load_project` here after the app autosaves, whichever direction
  you're working in. A live two-way bridge is a possible future addition,
  not what this is.

## Setup

```bash
cd GalaxyGen/mcp
npm install
```

Then point an MCP client at it. For Claude Code, add to its MCP config
(exact file depends on client — see that client's docs for where):

```json
{
  "mcpServers": {
    "galaxygen": {
      "command": "node",
      "args": ["/absolute/path/to/GalaxyGen/mcp/server.js"]
    }
  }
}
```

No API keys, no network access — it's a local stdio server operating on
local files.

## Architecture (read this before adding a tool)

```
mcp/
  server.js          entry point: Node crypto polyfill, wires up the MCP
                      server, connects stdio transport
  lib/
    state.js          the one mutable in-memory project + its file path
    respond.js         ok()/err()/tool() — response-shape + error-handling
                        boilerplate every tool handler shares
    refs.js             uniqueSlug/findBySlug/replaceBySlug + one lookup
                         helper per entity type (sector/system/faction/...)
  tools/
    index.js            imports every category module, calls its register()
    project.js           new_project, load_project, save_project, project_info
    sectors.js
    fields.js            paint_field, fill_sector_field, sample_field
    systems.js
    planets.js            bodies + stations live here
    hyperlanes.js
    factions.js
    actors.js
    organizations.js
    query.js              get_ai_index, get_raw_project, export_sdf
  test-harness.mjs     spawns the real server via a real MCP client and
                        exercises a full workflow — run after any change
```

Every `tools/*.js` file exports one function: `register(server)`, which
calls `server.tool(name, description, zodShape, handler)` once per tool.
`tools/index.js` just imports every module and calls its `register`.

**Every handler is pure business logic reusing `../src/lib/*.js` directly**
— no MCP tool file re-implements generation math. A tool's job is: read
`state.requireProject()`, call the same function `App.jsx` would call,
`state.setProject(result)`, return something JSON-serializable. Wrap the
handler in `tool(...)` from `lib/respond.js` and any thrown `Error` becomes
a clean tool-error result instead of crashing the server.

### Adding a tool to an existing category

Open the right `tools/*.js` file and add another `server.tool(...)` call
inside its `register` function. Nothing else needs to change — `index.js`
already has that category wired up. Example shape:

```js
server.tool(
  "my_new_tool",
  "One sentence a model will read to decide whether to call this.",
  { someArg: z.string(), optionalArg: z.number().optional() },
  tool(({ someArg, optionalArg }) => {
    const project = state.requireProject();
    // ...call into ../src/lib/whatever.js, or read/patch project by hand...
    state.setProject(nextProject); // only if this tool mutates
    return { whatever: "JSON-serializable result" };
  }),
);
```

### Adding a whole new category

1. Create `tools/mycategory.js` following the pattern above.
2. Add `import * as mycategory from "./mycategory.js";` and `mycategory` to
   the `MODULES` array in `tools/index.js`.

The most obvious near-term candidate is an `events.js` wrapping
`../src/lib/effectEngine.js`'s `applyEvent` (§9's event/effect pipeline) —
not built yet because nothing in the current tool list needed it, not
because it's hard; every `apply*` in that file is already a pure
`(project, effect) -> project` function, same shape as everything else
here.

### A Node quirk worth knowing if something says "crypto is not defined"

The browser lib files call `crypto.randomUUID()` as an ambient global, same
as any browser code can. On at least this project's Node version, that
global is only wired up when Node is started with `node -e "..."`, **not**
when running an actual `.mjs` file — so without the polyfill at the top of
`server.js` (`globalThis.crypto = webcrypto` from `node:crypto`), every
generator that mints entity ids (`generate_systems`, `generate_hyperlanes`,
`generate_factions`, `generate_background_actors`, `create_*`) would throw.
If you ever run one of the `src/lib/*.js` files standalone in a new script
(a sweep test, say) and hit that error, add the same two lines at the top.

## Testing changes

```bash
node test-harness.mjs
```

Spawns the real server as a subprocess through the actual MCP SDK client
(not a mocked call path) and runs a full workflow: new project → sector →
paint fields → generate systems/hyperlanes/planets → add/edit/delete a
body and a station → factions → actors → organizations → AI index →
save/reload. Extend it alongside new tools rather than trusting a new tool
compiles cleanly with no functional check.

## Tool list (v1)

- **project**: `new_project`, `load_project`, `save_project`, `project_info`
- **sectors**: `list_sectors`, `get_sector`, `create_sector`, `update_sector`, `delete_sector`
- **fields**: `paint_field`, `fill_sector_field`, `sample_field`
- **systems**: `list_systems`, `get_system`, `generate_systems`, `redistribute_systems`, `place_system`, `update_system`, `delete_system`
- **planets**: `generate_planets`, `reroll_system_bodies`, `get_system_bodies`, `update_body`, `add_body`, `delete_body`
- **hyperlanes**: `list_hyperlanes`, `generate_hyperlanes`, `toggle_hyperlane`
- **factions**: `list_factions`, `get_faction`, `create_faction`, `update_faction`, `delete_faction`, `generate_factions`
- **actors**: `list_actors`, `get_actor`, `create_actor`, `update_actor`, `delete_actor`, `generate_background_actors`
- **organizations**: `list_organizations`, `get_organization`, `create_organization`, `update_organization`, `delete_organization`
- **query**: `get_ai_index`, `get_raw_project`, `export_sdf`

Not yet covered: the event/effect log (§9 — see above), sector vertex
editing after creation (the app itself doesn't support this either), and
live sync with an open browser tab.
