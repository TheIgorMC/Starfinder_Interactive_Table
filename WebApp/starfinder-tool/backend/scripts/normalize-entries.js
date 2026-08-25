#!/usr/bin/env node
// Assembles DataEntry/schema/{race,class,archetype,theme}.schema.json
// documents out of the already-cached, already-Foundry-structured entries
// under aon-cache/ — see Docs/04-data-pipeline-aon.md's "Normalized
// authoring pipeline" section for the full rationale. Deterministic by
// default (join + regex); pass --llm to fill in the handful of genuinely
// prose-dependent gaps (races' alternate-trait `replaces` target when the
// regex can't resolve it) via a local Ollama server, same conventions as
// GalaxyGen (Docs/11-AI-integration.md).
//
// Usage:
//   node scripts/normalize-entries.js races [--limit=5] [--llm]
//   node scripts/normalize-entries.js classes|archetypes|themes|all
//   [--ollama-url=http://localhost:11434/v1] [--model=qwen3:8b]
//   [--out=../../../DataEntry/output] [--cache=aon-cache]
//
// Output is NOT the final authored file — it's a draft for human review:
// every entry carries `_source` (which aon-cache slugs it came from) and
// `_review` (anything the script — or the LLM step — couldn't confidently
// fill in). Nothing here writes back into aon-cache or the DB import path.

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { assembleRace, assembleClass, assembleArchetype, assembleTheme } from "./lib/assemblers.js";
import { askOllamaJson, pingOllama } from "./lib/ollama-client.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const CATEGORIES = {
  races: { baseDir: "races", featureDir: "racial-features", assemble: assembleRace, async: true },
  classes: { baseDir: "classes", featureDir: "class-features", assemble: assembleClass, async: false },
  archetypes: { baseDir: "archetypes", featureDir: "archetype-features", assemble: assembleArchetype, async: false },
  themes: { baseDir: "themes", featureDir: "theme-features", assemble: assembleTheme, async: false },
};

function parseArgs(argv) {
  const args = { category: null, limit: null, llm: false, ollamaUrl: "http://localhost:11434/v1", model: "qwen3:8b", out: "../../../../DataEntry/output", cache: "aon-cache" };
  for (const raw of argv) {
    if (!raw.startsWith("--")) { args.category = raw; continue; }
    const [key, value] = raw.slice(2).split(/=(.*)/s);
    if (key === "llm") args.llm = true;
    else if (key === "limit") args.limit = Number(value);
    else if (key === "ollama-url") args.ollamaUrl = value;
    else if (key === "model") args.model = value;
    else if (key === "out") args.out = value;
    else if (key === "cache") args.cache = value;
  }
  return args;
}

async function loadDir(dir) {
  let files;
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith(".json"));
  } catch {
    return [];
  }
  const out = [];
  for (const filename of files) {
    const entry = JSON.parse(await readFile(path.join(dir, filename), "utf8"));
    out.push({ filename, entry });
  }
  return out;
}

async function runCategory(name, args) {
  const config = CATEGORIES[name];
  if (!config) throw new Error(`Unknown category "${name}" — expected one of ${Object.keys(CATEGORIES).join(", ")}`);

  const cacheRoot = path.resolve(args.cache);
  const baseEntries = await loadDir(path.join(cacheRoot, config.baseDir));
  const featureEntries = await loadDir(path.join(cacheRoot, config.featureDir));
  const limited = args.limit ? baseEntries.slice(0, args.limit) : baseEntries;

  let askLLM = null;
  if (args.llm) {
    const ping = await pingOllama(args.ollamaUrl);
    if (!ping.ok) {
      console.warn(`--llm set but ${args.ollamaUrl} isn't reachable (${ping.reason}) — continuing deterministic-only (unresolved items land in _review).`);
      console.warn(`  Try: curl ${args.ollamaUrl.replace(/\/v1\/?$/, "")}/api/tags   (should list installed models if the server's actually up)`);
    } else {
      // The health check may have found it via a different host (e.g.
      // 127.0.0.1 works when "localhost" doesn't resolve/connect the same
      // way from Node) — use whichever origin actually answered.
      const workingOrigin = new URL(ping.url).origin;
      const chatBaseUrl = args.ollamaUrl.replace(/^https?:\/\/[^/]+/, workingOrigin);
      if (chatBaseUrl !== args.ollamaUrl) console.log(`Note: ${args.ollamaUrl} didn't answer directly, but ${workingOrigin} did — using that for the actual model calls.`);
      let callCount = 0;
      askLLM = (call) => {
        callCount++;
        const started = Date.now();
        process.stdout.write(`\n  -> asking ${args.model} (call #${callCount} for this entry)... `);
        return askOllamaJson({ baseUrl: chatBaseUrl, model: args.model, ...call }).then(
          (result) => {
            process.stdout.write(`done in ${((Date.now() - started) / 1000).toFixed(1)}s\n`);
            return result;
          },
          (err) => {
            process.stdout.write(`failed after ${((Date.now() - started) / 1000).toFixed(1)}s: ${err.message}\n`);
            throw err;
          },
        );
      };
    }
  }

  const outDir = path.resolve(__dirname, args.out, name);
  await mkdir(outDir, { recursive: true });

  const allRaceNames = name === "races" ? baseEntries.map(({ entry }) => entry.name) : undefined;

  let written = 0;
  let withReview = 0;
  let reviewItems = 0;
  const total = limited.length;
  for (const { filename, entry } of limited) {
    const slug = filename.replace(/\.json$/, "");
    process.stdout.write(`\r[${name} ${written + 1}/${total}] ${slug.padEnd(40)}`);
    const doc = config.async ? await config.assemble(slug, entry, featureEntries, { askLLM, allRaceNames }) : config.assemble(slug, entry, featureEntries);
    await writeFile(path.join(outDir, `${slug}.json`), JSON.stringify(doc, null, 2));
    written++;
    if (doc._review?.length) {
      withReview++;
      reviewItems += doc._review.length;
    }
  }
  process.stdout.write("\r" + " ".repeat(60) + "\r");

  console.log(`${name}: wrote ${written} entries to ${path.relative(process.cwd(), outDir)} (${withReview} with ${reviewItems} _review item(s) total, linked against ${featureEntries.length} ${config.featureDir} entries)`);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.category) {
    console.error("Usage: node scripts/normalize-entries.js <races|classes|archetypes|themes|all> [--limit=N] [--llm] [--ollama-url=...] [--model=...]");
    process.exit(1);
  }
  const names = args.category === "all" ? Object.keys(CATEGORIES) : [args.category];
  for (const name of names) await runCategory(name, args);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
