import type { GpsCsvRow } from "./gpsCsv.js";

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const toR = (x: number) => (x * Math.PI) / 180;
  const dlat = toR(b.lat - a.lat);
  const dlng = toR(b.lng - a.lng);
  const s =
    Math.sin(dlat / 2) ** 2 +
    Math.cos(toR(a.lat)) * Math.cos(toR(b.lat)) * Math.sin(dlng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

export function pathDistanceKm(rows: GpsCsvRow[]): number {
  let d = 0;
  for (let i = 1; i < rows.length; i++) d += haversineKm(rows[i - 1]!, rows[i]!);
  return Math.round(d * 10) / 10;
}

export function downsampleTrack(rows: GpsCsvRow[], maxPoints = 400): Array<{ lat: number; lng: number }> {
  if (rows.length <= maxPoints) return rows.map((r) => ({ lat: r.lat, lng: r.lng }));
  const stride = Math.ceil(rows.length / maxPoints);
  const out: Array<{ lat: number; lng: number }> = [];
  for (let i = 0; i < rows.length; i += stride) out.push({ lat: rows[i]!.lat, lng: rows[i]!.lng });
  const last = rows[rows.length - 1]!;
  const tail = out[out.length - 1];
  if (!tail || tail.lat !== last.lat || tail.lng !== last.lng) out.push({ lat: last.lat, lng: last.lng });
  return out;
}

export interface HarshCounts {
  accel: number;
  brake: number;
  peakAccelMps2: number;
  peakBrakeMps2: number;
  medianGapSec: number | null;
}

/**
 * Coarse GPS acceleration events. Sampling is ~30 s, so this is not a 1 Hz CAN harsh channel.
 * Threshold 2.5 m/s² over 5–60 s gaps still surfaces the available GPS behaviour.
 */
export function harshFromGps(rows: GpsCsvRow[]): HarshCounts {
  let accel = 0;
  let brake = 0;
  let peakAccelMps2 = 0;
  let peakBrakeMps2 = 0;
  const gaps: number[] = [];
  for (let i = 1; i < rows.length; i++) {
    const dt = (rows[i]!.capturedAt.getTime() - rows[i - 1]!.capturedAt.getTime()) / 1000;
    if (dt <= 0) continue;
    gaps.push(dt);
    if (dt > 60) continue;
    const a = (rows[i]!.speedKph - rows[i - 1]!.speedKph) / 3.6 / dt;
    if (a >= 2.5) {
      accel += 1;
      peakAccelMps2 = Math.max(peakAccelMps2, a);
    }
    if (a <= -2.5) {
      brake += 1;
      peakBrakeMps2 = Math.max(peakBrakeMps2, -a);
    }
  }
  const sorted = [...gaps].sort((a, b) => a - b);
  const medianGapSec = sorted.length ? sorted[Math.floor(sorted.length / 2)]! : null;
  return {
    accel,
    brake,
    peakAccelMps2: Math.round(peakAccelMps2 * 100) / 100,
    peakBrakeMps2: Math.round(peakBrakeMps2 * 100) / 100,
    medianGapSec,
  };
}

export function dailyDistanceKm(rows: GpsCsvRow[]): Record<string, number> {
  const byDay: Record<string, GpsCsvRow[]> = {};
  for (const r of rows) {
    const d = r.capturedAt.toISOString().slice(0, 10);
    (byDay[d] ??= []).push(r);
  }
  const out: Record<string, number> = {};
  for (const [d, pts] of Object.entries(byDay)) out[d] = pathDistanceKm(pts);
  return out;
}

export function lastDayKey(rows: GpsCsvRow[]): string | null {
  if (!rows.length) return null;
  return rows[rows.length - 1]!.capturedAt.toISOString().slice(0, 10);
}

/** Idle minutes from GPS: ign off or speed < 3 km/h, dt 5–180 s. */
export function idleMinutesFromGps(rows: GpsCsvRow[]): number {
  let sec = 0;
  for (let i = 1; i < rows.length; i++) {
    const dt = (rows[i]!.capturedAt.getTime() - rows[i - 1]!.capturedAt.getTime()) / 1000;
    if (dt < 5 || dt > 180) continue;
    const parked = !rows[i]!.ignition || rows[i]!.speedKph < 3;
    if (parked) sec += dt;
  }
  return Math.round((sec / 60) * 10) / 10;
}

export interface GpsStop {
  startedAt: string;
  endedAt: string;
  dwellMin: number;
  lat: number;
  lng: number;
}

/** Dwell ≥ 5 min within ~80 m. */
export function stopsFromGps(rows: GpsCsvRow[], dwellMin = 5, radiusM = 80): GpsStop[] {
  if (rows.length < 2) return [];
  const stops: GpsStop[] = [];
  let clusterStart = 0;
  const radiusKm = radiusM / 1000;

  const flush = (endIdx: number) => {
    const start = rows[clusterStart]!;
    const end = rows[endIdx]!;
    const dwell = (end.capturedAt.getTime() - start.capturedAt.getTime()) / 60000;
    if (dwell < dwellMin) return;
    stops.push({
      startedAt: start.capturedAt.toISOString(),
      endedAt: end.capturedAt.toISOString(),
      dwellMin: Math.round(dwell * 10) / 10,
      lat: start.lat,
      lng: start.lng,
    });
  };

  for (let i = 1; i < rows.length; i++) {
    const parked = !rows[i]!.ignition || rows[i]!.speedKph < 3;
    const near = haversineKm(rows[clusterStart]!, rows[i]!) <= radiusKm;
    if (parked && near) continue;
    flush(i - 1);
    clusterStart = i;
  }
  flush(rows.length - 1);
  return stops;
}

export interface DailyDistancePoint {
  day: string;
  km: number;
  ignOnPct: number;
  maxSpeedKph: number;
  harshTotal: number;
}

export function dailyStats(rows: GpsCsvRow[]): DailyDistancePoint[] {
  const byDay: Record<string, GpsCsvRow[]> = {};
  for (const r of rows) {
    const d = r.capturedAt.toISOString().slice(0, 10);
    (byDay[d] ??= []).push(r);
  }
  return Object.keys(byDay)
    .sort()
    .map((day) => {
      const pts = byDay[day]!;
      const harsh = harshFromGps(pts);
      const ignOn = pts.filter((p) => p.ignition).length;
      return {
        day,
        km: pathDistanceKm(pts),
        ignOnPct: pts.length ? Math.round((ignOn / pts.length) * 100) : 0,
        maxSpeedKph: Math.round(Math.max(0, ...pts.map((p) => p.speedKph)) * 10) / 10,
        harshTotal: harsh.accel + harsh.brake,
      };
    });
}

export function movingPct(rows: GpsCsvRow[]): number {
  if (!rows.length) return 0;
  const moving = rows.filter((r) => r.ignition && r.speedKph >= 3).length;
  return Math.round((moving / rows.length) * 100);
}

export function distanceDeltaKm(reportKm: number | null, pathKm: number): number | null {
  if (reportKm == null || !Number.isFinite(reportKm)) return null;
  return Math.round((reportKm - pathKm) * 10) / 10;
}

const DEVICE_LOW_V = 3.9;
const AUX_LOW_V = 12.2;

export function batteryFlags(rows: GpsCsvRow[]): {
  deviceMin: number | null;
  deviceMax: number | null;
  auxMin: number | null;
  auxMax: number | null;
  lowDeviceV: boolean;
  lowAuxV: boolean;
} {
  const device = rows.map((r) => r.deviceBatteryV).filter((v): v is number => v != null);
  const aux = rows.map((r) => r.auxBatteryV).filter((v): v is number => v != null);
  const deviceMin = device.length ? Math.min(...device) : null;
  const deviceMax = device.length ? Math.max(...device) : null;
  const auxMin = aux.length ? Math.min(...aux) : null;
  const auxMax = aux.length ? Math.max(...aux) : null;
  return {
    deviceMin,
    deviceMax,
    auxMin,
    auxMax,
    lowDeviceV: deviceMin != null && deviceMin < DEVICE_LOW_V,
    lowAuxV: auxMin != null && auxMin < AUX_LOW_V,
  };
}

/** Simple Bengaluru depot disks used when geofence policy is on. */
export const BENGALURU_GEOFENCES = [
  { id: "hosur_road", label: "Hosur Road / Electronic City", lat: 12.8423, lng: 77.6831, radiusKm: 1.2 },
  { id: "whitefield", label: "Whitefield", lat: 12.9309, lng: 77.7452, radiusKm: 1.2 },
  { id: "peenya", label: "West Bengaluru / Peenya", lat: 12.9343, lng: 77.4841, radiusKm: 1.5 },
  { id: "south_depot", label: "South depot cluster", lat: 12.784, lng: 77.7, radiusKm: 1.2 },
] as const;

export function geofenceHits(lat: number, lng: number): string[] {
  return BENGALURU_GEOFENCES.filter((g) => haversineKm({ lat, lng }, g) <= g.radiusKm).map((g) => g.label);
}
