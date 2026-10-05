import { Router } from "express";
import { pool } from "../db.js";
import { requireGM } from "../auth.js";
import { z } from "zod";
import { broadcast } from "../ws.js";
import { setZod } from "../../../galaxy-core/tools/zod.js";

// Fantasy Atlas (/fantasy, Docs/16-fantasy-maps.md) — a public, stand-alone
// feature reached only by direct link. Each map is one JSON document edited
// whole by the GM, saved with an optimistic version check like the galaxy
// project. Anyone (no login) can read a map marked public (`playerVisible`),
// with hidden items and GM notes stripped; only the GM lists, writes or
// deletes maps.
const r = Router();

const COLLECTIONS = ["settlements", "pois", "roads", "rivers", "labels", "events"];

function forPublic(data) {
  const out = { ...data };
  for (const k of COLLECTIONS) out[k] = (data[k] || []).filter((e) => !e.hidden).map(({ gmNotes: _n, ...e }) => e);
  delete out.gmNotes;
  delete out.underlay; // the GM's tracing layer (draft picture)
  // books: hidden books and chapters (not written yet, spoilers) stay GM-only
  out.books = (data.books || []).filter((b) => !b.hidden).map((b) => ({ ...b, chapters: (b.chapters || []).filter((c) => !c.hidden) }));
  return out;
}

const isMap = (d) => d && typeof d === "object" && Number.isInteger(d.w) && Number.isInteger(d.h) && d.terrain && typeof d.terrain === "object";

r.get("/", requireGM, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, name, version, updated_at, COALESCE((data->>'playerVisible')::boolean, false) AS player_visible FROM fantasy_maps ORDER BY updated_at DESC",
  );
  res.json(rows);
});

// public: no login needed
r.get("/:id", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM fantasy_maps WHERE id = $1", [Number(req.params.id) || 0]);
  const m = rows[0];
  if (!m) return res.status(404).json({ error: "no such map" });
  if (req.user?.role !== "gm") {
    if (!m.data.playerVisible) return res.status(404).json({ error: "no such map" });
    return res.json({ id: m.id, name: m.name, version: m.version, updated_at: m.updated_at, data: forPublic(m.data) });
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

// ---------------------------------------------------------------------------
// MCP tools (galaxy-core/fantasy/tools.js), run here against the stored map
// like the galaxy tools; one at a time, saved with a version bump when they
// change something, broadcast like an editor save.
setZod(z);
let toolDefs = null;
async function tools() {
  if (!toolDefs) toolDefs = (await import("../../../galaxy-core/fantasy/tools.js")).fantasyTools();
  return toolDefs;
}
const PUBLIC = (process.env.SIT_PUBLIC_URL || "").replace(/\/$/, "");
function linkFor(mapId, params = {}) {
  const q = new URLSearchParams({ map: String(mapId), ...params });
  return `${PUBLIC}/fantasy?${q.toString().replace(/%3A/g, ":")}`;
}
const result = (data) => ({ content: [{ type: "text", text: JSON.stringify(data, null, 2) }] });
const errorResult = (msg) => ({ content: [{ type: "text", text: msg }], isError: true });

let chain = Promise.resolve();
function queue(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

r.get("/tools/list", requireGM, async (_req, res) => res.json((await tools()).map(({ name, description, scope }) => ({ name, description, scope }))));

r.post("/tool/:name", requireGM, async (req, res) => {
  const t = (await tools()).find((x) => x.name === req.params.name);
  if (!t) return res.status(404).json({ error: `unknown fantasy tool: ${req.params.name}` });
  let input;
  try { input = z.object(t.shape).parse(req.body || {}); } catch (err) { return res.status(400).json({ error: "invalid arguments", issues: err.issues }); }
  try {
    const out = await queue(async () => {
      if (t.scope === "global") {
        const host = {
          link: linkFor,
          listMaps: async () => (await pool.query(
            `SELECT id, name, version, updated_at, COALESCE((data->>'playerVisible')::boolean, false) AS public,
                    data->>'w' AS w, data->>'kmPerCell' AS kpc, jsonb_array_length(COALESCE(data->'settlements','[]')) AS settlements,
                    jsonb_array_length(COALESCE(data->'events','[]')) AS events
             FROM fantasy_maps ORDER BY updated_at DESC`)).rows.map((m) => ({ id: m.id, name: m.name, public: m.public, width_km: Math.round(Number(m.w) * Number(m.kpc)), settlements: Number(m.settlements), events: Number(m.events), updated_at: m.updated_at, link: linkFor(m.id) })),
          createMap: async (data) => {
            const { rows } = await pool.query("INSERT INTO fantasy_maps (name, data) VALUES ($1, $2) RETURNING id, version", [data.name, JSON.stringify(data)]);
            broadcast("fantasy:updated", { id: rows[0].id, version: rows[0].version, source: "tool" });
            return rows[0];
          },
        };
        return { res: result(await t.run(input, host)) };
      }
      const { rows } = input.mapId != null
        ? await pool.query("SELECT * FROM fantasy_maps WHERE id = $1", [input.mapId])
        : await pool.query("SELECT * FROM fantasy_maps ORDER BY updated_at DESC LIMIT 1");
      const m = rows[0];
      if (!m) return { res: errorResult(input.mapId != null ? `No map ${input.mapId}.` : "No fantasy map yet — use generate_map.") };
      const map = { events: [], books: [], ...m.data };
      const out2 = t.run(input, { map, id: m.id, link: (p) => linkFor(m.id, p) });
      if (out2.map) {
        const saved = await pool.query(
          "UPDATE fantasy_maps SET data = $2, name = $3, version = version + 1, updated_at = now() WHERE id = $1 RETURNING version",
          [m.id, JSON.stringify(out2.map), out2.map.name || m.name],
        );
        broadcast("fantasy:updated", { id: m.id, version: saved.rows[0].version, source: "tool" });
      }
      return { res: result(out2.result) };
    });
    res.json(out.res);
  } catch (err) {
    res.json(errorResult(err.message || String(err)));
  }
});

export default r;
