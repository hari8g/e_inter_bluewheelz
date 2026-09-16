import { describe, expect, it } from "vitest";
import { normalizeCan, normalizeGps } from "../src/ingest/normalizer.js";
import { getProfileForPlatform } from "../src/signals/profileRegistry.js";
import { parseEnvelope } from "../src/ingest/envelope.js";

const RX = new Date("2026-09-08T10:00:00Z");
const T = RX.getTime() - 5_000;

function canRecord(data: Record<string, unknown>) {
  return { vehicleno: "KA01EV1001", type: "can" as const, data: { time: T, ...data } as never };
}

describe("Tata Ace EV — 58 parameters", () => {
  const profile = getProfileForPlatform("tata_ace_ev");

  const cells = Object.fromEntries(
    Array.from({ length: 29 }, (_, i) => [
      `cell_voltage_${String(i + 1).padStart(2, "0")}`,
      i === 0 ? 3.655 : 3.6,
    ]),
  );
  const temps = {
    cell_temperature_01: 34.5,
    cell_temperature_02: 35.0,
    cell_temperature_03: 34.8,
    cell_temperature_04: 35.2,
    cell_temperature_05: -80, // sentinel: sensor absent
    cell_temperature_06: -80, // sentinel: sensor absent
  };

  it("truncates temperatures by no_of_temperature_sensors", () => {
    const f = normalizeCan(
      canRecord({ ...cells, ...temps, no_of_cells: 29, no_of_temperature_sensors: 4, soc: 67 }),
      "v1",
      profile,
      null,
      RX,
    );
    expect(f.signals["batt.cell_temp_c"]).toHaveLength(4);
    expect(f.signals["batt.cell_temp_max_c"]).toBe(35.2);
    expect(f.signals["batt.cell_temp_min_c"]).toBe(34.5); // NOT -80
  });

  it("derives cell imbalance from measured cells", () => {
    const f = normalizeCan(
      canRecord({ ...cells, no_of_cells: 29, soc: 67 }),
      "v1",
      profile,
      null,
      RX,
    );
    expect(f.signals["batt.cell_voltage_v"]).toHaveLength(29);
    expect(f.signals["batt.cell_delta_mv"]).toBeCloseTo(55, 0);
    expect(f.quality["batt.cell_delta_mv"]).toBe("ok");
  });

  it("marks a partial pack incomplete rather than reporting a false spread", () => {
    const partial = Object.fromEntries(Object.entries(cells).slice(0, 10));
    const f = normalizeCan(canRecord({ ...partial, no_of_cells: 29 }), "v1", profile, null, RX);
    expect(f.signals["batt.cell_delta_mv"]).toBeUndefined();
    expect(f.quality["batt.cell_delta_mv"]).toBe("incomplete");
  });

  it("maps harsh-event channels and the charging enum", () => {
    const f = normalizeCan(
      canRecord({ harsh_braking: 2, harsh_braking_peak: 4.1, charging_status: 2, ttc: 45 }),
      "v1",
      profile,
      null,
      RX,
    );
    expect(f.signals["drv.harsh_brake_count"]).toBe(2);
    expect(f.signals["drv.harsh_brake_peak_mps2"]).toBe(4.1);
    expect(f.signals["chg.status"]).toBe("dc");
    expect(f.signals["chg.time_to_charge_min"]).toBe(45);
  });

  it("keeps every received key in raw, including ones we do not map yet", () => {
    const f = normalizeCan(canRecord({ soc: 67, some_future_param: 123 }), "v1", profile, null, RX);
    expect(f.raw.some_future_param).toBe(123);
  });
});

describe("Mahindra Zeo — pending parameters", () => {
  const profile = getProfileForPlatform("mahindra_zeo");

  it("stores pending signals but tags them so no KPI can consume them", () => {
    const f = normalizeCan(
      canRecord({ vehicle_speed: 34, charging_status: 1, soc: 62, odometer: 12_400 }),
      "v1",
      profile,
      null,
      RX,
    );
    expect(f.signals["veh.speed_kph"]).toBe(34);
    expect(f.quality["veh.speed_kph"]).toBe("pending_validation");
    expect(f.quality["chg.status"]).toBe("pending_validation");
    // Validated signals on the same frame are unaffected.
    expect(f.quality["batt.soc_pct"]).toBe("ok");
  });

  it("decodes the indicators bitfield into two canonical signals", () => {
    const f = normalizeCan(canRecord({ indicators: 2 }), "v1", profile, null, RX);
    expect(f.signals["body.indicator_left"]).toBe(false);
    expect(f.signals["body.indicator_right"]).toBe(true);
  });
});

describe("Switch — no cell data", () => {
  const profile = getProfileForPlatform("switch_ev");

  it("reports cell signals as unavailable rather than inferring them", () => {
    const f = normalizeCan(canRecord({ soc: 58, odometer: 41_822, vehicle_speed: 22 }), "v1", profile, null, RX);
    expect(f.signals["batt.cell_voltage_v"]).toBeUndefined();
    expect(f.signals["batt.cell_delta_mv"]).toBeUndefined();
    expect(f.quality["batt.cell_voltage_v"]).toBeUndefined(); // not in profile at all
    expect(f.signals["batt.soc_pct"]).toBe(58);
  });
});

describe("Eicher — derived pack power", () => {
  const profile = getProfileForPlatform("eicher_ev");

  it("derives power from measured voltage and signed current", () => {
    const f = normalizeCan(canRecord({ battery_voltage: 540.5, current: 82.3 }), "v1", profile, null, RX);
    expect(f.signals["batt.pack_power_kw"]).toBeCloseTo(44.48, 1);
  });

  it("does not derive power when current is absent", () => {
    const f = normalizeCan(canRecord({ battery_voltage: 540.5 }), "v1", profile, null, RX);
    expect(f.signals["batt.pack_power_kw"]).toBeUndefined();
  });
});

describe("odometer guard against stored neighbours", () => {
  const profile = getProfileForPlatform("tata_ace_ev");

  it("rejects a backward jump and records it", () => {
    const previous = { odometerKm: 41_822, socPercent: 60, capturedAt: new Date(T - 60_000) };
    const f = normalizeCan(canRecord({ odometer: 400 }), "v1", profile, previous, RX);
    expect(f.signals["veh.odometer_km"]).toBeUndefined();
    expect(f.rejects.some((r) => r.signal === "veh.odometer_km")).toBe(true);
  });
});

describe("envelope", () => {
  it("parses the batch shape", () => {
    const r = parseEnvelope(
      JSON.stringify({ bulkData: [{ vehicleno: "KA01EV1001", type: "gps", data: { time: T, lat: 12.97, lng: 77.59 } }] }),
    );
    expect(r.ok).toBe(true);
    expect(r.records).toHaveLength(1);
  });

  it("parses the unwrapped realtime shape", () => {
    const r = parseEnvelope(JSON.stringify({ vehicleno: "KA01EV1001", type: "can", data: { time: T, soc: 61 } }));
    expect(r.ok).toBe(true);
    expect(r.records[0].type).toBe("can");
  });

  it("rejects a seconds-precision timestamp", () => {
    const r = parseEnvelope(JSON.stringify({ vehicleno: "X", type: "can", data: { time: 1757320800 } }));
    expect(r.ok).toBe(false);
  });

  it("normalizes GPS records", () => {
    const f = normalizeGps(
      { vehicleno: "KA01EV1001", type: "gps", data: { time: T, lat: 12.97, lng: 77.59, speed: 34 } as never },
      "v1",
      RX,
    );
    expect(f.kind).toBe("gps");
    expect(f.speedKph).toBe(34);
  });
});
