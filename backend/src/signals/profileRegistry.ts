/**
 * Loads, validates and indexes the per-platform signal profiles.
 *
 * Profiles are DATA, not code: when Intellicar promotes a pending parameter or
 * renames a JSON key, you edit a JSON file and bump the profile version. No
 * analytics code changes.
 */
import { z } from "zod";
import { CANONICAL_SIGNALS, type CanonicalSignalId, type OemPlatform, type AssetClass } from "./canonical.js";
import { CAPABILITY_MATRIX } from "./capabilities.js";

import zeo from "./profiles/mahindra_zeo@2026-09-03.json" with { type: "json" };
import tata from "./profiles/tata_ace_ev@2026-09-03.json" with { type: "json" };
import sw from "./profiles/switch_ev@2026-09-03.json" with { type: "json" };
import eicher from "./profiles/eicher_ev@2026-09-03.json" with { type: "json" };

const guardsSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  monotonic: z.boolean().optional(),
  maxJumpPerMinute: z.number().optional(),
  maxRatePerMinute: z.number().optional(),
  rollover: z.boolean().optional(),
});

export type Guards = z.infer<typeof guardsSchema>;

const signalDefSchema = z.object({
  source: z.string().min(1),
  canonical: z.enum(CANONICAL_SIGNALS),
  unit: z.string().optional(),
  type: z.enum(["number", "boolean", "enum", "array", "bitflag"]),
  status: z.enum(["validated", "pending"]),
  /** "confirmed" = verified against Intellicar getarbidparammap; "assumed" = inferred. */
  keySource: z.enum(["confirmed", "assumed"]).default("assumed"),
  note: z.string().optional(),
  arrayRange: z.tuple([z.number().int(), z.number().int()]).optional(),
  /** Key in the CAN payload holding the valid element count for an array signal. */
  countKey: z.string().optional(),
  bit: z.number().int().optional(),
  enumMap: z.record(z.string()).optional(),
  guards: guardsSchema.optional(),
});

export type SignalDef = z.infer<typeof signalDefSchema>;

const profileSchema = z.object({
  profileId: z.string().min(1),
  oemPlatform: z.enum(["mahindra_zeo", "tata_ace_ev", "switch_ev", "eicher_ev"]),
  assetClass: z.enum(["e2w", "e3w", "micro_4w", "scv", "lcv", "bus", "hcv"]),
  sourceDocument: z.string(),
  parameterCount: z.number().int().positive(),
  signals: z.array(signalDefSchema).min(1),
});

export type SignalProfile = z.infer<typeof profileSchema> & {
  oemPlatform: OemPlatform;
  assetClass: AssetClass;
  /** canonical -> defs (an array signal has one def; `indicators` yields two). */
  byCanonical: Map<CanonicalSignalId, SignalDef[]>;
};

function build(raw: unknown): SignalProfile {
  const parsed = profileSchema.parse(raw);

  const byCanonical = new Map<CanonicalSignalId, SignalDef[]>();
  for (const def of parsed.signals) {
    const list = byCanonical.get(def.canonical) ?? [];
    list.push(def);
    byCanonical.set(def.canonical, list);

    // Cross-check the profile against the capability matrix. A mismatch means one
    // of the two was edited without the other — fail loudly at boot, not silently
    // at 3am when a chart is empty.
    const declared = CAPABILITY_MATRIX[parsed.oemPlatform as OemPlatform]?.[def.canonical];
    if (declared !== def.status) {
      throw new Error(
        `Profile ${parsed.profileId}: signal ${def.canonical} is "${def.status}" in the profile ` +
          `but "${declared ?? "unavailable"}" in CAPABILITY_MATRIX. Reconcile both against the ` +
          `Intellicar validation report.`,
      );
    }

    if (def.type === "array" && (!def.arrayRange || !def.countKey)) {
      throw new Error(
        `Profile ${parsed.profileId}: array signal ${def.canonical} must declare arrayRange and ` +
          `countKey. Without countKey the normalizer cannot strip sentinel values.`,
      );
    }
  }

  return { ...parsed, oemPlatform: parsed.oemPlatform as OemPlatform, assetClass: parsed.assetClass as AssetClass, byCanonical };
}

const PROFILES: SignalProfile[] = [build(zeo), build(tata), build(sw), build(eicher)];

const byId = new Map(PROFILES.map((p) => [p.profileId, p]));
const byPlatform = new Map(PROFILES.map((p) => [p.oemPlatform, p]));

export function getProfile(profileId: string): SignalProfile | null {
  return byId.get(profileId) ?? null;
}

export function getProfileForPlatform(platform: OemPlatform): SignalProfile {
  const p = byPlatform.get(platform);
  if (!p) throw new Error(`No signal profile registered for platform "${platform}"`);
  return p;
}

export function listProfiles(): SignalProfile[] {
  return PROFILES;
}

/** Signals whose JSON key is still a guess — surface these until getarbidparammap confirms them. */
export function unconfirmedKeys(): Array<{ profileId: string; canonical: string; source: string }> {
  return PROFILES.flatMap((p) =>
    p.signals
      .filter((s) => s.keySource === "assumed")
      .map((s) => ({ profileId: p.profileId, canonical: s.canonical, source: s.source })),
  );
}
