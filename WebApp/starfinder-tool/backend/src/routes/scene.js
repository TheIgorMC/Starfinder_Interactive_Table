import { Router } from "express";
import { broadcast } from "../ws.js";
import { pool } from "../db.js";
import { requireGM } from "../auth.js";
import { bodyExcerpt } from "../tgn-import.js";
import { stripGmNotes } from "../gm-notes.js";

/*
 * Scene module — controls what non-GM displays are showing and ambient mood.
 *
 * Display channels (each physical screen subscribes to one):
 *   "projector"  — battle map OR scenic image/video
 *   "tablet"     — mood board: characters, scenario art, handouts
 *
 * Scene state is intentionally in-memory: it is ephemeral presentation
 * state, rebuilt at the start of each session. Persistent content
 * (images, planets, maps) lives in /app/content — see docs/06-data-format.md.
 */

const state = {
  projector: { mode: "battlemap", sessionId: null, mediaUrl: "", caption: "" },
  // tablet.mode: "idle" (campaign/chapter homescreen) | "media" (image or
  // looping video) | "npc_narrative" (portrait + name only if the GM has
  // chosen to reveal it — for NPCs the party hasn't formally met) |
  // "npc_boss" (HP shown as a bar, percentage only, never the raw numbers
  // — no metagaming exact HP off the mood tablet).
  tablet: {
    mode: "idle",
    chapterEntryId: null,
    mediaUrl: "", caption: "", loop: false,
    characterIds: [], revealNames: false,
  },
  mood: {
    // mirrored to ESP32 light nodes
    color: "#202040",
    brightness: 128, // 0-255
    effect: "static", // static | pulse | flicker | storm
    name: "",
  },
};

// ESP32 nodes self-register here; GM view lists them.
// { id, name, ip, lastSeen }
const lightNodes = new Map();

const r = Router();

// public — the projector and mood tablet have no login of their own
r.get("/state", (_req, res) => res.json({ ...state, lightNodes: [...lightNodes.values()] }));

// Public summary of only the characters the GM has chosen to feature on the
// mood tablet — deliberately NOT the full /api/characters list (that's
// GM-only) and deliberately only the handful of fields each NPC mode
// actually needs, so an unauthenticated device on the same LAN can't be
// used to pull a real number off it:
//  - npc_narrative: portrait + name, and only if the GM opted to reveal it
//    (revealNames) — otherwise just the face, no name.
//  - npc_boss: portrait + HP as a rounded percentage, never hp_cur/hp_max
//    themselves — a tablet on the table is not the place to read a boss's
//    exact remaining HP.
r.get("/tablet/characters", async (_req, res) => {
  const ids = state.tablet.characterIds || [];
  if (!ids.length) return res.json([]);
  const { rows } = await pool.query(
    `SELECT id, name, portrait_url, hp_cur, hp_max FROM characters WHERE id = ANY($1::int[])`,
    [ids]
  );
  if (state.tablet.mode === "npc_boss") {
    return res.json(rows.map((r) => ({
      id: r.id,
      name: r.name,
      portrait_url: r.portrait_url,
      hp_pct: r.hp_max > 0 ? Math.max(0, Math.min(100, Math.round((r.hp_cur / r.hp_max) * 100))) : 0,
    })));
  }
  if (state.tablet.mode === "npc_narrative") {
    return res.json(rows.map((r) => ({
      id: r.id,
      name: state.tablet.revealNames ? r.name : "",
      portrait_url: r.portrait_url,
    })));
  }
  res.json([]);
});

// Public summary of the one campaign entry (usually the current chapter,
// but any type works — a quest, a location, whatever the GM pushes) the
// GM has chosen as the tablet's idle homescreen — name/preview/first
// image only, same "GM explicitly pushed this" trust model as the media
// channel, not the entry's full body (which may hold GM-only notes/spoilers
// mixed in with the flavor text). The preview is derived from body on the
// spot (bodyExcerpt) rather than a separately stored summary column.
r.get("/tablet/chapter", async (_req, res) => {
  const id = state.tablet.chapterEntryId;
  if (!id) return res.json(null);
  const { rows } = await pool.query(
    `SELECT e.id, e.type, e.name, e.body, m.category AS image_category, m.filename AS image_filename
     FROM campaign_entries e LEFT JOIN media m ON m.id = e.image_id
     WHERE e.id=$1`,
    [id]
  );
  const entry = rows[0];
  if (!entry) return res.json(null);
  // Prefer the entry's own Image field (picked from the media library in
  // the editor) — fall back to the first markdown image embedded in the
  // body, for entries authored before that field existed or imported from
  // Tangent (whose blurbs carry inline images this way).
  let imageUrl = entry.image_category ? `/api/media/files/${entry.image_category}/${entry.image_filename}` : "";
  if (!imageUrl) {
    const imageMatch = stripGmNotes(entry.body).match(/!\[[^\]]*\]\(([^)]+)\)/);
    imageUrl = imageMatch?.[1] || "";
  }
  res.json({ id: entry.id, type: entry.type, name: entry.name, summary: bodyExcerpt(entry.body), imageUrl });
});

// GM sets what a channel shows
r.post("/channel/:name", requireGM, (req, res) => {
  const ch = state[req.params.name];
  if (!ch) return res.status(404).json({ error: "unknown channel" });
  Object.assign(ch, req.body ?? {});
  broadcast("scene:channel", { channel: req.params.name, state: ch });
  res.json(ch);
});

// GM sets mood (broadcast to browsers AND polled by ESP32 nodes)
r.post("/mood", requireGM, (req, res) => {
  Object.assign(state.mood, req.body ?? {});
  broadcast("scene:mood", state.mood);
  res.json(state.mood);
});

// --- ESP32 endpoints -------------------------------------------------
// Nodes POST here every ~10s: { id, name }
r.post("/lights/register", (req, res) => {
  const { id, name = "light" } = req.body ?? {};
  if (!id) return res.status(400).json({ error: "id required" });
  lightNodes.set(id, { id, name, ip: req.ip, lastSeen: Date.now() });
  res.json({ ok: true });
});

// Nodes GET current mood (simple polling keeps firmware trivial;
// WS on-device optional later)
r.get("/lights/mood", (_req, res) => res.json(state.mood));

export default r;
