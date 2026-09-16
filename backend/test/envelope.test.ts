import { describe, expect, it } from "vitest";
import { normalizeVehicleno, parseEnvelope } from "../src/ingest/envelope.js";

describe("parseEnvelope", () => {
  it("accepts a batch wrapper", () => {
    const r = parseEnvelope(
      JSON.stringify({
        bulkData: [{ vehicleno: "KA 01 EV 1001", type: "can", data: { time: 1757320800000, soc: 67 } }],
      }),
    );
    expect(r.ok).toBe(true);
    expect(r.records).toHaveLength(1);
  });

  it("accepts a bare realtime record", () => {
    const r = parseEnvelope(
      JSON.stringify({ vehicleno: "KA01EV1001", type: "gps", data: { time: 1757320800000, lat: 12.97, lng: 77.59 } }),
    );
    expect(r.ok).toBe(true);
    expect(r.records[0]?.type).toBe("gps");
  });

  it("rejects 10-digit epoch seconds", () => {
    const r = parseEnvelope(JSON.stringify({ vehicleno: "X", type: "can", data: { time: 1757320800 } }));
    expect(r.ok).toBe(false);
  });

  it("rejects invalid json", () => {
    expect(parseEnvelope("{ not json").ok).toBe(false);
  });
});

describe("normalizeVehicleno", () => {
  it("collapses case and separators", () => {
    expect(normalizeVehicleno("ka-01 ev_1001")).toBe("KA01EV1001");
  });
});
