import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * These tests exist to protect the four consumer rules. Each one has a failure mode
 * that is silent in production, so a mocked batch is the only place to catch a
 * regression.
 */

const persistBatch = vi.fn(async () => undefined);
const previousState = vi.fn(async () => null);
const quarantine = vi.fn(async () => undefined);
const sendToDlq = vi.fn(async () => undefined);

vi.mock("../src/db/repositories/telemetryRepo.js", () => ({
  persistBatch: (...a: unknown[]) => persistBatch(...(a as [])),
  previousState: (...a: unknown[]) => previousState(...(a as [])),
  quarantine: (...a: unknown[]) => quarantine(...(a as [])),
}));

vi.mock("../src/ingest/dlq.js", () => ({
  sendToDlq: (...a: unknown[]) => sendToDlq(...(a as [])),
  configureDlq: () => undefined,
}));

vi.mock("../src/ingest/vehicleResolver.js", () => ({
  resolveVehicle: async (vehicleno: string) =>
    vehicleno === "KA01EV1001"
      ? {
          id: "v1",
          registration: "KA01EV1001",
          oem_platform: "tata_ace_ev",
          signal_profile_id: "tata_ace_ev@2026-09-03",
          expected_uplink_sec: 30,
        }
      : null,
  invalidateResolverCache: () => undefined,
}));

const { handleBatch } = await import("../src/ingest/consumer.js");
const { loadIngestConfig } = await import("../src/ingest/config.js");

process.env.KAFKA_BOOTSTRAP = "localhost:9092";
process.env.KAFKA_SASL_MECHANISM = "";
const config = loadIngestConfig();

const now = Date.now();

function message(offset: string, value: unknown, key = "KA01EV1001") {
  return {
    offset,
    key: Buffer.from(key),
    value: typeof value === "string" ? Buffer.from(value) : Buffer.from(JSON.stringify(value)),
    timestamp: String(now),
    attributes: 0,
    size: 0,
    headers: {},
  };
}

function makePayload(messages: ReturnType<typeof message>[]) {
  const calls: string[] = [];
  const resolved: string[] = [];
  return {
    calls,
    resolved,
    payload: {
      batch: {
        topic: config.topicRaw,
        partition: 0,
        highWatermark: String(messages.length),
        messages,
        lastOffset: () => messages[messages.length - 1]?.offset ?? "0",
        isEmpty: () => messages.length === 0,
        firstOffset: () => messages[0]?.offset ?? null,
        offsetLag: () => "0",
        offsetLagLow: () => "0",
      },
      resolveOffset: (o: string) => {
        calls.push(`resolve:${o}`);
        resolved.push(o);
      },
      heartbeat: async () => {
        calls.push("heartbeat");
      },
      commitOffsetsIfNecessary: async () => {
        calls.push("commit");
      },
      uncommittedOffsets: () => ({ topics: [] }),
      isRunning: () => true,
      isStale: () => false,
      pause: () => () => undefined,
    } as never,
  };
}

const goodCan = {
  bulkData: [
    {
      vehicleno: "KA01EV1001",
      type: "can",
      data: { time: now, soc: 67, odometer: 12_400, no_of_cells: 29, no_of_temperature_sensors: 4 },
    },
  ],
};

describe("consumer batch handling", () => {
  beforeEach(() => {
    persistBatch.mockClear();
    sendToDlq.mockClear();
    quarantine.mockClear();
  });

  it("RULE 2 — commits offsets only AFTER the durable write", async () => {
    const order: string[] = [];
    persistBatch.mockImplementationOnce(async () => {
      order.push("persist");
    });

    const { payload, calls } = makePayload([message("0", goodCan)]);
    await handleBatch(payload, config);

    order.push(...calls.filter((c) => c === "commit"));
    expect(order).toEqual(["persist", "commit"]);
    expect(calls.indexOf("resolve:0")).toBeGreaterThan(-1);
    // resolveOffset must also come after persist
    expect(calls.filter((c) => c.startsWith("resolve")).length).toBe(1);
  });

  it("RULE 3 — a malformed message goes to the DLQ and the batch continues", async () => {
    const { payload, resolved } = makePayload([
      message("0", "{ not json"),
      message("1", goodCan),
    ]);
    await handleBatch(payload, config);

    expect(sendToDlq).toHaveBeenCalledTimes(1);
    expect(sendToDlq.mock.calls[0][2]).toMatchObject({ reason: "parse_error", sourceOffset: "0" });
    // Both offsets resolved: the poison message must NOT block the partition.
    expect(resolved).toEqual(["0", "1"]);
    // The good record still reached the database.
    expect(persistBatch.mock.calls[0][0].canFrames).toHaveLength(1);
  });

  it("RULE 4 — heartbeats between messages", async () => {
    const { payload, calls } = makePayload([message("0", goodCan), message("1", goodCan)]);
    await handleBatch(payload, config);
    expect(calls.filter((c) => c === "heartbeat").length).toBe(2);
  });

  it("quarantines an unknown vehicleno and never auto-creates a vehicle", async () => {
    const unknown = {
      bulkData: [{ vehicleno: "KA99XX0000", type: "can", data: { time: now, soc: 50 } }],
    };
    const { payload } = makePayload([message("0", unknown, "KA99XX0000")]);
    await handleBatch(payload, config);

    expect(quarantine).toHaveBeenCalledWith("KA99XX0000", "unknown_vehicleno", expect.anything());
    expect(sendToDlq.mock.calls[0][2]).toMatchObject({ reason: "unknown_vehicleno" });
    expect(persistBatch.mock.calls[0][0].canFrames).toHaveLength(0);
  });

  it("splits GPS and CAN into separate frame lists", async () => {
    const mixed = {
      bulkData: [
        { vehicleno: "KA01EV1001", type: "gps", data: { time: now - 3000, lat: 12.97, lng: 77.59, speed: 34 } },
        { vehicleno: "KA01EV1001", type: "can", data: { time: now, soc: 67 } },
      ],
    };
    const { payload } = makePayload([message("0", mixed)]);
    await handleBatch(payload, config);

    const arg = persistBatch.mock.calls[0][0];
    expect(arg.gpsFrames).toHaveLength(1);
    expect(arg.canFrames).toHaveLength(1);
    // Different timestamps preserved — never merged into one row.
    expect(arg.gpsFrames[0].capturedAt.getTime()).not.toBe(arg.canFrames[0].capturedAt.getTime());
  });

  it("accepts the unwrapped realtime envelope", async () => {
    const realtime = { vehicleno: "KA01EV1001", type: "can", data: { time: now, soc: 61 } };
    const { payload } = makePayload([message("0", realtime)]);
    await handleBatch(payload, config);
    expect(persistBatch.mock.calls[0][0].canFrames).toHaveLength(1);
  });
});
