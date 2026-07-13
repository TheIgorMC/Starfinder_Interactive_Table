import pg from "pg";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

export const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function migrate() {
  await pool.query(
    `CREATE TABLE IF NOT EXISTS _migrations (name TEXT PRIMARY KEY, run_at TIMESTAMPTZ DEFAULT now())`
  );
  const dir = path.resolve("migrations");
  const files = (await readdir(dir)).filter((f) => f.endsWith(".sql")).sort();
  for (const f of files) {
    const done = await pool.query("SELECT 1 FROM _migrations WHERE name=$1", [f]);
    if (done.rowCount) continue;
    const sql = await readFile(path.join(dir, f), "utf8");
    await pool.query("BEGIN");
    try {
      await pool.query(sql);
      await pool.query("INSERT INTO _migrations(name) VALUES($1)", [f]);
      await pool.query("COMMIT");
      console.log(`migrated: ${f}`);
    } catch (e) {
      await pool.query("ROLLBACK");
      throw e;
    }
  }
}
