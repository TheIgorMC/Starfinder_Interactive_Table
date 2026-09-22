import { Router } from "express";
import express from "express";
import multer from "multer";
import crypto from "node:crypto";
import path from "node:path";
import { mkdir, unlink } from "node:fs/promises";
import { pool } from "../db.js";
import { requireAuth, requireGM } from "../auth.js";

const CATEGORIES = ["map", "mood", "token", "portrait", "music", "sfx"];
const LINK_CATEGORIES = ["music", "sfx"];
const ROOT = process.env.UPLOADS_DIR || "/app/uploads";

const storage = multer.diskStorage({
  // The uploads dir is a bind mount (see docker-compose.yml) that only
  // ever had map/mood/token/portrait created in it by hand at deploy time
  // — a newly added category (like music/sfx) has no subfolder yet on an
  // existing deployment, and multer's diskStorage doesn't create one
  // itself (ENOENT). Create it on first use instead of requiring a manual
  // mkdir on the host for every future category.
  destination: (req, _file, cb) => {
    const dir = path.join(ROOT, req.params.category);
    mkdir(dir, { recursive: true }).then(() => cb(null, dir)).catch((err) => cb(err));
  },
  filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage,
  // 80MB — small for a map/portrait/token image, but the "mood" category
  // also doubles as looping scenic video for the tablet (Tablet.jsx), and
  // "music"/"sfx" hold uploaded audio, so this stays generous.
  limits: { fileSize: 80 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => cb(null, /^(image|video|audio)\//.test(file.mimetype)),
});

const r = Router();

// "combat, tense , combat" -> ["combat", "tense"] — trimmed, deduped, blanks
// dropped. Same normalization on write regardless of upload/link/patch, so
// the tag list shown as filter chips never carries a stray empty or
// duplicate entry.
function normalizeTags(tags) {
  if (!Array.isArray(tags)) return undefined;
  return [...new Set(tags.map((t) => String(t).trim()).filter(Boolean))];
}

// Serves uploaded files directly — public, like the battle map itself these
// are images meant to be visible to the whole table (projector, tablet),
// not sensitive data.
r.use("/files", express.static(ROOT));

r.get("/", requireAuth, async (req, res) => {
  const params = [];
  let where = "";
  if (req.query.category) {
    params.push(req.query.category);
    where = "WHERE category = $1";
  }
  const { rows } = await pool.query(
    `SELECT * FROM media ${where} ORDER BY uploaded_at DESC`,
    params
  );
  res.json(rows.map(withUrl));
});

r.post("/:category", requireGM, (req, res, next) => {
  if (!CATEGORIES.includes(req.params.category)) return res.status(400).json({ error: "unknown category" });
  upload.single("file")(req, res, (err) => {
    if (err) return res.status(400).json({ error: err.message });
    next();
  });
}, async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "file required (field name: file)" });
  // multipart fields arrive as strings — "tags" is a comma-separated list
  // from the upload form, not JSON.
  const tags = normalizeTags((req.body?.tags || "").split(",")) || [];
  const { rows } = await pool.query(
    `INSERT INTO media (category, filename, original_name, label, folder, tags) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.params.category, req.file.filename, req.file.originalname, req.body?.label || "", req.body?.folder || "", tags]
  );
  res.status(201).json(withUrl(rows[0]));
});

// Link-based track (YouTube, Suno, a direct audio URL, ...) — no file
// upload, just a URL the player embeds/streams directly. Only meaningful
// for music/sfx; the image/video categories are always real uploads.
r.post("/:category/link", requireGM, async (req, res) => {
  if (!LINK_CATEGORIES.includes(req.params.category)) return res.status(400).json({ error: "links only supported for music/sfx" });
  const url = (req.body?.url || "").trim();
  if (!url) return res.status(400).json({ error: "url required" });
  const tags = normalizeTags(req.body?.tags) || [];
  const { rows } = await pool.query(
    `INSERT INTO media (category, url, label, loop, folder, tags) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [req.params.category, url, req.body?.label || "", !!req.body?.loop, req.body?.folder || "", tags]
  );
  res.status(201).json(withUrl(rows[0]));
});

r.patch("/:id", requireGM, async (req, res) => {
  const fields = [];
  const params = [];
  for (const key of ["label", "loop", "folder"]) {
    if (req.body?.[key] === undefined) continue;
    params.push(req.body[key]);
    fields.push(`${key} = $${params.length}`);
  }
  if (req.body?.tags !== undefined) {
    const tags = normalizeTags(req.body.tags);
    if (tags === undefined) return res.status(400).json({ error: "tags must be an array of strings" });
    params.push(tags);
    fields.push(`tags = $${params.length}`);
  }
  if (!fields.length) return res.status(400).json({ error: "nothing to update" });
  params.push(req.params.id);
  const { rows } = await pool.query(`UPDATE media SET ${fields.join(", ")} WHERE id=$${params.length} RETURNING *`, params);
  if (!rows[0]) return res.status(404).json({ error: "not found" });
  res.json(withUrl(rows[0]));
});

r.delete("/:id", requireGM, async (req, res) => {
  const { rows } = await pool.query("DELETE FROM media WHERE id=$1 RETURNING *", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "not found" });
  if (rows[0].filename) await unlink(path.join(ROOT, rows[0].category, rows[0].filename)).catch(() => {});
  res.status(204).end();
});

function withUrl(row) {
  if (!row.filename) return { ...row };
  return { ...row, url: `/api/media/files/${row.category}/${row.filename}` };
}

export default r;
