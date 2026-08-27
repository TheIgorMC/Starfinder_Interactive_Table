#!/usr/bin/env node
// Grounded consistency check, via a local Ollama model — re-verifies
// derived/structured fields against the same source text they came from.
// See scripts/lib/audit-race.js's header for why this is scoped to "does
// the value match its own source excerpt" rather than "is this correct
// per Starfinder rules" (the latter needs a grounded rules reference an
// 8B local model doesn't have, and would fabricate instead).
//
// Two source kinds:
//   - "races" (and, if extended later, classes/archetypes/themes) reads
//     DataEntry/output/<category>/*.json — normalize-entries.js's drafts
//     — and writes findings back into each file's `_audit` array in
//     place, since that whole tree is already a review draft.
//   - Any aon-cache/ folder name (feats, spells, equipment, conditions,
//     effects, races, ...) audits those entries directly — there's no
//     decomposition/linking problem for a single-concept item the way
//     there is for a race's bundled traits, so there's no normalize step
//     to run first, just the same grounded check applied straight to the
//     cache entry. Findings write to a *separate* sidecar file
//     (DataEntry/output/_audits/<folder>/<slug>.json), not back into
//     aon-cache/ itself — that tree is meant to stay a clean,
//     regeneratable output of import-foundry.js/scrape-aon.js, not
//     something this script mutates in place.
//
// Usage:
//   node scripts/audit-normalized.js races [--limit=5]
//   node scripts/audit-normalized.js conditions --limit=2
//   node scripts/audit-normalized.js effects --limit=2
//   node scripts/audit-normalized.js equipment --limit=2
//   [--ollama-url=http://localhost:11434/v1] [--model=qwen3:8b]

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRaceAuditPrompt, applyAuditResults } from "./lib/audit-race.js";
import { buildItemAuditPrompt, applyItemAuditResults } from "./lib/audit-item.js";
import { askOllamaJson, pingOllama } from "./lib/ollama-client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Categories with a real normalize-entries.js draft to audit in place.
const NORMALIZED_BUILDERS = { races: buildRaceAuditPrompt };

function parseArgs(argv) {
  const args = { category: null, limit: null, ollamaUrl: "http://localhost:11434/v1", model: "qwen3:8b", dir: "../../../../DataEntry/output", cache: "aon-cache" };
  for (const raw of argv) {
    if (!raw.startsWith("--")) { args.category = raw; continue; }
    const [key, value] = raw.slice(2).split(/=(.*)/s);
    if (key === "limit") args.limit = Number(value);
    else if (key === "ollama-url") args.ollamaUrl = value;
    else if (key === "model") args.model = value;
    else if (key === "dir") args.dir = value;
    else if (key === "cache") args.cache = value;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.category) {
    console.error(`Usage: node scripts/audit-normalized.js <${Object.keys(NORMALIZED_BUILDERS).join("|")}|<any aon-cache folder name>> [--limit=N] [--ollama-url=...] [--model=...]`);
    process.exit(1);
  }

  const isNormalized = !!NORMALIZED_BUILDERS[args.category];
  // --dir (DataEntry/output) is __dirname-relative like normalize-entries.js
  // — it has to escape up to the repo root regardless of CWD. --cache
  // (aon-cache) is CWD-relative instead, matching every other script here
  // (validate-aon-cache.js, derive-mechanics.js, import-foundry.js) which
  // all assume you're running from backend/ where aon-cache/ actually
  // lives — confirmed live, using __dirname for it looked for aon-cache/
  // inside scripts/ and failed.
  const readDir = isNormalized
    ? path.resolve(__dirname, args.dir, args.category)
    : path.resolve(args.cache, args.category);
  const sidecarDir = isNormalized ? null : path.resolve(__dirname, args.dir, "_audits", args.category);

  let files;
  try {
    files = (await readdir(readDir)).filter((f) => f.endsWith(".json") && f !== "_folders.json");
  } catch (e) {
    console.error(`Couldn't read ${readDir}: ${e.message}`);
    process.exit(1);
  }
  if (sidecarDir) await mkdir(sidecarDir, { recursive: true });

  const ping = await pingOllama(args.ollamaUrl);
  if (!ping.ok) {
    console.error(`${args.ollamaUrl} isn't reachable (${ping.reason}) — nothing to audit against. Start Ollama first.`);
    process.exit(1);
  }
  const chatBaseUrl = args.ollamaUrl.replace(/^https?:\/\/[^/]+/, new URL(ping.url).origin);

  const limited = args.limit ? files.slice(0, args.limit) : files;

  let checked = 0;
  let noClaims = 0;
  let mismatches = 0;
  let uncertain = 0;
  let callFailures = 0;
  const findings = [];

  for (const file of limited) {
    const slug = file.replace(/\.json$/, "");
    process.stdout.write(`\r[audit ${args.category} ${checked + 1}/${limited.length}] ${slug.padEnd(30)}`);
    const doc = JSON.parse(await readFile(path.join(readDir, file), "utf8"));
    const { system, user, claimMeta } = isNormalized ? NORMALIZED_BUILDERS[args.category](doc) : buildItemAuditPrompt(doc);
    if (claimMeta.length === 0) { noClaims++; checked++; process.stdout.write(" (no checkable claims)\n"); continue; }

    try {
      const started = Date.now();
      // 2000, not the client's 800 default: an entry with several
      // modifiers/actions can carry many claims in one prompt, each with
      // its own verdict + note — confirmed live, a race with 6 alternate
      // traits got cut off mid-JSON at 800 tokens.
      const result = await askOllamaJson({ baseUrl: chatBaseUrl, model: args.model, system, user, maxTokens: 2000 });
      const entries = isNormalized ? applyAuditResults(doc, result.checks, claimMeta) : applyItemAuditResults(doc, result.checks, claimMeta);
      if (isNormalized) {
        await writeFile(path.join(readDir, file), JSON.stringify(doc, null, 2));
      } else {
        await writeFile(path.join(sidecarDir, file), JSON.stringify({ name: doc.name, category: doc.category, _audit: entries }, null, 2));
      }
      for (const e of entries) {
        if (e.verdict === "mismatch") { mismatches++; findings.push({ slug, ...e }); }
        else if (e.verdict === "uncertain") uncertain++;
      }
      process.stdout.write(` (${((Date.now() - started) / 1000).toFixed(1)}s, ${entries.length} claim(s), ${entries.filter((e) => e.verdict === "mismatch").length} mismatch)\n`);
    } catch (err) {
      callFailures++;
      process.stdout.write(` FAILED: ${err.message}\n`);
    }
    checked++;
  }

  console.log(`\nChecked ${checked} ${args.category} (${noClaims} had no checkable claims): ${mismatches} mismatch(es), ${uncertain} uncertain, ${callFailures} call failure(s).`);
  if (!isNormalized) console.log(`Findings written to ${path.relative(process.cwd(), sidecarDir)}/ (aon-cache/ itself is untouched).`);
  if (findings.length) {
    console.log("\nMismatches found:");
    for (const f of findings) console.log(`  - ${f.slug} :: ${f.field}\n      claim: ${f.claim}\n      note:  ${f.note}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
