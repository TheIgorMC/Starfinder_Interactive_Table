// Every tool handler in this server returns through one of these two, so
// the shape returned to the MCP client is consistent everywhere: JSON data
// pretty-printed into a single text content block. Errors are reported as
// tool results (isError: true) rather than thrown across the transport —
// standard MCP practice, and it means a client sees a readable message
// instead of a raw JSON-RPC error.
export function ok(data) {
  const text = typeof data === "string" ? data : JSON.stringify(data, null, 2);
  return { content: [{ type: "text", text }] };
}

export function err(error) {
  const message = error instanceof Error ? error.message : String(error);
  return { content: [{ type: "text", text: message }], isError: true };
}

// Wraps a tool handler so every module doesn't need its own try/catch —
// thrown errors (missing project, entity not found, invalid input) become
// a normal tool error result instead of crashing the server process.
export function tool(handler) {
  return async (...args) => {
    try {
      return ok(await handler(...args));
    } catch (error) {
      if (process.env.GALAXYGEN_MCP_DEBUG) console.error(error?.stack || error);
      return err(error);
    }
  };
}
