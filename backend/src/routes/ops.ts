/** Internal operations endpoints. Guarded by ADMIN_API_TOKEN. */
import { Router } from "express";
import { metrics } from "../ingest/metrics.js";
import { query } from "../db/client.js";
import { isDemoMode } from "../db/client.js";

export const opsRouter = Router();

opsRouter.use((req, res, next) => {
  const expected = process.env.ADMIN_API_TOKEN;
  if (!expected) return res.status(503).json({ error: "ops_not_configured" });
  const provided = req.header("X-Admin-Token");
  if (provided !== expected) return res.status(401).json({ error: "unauthorized" });
  next();
});

opsRouter.get("/ingest-health", async (_req, res) => {
  const snapshot = metrics.snapshot();
  if (isDemoMode()) {
    return res.json({ mode: "demo", metrics: snapshot, vehicles: [], rejects: [], quarantine: [] });
  }

  const [vehicles, rejects, quarantined] = await Promise.all([
    query<Record<string, unknown>>(
      `SELECT v.id, v.registration, v.oem_platform, v.expected_uplink_sec,
              s.captured_at AS last_frame_at,
              EXTRACT(EPOCH FROM (now() - s.captured_at))::int AS last_frame_age_sec,
              (SELECT count(*) FROM telemetry_can c
                WHERE c.vehicle_id = v.id AND c.captured_at > now() - INTERVAL '24 hours') AS frames_24h
         FROM vehicle v
         LEFT JOIN vehicle_state_current s ON s.vehicle_id = v.id
        ORDER BY last_frame_age_sec DESC NULLS FIRST`,
    ),
    query<Record<string, unknown>>(
      `SELECT vehicle_id, signal, reason, count, last_value
         FROM ingest_reject WHERE day >= CURRENT_DATE - 1
        ORDER BY count DESC LIMIT 50`,
    ),
    query<Record<string, unknown>>(
      `SELECT vehicleno, reason, received_at FROM ingest_quarantine
        ORDER BY received_at DESC LIMIT 25`,
    ),
  ]);

  const enriched = vehicles.map((v) => {
    const expected = Math.max(1, Math.round((24 * 3600) / Number(v.expected_uplink_sec ?? 30)));
    const received = Number(v.frames_24h ?? 0);
    return { ...v, frames_expected_24h: expected, coverage24hPct: Math.min(100, Math.round((received / expected) * 100)) };
  });

  res.json({
    mode: "live",
    metrics: snapshot,
    vehicles: enriched,
    rejects,
    quarantine: quarantined,
    fleetCoverage24hPct: enriched.length
      ? Math.round(enriched.reduce((s, v) => s + (v.coverage24hPct as number), 0) / enriched.length)
      : null,
  });
});

opsRouter.post("/rollup", async (_req, res) => {
  if (isDemoMode()) return res.status(503).json({ error: "demo_mode" });
  const { runRollupWindow } = await import("../jobs/rollup.js");
  const result = await runRollupWindow(7);
  res.json({ ok: true, ...result });
});

opsRouter.get("/quarantine", async (_req, res) => {
  if (isDemoMode()) return res.json([]);
  res.json(
    await query(`SELECT * FROM ingest_quarantine ORDER BY received_at DESC LIMIT 100`),
  );
});
