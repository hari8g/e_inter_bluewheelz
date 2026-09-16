import { randomUUID } from "node:crypto";
import type {
  CanLivePayload,
  CellSnapshotPayload,
  DailyDistancePoint,
  FleetPolicy,
  GpsDevice,
  GpsHistoryPayload,
  GpsMetrics,
  MaintenanceItem,
  TripLedgerRow,
  Vehicle,
} from "../types/domain.js";
import { fileFleetOrNull, loadFileFleet, type IngestedVehicle } from "../ingest/fileFleet.js";
import { CANONICAL_SIGNALS, DOMAIN_LABELS, SIGNAL_LABELS, SIGNAL_UNITS, domainOf } from "../signals/canonical.js";
import { observabilitySets } from "../signals/capabilities.js";
import { FILE_CANONICAL_MAP } from "../signals/fileMap.js";
import {
  initialDevices,
  initialMaintenance,
  initialPolicy,
  initialVehicles,
} from "../seed/bengaluruFleet.js";
import { enrichLiveBattery, enrichLiveDrivers, enrichLiveLifecycle } from "../services/prognosis.js";
import { buildPortfolioValuation } from "../services/financePortfolio.js";
import type { AddVehicleInput, FleetStore } from "./fleetStore.interface.js";

function clone<T>(x: T): T {
  return JSON.parse(JSON.stringify(x)) as T;
}

function downsample<T>(rows: T[], max: number): T[] {
  if (rows.length <= max) return rows;
  const stride = Math.ceil(rows.length / max);
  const out: T[] = [];
  for (let i = 0; i < rows.length; i += stride) out.push(rows[i]!);
  const last = rows[rows.length - 1]!;
  if (out[out.length - 1] !== last) out.push(last);
  return out;
}

export class SeedFleetStore implements FleetStore {
  readonly mode = "demo" as const;
  policy: FleetPolicy = clone(initialPolicy);
  vehicles: Vehicle[] = clone(initialVehicles);
  devices: GpsDevice[] = clone(initialDevices);
  maintenance: MaintenanceItem[] = clone(initialMaintenance);
  private ingested: IngestedVehicle[] = [];
  private fileSource: string | null = null;

  constructor() {
    const fleet = fileFleetOrNull();
    if (fleet && fleet.vehicles.length) {
      this.ingested = fleet.vehicles;
      this.vehicles = fleet.vehicles.map((v) => clone(v.vehicle));
      this.devices = clone(fleet.devices);
      this.maintenance = clone(fleet.maintenance);
      this.fileSource = fleet.sourceDir;
    }
  }

  private ingestedFor(id: string) {
    return this.ingested.find((v) => v.vehicle.id === id) ?? null;
  }

  async getPolicy() {
    return this.policy;
  }

  async updatePolicy(patch: Partial<FleetPolicy>) {
    this.policy = { ...this.policy, ...patch };
    return this.policy;
  }

  async listVehicles() {
    return this.vehicles;
  }

  async getVehicle(id: string) {
    return this.vehicles.find((v) => v.id === id) ?? null;
  }

  async addVehicle(input: AddVehicleInput) {
    const id = `v${randomUUID().slice(0, 8)}`;
    const vehicle: Vehicle = {
      id,
      registration: input.registration,
      displayName: input.displayName,
      model: input.model,
      telemetryMode: input.telemetryMode,
      allowImmobilise: input.allowImmobilise,
      kwhPack: input.kwhPack,
      odometerKm: input.odometerKm,
      socPercent: input.socPercent,
      status: "active",
      locationLabel: input.locationLabel,
      deviceId: null,
      sohMethod: "demo",
      oemPlatform: input.oemPlatform,
      position: {
        lat: input.seedLat,
        lng: input.seedLng,
        lastFixAt: new Date().toISOString(),
      },
      can:
        input.telemetryMode === "can_gps"
          ? {
              motorTempC: 35,
              packVoltageV: 50 + input.kwhPack,
              minCellV: 3.55,
              maxCellV: 3.62,
              bmsHealthScore: 90,
              capturedAt: new Date().toISOString(),
            }
          : undefined,
    };
    this.vehicles.push(vehicle);
    return vehicle;
  }

  async listDevices() {
    return this.devices;
  }

  async registerDevice(serial?: string) {
    const id = `d${randomUUID().slice(0, 8)}`;
    const sn = serial?.trim() || `ELITE-GPS-${10000 + Math.floor(Math.random() * 80000)}`;
    const device: GpsDevice = {
      id,
      serial: sn,
      firmware: "2.4.1",
      type: "GPS",
      lastSeenAt: new Date().toISOString(),
      pairedVehicleId: null,
    };
    this.devices.unshift(device);
    return device;
  }

