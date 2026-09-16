import { describe, expect, it } from "vitest";
import { loadFileFleet } from "../src/ingest/fileFleet.js";
import { parseGpsCsv, parseGpsTimestamp } from "../src/ingest/gpsCsv.js";
import { FILE_CANONICAL_MAP } from "../src/signals/fileMap.js";
import { isCanonicalSignal } from "../src/signals/canonical.js";
import { harshFromGps, idleMinutesFromGps, pathDistanceKm, stopsFromGps } from "../src/ingest/gpsDerived.js";
import { SeedFleetStore } from "../src/store/seedFleetStore.js";

describe("file canonical map", () => {
  it("maps every binding onto a master canonical id", () => {
    expect(FILE_CANONICAL_MAP.length).toBeGreaterThan(10);
    for (const b of FILE_CANONICAL_MAP) {
      expect(isCanonicalSignal(b.canonical), b.source).toBe(true);
      for (const a of b.aliases ?? []) expect(isCanonicalSignal(a)).toBe(true);
    }
  });
});

describe("GPS CSV", () => {
  it("parses Intellicar export timestamps and ignition", () => {
    const t = parseGpsTimestamp("08-Sep-2026 16:44:30");
    expect(t?.toISOString()).toBe("2026-09-08T16:44:30.000Z");
    const rows = parseGpsCsv(
      `Time,Speed,Device Battery,Car Battery,Ignition,Address\n"08-Sep-2026 16:44:30","0.03","4.11","13.18","Off","12.842335,77.683155"\n`,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]?.ignition).toBe(false);
    expect(rows[0]?.deviceBatteryV).toBeCloseTo(4.11);
    expect(rows[0]?.lat).toBeCloseTo(12.842335);
  });
});

describe("Database/ BluWheelz ingest", () => {
  const fleet = loadFileFleet();

  it("loads the three plates from GPS files + trip workbook", () => {
    const regs = fleet.vehicles.map((v) => v.vehicle.registration).sort();
    expect(regs).toEqual(["KA01AS1071", "KA01AS1094", "KA01AS7048"]);
  });

  it("canonicalizes trip Endodo onto veh.odometer_km and GPS speed onto veh.speed_kph", () => {
    const ace = fleet.vehicles.find((v) => v.vehicle.registration === "KA01AS1071")!;
    expect(ace.signals["veh.odometer_km"]).toBe(23950);
    expect(ace.signals["trip.end_soc_pct"]).toBe(64);
    expect(ace.signals["batt.soc_pct"]).toBe(64);
    expect(ace.signals["trip.distance_km"]).toBe(322);
    expect(typeof ace.signals["gps.speed_kph"]).toBe("number");
    expect(ace.signals["veh.speed_kph"]).toBe(ace.signals["gps.speed_kph"]);
    expect(ace.vehicle.oemPlatform).toBe("tata_ace_ev");
    expect(ace.gps.length).toBeGreaterThan(1000);
  });

  it("does not invent cell voltages", () => {
    for (const v of fleet.vehicles) {
      expect(v.signals["batt.cell_voltage_v"]).toBeUndefined();
      expect(v.vehicle.can).toBeUndefined();
    }
  });

  it("keeps Ace SOC bookends, Zor SOC null, and path vs report km", () => {
    const ace = fleet.vehicles.find((v) => v.vehicle.registration === "KA01AS1071")!;
    const zor = fleet.vehicles.find((v) => v.vehicle.registration === "KA01AS1094")!;
    expect(ace.signals["trip.start_soc_pct"]).toBe(47);
    expect(ace.signals["trip.end_soc_pct"]).toBe(64);
    expect(zor.signals["trip.start_soc_pct"]).toBeUndefined();
    expect(zor.signals["trip.end_soc_pct"]).toBeUndefined();
    expect(ace.gpsDistanceKm).toBeGreaterThan(10);
    expect(ace.signals["trip.distance_km"]).toBe(322);
    expect(ace.vehicle.gpsMetrics?.distanceDeltaKm).not.toBeNull();
    expect(ace.idleGpsMin).toBeGreaterThan(0);
    expect(ace.stops.length).toBeGreaterThan(0);
  });

  it("derives GPS harsh counts onto driver canonical channels", () => {
    const ace = fleet.vehicles.find((v) => v.vehicle.registration === "KA01AS1071")!;
    expect(ace.harshBrake).toBeGreaterThan(0);
    expect(ace.signals["drv.harsh_brake_count"]).toBe(ace.harshBrake);
  });
});

