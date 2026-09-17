#!/usr/bin/env node
// Imports a Tangent (.tgn) campaign export into campaign_entries/
// campaign_links. See src/tgn-import.js for the parsing/mapping rules.
// Usage: DATABASE_URL=postgres://... node scripts/import-campaign-tgn.js <file.tgn>
// (The same import is also available to a GM from the app itself — see
// POST /api/campaign/import-tgn — this CLI form is for local/offline use.)

import { readFile } from "node:fs/promises";
import pg from "pg";
import { parseTgn, importTgnIntoDb } from "../src/tgn-import.js";

async function main() {
  const file = process.argv[2];
  if (!file) throw new Error("usage: node scripts/import-campaign-tgn.js <file.tgn>");
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");

  const text = await readFile(file, "utf8");
  const parsed = parseTgn(text);
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const result = await importTgnIntoDb(pool, parsed);
  console.log(
    `Parsed ${parsed.entries.length} entries and ${parsed.links.length} links from ${file}.\n` +
    `Inserted ${result.entriesInserted} new entries and ${result.linksInserted} new links ` +
    `(already-imported entries were left untouched).`
  );
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
