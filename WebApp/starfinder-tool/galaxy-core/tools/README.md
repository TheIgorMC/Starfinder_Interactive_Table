# Galaxy MCP tools

The former GalaxyGen MCP server's tools, now served by the **SIT MCP
server** (`mcp-server/`) as `galaxy_<name>` — e.g. `galaxy_generate_systems`,
`galaxy_update_system`, `galaxy_add_body`, `galaxy_get_ai_index`.

```
claude.ai ──► mcp-server  (registers galaxy_* from these definitions)
                 │ POST /api/galaxy/tool/<name>  (X-Service-Token = GM)
                 ▼
              backend  ── loads the stored project → runner.js runs the
                          handler → saves it if it changed (version+1)
                          → WS "galaxy:updated" (editor/viewer refresh)
```

- No file-based load/save any more: every tool works on the campaign's one
  stored galaxy, the same one the Galaxy Editor edits. `project_info`
  replaces `new_project`/`load_project`/`save_project`; `export_sdf` was
  dropped (the editor's Project tab still exports SDF).
- Calls are serialized in the backend; a tool that returns an error never
  saves.

## Adding a tool

Add it to the category module (`systems.js`, `planets.js`, …) with
`server.tool(name, description, zodShape, tool(handler))`, using `z` from
`./zod.js` and `state.requireProject()` / `state.setProject(next)`. A new
category module also needs a line in `index.js`. Nothing to change in
backend or mcp-server — both pick up every tool from `collectTools()`.
