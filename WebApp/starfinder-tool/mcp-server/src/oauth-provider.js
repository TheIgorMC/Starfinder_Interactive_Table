import crypto from "node:crypto";
import { parse as parseCookie } from "cookie";
import { pool } from "./db.js";

// A from-scratch OAuth 2.1 authorization server for exactly one purpose:
// gating this MCP server to the single GM account. Dynamic Client
// Registration (RFC 7591) is handled generically by the SDK's own router —
// this module only implements the actual authorize/token/verify logic,
// backed by the three tables in db.js instead of the SDK's in-memory demo
// provider (see @modelcontextprotocol/sdk's demoInMemoryOAuthProvider —
// this is the same shape, made durable and wired to a real login).

const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour
const AUTH_CODE_TTL_SECONDS = 10 * 60;
const COOKIE_NAME = "mcp_gm_auth";
const COOKIE_SECRET = process.env.MCP_SESSION_SECRET || (() => {
  console.warn("MCP_SESSION_SECRET not set — generating an ephemeral one; the GM will need to re-login after every restart.");
  return crypto.randomBytes(32).toString("hex");
})();

const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
const randomToken = () => crypto.randomBytes(32).toString("hex");

function signCookie(username) {
  const payload = `${username}.${Date.now() + 24 * 60 * 60 * 1000}`;
  const sig = crypto.createHmac("sha256", COOKIE_SECRET).update(payload).digest("hex");
  return `${payload}.${sig}`;
}

function verifyCookie(token) {
  if (!token) return null;
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [username, expStr, sig] = parts;
  const payload = `${username}.${expStr}`;
  const expected = crypto.createHmac("sha256", COOKIE_SECRET).update(payload).digest("hex");
  if (sig.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) return null;
  if (Date.now() > Number(expStr)) return null;
  return username;
}

// Exported so the /login route (login.js) can set the cookie after a
// successful password check, using the exact same format authorize() reads.
export function gmSessionCookie(username) {
  return `${COOKIE_NAME}=${signCookie(username)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=86400`;
}
export function gmUsernameFromRequest(req) {
  return verifyCookie(parseCookie(req.headers.cookie || "")[COOKIE_NAME]);
}

class PgClientsStore {
  async getClient(clientId) {
    const { rows } = await pool.query("SELECT metadata FROM mcp_oauth_clients WHERE client_id=$1", [clientId]);
    return rows[0]?.metadata;
  }
  async registerClient(clientMetadata) {
    await pool.query(
      `INSERT INTO mcp_oauth_clients (client_id, metadata) VALUES ($1,$2)
       ON CONFLICT (client_id) DO UPDATE SET metadata = EXCLUDED.metadata`,
      [clientMetadata.client_id, JSON.stringify(clientMetadata)]
    );
    return clientMetadata;
  }
}

export class PgOAuthProvider {
  clientsStore = new PgClientsStore();

  // Called by the SDK's /authorize handler once client_id/redirect_uri are
  // already validated. If the browser isn't holding a valid GM cookie yet,
  // bounce through /login (preserving the full original query string) —
  // login.js redirects back here afterward, and this runs again with the
  // cookie now present.
  async authorize(client, params, res) {
    const req = res.req;
    const username = gmUsernameFromRequest(req);
    if (!username) {
      const returnTo = req.originalUrl;
      res.redirect(`/login?return_to=${encodeURIComponent(returnTo)}`);
      return;
    }

    const code = randomToken();
    await pool.query(
      `INSERT INTO mcp_oauth_codes (code, client_id, redirect_uri, code_challenge, scopes, resource, username, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, now() + interval '${AUTH_CODE_TTL_SECONDS} seconds')`,
      [code, client.client_id, params.redirectUri, params.codeChallenge, params.scopes || [], params.resource?.toString() || null, username]
    );

    const target = new URL(params.redirectUri);
    target.searchParams.set("code", code);
    if (params.state !== undefined) target.searchParams.set("state", params.state);
    res.redirect(target.toString());
  }

