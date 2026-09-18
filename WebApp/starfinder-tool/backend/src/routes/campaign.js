import { Router } from "express";
import multer from "multer";
import { pool } from "../db.js";
import { requireAuth, requireGM } from "../auth.js";
import { askOllamaJson } from "../../scripts/lib/ollama-client.js";
import { parseTgn, importTgnIntoDb, summarize } from "../tgn-import.js";

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
  return { ...entry, links: [...out, ...inc] };
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
    return res.status(400).json({ error: `Could not parse .tgn file: ${err.message}` });
  }
  const result = await importTgnIntoDb(pool, parsed);
  res.json(result);
});

// Recomputes `summary` (only) for every tgn-imported entry (external_id
// IS NOT NULL) from its existing `body`, using the current summarize()
// logic — for entries imported before a fix to that logic (e.g. it used
// to flatten the whole body instead of stopping at the first paragraph),
// re-importing the same .tgn is a no-op (insert-only) so it never repairs
// them. This does, on purpose: body/links/everything else untouched, and
// it never touches a hand-authored entry (external_id is null for those).
r.post("/refresh-summaries", requireGM, async (req, res) => {
  const { rows } = await pool.query("SELECT id, body FROM campaign_entries WHERE external_id IS NOT NULL");
  let updated = 0;
  for (const row of rows) {
    const summary = summarize(row.body);
    const { rowCount } = await pool.query(
      "UPDATE campaign_entries SET summary=$1 WHERE id=$2 AND summary IS DISTINCT FROM $1",
      [summary, row.id]
    );
    updated += rowCount;
  }
  res.json({ checked: rows.length, updated });
});

// Same (type, name) appearing more than once — typically because a GM
// re-created (rather than edited) something in Tangent between exports,
// which gives it a fresh internal id there and so imports as a brand new
// entry here instead of updating the old one (import is keyed on that id,
// external_id — see tgn-import.js). Grouped for the merge tool below.
r.get("/duplicates", requireGM, async (req, res) => {
  const { rows } = await pool.query(`
    SELECT type, name, array_agg(id ORDER BY id) AS ids, array_agg(created_at ORDER BY id) AS created_ats
    FROM campaign_entries
    GROUP BY type, name
    HAVING count(*) > 1
    ORDER BY name
  `);
  res.json(rows);
});

// Merges `remove_ids` into `keep_id`: every link (campaign_links, and
// game session lore links) pointing at a removed entry is re-pointed at
// the kept one instead of just vanishing, then the removed rows are
// deleted. Never guesses which one to keep — that's the GM's call in the
// duplicates UI.
r.post("/duplicates/merge", requireGM, async (req, res) => {
  const keepId = Number(req.body?.keep_id);
  const removeIds = Array.isArray(req.body?.remove_ids) ? req.body.remove_ids.map(Number).filter(Number.isFinite) : [];
  if (!Number.isFinite(keepId) || !removeIds.length) return res.status(400).json({ error: "keep_id and remove_ids required" });
  if (removeIds.includes(keepId)) return res.status(400).json({ error: "keep_id cannot also be in remove_ids" });

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

  res.json({ merged: removeIds.length, keep_id: keepId });
});

r.get("/:id", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM campaign_entries WHERE id=$1", [req.params.id]);
  const entry = rows[0];
  if (!entry) return res.status(404).json({ error: "not found" });
  if (req.user.role !== "gm" && !entry.visible_to_players) return res.status(403).json({ error: "not visible" });
  res.json(await withLinks(entry));
});

r.post("/", requireGM, async (req, res) => {
  const { type, name, summary = "", body = "", image_id = null, event_date = "", visible_to_players = false } = req.body ?? {};
  if (!type || !name) return res.status(400).json({ error: "type and name required" });
  const { rows } = await pool.query(
    `INSERT INTO campaign_entries (type, name, summary, body, image_id, event_date, visible_to_players)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [type, name, summary, body, image_id, event_date, visible_to_players]
  );
  res.status(201).json(rows[0]);
});

r.patch("/:id", requireGM, async (req, res) => {
  const b = req.body ?? {};
  const cols = ["type", "name", "summary", "body", "image_id", "event_date", "visible_to_players"].filter((f) => b[f] !== undefined);
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
// Cartel...") into a draft entry: type/name/summary/body, plus links to any
// EXISTING entries the description clearly references. Drafts only —
// nothing is written to campaign_entries or campaign_links here; the GM
// reviews/edits the draft client-side and hits the normal Save, same as a
// hand-typed entry (matches this app's "AI never trusted blindly, GM
// decides" stance elsewhere — see scripts/audit-normalized.js's own header,
// and Docs/04-data-pipeline-aon.md for why).
r.post("/ai-draft", requireGM, async (req, res) => {
  const { description, hint_type } = req.body ?? {};
  if (!description || !description.trim()) return res.status(400).json({ error: "description required" });

  const { rows: existing } = await pool.query("SELECT id, type, name, summary FROM campaign_entries ORDER BY name");
  // A compact index the model can cite by id — single-pass, not GalaxyGen's
  // two-pass shortlist-then-detail approach (Docs/11-AI-integration.md §3):
  // a home campaign's wiki tops out at a few hundred entries, comfortably
  // small enough to send in full every time without a filtering pass.
  const index = existing.map((e) => `${e.id} | ${e.type} | ${e.name} | ${e.summary || ""}`).join("\n");

  const system = `You are a Starfinder tabletop RPG campaign wiki assistant. The GM gives you a short freeform note; turn it into one structured wiki entry.

Given the GM's note and a list of existing wiki entries (id | type | name | summary), respond with a single JSON object:
{
  "type": one of "event", "location", "npc", "faction", "object" — whichever best fits the note,
  "name": a short proper name, taken from the note if it gives one, otherwise a fitting invented one,
  "summary": one punchy sentence,
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
    summary: String(draft.summary || "").slice(0, 500),
    body: String(draft.body || ""),
    event_date: type === "event" ? String(draft.event_date || "") : "",
    links,
  });
});

export default r;
