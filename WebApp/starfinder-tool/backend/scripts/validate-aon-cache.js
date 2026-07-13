#!/usr/bin/env node
// Validates every JSON file under aon-cache/ before it's synced to the Pi
// or imported into Postgres. Exits non-zero if any entry is invalid.
// Usage: node scripts/validate-aon-cache.js [path-to-aon-cache]

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const SLUG_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;

async function* walk(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) yield* walk(full);
    else if (e.name.endsWith(".json")) yield full;
  }
}

function checkEntry(entry, slug) {
  const errors = [];
  if (typeof entry.category !== "string" || !entry.category) errors.push('missing "category"');
  if (typeof entry.name !== "string" || !entry.name.trim()) errors.push('missing "name"');
  if (typeof entry.url !== "string") errors.push('"url" must be a string');
  if (typeof entry.data !== "object" || entry.data === null || Array.isArray(entry.data))
    errors.push('"data" must be an object');
  if (!SLUG_RE.test(slug)) errors.push(`filename is not a valid slug (${slug})`);
  return errors;
}

async function main() {
  const root = path.resolve(process.argv[2] || process.env.AON_CACHE_DIR || "aon-cache");
  let checked = 0;
  const problems = [];

  for await (const file of walk(root)) {
    checked++;
    const rel = path.relative(root, file);
    const slug = path.basename(file, ".json");

    let entry;
    try {
      entry = JSON.parse(await readFile(file, "utf8"));
    } catch (e) {
      problems.push(`${rel}: invalid JSON (${e.message})`);
      continue;
    }
    for (const err of checkEntry(entry, slug)) problems.push(`${rel}: ${err}`);
  }

  console.log(`Checked ${checked} entries under ${root}`);
  if (problems.length) {
    console.error(`\n${problems.length} problem(s) found:`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }
  console.log("All entries valid — safe to sync to the Pi / import.");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
