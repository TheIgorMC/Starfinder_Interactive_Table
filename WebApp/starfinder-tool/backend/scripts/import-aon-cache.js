#!/usr/bin/env node
// Imports validated aon-cache/ JSON into the `aon_entries` table.
// Run this against whichever Postgres DATABASE_URL points at — locally
// against a dev DB, or on the Pi after the cache has been synced there.
// Usage: DATABASE_URL=postgres://... node scripts/import-aon-cache.js [path-to-aon-cache]

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.name.endsWith(".json")) yield full;
  }
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const root = path.resolve(process.argv[2] || process.env.AON_CACHE_DIR || "aon-cache");
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  let count = 0;
  for await (const file of walk(root)) {
    const entry = JSON.parse(await readFile(file, "utf8"));
    await pool.query(
      `INSERT INTO aon_entries (category, name, source, url, data, mechanics)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (category, name) DO UPDATE
       SET source = EXCLUDED.source, url = EXCLUDED.url, data = EXCLUDED.data, mechanics = EXCLUDED.mechanics`,
      [
        entry.category, entry.name, entry.source || "", entry.url || "",
        JSON.stringify(entry.data || {}), JSON.stringify(entry.mechanics || {}),
      ]
    );
    count++;
  }

  console.log(`Imported ${count} entries from ${root} into aon_entries`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
