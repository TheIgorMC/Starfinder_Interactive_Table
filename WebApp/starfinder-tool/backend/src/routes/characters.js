import { Router } from "express";
import { pool } from "../db.js";
import { broadcast } from "../ws.js";

const r = Router();

const FIELDS = [
  "name","race","theme","class","level",
  "str","dex","con","int","wis","cha",
  "hp_max","hp_cur","sp_max","sp_cur","rp_max","rp_cur",
  "eac","kac","bab","save_fort","save_ref","save_will",
  "init_bonus","speed","skills","feats","spells","equipment","notes",
];

r.get("/", async (_req, res) => {
  const { rows } = await pool.query("SELECT * FROM characters ORDER BY name");
  res.json(rows);
});

r.get("/:id", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM characters WHERE id=$1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "not found" });
  res.json(rows[0]);
});

r.post("/", async (req, res) => {
  const b = req.body ?? {};
  if (!b.name) return res.status(400).json({ error: "name required" });
  const cols = FIELDS.filter((f) => b[f] !== undefined);
  const vals = cols.map((f) =>
    ["skills","feats","spells","equipment"].includes(f) ? JSON.stringify(b[f]) : b[f]
  );
  const params = cols.map((_, i) => `$${i + 1}`).join(",");
  const { rows } = await pool.query(
    `INSERT INTO characters (${cols.join(",")}) VALUES (${params}) RETURNING *`,
    vals
  );
  broadcast("character:created", rows[0]);
  res.status(201).json(rows[0]);
});

r.patch("/:id", async (req, res) => {
  const b = req.body ?? {};
  const cols = FIELDS.filter((f) => b[f] !== undefined);
  if (!cols.length) return res.status(400).json({ error: "no fields" });
  const sets = cols.map((f, i) => `${f}=$${i + 1}`).join(",");
  const vals = cols.map((f) =>
    ["skills","feats","spells","equipment"].includes(f) ? JSON.stringify(b[f]) : b[f]
  );
  const { rows } = await pool.query(
    `UPDATE characters SET ${sets}, updated_at=now() WHERE id=$${cols.length + 1} RETURNING *`,
    [...vals, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "not found" });
  broadcast("character:updated", rows[0]);
  res.json(rows[0]);
});

r.delete("/:id", async (req, res) => {
  await pool.query("DELETE FROM characters WHERE id=$1", [req.params.id]);
  broadcast("character:deleted", { id: Number(req.params.id) });
  res.status(204).end();
});

export default r;
