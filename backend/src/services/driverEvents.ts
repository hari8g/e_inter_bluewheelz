/**
 * Driver events are scored against the VEHICLE, not a named person.
 * Tata: measured harsh channels. Others: derived from speed only when sampling ≥ 1 Hz.
 */
import { query } from "../db/client.js";
import { analyticFeasibility } from "../signals/capabilities.js";
import type { DriverEventSource, OemPlatform } from "../types/domain.js";

export interface ExtractResult {
  source: DriverEventSource;
  inserted: number;
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export async function extractDriverEvents(vehicleId: string, platform: OemPlatform): Promise<ExtractResult> {
  const feas = analyticFeasibility(platform);
  if (feas.measuredHarshEvents) return extractMeasured(vehicleId);
  if (feas.derivedHarshEvents) return extractDerived(vehicleId);
  return { source: "unavailable", inserted: 0 };
}

async function extractMeasured(vehicleId: string): Promise<ExtractResult> {
  const rows = await query<{ captured_at: Date; raw: Record<string, unknown> }>(
    `SELECT captured_at, raw FROM telemetry_can
      WHERE vehicle_id = $1 AND captured_at > now() - INTERVAL '8 days'
      ORDER BY captured_at`,
    [vehicleId],
  );

  let prevBrake: number | null = null;
  let prevAccel: number | null = null;
  let inserted = 0;

  for (const r of rows) {
    const brake = num(r.raw.harsh_braking);
    const accel = num(r.raw.harsh_acceleration);
    const meanB = num(r.raw.harsh_braking_mean);
    const peakB = num(r.raw.harsh_braking_peak);
    const intB = num(r.raw.harsh_braking_interval);
    const meanA = num(r.raw.harsh_acceleration_mean);
    const peakA = num(r.raw.harsh_acceleration_peak);
    const intA = num(r.raw.harsh_acceleration_interval);

    if (brake != null && prevBrake != null && brake > prevBrake) {
      inserted += await insertEvent(vehicleId, r.captured_at, "harsh_brake", meanB, peakB, intB, "can_measured");
    }
    if (accel != null && prevAccel != null && accel > prevAccel) {
      inserted += await insertEvent(vehicleId, r.captured_at, "harsh_accel", meanA, peakA, intA, "can_measured");
    }
    if (brake != null) prevBrake = brake;
    if (accel != null) prevAccel = accel;
  }
  return { source: "can_measured", inserted };
}

async function extractDerived(vehicleId: string): Promise<ExtractResult> {
  const rows = await query<{ captured_at: Date; speed_kph: string | null }>(
    `SELECT captured_at, speed_kph FROM telemetry_can
      WHERE vehicle_id = $1 AND speed_kph IS NOT NULL AND captured_at > now() - INTERVAL '8 days'
      ORDER BY captured_at`,
    [vehicleId],
  );
  if (rows.length < 8) return { source: "unavailable", inserted: 0 };

  const gaps: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    gaps.push((rows[i]!.captured_at.getTime() - rows[i - 1]!.captured_at.getTime()) / 1000);
  }
  const sorted = [...gaps].sort((a, b) => a - b);
  const medianGap = sorted[Math.floor(sorted.length / 2)] ?? 99;
  // Guard: require ≥1 Hz-ish. 10-second samples must not fabricate events.
  if (medianGap > 2) return { source: "unavailable", inserted: 0 };

  let inserted = 0;
  let runKind: "harsh_brake" | "harsh_accel" | null = null;
  let runStart: Date | null = null;
  let peak = 0;
  let sum = 0;
  let n = 0;

  const flush = async (end: Date) => {
    if (!runKind || !runStart || n === 0) return;
    const dur = (end.getTime() - runStart.getTime()) / 1000;
    if (dur < 1) return;
    inserted += await insertEvent(vehicleId, runStart, runKind, sum / n, peak, dur, "derived_speed");
  };

  for (let i = 1; i < rows.length; i++) {
    const dt = (rows[i]!.captured_at.getTime() - rows[i - 1]!.captured_at.getTime()) / 1000;
    if (dt <= 0 || dt > 3) {
      await flush(rows[i - 1]!.captured_at);
      runKind = null;
      continue;
    }
    const v0 = Number(rows[i - 1]!.speed_kph) / 3.6;
    const v1 = Number(rows[i]!.speed_kph) / 3.6;
    const a = (v1 - v0) / dt;
    const kind: "harsh_brake" | "harsh_accel" | null = a <= -3 ? "harsh_brake" : a >= 3 ? "harsh_accel" : null;
    if (kind && kind === runKind) {
      peak = Math.max(peak, Math.abs(a));
      sum += Math.abs(a);
      n++;
    } else {
      await flush(rows[i]!.captured_at);
      if (kind) {
        runKind = kind;
        runStart = rows[i]!.captured_at;
        peak = Math.abs(a);
        sum = Math.abs(a);
        n = 1;
      } else {
        runKind = null;
      }
    }
  }
  if (rows.length) await flush(rows[rows.length - 1]!.captured_at);
  return { source: "derived_speed", inserted };
}

async function insertEvent(
  vehicleId: string,
  at: Date,
  kind: string,
  mean: number | null,
  peak: number | null,
  intervalS: number | null,
  source: DriverEventSource,
): Promise<number> {
  const res = await query(
    `INSERT INTO driver_event (vehicle_id, occurred_at, kind, mean_mps2, peak_mps2, interval_s, source)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (vehicle_id, occurred_at, kind) DO NOTHING
     RETURNING id`,
    [vehicleId, at, kind, mean, peak, intervalS, source],
  );
  return res.length;
}

export async function eventsLast7d(vehicleId: string) {
  const rows = await query<{ kind: string; n: string; source: string }>(
    `SELECT kind, count(*)::text AS n, max(source) AS source
       FROM driver_event
      WHERE vehicle_id = $1 AND occurred_at > now() - INTERVAL '7 days'
      GROUP BY kind`,
    [vehicleId],
  );
  let brake = 0;
  let accel = 0;
  let source: DriverEventSource = "unavailable";
  for (const r of rows) {
    if (r.kind === "harsh_brake") brake = Number(r.n);
    if (r.kind === "harsh_accel") accel = Number(r.n);
    if (r.source === "can_measured" || r.source === "derived_speed") source = r.source;
  }
  return { brake, accel, total: brake + accel, source };
}
