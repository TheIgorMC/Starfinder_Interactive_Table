import { Router } from "express";
import multer from "multer";
import { pool } from "../db.js";
import { requireAuth, requireGM } from "../auth.js";
import { askOllamaJson } from "../../scripts/lib/ollama-client.js";
import { parseTgn, importTgnIntoDb, bodyExcerpt } from "../tgn-import.js";
import { stripGmNotes } from "../gm-notes.js";

// Same local Ollama setup already used by scripts/audit-normalized.js
// (Docs/04-data-pipeline-aon.md) — a GM-facing "AI drafts a wiki entry from
// a freeform description" assistant, not a fixed-content pipeline, so this
// deliberately reuses that exact client/conventions (loose JSON parsing,
// think:false, one retry) rather than building a second one.
// "fisso" is the LAN hostname of the desktop/GPU box that runs Ollama (the
// split-host topology in Docs/11-AI-integration.md) — a Pi container can't
// reach the GM's desktop via localhost, and this hostname resolves from
// both there and local dev on the same network. Override via OLLAMA_URL if
// yours is named differently — see docker-compose.yml / .env.example.
const OLLAMA_URL = process.env.OLLAMA_URL || "http://fisso:11434/v1";
const OLLAMA_MODEL = process.env.OLLAMA_MODEL || "qwen3:8b";
const ENTRY_TYPES = ["event", "location", "npc", "faction", "object", "quest"];
// In-memory (not disk) — a .tgn export is plain text, at most a few MB, and
// never needs to persist as a file once parsed.
const uploadTgn = multer({ storage: multer.memoryStorage(), limits: { fileSize: 15 * 1024 * 1024 } });

// GM-authored campaign content: events, locations, NPCs, factions, objects
// — plus relationships between them ("member of", "located in", "owned
// by", ...). An entry may optionally reference a media image, but plenty
// are pure lore text with none — media is an attachment, not the point.
//
// Visibility: GM sees everything; players only see entries the GM has
// explicitly marked `visible_to_players` (default false — secret by
// default, same spirit as the rest of this app's privacy model).
const r = Router();

async function withLinks(entry) {
  const { rows: out } = await pool.query(
    `SELECT l.id, l.relation, l.to_id AS entry_id, e.name, e.type, 'out' AS direction
     FROM campaign_links l JOIN campaign_entries e ON e.id = l.to_id
     WHERE l.from_id = $1`,
    [entry.id]
  );
  const { rows: inc } = await pool.query(
    `SELECT l.id, l.relation, l.from_id AS entry_id, e.name, e.type, 'in' AS direction
     FROM campaign_links l JOIN campaign_entries e ON e.id = l.from_id
     WHERE l.to_id = $1`,
    [entry.id]
  );
  // A statted PC/NPC (characters table) may optionally point back at this
  // wiki entry as its lore page (migrations/012) — surface it so the reader
  // view can show "linked character sheet" without a second round trip.
  let linked_character = null;
  if (entry.type === "npc") {
    const { rows: charRows } = await pool.query(
      "SELECT id, name, race, class, level, portrait_url FROM characters WHERE lore_entry_id = $1",
      [entry.id]
    );
    linked_character = charRows[0] || null;
  }
  return { ...entry, links: [...out, ...inc], linked_character };
}

r.get("/", requireAuth, async (req, res) => {
  const conditions = [];
  const params = [];
  if (req.query.type) {
    params.push(req.query.type);
    conditions.push(`type = $${params.length}`);
  }
  if (req.user.role !== "gm") conditions.push("visible_to_players = true");
  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const { rows } = await pool.query(`SELECT * FROM campaign_entries ${where} ORDER BY name`, params);
  // A "!!private note!!" inside body is a GM-only aside — strip it from
  // any non-GM response at the API layer itself (not just in the reader
  // UI), since a logged-in player can call this endpoint directly.
  if (req.user.role !== "gm") for (const row of rows) row.body = stripGmNotes(row.body);
  res.json(rows);
});

