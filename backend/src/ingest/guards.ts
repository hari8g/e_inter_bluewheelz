/**
 * Data quality guards.
 *
 * Every guard here exists because of a specific, observed failure mode in real
 * telematics feeds. Read the comments before relaxing any of them.
 */
import type { SignalQuality } from "../signals/canonical.js";
import type { Guards } from "../signals/profileRegistry.js";

export type GuardVerdict<T> = { ok: true; value: T } | { ok: false; reason: SignalQuality };

export function inRange(value: number, guards?: Guards): boolean {
  if (!guards) return true;
  if (guards.min !== undefined && value < guards.min) return false;
  if (guards.max !== undefined && value > guards.max) return false;
  return true;
}

export function applyRangeGuard(value: number, guards?: Guards): GuardVerdict<number> {
  if (!Number.isFinite(value)) return { ok: false, reason: "out_of_range" };
  return inRange(value, guards) ? { ok: true, value } : { ok: false, reason: "out_of_range" };
}

/**
 * Odometer monotonicity.
 *
 * ECU resets and CAN decode errors produce backward jumps and six-digit spikes. A
 * single bad odometer poisons distance, duty cycle, RUL and residual value at once.
 *
 * `previous` MUST come from stored neighbouring frames, not from "the last frame I
 * saw" — Kafka delivers out of order, and a last-seen comparison would falsely
 * reject a legitimate late arrival.
 */
export function applyMonotonicGuard(
  value: number,
  previous: number | null,
  minutesSincePrevious: number,
  guards?: Guards,
): GuardVerdict<number> {
  const range = applyRangeGuard(value, guards);
  if (!range.ok) return range;
  if (!guards?.monotonic || previous === null) return { ok: true, value };

  if (value < previous) {
    // A large backward step is a counter rollover if the profile allows it.
    if (guards.rollover && previous - value > (guards.max ?? Infinity) * 0.8) {
      return { ok: true, value };
    }
    return { ok: false, reason: "out_of_range" };
  }

  if (guards.maxJumpPerMinute !== undefined) {
    const elapsed = Math.max(minutesSincePrevious, 1 / 60);
    if ((value - previous) / elapsed > guards.maxJumpPerMinute) {
      return { ok: false, reason: "out_of_range" };
    }
  }
  return { ok: true, value };
}

/** Rate-of-change guard, used for SOC (catches bit-shift errors, admits DC fast charge). */
export function applyRateGuard(
  value: number,
  previous: number | null,
  minutesSincePrevious: number,
  guards?: Guards,
): GuardVerdict<number> {
  const range = applyRangeGuard(value, guards);
  if (!range.ok) return range;
  if (guards?.maxRatePerMinute === undefined || previous === null) return { ok: true, value };
  const elapsed = Math.max(minutesSincePrevious, 1 / 60);
  const rate = Math.abs(value - previous) / elapsed;
  return rate > guards.maxRatePerMinute ? { ok: false, reason: "out_of_range" } : { ok: true, value };
}

export interface TruncateResult {
  values: number[];
  /** True when `count` elements were present and in range. */
  complete: boolean;
  /** How many raw elements were dropped as sentinels or out of range. */
  rejected: number;
  expected: number;
}

/**
 * THE MOST IMPORTANT GUARD IN THIS FILE.
 *
 * Intellicar sends fixed-width arrays and fills absent sensors with sentinel values.
 * Their own sample payload shows:
 *
 *     "no_of_temperature_sensors": 4,
 *     "cell_temperature_01": 38, ... "cell_temperature_04": 38,
 *     "cell_temperature_05": -80, "cell_temperature_06": -80
 *
 * Sensors 5 and 6 do not exist. Average all six and a pack sitting at 38 °C reads
 * as -13 °C; take the max across six and you still look fine, but take the MIN and
 * you get -80 and a false thermal alarm.
 *
 * Truncate to `count` FIRST, then range-filter. Never aggregate an untruncated array.
 */
export function truncateArray(
  raw: Array<number | undefined>,
  count: number | undefined,
  guards?: Guards,
): TruncateResult {
  const expected = count !== undefined && count > 0 ? Math.min(count, raw.length) : raw.length;
  const sliced = raw.slice(0, expected);

  const values: number[] = [];
  let rejected = 0;
  for (const v of sliced) {
    if (v === undefined || !Number.isFinite(v) || !inRange(v, guards)) {
      rejected++;
      continue;
    }
    values.push(v);
  }
  return { values, complete: values.length === expected && expected > 0, rejected, expected };
}

/**
 * Cell imbalance from measured cell voltages.
 *
 * Returns null unless at least 90% of the pack reported. A spread computed over a
 * partial pack is not an imbalance measurement — it is a sampling artefact, and
 * presenting it as Δcell would be exactly the kind of fabrication this pipeline exists
 * to eliminate.
 */
export function deriveCellDeltaMv(
  cellVoltages: number[],
  expectedCount: number,
): { deltaMv: number | null; reason?: SignalQuality } {
  if (expectedCount <= 0) return { deltaMv: null, reason: "unavailable" };
  if (cellVoltages.length < Math.ceil(expectedCount * 0.9)) {
    return { deltaMv: null, reason: "incomplete" };
  }
  const max = Math.max(...cellVoltages);
  const min = Math.min(...cellVoltages);
  return { deltaMv: Math.round((max - min) * 1000 * 100) / 100 };
}

/**
 * Timestamps.
 *
 * Intellicar sends epoch MILLISECONDS (13 digits). Devices with bad RTCs backdate
 * frames, so clamp forward-dated captures to receipt time and record the skew.
 */
export function normalizeTimestamp(
  epochMs: number,
  receivedAt: Date,
): { capturedAt: Date; skewSeconds: number } {
  const raw = new Date(epochMs);
  const skewSeconds = Math.round((raw.getTime() - receivedAt.getTime()) / 1000);
  const capturedAt = raw.getTime() > receivedAt.getTime() ? receivedAt : raw;
  return { capturedAt, skewSeconds };
}

export function coerceBoolean(value: unknown): boolean | undefined {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const v = value.trim().toLowerCase();
    if (["1", "true", "on", "yes"].includes(v)) return true;
    if (["0", "false", "off", "no"].includes(v)) return false;
  }
  return undefined;
}
