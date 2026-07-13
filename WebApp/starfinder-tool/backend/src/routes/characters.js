import { Router } from "express";
import { pool } from "../db.js";
import { broadcast } from "../ws.js";
import { requireGM, requireGmOrOwnCharacter, setSessionCookie } from "../auth.js";
import { mapHephaistosCharacter } from "../hephaistos.js";

const r = Router();

const FIELDS = [
  "name","race","theme","class","level",
  "str","dex","con","int","wis","cha",
  "hp_max","hp_cur","sp_max","sp_cur","rp_max","rp_cur",
  "eac","kac","bab","save_fort","save_ref","save_will",
  "init_bonus","speed","skills","feats","spells","equipment","notes","portrait_url",
  "credits","conditions",
];
const JSON_FIELDS = new Set(["skills", "feats", "spells", "equipment", "conditions"]);

const forId = (req) => req.params.id;

// Full list is GM-only — a player has exactly one character (their own,
// fetched by id) and never needs to enumerate everyone else's.
r.get("/", requireGM, async (_req, res) => {
  const { rows } = await pool.query("SELECT * FROM characters ORDER BY name");
  res.json(rows);
});

r.get("/:id", requireGmOrOwnCharacter(forId), async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM characters WHERE id=$1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "not found" });
  res.json(rows[0]);
});

// GM-only: import a character exported from Hephaistos (hephaistos.online),
// optionally assigning it straight to an existing player account.
r.post("/import/hephaistos", requireGM, async (req, res) => {
  const { hephaistos, assignToUsername } = req.body ?? {};
  let mapped;
  try {
    mapped = mapHephaistosCharacter(hephaistos);
  } catch (e) {
    return res.status(400).json({ error: e.message });
  }

  const cols = FIELDS.filter((f) => mapped[f] !== undefined);
  const vals = cols.map((f) =>
    JSON_FIELDS.has(f) ? JSON.stringify(mapped[f]) : mapped[f]
  );
  const params = cols.map((_, i) => `$${i + 1}`).join(",");
  const { rows } = await pool.query(
    `INSERT INTO characters (${cols.join(",")}) VALUES (${params}) RETURNING *`,
    vals
  );

  if (assignToUsername) {
    const upd = await pool.query(
      "UPDATE users SET character_id=$1 WHERE username=$2 AND role='player' RETURNING id",
      [rows[0].id, assignToUsername]
    );
    if (!upd.rowCount) {
      return res.status(400).json({ error: `no player account "${assignToUsername}" found` });
    }
  }

  broadcast("character:created", { id: rows[0].id });
  res.status(201).json(rows[0]);
});

// GM can create any number of characters (PCs, NPCs). A player may create
// exactly one, self-service — it's automatically linked to their account.
r.post("/", async (req, res) => {
  if (!req.user) return res.status(401).json({ error: "login required" });
  if (req.user.role === "player" && req.user.characterId != null) {
    return res.status(403).json({ error: "you already have a character" });
  }

  const b = req.body ?? {};
  if (!b.name) return res.status(400).json({ error: "name required" });
  const cols = FIELDS.filter((f) => b[f] !== undefined);
  const vals = cols.map((f) =>
    JSON_FIELDS.has(f) ? JSON.stringify(b[f]) : b[f]
  );
  const params = cols.map((_, i) => `$${i + 1}`).join(",");
  const { rows } = await pool.query(
    `INSERT INTO characters (${cols.join(",")}) VALUES (${params}) RETURNING *`,
    vals
  );

  if (req.user.role === "player") {
    await pool.query("UPDATE users SET character_id=$1 WHERE id=$2", [rows[0].id, req.user.uid]);
    // the session cookie still has the old (null) characterId baked in —
    // reissue it now, or the one-character limit and ownership checks below
    // would keep seeing stale data for the rest of this session
    setSessionCookie(res, {
      id: req.user.uid,
      username: req.user.username,
      role: req.user.role,
      character_id: rows[0].id,
    });
  }

  broadcast("character:created", { id: rows[0].id });
  res.status(201).json(rows[0]);
});

r.patch("/:id", requireGmOrOwnCharacter(forId), async (req, res) => {
  const b = req.body ?? {};
  const cols = FIELDS.filter((f) => b[f] !== undefined);
  if (!cols.length) return res.status(400).json({ error: "no fields" });
  const sets = cols.map((f, i) => `${f}=$${i + 1}`).join(",");
  const vals = cols.map((f) =>
    JSON_FIELDS.has(f) ? JSON.stringify(b[f]) : b[f]
  );
  const { rows } = await pool.query(
    `UPDATE characters SET ${sets}, updated_at=now() WHERE id=$${cols.length + 1} RETURNING *`,
    [...vals, req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "not found" });
  broadcast("character:updated", { id: rows[0].id });
  res.json(rows[0]);
});

r.delete("/:id", requireGM, async (req, res) => {
  await pool.query("DELETE FROM characters WHERE id=$1", [req.params.id]);
  broadcast("character:deleted", { id: Number(req.params.id) });
  res.status(204).end();
});

export default r;