// Every link across the whole campaign in one shot — used by the frontend
// to build the per-type tree view (Campaign.jsx groups entries under their
// parent using the specific relation labels tgn-import.js writes for tree
// nesting; see HIERARCHY_RELATION_BY_TYPE there). Scoped to entries a
// player is allowed to see, same as the entry list above.
r.get("/links", requireAuth, async (req, res) => {
  const entryVisibility = req.user.role === "gm" ? "" : "AND ea.visible_to_players = true AND eb.visible_to_players = true";
  const { rows } = await pool.query(
    `SELECT l.id, l.from_id, l.to_id, l.relation
     FROM campaign_links l
     JOIN campaign_entries ea ON ea.id = l.from_id
     JOIN campaign_entries eb ON eb.id = l.to_id
     WHERE true ${entryVisibility}`
  );
  res.json(rows);
});

// Imports a Tangent (.tgn) campaign export — see src/tgn-import.js for the
// parsing/mapping rules. Insert-only against already-imported entries
// (tracked by external_id), so re-uploading the same or an updated export
// never clobbers a GM's hand-edits made through this UI afterward.
r.post("/import-tgn", requireGM, uploadTgn.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "file required (field name: file)" });
  let parsed;
  try {
    parsed = parseTgn(req.file.buffer.toString("utf8"));
  } catch (err) {
    return res.status(400).json({ error: `Could not parse Goblin Notebook file: ${err.message}` });
  }
  const result = await importTgnIntoDb(pool, parsed);
  res.json(result);
});

// A handful of Cyrillic/Greek letters that render pixel-for-pixel
// identical to a Latin one at normal text sizes ("Gammon Industries" typed
// twice, one of them with a stray Cyrillic а instead of Latin a, reads as
// "the same name" to a GM and to lower(btrim()) alike, but is a different
// codepoint — NFKC normalization does NOT fold these, since they're
// genuinely distinct letters in different scripts, not compatibility
// variants of the same one). Only covers the common single-letter
// look-alikes, not a full Unicode-confusables table — enough for the
// realistic case of an accidental script switch while typing/pasting, not
// meant to catch deliberate spoofing.
const CONFUSABLES = {
  а: "a", е: "e", о: "o", р: "p", с: "c", у: "y", х: "x", к: "k", м: "m", т: "t", н: "h", в: "b", і: "i", ѕ: "s", ј: "j",
  А: "a", Е: "e", О: "o", Р: "p", С: "c", У: "y", Х: "x", К: "k", М: "m", Т: "t", Н: "h", В: "b", І: "i", Ѕ: "s", Ј: "j",
  α: "a", ο: "o", ρ: "p", ι: "i", υ: "y", Α: "a", Ο: "o", Ρ: "p", Ι: "i", Υ: "y",
};

