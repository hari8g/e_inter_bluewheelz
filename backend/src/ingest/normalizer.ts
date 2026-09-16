/**
 * Profile-driven normalizer: Intellicar CAN/GPS payload -> canonical frame.
 *
 * This is the ONLY place in the codebase that knows OEM parameter strings. Nothing
 * downstream should ever contain the literal "max_cell_voltage" or "Harsh Braking".
 */
import type { CanonicalSignalId, OemPlatform, SignalQuality } from "../signals/canonical.js";
import type { SignalDef, SignalProfile } from "../signals/profileRegistry.js";
import {
  applyMonotonicGuard,
  applyRangeGuard,
  applyRateGuard,
  coerceBoolean,
  deriveCellDeltaMv,
  normalizeTimestamp,
  truncateArray,
} from "./guards.js";
import type { IntellicarRecord } from "./envelope.js";

export interface PreviousState {
  odometerKm: number | null;
  socPercent: number | null;
  capturedAt: Date | null;
}

export interface NormalizedGpsFrame {
  kind: "gps";
  vehicleId: string;
  capturedAt: Date;
  receivedAt: Date;
  lat: number;
  lng: number;
  alti: number | null;
  speedKph: number | null;
  ignStatus: number | null;
  heading: number | null;
}

export interface NormalizedCanFrame {
  kind: "can";
  vehicleId: string;
  capturedAt: Date;
  receivedAt: Date;
  skewSeconds: number;
  /** Canonical signal -> value. Sparse by design: a missing key means not received. */
  signals: Partial<Record<CanonicalSignalId, number | string | boolean | number[]>>;
  quality: Partial<Record<CanonicalSignalId, SignalQuality>>;
  /** Every key exactly as received. Nothing is ever lost, so new params replay later. */
  raw: Record<string, unknown>;
  rejects: Array<{ signal: CanonicalSignalId; reason: SignalQuality; value?: unknown }>;
}

function readNumber(raw: Record<string, unknown>, key: string): number | undefined {
  const v = raw[key];
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return undefined;
}

/** Expands "cell_voltage_%02d" over [1,29] into the concrete payload keys. */
function expandArrayKeys(pattern: string, range: [number, number]): string[] {
  const keys: string[] = [];
  for (let i = range[0]; i <= range[1]; i++) {
    keys.push(pattern.replace("%02d", String(i).padStart(2, "0")).replace("%d", String(i)));
  }
  return keys;
}

function minutesBetween(a: Date | null, b: Date): number {
  if (!a) return Number.POSITIVE_INFINITY;
  return Math.abs(b.getTime() - a.getTime()) / 60000;
}

export function normalizeGps(
  record: Extract<IntellicarRecord, { type: "gps" }>,
  vehicleId: string,
  receivedAt = new Date(),
): NormalizedGpsFrame {
  const { capturedAt } = normalizeTimestamp(record.data.time, receivedAt);
  const d = record.data;
  return {
    kind: "gps",
    vehicleId,
    capturedAt,
    receivedAt,
    lat: d.lat,
    lng: d.lng,
    alti: typeof d.alti === "number" ? d.alti : null,
    speedKph: typeof d.speed === "number" ? d.speed : null,
    ignStatus: typeof d.ignstatus === "number" ? d.ignstatus : null,
    heading: typeof (d as Record<string, unknown>).head === "number" ? (d as { head: number }).head : null,
  };
}

