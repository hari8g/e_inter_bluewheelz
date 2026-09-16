/**
 * Postgres connection pool. One pool per process; the API and the ingest worker each
 * create their own.
 */
import pg from "pg";

const { Pool } = pg;

function sslConfig(url: string) {
  const isLocal = /@(localhost|127\.0\.0\.1|::1)[:/]/.test(url);
  return isLocal ? undefined : { rejectUnauthorized: false };
}

let poolRef: pg.Pool | null = null;

export function getPool(): pg.Pool {
  if (poolRef) return poolRef;
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "DATABASE_URL is not set. Set it, or run with DEMO_MODE=1 to use the in-memory seed fleet.",
    );
  }
  poolRef = new Pool({
    connectionString: url,
    max: Number(process.env.PG_POOL_MAX ?? 10),
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    ssl: sslConfig(url),
  });
  poolRef.on("error", (err) => console.error("[db] idle client error", err));
  return poolRef;
}

export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  text: string,
  params: unknown[] = [],
): Promise<T[]> {
  const res = await getPool().query<T>(text, params as never[]);
  return res.rows;
}

export async function withTransaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const out = await fn(client);
    await client.query("COMMIT");
    return out;
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function closePool(): Promise<void> {
  if (poolRef) {
    await poolRef.end();
    poolRef = null;
  }
}

export function isDemoMode(): boolean {
  return process.env.DEMO_MODE === "1" || !process.env.DATABASE_URL;
}
