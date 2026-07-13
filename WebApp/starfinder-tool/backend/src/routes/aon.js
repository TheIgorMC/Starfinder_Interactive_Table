import { Router } from "express";
import { pool } from "../db.js";
import { requireAuth } from "../auth.js";

// Read-only search/browse over the aon_entries table populated by
// scripts/import-aon-cache.js. Supports filtering by category, by source
// book, and free-text search over the name. Rules reference, not GM-only,
// but still requires being logged in as someone (GM or player).
const r = Router();
r.use(requireAuth);

r.get("/categories", async (_req, res) => {
  const { rows } = await pool.query(
    "SELECT category, count(*)::int AS count FROM aon_entries GROUP BY category ORDER BY category"
  );
  res.json(rows);
});

r.get("/sources", async (req, res) => {
  const params = [];
  let where = "";
  if (req.query.category) {
    params.push(req.query.category);
    where = "WHERE category = $1";
  }
  const { rows } = await pool.query(
    `SELECT source, count(*)::int AS count FROM aon_entries ${where}
     GROUP BY source ORDER BY source`,
    params
  );
  res.json(rows);
});

r.get("/", async (req, res) => {
  const { category, categories, source, sources, q } = req.query;
  const conditions = [];
  const params = [];

  if (category) {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  } else if (categories) {
    // comma-separated list — used by the Compendium's sectioned table view,
    // where one section (e.g. "Armor") spans several categories (armor, shield)
    params.push(categories.split(",").map((s) => s.trim()).filter(Boolean));
    conditions.push(`category = ANY($${params.length}::text[])`);
  }
  if (source) {
    params.push(source);
    conditions.push(`source = $${params.length}`);
  } else if (sources) {
    // comma-separated list — used for the GM's "owned sources" default filter
    params.push(sources.split(",").map((s) => s.trim()).filter(Boolean));
    conditions.push(`source = ANY($${params.length}::text[])`);
  }
  if (q) {
    params.push(`%${q}%`);
    conditions.push(`name ILIKE $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  // The largest single section (class/racial/archetype/theme features
  // combined) is ~3,300 rows — the Compendium's table view fetches a whole
  // section at once and sorts/filters client-side, so the cap needs to
  // cover that, not just a search-results page.
  const limit = Math.min(Number(req.query.limit) || 100, 5000);
  params.push(limit);

  const { rows } = await pool.query(
    `SELECT id, category, name, source, url, data, mechanics FROM aon_entries
     ${where} ORDER BY name LIMIT $${params.length}`,
    params
  );
  res.json(rows);
});

r.get("/:id", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM aon_entries WHERE id=$1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "not found" });
  res.json(rows[0]);
});

export default r;