  async challengeForAuthorizationCode(client, authorizationCode) {
    const { rows } = await pool.query(
      "SELECT code_challenge FROM mcp_oauth_codes WHERE code=$1 AND client_id=$2 AND expires_at > now()",
      [authorizationCode, client.client_id]
    );
    if (!rows[0]) throw new Error("invalid, expired, or already-used authorization code");
    return rows[0].code_challenge;
  }

  async exchangeAuthorizationCode(client, authorizationCode, _codeVerifier, redirectUri, resource) {
    const { rows } = await pool.query(
      "DELETE FROM mcp_oauth_codes WHERE code=$1 AND client_id=$2 AND expires_at > now() RETURNING *",
      [authorizationCode, client.client_id]
    );
    const codeRow = rows[0];
    if (!codeRow) throw new Error("invalid, expired, or already-used authorization code");
    if (redirectUri && redirectUri !== codeRow.redirect_uri) throw new Error("redirect_uri mismatch");

    return this.#issueTokenPair(client.client_id, codeRow.username, codeRow.scopes, resource?.toString() || codeRow.resource);
  }

  async exchangeRefreshToken(client, refreshToken, scopes, resource) {
    const hash = sha256(refreshToken);
    const { rows } = await pool.query(
      `SELECT * FROM mcp_oauth_tokens WHERE token_hash=$1 AND type='refresh' AND client_id=$2 AND NOT revoked`,
      [hash, client.client_id]
    );
    const row = rows[0];
    if (!row) throw new Error("invalid or revoked refresh token");
    // Rotate: the old refresh token (and its paired access token) are
    // revoked, a fresh pair is issued — standard refresh-token rotation.
    await pool.query("UPDATE mcp_oauth_tokens SET revoked=true WHERE token_hash=$1 OR paired_token_hash=$1", [hash]);
    return this.#issueTokenPair(client.client_id, row.username, scopes?.length ? scopes : row.scopes, resource?.toString() || row.resource);
  }

  async verifyAccessToken(token) {
    const hash = sha256(token);
    const { rows } = await pool.query(
      `SELECT * FROM mcp_oauth_tokens WHERE token_hash=$1 AND type='access' AND NOT revoked AND expires_at > now()`,
      [hash]
    );
    const row = rows[0];
    if (!row) throw new Error("invalid or expired access token");
    return {
      token,
      clientId: row.client_id,
      scopes: row.scopes,
      expiresAt: Math.floor(new Date(row.expires_at).getTime() / 1000),
      resource: row.resource || undefined,
      extra: { username: row.username },
    };
  }

  async revokeToken(client, request) {
    await pool.query(
      "UPDATE mcp_oauth_tokens SET revoked=true WHERE token_hash=$1 AND client_id=$2",
      [sha256(request.token), client.client_id]
    );
  }

  async #issueTokenPair(clientId, username, scopes, resource) {
    const accessToken = randomToken();
    const refreshToken = randomToken();
    const accessHash = sha256(accessToken);
    const refreshHash = sha256(refreshToken);

    await pool.query(
      `INSERT INTO mcp_oauth_tokens (token_hash, type, client_id, username, scopes, resource, paired_token_hash, expires_at)
       VALUES ($1,'access',$2,$3,$4,$5,$6, now() + interval '${ACCESS_TOKEN_TTL_SECONDS} seconds')`,
      [accessHash, clientId, username, scopes || [], resource || null, refreshHash]
    );
    await pool.query(
      `INSERT INTO mcp_oauth_tokens (token_hash, type, client_id, username, scopes, resource, paired_token_hash, expires_at)
       VALUES ($1,'refresh',$2,$3,$4,$5,$6, null)`,
      [refreshHash, clientId, username, scopes || [], resource || null, accessHash]
    );

    return {
      access_token: accessToken,
      token_type: "bearer",
      expires_in: ACCESS_TOKEN_TTL_SECONDS,
      refresh_token: refreshToken,
      scope: (scopes || []).join(" "),
    };
  }
}