export function normalizeCan(
  record: Extract<IntellicarRecord, { type: "can" }>,
  vehicleId: string,
  profile: SignalProfile,
  previous: PreviousState | null = null,
  receivedAt = new Date(),
): NormalizedCanFrame {
  const raw = record.data as Record<string, unknown>;
  const { capturedAt, skewSeconds } = normalizeTimestamp(record.data.time, receivedAt);
  const elapsedMin = minutesBetween(previous?.capturedAt ?? null, capturedAt);

  const frame: NormalizedCanFrame = {
    kind: "can",
    vehicleId,
    capturedAt,
    receivedAt,
    skewSeconds,
    signals: {},
    quality: {},
    raw,
    rejects: [],
  };

  const reject = (signal: CanonicalSignalId, reason: SignalQuality, value?: unknown) => {
    frame.quality[signal] = reason;
    frame.rejects.push({ signal, reason, value });
  };

  // Pending signals are stored and visible, but tagged so no KPI can consume them.
  const qualityFor = (def: SignalDef): SignalQuality =>
    def.status === "pending" ? "pending_validation" : "ok";

  for (const def of profile.signals) {
    switch (def.type) {
      case "array": {
        const keys = expandArrayKeys(def.source, def.arrayRange!);
        const present = keys.map((k) => readNumber(raw, k));
        if (present.every((v) => v === undefined)) {
          frame.quality[def.canonical] = "unavailable";
          break;
        }
        // Truncate by countKey BEFORE filtering. See guards.truncateArray.
        const count = def.countKey ? readNumber(raw, def.countKey) : undefined;
        const result = truncateArray(present, count, def.guards);
        if (result.values.length === 0) {
          reject(def.canonical, "out_of_range");
          break;
        }
        frame.signals[def.canonical] = result.values;
        frame.quality[def.canonical] = result.complete ? qualityFor(def) : "incomplete";
        break;
      }

      case "number": {
        const value = readNumber(raw, def.source);
        if (value === undefined) {
          frame.quality[def.canonical] = "unavailable";
          break;
        }
        let verdict;
        if (def.guards?.monotonic) {
          const prev = def.canonical === "veh.odometer_km" ? previous?.odometerKm ?? null : null;
          verdict = applyMonotonicGuard(value, prev, elapsedMin, def.guards);
        } else if (def.guards?.maxRatePerMinute !== undefined) {
          const prev = def.canonical === "batt.soc_pct" ? previous?.socPercent ?? null : null;
          verdict = applyRateGuard(value, prev, elapsedMin, def.guards);
        } else {
          verdict = applyRangeGuard(value, def.guards);
        }
        if (!verdict.ok) {
          reject(def.canonical, verdict.reason, value);
          break;
        }
        frame.signals[def.canonical] = verdict.value;
        frame.quality[def.canonical] = qualityFor(def);
        break;
      }

      case "boolean": {
        const value = coerceBoolean(raw[def.source]);
        if (value === undefined) {
          frame.quality[def.canonical] = "unavailable";
          break;
        }
        frame.signals[def.canonical] = value;
        frame.quality[def.canonical] = qualityFor(def);
        break;
      }

      case "bitflag": {
        const value = readNumber(raw, def.source);
        if (value === undefined || def.bit === undefined) {
          frame.quality[def.canonical] = "unavailable";
          break;
        }
        frame.signals[def.canonical] = ((value >> def.bit) & 1) === 1;
        frame.quality[def.canonical] = qualityFor(def);
        break;
      }

      case "enum": {
        const rawValue = raw[def.source];
        if (rawValue === undefined || rawValue === null) {
          frame.quality[def.canonical] = "unavailable";
          break;
        }
        const mapped = def.enumMap?.[String(rawValue)];
        if (mapped === undefined) {
          reject(def.canonical, "out_of_range", rawValue);
          break;
        }
        frame.signals[def.canonical] = mapped;
        frame.quality[def.canonical] = qualityFor(def);
        break;
      }
    }
  }

  applyDerivedSignals(frame, profile.oemPlatform, raw);
  return frame;
}

/**
 * Signals we compute rather than receive. Each is gated on its inputs actually
 * being present — never synthesised from a proxy.
 */
function applyDerivedSignals(
  frame: NormalizedCanFrame,
  _platform: OemPlatform,
  raw: Record<string, unknown>,
): void {
  // Δcell from measured cell voltages (Tata Ace EV only).
  const cells = frame.signals["batt.cell_voltage_v"];
  if (Array.isArray(cells)) {
    const expected = readNumber(raw, "no_of_cells") ?? cells.length;
    const { deltaMv, reason } = deriveCellDeltaMv(cells, expected);
    if (deltaMv !== null) {
      frame.signals["batt.cell_delta_mv"] = deltaMv;
      frame.quality["batt.cell_delta_mv"] = "ok";
      if (frame.signals["batt.cell_v_max"] === undefined) {
        frame.signals["batt.cell_v_max"] = Math.max(...cells);
        frame.quality["batt.cell_v_max"] = "ok";
      }
      if (frame.signals["batt.cell_v_min"] === undefined) {
        frame.signals["batt.cell_v_min"] = Math.min(...cells);
        frame.quality["batt.cell_v_min"] = "ok";
      }
    } else {
      frame.quality["batt.cell_delta_mv"] = reason ?? "incomplete";
    }
  }

  // Max/min cell temperature from the truncated array, when not sent directly.
  const temps = frame.signals["batt.cell_temp_c"];
  if (Array.isArray(temps) && temps.length > 0) {
    if (frame.signals["batt.cell_temp_max_c"] === undefined) {
      frame.signals["batt.cell_temp_max_c"] = Math.max(...temps);
      frame.quality["batt.cell_temp_max_c"] = "ok";
    }
    if (frame.signals["batt.cell_temp_min_c"] === undefined) {
      frame.signals["batt.cell_temp_min_c"] = Math.min(...temps);
      frame.quality["batt.cell_temp_min_c"] = "ok";
    }
  }

  // Pack power from measured voltage x signed current (Eicher only).
  const v = frame.signals["batt.pack_voltage_v"];
  const i = frame.signals["batt.pack_current_a"];
  if (typeof v === "number" && typeof i === "number") {
    frame.signals["batt.pack_power_kw"] = Math.round(((v * i) / 1000) * 100) / 100;
    frame.quality["batt.pack_power_kw"] = "ok";
  }
}
