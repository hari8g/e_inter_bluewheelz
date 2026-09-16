/**
 * Load Database/ vehicle files into one canonical fleet snapshot.
 * GPS CSV and the BluWheelz trip workbook are the only sources — no invented CAN cells.
 */
import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { CanonicalSignalId, SignalQuality } from "../signals/canonical.js";
import { FILE_CANONICAL_MAP } from "../signals/fileMap.js";
import type { GpsDevice, MaintenanceItem, Vehicle } from "../types/domain.js";
import { plateFromGpsFilename, readGpsCsvFile, type GpsCsvRow } from "./gpsCsv.js";
import { dailyDistanceKm, downsampleTrack, harshFromGps, lastDayKey, pathDistanceKm, idleMinutesFromGps, stopsFromGps, movingPct, batteryFlags, geofenceHits, distanceDeltaKm, dailyStats } from "./gpsDerived.js";
import { excelSerialToIso, readFirstSheet, type CellValue } from "./xlsxWorkbook.js";

export type CanonicalValue = number | string | boolean;

export interface GpsSample {
  capturedAt: string;
  lat: number;
  lng: number;
  speedKph: number;
  deviceBatteryV: number | null;
  auxBatteryV: number | null;
  ignition: boolean;
}

export interface TripSummary {
  registration: string;
  operator: string;
  model: string;
  startAt: string | null;
  endAt: string | null;
  startLabel: string | null;
  endLabel: string | null;
  canonical: Partial<Record<CanonicalSignalId, CanonicalValue>>;
}

export interface IngestedVehicle {
  vehicle: Vehicle;
  trip: TripSummary;
  gps: GpsSample[];
  track: Array<{ lat: number; lng: number }>;
  signals: Partial<Record<CanonicalSignalId, CanonicalValue>>;
  quality: Partial<Record<CanonicalSignalId, SignalQuality>>;
  gpsDistanceKm: number;
  maxSpeedKph: number;
  ignOnPct: number;
  harshAccel: number;
  harshBrake: number;
  dayKm: Record<string, number>;
  lastDayKm: number;
  idleGpsMin: number;
  movingPct: number;
  stopCount: number;
  peakAccelMps2: number;
  peakBrakeMps2: number;
  medianGapSec: number | null;
  deviceMinV: number | null;
  deviceMaxV: number | null;
  auxMinV: number | null;
  auxMaxV: number | null;
  lowDeviceV: boolean;
  lowAuxV: boolean;
  geofences: string[];
  daily: ReturnType<typeof dailyStats>;
  stops: ReturnType<typeof stopsFromGps>;
}

export interface FileFleet {
  sourceDir: string;
  loadedAt: string;
  vehicles: IngestedVehicle[];
  devices: GpsDevice[];
  maintenance: MaintenanceItem[];
  trips: TripSummary[];
}

const MODEL_META: Record<string, { kwh: number; oem?: Vehicle["oemPlatform"]; class: string; telemetry: Vehicle["telemetryMode"] }> = {
  "tata ace": { kwh: 21.3, oem: "tata_ace_ev", class: "scv", telemetry: "gps_only" },
  "pro x": { kwh: 8.8, class: "e3w", telemetry: "gps_only" },
  "zor grand": { kwh: 10.2, class: "e3w", telemetry: "gps_only" },
};

function repoDatabaseDir(): string {
  const fromEnv = process.env.FLEET_DATA_DIR?.trim();
  if (fromEnv && existsSync(fromEnv)) return fromEnv;
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(process.cwd(), "data", "vehicles"),
    path.resolve(process.cwd(), "dist", "data", "vehicles"),
    path.resolve(process.cwd(), "..", "Database"),
    path.resolve(process.cwd(), "Database"),
    path.resolve(here, "..", "..", "..", "Database"),
    path.resolve(here, "..", "..", "..", "..", "Database"),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  throw new Error(
    "FLEET_DATA_DIR / Database/ not found. Place BluWheelz GPS CSVs and the trip workbook under Database/.",
  );
}

function asNumber(v: CellValue): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() && v.trim() !== "[]" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function asString(v: CellValue): string | null {
  if (v == null) return null;
  const s = String(v).trim();
  if (!s || s === "[]") return null;
  return s;
}

