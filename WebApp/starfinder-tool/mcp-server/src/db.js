import pg from "pg";

// Same Postgres instance the backend uses (docker-compose puts both
// containers on the same network, pointed at the same DATABASE_URL) — but
// this pool only ever touches its own three tables below. It deliberately
// never queries `users`/`characters`/etc. directly: everything that isn't
// OAuth bookkeeping goes through the backend's REST API instead (see
// backend-client.js), so this process can't drift from the backend's
// validation/broadcast logic by reimplementing it.
export const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

export async function ensureSchema() {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS mcp_oauth_clients (
      client_id  TEXT PRIMARY KEY,
      metadata   JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS mcp_oauth_codes (
      code            TEXT PRIMARY KEY,
      client_id       TEXT NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
      redirect_uri    TEXT NOT NULL,
      code_challenge  TEXT NOT NULL,
      scopes          TEXT[] NOT NULL DEFAULT '{}',
      resource        TEXT,
      username        TEXT NOT NULL,
      expires_at      TIMESTAMPTZ NOT NULL,
      created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE TABLE IF NOT EXISTS mcp_oauth_tokens (
      token_hash        TEXT PRIMARY KEY,
      type              TEXT NOT NULL CHECK (type IN ('access', 'refresh')),
      client_id         TEXT NOT NULL REFERENCES mcp_oauth_clients(client_id) ON DELETE CASCADE,
      username          TEXT NOT NULL,
      scopes            TEXT[] NOT NULL DEFAULT '{}',
      resource          TEXT,
      paired_token_hash TEXT,
      expires_at        TIMESTAMPTZ,
      revoked           BOOLEAN NOT NULL DEFAULT false,
      created_at        TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX IF NOT EXISTS mcp_oauth_tokens_paired_idx ON mcp_oauth_tokens (paired_token_hash);
  `);
}
