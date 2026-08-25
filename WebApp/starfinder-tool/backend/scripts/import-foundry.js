#!/usr/bin/env node
// Imports rules content from a local checkout of the community FoundryVTT
// Starfinder system into aon-cache/, in the same shape scrape-aon.js
// produces — so validate:aon / import:aon need no changes. See
// Docs/04-data-pipeline-aon.md → "Foundry import" and
// backend/src/foundry-import.js for why this is worth having alongside
// (or instead of) scraping aonsrd.com, and for the full field reference.
//
// Usage:
//   node scripts/import-foundry.js [folder...] [--src=path]
//   node scripts/import-foundry.js feats spells races classes
//   node scripts/import-foundry.js            # imports every folder below
//
// Defaults to reading from Docs/ReferenceFoundry/foundryvtt-starfinder-development/src/items
// relative to the repo root (a gitignored local checkout) — override with
// --src=/path/to/foundryvtt-starfinder/src/items if yours lives elsewhere.

import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mapFoundryItem, mapFoundryJournalPage, mapFoundryRollTable } from "../src/foundry-import.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SRC = path.resolve(
  __dirname,
  "../../../../Docs/ReferenceFoundry/foundryvtt-starfinder-development/src/items"
);

// Source folder → stored `category` override. Most folders don't need one
// (a folder of feats stores as category "feat"); these are the folders
// where Foundry's own `type` field is reused across concepts we want to
// keep distinct — see categoryFor() in foundry-import.js for why.
const FOLDER_CATEGORY_OVERRIDE = {
  "class-features": "class-feature",
  "racial-features": "racial-feature",
  "archetype-features": "archetype-feature",
  "theme-features": "theme-feature",
  "universal-creature-rules": "universal-creature-rule",
  conditions: "condition",
  effects: "effect",
};

// JournalEntry-shaped folders (core rulebook reference prose, not
// game-mechanical items) — one JournalEntry maps to *several* Compendium
// entries, one per page. See mapFoundryJournalPage() in foundry-import.js.
const JOURNAL_FOLDER_CATEGORY = { rules: "rule", setting: "setting" };

// RollTable-shaped folders (random/reference tables) — one file, one entry.
const TABLE_FOLDERS = new Set(["tables"]);

// Every folder this importer knows how to read. Folders not listed here
// (alien-archives, starships, vehicles, hazards, ...) use a different data
// shape entirely (full stat blocks / vehicle combat, not spells-and-gear
// mechanics or reference prose) and aren't wired up yet — see
// Docs/04-data-pipeline-aon.md.
const ALL_FOLDERS = [
  "feats", "spells", "races", "classes", "archetypes", "themes",
  "class-features", "racial-features", "archetype-features", "theme-features",
  "universal-creature-rules", "conditions", "effects", "equipment",
  ...Object.keys(JOURNAL_FOLDER_CATEGORY), ...TABLE_FOLDERS,
];

function uniqueSlugger() {
  const used = new Set();
  return (raw) => {
    let slug = raw.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
    if (used.has(slug)) {
      let n = 2;
      while (used.has(`${slug}-${n}`)) n++;
      slug = `${slug}-${n}`;
    }
    used.add(slug);
    return slug;
  };
}

function parseArgs(argv) {
  const folders = [];
  let src = DEFAULT_SRC;
  for (const arg of argv) {
    if (arg.startsWith("--src=")) src = path.resolve(arg.slice("--src=".length));
    else folders.push(arg);
  }
  return { folders: folders.length ? folders : ALL_FOLDERS, src };
}

async function main() {
  const { folders, src } = parseArgs(process.argv.slice(2));
  const outRoot = path.resolve(process.env.AON_CACHE_DIR || "aon-cache");
  let grandTotal = 0;

  for (const folder of folders) {
    const dir = path.join(src, folder);
    let files;
    try {
      files = (await readdir(dir)).filter((f) => f.endsWith(".json") && f !== "_folders.json");
    } catch (e) {
      console.warn(`skipping "${folder}": ${e.message}`);
      continue;
    }

    const outDir = path.join(outRoot, folder);
    await mkdir(outDir, { recursive: true });
    let count = 0;
    let skipped = 0;
    // Distinct source filenames (or, for journals, distinct page names
    // across different chapters) can collapse to the same slug — dedupe
    // rather than silently overwrite one entry with another on disk.
    const nextSlug = uniqueSlugger();

    if (JOURNAL_FOLDER_CATEGORY[folder]) {
      const category = JOURNAL_FOLDER_CATEGORY[folder];
      for (const file of files) {
        const raw = JSON.parse(await readFile(path.join(dir, file), "utf8"));
        const docSlug = path.basename(file, ".json").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
        for (const page of raw.pages || []) {
          const entry = mapFoundryJournalPage(page, raw.name, category);
          if (!entry) { skipped++; continue; }
          const slug = nextSlug(`${docSlug}--${page.name}`);
          await writeFile(path.join(outDir, `${slug}.json`), JSON.stringify(entry, null, 2));
          count++;
        }
      }
    } else if (TABLE_FOLDERS.has(folder)) {
      for (const file of files) {
        const raw = JSON.parse(await readFile(path.join(dir, file), "utf8"));
        const entry = mapFoundryRollTable(raw);
        if (!entry) { skipped++; continue; }
        const slug = nextSlug(path.basename(file, ".json"));
        await writeFile(path.join(outDir, `${slug}.json`), JSON.stringify(entry, null, 2));
        count++;
      }
    } else {
      const categoryOverride = FOLDER_CATEGORY_OVERRIDE[folder];
      for (const file of files) {
        const raw = JSON.parse(await readFile(path.join(dir, file), "utf8"));
        const entry = mapFoundryItem(raw, categoryOverride);
        if (!entry) { skipped++; continue; }
        const slug = nextSlug(path.basename(file, ".json"));
        await writeFile(path.join(outDir, `${slug}.json`), JSON.stringify(entry, null, 2));
        count++;
      }
    }

    grandTotal += count;
    console.log(`Imported ${count} from ${folder}${skipped ? ` (${skipped} skipped — unrecognized/empty)` : ""}`);
  }

  console.log(`Total: ${grandTotal} entries. Next: npm run validate:aon`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
