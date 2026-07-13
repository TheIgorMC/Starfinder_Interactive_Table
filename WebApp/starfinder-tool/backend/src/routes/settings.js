import { Router } from "express";
import { pool } from "../db.js";
import { broadcast } from "../ws.js";
import { requireAuth, requireGM } from "../auth.js";

// Generic key/value settings store (GM-configured app-wide config, e.g.
// which sourcebooks the table owns). Readable by any logged-in user (the
// Compendium's default filter applies to players too); only the GM can
// change settings.
const r = Router();

r.get("/:key", requireAuth, async (req, res) => {
  const { rows } = await pool.query("SELECT value FROM settings WHERE key=$1", [req.params.key]);
  res.json({ key: req.params.key, value: rows[0]?.value ?? null });
});

r.put("/:key", requireGM, async (req, res) => {
  const value = req.body?.value ?? null;
  await pool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [req.params.key, JSON.stringify(value)]
  );
  broadcast("settings:updated", { key: req.params.key, value });
  res.json({ key: req.params.key, value });
});

export default r;
