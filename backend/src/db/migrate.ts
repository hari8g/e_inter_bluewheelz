/**
 * Minimal forward-only migration runner. Applies every .sql file in
 * src/db/migrations in lexical order, recording applied names in schema_migrations.
 *
 *   npm run migrate
 */
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, getPool } from "./client.js";
import { listProfiles } from "../signals/profileRegistry.js";

const here = dirname(fileURLToPath(import.meta.url));
// Works from both src/ (tsx) and dist/ (node) because .sql files are copied on build.
const migrationsDir = join(here, "migrations");

export async function migrate(): Promise<void> {
  const pool = getPool();
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name       TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

  const applied = new Set(
    (await pool.query<{ name: string }>("SELECT name FROM schema_migrations")).rows.map((r) => r.name),
  );

  const files = readdirSync(migrationsDir).filter((f) => f.endsWith(".sql")).sort();
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = readFileSync(join(migrationsDir, file), "utf8");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations(name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`[migrate] applied ${file}`);
    } catch (err) {
      await client.query("ROLLBACK");
      throw new Error(`[migrate] ${file} failed: ${(err as Error).message}`);
    } finally {
      client.release();
    }
  }

  // Signal profiles are code-owned; upsert them on every migration run.
  for (const p of listProfiles()) {
    await pool.query(
      `INSERT INTO signal_profile (id, oem_platform, definition)
       VALUES ($1, $2, $3)
       ON CONFLICT (id) DO UPDATE SET definition = EXCLUDED.definition`,
      [p.profileId, p.oemPlatform, JSON.stringify({ ...p, byCanonical: undefined })],
    );
  }
  console.log(`[migrate] ${listProfiles().length} signal profiles synced`);
}

if (process.argv[1] && process.argv[1].includes("migrate")) {
  migrate()
    .then(() => closePool())
    .then(() => process.exit(0))
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