  async unpairDevice(deviceId: string) {
    const d = this.devices.find((x) => x.id === deviceId);
    if (!d) return null;
    if (d.pairedVehicleId) {
      const v = this.vehicles.find((x) => x.id === d.pairedVehicleId);
      if (v && v.deviceId === deviceId) v.deviceId = null;
    }
    d.pairedVehicleId = null;
    return d;
  }

  async listMaintenance() {
    return this.maintenance;
  }

  async addMaintenance(item: Omit<MaintenanceItem, "id" | "createdAt" | "status">) {
    const row: MaintenanceItem = {
      ...item,
      id: `m${randomUUID().slice(0, 8)}`,
      status: "open",
      createdAt: new Date().toISOString(),
    };
    this.maintenance.unshift(row);
    return row;
  }

  async updateMaintenanceStatus(id: string, status: MaintenanceItem["status"]) {
    const row = this.maintenance.find((m) => m.id === id);
    if (!row) return null;
    row.status = status;
    return row;
  }

  async commandCenterSummary() {
    const reporting = this.vehicles.filter((v) => v.deviceId).length;
    const noLink = this.vehicles.length - reporting;
    const withSoc = this.vehicles.filter((v) => v.trip?.endSocPct != null && v.trip.endSocPct > 0);
    const avgSoc =
      withSoc.reduce((s, v) => s + (v.trip?.endSocPct ?? 0), 0) / Math.max(1, withSoc.length);
    const dteOk = this.vehicles.some((v) => (v.trip?.endDteKm ?? 0) > 0);
    const estRangeKm = dteOk
      ? Math.round(this.vehicles.reduce((s, v) => s + (v.trip?.endDteKm ?? 0), 0))
      : 0;
    const distanceTodayKm = Math.round(this.ingested.reduce((s, v) => s + v.lastDayKm, 0) || 0);
    const reportDistanceKm = Math.round(this.ingested.reduce((s, v) => s + (num(v.trip.canonical["trip.distance_km"]) ?? 0), 0));
    return {
      mode: this.mode,
      fleetTotal: this.vehicles.length,
      reporting,
      noLink,
      distanceTodayKm,
      avgSocPercent: Math.round(avgSoc || 0),
      estRangePoolKm: estRangeKm,
      energyLedgerKwh: 0,
      policy: this.policy,
      vehicles: this.vehicles,
      trips: await this.listTrips(),
      dataSource: this.fileSource ? `file:${this.fileSource}` : "seed",
      reportDistanceKm,
      avgSocSampleCount: withSoc.length,
      rangePoolAvailable: dteOk,
    };
  }

  async batteryHealth() {
    return Promise.all(
      this.vehicles.map(async (v) => {
        const ing = this.ingestedFor(v.id);
        const point = enrichLiveBattery(v, {
          soh: {
            sohPercent: null,
            method: "unavailable",
            ciLow: null,
            ciHigh: null,
            sampleCount: ing?.gps.length ?? 0,
            lastEstimateAt: v.position.lastFixAt,
          },
          efcAccrued: ing ? ing.gpsDistanceKm / 80 : v.odometerKm / 80,
          cellDeltaMvP95: null,
          thermalMinutesOver45c: null,
          coveragePct: v.coverage24hPct ?? 0,
          history: [],
        });
        const start = v.trip?.startSocPct ?? null;
        const end = v.trip?.endSocPct ?? null;
        const dist = v.trip?.distanceKm ?? ing?.gpsDistanceKm ?? null;
        const kmPerSoc =
          start != null && end != null && dist != null && Math.abs(start - end) >= 1
            ? Math.round((dist / Math.abs(start - end)) * 10) / 10
            : null;
        return {
          ...point,
          tripStartSocPct: start,
          tripEndSocPct: end,
          tripEnergyUsed: v.trip?.energyUsed ?? null,
          tripEfficiency: v.trip?.efficiency ?? null,
          tripChargingMin: v.trip?.chargingMin ?? null,
          tripStartDteKm: v.trip?.startDteKm ?? null,
          tripEndDteKm: v.trip?.endDteKm ?? null,
          gpsDistanceKm: ing?.gpsDistanceKm ?? null,
          kmPerSocPoint: kmPerSoc,
          deviceMinV: ing?.deviceMinV ?? null,
          deviceMaxV: ing?.deviceMaxV ?? null,
          auxMinV: ing?.auxMinV ?? null,
          auxMaxV: ing?.auxMaxV ?? null,
        };
      }),
    );
  }

