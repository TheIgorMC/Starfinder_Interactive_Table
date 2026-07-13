import crypto from "node:crypto";
import { parse as parseCookieHeader, serialize as serializeCookie } from "cookie";

const COOKIE_NAME = "sit_session";
const MAX_AGE_SECONDS = 30 * 24 * 60 * 60; // 30 days — home game, favor convenience

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
export function attachUser(req, _res, next) {
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
