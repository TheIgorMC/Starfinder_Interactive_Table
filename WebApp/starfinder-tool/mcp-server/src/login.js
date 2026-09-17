import { Router } from "express";
import { checkGmLogin } from "./backend-client.js";
import { gmSessionCookie } from "./oauth-provider.js";

// The only UI this server has: a login form the GM sees once per OAuth
// consent (their Claude client redirects here via /authorize). Credentials
// are checked against the real backend login endpoint — this process never
// stores or compares a password itself (see backend-client.js#checkGmLogin).
export const loginRouter = Router();

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function renderForm({ returnTo, error }) {
  return `<!doctype html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>Starfinder Interactive Table — MCP Access</title>
<style>
  body { font-family: system-ui, sans-serif; background: #0b0d12; color: #e8ecf4; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  form { background: #151924; border: 1px solid #262c3b; border-radius: 14px; padding: 32px; width: 320px; }
  h1 { font-size: 18px; margin: 0 0 4px; }
  p.sub { color: #9aa4b8; font-size: 13px; margin: 0 0 20px; }
  label { display: block; font-size: 13px; margin: 14px 0 6px; }
  input { width: 100%; box-sizing: border-box; padding: 9px 10px; border-radius: 8px; border: 1px solid #2c3244; background: #0f1219; color: #e8ecf4; font-size: 14px; }
  button { margin-top: 20px; width: 100%; padding: 10px; border-radius: 8px; border: none; background: #6ea8ff; color: #06101f; font-weight: 600; cursor: pointer; }
  .error { color: #ff9b84; font-size: 13px; margin-top: 10px; }
</style></head>
<body>
  <form method="POST" action="/login">
    <h1>Starfinder Interactive Table</h1>
    <p class="sub">Sign in as GM to let this Claude connect.</p>
    <input type="hidden" name="return_to" value="${escapeHtml(returnTo)}">
    <label>Username</label>
    <input name="username" autocomplete="username" autofocus required>
    <label>Password</label>
    <input name="password" type="password" autocomplete="current-password" required>
    <button type="submit">Sign in</button>
    ${error ? `<p class="error">${escapeHtml(error)}</p>` : ""}
  </form>
</body></html>`;
}

loginRouter.get("/login", (req, res) => {
  const returnTo = typeof req.query.return_to === "string" ? req.query.return_to : "/";
  res.type("html").send(renderForm({ returnTo, error: null }));
});

loginRouter.post("/login", async (req, res) => {
  const { username, password, return_to } = req.body || {};
  const returnTo = typeof return_to === "string" && return_to.startsWith("/") ? return_to : "/";
  if (!username || !password) {
    return res.type("html").send(renderForm({ returnTo, error: "Username and password required." }));
  }
  const ok = await checkGmLogin(username, password).catch(() => false);
  if (!ok) {
    return res.type("html").send(renderForm({ returnTo, error: "Invalid GM credentials." }));
  }
  res.setHeader("Set-Cookie", gmSessionCookie(username));
  res.redirect(returnTo);
});
