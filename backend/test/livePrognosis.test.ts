import { describe, expect, it } from "vitest";
import { sohMethodFor } from "../src/services/soh.js";
import { enrichLiveBattery, enrichLiveDrivers } from "../src/services/prognosis.js";
import type { Vehicle } from "../src/types/domain.js";

const switchVeh: Vehicle = {
  id: "v_ka01ev1004",
  registration: "KA01EV1004",
  displayName: "Koramangala",
  model: "Switch IeV",
  telemetryMode: "can_gps",
  allowImmobilise: false,
  kwhPack: 25,
  odometerKm: 41822,
  socPercent: 58,
  status: "active",
  locationLabel: "Bengaluru",
  position: { lat: 12.93, lng: 77.62, lastFixAt: new Date().toISOString() },
  deviceId: "gw-1",
  oemPlatform: "switch_ev",
  sohMethod: "unavailable",
};

describe("sohMethodFor", () => {
  it("is coulomb-counted only on Eicher", () => {
    expect(sohMethodFor("eicher_ev")).toBe("coulomb_counted");
    expect(sohMethodFor("tata_ace_ev")).toBe("ocv_incremental");
    expect(sohMethodFor("switch_ev")).toBe("unavailable");
    expect(sohMethodFor("mahindra_zeo")).toBe("unavailable");
  });
});

describe("enrichLiveBattery", () => {
  it("keeps Switch SOH null and does not invent a percentage", () => {
    const row = enrichLiveBattery(switchVeh, {
      soh: { sohPercent: null, method: "unavailable", ciLow: null, ciHigh: null, sampleCount: 0, lastEstimateAt: null },
      efcAccrued: 12,
      cellDeltaMvP95: null,
      thermalMinutesOver45c: null,
      coveragePct: 90,
      history: [],
    });
    expect(row.sohPercent).toBeNull();
    expect(row.sohMethod).toBe("unavailable");
    expect(row.imbalanceMv).toBeNull();
    expect(row.heuristics.thermalStress0to100).toBeNull();
    expect(row.prognosis.summary).toMatch(/not observable/i);
  });
});

describe("enrichLiveDrivers", () => {
  it("returns unavailable rather than fabricating scores from sparse speed", () => {
    const d = enrichLiveDrivers(switchVeh, { total: 0, source: "unavailable" });
    expect(d.eventSource).toBe("unavailable");
    expect(d.harshEvents7d).toBe(0);
    expect(d.prognosis.summary).toMatch(/unavailable/i);
  });
});
