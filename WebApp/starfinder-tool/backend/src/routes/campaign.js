import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth, requireGM } from "../auth.js";

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

export default r;
