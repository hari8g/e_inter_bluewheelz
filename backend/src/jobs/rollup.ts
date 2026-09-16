/**
 * Daily vehicle rollup. Reprocesses a 7-day trailing window so late (buffered) frames
 * update already-computed buckets. Buckets stay `provisional` until the window closes.
 */
import { query } from "../db/client.js";
import { listVehicles } from "../db/repositories/vehicleRepo.js";
import { analyticFeasibility } from "../signals/capabilities.js";
import { estimateSoh, persistSoh } from "../services/soh.js";
import { extractDriverEvents } from "../services/driverEvents.js";
import type { OemPlatform } from "../signals/canonical.js";

export interface RollupRow {
  vehicleId: string;
  day: string;
  distanceKm: number | null;
  movingMinutes: number | null;
  framesReceived: number;
  framesExpected: number;
  socBandMinutes: Record<string, number>;
  cellDeltaMvP95: number | null;
  cellTempMaxC: number | null;
  thermalMinutesOver45c: number | null;
  efcAccrued: number | null;
  harshBrakeCount: number | null;
  harshAccelCount: number | null;
  provisional: boolean;
}

function dayUtc(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function startOfDayUtc(isoDay: string): Date {
  return new Date(`${isoDay}T00:00:00.000Z`);
}

export async function rollupVehicleDay(
  vehicleId: string,
  isoDay: string,
  expectedUplinkSec: number,
  platform: OemPlatform,
): Promise<RollupRow> {
  const start = startOfDayUtc(isoDay);
  const end = new Date(start.getTime() + 86_400_000);
  const feas = analyticFeasibility(platform);

  const can = await query<{
    captured_at: Date;
    soc_pct: string | null;
    odometer_km: string | null;
    speed_kph: string | null;
    cell_delta_mv: string | null;
    cell_temp_max_c: string | null;
  }>(
    `SELECT captured_at, soc_pct, odometer_km, speed_kph, cell_delta_mv, cell_temp_max_c
       FROM telemetry_can
      WHERE vehicle_id = $1 AND captured_at >= $2 AND captured_at < $3
      ORDER BY captured_at`,
    [vehicleId, start, end],
  );

  const odoVals = can.map((r) => (r.odometer_km == null ? null : Number(r.odometer_km))).filter((n): n is number => n != null);
  let distanceKm: number | null = null;
  if (odoVals.length >= 2) {
    const delta = odoVals[odoVals.length - 1]! - odoVals[0]!;
    distanceKm = delta >= 0 && delta < 2000 ? Math.round(delta * 10) / 10 : null;
  }

  const expected = Math.max(1, Math.round(86_400 / expectedUplinkSec));
  const framesReceived = can.length;
  const intervalMin = expectedUplinkSec / 60;

  let movingMinutes = 0;
  const socBand: Record<string, number> = { "0-20": 0, "20-40": 0, "40-60": 0, "60-80": 0, "80-100": 0 };
  let efc = 0;
  let prevSoc: number | null = null;
  const deltas: number[] = [];
  let thermalMin = 0;
  let cellTempMax: number | null = null;

  for (const r of can) {
    const speed = r.speed_kph == null ? null : Number(r.speed_kph);
    if (speed != null && speed > 3) movingMinutes += intervalMin;
    const soc = r.soc_pct == null ? null : Number(r.soc_pct);
    if (soc != null) {
      const band = soc < 20 ? "0-20" : soc < 40 ? "20-40" : soc < 60 ? "40-60" : soc < 80 ? "60-80" : "80-100";
      socBand[band] = (socBand[band] ?? 0) + intervalMin;
      if (prevSoc != null) efc += Math.abs(soc - prevSoc) / 200;
      prevSoc = soc;
    }
    if (feas.cellImbalance && r.cell_delta_mv != null) deltas.push(Number(r.cell_delta_mv));
    if (feas.packThermal && r.cell_temp_max_c != null) {
      const t = Number(r.cell_temp_max_c);
      cellTempMax = cellTempMax == null ? t : Math.max(cellTempMax, t);
      if (t > 45) thermalMin += intervalMin;
    }
  }

  let p95: number | null = null;
  if (deltas.length) {
    const s = [...deltas].sort((a, b) => a - b);
    p95 = s[Math.min(s.length - 1, Math.floor(s.length * 0.95))]!;
  }

  const events = await query<{ kind: string; n: string }>(
    `SELECT kind, count(*)::text AS n FROM driver_event
      WHERE vehicle_id = $1 AND occurred_at >= $2 AND occurred_at < $3
      GROUP BY kind`,
    [vehicleId, start, end],
  );
  let harshBrake: number | null = feas.measuredHarshEvents || feas.derivedHarshEvents ? 0 : null;
  let harshAccel: number | null = feas.measuredHarshEvents || feas.derivedHarshEvents ? 0 : null;
  for (const e of events) {
    if (e.kind === "harsh_brake") harshBrake = Number(e.n);
    if (e.kind === "harsh_accel") harshAccel = Number(e.n);
  }

  const ageDays = (Date.now() - end.getTime()) / 86_400_000;
  const provisional = ageDays < 7;

  const row: RollupRow = {
    vehicleId,
    day: isoDay,
    distanceKm,
    movingMinutes: Math.round(movingMinutes),
    framesReceived,
    framesExpected: expected,
    socBandMinutes: socBand,
    cellDeltaMvP95: feas.cellImbalance ? (p95 == null ? null : Math.round(p95 * 100) / 100) : null,
    cellTempMaxC: feas.packThermal ? cellTempMax : null,
    thermalMinutesOver45c: feas.packThermal ? Math.round(thermalMin) : null,
    efcAccrued: Math.round(efc * 1000) / 1000,
    harshBrakeCount: harshBrake,
    harshAccelCount: harshAccel,
    provisional,
  };

  await query(
    `INSERT INTO daily_vehicle_rollup (
       vehicle_id, day, distance_km, moving_minutes, frames_received, frames_expected,
       soc_band_minutes, cell_delta_mv_p95, cell_temp_max_c, thermal_minutes_over_45c,
       efc_accrued, harsh_brake_count, harsh_accel_count, provisional, computed_at
     ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14, now())
     ON CONFLICT (vehicle_id, day) DO UPDATE SET
       distance_km = EXCLUDED.distance_km, moving_minutes = EXCLUDED.moving_minutes,
       frames_received = EXCLUDED.frames_received, frames_expected = EXCLUDED.frames_expected,
       soc_band_minutes = EXCLUDED.soc_band_minutes, cell_delta_mv_p95 = EXCLUDED.cell_delta_mv_p95,
       cell_temp_max_c = EXCLUDED.cell_temp_max_c, thermal_minutes_over_45c = EXCLUDED.thermal_minutes_over_45c,
       efc_accrued = EXCLUDED.efc_accrued, harsh_brake_count = EXCLUDED.harsh_brake_count,
       harsh_accel_count = EXCLUDED.harsh_accel_count, provisional = EXCLUDED.provisional,
       computed_at = now()`,
    [
      vehicleId, isoDay, row.distanceKm, row.movingMinutes, row.framesReceived, row.framesExpected,
      JSON.stringify(row.socBandMinutes), row.cellDeltaMvP95, row.cellTempMaxC, row.thermalMinutesOver45c,
      row.efcAccrued, row.harshBrakeCount, row.harshAccelCount, row.provisional,
    ],
  );

  return row;
}

export async function runRollupWindow(days = 7): Promise<{ vehicles: number; days: number }> {
  const vehicles = await listVehicles();
  const today = new Date();
  let daysRun = 0;
  for (const v of vehicles) {
    await extractDriverEvents(v.id, v.oem_platform);
    const ah = v.nominal_capacity_ah == null ? null : Number(v.nominal_capacity_ah);
    const soh = await estimateSoh(v.id, v.oem_platform, ah);
    await persistSoh(v.id, today, soh);
    for (let i = 0; i < days; i++) {
      const d = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate() - i));
      await rollupVehicleDay(v.id, dayUtc(d), v.expected_uplink_sec, v.oem_platform);
      daysRun++;
    }
  }
  return { vehicles: vehicles.length, days: daysRun };
}