// Folds away everything that makes two names *look* identical to a GM but
// wouldn't group under SQL's lower(btrim()): not just surrounding
// whitespace, but internal double-spaces, zero-width/invisible/formatting
// characters (easy to end up with when pasting into or exporting from
// Tangent), diacritics (NFKD + stripping combining marks — "café" vs
// "cafe"), the single-letter script look-alikes above, and characters
// that only differ by Unicode normalization form (NFKC folds full-width/
// compatibility variants together). Done in JS rather than SQL because
// Postgres has no built-in Unicode normalization without an extension,
// and this only ever runs over the duplicates-tool's request, never a hot
// path.
function normalizeEntryName(name) {
  return (name || "")
    .normalize("NFKC")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // combining diacritical marks, post-NFKD
    .replace(/[​-‏‪-‮⁠-⁤﻿­]/g, "") // zero-width/format/BOM/soft-hyphen
    .replace(/[Ѐ-ӿͰ-Ͽ]/g, (ch) => CONFUSABLES[ch] || ch) // Cyrillic/Greek look-alikes
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

// Two tiers: same type + normalized name is almost certainly the same
// thing re-created in Tangent between exports — safe to suggest merging
// outright. Same name but a *different* type (e.g. an entry moved
// between Tangent columns and re-exported, ending up both as the old
// type and the new one) is flagged separately and lower-confidence,
// since two unrelated concepts sharing a name (a faction and a quest
// both called after it) is also plausible — the GM decides, this just
// surfaces the possibility instead of silently missing it.
// Shared by GET /duplicates (which shows both tiers) and POST
// /duplicates/merge-all (which only ever auto-merges the same-type tier —
// cross-type always needs a human call).
async function findDuplicateGroups(pool) {
  const { rows: entries } = await pool.query(
    "SELECT id, type, name, created_at FROM campaign_entries ORDER BY id"
  );
  const sameTypeGroups = new Map(); // `${type}::${normalized}` -> entries[]
  const crossTypeGroups = new Map(); // normalized -> entries[]
  for (const e of entries) {
    const norm = normalizeEntryName(e.name);
    if (!norm) continue;
    const sameKey = `${e.type}::${norm}`;
    if (!sameTypeGroups.has(sameKey)) sameTypeGroups.set(sameKey, []);
    sameTypeGroups.get(sameKey).push(e);
    if (!crossTypeGroups.has(norm)) crossTypeGroups.set(norm, []);
    crossTypeGroups.get(norm).push(e);
  }
  const sameType = [...sameTypeGroups.values()].filter((g) => g.length > 1);
  const crossType = [...crossTypeGroups.values()].filter((g) => g.length > 1 && new Set(g.map((e) => e.type)).size > 1);
  return { sameType, crossType };
}

// Same (type, name) appearing more than once — typically because a GM
// re-created (rather than edited) something in Tangent between exports,
// which gives it a fresh internal id there and so imports as a brand new
// entry here instead of updating the old one (import is keyed on that id,
// external_id — see tgn-import.js). Grouped for the merge tool below.
r.get("/duplicates", requireGM, async (req, res) => {
  const { sameType, crossType } = await findDuplicateGroups(pool);
  const { rows: dismissedRows } = await pool.query("SELECT entry_ids FROM campaign_duplicate_dismissals");
  const dismissed = new Set(dismissedRows.map((r) => r.entry_ids.slice().sort((a, b) => a - b).join(",")));

  const toRow = (group, confidence, type) => ({
    type: type ?? null,
    name: group[0].name,
    name_variants: [...new Set(group.map((e) => e.name))],
    ids: group.map((e) => e.id),
    id_types: group.map((e) => e.type),
    created_ats: group.map((e) => e.created_at),
    confidence,
  });
  const rows = [
    ...sameType.map((g) => toRow(g, "name", g[0].type)),
    // A cross-type group the GM has already confirmed is two genuinely
    // different things (see POST /duplicates/dismiss) is filtered out here
    // rather than just hidden client-side, so it stays gone across page
    // loads and other GM sessions too.
    ...crossType
      .filter((g) => !dismissed.has(g.map((e) => e.id).sort((a, b) => a - b).join(",")))
      .map((g) => toRow(g, "cross-type")),
  ].sort((a, b) => a.name.localeCompare(b.name));
  res.json(rows);
});

// Marks a cross-type group as "reviewed, these are two different things" —
// see the comment on campaign_duplicate_dismissals (migrations/014) for how
// this is keyed and why it naturally un-dismisses itself if the group's
// membership ever changes.
r.post("/duplicates/dismiss", requireGM, async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(Number).filter(Number.isFinite) : [];
  if (ids.length < 2) return res.status(400).json({ error: "ids (2+) required" });
  const sorted = [...ids].sort((a, b) => a - b);
  await pool.query(
    "INSERT INTO campaign_duplicate_dismissals (entry_ids) VALUES ($1) ON CONFLICT (entry_ids) DO NOTHING",
    [sorted]
  );
  res.status(201).json({ dismissed: sorted });
});

// Merges `remove_ids` into `keep_id`: every link (campaign_links, and
// game session lore links) pointing at a removed entry is re-pointed at
// the kept one instead of just vanishing, then the removed rows are
// deleted.
async function mergeEntries(pool, keepId, removeIds) {
  for (const removeId of removeIds) {
    // campaign_links: re-point both directions, dropping any that would
    // collide with a link the kept entry already has (from_id, to_id,
    // relation is unique).
    await pool.query(
      `DELETE FROM campaign_links l WHERE l.from_id=$1
       AND EXISTS (SELECT 1 FROM campaign_links l2 WHERE l2.from_id=$2 AND l2.to_id=l.to_id AND l2.relation=l.relation)`,
      [removeId, keepId]
    );
    await pool.query("UPDATE campaign_links SET from_id=$1 WHERE from_id=$2", [keepId, removeId]);
    await pool.query(
      `DELETE FROM campaign_links l WHERE l.to_id=$1
       AND EXISTS (SELECT 1 FROM campaign_links l2 WHERE l2.to_id=$2 AND l2.from_id=l.from_id AND l2.relation=l.relation)`,
      [removeId, keepId]
    );
    await pool.query("UPDATE campaign_links SET to_id=$1 WHERE to_id=$2", [keepId, removeId]);
    await pool.query("DELETE FROM campaign_links WHERE from_id = to_id");

    // game_session_entries: same idea, PK (session_id, entry_id) instead
    // of a named unique constraint.
    await pool.query(
      `INSERT INTO game_session_entries (session_id, entry_id)
       SELECT session_id, $1 FROM game_session_entries WHERE entry_id=$2
       ON CONFLICT DO NOTHING`,
      [keepId, removeId]
    );

    await pool.query("DELETE FROM campaign_entries WHERE id=$1", [removeId]);
  }
}

