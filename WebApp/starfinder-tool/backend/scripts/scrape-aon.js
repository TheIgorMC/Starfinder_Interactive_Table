#!/usr/bin/env node
// Scrapes a category from aonsrd.com into local aon-cache/<category>/*.json,
// including the source book (and page) for each entry so it can be filtered
// on later. Run locally (not on the Pi) — see docs/04-data-pipeline-aon.md.
//
// Usage:
//   node scripts/scrape-aon.js <category> [--limit=N] [--delay=MS] [--skip-source]
//
// Each category's index page has a different layout on this (very old)
// ASP.NET site, so each one needs its own `listEntries($, pageUrl)` parser —
// see CATEGORIES below. `--skip-source` does the fast list-only pass without
// visiting every detail page (useful while adding/debugging a new category).

import { load } from "cheerio";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const UA = "Mozilla/5.0 (SIT-scraper; personal, non-commercial use)";

const CATEGORIES = {
  // Simple GridView table: Name | Prerequisite | Description
  feats: {
    url: "https://aonsrd.com/Feats.aspx",
    singular: "feat",
    listEntries($, pageUrl) {
      const out = [];
      $("#ctl00_MainContent_GridView6 tr")
        .slice(1) // skip header row
        .each((_, row) => {
          const cells = $(row).find("td");
          if (cells.length < 3) return;
          const link = $(cells[0]).find("a").first();
          let name = link.text().trim().replace(/\s+/g, " ");
          const combat = name.endsWith("*");
          if (combat) name = name.slice(0, -1).trim();
          if (!name) return;

          let prerequisite = $(cells[1]).text().trim();
          if (prerequisite === "—" || prerequisite === "-") prerequisite = "";

          out.push({
            name,
            url: resolveUrl(link.attr("href"), pageUrl),
            data: { prerequisite, description: $(cells[2]).text().trim(), combat },
          });
        });
      return out;
    },
  },

  // DataList of <span id="..._LabelName"><b><a>Name</a></b>: description</span>
  spells: {
    url: "https://aonsrd.com/Spells.aspx?Class=All",
    singular: "spell",
    listEntries($, pageUrl) {
      const out = [];
      $("[id$='_LabelName']").each((_, el) => {
        const $el = $(el);
        const link = $el.find("a").first();
        if (!link.length) return;
        const name = link.text().trim().replace(/\s+/g, " ");
        if (!name) return;

        const full = $el.text().trim();
        const description = full.startsWith(name)
          ? full.slice(name.length).replace(/^:\s*/, "").trim()
          : full;

        out.push({
          name,
          url: resolveUrl(link.attr("href"), pageUrl),
          data: { description },
        });
      });
      return out;
    },
  },

  // Three GridView tables (Core / Core [Legacy] / Other species), each row:
  // Name | Default Ability Scores | Hit Points | Size and Type | Source.
  // Source is already inline here (unlike feats/spells), so no per-entry
  // detail-page fetch is needed — much faster.
  races: {
    url: "https://aonsrd.com/Races.aspx?ItemName=All",
    singular: "race",
    listEntries($, pageUrl) {
      const out = [];
      $("table[id^='ctl00_MainContent_GridViewRaces'] tr").each((_, row) => {
        const cells = $(row).find("td");
        if (cells.length < 5) return; // header row has <th>, not <td>
        const link = $(cells[0]).find("a").first();
        let name = link.text().trim().replace(/\s+/g, " ");
        if (name.endsWith("*")) name = name.slice(0, -1).trim();
        if (!name) return;

        const sourceLink = $(cells[4]).find("a").first();
        const hp = parseInt($(cells[2]).text().trim(), 10);

        out.push({
          name,
          url: resolveUrl(link.attr("href"), pageUrl),
          source: sourceLink.text().trim(),
          data: {
            abilityScores: $(cells[1]).text().trim(),
            hitPoints: Number.isNaN(hp) ? null : hp,
            sizeAndType: $(cells[3]).text().trim(),
            sourceUrl: resolveUrl(sourceLink.attr("href"), pageUrl),
          },
        });
      });
      return out;
    },
  },

  // Just a flat link list on the index page — name + source come from each
  // class's own detail page (reuses the generic fetchSource() enrichment).
  classes: {
    url: "https://aonsrd.com/Classes.aspx",
    singular: "class",
    listEntries($, pageUrl) {
      const out = [];
      $("#ctl00_MainContent_FullClassList a").each((_, el) => {
        const link = $(el);
        const name = link.text().trim().replace(/\s+/g, " ");
        if (!name) return;
        out.push({ name, url: resolveUrl(link.attr("href"), pageUrl), data: {} });
      });
      return out;
    },
  },
};