describe("GPS derived helpers", () => {
  it("counts idle and dwell stops from coarse GPS", () => {
    const t0 = new Date("2026-09-08T10:00:00Z");
    const rows = Array.from({ length: 20 }, (_, i) => ({
      capturedAt: new Date(t0.getTime() + i * 30_000),
      speedKph: i < 12 ? 0 : 20,
      deviceBatteryV: 4.1,
      auxBatteryV: 13.1,
      ignition: i >= 12,
      lat: 12.84,
      lng: 77.68,
    }));
    expect(idleMinutesFromGps(rows)).toBeGreaterThan(4);
    expect(stopsFromGps(rows, 5, 80).length).toBeGreaterThanOrEqual(1);
    expect(pathDistanceKm(rows)).toBe(0);
    const harsh = harshFromGps(rows);
    expect(harsh.medianGapSec).toBe(30);
  });
});

describe("seed store wired to file fleet", () => {
  it("serves command centre, trips, and canonical live from Database files", async () => {
    const store = new SeedFleetStore();
    const cc = await store.commandCenterSummary();
    expect(cc.fleetTotal).toBe(3);
    expect(cc.trips?.length).toBe(3);
    const v = cc.vehicles[0]!;
    const live = await store.getCanonicalLive(v.id);
    expect(live).toBeTruthy();
    const gpsSpeed = live!.signals.find((s) => s.id === "gps.speed_kph");
    expect(gpsSpeed?.quality).toBe("ok");
    const cells = live!.signals.find((s) => s.id === "batt.cell_voltage_v");
    expect(cells?.quality).toBe("unavailable");
    const hist = await store.getGpsHistory(v.id, { max: 50 });
    expect(hist?.points.length).toBeGreaterThan(10);
    const drivers = await store.drivers();
    expect(drivers[0]?.eventSource).toBe("derived_speed");
    const bat = await store.batteryHealth();
    expect(bat[0]?.sohMethod).toBe("unavailable");
    const metrics = await store.getGpsMetrics(v.id);
    expect(metrics?.pointCount).toBeGreaterThan(1000);
    expect(metrics?.pathKm).toBeGreaterThan(0);
    const daily = await store.getDailyDistance(v.id);
    expect(daily?.length).toBeGreaterThanOrEqual(1);
    const trip = await store.getTripDetail(v.id);
    expect(trip?.registration).toBe(v.registration);
    expect(trip?.score != null || trip?.distanceKm != null).toBe(true);
  });

  it("does not fabricate SOC for Zor Grand and keeps Ace bookends", async () => {
    const store = new SeedFleetStore();
    const vehicles = await store.listVehicles();
    const ace = vehicles.find((x) => x.registration === "KA01AS1071")!;
    const zor = vehicles.find((x) => x.registration === "KA01AS1094")!;
    expect(ace.trip?.startSocPct).toBe(47);
    expect(ace.trip?.endSocPct).toBe(64);
    expect(zor.trip?.startSocPct).toBeNull();
    expect(zor.trip?.endSocPct).toBeNull();
    expect(zor.socPercent).toBe(0);
    const cells = await store.getCellSnapshot(ace.id);
    expect(cells?.available).toBe(false);
    const life = await store.lifecycle();
    const aceLife = life.find((x) => x.registration === "KA01AS1071")!;
    expect(aceLife.heuristics.thermalStressIndex).toBeNull();
    const cc = await store.commandCenterSummary();
    expect(cc.avgSocSampleCount).toBe(2);
    expect(cc.rangePoolAvailable).toBe(false);
  });
});
