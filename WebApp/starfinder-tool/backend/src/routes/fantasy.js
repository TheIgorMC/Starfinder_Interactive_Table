import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, requireGM } from "../auth.js";
import { broadcast } from "../ws.js";

// Fantasy Map Generator (/fantasy, Docs/16-fantasy-maps.md). Each map is
// one JSON document edited whole by the GM's editor, saved with an
// optimistic version check like the galaxy project. Players only see maps
// the GM marked `playerVisible`, with hidden places and GM notes stripped.
const r = Router();

const COLLECTIONS = ["settlements", "pois", "roads", "rivers", "labels", "events"];

function forPlayers(data) {
  const out = { ...data };
  for (const k of COLLECTIONS) out[k] = (data[k] || []).filter((e) => !e.hidden).map(({ gmNotes: _n, ...e }) => e);
  delete out.gmNotes;
  // books: hidden books and chapters (not written yet, spoilers) stay GM-only
  out.books = (data.books || []).filter((b) => !b.hidden).map((b) => ({ ...b, chapters: (b.chapters || []).filter((c) => !c.hidden) }));
  return out;
}

const isMap = (d) => d && typeof d === "object" && Number.isInteger(d.w) && Number.isInteger(d.h) && d.terrain && typeof d.terrain === "object";

r.get("/", requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, name, version, updated_at, COALESCE((data->>'playerVisible')::boolean, false) AS player_visible FROM fantasy_maps ORDER BY updated_at DESC",
  );
  res.json(req.user.role === "gm" ? rows : rows.filter((m) => m.player_visible));
});

r.get("/:id", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM fantasy_maps WHERE id = $1", [Number(req.params.id) || 0]);
  const m = rows[0];
  if (!m) return res.status(404).json({ error: "no such map" });
  if (req.user.role !== "gm") {
    if (!m.data.playerVisible) return res.status(404).json({ error: "no such map" });
    return res.json({ id: m.id, name: m.name, version: m.version, updated_at: m.updated_at, data: forPlayers(m.data) });
  }
  res.json({ id: m.id, name: m.name, version: m.version, updated_at: m.updated_at, data: m.data });
});

r.post("/", requireGM, async (req, res) => {
  const { data, name } = req.body || {};
  if (!isMap(data)) return res.status(400).json({ error: "not a fantasy map (missing w/h/terrain)" });
  const { rows } = await pool.query(
    "INSERT INTO fantasy_maps (name, data) VALUES ($1, $2) RETURNING id, name, version, updated_at",
    [name || data.name || "Untitled region", JSON.stringify(data)],
  );
  broadcast("fantasy:updated", { id: rows[0].id, version: rows[0].version });
  res.status(201).json(rows[0]);
});

// Save the whole map; `baseVersion` = the version the client loaded.
r.put("/:id", requireGM, async (req, res) => {
  const { data, baseVersion, name } = req.body || {};
  if (!isMap(data)) return res.status(400).json({ error: "not a fantasy map (missing w/h/terrain)" });
  const id = Number(req.params.id) || 0;
  const { rows } = await pool.query(
    `UPDATE fantasy_maps SET data = $2, name = COALESCE($3, name), version = version + 1, updated_at = now()
     WHERE id = $1 AND ($4::int IS NULL OR version = $4) RETURNING id, name, version, updated_at`,
    [id, JSON.stringify(data), name || data.name || null, Number.isInteger(baseVersion) ? baseVersion : null],
  );
  if (!rows[0]) {
    const cur = await pool.query("SELECT version FROM fantasy_maps WHERE id = $1", [id]);
    if (!cur.rows[0]) return res.status(404).json({ error: "no such map" });
    return res.status(409).json({ error: "the map was changed elsewhere — reload before saving", version: cur.rows[0].version });
  }
  broadcast("fantasy:updated", { id, version: rows[0].version });
  res.json(rows[0]);
});

r.delete("/:id", requireGM, async (req, res) => {
  await pool.query("DELETE FROM fantasy_maps WHERE id = $1", [Number(req.params.id) || 0]);
  broadcast("fantasy:updated", { id: Number(req.params.id), deleted: true });
  res.json({ ok: true });
});

export default r;
