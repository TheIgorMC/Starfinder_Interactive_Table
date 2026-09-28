import { Router } from "express";
import multer from "multer";
import { pool } from "../db.js";
import { requireAuth, requireGM } from "../auth.js";
import { z } from "zod";
import { buildCompact } from "../../../galaxy-core/lib/compact.js";
import { broadcast } from "../ws.js";
import { setZod } from "../../../galaxy-core/tools/zod.js";
import { runTool, listTools } from "../../../galaxy-core/tools/runner.js";

setZod(z);

// The campaign's galaxy project (Docs/10-galaxy-mapgen.md). Edited in place
// by the Galaxy Editor (GM console) and the galaxy MCP tools — PUT /project
// and POST /tool/:name, both versioned; a whole-file re-import still works
// and starts a new "current" project. campaign_entries.galaxy_ref (migrations/020) is the only link
// between this and the lore wiki — entities that only exist here never get
// a campaign_entries row of their own.
const r = Router();

// In-memory, not disk — a galaxy project is plain JSON, a few MB at most,
// parsed once and stored in Postgres; never needs to persist as a file.
const uploadJson = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

const KINDS = ["system", "sector", "faction", "actor", "organization", "company", "shipModel"];
// project key -> { kind, idField } — idField is what a ref's second half is built from.
const COLLECTIONS = {
  systems: { kind: "system", idField: "slug" },
  sectors: { kind: "sector", idField: "slug" },
  factions: { kind: "faction", idField: "slug" },
  actors: { kind: "actor", idField: "slug" },
  organizations: { kind: "organization", idField: "slug" },
  companies: { kind: "company", idField: "slug" },
  shipModels: { kind: "shipModel", idField: "slug" },
};

async function currentProject() {
  const { rows } = await pool.query("SELECT * FROM galaxy_projects ORDER BY imported_at DESC LIMIT 1");
  return rows[0] || null;
}

function findByRef(data, ref) {
  if (!ref || typeof ref !== "string") return null;
  const i = ref.indexOf(":");
  if (i < 0) return null;
  const kind = ref.slice(0, i);
  const id = ref.slice(i + 1);
  const collKey = Object.keys(COLLECTIONS).find((k) => COLLECTIONS[k].kind === kind);
  if (!collKey) return null;
  const list = data[collKey] || [];
  return list.find((e) => e.slug === id) || null;
}

r.get("/", requireAuth, async (req, res) => {
  const project = await currentProject();
  if (!project) return res.json(null);
  const d = project.data;
  res.json({
    id: project.id,
    name: project.name,
    seed: project.seed,
    imported_at: project.imported_at,
    counts: Object.fromEntries(Object.keys(COLLECTIONS).map((k) => [k, (d[k] || []).length])),
  });
});

// The exact project JSON as it was last imported, for the GM to pull down,
// edit in GalaxyGen (or by hand) and re-import — a round trip, not a
// partial export. Filename mirrors the stored name so re-uploading the
// same file is obvious.
r.get("/export", requireAuth, async (req, res) => {
  const project = await currentProject();
  if (!project) return res.status(404).json({ error: "no galaxy project imported" });
  const filename = `${project.name.replace(/[^a-z0-9_-]+/gi, "_")}.json`;
  res.setHeader("Content-Disposition", `attachment; filename="${filename}"`);
  res.setHeader("Content-Type", "application/json");
  res.send(JSON.stringify(project.data));
});

r.post("/import", requireGM, uploadJson.single("file"), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "no file" });
  let data;
  try {
    data = JSON.parse(req.file.buffer.toString("utf8"));
  } catch {
    return res.status(400).json({ error: "not valid JSON" });
  }
  if (!Array.isArray(data.systems) || !Array.isArray(data.factions)) {
    return res.status(400).json({ error: "doesn't look like a GalaxyGen project (missing systems/factions arrays)" });
  }
  const name = req.body.name || req.file.originalname.replace(/\.json$/i, "");
  const { rows } = await pool.query(
    "INSERT INTO galaxy_projects (name, seed, data) VALUES ($1, $2, $3) RETURNING id, name, seed, imported_at",
    [name, data.seed || null, JSON.stringify(data)]
  );
  broadcast("galaxy:updated", { id: rows[0].id, version: 1, source: "import" });
  res.status(201).json(rows[0]);
});

// Compact index for browsing/search/link-picking — every entity as
// {ref, kind, name, ...a few cheap fields}, never the full record (systems
// carry bodies/hyperlanes, actors carry reputation, etc. — too much for a
// list view).
r.get("/index", requireAuth, async (req, res) => {
  const project = await currentProject();
  if (!project) return res.json([]);
  const d = project.data;
  const out = [];
  for (const s of d.systems || []) {
    out.push({ ref: `system:${s.slug}`, kind: "system", name: s.name, sector: s.sector, important: s.important });
  }
  for (const s of d.sectors || []) {
    out.push({ ref: `sector:${s.slug}`, kind: "sector", name: s.name, focus: s.focus });
  }
  for (const f of d.factions || []) {
    out.push({ ref: `faction:${f.slug}`, kind: "faction", name: f.name, government: f.government });
  }
  for (const a of d.actors || []) {
    out.push({ ref: `actor:${a.slug}`, kind: "actor", name: a.name, role: a.role, origin: a.origin, location: a.location });
  }
  for (const o of d.organizations || []) {
    out.push({ ref: `organization:${o.slug}`, kind: "organization", name: o.name, ideology: o.ideology });
  }
  for (const c of d.companies || []) {
    out.push({ ref: `company:${c.slug}`, kind: "company", name: c.name, role: c.role });
  }
  res.json(out);
});

