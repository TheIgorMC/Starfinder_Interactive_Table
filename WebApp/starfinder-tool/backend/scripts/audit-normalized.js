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
import { buildRaceRawAuditPrompt } from "./lib/audit-race-raw.js";
import { askOllamaJson, pingOllama } from "./lib/ollama-client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Categories with a real normalize-entries.js draft to audit in place.
const NORMALIZED_BUILDERS = { races: buildRaceAuditPrompt };

// Categories that read aon-cache/ directly (like any plain folder name)
// but need a custom claim builder instead of the generic buildItemAuditPrompt
// — because the raw entry shape doesn't fit the modifiers/actions mold
// audit-item.js expects. Key is the CLI category name; value is
// { cacheDir: <actual aon-cache/ folder to read>, builder }. "races-raw"
// exists because "races" is already claimed by NORMALIZED_BUILDERS above
// for the separate normalized-draft pipeline — see audit-race-raw.js's own
// header for why the two need genuinely different checks, not just a
// different data source for the same one.
const RAW_BUILDERS = { "races-raw": { cacheDir: "races", builder: buildRaceRawAuditPrompt } };

// Deterministic shuffle (mulberry32 PRNG) rather than Math.random() — a
// --seed re-run reproduces the exact same sample, useful for comparing
// two code versions against literally the same entries.
function seededShuffle(arr, seed) {
  let s = seed >>> 0;
  const rand = () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const out = [...arr];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function parseArgs(argv) {
  const args = { category: null, limit: null, ollamaUrl: "http://localhost:11434/v1", model: "qwen3:8b", dir: "../../../../DataEntry/output", cache: "aon-cache", random: false, seed: Date.now() % 100000 };
  for (const raw of argv) {
    if (!raw.startsWith("--")) { args.category = raw; continue; }
    const [key, value] = raw.slice(2).split(/=(.*)/s);
    if (key === "limit") args.limit = Number(value);
    else if (key === "ollama-url") args.ollamaUrl = value;
    else if (key === "model") args.model = value;
    else if (key === "dir") args.dir = value;
    else if (key === "cache") args.cache = value;
    else if (key === "random") args.random = true;
    else if (key === "seed") { args.random = true; args.seed = Number(value); }
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.category) {
    console.error(`Usage: node scripts/audit-normalized.js <${Object.keys(NORMALIZED_BUILDERS).join("|")}|<any aon-cache folder name>> [--limit=N] [--random] [--seed=N] [--ollama-url=...] [--model=...]`);
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
  const rawBuilder = RAW_BUILDERS[args.category];
  const readDir = isNormalized
    ? path.resolve(__dirname, args.dir, args.category)
    : path.resolve(args.cache, rawBuilder ? rawBuilder.cacheDir : args.category);
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

  // Alphabetically-first entries are a biased sample — confirmed live,
  // running --limit=2 without shuffling against feats/spells/classes/etc.
  // kept landing on entries with zero modifiers/actions purely because of
  // where they fall in the alphabet, undercounting how often the checker
  // actually has something to verify. --random (or --seed=N, which
  // implies it) shuffles before slicing so a small sample is representative.
  const pool = args.random ? seededShuffle(files, args.seed) : files;
  const limited = args.limit ? pool.slice(0, args.limit) : pool;
  if (args.random) console.log(`Random sample (seed ${args.seed}) of ${limited.length}/${files.length} ${args.category}.`);

  let checked = 0;
  let noClaims = 0;
  let mismatches = 0;
  let uncertain = 0;
  let anomalyCount = 0;
  let callFailures = 0;
  const findings = [];
  const anomalyFindings = [];

  for (const file of limited) {
    const slug = file.replace(/\.json$/, "");
    process.stdout.write(`\r[audit ${args.category} ${checked + 1}/${limited.length}] ${slug.padEnd(30)}`);
    const doc = JSON.parse(await readFile(path.join(readDir, file), "utf8"));
    const built = isNormalized
      ? NORMALIZED_BUILDERS[args.category](doc)
      : rawBuilder
        ? rawBuilder.builder(doc)
        : buildItemAuditPrompt(doc);
    const { system, user, claimMeta } = built;
    const anomalies = built.anomalies || [];

    // Anomalies are deterministic (no LLM involved) — record them even
    // when there's nothing left to actually send to the model.
    if (claimMeta.length === 0) {
      noClaims++;
      checked++;
      if (anomalies.length && !isNormalized) {
        anomalyCount += anomalies.length;
        const entries = applyItemAuditResults(doc, [], [], anomalies);
        await writeFile(path.join(sidecarDir, file), JSON.stringify({ name: doc.name, category: doc.category, _audit: entries }, null, 2));
        for (const a of anomalies) anomalyFindings.push({ slug, claim: a });
        process.stdout.write(` (no checkable claims, ${anomalies.length} anomaly(ies))\n`);
      } else {
        process.stdout.write(" (no checkable claims)\n");
      }
      continue;
    }

    try {
      const started = Date.now();
      // 2000, not the client's 800 default: an entry with several
      // modifiers/actions can carry many claims in one prompt, each with
      // its own verdict + note — confirmed live, a race with 6 alternate
      // traits got cut off mid-JSON at 800 tokens.
      const result = await askOllamaJson({ baseUrl: chatBaseUrl, model: args.model, system, user, maxTokens: 2000 });
      const entries = isNormalized
        ? applyAuditResults(doc, result.checks, claimMeta)
        : applyItemAuditResults(doc, result.checks, claimMeta, anomalies);
      if (isNormalized) {
        await writeFile(path.join(readDir, file), JSON.stringify(doc, null, 2));
      } else {
        await writeFile(path.join(sidecarDir, file), JSON.stringify({ name: doc.name, category: doc.category, _audit: entries }, null, 2));
      }
      for (const e of entries) {
        if (e.verdict === "mismatch") { mismatches++; findings.push({ slug, ...e }); }
        else if (e.verdict === "uncertain") uncertain++;
        else if (e.verdict === "anomaly") { anomalyCount++; anomalyFindings.push({ slug, claim: e.claim }); }
      }
      process.stdout.write(` (${((Date.now() - started) / 1000).toFixed(1)}s, ${entries.length} claim(s), ${entries.filter((e) => e.verdict === "mismatch").length} mismatch)\n`);
    } catch (err) {
      callFailures++;
      process.stdout.write(` FAILED: ${err.message}\n`);
    }
    checked++;
  }

  console.log(`\nChecked ${checked} ${args.category} (${noClaims} had no checkable claims): ${mismatches} mismatch(es), ${uncertain} uncertain, ${anomalyCount} anomal(ies), ${callFailures} call failure(s).`);
  if (!isNormalized) console.log(`Findings written to ${path.relative(process.cwd(), sidecarDir)}/ (aon-cache/ itself is untouched).`);
  if (findings.length) {
    console.log("\nMismatches found (LLM-verified against source text):");
    for (const f of findings) console.log(`  - ${f.slug} :: ${f.field}\n      claim: ${f.claim}\n      note:  ${f.note}`);
  }
  if (anomalyFindings.length) {
    console.log("\nAnomalies found (deterministic — internally contradictory data, not LLM-checked):");
    for (const f of anomalyFindings) console.log(`  - ${f.slug}\n      ${f.claim}`);
  }

  // One consolidated, well-known file per category — so "come back and
  // work through what needs a human" later (by you or a future Claude
  // session) means opening one file, not grepping hundreds of per-entry
  // sidecars or scrolling back through console output that's already
  // gone. Always the same path regardless of source kind (races or any
  // aon-cache/ folder), and each entry keeps everything needed to act on
  // it without re-deriving anything: which file it came from, the exact
  // claim, the model's note, and a `status` field a human (or a later
  // pass) can flip from "open" once it's been looked at — the file is
  // just JSON, editing that field by hand is enough to track review
  // progress across sessions.
  const summaryDir = path.resolve(__dirname, args.dir, "_audits", args.category);
  await mkdir(summaryDir, { recursive: true });
  const summaryPath = path.join(summaryDir, "_findings.json");
  const summary = {
    category: args.category,
    generatedAt: new Date().toISOString(),
    sourceKind: isNormalized ? "normalize-entries draft" : "aon-cache (direct)",
    checked,
    noClaims,
    callFailures,
    findings: [
      ...findings.map((f) => ({ status: "open", kind: "mismatch", slug: f.slug, field: f.field, claim: f.claim, note: f.note })),
      ...anomalyFindings.map((f) => ({ status: "open", kind: "anomaly", slug: f.slug, claim: f.claim })),
    ],
  };
  await writeFile(summaryPath, JSON.stringify(summary, null, 2));
  console.log(`\nConsolidated findings: ${path.relative(process.cwd(), summaryPath)} (${summary.findings.length} item(s), each "status": "open" until reviewed).`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
