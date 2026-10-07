#!/usr/bin/env node
// Grounded AI-assisted first pass over the Data Review workflow (see
// backend/migrations/010_aon_review.sql, backend/src/routes/review.js,
// frontend/src/views/ReviewTool.jsx, and the `review_*` tools exposed by
// mcp-server/). Everything imported by import-aon-cache.js starts
// 'unreviewed' — this is the "AI assist to verify and validate everything
// taken for granted from the first parser" pass: it runs the exact same
// grounded consistency check scripts/audit-normalized.js already uses for
// pre-import aon-cache/ files (does a structured field actually match its
// OWN source text — never "is this correct per real Starfinder rules",
// which a local model doesn't actually know and would fabricate), but
// against the LIVE `aon_entries` table, and writes real verdicts into the
// same review_status/review_notes/reviewed_by columns the web UI and MCP's
// review_update tool both read and write. That's the "sfruttando l'MCP che
// già hai" part: this script does the cheap bulk sweep, then a human (or
// an MCP-connected AI session) works the much smaller flagged queue via
// `review_list(status: "flagged")` / `review_get` / `review_update` —
// nobody has to churn through 8,900+ entries one MCP round trip at a time.
//
// Verdict per entry:
//   - no checkable claims, no anomalies -> left untouched (nothing to say)
//   - anomalies (deterministic contradictions) or any LLM "mismatch"
//     -> review_status 'flagged', review_notes lists exactly what's wrong
//   - everything else (match/uncertain only) -> review_status 'approved',
//     unless --no-auto-approve, in which case it's left 'unreviewed' and
//     only problems get written (a more conservative mode: AI never
//     approves, only flags)
//
// A human verdict is never silently overwritten: by default this only
// touches rows with review_status = 'unreviewed'. Pass --all to re-sweep
// everything regardless of current status (useful after extending the
// checker itself) — even then, an entry that already has review_notes
// gets this run's findings appended under a separator, never replacing
// what's there.
//
// Usage:
//   DATABASE_URL=postgres://... OLLAMA_URL=http://fisso:11434/v1 \
//     node scripts/audit-aon-entries.js <category> [--limit=N] [--random] [--seed=N]
//     [--all] [--no-auto-approve] [--dry-run] [--model=qwen3:8b]

import pg from "pg";
import { buildItemAuditPrompt, applyItemAuditResults } from "./lib/audit-item.js";
import { askOllamaJson, pingOllama } from "./lib/ollama-client.js";

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
  const args = {
    category: null, limit: null, random: false, seed: Date.now() % 100000,
    all: false, autoApprove: true, dryRun: false,
    ollamaUrl: process.env.OLLAMA_URL || "http://localhost:11434/v1",
    model: process.env.OLLAMA_MODEL || "qwen3:8b",
  };
  for (const raw of argv) {
    if (!raw.startsWith("--")) { args.category = raw; continue; }
    const [key, value] = raw.slice(2).split(/=(.*)/s);
    if (key === "limit") args.limit = Number(value);
    else if (key === "random") args.random = true;
    else if (key === "seed") { args.random = true; args.seed = Number(value); }
    else if (key === "all") args.all = true;
    else if (key === "no-auto-approve") args.autoApprove = false;
    else if (key === "dry-run") args.dryRun = true;
    else if (key === "ollama-url") args.ollamaUrl = value;
    else if (key === "model") args.model = value;
  }
  return args;
}

function formatNote(entries, anomalies) {
  const lines = [];
  for (const e of entries) {
    if (e.verdict === "mismatch") lines.push(`MISMATCH: ${e.claim}\n  -> ${e.note}`);
    else if (e.verdict === "anomaly") lines.push(`ANOMALY: ${e.claim}`);
  }
  return lines.join("\n");
}

