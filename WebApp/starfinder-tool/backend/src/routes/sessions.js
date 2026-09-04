import { Router } from "express";
import { pool } from "../db.js";
import { broadcast } from "../ws.js";
import { requireGM } from "../auth.js";

// Session planning — a GM-facing container tying together which lore
// (campaign_entries), media, and prebuilt battle encounters (battle_sessions)
// are relevant to a specific table night. See migrations/009_game_sessions.sql
// for why this isn't just another campaign_entries type.
//
// GM-only end to end (read + write): unlike the Campaign system, planning
// content has no player-visible half — it's a GM prep tool.
const r = Router();
r.use(requireGM);

async function loadFull(id) {
  const { rows } = await pool.query("SELECT * FROM game_sessions WHERE id=$1", [id]);
  const session = rows[0];
  if (!session) return null;

  const [entries, media, encounters] = await Promise.all([
    pool.query(
      `SELECT e.id, e.type, e.name, e.summary
       FROM game_session_entries se JOIN campaign_entries e ON e.id = se.entry_id
       WHERE se.session_id = $1 ORDER BY e.type, e.name`,
      [id]
    ),
    pool.query(
      `SELECT m.id, m.category, m.filename, m.original_name, m.label
       FROM game_session_media sm JOIN media m ON m.id = sm.media_id
       WHERE sm.session_id = $1 ORDER BY m.category, m.label`,
      [id]
    ),
    pool.query(
      `SELECT b.id, b.name, b.map_url
       FROM game_session_encounters se JOIN battle_sessions b ON b.id = se.battle_session_id
       WHERE se.session_id = $1 ORDER BY b.id`,
      [id]
    ),
  ]);

  return {
    ...session,
    entries: entries.rows,
    media: media.rows.map((m) => ({ ...m, url: `/api/media/files/${m.category}/${m.filename}` })),
    encounters: encounters.rows,
  };
}

r.get("/", async (_req, res) => {
  const { rows } = await pool.query("SELECT * FROM game_sessions ORDER BY id DESC");
  res.json(rows);
});

// The currently active session (or null), with its linked ids resolved —
// this is what the GM console's other pickers (Media Library, battle map
// encounter list, Campaign NPC list) filter down to when session filtering
// is on. A single lightweight query set rather than reusing loadFull's
// heavier joined shape, since callers here only need ids.
r.get("/active", async (_req, res) => {
  const { rows } = await pool.query("SELECT * FROM game_sessions WHERE status='active' LIMIT 1");
  const session = rows[0];
  if (!session) return res.json(null);
  const [entries, media, encounters] = await Promise.all([
    pool.query("SELECT entry_id FROM game_session_entries WHERE session_id=$1", [session.id]),
    pool.query("SELECT media_id FROM game_session_media WHERE session_id=$1", [session.id]),
    pool.query("SELECT battle_session_id FROM game_session_encounters WHERE session_id=$1", [session.id]),
  ]);
  res.json({
    ...session,
    entryIds: entries.rows.map((r) => r.entry_id),
    mediaIds: media.rows.map((r) => r.media_id),
    encounterIds: encounters.rows.map((r) => r.battle_session_id),
  });
});

r.get("/:id", async (req, res) => {
  const session = await loadFull(req.params.id);
  if (!session) return res.status(404).json({ error: "not found" });
  res.json(session);
});

r.post("/", async (req, res) => {
  const { name, session_date = "", summary = "", notes = "" } = req.body ?? {};
  if (!name) return res.status(400).json({ error: "name required" });
  const { rows } = await pool.query(
    "INSERT INTO game_sessions (name, session_date, summary, notes) VALUES ($1,$2,$3,$4) RETURNING *",
    [name, session_date, summary, notes]
  );
  res.status(201).json(rows[0]);
});