function resolveUrl(href, pageUrl) {
  return href ? new URL(href, pageUrl).toString() : "";
}

function slugify(name) {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function parseArgs(argv) {
  const args = { category: argv[0], limit: Infinity, delay: 200, skipSource: false };
  for (const arg of argv.slice(1)) {
    if (arg === "--skip-source") args.skipSource = true;
    else if (arg.startsWith("--limit=")) args.limit = Number(arg.split("=")[1]);
    else if (arg.startsWith("--delay=")) args.delay = Number(arg.split("=")[1]);
  }
  return args;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Every AoN detail page has a `<b>Source</b> <a><i>Book pg. N</i></a>` line.
// Returns the book title (for filtering), page number, and the paizo.com
// store link, or nulls if the page doesn't have one.
async function fetchSource(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const $ = load(await res.text());

  const label = $("b")
    .filter((_, el) => $(el).text().trim() === "Source")
    .first();
  if (!label.length) return { book: "", page: null, sourceUrl: "" };

  const link = label.next("a");
  const raw = (link.length ? link.text() : "").trim();
  const match = raw.match(/^(.*?)(?:\s+pg\.\s*(\d+))?$/i);

  return {
    book: (match ? match[1] : raw).trim(),
    page: match && match[2] ? Number(match[2]) : null,
    sourceUrl: link.attr("href") || "",
  };
}

async function main() {
  const { category, limit, delay, skipSource } = parseArgs(process.argv.slice(2));
  const config = CATEGORIES[category];
  if (!config) {
    console.error(`Usage: node scrape-aon.js <category> [--limit=N] [--delay=MS] [--skip-source]`);
    console.error(`Known categories: ${Object.keys(CATEGORIES).join(", ")}`);
    process.exit(1);
  }

  console.log(`Fetching ${config.url} ...`);
  const res = await fetch(config.url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${config.url}`);
  const $ = load(await res.text());

  let entries = config.listEntries($, config.url);
  if (limit < entries.length) entries = entries.slice(0, limit);
  console.log(`Found ${entries.length} ${category} entries.`);

  if (!skipSource) {
    const pending = entries.filter((e) => e.url && !e.source);
    console.log(`Fetching source info from ${pending.length} detail pages (${delay}ms apart)...`);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.url && !entry.source) {
        try {
          const src = await fetchSource(entry.url);
          entry.source = src.book;
          entry.data.sourcePage = src.page;
          entry.data.sourceUrl = src.sourceUrl;
        } catch (e) {
          console.warn(`  warn: failed to fetch source for "${entry.name}": ${e.message}`);
        }
        await sleep(delay);
      }
      if ((i + 1) % 50 === 0) console.log(`  ...${i + 1}/${entries.length}`);
    }
  }

  const outDir = path.resolve(process.env.AON_CACHE_DIR || "aon-cache", category);
  await mkdir(outDir, { recursive: true });
  for (const entry of entries) {
    const out = {
      category: config.singular,
      name: entry.name,
      source: entry.source || "",
      url: entry.url,
      data: entry.data,
    };
    await writeFile(path.join(outDir, `${slugify(entry.name)}.json`), JSON.stringify(out, null, 2));
  }

  console.log(`Wrote ${entries.length} entries to ${outDir}`);
  console.log(`Next: npm run validate:aon`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
