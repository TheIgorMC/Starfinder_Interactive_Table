import { Router } from "express";
import express from "express";
import multer from "multer";
import crypto from "node:crypto";
import path from "node:path";
import { unlink } from "node:fs/promises";
import { pool } from "../db.js";
import { requireAuth, requireGM } from "../auth.js";

const CATEGORIES = ["map", "mood", "token", "portrait"];
const ROOT = process.env.UPLOADS_DIR || "/app/uploads";

const storage = multer.diskStorage({
  destination: (req, _file, cb) => cb(null, path.join(ROOT, req.params.category)),
  filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname)}`),
});
const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 }, // 15MB — plenty for a map/portrait image
  fileFilter: (_req, file, cb) => cb(null, /^image\//.test(file.mimetype)),
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

r.delete("/:id", requireGM, async (req, res) => {
  const { rows } = await pool.query("DELETE FROM media WHERE id=$1 RETURNING *", [req.params.id]);
  if (!rows[0]) return res.status(404).json({ error: "not found" });
  await unlink(path.join(ROOT, rows[0].category, rows[0].filename)).catch(() => {});
  res.status(204).end();
});

function withUrl(row) {
  return { ...row, url: `/api/media/files/${row.category}/${row.filename}` };
}

export default r;
