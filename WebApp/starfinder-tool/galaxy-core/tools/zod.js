// The tool definitions need zod, but galaxy-core has no node_modules of its
// own (it's imported by path from the backend and the MCP server). Each host
// injects its own zod once, before registering tools: setZod(z).
// ES-module live binding: `import { z } from "./zod.js"` sees the update.
// The tool modules use z at import time, so import them (dynamically) only
// after setZod — see runner.js / mcp-server tools.js.
export let z = null;
export function setZod(instance) {
  z = instance;
}
