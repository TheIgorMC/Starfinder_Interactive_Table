#!/usr/bin/env node
// Retroactive cleanup of aon_entries.source over data that's already been
// imported — the two import pipelines (Foundry, AoN scrape) now both run
// every raw source string through the same normalizeSource() at import
// time (see src/source-books.js), but anything imported before that was
// shared, or under an abbreviation/variant not yet in SOURCE_BOOKS, still
// needs a pass over the live table.
//
// Two independent problems this fixes:
//   1. The same real book spelled several different ways ("CRB" vs "Core
//      Rulebook" vs "Starfinder Core Rulebook") — these get merged onto
//      SOURCE_BOOKS' one canonical name.
//   2. A `source` value that isn't a real sourcebook title at all — a
//      parsing leak (stray prose, a URL, an empty string). These can't be
//      auto-corrected (there's no "right answer" to guess), so they're
//      flagged instead: review_status is set to 'flagged' with a note, so
//      they surface in the GM's /review tool and in an MCP-connected AI's
//      `review_list(status: "flagged")` for a human/AI pass — exactly the
//      same aon_entries columns the review workflow already uses.
//
// Dry-run by default — prints a report and changes nothing.
//
// Usage:
//   DATABASE_URL=postgres://... node scripts/normalize-sources.js            # report only
//   DATABASE_URL=postgres://... node scripts/normalize-sources.js --apply    # rename known variants
//   DATABASE_URL=postgres://... node scripts/normalize-sources.js --flag-suspicious   # also flag non-book sources for review
//   ... --category=feat    # restrict to one category

import pg from "pg";
import { SOURCE_BOOKS, looksLikeSuspiciousSource } from "../src/source-books.js";

function parseArgs(argv) {
  const args = { apply: false, flagSuspicious: false, category: null };
  for (const raw of argv) {
    if (raw === "--apply") args.apply = true;
    else if (raw === "--flag-suspicious") args.flagSuspicious = true;
    else if (raw.startsWith("--category=")) args.category = raw.slice("--category=".length);
  }
  return args;
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const args = parseArgs(process.argv.slice(2));
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  const params = [];
  const where = args.category ? (params.push(args.category), "WHERE category = $1") : "";
  const { rows } = await pool.query(
    `SELECT source, count(*)::int AS count FROM aon_entries ${where} GROUP BY source ORDER BY count DESC`,
    params
  );

  const renames = []; // { from, to, count }
  const suspicious = []; // { source, count, reason }
  for (const row of rows) {
    const canonical = SOURCE_BOOKS[row.source];
    if (canonical && canonical !== row.source) {
      renames.push({ from: row.source, to: canonical, count: row.count });
      continue;
    }
    const reason = looksLikeSuspiciousSource(row.source);
    if (reason) suspicious.push({ source: row.source, count: row.count, reason });
  }

  console.log(`${rows.length} distinct source value(s)${args.category ? ` in category "${args.category}"` : ""}.\n`);

  if (renames.length) {
    console.log(`Known-abbreviation renames (${renames.length}):`);
    for (const r of renames) console.log(`  ${r.count.toString().padStart(5)}  "${r.from}" -> "${r.to}"`);
  } else {
    console.log("No known-abbreviation renames needed.");
  }

  console.log(`\nSuspicious (not a recognized book, doesn't look like a real title) (${suspicious.length}):`);
  for (const s of suspicious) console.log(`  ${s.count.toString().padStart(5)}  "${s.source}"  — ${s.reason}`);
  if (!suspicious.length) console.log("  (none)");

  if (!args.apply && !args.flagSuspicious) {
    console.log("\nDry run — nothing was changed. Re-run with --apply to rename, --flag-suspicious to flag for review.");
    await pool.end();
    return;
  }

  if (args.apply && renames.length) {
    console.log(`\nApplying ${renames.length} rename(s)...`);
    for (const r of renames) {
      const { rowCount } = await pool.query(
        `UPDATE aon_entries SET source = $1 WHERE source = $2${args.category ? " AND category = $3" : ""}`,
        args.category ? [r.to, r.from, args.category] : [r.to, r.from]
      );
      console.log(`  "${r.from}" -> "${r.to}": ${rowCount} row(s)`);
    }
  }

  if (args.flagSuspicious && suspicious.length) {
    console.log(`\nFlagging ${suspicious.length} suspicious source value(s) for review...`);
    for (const s of suspicious) {
      const { rowCount } = await pool.query(
        `UPDATE aon_entries
         SET review_status = 'flagged',
             review_notes = CASE WHEN review_notes = '' THEN $1 ELSE review_notes || E'\\n' || $1 END,
             reviewed_by = 'normalize-sources.js',
             reviewed_at = now()
         WHERE source = $2${args.category ? " AND category = $3" : ""}`,
        args.category
          ? [`Suspicious source "${s.source}" (${s.reason}) — verify and correct by hand.`, s.source, args.category]
          : [`Suspicious source "${s.source}" (${s.reason}) — verify and correct by hand.`, s.source]
      );
      console.log(`  "${s.source}": ${rowCount} row(s) flagged`);
    }
  }

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