export async function todayDistanceKm(): Promise<number> {
  const rows = await query<{ s: string | null }>(
    `SELECT coalesce(sum(distance_km),0)::text AS s FROM daily_vehicle_rollup WHERE day = CURRENT_DATE`,
  );
  return Math.round(Number(rows[0]?.s ?? 0));
}

export async function efcTotal(vehicleId: string): Promise<number> {
  const rows = await query<{ s: string | null }>(
    `SELECT coalesce(sum(efc_accrued),0)::text AS s FROM daily_vehicle_rollup WHERE vehicle_id = $1`,
    [vehicleId],
  );
  return Number(rows[0]?.s ?? 0);
}

export async function latestRollup(vehicleId: string) {
  const rows = await query<{
    day: Date;
    distance_km: string | null;
    efc_accrued: string | null;
    cell_delta_mv_p95: string | null;
    thermal_minutes_over_45c: string | null;
    frames_received: number;
    frames_expected: number;
    soc_band_minutes: Record<string, number>;
  }>(
    `SELECT day, distance_km, efc_accrued, cell_delta_mv_p95, thermal_minutes_over_45c,
            frames_received, frames_expected, soc_band_minutes
       FROM daily_vehicle_rollup WHERE vehicle_id = $1 ORDER BY day DESC LIMIT 1`,
    [vehicleId],
  );
  return rows[0] ?? null;
}
