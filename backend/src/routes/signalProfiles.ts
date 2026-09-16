/** Signal profiles + capability matrix. Drives the UI's honest empty states. */
import { Router } from "express";
import { listProfiles, unconfirmedKeys } from "../signals/profileRegistry.js";
import { analyticFeasibility, CAPABILITY_MATRIX, observabilitySets } from "../signals/capabilities.js";
import { FILE_CANONICAL_MAP } from "../signals/fileMap.js";
import {
  CANONICAL_SIGNALS,
  DOMAIN_LABELS,
  OEM_PLATFORMS,
  SIGNAL_LABELS,
  SIGNAL_UNITS,
  domainOf,
} from "../signals/canonical.js";

export const signalProfilesRouter = Router();

signalProfilesRouter.get("/", (_req, res) => {
  res.json({
    profiles: listProfiles().map((p) => ({
      profileId: p.profileId,
      oemPlatform: p.oemPlatform,
      assetClass: p.assetClass,
      sourceDocument: p.sourceDocument,
      parameterCount: p.parameterCount,
      signalCount: p.signals.length,
      pendingSignals: p.signals.filter((s) => s.status === "pending").map((s) => s.canonical),
    })),
    capabilityMatrix: CAPABILITY_MATRIX,
    feasibility: Object.fromEntries(OEM_PLATFORMS.map((p) => [p, analyticFeasibility(p)])),
    observability: Object.fromEntries(OEM_PLATFORMS.map((p) => [p, observabilitySets(p)])),
    dictionary: CANONICAL_SIGNALS.map((id) => ({
      id,
      label: SIGNAL_LABELS[id],
      unit: SIGNAL_UNITS[id],
      domain: domainOf(id),
      domainLabel: DOMAIN_LABELS[domainOf(id)],
    })),
    unconfirmedKeys: unconfirmedKeys(),
    fileCanonicalMap: FILE_CANONICAL_MAP,
  });
});
