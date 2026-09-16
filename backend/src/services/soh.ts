/**
 * Platform-honest SOH.
 *
 *   Eicher      — coulomb-counted capacity vs commissioned Ah
 *   Tata Ace EV — pack-condition index from Δcell (not a capacity %)
 *   Zeo/Switch  — unavailable; never inferred
 */
import { query } from "../db/client.js";
import { analyticFeasibility } from "../signals/capabilities.js";
import type { OemPlatform, SohMethod } from "../types/domain.js";

export interface SohEstimate {
  sohPercent: number | null;
  method: SohMethod;
  ciLow: number | null;
  ciHigh: number | null;
  sampleCount: number;
  lastEstimateAt: string | null;
}

export function sohMethodFor(platform: OemPlatform): SohMethod {
  const f = analyticFeasibility(platform);
  if (f.coulombCountedSoh) return "coulomb_counted";
  if (f.cellImbalance) return "ocv_incremental";
  return "unavailable";
}

function median(xs: number[]): number {
  if (!xs.length) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

function iqr(xs: number[]): { lo: number; hi: number } {
  if (xs.length < 4) {
    const m = median(xs);
    return { lo: m, hi: m };
  }
  const s = [...xs].sort((a, b) => a - b);
  const q1 = s[Math.floor(s.length * 0.25)]!;
  const q3 = s[Math.floor(s.length * 0.75)]!;
  return { lo: q1, hi: q3 };
}

/** Rest point: |I| < 2 A for ≥20 min, then a window with |ΔSOC| ≥ 30 %. */
export async function coulombCountedSoh(
  vehicleId: string,
  nominalCapacityAh: number | null,
): Promise<SohEstimate> {
  if (!nominalCapacityAh || nominalCapacityAh <= 0) {
    return { sohPercent: null, method: "coulomb_counted", ciLow: null, ciHigh: null, sampleCount: 0, lastEstimateAt: null };
  }

  const rows = await query<{ captured_at: Date; pack_current_a: string | null; soc_pct: string | null }>(
    `SELECT captured_at, pack_current_a, soc_pct
       FROM telemetry_can
      WHERE vehicle_id = $1 AND pack_current_a IS NOT NULL AND soc_pct IS NOT NULL
      ORDER BY captured_at`,
    [vehicleId],
  );

  const estimates: { soh: number; at: Date }[] = [];
  let restStart: Date | null = null;
  let restSoc: number | null = null;
  let integralAh = 0;
  let lastT: Date | null = null;
  let lastI = 0;
  let lastSoc: number | null = null;
  let accumulating = false;

  for (const r of rows) {
    const I = Number(r.pack_current_a);
    const soc = Number(r.soc_pct);
    const t = r.captured_at;
    if (lastT) {
      const dtH = (t.getTime() - lastT.getTime()) / 3_600_000;
      if (dtH > 0 && dtH < 2) integralAh += Math.abs(lastI) * dtH;
    }

    if (Math.abs(I) < 2) {
      if (!restStart) {
        restStart = t;
        restSoc = soc;
      }
      const restMin = restStart ? (t.getTime() - restStart.getTime()) / 60_000 : 0;
      if (restMin >= 20 && accumulating && restSoc != null && lastSoc != null) {
        const dSoc = Math.abs(restSoc - lastSoc);
        if (dSoc >= 30 && integralAh > 0.5) {
          const cEst = integralAh / (dSoc / 100);
          const soh = (cEst / nominalCapacityAh) * 100;
          if (soh > 40 && soh < 130) estimates.push({ soh, at: t });
        }
        accumulating = false;
        integralAh = 0;
      }
    } else {
      if (restStart && restSoc != null) {
        accumulating = true;
        lastSoc = restSoc;
      }
      restStart = null;
      restSoc = null;
    }
    lastT = t;
    lastI = I;
  }

  const recent = estimates.slice(-10).map((e) => e.soh);
  if (!recent.length) {
    return { sohPercent: null, method: "coulomb_counted", ciLow: null, ciHigh: null, sampleCount: 0, lastEstimateAt: null };
  }
  const m = median(recent);
  const band = iqr(recent);
  const last = estimates[estimates.length - 1]!;
  return {
    sohPercent: Math.round(m * 10) / 10,
    method: "coulomb_counted",
    ciLow: Math.round(band.lo * 10) / 10,
    ciHigh: Math.round(band.hi * 10) / 10,
    sampleCount: recent.length,
    lastEstimateAt: last.at.toISOString(),
  };
}

/** Tata Ace EV: 0–100 pack-condition index from Δcell p95. Labelled as an index, not capacity. */
export async function ocvIncrementalIndex(vehicleId: string): Promise<SohEstimate> {
  const rows = await query<{ p95: string | null; last_at: Date | null; n: string }>(
    `SELECT
        percentile_cont(0.95) WITHIN GROUP (ORDER BY cell_delta_mv) AS p95,
        max(captured_at) AS last_at,
        count(*)::text AS n
       FROM telemetry_can
      WHERE vehicle_id = $1 AND cell_delta_mv IS NOT NULL
        AND captured_at > now() - INTERVAL '30 days'`,
    [vehicleId],
  );
  const p95 = rows[0]?.p95 == null ? null : Number(rows[0].p95);
  if (p95 == null) {
    return { sohPercent: null, method: "ocv_incremental", ciLow: null, ciHigh: null, sampleCount: 0, lastEstimateAt: null };
  }
  // 20 mV → ~98 index; 80 mV → ~70; 150 mV → ~50
  const index = Math.max(40, Math.min(99, 102 - p95 * 0.35));
  return {
    sohPercent: Math.round(index * 10) / 10,
    method: "ocv_incremental",
    ciLow: Math.round((index - 4) * 10) / 10,
    ciHigh: Math.round((index + 4) * 10) / 10,
    sampleCount: Number(rows[0]?.n ?? 0),
    lastEstimateAt: rows[0]?.last_at?.toISOString() ?? null,
  };
}

export async function estimateSoh(
  vehicleId: string,
  platform: OemPlatform,
  nominalCapacityAh: number | null,
): Promise<SohEstimate> {
  const method = sohMethodFor(platform);
  if (method === "coulomb_counted") return coulombCountedSoh(vehicleId, nominalCapacityAh);
  if (method === "ocv_incremental") return ocvIncrementalIndex(vehicleId);
  return { sohPercent: null, method: "unavailable", ciLow: null, ciHigh: null, sampleCount: 0, lastEstimateAt: null };
}

export async function persistSoh(vehicleId: string, day: Date, est: SohEstimate): Promise<void> {
  if (est.sohPercent == null) return;
  await query(
    `INSERT INTO battery_soh_daily (vehicle_id, day, soh_pct, method, ci_low, ci_high, sample_count)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     ON CONFLICT (vehicle_id, day) DO UPDATE SET
       soh_pct = EXCLUDED.soh_pct, method = EXCLUDED.method,
       ci_low = EXCLUDED.ci_low, ci_high = EXCLUDED.ci_high, sample_count = EXCLUDED.sample_count`,
    [vehicleId, day.toISOString().slice(0, 10), est.sohPercent, est.method, est.ciLow, est.ciHigh, est.sampleCount],
  );
}

export async function sohHistory(vehicleId: string, days = 180) {
  return query<{ day: Date; soh_pct: string; method: string }>(
    `SELECT day, soh_pct, method FROM battery_soh_daily
      WHERE vehicle_id = $1 AND day > CURRENT_DATE - $2::int
      ORDER BY day`,
    [vehicleId, days],
  );
}
