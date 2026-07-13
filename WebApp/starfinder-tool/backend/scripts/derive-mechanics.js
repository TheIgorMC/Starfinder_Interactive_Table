#!/usr/bin/env node
// Recomputes the structured `mechanics` field for every scraped-from-AoN
// entry under aon-cache/ from its raw `data` (see
// backend/src/mechanics-parser.js). Pure function of `data` — safe to
// re-run any time, e.g. after improving the parser, with no re-scrape
// needed. Run between scrape:aon and validate:aon.
//
// Skips entries with `mechanicsSource: "foundry"` (from
// import-foundry.js) — those already carry higher-fidelity mechanics read
// directly from Foundry's structured fields, and this regex-based parser
// would only downgrade them if run on their (differently-shaped) `data`.
//
// Usage: node scripts/derive-mechanics.js [path-to-aon-cache]

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { deriveMechanics } from "../src/mechanics-parser.js";

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.name.endsWith(".json")) yield full;
  }
}

async function main() {
  const root = path.resolve(process.argv[2] || process.env.AON_CACHE_DIR || "aon-cache");
  let count = 0;
  let skipped = 0;
  for await (const file of walk(root)) {
    const entry = JSON.parse(await readFile(file, "utf8"));
    if (entry.mechanicsSource === "foundry") { skipped++; continue; }
    entry.mechanics = deriveMechanics(entry.category, entry.data || {});
    entry.mechanicsSource = "derived";
    await writeFile(file, JSON.stringify(entry, null, 2));
    count++;
  }
  console.log(`Derived mechanics for ${count} entries under ${root} (${skipped} Foundry-sourced entries left untouched)`);
  console.log(`Next: npm run validate:aon`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