function splitLatLng(v: CellValue): { lat: number; lng: number } | null {
  const s = asString(v);
  if (!s) return null;
  const [a, b] = s.split(",").map((x) => Number(x.trim()));
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return { lat: a, lng: b };
}

function excelTime(v: CellValue): string | null {
  const n = asNumber(v);
  if (n == null) return null;
  return excelSerialToIso(n);
}

function put(
  signals: Partial<Record<CanonicalSignalId, CanonicalValue>>,
  quality: Partial<Record<CanonicalSignalId, SignalQuality>>,
  id: CanonicalSignalId,
  value: CanonicalValue | null | undefined,
) {
  if (value == null || value === "") {
    quality[id] = "unavailable";
    return;
  }
  if (typeof value === "number" && !Number.isFinite(value)) {
    quality[id] = "unavailable";
    return;
  }
  signals[id] = value;
  quality[id] = "ok";
}

function headerIndex(header: CellValue[]): Record<string, number> {
  const out: Record<string, number> = {};
  header.forEach((h, i) => {
    if (h != null) out[String(h).trim()] = i;
  });
  return out;
}

function parseTrips(xlsxPath: string): TripSummary[] {
  const table = readFirstSheet(xlsxPath);
  if (table.length < 2) return [];
  const idx = headerIndex(table[0] ?? []);
  const col = (row: CellValue[], name: string) => row[idx[name] ?? -1] ?? null;
  const trips: TripSummary[] = [];
  for (const row of table.slice(1)) {
    const registration = asString(col(row, "Vehicleno"));
    if (!registration) continue;
    const start = splitLatLng(col(row, "latLngSArr"));
    const end = splitLatLng(col(row, "latLngEArr"));
    const canonical: Partial<Record<CanonicalSignalId, CanonicalValue>> = {};
    const quality: Partial<Record<CanonicalSignalId, SignalQuality>> = {};
    const assign = (id: CanonicalSignalId, value: CanonicalValue | null) => put(canonical, quality, id, value);
    assign("trip.distance_km", asNumber(col(row, "Distance")));
    assign("trip.duration_min", asNumber(col(row, "Duration (in min)")));
    assign("trip.avg_speed_kph", asNumber(col(row, "Avg Speed")));
    assign("trip.energy_used", asNumber(col(row, "Fuel Used")));
    assign("trip.efficiency", asNumber(col(row, "Mileage")));
    assign("trip.idle_min", asNumber(col(row, "Idling Time")));
    assign("trip.ac_idle_min", asNumber(col(row, "AC Idling Time")));
    assign("trip.start_odo_km", asNumber(col(row, "Startodo")));
    assign("trip.end_odo_km", asNumber(col(row, "Endodo")));
    assign("trip.score", asNumber(col(row, "Trip Score")));
    assign("trip.start_lat", start?.lat ?? null);
    assign("trip.start_lng", start?.lng ?? null);
    assign("trip.end_lat", end?.lat ?? null);
    assign("trip.end_lng", end?.lng ?? null);
    assign("trip.fuel_type", asString(col(row, "Fuel Type")));
    assign("trip.start_soc_pct", asNumber(col(row, "Startfl")));
    assign("trip.end_soc_pct", asNumber(col(row, "Endfl")));
    assign("trip.start_dte_km", asNumber(col(row, "Startdte")));
    assign("trip.end_dte_km", asNumber(col(row, "Enddte")));
    assign("trip.charging_min", asNumber(col(row, "Charging Time")));
    trips.push({
      registration: registration.toUpperCase().replace(/[\s\-_.]/g, ""),
      operator: asString(col(row, "Group1")) ?? "BluWheelz",
      model: asString(col(row, "Model")) ?? "EV",
      startAt: excelTime(col(row, "Starttime")),
      endAt: excelTime(col(row, "Endtime")),
      startLabel: asString(col(row, "Startloc")),
      endLabel: asString(col(row, "Endloc")),
      canonical,
    });
  }
  return trips;
}

