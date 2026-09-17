// Every MCP tool goes through the backend's own REST API — never straight
// to Postgres — so it gets exactly the same validation, ownership checks,
// and WS broadcasts (GM console/tablet/display all stay in sync) as a
// request from the web UI. Authenticates as the GM via the shared
// X-Service-Token header (see backend/src/auth.js).

const BACKEND_URL = process.env.BACKEND_URL || "http://backend:3000";
const SERVICE_TOKEN = process.env.MCP_SERVICE_TOKEN || "";

if (!SERVICE_TOKEN) {
  console.warn("MCP_SERVICE_TOKEN is not set — every backend call will be rejected as unauthenticated.");
}

async function call(path, opts = {}) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...opts,
    headers: { "X-Service-Token": SERVICE_TOKEN, ...opts.headers },
  });
  const text = await res.text();
  const data = text ? JSON.parse(text) : null;
  if (!res.ok) throw new Error(data?.error || `backend ${path} → HTTP ${res.status}`);
  return data;
}

export function backendGet(path) {
  return call(path);
}

export function backendJson(method, path, body) {
  return call(path, { method, headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
}

export async function backendUploadTgn(path, content) {
  const form = new FormData();
  form.append("file", new Blob([content], { type: "text/yaml" }), "campaign.tgn");
  return call(path, { method: "POST", body: form });
}

// A plain, unauthenticated call to the backend's own login endpoint — used
// only by the OAuth /login page to check GM credentials. Deliberately
// bypasses the service-token path above (this call has no token to send);
// the backend's normal bcrypt check does the real work, this process never
// touches password hashes itself.
export async function checkGmLogin(username, password) {
  const res = await fetch(`${BACKEND_URL}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) return false;
  const data = await res.json().catch(() => null);
  return data?.role === "gm";
}
