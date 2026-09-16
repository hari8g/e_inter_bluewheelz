/**
 * Ingest worker entry point.
 *
 *   npm run ingest       (production, from dist/)
 *   npm run ingest:dev   (tsx watch)
 *
 * Runs as a SEPARATE Render service from the API. It must never be on a plan that
 * sleeps: a sleeping consumer accrues lag, and lag beyond the topic retention is
 * permanent data loss.
 */
import { startConsumer } from "./consumer.js";
import { loadIngestConfig } from "./config.js";
import { closePool, getPool } from "../db/client.js";
import { listProfiles, unconfirmedKeys } from "../signals/profileRegistry.js";

async function main(): Promise<void> {
  const config = loadIngestConfig();

  // Fail fast on a bad database URL rather than after the first Kafka batch.
  await getPool().query("SELECT 1");
  console.log("[ingest] database reachable");

  const profiles = listProfiles();
  console.log(`[ingest] ${profiles.length} signal profiles loaded: ${profiles.map((p) => p.profileId).join(", ")}`);

  const unconfirmed = unconfirmedKeys();
  if (unconfirmed.length > 0) {
    console.warn(
      `[ingest] ${unconfirmed.length} signal keys are ASSUMED, not confirmed against Intellicar's ` +
        `getarbidparammap. If a chart is unexpectedly empty, check these first.`,
    );
  }

  const { runRollupWindow } = await import("../jobs/rollup.js");
  const rollupMs = Number(process.env.ROLLUP_INTERVAL_MS ?? 15 * 60_000);
  const runRollup = () =>
    runRollupWindow(7)
      .then((r) => console.log(`[ingest] rollup ${r.vehicles} vehicles / ${r.days} day-buckets`))
      .catch((err) => console.error("[ingest] rollup failed", err));
  await runRollup();
  const rollupTimer = setInterval(runRollup, rollupMs);

  const handle = await startConsumer(config);

  const shutdown = async (signal: string) => {
    console.log(`[ingest] ${signal} received, draining`);
    try {
      // disconnect() finishes the in-flight batch, commits, and leaves the group cleanly.
      clearInterval(rollupTimer);
      await handle.stop();
      await closePool();
      process.exit(0);
    } catch (err) {
      console.error("[ingest] shutdown error", err);
      process.exit(1);
    }
  };

  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("unhandledRejection", (err) => {
    console.error("[ingest] unhandled rejection", err);
  });
}

main().catch((err) => {
  console.error("[ingest] fatal", err);
  process.exit(1);
});
