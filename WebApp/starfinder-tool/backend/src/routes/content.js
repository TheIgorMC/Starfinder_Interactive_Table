import { Router } from "express";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import express from "express";

/*
 * Content module — reads standardized data packs produced by offline
 * creator tools. Contract defined in docs/06-data-format.md.
 *
 * Layout on disk (mounted at /app/content):
 *   content/
 *     planets/<slug>/entry.json  (+ assets referenced relatively)
 *     maps/<slug>/entry.json
 *     handouts/<slug>/entry.json
 *     ...any future category
 *
 * The backend is category-agnostic: any directory under content/ is a
 * category, any subdirectory containing entry.json is an entry.
 */

const ROOT = process.env.CONTENT_DIR || "/app/content";
const r = Router();

// static assets (images etc.) referenced by entries
r.use("/assets", express.static(ROOT));

r.get("/categories", async (_req, res) => {
  try {
    const dirs = await readdir(ROOT, { withFileTypes: true });
    res.json(dirs.filter((d) => d.isDirectory()).map((d) => d.name));
  } catch {
    res.json([]);
  }
});

r.get("/:category", async (req, res) => {
  const dir = path.join(ROOT, path.basename(req.params.category));
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const out = [];
    for (const e of entries.filter((e) => e.isDirectory())) {
      try {
        const raw = await readFile(path.join(dir, e.name, "entry.json"), "utf8");
        const data = JSON.parse(raw);
        out.push({ slug: e.name, ...data });
      } catch { /* skip malformed entry */ }
    }
    res.json(out);
  } catch {
    res.status(404).json({ error: "unknown category" });
  }
});

r.get("/:category/:slug", async (req, res) => {
  const file = path.join(
    ROOT,
    path.basename(req.params.category),
    path.basename(req.params.slug),
    "entry.json"
  );
  try {
    const data = JSON.parse(await readFile(file, "utf8"));
    res.json({ slug: req.params.slug, ...data });
  } catch {
    res.status(404).json({ error: "not found" });
  }
});

export default r;