function applyAliases(signals: Partial<Record<CanonicalSignalId, CanonicalValue>>, quality: Partial<Record<CanonicalSignalId, SignalQuality>>) {
  for (const bind of FILE_CANONICAL_MAP) {
    if (!bind.aliases) continue;
    const v = signals[bind.canonical];
    if (v == null) continue;
    for (const alias of bind.aliases) {
      if (signals[alias] == null) {
        signals[alias] = v;
        quality[alias] = quality[bind.canonical] ?? "ok";
      }
    }
  }
}

function modelMeta(model: string) {
  const key = model.trim().toLowerCase();
  return MODEL_META[key] ?? { kwh: 10, class: "e3w", telemetry: "gps_only" as const };
}

function locationLabel(lat: number, lng: number): string {
  return `Bengaluru · ${lat.toFixed(4)}, ${lng.toFixed(4)}`;
}

function statusFromGps(last: GpsCsvRow | undefined, lastFixAt: Date): Vehicle["status"] {
  if (!last) return "offline";
  const ageMin = (Date.now() - lastFixAt.getTime()) / 60000;
  if (ageMin > 180) return "offline";
  if (!last.ignition || last.speedKph < 3) return "idle";
  return "active";
}

function toSamples(rows: GpsCsvRow[]): GpsSample[] {
  return rows.map((r) => ({
    capturedAt: r.capturedAt.toISOString(),
    lat: r.lat,
    lng: r.lng,
    speedKph: r.speedKph,
    deviceBatteryV: r.deviceBatteryV,
    auxBatteryV: r.auxBatteryV,
    ignition: r.ignition,
  }));
}

let cached: FileFleet | null = null;

