import { Router } from "express";
import bcrypt from "bcryptjs";
import { pool } from "../db.js";
import { setSessionCookie, clearSessionCookie, requireGM } from "../auth.js";

const r = Router();

r.post("/login", async (req, res) => {
  const { username, password } = req.body ?? {};
  if (!username || !password) return res.status(400).json({ error: "username and password required" });

  const { rows } = await pool.query("SELECT * FROM users WHERE username=$1", [username]);
  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: "invalid username or password" });
  }

  setSessionCookie(res, user);
  res.json({ username: user.username, role: user.role, characterId: user.character_id });
});

r.post("/logout", (_req, res) => {
  clearSessionCookie(res);
  res.status(204).end();
});

r.get("/me", (req, res) => {
  if (!req.user) return res.json({ user: null });
  res.json({ user: { username: req.user.username, role: req.user.role, characterId: req.user.characterId } });
});

// so the GM can pick which player account to assign an imported character to
r.get("/users", requireGM, async (_req, res) => {
  const { rows } = await pool.query(
    "SELECT username, role, character_id FROM users WHERE role='player' ORDER BY username"
  );
  res.json(rows);
});

// Reassigns which character (if any) a player account points at — the same
// PC/NPC switch as scripts/create-user.js's upsert, but scoped to just this
// field so the Characters tab can offer it as "make this a PC" / "make this
// an NPC" without touching username/password. character_id: null clears the
// link, turning a character back into a plain (unowned) NPC.
r.patch("/users/:username/character", requireGM, async (req, res) => {
  const { character_id = null } = req.body ?? {};
  const { rows } = await pool.query(
    "UPDATE users SET character_id=$1 WHERE username=$2 AND role='player' RETURNING username, role, character_id",
    [character_id, req.params.username]
  );
  if (!rows[0]) return res.status(404).json({ error: "no such player account" });
  res.json(rows[0]);
});

export default r;