// Never guesses which one to keep — that's the GM's call in the duplicates UI.
r.post("/duplicates/merge", requireGM, async (req, res) => {
  const keepId = Number(req.body?.keep_id);
  const removeIds = Array.isArray(req.body?.remove_ids) ? req.body.remove_ids.map(Number).filter(Number.isFinite) : [];
  if (!Number.isFinite(keepId) || !removeIds.length) return res.status(400).json({ error: "keep_id and remove_ids required" });
  if (removeIds.includes(keepId)) return res.status(400).json({ error: "keep_id cannot also be in remove_ids" });
  await mergeEntries(pool, keepId, removeIds);
  res.json({ merged: removeIds.length, keep_id: keepId });
});

// One-click cleanup for the (common, after a few re-imports) case of many
// same-type/same-name duplicate pairs piling up — going through the
// duplicates panel one group at a time doesn't scale once there are
// a dozen+ of them. Only ever touches the same-type tier (keeping the
// oldest, i.e. lowest id, of each group) — cross-type matches always stay
// manual, since two different kinds of thing sharing a name is a real
// judgment call, not a re-import artifact.
r.post("/duplicates/merge-all", requireGM, async (req, res) => {
  const { sameType } = await findDuplicateGroups(pool);
  let groupsMerged = 0;
  let entriesMerged = 0;
  // Each group merges independently — one group hitting a DB error (e.g. a
  // link conflict the pairwise merge logic doesn't expect) must not abort
  // every group queued after it, and must not fail *silently* either: the
  // response lists exactly which groups didn't go through and why, instead
  // of the GM just seeing some still there with no explanation.
  const failures = [];
  for (const group of sameType) {
    const [keep, ...rest] = group; // already ordered by id ascending
    try {
      await mergeEntries(pool, keep.id, rest.map((e) => e.id));
      groupsMerged++;
      entriesMerged += rest.length;
    } catch (err) {
      failures.push({ name: keep.name, type: keep.type, ids: group.map((e) => e.id), error: err.message });
    }
  }
  res.json({ groupsMerged, entriesMerged, failures });
});

r.get("/:id", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM campaign_entries WHERE id=$1", [req.params.id]);
  const entry = rows[0];
  if (!entry) return res.status(404).json({ error: "not found" });
  if (req.user.role !== "gm" && !entry.visible_to_players) return res.status(403).json({ error: "not visible" });
  if (req.user.role !== "gm") entry.body = stripGmNotes(entry.body);
  res.json(await withLinks(entry));
});

