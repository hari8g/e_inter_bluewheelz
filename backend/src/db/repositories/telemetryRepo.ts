/**
 * Telemetry persistence.
 *
 * Two upserts here carry the correctness of the whole pipeline:
 *   upsertCanFrame   — idempotent, so Kafka replays and retries are free
 *   upsertCurrentState — time-guarded, so a late frame cannot rewind the UI
 */
import type pg from "pg";
import { query, withTransaction } from "../client.js";
import type { NormalizedCanFrame, NormalizedGpsFrame, PreviousState } from "../../ingest/normalizer.js";

function num(frame: NormalizedCanFrame, key: string): number | null {
  const v = frame.signals[key as never];
  return typeof v === "number" ? v : null;
}
function str(frame: NormalizedCanFrame, key: string): string | null {
  const v = frame.signals[key as never];
  return typeof v === "string" ? v : null;
}
function bool(frame: NormalizedCanFrame, key: string): boolean | null {
  const v = frame.signals[key as never];
  return typeof v === "boolean" ? v : null;
}
function arr(frame: NormalizedCanFrame, key: string): number[] | null {
  const v = frame.signals[key as never];
  return Array.isArray(v) ? (v as number[]) : null;
}

const CAN_INSERT = `
INSERT INTO telemetry_can (
  vehicle_id, captured_at, received_at, skew_seconds,
  soc_pct, odometer_km, speed_kph, dte_km, gear_state, trip_distance_km,
  pack_voltage_v, pack_current_a, pack_power_kw,
  cell_v, cell_t, cell_v_max, cell_v_min, cell_delta_mv, cell_temp_max_c, cell_temp_min_c,
  charging_status, ttc_min, accel_pedal_pct, brake_pedal, parking_brake,
  raw, quality
) VALUES (
  $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27
)
ON CONFLICT (vehicle_id, captured_at) DO UPDATE SET
  received_at = EXCLUDED.received_at,
  soc_pct = EXCLUDED.soc_pct, odometer_km = EXCLUDED.odometer_km, speed_kph = EXCLUDED.speed_kph,
  dte_km = EXCLUDED.dte_km, gear_state = EXCLUDED.gear_state,
  trip_distance_km = EXCLUDED.trip_distance_km,
  pack_voltage_v = EXCLUDED.pack_voltage_v, pack_current_a = EXCLUDED.pack_current_a,
  pack_power_kw = EXCLUDED.pack_power_kw,
  cell_v = EXCLUDED.cell_v, cell_t = EXCLUDED.cell_t,
  cell_v_max = EXCLUDED.cell_v_max, cell_v_min = EXCLUDED.cell_v_min,
  cell_delta_mv = EXCLUDED.cell_delta_mv,
  cell_temp_max_c = EXCLUDED.cell_temp_max_c, cell_temp_min_c = EXCLUDED.cell_temp_min_c,
  charging_status = EXCLUDED.charging_status, ttc_min = EXCLUDED.ttc_min,
  accel_pedal_pct = EXCLUDED.accel_pedal_pct, brake_pedal = EXCLUDED.brake_pedal,
  parking_brake = EXCLUDED.parking_brake,
  raw = EXCLUDED.raw, quality = EXCLUDED.quality
-- Only a genuinely newer delivery may overwrite. A replayed older copy is a no-op.
WHERE telemetry_can.received_at < EXCLUDED.received_at`;

function canParams(f: NormalizedCanFrame): unknown[] {
  const ttc = num(f, "chg.time_to_charge_min");
  return [
    f.vehicleId, f.capturedAt, f.receivedAt, f.skewSeconds,
    num(f, "batt.soc_pct"), num(f, "veh.odometer_km"), num(f, "veh.speed_kph"),
    num(f, "batt.dte_km"), str(f, "veh.gear_state"), num(f, "veh.trip_distance_km"),
    num(f, "batt.pack_voltage_v"), num(f, "batt.pack_current_a"), num(f, "batt.pack_power_kw"),
    arr(f, "batt.cell_voltage_v"), arr(f, "batt.cell_temp_c"),
    num(f, "batt.cell_v_max"), num(f, "batt.cell_v_min"), num(f, "batt.cell_delta_mv"),
    num(f, "batt.cell_temp_max_c"), num(f, "batt.cell_temp_min_c"),
    str(f, "chg.status"), ttc === null ? null : Math.round(ttc),
    num(f, "drv.accel_pedal_pct"), bool(f, "drv.brake_pedal"), bool(f, "drv.parking_brake"),
    JSON.stringify(f.raw), JSON.stringify(f.quality),
  ];
}

