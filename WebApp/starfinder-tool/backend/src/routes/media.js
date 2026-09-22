import { Router } from "express";
import express from "express";
import multer from "multer";
import crypto from "node:crypto";
import path from "node:path";
import { unlink } from "node:fs/promises";
import { pool } from "../db.js";
import { requireAuth, requireGM } from "../auth.js";
import { isSunoPageUrl, resolveSunoAudio } from "../suno-resolve.js";

const CATEGORIES = ["map", "mood", "token", "portrait", "music", "sfx"];
const LINK_CATEGORIES = ["music", "sfx"];
const ROOT = process.env.UPLOADS_DIR || "/app/uploads";

const storage = multer.diskStorage({
  destination: (req, _file, cb) => cb(null, path.join(ROOT, req.params.category)),
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
  const { rows } = await pool.query(
    `INSERT INTO media (category, filename, original_name, label) VALUES ($1,$2,$3,$4) RETURNING *`,
    [req.params.category, req.file.filename, req.file.originalname, req.body?.label || ""]
  );
  res.status(201).json(withUrl(rows[0]));
});

// Link-based track (YouTube, Suno, a direct audio URL, ...) — no file
// upload, just a URL the player embeds/streams directly. Only meaningful
// for music/sfx; the image/video categories are always real uploads.
r.post("/:category/link", requireGM, async (req, res) => {
  if (!LINK_CATEGORIES.includes(req.params.category)) return res.status(400).json({ error: "links only supported for music/sfx" });
  let url = (req.body?.url || "").trim();
  if (!url) return res.status(400).json({ error: "url required" });

  // A suno.com/s/... or /song/... link is the share PAGE, not a playable
  // file — <audio src> against it just fails. Resolve it server-side to the
  // actual CDN mp3 once, up front, so the GM gets a clear error immediately
  // if that ever breaks (Suno changes their page) instead of a silently
  // dead player later.
  let sourceUrl = null;
  if (isSunoPageUrl(url)) {
    try {
      sourceUrl = url;
      url = await resolveSunoAudio(url);
    } catch (err) {
      return res.status(502).json({ error: `Suno link: ${err.message}` });
    }
  }

  const { rows } = await pool.query(
    `INSERT INTO media (category, url, source_url, label, loop) VALUES ($1,$2,$3,$4,$5) RETURNING *`,
    [req.params.category, url, sourceUrl, req.body?.label || "", !!req.body?.loop]
  );
  res.status(201).json(withUrl(rows[0]));
});

r.patch("/:id", requireGM, async (req, res) => {
  const fields = [];
  const params = [];
  for (const key of ["label", "loop"]) {
    if (req.body?.[key] === undefined) continue;
    params.push(req.body[key]);
    fields.push(`${key} = $${params.length}`);
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