export function loadFileFleet(force = false): FileFleet {
  if (cached && !force) return cached;
  const sourceDir = repoDatabaseDir();
  const files = readdirSync(sourceDir);
  const xlsx = files.find((f) => f.toLowerCase().endsWith(".xlsx"));
  if (!xlsx) throw new Error(`trip workbook missing in ${sourceDir}`);
  const trips = parseTrips(path.join(sourceDir, xlsx));
  const tripByPlate = new Map(trips.map((t) => [t.registration, t]));

  const gpsFiles = files.filter((f) => /gps/i.test(f) && f.toLowerCase().endsWith(".csv"));
  const vehicles: IngestedVehicle[] = [];
  const devices: GpsDevice[] = [];
  const maintenance: MaintenanceItem[] = [];

  for (const file of gpsFiles) {
    const plate = plateFromGpsFilename(file);
    if (!plate) continue;
    const rows = readGpsCsvFile(path.join(sourceDir, file));
    if (!rows.length) continue;
    const trip = tripByPlate.get(plate);
    const last = rows[rows.length - 1]!;
    const first = rows[0]!;
    const meta = modelMeta(trip?.model ?? plate);
    const id = `v_${plate.toLowerCase()}`;
    const deviceId = `d_${plate.toLowerCase()}`;
    const signals: Partial<Record<CanonicalSignalId, CanonicalValue>> = { ...(trip?.canonical ?? {}) };
    const quality: Partial<Record<CanonicalSignalId, SignalQuality>> = {};
    for (const [k, v] of Object.entries(signals)) quality[k as CanonicalSignalId] = v == null ? "unavailable" : "ok";

    put(signals, quality, "gps.lat", last.lat);
    put(signals, quality, "gps.lng", last.lng);
    put(signals, quality, "gps.speed_kph", last.speedKph);
    put(signals, quality, "gps.device_battery_v", last.deviceBatteryV);
    put(signals, quality, "gps.aux_battery_v", last.auxBatteryV);
    put(signals, quality, "gps.ignition", last.ignition);

    const harsh = harshFromGps(rows);
    put(signals, quality, "drv.harsh_accel_count", harsh.accel);
    put(signals, quality, "drv.harsh_brake_count", harsh.brake);
    applyAliases(signals, quality);

    const odo = typeof signals["veh.odometer_km"] === "number" ? (signals["veh.odometer_km"] as number) : 0;
    const soc = typeof signals["batt.soc_pct"] === "number" ? (signals["batt.soc_pct"] as number) : 0;
    const gpsDistanceKm = pathDistanceKm(rows);
    const dayKm = dailyDistanceKm(rows);
    const lastDay = lastDayKey(rows);
    const lastDayKm = lastDay ? dayKm[lastDay] ?? 0 : 0;
    const ignOn = rows.filter((r) => r.ignition).length;
    const idleGpsMin = idleMinutesFromGps(rows);
    const stops = stopsFromGps(rows);
    const batt = batteryFlags(rows);
    const reportKm = numOrNull(signals["trip.distance_km"]);
    const delta = distanceDeltaKm(reportKm, gpsDistanceKm);
    const geofences = geofenceHits(last.lat, last.lng);
    const daily = dailyStats(rows);
    const movePct = movingPct(rows);

    const tripSnap = {
      distanceKm: reportKm,
      durationMin: numOrNull(signals["trip.duration_min"]),
      avgSpeedKph: numOrNull(signals["trip.avg_speed_kph"]),
      startSocPct: numOrNull(signals["trip.start_soc_pct"]),
      endSocPct: numOrNull(signals["trip.end_soc_pct"]),
      startOdoKm: numOrNull(signals["trip.start_odo_km"]),
      endOdoKm: numOrNull(signals["trip.end_odo_km"]),
      energyUsed: numOrNull(signals["trip.energy_used"]),
      efficiency: numOrNull(signals["trip.efficiency"]),
      idleMin: numOrNull(signals["trip.idle_min"]),
      acIdleMin: numOrNull(signals["trip.ac_idle_min"]),
      score: numOrNull(signals["trip.score"]),
      chargingMin: numOrNull(signals["trip.charging_min"]),
      startDteKm: numOrNull(signals["trip.start_dte_km"]),
      endDteKm: numOrNull(signals["trip.end_dte_km"]),
      startLat: numOrNull(signals["trip.start_lat"]),
      startLng: numOrNull(signals["trip.start_lng"]),
      endLat: numOrNull(signals["trip.end_lat"]),
      endLng: numOrNull(signals["trip.end_lng"]),
      startAt: trip?.startAt ?? first.capturedAt.toISOString(),
      endAt: trip?.endAt ?? last.capturedAt.toISOString(),
      fuelType: typeof signals["trip.fuel_type"] === "string" ? (signals["trip.fuel_type"] as string) : null,
      operator: trip?.operator ?? null,
      model: trip?.model ?? null,
    };

    const vehicle: Vehicle = {
      id,
      registration: plate,
      displayName: `${trip?.operator ?? "BluWheelz"} · ${trip?.model ?? "EV"}`,
      model: trip?.model ?? "EV",
      telemetryMode: meta.telemetry,
      allowImmobilise: true,
      kwhPack: meta.kwh,
      odometerKm: odo,
      socPercent: soc,
      status: statusFromGps(last, last.capturedAt),
      locationLabel: locationLabel(last.lat, last.lng),
      deviceId,
      position: {
        lat: last.lat,
        lng: last.lng,
        lastFixAt: last.capturedAt.toISOString(),
      },
      oemPlatform: meta.oem,
      assetClass: meta.class,
      commissionedOn: first.capturedAt.toISOString().slice(0, 10),
      expectedUplinkSec: 30,
      signalProfileId: meta.oem ? `${meta.oem}@file-gps` : "bluwheelz_gps@file",
      sohMethod: "unavailable",
      joinGapSeconds: null,
      coverage24hPct: Math.min(
        100,
        Math.round((rows.filter((r) => r.capturedAt.toISOString().slice(0, 10) === lastDay).length / (86400 / 30)) * 1000) / 10,
      ),
      gps: {
        speedKph: last.speedKph,
        deviceBatteryV: last.deviceBatteryV,
        auxBatteryV: last.auxBatteryV,
        ignition: last.ignition,
        capturedAt: last.capturedAt.toISOString(),
      },
      trip: tripSnap,
      track: downsampleTrack(rows, 360),
      gpsMetrics: {
        pathKm: gpsDistanceKm,
        reportKm,
        distanceDeltaKm: delta,
        maxSpeedKph: Math.max(...rows.map((r) => r.speedKph)),
        ignOnPct: Math.round((ignOn / rows.length) * 100),
        tripScore: tripSnap.score,
        stopCount: stops.length,
        idleGpsMin,
      },
    };

    vehicles.push({
      vehicle,
      trip: trip ?? {
        registration: plate,
        operator: "BluWheelz",
        model: vehicle.model,
        startAt: first.capturedAt.toISOString(),
        endAt: last.capturedAt.toISOString(),
        startLabel: null,
        endLabel: null,
        canonical: {},
      },
      gps: toSamples(rows),
      track: vehicle.track ?? [],
      signals,
      quality,
      gpsDistanceKm,
      maxSpeedKph: Math.max(...rows.map((r) => r.speedKph)),
      ignOnPct: Math.round((ignOn / rows.length) * 100),
      harshAccel: harsh.accel,
      harshBrake: harsh.brake,
      dayKm,
      lastDayKm,
      idleGpsMin,
      movingPct: movePct,
      stopCount: stops.length,
      peakAccelMps2: harsh.peakAccelMps2,
      peakBrakeMps2: harsh.peakBrakeMps2,
      medianGapSec: harsh.medianGapSec,
      deviceMinV: batt.deviceMin,
      deviceMaxV: batt.deviceMax,
      auxMinV: batt.auxMin,
      auxMaxV: batt.auxMax,
      lowDeviceV: batt.lowDeviceV,
      lowAuxV: batt.lowAuxV,
      geofences,
      daily,
      stops,
    });

    devices.push({
      id: deviceId,
      serial: `BLU-GPS-${plate}`,
      firmware: "file-ingest",
      type: "GPS",
      lastSeenAt: last.capturedAt.toISOString(),
      pairedVehicleId: id,
      pointCount: rows.length,
      firstFixAt: first.capturedAt.toISOString(),
      lastDeviceBatteryV: last.deviceBatteryV,
      lastAuxBatteryV: last.auxBatteryV,
    });

    const due = new Date(last.capturedAt);
    due.setDate(due.getDate() + (odo > 20_000 ? 3 : 14));
    const extraNotes: string[] = [];
    if (delta != null && Math.abs(delta) > 40) extraNotes.push(`GPS path vs report distance differs by ${delta} km.`);
    if ((tripSnap.idleMin ?? 0) > 60) extraNotes.push("High reported idle — investigate idling.");
    if (batt.lowAuxV) extraNotes.push("12V battery sagged below 12.2 V in the GPS window.");
    maintenance.push({
      id: `m_${plate.toLowerCase()}`,
      vehicleId: id,
      workType: odo > 20_000 ? "Scheduled service" : "Inspection",
      title: odo > 20_000 ? "Major service window from odometer" : extraNotes.length ? extraNotes[0]! : "Post-trial inspection",
      dueDate: due.toISOString().slice(0, 10),
      odometerAtDueKm: Math.round(odo + (odo > 20_000 ? 500 : 2000)),
      vendor: "BluWheelz workshop",
      notes: [`From Database GPS + trip report. GPS distance ${gpsDistanceKm} km.`, ...extraNotes].join(" "),
      status: odo > 20_000 ? "open" : "in_progress",
      createdAt: last.capturedAt.toISOString(),
    });
    if (delta != null && Math.abs(delta) > 40) {
      maintenance.push({
        id: `m_odo_${plate.toLowerCase()}`,
        vehicleId: id,
        workType: "Inspection",
        title: "Odometer / GPS distance reconciliation",
        dueDate: due.toISOString().slice(0, 10),
        odometerAtDueKm: Math.round(odo),
        vendor: "BluWheelz workshop",
        notes: `Report ${reportKm} km vs GPS path ${gpsDistanceKm} km (delta ${delta} km). Audit odometer vs telematics.`,
        status: "open",
        createdAt: last.capturedAt.toISOString(),
      });
    }
  }

  vehicles.sort((a, b) => a.vehicle.registration.localeCompare(b.vehicle.registration));
  cached = {
    sourceDir,
    loadedAt: new Date().toISOString(),
    vehicles,
    devices,
    maintenance,
    trips: vehicles.map((v) => v.trip),
  };
  return cached;
}

function numOrNull(v: CanonicalValue | undefined): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function fileFleetOrNull(): FileFleet | null {
  try {
    return loadFileFleet();
  } catch {
    return null;
  }
}
