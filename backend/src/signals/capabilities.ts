/**
 * Per-platform capability matrix, transcribed from the Intellicar CAN Parameter
 * Validation Report (Bosch, 2026-09-03).
 *
 *   mahindra_zeo  13 params — 11 validated, 2 pending (Vehicle Speed, Charging Parameters)
 *   tata_ace_ev   58 params — all validated (29 cell V, 6 cell T, 8 harsh channels)
 *   switch_ev     10 params — all validated, no cell-level data
 *   eicher_ev     14 params — all validated, only platform with pack voltage + signed current
 *
 * This table is the single source of truth for "can this platform support analytic X".
 * The normalizer, the API `observability` block and the UI empty states all read it.
 * When Intellicar promotes a pending parameter, change one word here and bump the
 * profile version — no analytics code changes.
 */
import type { CanonicalSignalId, OemPlatform, SignalAvailability } from "./canonical.js";
import { CANONICAL_SIGNALS } from "./canonical.js";

type PlatformCapabilities = Partial<Record<CanonicalSignalId, SignalAvailability>>;

/** Anything absent from a platform's map is "unavailable". */
export const CAPABILITY_MATRIX: Record<OemPlatform, PlatformCapabilities> = {
  // ── Mahindra Zeo (13 parameters) ────────────────────────────────────────────
  mahindra_zeo: {
    "veh.odometer_km": "validated",
    "batt.soc_pct": "validated",
    "batt.dte_km": "validated",
    "drv.parking_brake": "validated",
    "body.indicator_left": "validated", // report: "Indicators"
    "body.indicator_right": "validated", // report: "Indicators"
    "body.headlight_low": "validated", // report: "Headlight" (single signal)
    "drv.accel_pedal_pct": "validated", // report: "Acceleration"
    "drv.brake_pedal": "validated",
    "mode.eco": "validated",
    "mode.power": "validated",
    "veh.gear_state": "validated",
    // --- pending per the 03-Sep report ---
    "chg.status": "pending", // report: "Charging Parameters"
    "veh.speed_kph": "pending",
  },

  // ── Tata Ace EV (58 parameters) ─────────────────────────────────────────────
  tata_ace_ev: {
    // battery cell voltages (29) + temperatures (6)
    "batt.cell_voltage_v": "validated",
    "batt.cell_temp_c": "validated",
    // battery summary (4)
    "batt.cell_temp_max_c": "validated",
    "batt.cell_v_max": "validated",
    "batt.cell_temp_min_c": "validated",
    "batt.cell_v_min": "validated",
    // derived from the above
    "batt.cell_delta_mv": "validated",
    // vehicle & drive (9)
    "veh.speed_kph": "validated",
    "veh.gear_state": "validated",
    "batt.soc_pct": "validated",
    "batt.dte_km": "validated",
    "drv.brake_pedal": "validated",
    "drv.accel_pedal_pct": "validated",
    "veh.odometer_km": "validated",
    "body.headlight_low": "validated",
    "body.headlight_high": "validated",
    // charging (2)
    "chg.status": "validated",
    "chg.time_to_charge_min": "validated",
    // driving behaviour — harsh events (8)
    "drv.harsh_brake_count": "validated",
    "drv.harsh_brake_interval_s": "validated",
    "drv.harsh_brake_mean_mps2": "validated",
    "drv.harsh_brake_peak_mps2": "validated",
    "drv.harsh_accel_count": "validated",
    "drv.harsh_accel_interval_s": "validated",
    "drv.harsh_accel_mean_mps2": "validated",
    "drv.harsh_accel_peak_mps2": "validated",
  },

  // ── Switch (10 parameters) ──────────────────────────────────────────────────
  switch_ev: {
    "batt.soc_pct": "validated",
    "batt.dte_km": "validated",
    "veh.odometer_km": "validated",
    "veh.speed_kph": "validated",
    "chg.status": "validated",
    "veh.gear_state": "validated", // report: "Gear"
    "drv.accel_pedal_pct": "validated", // report: "Acceleration Pedal"
    "drv.brake_pedal": "validated",
    "drv.parking_brake": "validated", // report: "Handbrake"
    "veh.trip_distance_km": "validated", // report: "Trip A"
  },

  // ── Eicher (14 parameters) ──────────────────────────────────────────────────
  eicher_ev: {
    "batt.soc_pct": "validated",
    "batt.dte_km": "validated",
    "veh.odometer_km": "validated",
    "veh.trip_distance_km": "validated", // report: "Trip"
    "veh.speed_kph": "validated",
    "drv.brake_pedal": "validated",
    "batt.pack_current_a": "validated", // report: "Current"
    "batt.pack_voltage_v": "validated", // report: "HV Volt"
    "batt.pack_voltage_aux_v": "validated", // report: "HV Volt 01"
    "batt.pack_power_kw": "validated", // derived from voltage x current
    "drv.accel_low_idle_switch_1": "validated",
    "drv.accel_kickdown": "validated",
    "veh.road_speed_limit_status": "validated",
    "drv.accel_low_idle_switch_2": "validated",
    "drv.accel_pedal_pct": "validated", // report: "Acceleration Pedal"
  },
};

export function availabilityOf(
  platform: OemPlatform,
  signal: CanonicalSignalId,
): SignalAvailability {
  return CAPABILITY_MATRIX[platform]?.[signal] ?? "unavailable";
}

/**
 * Only "validated" signals may feed a customer-facing KPI. Pending signals are
 * stored and visible on the raw telemetry page, but never drive an analytic.
 */
export function isUsableForKpi(platform: OemPlatform, signal: CanonicalSignalId): boolean {
  return availabilityOf(platform, signal) === "validated";
}

export interface ObservabilitySets {
  availableSignals: CanonicalSignalId[];
  pendingSignals: CanonicalSignalId[];
  unavailableSignals: CanonicalSignalId[];
}

export function observabilitySets(platform: OemPlatform): ObservabilitySets {
  const availableSignals: CanonicalSignalId[] = [];
  const pendingSignals: CanonicalSignalId[] = [];
  const unavailableSignals: CanonicalSignalId[] = [];
  for (const signal of CANONICAL_SIGNALS) {
    const a = availabilityOf(platform, signal);
    if (a === "validated") availableSignals.push(signal);
    else if (a === "pending") pendingSignals.push(signal);
    else unavailableSignals.push(signal);
  }
  return { availableSignals, pendingSignals, unavailableSignals };
}

/**
 * Which analytics a platform can honestly support. Consumed by the API so the UI
 * can render an explicit "not available on this platform" state instead of a
 * fabricated number.
 */
export interface AnalyticFeasibility {
  cellImbalance: boolean;
  packThermal: boolean;
  coulombCountedSoh: boolean;
  cycleCountProxy: boolean;
  measuredHarshEvents: boolean;
  derivedHarshEvents: boolean;
  chargingSessions: boolean;
  energyAccounting: boolean;
}

export function analyticFeasibility(platform: OemPlatform): AnalyticFeasibility {
  const has = (s: CanonicalSignalId) => isUsableForKpi(platform, s);
  return {
    cellImbalance: has("batt.cell_voltage_v"),
    packThermal: has("batt.cell_temp_c"),
    coulombCountedSoh: has("batt.pack_current_a") && has("batt.pack_voltage_v"),
    cycleCountProxy: has("batt.soc_pct"),
    measuredHarshEvents: has("drv.harsh_brake_count"),
    derivedHarshEvents: has("veh.speed_kph"),
    chargingSessions: has("chg.status"),
    energyAccounting: has("batt.pack_current_a"),
  };
}
