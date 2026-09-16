import { randomUUID } from "node:crypto";
import { query } from "../db/client.js";
import { cellSnapshot, coverage24h, latestJoined } from "../db/repositories/telemetryRepo.js";
import {
  getVehicle as getVehicleRow,
  insertVehicle,
  listVehicles,
  type VehicleRow,
} from "../db/repositories/vehicleRepo.js";
import { SIGNAL_LABELS, SIGNAL_UNITS, domainOf, DOMAIN_LABELS } from "../signals/canonical.js";
import { efcTotal, latestRollup, todayDistanceKm } from "../jobs/rollup.js";
import { getProfileForPlatform } from "../signals/profileRegistry.js";
import { analyticFeasibility, observabilitySets } from "../signals/capabilities.js";
import { sohHistory, estimateSoh, sohMethodFor } from "../services/soh.js";
import { eventsLast7d } from "../services/driverEvents.js";
import { enrichLiveBattery, enrichLiveDrivers, enrichLiveLifecycle } from "../services/prognosis.js";
import { buildPortfolioValuation } from "../services/financePortfolio.js";
import { initialPolicy } from "../seed/bengaluruFleet.js";
import type { AddVehicleInput, FleetStore } from "./fleetStore.interface.js";
import type {
  CanSnapshot,
  DailyDistancePoint,
  FleetPolicy,
  GpsDevice,
  GpsMetrics,
  MaintenanceItem,
  OemPlatform,
  TripLedgerRow,
  Vehicle,
  VehicleStatus,
} from "../types/domain.js";
import {
  batteryFlags,
  dailyStats,
  geofenceHits,
  harshFromGps,
  idleMinutesFromGps,
  movingPct,
  pathDistanceKm,
  stopsFromGps,
} from "../ingest/gpsDerived.js";
import type { GpsCsvRow } from "../ingest/gpsCsv.js";

function n(v: unknown): number | null {
  if (v == null) return null;
  const x = Number(v);
  return Number.isFinite(x) ? x : null;
}

function asPolicy(raw: unknown): FleetPolicy {
  return { ...initialPolicy, ...(raw as Partial<FleetPolicy>) };
}

export class PgFleetStore implements FleetStore {
  readonly mode = "live" as const;

  async getPolicy() {
    const rows = await query<{ policy: FleetPolicy }>(`SELECT policy FROM fleet_policy WHERE id = 'default'`);
    return rows[0] ? asPolicy(rows[0].policy) : initialPolicy;
  }

  async updatePolicy(patch: Partial<FleetPolicy>) {
    const next = { ...(await this.getPolicy()), ...patch };
    await query(
      `INSERT INTO fleet_policy (id, policy, updated_at) VALUES ('default', $1, now())
       ON CONFLICT (id) DO UPDATE SET policy = EXCLUDED.policy, updated_at = now()`,
      [JSON.stringify(next)],
    );
    return next;
  }

  async listVehicles() {
    const rows = await listVehicles();
    return Promise.all(rows.map((r) => this.hydrate(r)));
  }

  async getVehicle(id: string) {
    const row = await getVehicleRow(id);
    return row ? this.hydrate(row) : null;
  }

  async addVehicle(input: AddVehicleInput) {
    if (!input.oemPlatform) {
      throw Object.assign(new Error("oem_platform_required"), { status: 400 });
    }
    const profile = getProfileForPlatform(input.oemPlatform);
    const id = `v_${input.registration.toLowerCase().replace(/[^a-z0-9]/g, "")}`;
    const row = await insertVehicle({
      id,
      registration: input.registration,
      displayName: input.displayName,
      model: input.model,
      oemPlatform: input.oemPlatform,
      assetClass: profile.assetClass,
      signalProfileId: profile.profileId,
      telemetryMode: input.telemetryMode,
      kwhPack: input.kwhPack,
      nominalCapacityAh: input.nominalCapacityAh ?? null,
      allowImmobilise: input.allowImmobilise,
      locationLabel: input.locationLabel,
      commissionedOn: input.commissionedOn ?? null,
    });
    return this.hydrate(row);
  }

