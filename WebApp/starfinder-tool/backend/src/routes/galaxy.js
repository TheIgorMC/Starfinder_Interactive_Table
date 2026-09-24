import { Router } from "express";
import multer from "multer";
import { pool } from "../db.js";
import { requireAuth, requireGM } from "../auth.js";

// GalaxyGen project import (Docs/10-galaxy-mapgen.md) — a read-only
// reference layer SIT never writes back into. The GM re-imports the whole
// project file to update it; only the most recently imported one is
// "current". campaign_entries.galaxy_ref (migrations/020) is the only link
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

export default r;