async function main() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL is not set");
  const args = parseArgs(process.argv.slice(2));
  if (!args.category) {
    console.error("Usage: node scripts/audit-aon-entries.js <category> [--limit=N] [--random] [--seed=N] [--all] [--no-auto-approve] [--dry-run] [--ollama-url=...] [--model=...]");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  const statusFilter = args.all ? "" : "AND review_status = 'unreviewed'";
  const { rows } = await pool.query(
    `SELECT id, category, name, data, mechanics, review_status, review_notes
     FROM aon_entries WHERE category = $1 ${statusFilter} ORDER BY name`,
    [args.category]
  );
  if (!rows.length) {
    console.log(`No ${args.all ? "" : "unreviewed "}entries found in category "${args.category}".`);
    await pool.end();
    return;
  }

  const ping = await pingOllama(args.ollamaUrl);
  if (!ping.ok) {
    console.error(`${args.ollamaUrl} isn't reachable (${ping.reason}) — nothing to audit against. Start Ollama first.`);
    process.exit(1);
  }
  const chatBaseUrl = args.ollamaUrl.replace(/^https?:\/\/[^/]+/, new URL(ping.url).origin);

  const sample = args.random ? seededShuffle(rows, args.seed) : rows;
  const limited = args.limit ? sample.slice(0, args.limit) : sample;
  if (args.random) console.log(`Random sample (seed ${args.seed}) of ${limited.length}/${rows.length} ${args.category}.`);

  let checked = 0, noClaims = 0, flagged = 0, approved = 0, callFailures = 0;

  for (const entry of limited) {
    process.stdout.write(`\r[audit ${args.category} ${checked + 1}/${limited.length}] ${entry.name.padEnd(36)}`);
    const { system, user, claimMeta, anomalies } = buildItemAuditPrompt(entry);

    let checkEntries = [];
    if (claimMeta.length > 0) {
      try {
        const result = await askOllamaJson({ baseUrl: chatBaseUrl, model: args.model, system, user, maxTokens: 2000 });
        checkEntries = applyItemAuditResults(entry, result.checks, claimMeta, anomalies);
      } catch (err) {
        callFailures++;
        process.stdout.write(` FAILED: ${err.message}\n`);
        checked++;
        continue;
      }
    } else if (anomalies.length) {
      checkEntries = applyItemAuditResults(entry, [], [], anomalies);
    } else {
      noClaims++;
      checked++;
      process.stdout.write(" (no checkable claims)\n");
      continue;
    }

    const hasProblem = checkEntries.some((e) => e.verdict === "mismatch" || e.verdict === "anomaly");
    const note = formatNote(checkEntries, anomalies);
    const tag = `[AI audit ${new Date().toISOString().slice(0, 10)}, ${args.model}]`;

    if (hasProblem) {
      flagged++;
      process.stdout.write(` FLAGGED (${checkEntries.filter((e) => e.verdict === "mismatch").length} mismatch, ${checkEntries.filter((e) => e.verdict === "anomaly").length} anomaly)\n`);
      if (!args.dryRun) {
        const fullNote = `${tag}\n${note}`;
        const combined = entry.review_notes ? `${entry.review_notes}\n---\n${fullNote}` : fullNote;
        await pool.query(
          `UPDATE aon_entries SET review_status='flagged', review_notes=$1, reviewed_by=$2, reviewed_at=now() WHERE id=$3`,
          [combined, `ai-audit:${args.model}`, entry.id]
        );
      }
    } else if (args.autoApprove) {
      approved++;
      process.stdout.write(" approved\n");
      if (!args.dryRun) {
        const fullNote = `${tag} no issues found`;
        const combined = entry.review_notes ? `${entry.review_notes}\n---\n${fullNote}` : fullNote;
        await pool.query(
          `UPDATE aon_entries SET review_status='approved', review_notes=$1, reviewed_by=$2, reviewed_at=now() WHERE id=$3`,
          [combined, `ai-audit:${args.model}`, entry.id]
        );
      }
    } else {
      process.stdout.write(" clean (left unreviewed, --no-auto-approve)\n");
    }
    checked++;
  }

  console.log(`\nChecked ${checked} ${args.category} (${noClaims} had no checkable claims): ${flagged} flagged, ${approved} auto-approved, ${callFailures} call failure(s).`);
  if (args.dryRun) console.log("Dry run — no database rows were changed.");
  console.log(flagged ? `\nWork the flagged queue via /review (GM UI) or an MCP-connected AI's review_list(status: "flagged").` : "");

  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