  async listDevices(): Promise<GpsDevice[]> {
    const rows = await query<{
      id: string; serial: string; firmware: string; type: GpsDevice["type"];
      last_seen_at: Date; paired_vehicle_id: string | null;
    }>(`SELECT * FROM gps_device ORDER BY last_seen_at DESC`);
    return rows.map((r) => ({
      id: r.id,
      serial: r.serial,
      firmware: r.firmware,
      type: r.type,
      lastSeenAt: r.last_seen_at.toISOString(),
      pairedVehicleId: r.paired_vehicle_id,
    }));
  }

  async registerDevice(serial?: string) {
    const id = `d${randomUUID().slice(0, 8)}`;
    const sn = serial?.trim() || `INTL-GW-${10000 + Math.floor(Math.random() * 80000)}`;
    const rows = await query<{
      id: string; serial: string; firmware: string; type: GpsDevice["type"];
      last_seen_at: Date; paired_vehicle_id: string | null;
    }>(
      `INSERT INTO gps_device (id, serial, type) VALUES ($1,$2,'CAN_GATEWAY') RETURNING *`,
      [id, sn],
    );
    const r = rows[0]!;
    return {
      id: r.id,
      serial: r.serial,
      firmware: r.firmware,
      type: r.type,
      lastSeenAt: r.last_seen_at.toISOString(),
      pairedVehicleId: r.paired_vehicle_id,
    };
  }

  async unpairDevice(deviceId: string) {
    const rows = await query<{
      id: string; serial: string; firmware: string; type: GpsDevice["type"];
      last_seen_at: Date; paired_vehicle_id: string | null;
    }>(
      `UPDATE gps_device SET paired_vehicle_id = NULL WHERE id = $1 RETURNING *`,
      [deviceId],
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      serial: r.serial,
      firmware: r.firmware,
      type: r.type,
      lastSeenAt: r.last_seen_at.toISOString(),
      pairedVehicleId: null,
    };
  }

  async listMaintenance(): Promise<MaintenanceItem[]> {
    const rows = await query<{
      id: string; vehicle_id: string; work_type: string; title: string; due_date: Date;
      odometer_at_due_km: string | null; vendor: string | null; notes: string;
      status: MaintenanceItem["status"]; created_at: Date;
    }>(`SELECT * FROM maintenance_item ORDER BY created_at DESC`);
    return rows.map((r) => ({
      id: r.id,
      vehicleId: r.vehicle_id,
      workType: r.work_type,
      title: r.title,
      dueDate: r.due_date.toISOString().slice(0, 10),
      odometerAtDueKm: r.odometer_at_due_km == null ? null : Number(r.odometer_at_due_km),
      vendor: r.vendor,
      notes: r.notes,
      status: r.status,
      createdAt: r.created_at.toISOString(),
    }));
  }

