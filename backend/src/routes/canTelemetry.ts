/** Live canonical state, GPS history, and cell snapshots. */
import { Router } from "express";
import { z } from "zod";
import { isDemoMode } from "../db/client.js";
import { fleetStore } from "../store/fleetStore.js";
import { canHistory } from "../db/repositories/telemetryRepo.js";
import { SIGNAL_UNITS, type CanonicalSignalId } from "../signals/canonical.js";

export const canTelemetryRouter = Router();

canTelemetryRouter.get("/:id/can-live", async (req, res) => {
  const live = await fleetStore.getCanonicalLive(req.params.id);
  if (!live) return res.status(404).json({ error: "not_found" });
  res.json(live);
});

const historyQuery = z.object({
  signal: z.string().min(1),
  from: z.string().optional(),
  to: z.string().optional(),
});

const SIGNAL_TO_COLUMN: Partial<Record<string, string>> = {
  "batt.soc_pct": "soc_pct",
  "veh.odometer_km": "odometer_km",
  "veh.speed_kph": "speed_kph",
  "batt.dte_km": "dte_km",
  "batt.pack_voltage_v": "pack_voltage_v",
  "batt.pack_current_a": "pack_current_a",
  "batt.pack_power_kw": "pack_power_kw",
  "batt.cell_delta_mv": "cell_delta_mv",
  "batt.cell_temp_max_c": "cell_temp_max_c",
  "batt.cell_v_max": "cell_v_max",
  "batt.cell_v_min": "cell_v_min",
  "drv.accel_pedal_pct": "accel_pedal_pct",
};

canTelemetryRouter.get("/:id/can-history", async (req, res) => {
  if (isDemoMode()) {
    const hist = await fleetStore.getGpsHistory(req.params.id);
    if (!hist) return res.status(404).json({ error: "not_found" });
    const signal = String(req.query.signal ?? "gps.speed_kph");
    const pick = (p: (typeof hist.points)[number]): number | null => {
      if (signal === "gps.speed_kph" || signal === "veh.speed_kph") return p.speedKph;
      if (signal === "gps.device_battery_v") return p.deviceBatteryV;
      if (signal === "gps.aux_battery_v") return p.auxBatteryV;
      if (signal === "gps.ignition") return p.ignition ? 1 : 0;
      return p.speedKph;
    };
    return res.json({
      signal,
      unit: SIGNAL_UNITS[signal as CanonicalSignalId] ?? "",
      from: hist.from,
      to: hist.to,
      points: hist.points.map((p) => ({ t: p.t, v: pick(p) })),
    });
  }

  const parsed = historyQuery.safeParse(req.query);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });

  const column = SIGNAL_TO_COLUMN[parsed.data.signal];
  if (!column) {
    return res.status(400).json({
      error: "unsupported_signal",
      supported: Object.keys(SIGNAL_TO_COLUMN),
    });
  }

  const to = parsed.data.to ? new Date(parsed.data.to) : new Date();
  const from = parsed.data.from ? new Date(parsed.data.from) : new Date(to.getTime() - 24 * 3600_000);

  const rows = await canHistory(req.params.id, column, from, to);
  res.json({
    signal: parsed.data.signal,
    unit: SIGNAL_UNITS[parsed.data.signal as CanonicalSignalId] ?? "",
    from: from.toISOString(),
    to: to.toISOString(),
    points: rows.map((r) => ({ t: r.captured_at, v: r.value === null ? null : Number(r.value) })),
  });
});

canTelemetryRouter.get("/:id/cells", async (req, res) => {
  const snap = await fleetStore.getCellSnapshot(req.params.id);
  if (!snap) return res.status(404).json({ error: "not_found" });
  res.json(snap);
});

canTelemetryRouter.get("/:id/gps-history", async (req, res) => {
  const max = req.query.max ? Number(req.query.max) : 1500;
  const from = typeof req.query.from === "string" ? req.query.from : undefined;
  const to = typeof req.query.to === "string" ? req.query.to : undefined;
  const hist = await fleetStore.getGpsHistory(req.params.id, {
    max: Number.isFinite(max) ? max : 1500,
    from,
    to,
  });
  if (!hist) return res.status(404).json({ error: "not_found" });
  res.json(hist);
});

canTelemetryRouter.get("/:id/gps-metrics", async (req, res) => {
  const metrics = await fleetStore.getGpsMetrics(req.params.id);
  if (!metrics) return res.status(404).json({ error: "not_found" });
  res.json(metrics);
});

canTelemetryRouter.get("/:id/daily-distance", async (req, res) => {
  const days = await fleetStore.getDailyDistance(req.params.id);
  if (!days) return res.status(404).json({ error: "not_found" });
  res.json({ vehicleId: req.params.id, items: days });
});

canTelemetryRouter.get("/:id/trip", async (req, res) => {
  const trip = await fleetStore.getTripDetail(req.params.id);
  if (!trip) return res.status(404).json({ error: "not_found" });
  res.json(trip);
});
