/**
 * Intellicar push envelope.
 *
 * Two shapes arrive on the same topic:
 *   Batch:    { "bulkData": [ { vehicleno, type, data }, ... ] }
 *   Realtime: { vehicleno, type, data }            (no wrapper)
 *
 * GPS and CAN are SEPARATE records with SEPARATE timestamps — Intellicar's docs state
 * the two sources are sampled at different rates and do not sync. They must never be
 * merged into one row.
 *
 * CAN payloads are SPARSE and DYNAMIC: "we will send all parameters we receive and
 * exclude any parameters we don't receive". An absent key means NOT RECEIVED, never
 * zero. So we validate `time` only and keep every other key verbatim.
 */
import { z } from "zod";

/** 13-digit epoch milliseconds, roughly 2001-09-09 .. 2033-05-18. */
const epochMs = z.number().int().min(1e12).max(2e12);

export const gpsDataSchema = z
  .object({
    time: epochMs,
    lat: z.number().min(-90).max(90),
    lng: z.number().min(-180).max(180),
    alti: z.number().optional(),
    speed: z.number().min(0).max(250).optional(),
    ignstatus: z.number().int().optional(),
    head: z.number().min(0).max(360).optional(),
  })
  .passthrough();

/** Deliberately permissive: only `time` is structural. Everything else is profile-driven. */
export const canDataSchema = z.object({ time: epochMs }).passthrough();

export const recordSchema = z.discriminatedUnion("type", [
  z.object({ vehicleno: z.string().min(1), type: z.literal("gps"), data: gpsDataSchema }),
  z.object({ vehicleno: z.string().min(1), type: z.literal("can"), data: canDataSchema }),
]);

export const envelopeSchema = z.union([
  z.object({ bulkData: z.array(recordSchema).min(1) }),
  recordSchema,
]);

export type IntellicarRecord = z.infer<typeof recordSchema>;
export type IntellicarEnvelope = z.infer<typeof envelopeSchema>;

export function flattenEnvelope(envelope: IntellicarEnvelope): IntellicarRecord[] {
  return "bulkData" in envelope ? envelope.bulkData : [envelope];
}

export interface ParseResult {
  ok: boolean;
  records: IntellicarRecord[];
  error?: string;
}

export function parseEnvelope(buffer: Buffer | string): ParseResult {
  let json: unknown;
  try {
    json = JSON.parse(typeof buffer === "string" ? buffer : buffer.toString("utf8"));
  } catch (err) {
    return { ok: false, records: [], error: `invalid_json: ${(err as Error).message}` };
  }
  const parsed = envelopeSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, records: [], error: `schema: ${JSON.stringify(parsed.error.flatten())}` };
  }
  return { ok: true, records: flattenEnvelope(parsed.data) };
}

/**
 * `vehicleno` is Intellicar's ONLY join key and it is a human-entered registration
 * number. Normalize aggressively so "KA 01 EV 1001", "ka-01-ev-1001" and "KA01EV1001"
 * resolve to one vehicle.
 */
export function normalizeVehicleno(raw: string): string {
  return raw.toUpperCase().replace(/[\s\-_.]/g, "");
}