  async addMaintenance(item: Omit<MaintenanceItem, "id" | "createdAt" | "status">) {
    const id = `m${randomUUID().slice(0, 8)}`;
    const rows = await query<{
      id: string; vehicle_id: string; work_type: string; title: string; due_date: Date;
      odometer_at_due_km: string | null; vendor: string | null; notes: string;
      status: MaintenanceItem["status"]; created_at: Date;
    }>(
      `INSERT INTO maintenance_item (id, vehicle_id, work_type, title, due_date, odometer_at_due_km, vendor, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [id, item.vehicleId, item.workType, item.title, item.dueDate, item.odometerAtDueKm, item.vendor, item.notes],
    );
    const r = rows[0]!;
    return {
      id: r.id,
      vehicleId: r.vehicle_id,
      workType: r.work_type,
      title: r.title,
      dueDate: r.due_date.toISOString().slice(0, 10),
      odometerAtDueKm: r.odometer_at_due_km == null ? null : Number(r.odometer_at_due_km),
      vendor: r.vendor,
      notes: r.notes,
      status: r.status,
      createdAt: r.created_at.toISOString(),
    };
  }

  async updateMaintenanceStatus(id: string, status: MaintenanceItem["status"]) {
    const rows = await query<{
      id: string; vehicle_id: string; work_type: string; title: string; due_date: Date;
      odometer_at_due_km: string | null; vendor: string | null; notes: string;
      status: MaintenanceItem["status"]; created_at: Date;
    }>(`UPDATE maintenance_item SET status = $2 WHERE id = $1 RETURNING *`, [id, status]);
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      vehicleId: r.vehicle_id,
      workType: r.work_type,
      title: r.title,
      dueDate: r.due_date.toISOString().slice(0, 10),
      odometerAtDueKm: r.odometer_at_due_km == null ? null : Number(r.odometer_at_due_km),
      vendor: r.vendor,
      notes: r.notes,
      status: r.status,
      createdAt: r.created_at.toISOString(),
    };
  }

  async commandCenterSummary() {
    const vehicles = await this.listVehicles();
    const policy = await this.getPolicy();
    const reporting = vehicles.filter((v) => v.deviceId).length;
    const avgSoc = vehicles.reduce((s, v) => s + v.socPercent, 0) / Math.max(1, vehicles.length);
    const estRangeKm = Math.round(vehicles.reduce((s, v) => s + (v.socPercent / 100) * v.kwhPack * 6, 0));
    return {
      mode: this.mode,
      fleetTotal: vehicles.length,
      reporting,
      noLink: vehicles.length - reporting,
      distanceTodayKm: await todayDistanceKm(),
      avgSocPercent: Math.round(avgSoc || 0),
      estRangePoolKm: estRangeKm,
      energyLedgerKwh: 0,
      policy,
      vehicles,
      trips: [],
      dataSource: "postgres",
      reportDistanceKm: 0,
      avgSocSampleCount: vehicles.filter((v) => v.socPercent > 0).length,
      rangePoolAvailable: false,
    };
  }

  async batteryHealth() {
    const vehicles = await this.listVehicles();
    return Promise.all(
      vehicles.map(async (v) => {
        const platform = v.oemPlatform as OemPlatform;
        const soh = await estimateSoh(v.id, platform, v.nominalCapacityAh ?? null);
        const histRows = await sohHistory(v.id);
        const history = histRows.map((h) => ({
          period: new Date(h.day).toLocaleString("en-IN", { month: "short", year: "2-digit" }),
          soh: Number(h.soh_pct),
        }));
        const roll = await latestRollup(v.id);
        return enrichLiveBattery(v, {
          soh,
          efcAccrued: await efcTotal(v.id),
          cellDeltaMvP95: roll?.cell_delta_mv_p95 == null ? v.can?.cellDeltaMv ?? null : Number(roll.cell_delta_mv_p95),
          thermalMinutesOver45c: roll?.thermal_minutes_over_45c == null ? null : Number(roll.thermal_minutes_over_45c),
          coveragePct: v.coverage24hPct ?? 0,
          history,
        });
      }),
    );
  }

  async lifecycle() {
    const vehicles = await this.listVehicles();
    return Promise.all(
      vehicles.map(async (v) => {
        const roll = await latestRollup(v.id);
        return enrichLiveLifecycle(v, {
          efc: await efcTotal(v.id),
          thermalMinutes: roll?.thermal_minutes_over_45c == null ? null : Number(roll.thermal_minutes_over_45c),
          coveragePct: v.coverage24hPct ?? 0,
        });
      }),
    );
  }

  async drivers() {
    const vehicles = await this.listVehicles();
    return Promise.all(
      vehicles.map(async (v) => {
        const ev = await eventsLast7d(v.id);
        const source = ev.source === "unavailable" && v.oemPlatform
          ? (analyticFeasibility(v.oemPlatform).measuredHarshEvents || analyticFeasibility(v.oemPlatform).derivedHarshEvents
              ? ev.source
              : "unavailable")
          : ev.source;
        return enrichLiveDrivers(v, { total: ev.total, source });
      }),
    );
  }

  async portfolioValuation() {
    const vehicles = await this.listVehicles();
    return buildPortfolioValuation(vehicles, await this.batteryHealth(), await this.lifecycle(), new Date());
  }

  private async hydrate(row: VehicleRow): Promise<Vehicle> {
    const windowSec = Number(process.env.GPS_CAN_JOIN_WINDOW_SEC ?? 60);
    const [stateRows, joined, cov] = await Promise.all([
      query<{ state: { signals?: Record<string, unknown> }; captured_at: Date }>(
        `SELECT state, captured_at FROM vehicle_state_current WHERE vehicle_id = $1`,
        [row.id],
      ),
      latestJoined(row.id, windowSec),
      coverage24h(row.id, row.expected_uplink_sec),
    ]);
    const signals = stateRows[0]?.state?.signals ?? {};
    const capturedAt = stateRows[0]?.captured_at ?? joined?.capturedAt ?? null;
    const ageSec = capturedAt ? (Date.now() - new Date(capturedAt).getTime()) / 1000 : Infinity;
    const soc = n(signals["batt.soc_pct"]) ?? 0;
    const odo = n(signals["veh.odometer_km"]) ?? 0;
    const speed = n(signals["veh.speed_kph"]);
    const chg = signals["chg.status"];
    const charging = chg != null && String(chg) !== "0" && String(chg).toLowerCase() !== "idle" && String(chg).toLowerCase() !== "not_charging";

    let status: VehicleStatus = "offline";
    if (ageSec < 30 * 60) {
      if (charging) status = "charging";
      else if ((speed ?? 0) < 3) status = "idle";
      else status = "active";
    }

    const minV = n(signals["batt.cell_v_min"]);
    const maxV = n(signals["batt.cell_v_max"]);
    const can: CanSnapshot | undefined =
      row.telemetry_mode === "can_gps"
        ? {
            motorTempC: null,
            packVoltageV: n(signals["batt.pack_voltage_v"]),
            minCellV: minV,
            maxCellV: maxV,
            bmsHealthScore: null,
            cellDeltaMv: n(signals["batt.cell_delta_mv"]),
            capturedAt: capturedAt ? new Date(capturedAt).toISOString() : new Date().toISOString(),
          }
        : undefined;

    return {
      id: row.id,
      registration: row.registration,
      displayName: row.display_name,
      model: row.model,
      telemetryMode: row.telemetry_mode === "gps_only" ? "gps_only" : "can_gps",
      allowImmobilise: row.allow_immobilise,
      kwhPack: n(row.kwh_pack) ?? 0,
      odometerKm: odo,
      socPercent: soc,
      status,
      locationLabel: row.location_label ?? "",
      deviceId: capturedAt ? `gw-${row.id}` : null,
      position: {
        lat: joined?.lat ?? 0,
        lng: joined?.lng ?? 0,
        lastFixAt: new Date(joined?.capturedAt ?? capturedAt ?? Date.now()).toISOString(),
      },
      can,
      oemPlatform: row.oem_platform,
      assetClass: row.asset_class,
      commissionedOn: row.commissioned_on ? row.commissioned_on.toISOString().slice(0, 10) : null,
      nominalCapacityAh: n(row.nominal_capacity_ah),
      expectedUplinkSec: row.expected_uplink_sec,
      signalProfileId: row.signal_profile_id,
      sohMethod: sohMethodFor(row.oem_platform),
      joinGapSeconds: joined?.joinGapSeconds ?? null,
      coverage24hPct: cov.pct,
    };
  }

  async getCanonicalLive(id: string) {
    const vehicle = await getVehicleRow(id);
    if (!vehicle) return null;
    const rows = await query<{ state: Record<string, unknown>; captured_at: Date }>(
      `SELECT state, captured_at FROM vehicle_state_current WHERE vehicle_id = $1`,
      [vehicle.id],
    );
    const sets = observabilitySets(vehicle.oem_platform);
    const cov = await coverage24h(vehicle.id, vehicle.expected_uplink_sec);
    const state = rows[0]?.state as { signals?: Record<string, unknown>; quality?: Record<string, string> } | undefined;
    const capturedAt = rows[0]?.captured_at ?? null;
    const signals = [...sets.availableSignals, ...sets.pendingSignals, ...sets.unavailableSignals].map((sid) => ({
      id: sid,
      label: SIGNAL_LABELS[sid],
      unit: SIGNAL_UNITS[sid],
      domain: domainOf(sid),
      domainLabel: DOMAIN_LABELS[domainOf(sid)],
      value: state?.signals?.[sid] ?? null,
      quality: state?.quality?.[sid] ?? (sets.unavailableSignals.includes(sid) ? "unavailable" : "stale"),
    }));
    const joined = await latestJoined(vehicle.id, Number(process.env.GPS_CAN_JOIN_WINDOW_SEC ?? 60));
    return {
      vehicleId: vehicle.id,
      registration: vehicle.registration,
      capturedAt: capturedAt ? new Date(capturedAt).toISOString() : null,
      freshnessSeconds: capturedAt ? Math.round((Date.now() - new Date(capturedAt).getTime()) / 1000) : null,
      signals,
      position: joined
        ? { lat: joined.lat, lng: joined.lng, gpsSpeedKph: joined.gpsSpeedKph, joinGapSeconds: joined.joinGapSeconds }
        : null,
      observability: {
        oemPlatform: vehicle.oem_platform,
        signalProfileId: vehicle.signal_profile_id,
        ...sets,
        lastFrameAt: capturedAt ? new Date(capturedAt).toISOString() : null,
        coverage24hPct: cov.pct,
      },
    };
  }

  async getGpsHistory(id: string, opts?: { max?: number; from?: string; to?: string }) {
    const vehicle = await getVehicleRow(id);
    if (!vehicle) return null;
    const max = Math.min(8000, Math.max(50, opts?.max ?? 1500));
    const from = opts?.from ? new Date(opts.from) : null;
    const to = opts?.to ? new Date(opts.to) : null;
    const rows = await query<{
      captured_at: Date; lat: string | null; lng: string | null; speed_kph: string | null; ign_status: number | null;
    }>(
      `SELECT captured_at, lat, lng, speed_kph, ign_status FROM telemetry_gps
        WHERE vehicle_id = $1
          AND ($2::timestamptz IS NULL OR captured_at >= $2)
          AND ($3::timestamptz IS NULL OR captured_at <= $3)
        ORDER BY captured_at`,
      [vehicle.id, from, to],
    );
    const stride = rows.length > max ? Math.ceil(rows.length / max) : 1;
    const points = rows.filter((_, i) => i % stride === 0 || i === rows.length - 1).map((r) => ({
      t: r.captured_at.toISOString(),
      lat: Number(r.lat),
      lng: Number(r.lng),
      speedKph: r.speed_kph == null ? 0 : Number(r.speed_kph),
      deviceBatteryV: null,
      auxBatteryV: null,
      ignition: r.ign_status === 1,
    }));
    return {
      vehicleId: vehicle.id,
      registration: vehicle.registration,
      from: points[0]?.t ?? new Date().toISOString(),
      to: points[points.length - 1]?.t ?? new Date().toISOString(),
      count: rows.length,
      points,
    };
  }

  async getCellSnapshot(id: string) {
    const vehicle = await getVehicleRow(id);
    if (!vehicle) return null;
    const snap = await cellSnapshot(vehicle.id);
    if (!snap) {
      return {
        vehicleId: vehicle.id,
        available: false,
        reason: `Cell-level telemetry is not exposed on ${vehicle.oem_platform}.`,
        cellVoltagesV: [],
        cellTempsC: [],
      };
    }
    const max = Math.max(...snap.cellVoltagesV);
    const min = Math.min(...snap.cellVoltagesV);
    return {
      vehicleId: vehicle.id,
      available: true,
      capturedAt: snap.capturedAt.toISOString(),
      cellCount: snap.cellVoltagesV.length,
      tempSensorCount: snap.cellTempsC.length,
      cellVoltagesV: snap.cellVoltagesV,
      cellTempsC: snap.cellTempsC,
      cellVMaxV: max,
      cellVMinV: min,
      cellDeltaMv: Math.round((max - min) * 1000 * 100) / 100,
      cellTempMaxC: snap.cellTempsC.length ? Math.max(...snap.cellTempsC) : null,
      cellTempMinC: snap.cellTempsC.length ? Math.min(...snap.cellTempsC) : null,
    };
  }

  async listTrips() {
    return [];
  }

  async getGpsMetrics(id: string): Promise<GpsMetrics | null> {
    const vehicle = await this.getVehicle(id);
    if (!vehicle) return null;
    const csv = await gpsRowsForVehicle(id);
    if (!csv.length) {
      return {
        vehicleId: vehicle.id,
        registration: vehicle.registration,
        pathKm: 0,
        reportKm: null,
        distanceDeltaKm: null,
        maxSpeedKph: 0,
        ignOnPct: 0,
        movingPct: 0,
        idleGpsMin: 0,
        stopCount: 0,
        harshAccel: 0,
        harshBrake: 0,
        peakAccelMps2: 0,
        peakBrakeMps2: 0,
        medianGapSec: null,
        coveragePct: vehicle.coverage24hPct ?? 0,
        firstFixAt: null,
        lastFixAt: vehicle.position.lastFixAt,
        pointCount: 0,
        deviceBatteryV: vehicle.gps?.deviceBatteryV ?? null,
        auxBatteryV: vehicle.gps?.auxBatteryV ?? null,
        deviceMinV: null,
        deviceMaxV: null,
        auxMinV: null,
        auxMaxV: null,
        lowDeviceV: false,
        lowAuxV: false,
        geofences: geofenceHits(vehicle.position.lat, vehicle.position.lng),
        stops: [],
      };
    }
    const last = csv[csv.length - 1]!;
    const harsh = harshFromGps(csv);
    const batt = batteryFlags(csv);
    const ignOn = csv.filter((r) => r.ignition).length;
    return {
      vehicleId: vehicle.id,
      registration: vehicle.registration,
      pathKm: pathDistanceKm(csv),
      reportKm: null,
      distanceDeltaKm: null,
      maxSpeedKph: Math.round(Math.max(0, ...csv.map((r) => r.speedKph)) * 10) / 10,
      ignOnPct: Math.round((ignOn / csv.length) * 100),
      movingPct: movingPct(csv),
      idleGpsMin: idleMinutesFromGps(csv),
      stopCount: stopsFromGps(csv).length,
      harshAccel: harsh.accel,
      harshBrake: harsh.brake,
      peakAccelMps2: harsh.peakAccelMps2,
      peakBrakeMps2: harsh.peakBrakeMps2,
      medianGapSec: harsh.medianGapSec,
      coveragePct: vehicle.coverage24hPct ?? 0,
      firstFixAt: csv[0]!.capturedAt.toISOString(),
      lastFixAt: last.capturedAt.toISOString(),
      pointCount: csv.length,
      deviceBatteryV: last.deviceBatteryV,
      auxBatteryV: last.auxBatteryV,
      deviceMinV: batt.deviceMin,
      deviceMaxV: batt.deviceMax,
      auxMinV: batt.auxMin,
      auxMaxV: batt.auxMax,
      lowDeviceV: batt.lowDeviceV,
      lowAuxV: batt.lowAuxV,
      geofences: geofenceHits(last.lat, last.lng),
      stops: stopsFromGps(csv),
    };
  }

  async getDailyDistance(id: string): Promise<DailyDistancePoint[] | null> {
    const vehicle = await getVehicleRow(id);
    if (!vehicle) return null;
    const csv = await gpsRowsForVehicle(id);
    return dailyStats(csv);
  }

  async getTripDetail(_id: string): Promise<TripLedgerRow | null> {
    return null;
  }
}

async function gpsRowsForVehicle(id: string): Promise<GpsCsvRow[]> {
  const rows = await query<{
    captured_at: Date; lat: string | null; lng: string | null; speed_kph: string | null; ign_status: number | null;
  }>(
    `SELECT captured_at, lat, lng, speed_kph, ign_status FROM telemetry_gps
      WHERE vehicle_id = $1 ORDER BY captured_at`,
    [id],
  );
  return rows.map((r) => ({
    capturedAt: r.captured_at,
    lat: Number(r.lat),
    lng: Number(r.lng),
    speedKph: r.speed_kph == null ? 0 : Number(r.speed_kph),
    deviceBatteryV: null,
    auxBatteryV: null,
    ignition: r.ign_status === 1,
  }));
}
