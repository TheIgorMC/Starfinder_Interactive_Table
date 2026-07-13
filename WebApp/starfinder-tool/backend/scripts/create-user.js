#!/usr/bin/env node
// Creates or updates a login account. Run inside the backend container:
//   docker compose exec backend node scripts/create-user.js gm alice "hunter2"
//   docker compose exec backend node scripts/create-user.js player bob "hunter2" [characterId]
//
// A player account can be created before their character exists (leave
// characterId off) — they'll get a "create your character" prompt on first
// login, which links it automatically. Re-running with the same username
// resets that user's password.

import bcrypt from "bcryptjs";
import { pool } from "../src/db.js";

async function main() {
  const [role, username, password, characterId] = process.argv.slice(2);
  if (!role || !username || !password || !["gm", "player"].includes(role)) {
    console.error("Usage: node scripts/create-user.js <gm|player> <username> <password> [characterId]");
    process.exit(1);
  }

  const hash = await bcrypt.hash(password, 10);
  const { rows } = await pool.query(
    `INSERT INTO users (username, password_hash, role, character_id)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (username) DO UPDATE
     SET password_hash = EXCLUDED.password_hash, role = EXCLUDED.role, character_id = EXCLUDED.character_id
     RETURNING id, username, role, character_id`,
    [username, hash, role, characterId ? Number(characterId) : null]
  );

  console.log(`OK: ${JSON.stringify(rows[0])}`);
  await pool.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
