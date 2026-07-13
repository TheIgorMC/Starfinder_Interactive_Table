import { Router } from "express";
import { pool } from "../db.js";
import { broadcast } from "../ws.js";

const r = Router();

// --- sessions ---
r.get("/sessions", async (_req, res) => {
  const { rows } = await pool.query("SELECT * FROM battle_sessions ORDER BY id DESC");
  res.json(rows);
});

r.post("/sessions", async (req, res) => {
  const { name = "New Encounter", grid_w = 30, grid_h = 20, map_url = "" } = req.body ?? {};
  const { rows } = await pool.query(
    "INSERT INTO battle_sessions (name, grid_w, grid_h, map_url) VALUES ($1,$2,$3,$4) RETURNING *",
    [name, grid_w, grid_h, map_url]
  );
  broadcast("session:created", rows[0]);
  res.status(201).json(rows[0]);
});

r.get("/sessions/:id", async (req, res) => {
  const s = await pool.query("SELECT * FROM battle_sessions WHERE id=$1", [req.params.id]);
  if (!s.rows[0]) return res.status(404).json({ error: "not found" });
  const t = await pool.query("SELECT * FROM tokens WHERE session_id=$1 ORDER BY id", [req.params.id]);
  res.json({ ...s.rows[0], tokens: t.rows });
});

// --- tokens ---
r.post("/sessions/:id/tokens", async (req, res) => {
  const { label, color = "#4f8ef7", x = 0, y = 0, character_id = null, tracker_id = null } = req.body ?? {};
  if (!label) return res.status(400).json({ error: "label required" });
  const { rows } = await pool.query(
    `INSERT INTO tokens (session_id, label, color, x, y, character_id, tracker_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.params.id, label, color, x, y, character_id, tracker_id]
  );
  broadcast("token:created", rows[0]);
  res.status(201).json(rows[0]);
});

// manual move (drag on GM screen) or tracker-driven move by token id
r.post("/sessions/:sid/tokens/:tid/position", async (req, res) => {
  const { x, y } = req.body ?? {};
  if (!Number.isInteger(x) || !Number.isInteger(y))
    return res.status(400).json({ error: "x and y must be integers" });
  const { rows } = await pool.query(
    "UPDATE tokens SET x=$1, y=$2 WHERE id=$3 AND session_id=$4 RETURNING *",
    [x, y, req.params.tid, req.params.sid]
  );
  if (!rows[0]) return res.status(404).json({ error: "not found" });
  broadcast("token:moved", rows[0]);
  res.json(rows[0]);
});

// tracker-driven move by physical mini id (Hall sensor PCB, POSTed from PC browser)
r.post("/tracker/position", async (req, res) => {
  const { tracker_id, x, y } = req.body ?? {};
  if (!tracker_id || !Number.isInteger(x) || !Number.isInteger(y))
    return res.status(400).json({ error: "tracker_id, x, y required" });
  const { rows } = await pool.query(
    "UPDATE tokens SET x=$1, y=$2 WHERE tracker_id=$3 RETURNING *",
    [x, y, tracker_id]
  );
  if (!rows[0]) return res.status(404).json({ error: "no token bound to tracker_id" });
  broadcast("token:moved", rows[0]);
  res.json(rows[0]);
});

r.delete("/sessions/:sid/tokens/:tid", async (req, res) => {
  await pool.query("DELETE FROM tokens WHERE id=$1 AND session_id=$2", [req.params.tid, req.params.sid]);
  broadcast("token:deleted", { id: Number(req.params.tid), session_id: Number(req.params.sid) });
  res.status(204).end();
});

export default r;
