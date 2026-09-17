import crypto from "node:crypto";
import { parse as parseCookieHeader, serialize as serializeCookie } from "cookie";
import { pool } from "./db.js";

const COOKIE_NAME = "sit_session";
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days — home game, favor convenience

// Lets the MCP server (WebApp/starfinder-tool/mcp-server/, a separate
// container — see docker-compose.yml) act as the GM without a browser
// session: it presents this shared secret on every request instead of a
// login cookie. There's exactly one GM account, so "the service token
// authenticates as the GM" needs no further scoping — the MCP server's own
// OAuth layer is what actually gates who can drive it. Unset in dev; the
// header is simply never checked then.
const MCP_SERVICE_TOKEN = process.env.MCP_SERVICE_TOKEN || "";
let cachedGmUser = null; // { id, username } — resolved once, GM accounts don't change often

function safeEqual(a, b) {
  const ab = Buffer.from(String(a ?? ""), "utf8");
  const bb = Buffer.from(String(b ?? ""), "utf8");
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

async function resolveGmServiceUser() {
  if (cachedGmUser) return cachedGmUser;
  try {
    const { rows } = await pool.query("SELECT id, username FROM users WHERE role='gm' ORDER BY id LIMIT 1");
    if (rows[0]) cachedGmUser = rows[0];
  } catch (err) {
    console.error("MCP service-token auth: could not resolve GM account", err);
  }
  return cachedGmUser;
}

// Sessions are a signed, not encrypted, JSON payload (uid/username/role/
// characterId/exp) in a cookie — no server-side session store needed.
// SESSION_SECRET should be set in production; if it's missing we generate a
// random one at boot so the app still works, at the cost of invalidating
// every session on restart (acceptable for a home deployment).
const SECRET = process.env.SESSION_SECRET || (() => {
  console.warn("SESSION_SECRET not set — generating an ephemeral one; all sessions will be invalidated on restart.");
  return crypto.randomBytes(32).toString("hex");
})();

function sign(payload) {
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const sig = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  return `${body}.${sig}`;
}

function verify(token) {
  if (!token) return null;
  const [body, sig] = token.split(".");
  if (!body || !sig) return null;
  const expected = crypto.createHmac("sha256", SECRET).update(body).digest("base64url");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8"));
    if (payload.exp && Date.now() > payload.exp) return null;
    return payload;
  } catch {
    return null;
  }
}

export function setSessionCookie(res, user) {
  const token = sign({
    uid: user.id,
    username: user.username,
    role: user.role,
    characterId: user.character_id ?? null,
    exp: Date.now() + MAX_AGE_SECONDS * 1000,
  });
  res.setHeader("Set-Cookie", serializeCookie(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    maxAge: MAX_AGE_SECONDS,
    path: "/",
  }));
}

export function clearSessionCookie(res) {
  res.setHeader("Set-Cookie", serializeCookie(COOKIE_NAME, "", { httpOnly: true, sameSite: "lax", maxAge: 0, path: "/" }));
}

// Parses the session cookie (if any) into req.user; never blocks the request.
export async function attachUser(req, _res, next) {
  const serviceToken = req.headers["x-service-token"];
  if (MCP_SERVICE_TOKEN && typeof serviceToken === "string" && safeEqual(serviceToken, MCP_SERVICE_TOKEN)) {
    const gm = await resolveGmServiceUser();
    if (gm) {
      req.user = { uid: gm.id, username: gm.username, role: "gm", characterId: null };
      return next();
    }
  }
  const cookies = parseCookieHeader(req.headers.cookie || "");
  req.user = verify(cookies[COOKIE_NAME]) || null;
  next();
}

export function requireAuth(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "login required" });
  next();
}

export function requireGM(req, res, next) {
  if (!req.user) return res.status(401).json({ error: "login required" });
  if (req.user.role !== "gm") return res.status(403).json({ error: "GM only" });
  next();
}

// Allows the GM (any character) or a player restricted to their own.
export function requireGmOrOwnCharacter(getCharacterId) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: "login required" });
    if (req.user.role === "gm") return next();
    const wantedId = Number(getCharacterId(req));
    if (req.user.characterId === wantedId) return next();
    return res.status(403).json({ error: "not your character" });
  };
}