r.post("/", requireGM, async (req, res) => {
  const { type, name, body = "", image_id = null, event_date = "", visible_to_players = false } = req.body ?? {};
  if (!type || !name) return res.status(400).json({ error: "type and name required" });
  const { rows } = await pool.query(
    `INSERT INTO campaign_entries (type, name, body, image_id, event_date, visible_to_players)
     VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [type, name, body, image_id, event_date, visible_to_players]
  );
  res.status(201).json(rows[0]);
});

r.patch("/:id", requireGM, async (req, res) => {
  const b = req.body ?? {};
  const cols = ["type", "name", "body", "image_id", "event_date", "visible_to_players"].filter((f) => b[f] !== undefined);
  if (!cols.length) return res.status(400).json({ error: "no fields" });
  const sets = cols.map((f, i) => `${f}=$${i + 1}`).join(",");
  const { rows } = await pool.query(
    `UPDATE campaign_entries SET ${sets}, updated_at=now() WHERE id=$${cols.length + 1} RETURNING *`,
    [...cols.map((f) => b[f]), req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "not found" });
  res.json(rows[0]);
});

r.delete("/:id", requireGM, async (req, res) => {
  await pool.query("DELETE FROM campaign_entries WHERE id=$1", [req.params.id]);
  res.status(204).end();
});

r.post("/:id/links", requireGM, async (req, res) => {
  const { to_id, relation = "" } = req.body ?? {};
  if (!to_id) return res.status(400).json({ error: "to_id required" });
  const { rows } = await pool.query(
    `INSERT INTO campaign_links (from_id, to_id, relation) VALUES ($1,$2,$3)
     ON CONFLICT DO NOTHING RETURNING *`,
    [req.params.id, to_id, relation]
  );
  res.status(201).json(rows[0] ?? null);
});

r.delete("/links/:linkId", requireGM, async (req, res) => {
  await pool.query("DELETE FROM campaign_links WHERE id=$1", [req.params.linkId]);
  res.status(204).end();
});

// Turns a GM's freeform note ("a grizzled Vesk mercenary captain found
// drinking alone at the Rust & Ration bar, used to run with the Vex
// Cartel...") into a draft entry: type/name/body, plus links to any
// EXISTING entries the description clearly references. Drafts only —
// nothing is written to campaign_entries or campaign_links here; the GM
// reviews/edits the draft client-side and hits the normal Save, same as a
// hand-typed entry (matches this app's "AI never trusted blindly, GM
// decides" stance elsewhere — see scripts/audit-normalized.js's own header,
// and Docs/04-data-pipeline-aon.md for why).
r.post("/ai-draft", requireGM, async (req, res) => {
  const { description, hint_type } = req.body ?? {};
  if (!description || !description.trim()) return res.status(400).json({ error: "description required" });

  const { rows: existing } = await pool.query("SELECT id, type, name, body FROM campaign_entries ORDER BY name");
  // A compact index the model can cite by id — single-pass, not GalaxyGen's
  // two-pass shortlist-then-detail approach (Docs/11-AI-integration.md §3):
  // a home campaign's wiki tops out at a few hundred entries, comfortably
  // small enough to send in full every time without a filtering pass. The
  // preview text is derived from `body` on the spot (bodyExcerpt) rather
  // than a stored `summary` column, so it can never go stale.
  const index = existing.map((e) => `${e.id} | ${e.type} | ${e.name} | ${bodyExcerpt(e.body)}`).join("\n");

  const system = `You are a Starfinder tabletop RPG campaign wiki assistant. The GM gives you a short freeform note; turn it into one structured wiki entry.

Given the GM's note and a list of existing wiki entries (id | type | name | preview), respond with a single JSON object:
{
  "type": one of "event", "location", "npc", "faction", "object" — whichever best fits the note,
  "name": a short proper name, taken from the note if it gives one, otherwise a fitting invented one,
  "body": 1-3 short paragraphs expanding the note into wiki-entry prose — elaborate on tone and detail, but do not invent major new facts (names, factions, plot twists) the note didn't imply,
  "event_date": a freeform in-game date, only if type is "event" and the note mentions one, otherwise "",
  "links": an array of { "entry_id": <id copied exactly from the list above>, "relation": "short phrase, e.g. 'works for', 'located in', 'member of'" } for EXISTING entries the note clearly and specifically references. Never invent an entry_id that is not in the list. Leave "links" empty if nothing in the note clearly references an existing entry.
}`;
  const user = `Existing entries:\n${index || "(none yet)"}\n\nGM's note:\n${description.trim()}${
    ENTRY_TYPES.includes(hint_type) ? `\n\n(The GM was on the "${hint_type}" tab when writing this, but use your own judgment on type.)` : ""
  }`;

  let draft;
  try {
    draft = await askOllamaJson({ baseUrl: OLLAMA_URL, model: OLLAMA_MODEL, system, user, maxTokens: 1200 });
  } catch (err) {
    return res.status(502).json({ error: `AI draft failed: ${err.message}` });
  }

  const type = ENTRY_TYPES.includes(draft.type) ? draft.type : (ENTRY_TYPES.includes(hint_type) ? hint_type : "npc");
  const byId = new Map(existing.map((e) => [e.id, e]));
  const links = Array.isArray(draft.links)
    ? draft.links
        .map((l) => ({ entry_id: Number(l.entry_id), relation: String(l.relation || "").slice(0, 80) }))
        .filter((l) => byId.has(l.entry_id))
        .map((l) => ({ ...l, name: byId.get(l.entry_id).name, type: byId.get(l.entry_id).type }))
    : [];

  res.json({
    type,
    name: String(draft.name || "").slice(0, 200),
    body: String(draft.body || ""),
    event_date: type === "event" ? String(draft.event_date || "") : "",
    links,
  });
});

export default r;