r.get("/entity/:ref", requireAuth, async (req, res) => {
  const project = await currentProject();
  if (!project) return res.status(404).json({ error: "no galaxy project imported" });
  const entity = findByRef(project.data, req.params.ref);
  if (!entity) return res.status(404).json({ error: "not found" });
  res.json(entity);
});

// Which campaign_entries already link to a galaxy ref, keyed by ref, so
// the browser can show "linked to <lore entry>" without an N+1 lookup.
r.get("/links", requireAuth, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT id, name, type, galaxy_ref FROM campaign_entries WHERE galaxy_ref IS NOT NULL"
  );
  res.json(rows);
});

// Compact geometry for the map view — positions/polygons/edges only, not
// full entity detail (the index endpoint already covers browsing). Small
// enough for a 375-system galaxy to ship in one response.
r.get("/map", requireAuth, async (req, res) => {
  const project = await currentProject();
  if (!project) return res.json(null);
  const d = project.data;
  res.json({
    bounds: d.bounds,
    systems: (d.systems || []).map((s) => ({
      ref: `system:${s.slug}`,
      name: s.name,
      x: s.position?.x,
      y: s.position?.y,
      sector: s.sector,
      important: s.important || 0,
      owner: s.control?.owner || null,
    })),
    sectors: (d.sectors || []).map((s) => ({ ref: `sector:${s.slug}`, name: s.name, focus: s.focus, points: s.points })),
    hyperlanes: (d.hyperlanes || []).map((h) => ({ a: h.aSlug, b: h.bSlug, risk: h.risk })),
    factions: (d.factions || []).map((f) => ({ ref: `faction:${f.slug}`, name: f.name, color: f.color })),
  });
});

// Short-keyed payload for the full-screen galaxy viewer (frontend/src/galaxy/)
// — every system with its bodies/sites, lanes as index tuples, the security
// and population fields. Hidden districts are stripped for players here, so
// they never reach a player's browser. Cached per project + role: a project
// only changes on re-import, which gets a new id.
const compactCache = new Map();
r.get("/compact", requireAuth, async (req, res) => {
  const project = await currentProject();
  if (!project) return res.json(null);
  const gm = req.user.role === "gm";
  const key = `${project.id}:${project.version}:${gm}`;
  if (!compactCache.has(key)) {
    for (const k of compactCache.keys()) if (!k.startsWith(`${project.id}:${project.version}:`)) compactCache.delete(k);
    compactCache.set(key, JSON.stringify({ ...buildCompact(project.data, { gm }), name: project.name }));
  }
  res.setHeader("Content-Type", "application/json");
  res.send(compactCache.get(key));
});

// ---------------------------------------------------------------------------
// Edit in place (Galaxy Editor + MCP tools)

// Full project for the editor, plus the version the next save must be based on.
r.get("/project", requireGM, async (req, res) => {
  const project = await currentProject();
  if (!project) return res.json(null);
  res.json({ id: project.id, name: project.name, version: project.version, updated_at: project.updated_at, data: project.data });
});

async function saveProject(project, data, name) {
  if (!project) {
    const { rows } = await pool.query(
      "INSERT INTO galaxy_projects (name, seed, data) VALUES ($1, $2, $3) RETURNING id, name, version, updated_at",
      [name || "Galaxy", data.seed || null, JSON.stringify(data)]
    );
    return rows[0];
  }
  const { rows } = await pool.query(
    `UPDATE galaxy_projects SET data = $2, seed = $3, name = COALESCE($4, name), version = version + 1, updated_at = now()
     WHERE id = $1 AND version = $5 RETURNING id, name, version, updated_at`,
    [project.id, JSON.stringify(data), data.seed || null, name || null, project.version]
  );
  return rows[0] || null; // null = someone saved in between
}

// Save the whole project. `baseVersion` = the version the client loaded;
// a mismatch means someone else (another tab, an MCP tool) saved meanwhile → 409.
r.put("/project", requireGM, async (req, res) => {
  const { data, baseVersion, name } = req.body || {};
  if (!data || !Array.isArray(data.systems) || !data.bounds) return res.status(400).json({ error: "not a galaxy project (missing systems/bounds)" });
  const saved = await queue(async () => {
    const project = await currentProject();
    if (project && baseVersion !== project.version) return { conflict: project.version };
    return saveProject(project, data, name);
  });
  if (!saved || saved.conflict) return res.status(409).json({ error: "the galaxy was changed elsewhere — reload before saving", version: saved?.conflict });
  broadcast("galaxy:updated", { id: saved.id, version: saved.version, source: "editor" });
  res.json(saved);
});

// Galaxy MCP tools (galaxy-core/tools), executed here against the stored
// project so the MCP server stays a thin proxy like every other tool.
r.get("/tools", requireGM, async (_req, res) => res.json(await listTools()));

r.post("/tool/:name", requireGM, async (req, res) => {
  try {
    const out = await queue(async () => {
      const project = await currentProject();
      const { result, project: next, dirty } = await runTool(z, project?.data || null, req.params.name, req.body);
      let saved = null;
      if (dirty && next && !result?.isError) saved = await saveProject(project, next);
      return { result, saved };
    });
    if (out.saved) broadcast("galaxy:updated", { id: out.saved.id, version: out.saved.version, source: "tool" });
    res.json(out.result);
  } catch (err) {
    if (err?.name === "ZodError") return res.status(400).json({ error: "invalid arguments", issues: err.issues });
    if (err?.status) return res.status(err.status).json({ error: err.message });
    console.error(err);
    res.status(500).json({ error: err.message || "tool failed" });
  }
});

// Every read-modify-write of the project goes through here, one at a time.
let chain = Promise.resolve();
function queue(fn) {
  const run = chain.then(fn, fn);
  chain = run.catch(() => {});
  return run;
}

export default r;