r.patch("/:id", async (req, res) => {
  const b = req.body ?? {};
  const cols = ["name", "session_date", "summary", "notes", "filter_enabled"].filter((f) => b[f] !== undefined);
  if (!cols.length) return res.status(400).json({ error: "no fields" });
  const sets = cols.map((f, i) => `${f}=$${i + 1}`).join(",");
  const { rows } = await pool.query(
    `UPDATE game_sessions SET ${sets}, updated_at=now() WHERE id=$${cols.length + 1} RETURNING *`,
    [...cols.map((f) => b[f]), req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "not found" });
  broadcast("game_session:updated", rows[0]);
  res.json(rows[0]);
});

r.delete("/:id", async (req, res) => {
  await pool.query("DELETE FROM game_sessions WHERE id=$1", [req.params.id]);
  broadcast("game_session:deleted", { id: Number(req.params.id) });
  res.status(204).end();
});

// Starting a session ends whichever one was active (the DB only allows one
// active row at a time anyway — this just makes the swap explicit and
// avoids a unique-violation 500 on the second POST /start).
r.post("/:id/start", async (req, res) => {
  await pool.query("UPDATE game_sessions SET status='completed', updated_at=now() WHERE status='active' AND id<>$1", [req.params.id]);
  const { rows } = await pool.query(
    "UPDATE game_sessions SET status='active', updated_at=now() WHERE id=$1 RETURNING *",
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "not found" });
  broadcast("game_session:started", rows[0]);
  res.json(rows[0]);
});

r.post("/:id/end", async (req, res) => {
  const { rows } = await pool.query(
    "UPDATE game_sessions SET status='completed', updated_at=now() WHERE id=$1 AND status='active' RETURNING *",
    [req.params.id]
  );
  if (!rows[0]) return res.status(404).json({ error: "not active" });
  broadcast("game_session:ended", rows[0]);
  res.json(rows[0]);
});

// --- links: campaign entries / media / encounters ---

// Every link/unlink broadcasts a lightweight "something about this session
// changed" ping (not the full resolved payload) so useActiveSession() in
// other connected GM tabs/windows refetches /sessions/active and their
// filtered pickers (Media Library, battle map, Campaign) stay live — not
// just the tab that made the change.
function pingSession(id) {
  broadcast("game_session:updated", { id: Number(id) });
}

r.post("/:id/entries", async (req, res) => {
  const { entry_id } = req.body ?? {};
  if (!entry_id) return res.status(400).json({ error: "entry_id required" });
  await pool.query(
    "INSERT INTO game_session_entries (session_id, entry_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
    [req.params.id, entry_id]
  );
  pingSession(req.params.id);
  res.status(201).json(await loadFull(req.params.id));
});

r.delete("/:id/entries/:entryId", async (req, res) => {
  await pool.query("DELETE FROM game_session_entries WHERE session_id=$1 AND entry_id=$2", [req.params.id, req.params.entryId]);
  pingSession(req.params.id);
  res.json(await loadFull(req.params.id));
});

r.post("/:id/media", async (req, res) => {
  const { media_id } = req.body ?? {};
  if (!media_id) return res.status(400).json({ error: "media_id required" });
  await pool.query(
    "INSERT INTO game_session_media (session_id, media_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
    [req.params.id, media_id]
  );
  pingSession(req.params.id);
  res.status(201).json(await loadFull(req.params.id));
});

r.delete("/:id/media/:mediaId", async (req, res) => {
  await pool.query("DELETE FROM game_session_media WHERE session_id=$1 AND media_id=$2", [req.params.id, req.params.mediaId]);
  pingSession(req.params.id);
  res.json(await loadFull(req.params.id));
});

r.post("/:id/encounters", async (req, res) => {
  const { battle_session_id } = req.body ?? {};
  if (!battle_session_id) return res.status(400).json({ error: "battle_session_id required" });
  await pool.query(
    "INSERT INTO game_session_encounters (session_id, battle_session_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
    [req.params.id, battle_session_id]
  );
  pingSession(req.params.id);
  res.status(201).json(await loadFull(req.params.id));
});

r.delete("/:id/encounters/:battleSessionId", async (req, res) => {
  await pool.query("DELETE FROM game_session_encounters WHERE session_id=$1 AND battle_session_id=$2", [req.params.id, req.params.battleSessionId]);
  pingSession(req.params.id);
  res.json(await loadFull(req.params.id));
});

export default r;
