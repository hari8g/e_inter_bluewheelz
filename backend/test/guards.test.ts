import { describe, expect, it } from "vitest";
import {
  applyMonotonicGuard,
  applyRateGuard,
  deriveCellDeltaMv,
  normalizeTimestamp,
  truncateArray,
} from "../src/ingest/guards.js";

describe("truncateArray — the -80 sentinel", () => {
  it("excludes absent sensors using no_of_temperature_sensors", () => {
    // Intellicar's own sample: 6 temperature keys, but only 4 real sensors.
    const raw = [38, 38, 38, 38, -80, -80];
    const r = truncateArray(raw, 4, { min: -40, max: 90 });

    expect(r.values).toEqual([38, 38, 38, 38]);
    expect(r.complete).toBe(true);
    expect(Math.max(...r.values)).toBe(38);
    expect(Math.min(...r.values)).toBe(38); // NOT -80
  });

  it("would corrupt aggregates if the count key were ignored", () => {
    const raw = [38, 38, 38, 38, -80, -80];

    // A pack genuinely sitting at 38 C reads as -1.3 C on a naive mean,
    // and -80 C on a naive minimum, which would fire a false thermal alarm.
    const naiveMean = raw.reduce((a, b) => a + b, 0) / raw.length;
    expect(naiveMean).toBeCloseTo(-1.33, 2);
    expect(Math.min(...raw)).toBe(-80);

    const guarded = truncateArray(raw, 4, { min: -40, max: 90 });
    expect(guarded.values.reduce((a, b) => a + b, 0) / guarded.values.length).toBe(38);
    expect(Math.min(...guarded.values)).toBe(38);
  });

  it("range-filters after truncation and reports incompleteness", () => {
    const r = truncateArray([3.6, 99, 3.61, 3.59], 4, { min: 2.0, max: 4.5 });
    expect(r.values).toEqual([3.6, 3.61, 3.59]);
    expect(r.complete).toBe(false);
    expect(r.rejected).toBe(1);
  });

  it("falls back to full length when the count key is missing", () => {
    const r = truncateArray([3.6, 3.61], undefined, { min: 2, max: 4.5 });
    expect(r.values).toHaveLength(2);
  });
});

describe("deriveCellDeltaMv", () => {
  it("computes the spread from a complete pack", () => {
    const cells = Array.from({ length: 29 }, (_, i) => 3.6 + (i === 0 ? 0.05 : 0));
    const { deltaMv } = deriveCellDeltaMv(cells, 29);
    expect(deltaMv).toBeCloseTo(50, 0);
  });

  it("returns null for a partial pack rather than a misleading number", () => {
    const { deltaMv, reason } = deriveCellDeltaMv([3.6, 3.61, 3.59], 29);
    expect(deltaMv).toBeNull();
    expect(reason).toBe("incomplete");
  });

  it("accepts a pack that is 90% reported", () => {
    const cells = Array.from({ length: 27 }, () => 3.6);
    expect(deriveCellDeltaMv(cells, 29).deltaMv).not.toBeNull();
  });
});

describe("odometer monotonicity", () => {
  const guards = { min: 0, max: 1_000_000, monotonic: true, maxJumpPerMinute: 3 };

  it("accepts a plausible forward step", () => {
    expect(applyMonotonicGuard(12_402, 12_400, 1, guards)).toEqual({ ok: true, value: 12_402 });
  });

  it("rejects a backward jump", () => {
    const v = applyMonotonicGuard(12_000, 12_400, 1, guards);
    expect(v.ok).toBe(false);
  });

  it("rejects an implausible spike", () => {
    const v = applyMonotonicGuard(99_000, 12_400, 1, guards);
    expect(v.ok).toBe(false);
  });

  it("accepts anything when there is no stored previous value", () => {
    expect(applyMonotonicGuard(12_400, null, Infinity, guards).ok).toBe(true);
  });
});

describe("SOC rate guard", () => {
  const guards = { min: 0, max: 100, maxRatePerMinute: 8 };

  it("admits DC fast charging", () => {
    expect(applyRateGuard(70, 60, 2, guards).ok).toBe(true); // 5 %/min
  });

  it("rejects a decode artefact", () => {
    expect(applyRateGuard(95, 20, 1, guards).ok).toBe(false); // 75 %/min
  });
});

describe("timestamps", () => {
  it("clamps a forward-dated capture to receipt time and records skew", () => {
    const received = new Date("2026-09-08T10:00:00Z");
    const { capturedAt, skewSeconds } = normalizeTimestamp(received.getTime() + 120_000, received);
    expect(capturedAt.getTime()).toBe(received.getTime());
    expect(skewSeconds).toBe(120);
  });

  it("leaves a normal backdated capture alone", () => {
    const received = new Date("2026-09-08T10:00:00Z");
    const { capturedAt } = normalizeTimestamp(received.getTime() - 3_000, received);
    expect(capturedAt.getTime()).toBe(received.getTime() - 3_000);
  });
});
