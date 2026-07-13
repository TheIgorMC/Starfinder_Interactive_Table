import { Router } from "express";
import { broadcast } from "../ws.js";

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
  tablet: { mode: "idle", mediaUrl: "", caption: "", characterIds: [] },
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

r.get("/state", (_req, res) => res.json({ ...state, lightNodes: [...lightNodes.values()] }));

// GM sets what a channel shows
r.post("/channel/:name", (req, res) => {
  const ch = state[req.params.name];
  if (!ch) return res.status(404).json({ error: "unknown channel" });
  Object.assign(ch, req.body ?? {});
  broadcast("scene:channel", { channel: req.params.name, state: ch });
  res.json(ch);
});

// GM sets mood (broadcast to browsers AND polled by ESP32 nodes)
r.post("/mood", (req, res) => {
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
