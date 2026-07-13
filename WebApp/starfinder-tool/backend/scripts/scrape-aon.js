#!/usr/bin/env node
// Scrapes a category from aonsrd.com into local aon-cache/<category>/*.json,
// including the source book/page AND the full rules text (not just the
// short list-page blurb) for each entry. Run locally (not on the Pi) —
// see docs/04-data-pipeline-aon.md.
//
// Usage:
//   node scripts/scrape-aon.js <category> [--limit=N] [--delay=MS] [--skip-source]
//
// Each category's index page has a different layout on this (very old)
// ASP.NET site, so each one needs its own `listEntries($, pageUrl)` parser —
// see CATEGORIES below. Every entry's own detail page is then fetched to
// pull the full labeled rules text (Benefit, Description, etc. — whatever
// that category's page actually has) via `applyDetail(entry, sections)`.
// `--skip-source` does the fast list-only pass without visiting any detail
// page (useful while adding/debugging a new category's listEntries).

import { load } from "cheerio";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

const UA = "Mozilla/5.0 (SIT-scraper; personal, non-commercial use)";

const clean = (s) => (s || "").replace(/^:\s*/, "").trim();
const toCamel = (label) =>
  label
    .trim()
    .replace(/[^a-zA-Z0-9 ]/g, "")
    .split(/\s+/)
    .map((w, i) => (i === 0 ? w.toLowerCase() : w[0].toUpperCase() + w.slice(1).toLowerCase()))
    .join("");

const CATEGORIES = {
  // Simple GridView table: Name | Prerequisite | Description
  feats: {
    url: "https://aonsrd.com/Feats.aspx",
    singular: "feat",
    // sections come from the labeled blocks on the feat's own detail page
    applyDetail(entry, sections) {
      entry.data.prerequisites = clean(sections.Prerequisites) || entry.data.prerequisite || "";
      entry.data.effect = clean(sections.Benefit);
      if (sections["Teamwork Benefit"]) entry.data.teamworkBenefit = clean(sections["Teamwork Benefit"]);
      if (sections.Normal) entry.data.normal = clean(sections.Normal);
      if (sections.Special) entry.data.special = clean(sections.Special);
    },
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
    applyDetail(entry, sections) {
      entry.data.effect = clean(sections.Description) || entry.data.description || "";
      for (const label of ["School", "Casting Time", "Range", "Area", "Targets", "Duration", "Saving Throw", "Spell Resistance", "Classes", "Effect"]) {
        if (sections[label]) entry.data[toCamel(label)] = clean(sections[label]);
      }
    },
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
    // list page already has ability scores/HP/size/source; the detail page
    // (same URL pattern, reused for both list rows and single-item view)
    // adds the racial traits text, which isn't in the list table at all.
    applyDetail(entry, sections) {
      entry.data.effect = mergeSections(sections, entry.name);
    },
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
    // no per-class level-progression table (that lives in an inner <table>,
    // deliberately skipped by the section parser) — just the descriptive
    // sections: flavor text, key ability score, class skills, and so on.
    applyDetail(entry, sections) {
      entry.data.effect = mergeSections(sections, entry.name);
    },
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

// Merges leftover labeled sections (racial traits, class flavor, etc.) that
// don't map to a specific known field into one readable text blob, for
// categories without a fixed set of expected labels.
function mergeSections(sections, entryName) {
  return Object.entries(sections)
    .filter(([k, v]) => k !== "Source" && k !== entryName && v.trim())
    .map(([k, v]) => `${k}: ${clean(v)}`)
    .join("\n\n");
}

// Every AoN detail page is one big <span id="..._LabelName"> containing the
// item's title, then a run of `<b>Label</b> value` pairs and `<hN>Heading</hN>`
// sections (Source, Prerequisites, Benefit, Description, ...) mixed with
// plain text and the occasional inner <table> (e.g. class level progression,
// deliberately skipped — it isn't prose). This walks that container once and
// returns both the parsed Source line and every other labeled section, so
// each category's `applyDetail` can pull out whatever fields it has.
async function fetchDetail(url) {
  const res = await fetch(url, { headers: { "User-Agent": UA } });
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  const $ = load(await res.text());

  const container = $("[id$='_LabelName']").first();
  const sections = {};
  let current = null;
  container.contents().each((_, node) => {
    if (node.type === "tag" && node.name === "b") {
      current = $(node).text().replace(/:$/, "").trim() || null;
      if (current) sections[current] = sections[current] || "";
    } else if (node.type === "tag" && ["h1", "h2", "h3"].includes(node.name)) {
      current = $(node).text().trim() || null;
      if (current) sections[current] = sections[current] || "";
    } else if (node.type === "tag" && node.name === "table") {
      current = null; // skip tabular data (not prose)
    } else if (node.type === "tag" && node.name === "a" && current) {
      sections[current] += $(node).text();
    } else if (node.type === "tag" && node.name === "br") {
      if (current) sections[current] += "\n";
    } else if (node.type === "text" && current) {
      sections[current] += node.data;
    }
  });
  for (const k in sections) sections[k] = sections[k].replace(/\n{2,}/g, "\n").trim();

  const sourceRaw = (sections.Source || "").split("\n")[0].trim();
  const match = sourceRaw.match(/^(.*?)(?:\s+pg\.\s*(\d+))?$/i);
  const sourceLink = $(container).find("b")
    .filter((_, el) => $(el).text().trim() === "Source")
    .first()
    .next("a");

  return {
    book: (match ? match[1] : sourceRaw).trim(),
    page: match && match[2] ? Number(match[2]) : null,
    sourceUrl: sourceLink.attr("href") || "",
    sections,
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
    const pending = entries.filter((e) => e.url);
    console.log(`Fetching ${pending.length} detail pages (source + full rules text, ${delay}ms apart)...`);
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (entry.url) {
        try {
          const detail = await fetchDetail(entry.url);
          if (!entry.source) {
            entry.source = detail.book;
            entry.data.sourcePage = detail.page;
            entry.data.sourceUrl = detail.sourceUrl;
          }
          config.applyDetail?.(entry, detail.sections);
        } catch (e) {
          console.warn(`  warn: failed to fetch detail for "${entry.name}": ${e.message}`);
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
