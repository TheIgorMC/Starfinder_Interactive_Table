#!/usr/bin/env node
// Grounded consistency check over DataEntry/output/<category>/*.json —
// re-verifies every field normalize-entries.js derived against the same
// source text it was derived from, via a local Ollama model. See
// scripts/lib/audit-race.js's header for why this is scoped to "does the
// derived value match its own source excerpt" rather than "is this
// correct per Starfinder rules" (the latter needs a grounded rules
// reference an 8B local model doesn't have, and would fabricate instead).
//
// Usage:
//   node scripts/audit-normalized.js races [--limit=5]
//   [--ollama-url=http://localhost:11434/v1] [--model=qwen3:8b]
//   [--dir=../../../../DataEntry/output]
//
// Writes findings back into each file's `_audit` array in place — separate
// from `_review` (which flags what the assembler *couldn't* determine);
// `_audit` flags fields the assembler *did* confidently fill in that this
// independent grounded check now disputes. Mismatches are summarized to
// the console so you don't have to grep every file to find them.

import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildRaceAuditPrompt, applyAuditResults } from "./lib/audit-race.js";
import { askOllamaJson, pingOllama } from "./lib/ollama-client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const BUILDERS = { races: buildRaceAuditPrompt };

function parseArgs(argv) {
  const args = { category: null, limit: null, ollamaUrl: "http://localhost:11434/v1", model: "qwen3:8b", dir: "../../../../DataEntry/output" };
  for (const raw of argv) {
    if (!raw.startsWith("--")) { args.category = raw; continue; }
    const [key, value] = raw.slice(2).split(/=(.*)/s);
    if (key === "limit") args.limit = Number(value);
    else if (key === "ollama-url") args.ollamaUrl = value;
    else if (key === "model") args.model = value;
    else if (key === "dir") args.dir = value;
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const buildPrompt = BUILDERS[args.category];
  if (!buildPrompt) {
    console.error(`Usage: node scripts/audit-normalized.js <${Object.keys(BUILDERS).join("|")}> [--limit=N] [--ollama-url=...] [--model=...]`);
    process.exit(1);
  }

  const ping = await pingOllama(args.ollamaUrl);
  if (!ping.ok) {
    console.error(`${args.ollamaUrl} isn't reachable (${ping.reason}) — nothing to audit against. Start Ollama first.`);
    process.exit(1);
  }
  const chatBaseUrl = args.ollamaUrl.replace(/^https?:\/\/[^/]+/, new URL(ping.url).origin);

  const dir = path.resolve(__dirname, args.dir, args.category);
  const files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  const limited = args.limit ? files.slice(0, args.limit) : files;

  let checked = 0;
  let mismatches = 0;
  let uncertain = 0;
  let callFailures = 0;
  const findings = [];

  for (const file of limited) {
    const slug = file.replace(/\.json$/, "");
    process.stdout.write(`\r[audit ${args.category} ${checked + 1}/${limited.length}] ${slug.padEnd(30)}`);
    const full = path.join(dir, file);
    const doc = JSON.parse(await readFile(full, "utf8"));
    const { system, user, claimMeta } = buildPrompt(doc);
    if (claimMeta.length === 0) { checked++; continue; }

    try {
      const started = Date.now();
      // 2000, not the client's 800 default: a race with several alternate
      // traits can carry up to ~9 claims in one prompt (see
      // MAX_ALT_TRAIT_CLAIMS in audit-race.js), each with its own verdict
      // + note — confirmed live, aasimar (6 alt traits) got cut off
      // mid-JSON at 800 tokens.
      const result = await askOllamaJson({ baseUrl: chatBaseUrl, model: args.model, system, user, maxTokens: 2000 });
      const entries = applyAuditResults(doc, result.checks, claimMeta);
      await writeFile(full, JSON.stringify(doc, null, 2));
      for (const e of entries) {
        if (e.verdict === "mismatch") { mismatches++; findings.push({ slug, ...e }); }
        else if (e.verdict === "uncertain") uncertain++;
      }
      process.stdout.write(` (${((Date.now() - started) / 1000).toFixed(1)}s, ${entries.filter((e) => e.verdict === "mismatch").length} mismatch)\n`);
    } catch (err) {
      callFailures++;
      process.stdout.write(` FAILED: ${err.message}\n`);
    }
    checked++;
  }

  console.log(`\nChecked ${checked} ${args.category}: ${mismatches} mismatch(es), ${uncertain} uncertain, ${callFailures} call failure(s).`);
  if (findings.length) {
    console.log("\nMismatches found:");
    for (const f of findings) console.log(`  - ${f.slug} :: ${f.field}\n      claim: ${f.claim}\n      note:  ${f.note}`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
