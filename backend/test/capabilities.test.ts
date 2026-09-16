import { describe, expect, it } from "vitest";
import { analyticFeasibility, availabilityOf, isUsableForKpi, observabilitySets } from "../src/signals/capabilities.js";
import { listProfiles, getProfileForPlatform } from "../src/signals/profileRegistry.js";
import { CANONICAL_SIGNALS, isCanonicalSignal } from "../src/signals/canonical.js";

describe("capability matrix matches the 2026-09-03 validation report", () => {
  it("Mahindra Zeo has exactly two pending parameters", () => {
    const sets = observabilitySets("mahindra_zeo");
    expect(sets.pendingSignals.sort()).toEqual(["chg.status", "veh.speed_kph"]);
  });

  it("Tata Ace EV is the only platform with cell-level telemetry", () => {
    expect(isUsableForKpi("tata_ace_ev", "batt.cell_voltage_v")).toBe(true);
    expect(isUsableForKpi("tata_ace_ev", "batt.cell_temp_c")).toBe(true);
    for (const p of ["mahindra_zeo", "switch_ev", "eicher_ev"] as const) {
      expect(availabilityOf(p, "batt.cell_voltage_v")).toBe("unavailable");
      expect(availabilityOf(p, "batt.cell_temp_c")).toBe("unavailable");
    }
  });

  it("Eicher is the only platform that can support coulomb-counted SOH", () => {
    expect(analyticFeasibility("eicher_ev").coulombCountedSoh).toBe(true);
    expect(analyticFeasibility("tata_ace_ev").coulombCountedSoh).toBe(false);
    expect(analyticFeasibility("switch_ev").coulombCountedSoh).toBe(false);
    expect(analyticFeasibility("mahindra_zeo").coulombCountedSoh).toBe(false);
  });

  it("Tata Ace EV is the only platform with measured harsh events", () => {
    expect(analyticFeasibility("tata_ace_ev").measuredHarshEvents).toBe(true);
    expect(analyticFeasibility("switch_ev").measuredHarshEvents).toBe(false);
  });

  it("every platform can support the SOC-throughput cycle proxy", () => {
    for (const p of ["mahindra_zeo", "tata_ace_ev", "switch_ev", "eicher_ev"] as const) {
      expect(analyticFeasibility(p).cycleCountProxy).toBe(true);
    }
  });

  it("Zeo speed is pending, so derived harsh events are not yet feasible", () => {
    expect(analyticFeasibility("mahindra_zeo").derivedHarshEvents).toBe(false);
    expect(analyticFeasibility("switch_ev").derivedHarshEvents).toBe(true);
  });
});

describe("signal profiles", () => {
  it("loads all four platforms and cross-validates against the matrix", () => {
    // profileRegistry throws at import time on any mismatch, so reaching here is the assertion.
    expect(listProfiles()).toHaveLength(4);
  });

  it("maps only to canonical signal IDs", () => {
    for (const p of listProfiles()) {
      for (const s of p.signals) expect(isCanonicalSignal(s.canonical)).toBe(true);
    }
  });

  it("declares countKey on every array signal", () => {
    for (const p of listProfiles()) {
      for (const s of p.signals) {
        if (s.type === "array") {
          expect(s.countKey, `${p.profileId}/${s.canonical}`).toBeTruthy();
          expect(s.arrayRange).toBeTruthy();
        }
      }
    }
  });

  it("declares the parameter counts from the report", () => {
    const counts = Object.fromEntries(listProfiles().map((p) => [p.oemPlatform, p.parameterCount]));
    expect(counts).toEqual({ mahindra_zeo: 13, tata_ace_ev: 58, switch_ev: 10, eicher_ev: 14 });
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(95);
  });

  it("covers Tata's 29 cells and 6 temperature sensors", () => {
    const tata = getProfileForPlatform("tata_ace_ev");
    const cells = tata.signals.find((s) => s.canonical === "batt.cell_voltage_v");
    const temps = tata.signals.find((s) => s.canonical === "batt.cell_temp_c");
    expect(cells?.arrayRange).toEqual([1, 29]);
    expect(temps?.arrayRange).toEqual([1, 6]);
    expect(temps?.countKey).toBe("no_of_temperature_sensors");
  });

  it("has a unit and label for every canonical signal", async () => {
    const { SIGNAL_LABELS, SIGNAL_UNITS } = await import("../src/signals/canonical.js");
    for (const id of CANONICAL_SIGNALS) {
      expect(SIGNAL_LABELS[id], id).toBeTruthy();
      expect(SIGNAL_UNITS[id], id).toBeDefined();
    }
  });
});