  async lifecycle() {
    return Promise.all(
      this.vehicles.map(async (v) => {
        const ing = this.ingestedFor(v.id);
        return enrichLiveLifecycle(v, {
          efc: ing ? ing.gpsDistanceKm / 80 : v.odometerKm / 400,
          thermalMinutes: null,
          coveragePct: v.coverage24hPct ?? 55,
          ignOnPct: ing?.ignOnPct,
          movingPct: ing?.movingPct,
          distanceDeltaKm: v.gpsMetrics?.distanceDeltaKm ?? null,
          idleMin: v.trip?.idleMin ?? ing?.idleGpsMin ?? null,
          lowAuxV: ing?.lowAuxV ?? false,
        });
      }),
    );
  }

  async drivers() {
    return Promise.all(
      this.vehicles.map(async (v) => {
        const ing = this.ingestedFor(v.id);
        const total = ing ? ing.harshAccel + ing.harshBrake : 0;
        const row = enrichLiveDrivers(v, {
          total,
          source: ing ? "derived_speed" : "demo",
        });
        if (ing) {
          const days = ing.daily.length ? ing.daily : Object.keys(ing.dayKm).sort().map((day) => ({ day, km: ing.dayKm[day]!, ignOnPct: 0, maxSpeedKph: 0, harshTotal: 0 }));
          row.safetyHistory = days.map((d) => ({
            week: d.day.slice(5),
            score: Math.max(35, 96 - d.harshTotal * 3),
          }));
          const idleRatio =
            v.trip?.idleMin != null && v.trip.durationMin
              ? v.trip.idleMin / Math.max(1, v.trip.durationMin)
              : null;
          row.tripScore = v.trip?.score ?? null;
          row.idleRatio = idleRatio;
          const eco =
            v.trip?.efficiency != null
              ? Math.min(99, Math.round(v.trip.efficiency / 2))
              : v.trip?.startSocPct != null && v.trip.endSocPct != null
                ? Math.max(20, 90 - Math.abs(v.trip.startSocPct - v.trip.endSocPct))
                : row.profile.ecoDrive;
          row.profile = {
            smoothness: Math.max(20, 96 - total * 2),
            ecoDrive: eco,
            compliance: idleRatio != null ? Math.max(20, Math.round(100 - idleRatio * 120)) : row.profile.compliance,
            fatigueRisk: Math.min(70, 12 + Math.round((v.trip?.durationMin ?? 0) / 120) + total),
          };
          row.prognosis = {
            ...row.prognosis,
            summary:
              `Trip quality for ${v.registration} (no driver identity). GPS harsh is coarse (~${ing.medianGapSec ?? 30}s sampling, ${ing.harshBrake} brake / ${ing.harshAccel} accel). Trip score ${v.trip?.score ?? "n/a"}.`,
          };
        }
        return row;
      }),
    );
  }

  async portfolioValuation() {
    return buildPortfolioValuation(this.vehicles, await this.batteryHealth(), await this.lifecycle(), new Date());
  }

  async getCanonicalLive(id: string): Promise<CanLivePayload | null> {
    const v = await this.getVehicle(id);
    if (!v) return null;
    const ing = this.ingestedFor(id);
    const sets = v.oemPlatform
      ? observabilitySets(v.oemPlatform)
      : { availableSignals: [], pendingSignals: [], unavailableSignals: [...CANONICAL_SIGNALS] };
    const fileIds = new Set(FILE_CANONICAL_MAP.flatMap((b) => [b.canonical, ...(b.aliases ?? [])]));
    const signals = CANONICAL_SIGNALS.map((sid) => {
      const fromFile = ing?.signals[sid];
      const q = ing?.quality[sid];
      let quality = q ?? "unavailable";
      if (fromFile == null) {
        if (fileIds.has(sid) || v.telemetryMode === "gps_only") quality = "unavailable";
        else if (sets.unavailableSignals.includes(sid)) quality = "unavailable";
        else if (sets.pendingSignals.includes(sid)) quality = "pending_validation";
        else quality = "stale";
      } else {
        quality = q ?? "ok";
      }
      return {
        id: sid,
        label: SIGNAL_LABELS[sid],
        unit: SIGNAL_UNITS[sid],
        domain: domainOf(sid),
        domainLabel: DOMAIN_LABELS[domainOf(sid)],
        value: fromFile ?? null,
        quality,
      };
    });
    const capturedAt = v.gps?.capturedAt ?? v.position.lastFixAt;
    return {
      vehicleId: v.id,
      registration: v.registration,
      capturedAt,
      freshnessSeconds: Math.round((Date.now() - new Date(capturedAt).getTime()) / 1000),
      signals,
      position: {
        lat: v.position.lat,
        lng: v.position.lng,
        gpsSpeedKph: v.gps?.speedKph ?? null,
        joinGapSeconds: 0,
      },
      observability: {
        oemPlatform: v.oemPlatform ?? "file_gps",
        signalProfileId: v.signalProfileId ?? "bluwheelz_gps@file",
        availableSignals: signals.filter((s) => s.quality === "ok").map((s) => s.id),
        pendingSignals: sets.pendingSignals,
        unavailableSignals: signals.filter((s) => s.quality === "unavailable").map((s) => s.id),
        lastFrameAt: capturedAt,
        coverage24hPct: v.coverage24hPct ?? 0,
      },
      trip: v.trip ?? null,
    };
  }