const GPS_INSERT = `
INSERT INTO telemetry_gps (vehicle_id, captured_at, received_at, lat, lng, alti, speed_kph, ign_status, heading)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
ON CONFLICT (vehicle_id, captured_at) DO UPDATE SET
  received_at = EXCLUDED.received_at, lat = EXCLUDED.lat, lng = EXCLUDED.lng,
  alti = EXCLUDED.alti, speed_kph = EXCLUDED.speed_kph,
  ign_status = EXCLUDED.ign_status, heading = EXCLUDED.heading
WHERE telemetry_gps.received_at < EXCLUDED.received_at`;

/**
 * Current state for the command centre.
 *
 * The WHERE clause is load-bearing: devices in tunnels buffer and dump, so an
 * old frame can arrive after a new one. Without the guard the map pin would
 * jump backwards in time.
 */
const STATE_UPSERT = `
INSERT INTO vehicle_state_current (vehicle_id, state, captured_at, updated_at)
VALUES ($1, $2, $3, now())
ON CONFLICT (vehicle_id) DO UPDATE SET
  state = EXCLUDED.state, captured_at = EXCLUDED.captured_at, updated_at = now()
WHERE vehicle_state_current.captured_at < EXCLUDED.captured_at`;

const REJECT_UPSERT = `
INSERT INTO ingest_reject (vehicle_id, signal, reason, day, count, last_value)
VALUES ($1, $2, $3, CURRENT_DATE, 1, $4)
ON CONFLICT (vehicle_id, signal, reason, day)
DO UPDATE SET count = ingest_reject.count + 1, last_value = EXCLUDED.last_value`;

export interface PersistBatch {
  canFrames: NormalizedCanFrame[];
  gpsFrames: NormalizedGpsFrame[];
}

/** Writes an entire Kafka batch in ONE transaction. Offsets commit only after this resolves. */
export async function persistBatch(batch: PersistBatch): Promise<void> {
  if (batch.canFrames.length === 0 && batch.gpsFrames.length === 0) return;

  await withTransaction(async (client: pg.PoolClient) => {
    for (const f of batch.gpsFrames) {
      await client.query(GPS_INSERT, [
        f.vehicleId, f.capturedAt, f.receivedAt, f.lat, f.lng, f.alti, f.speedKph, f.ignStatus, f.heading,
      ]);
    }

    for (const f of batch.canFrames) {
      await client.query(CAN_INSERT, canParams(f) as never[]);
      for (const r of f.rejects) {
        await client.query(REJECT_UPSERT, [f.vehicleId, r.signal, r.reason, String(r.value ?? "")]);
      }
    }

    // Latest frame per vehicle wins the current-state write.
    const latest = new Map<string, NormalizedCanFrame>();
    for (const f of batch.canFrames) {
      const prev = latest.get(f.vehicleId);
      if (!prev || f.capturedAt > prev.capturedAt) latest.set(f.vehicleId, f);
    }
    for (const [vehicleId, f] of latest) {
      const state = {
        capturedAt: f.capturedAt.toISOString(),
        signals: f.signals,
        quality: f.quality,
      };
      await client.query(STATE_UPSERT, [vehicleId, JSON.stringify(state), f.capturedAt]);
    }
  });
}

/**
 * Previous odometer/SOC for the monotonicity and rate guards.
 *
 * Reads the nearest STORED frame before this capture time, not "the last frame we
 * processed" — Kafka is unordered across partitions and a last-seen comparison
 * would falsely reject legitimate late arrivals.
 */
