import { Router } from "express";
import { pool } from "../db.js";
import { requireGM } from "../auth.js";

// Manual hand-validation workflow over aon_entries (see
// migrations/010_aon_review.sql). GM-only: this edits the live rules data
// the whole table relies on, not just browses it like /api/aon does.
// A re-run of scripts/import-aon-cache.js only overwrites
// source/url/data/mechanics, never the review_* columns, so review
// progress survives re-imports (but a changed AoN source page won't
// re-flag itself — spot-check after a re-import of a category you've
// already reviewed).
const r = Router();
r.use(requireGM);

r.get("/stats", async (_req, res) => {
  const { rows } = await pool.query(
    `SELECT category,
            count(*)::int AS total,
            count(*) FILTER (WHERE review_status = 'approved')::int AS approved,
            count(*) FILTER (WHERE review_status = 'flagged')::int AS flagged,
            count(*) FILTER (WHERE review_status = 'unreviewed')::int AS unreviewed
     FROM aon_entries GROUP BY category ORDER BY category`
  );
  res.json(rows);
});

r.get("/", async (req, res) => {
  const { category, source, status, q } = req.query;
  const conditions = [];
  const params = [];

  if (category) {
    params.push(category);
    conditions.push(`category = $${params.length}`);
  }
  if (source) {
    params.push(source);
    conditions.push(`source = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`review_status = $${params.length}`);
  }
  if (q) {
    params.push(`%${q}%`);
    conditions.push(`name ILIKE $${params.length}`);
  }

  const where = conditions.length ? `WHERE ${conditions.join(" AND ")}` : "";
  const limit = Math.min(Number(req.query.limit) || 200, 5000);
  params.push(limit);

  const { rows } = await pool.query(
    `SELECT id, category, name, source, url, review_status, review_notes, reviewed_by, reviewed_at
     FROM aon_entries ${where} ORDER BY name LIMIT $${params.length}`,
    params
  );
  res.json(rows);
});

r.get("/:id", async (req, res) => {
  const { rows } = await pool.query("SELECT * FROM aon_entries WHERE id=$1", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "not found" });
  res.json(rows[0]);
});

// Partial update: any of data/mechanics (corrections found during review)
// and/or review_status/review_notes (the verdict). Whatever fields are
// present in the body are the ones written; omitted fields are untouched.
r.patch("/:id", async (req, res) => {
  const { data, mechanics, review_status, review_notes } = req.body || {};
  const sets = [];
  const params = [];

  if (data !== undefined) {
    params.push(JSON.stringify(data));
    sets.push(`data = $${params.length}`);
  }
  if (mechanics !== undefined) {
    params.push(JSON.stringify(mechanics));
    sets.push(`mechanics = $${params.length}`);
  }
  if (review_status !== undefined) {
    if (!["unreviewed", "approved", "flagged"].includes(review_status)) {
      return res.status(400).json({ error: "invalid review_status" });
    }
    params.push(review_status);
    sets.push(`review_status = $${params.length}`);
    params.push(req.user.username);
    sets.push(`reviewed_by = $${params.length}`);
    sets.push(`reviewed_at = now()`);
  }
  if (review_notes !== undefined) {
    params.push(review_notes);
    sets.push(`review_notes = $${params.length}`);
  }

  if (!sets.length) return res.status(400).json({ error: "nothing to update" });

  params.push(req.params.id);
  const { rows } = await pool.query(
    `UPDATE aon_entries SET ${sets.join(", ")} WHERE id = $${params.length} RETURNING *`,
    params
  );
  if (!rows[0]) return res.status(404).json({ error: "not found" });
  res.json(rows[0]);
});

export default r;