  async getGpsHistory(id: string, opts?: { max?: number; from?: string; to?: string }): Promise<GpsHistoryPayload | null> {
    const v = await this.getVehicle(id);
    const ing = this.ingestedFor(id);
    if (!v || !ing) return null;
    let rows = ing.gps;
    if (opts?.from) {
      const fromMs = new Date(opts.from).getTime();
      if (Number.isFinite(fromMs)) rows = rows.filter((p) => new Date(p.capturedAt).getTime() >= fromMs);
    }
    if (opts?.to) {
      const toMs = new Date(opts.to).getTime();
      if (Number.isFinite(toMs)) rows = rows.filter((p) => new Date(p.capturedAt).getTime() <= toMs);
    }
    const max = Math.min(8000, Math.max(50, opts?.max ?? 1500));
    const points = downsample(rows, max).map((p) => ({
      t: p.capturedAt,
      lat: p.lat,
      lng: p.lng,
      speedKph: p.speedKph,
      deviceBatteryV: p.deviceBatteryV,
      auxBatteryV: p.auxBatteryV,
      ignition: p.ignition,
    }));
    return {
      vehicleId: v.id,
      registration: v.registration,
      from: rows[0]?.capturedAt ?? v.position.lastFixAt,
      to: rows[rows.length - 1]?.capturedAt ?? v.position.lastFixAt,
      count: rows.length,
      points,
    };
  }

  async getCellSnapshot(id: string): Promise<CellSnapshotPayload | null> {
    const v = await this.getVehicle(id);
    if (!v) return null;
    return {
      vehicleId: v.id,
      available: false,
      reason:
        "The Database/ files are GPS traces plus a trip workbook. Individual cell voltages/temperatures are not in those files, so they are not shown.",
      cellVoltagesV: [],
      cellTempsC: [],
    };
  }

  async listTrips(): Promise<TripLedgerRow[]> {
    return this.ingested.map((v) => tripRowFromIngested(v));
  }

  async getGpsMetrics(id: string): Promise<GpsMetrics | null> {
    const v = await this.getVehicle(id);
    const ing = this.ingestedFor(id);
    if (!v || !ing) return null;
    return {
      vehicleId: v.id,
      registration: v.registration,
      pathKm: ing.gpsDistanceKm,
      reportKm: v.trip?.distanceKm ?? null,
      distanceDeltaKm: v.gpsMetrics?.distanceDeltaKm ?? null,
      maxSpeedKph: ing.maxSpeedKph,
      ignOnPct: ing.ignOnPct,
      movingPct: ing.movingPct,
      idleGpsMin: ing.idleGpsMin,
      stopCount: ing.stopCount,
      harshAccel: ing.harshAccel,
      harshBrake: ing.harshBrake,
      peakAccelMps2: ing.peakAccelMps2,
      peakBrakeMps2: ing.peakBrakeMps2,
      medianGapSec: ing.medianGapSec,
      coveragePct: v.coverage24hPct ?? 0,
      firstFixAt: ing.gps[0]?.capturedAt ?? null,
      lastFixAt: ing.gps[ing.gps.length - 1]?.capturedAt ?? null,
      pointCount: ing.gps.length,
      deviceBatteryV: v.gps?.deviceBatteryV ?? null,
      auxBatteryV: v.gps?.auxBatteryV ?? null,
      deviceMinV: ing.deviceMinV,
      deviceMaxV: ing.deviceMaxV,
      auxMinV: ing.auxMinV,
      auxMaxV: ing.auxMaxV,
      lowDeviceV: ing.lowDeviceV,
      lowAuxV: ing.lowAuxV,
      geofences: ing.geofences,
      stops: ing.stops,
    };
  }

