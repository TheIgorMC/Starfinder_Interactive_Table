import * as state from "./state.js";

// Host-side execution of the galaxy MCP tools against a project held in
// memory (the SIT backend loads it from Postgres, runs one call, saves the
// result back if it changed). Callers must serialize calls — state.js is a
// single module-level slot.
//
// The tool modules build zod shapes at import time, so they're imported
// lazily — after the host has called setZod().
let cached = null;
async function tools() {
  if (!cached) cached = (await import("./index.js")).collectTools();
  return cached;
}

export async function listTools() {
  return (await tools()).map(({ name, description }) => ({ name, description }));
}

// -> { result: <MCP tool result>, project: <next project>, dirty: boolean }
export async function runTool(z, project, name, args) {
  const t = (await tools()).find((x) => x.name === name);
  if (!t) throw Object.assign(new Error(`unknown galaxy tool: ${name}`), { status: 404 });
  const input = z.object(t.shape).parse(args || {});
  state.load(project);
  try {
    const result = await t.handler(input);
    const { project: next, dirty } = state.take();
    return { result, project: next, dirty };
  } finally {
    state.take();
  }
}