export async function previousState(vehicleId: string, before: Date): Promise<PreviousState | null> {
  const rows = await query<{ odometer_km: string | null; soc_pct: string | null; captured_at: Date }>(
    `SELECT odometer_km, soc_pct, captured_at
       FROM telemetry_can
      WHERE vehicle_id = $1 AND captured_at < $2
      ORDER BY captured_at DESC
      LIMIT 1`,
    [vehicleId, before],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  return {
    odometerKm: r.odometer_km === null ? null : Number(r.odometer_km),
    socPercent: r.soc_pct === null ? null : Number(r.soc_pct),
    capturedAt: r.captured_at,
  };
}

export async function quarantine(vehicleno: string | null, reason: string, payload: unknown): Promise<void> {
  await query(`INSERT INTO ingest_quarantine (vehicleno, reason, payload) VALUES ($1,$2,$3)`, [
    vehicleno,
    reason,
    JSON.stringify(payload),
  ]);
}

export interface JoinedFrame {
  capturedAt: Date;
  socPct: number | null;
  odometerKm: number | null;
  lat: number | null;
  lng: number | null;
  gpsSpeedKph: number | null;
  joinGapSeconds: number | null;
}

/**
 * Nearest-neighbour GPS/CAN join.
 *
 * Intellicar's GPS and CAN records carry independent timestamps, so there is no
 * such thing as "the row". We pick the closest GPS fix within a bounded window and
 * return the gap, so the UI can show a 55-second-old pin differently from a fresh one.
 */
export async function latestJoined(vehicleId: string, windowSec = 60): Promise<JoinedFrame | null> {
  const rows = await query<Record<string, unknown>>(
    `SELECT c.captured_at, c.soc_pct, c.odometer_km,
            g.lat, g.lng, g.speed_kph AS gps_speed,
            EXTRACT(EPOCH FROM (c.captured_at - g.captured_at)) AS join_gap_seconds
       FROM telemetry_can c
       LEFT JOIN LATERAL (
         SELECT * FROM telemetry_gps g
          WHERE g.vehicle_id = c.vehicle_id
            AND g.captured_at BETWEEN c.captured_at - ($2 || ' seconds')::interval
                                  AND c.captured_at + ($2 || ' seconds')::interval
          ORDER BY abs(EXTRACT(EPOCH FROM (g.captured_at - c.captured_at)))
          LIMIT 1
       ) g ON TRUE
      WHERE c.vehicle_id = $1
      ORDER BY c.captured_at DESC
      LIMIT 1`,
    [vehicleId, windowSec],
  );
  if (rows.length === 0) return null;
  const r = rows[0];
  const n = (k: string) => (r[k] === null || r[k] === undefined ? null : Number(r[k]));
  return {
    capturedAt: r.captured_at as Date,
    socPct: n("soc_pct"),
    odometerKm: n("odometer_km"),
    lat: n("lat"),
    lng: n("lng"),
    gpsSpeedKph: n("gps_speed"),
    joinGapSeconds: n("join_gap_seconds"),
  };
}

export async function canHistory(vehicleId: string, column: string, from: Date, to: Date) {
  const allowed = new Set([
    "soc_pct", "odometer_km", "speed_kph", "dte_km", "pack_voltage_v", "pack_current_a",
    "pack_power_kw", "cell_delta_mv", "cell_temp_max_c", "cell_v_max", "cell_v_min", "accel_pedal_pct",
  ]);
  if (!allowed.has(column)) throw new Error(`Column "${column}" is not exposed for history queries`);
  return query<{ captured_at: Date; value: string | null }>(
    `SELECT captured_at, ${column} AS value
       FROM telemetry_can
      WHERE vehicle_id = $1 AND captured_at BETWEEN $2 AND $3 AND ${column} IS NOT NULL
      ORDER BY captured_at`,
    [vehicleId, from, to],
  );
}

export async function cellSnapshot(vehicleId: string) {
  const rows = await query<{ captured_at: Date; cell_v: string[] | null; cell_t: string[] | null }>(
    `SELECT captured_at, cell_v, cell_t
       FROM telemetry_can
      WHERE vehicle_id = $1 AND cell_v IS NOT NULL
      ORDER BY captured_at DESC LIMIT 1`,
    [vehicleId],
  );
  if (rows.length === 0) return null;
  return {
    capturedAt: rows[0].captured_at,
    cellVoltagesV: (rows[0].cell_v ?? []).map(Number),
    cellTempsC: (rows[0].cell_t ?? []).map(Number),
  };
}

export async function coverage24h(vehicleId: string, expectedUplinkSec: number) {
  const rows = await query<{ received: string }>(
    `SELECT count(*)::text AS received FROM telemetry_can
      WHERE vehicle_id = $1 AND captured_at > now() - INTERVAL '24 hours'`,
    [vehicleId],
  );
  const received = Number(rows[0]?.received ?? 0);
  const expected = Math.max(1, Math.round((24 * 3600) / expectedUplinkSec));
  return { received, expected, pct: Math.min(100, Math.round((received / expected) * 100)) };
}