  async getDailyDistance(id: string): Promise<DailyDistancePoint[] | null> {
    const ing = this.ingestedFor(id);
    if (!ing) return null;
    return ing.daily.length
      ? ing.daily
      : Object.keys(ing.dayKm)
          .sort()
          .map((day) => ({
            day,
            km: ing.dayKm[day]!,
            ignOnPct: 0,
            maxSpeedKph: 0,
            harshTotal: 0,
          }));
  }

  async getTripDetail(id: string): Promise<TripLedgerRow | null> {
    const ing = this.ingestedFor(id);
    if (!ing) return null;
    return tripRowFromIngested(ing);
  }

  tickCanNoise() {
    const t = new Date().toISOString();
    for (const v of this.vehicles) {
      if (v.telemetryMode !== "can_gps" || !v.can) continue;
      if (v.can.motorTempC != null) {
        v.can.motorTempC = Math.max(28, Math.min(52, v.can.motorTempC + (Math.random() * 2 - 1)));
      }
      if (v.can.packVoltageV != null) {
        v.can.packVoltageV = Math.max(45, Math.min(56, v.can.packVoltageV + (Math.random() * 0.2 - 0.1)));
      }
      if (v.can.minCellV != null) {
        v.can.minCellV = Math.max(3.35, Math.min(3.7, v.can.minCellV + (Math.random() * 0.02 - 0.01)));
      }
      if (v.can.maxCellV != null && v.can.minCellV != null) {
        v.can.maxCellV = Math.max(v.can.minCellV + 0.01, Math.min(3.75, v.can.maxCellV + (Math.random() * 0.02 - 0.01)));
      }
      if (v.can.bmsHealthScore != null) {
        v.can.bmsHealthScore = Math.max(72, Math.min(99, Math.round(v.can.bmsHealthScore + (Math.random() * 2 - 1))));
      }
      v.can.capturedAt = t;
    }
  }
}

function num(v: unknown): number | null {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function tripRowFromIngested(v: IngestedVehicle): TripLedgerRow {
  const t = v.vehicle.trip;
  return {
    vehicleId: v.vehicle.id,
    registration: v.vehicle.registration,
    model: v.trip.model,
    operator: v.trip.operator,
    startAt: v.trip.startAt,
    endAt: v.trip.endAt,
    distanceKm: num(v.trip.canonical["trip.distance_km"]) ?? t?.distanceKm ?? null,
    durationMin: num(v.trip.canonical["trip.duration_min"]) ?? t?.durationMin ?? null,
    avgSpeedKph: num(v.trip.canonical["trip.avg_speed_kph"]) ?? t?.avgSpeedKph ?? null,
    startSocPct: num(v.trip.canonical["trip.start_soc_pct"]) ?? t?.startSocPct ?? null,
    endSocPct: num(v.trip.canonical["trip.end_soc_pct"]) ?? t?.endSocPct ?? null,
    startOdoKm: num(v.trip.canonical["trip.start_odo_km"]) ?? t?.startOdoKm ?? null,
    endOdoKm: num(v.trip.canonical["trip.end_odo_km"]) ?? t?.endOdoKm ?? null,
    energyUsed: num(v.trip.canonical["trip.energy_used"]) ?? t?.energyUsed ?? null,
    gpsDistanceKm: v.gpsDistanceKm,
    efficiency: num(v.trip.canonical["trip.efficiency"]) ?? t?.efficiency ?? null,
    idleMin: num(v.trip.canonical["trip.idle_min"]) ?? t?.idleMin ?? null,
    acIdleMin: num(v.trip.canonical["trip.ac_idle_min"]) ?? t?.acIdleMin ?? null,
    score: num(v.trip.canonical["trip.score"]) ?? t?.score ?? null,
    chargingMin: num(v.trip.canonical["trip.charging_min"]) ?? t?.chargingMin ?? null,
    startDteKm: num(v.trip.canonical["trip.start_dte_km"]) ?? t?.startDteKm ?? null,
    endDteKm: num(v.trip.canonical["trip.end_dte_km"]) ?? t?.endDteKm ?? null,
    startLat: t?.startLat ?? null,
    startLng: t?.startLng ?? null,
    endLat: t?.endLat ?? null,
    endLng: t?.endLng ?? null,
    fuelType: t?.fuelType ?? (typeof v.trip.canonical["trip.fuel_type"] === "string" ? String(v.trip.canonical["trip.fuel_type"]) : null),
    distanceDeltaKm: v.vehicle.gpsMetrics?.distanceDeltaKm ?? null,
  };
}

/** Reload Database/ files (tests). */
export function reloadFileFleet() {
  loadFileFleet(true);
}
