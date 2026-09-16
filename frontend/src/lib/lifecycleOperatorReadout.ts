import type { AssetLifecycleStage } from "@/types/api";

export type OperatorReadout = { summary: string; findings: string[]; actions: string[] };

/**
 * Uses API `operator*` fields when present; otherwise builds the same readout locally
 * so older backends (e.g. Render not redeployed) still show a full diagnosis.
 */
export function resolveLifecycleOperatorReadout(a: AssetLifecycleStage): OperatorReadout {
  const s = a.operatorSummary?.trim();
  if (s) {
    return {
      summary: s,
      findings: a.operatorFindings ?? [],
      actions: a.operatorActions ?? [],
    };
  }
  return buildLocalOperatorReadout(a);
}

/** Keep aligned with `backend/src/services/prognosis.ts` → `buildLifecycleOperatorReadout`. */
function buildLocalOperatorReadout(a: AssetLifecycleStage): OperatorReadout {
  const reg = a.registration;
  const H = a.heuristics;
  const p = a.prognosis;
  const lastWear = a.wearSeries[a.wearSeries.length - 1]?.wearIndex ?? 50;
  const canGps = H.telemetryMode === "can_gps";

  const findings: string[] = [];
  const actions: string[] = [];

  let headline = "";
  if (a.stage === "retire_candidate") {
    headline = `${reg} — retirement candidate: odometer and wear profile suggest exiting primary revenue duty soon.`;
    actions.push("Book end-of-life workshop sign-off (mechanical + traction pack).");
    actions.push("Align with finance on replacement, auction, or second-life redeployment.");
  } else if (a.stage === "watch") {
    headline = `${reg} — watch list: utilisation and wear sit above the usual band for this fleet cohort.`;
    actions.push("Schedule extended diagnostics before the next high-season demand spike.");
    if (canGps) {
      actions.push("Export last 14 days of CAN motor temp and Δcell for OEM or pack engineer review.");
    }
  } else if (a.stage === "ramp") {
    headline = `${reg} — early life (ramp): first ~8k km should stay gentle while the wear curve settles.`;
    actions.push("Avoid sustained low-SOC returns and heavy payload until utilisation normalises.");
  } else {
    headline = `${reg} — steady service: headline indicators sit inside the normal envelope for this asset class.`;
  }

  if (H.kmToNextMajorService <= 1500) {
    findings.push(
      `Major service is imminent — about ${H.kmToNextMajorService.toLocaleString("en-IN")} km remaining (~${p.estimatedMonthsToMajorService} months at implied fleet usage).`,
    );
    actions.push(`Aim to complete service on or before ${p.nextMajorServiceDueLabel}.`);
  } else if (H.kmToNextMajorService <= 4000) {
    findings.push(
      `Major service is approaching: ~${H.kmToNextMajorService.toLocaleString("en-IN")} km to the planned ${a.projectedMajorServiceKm.toLocaleString("en-IN")} km odometer target (planning date ${p.nextMajorServiceDueLabel}).`,
    );
    actions.push("Pre-order parts and hold a depot bay before the shaded window tightens.");
  } else {
    findings.push(
      `Next major service is targeted near ${a.projectedMajorServiceKm.toLocaleString("en-IN")} km odometer (${p.nextMajorServiceDueLabel} on the planning calendar).`,
    );
  }

  findings.push(
    `The shaded band on the wear chart is the acceptable booking window (${p.majorServiceWindowKm[0].toLocaleString("en-IN")}–${p.majorServiceWindowKm[1].toLocaleString("en-IN")} km).`,
  );

  if (H.dataConfidence === "low") {
    findings.push(
      "Telemetry confidence is low (missing link or mode): distance-based indices are indicative only — confirm with inspection before deferring service.",
    );
    actions.push("Restore continuous GPS uplink or upgrade to CAN+GPS if workshop decisions depend on this screen.");
  } else if (H.dataConfidence === "medium") {
    findings.push(
      "GPS-only path: thermal and parts of the wear model are inferred from odometer and policy defaults, not live inverter temperature.",
    );
  } else if (H.canObservability === "partial") {
    findings.push(
      "CAN uplink is present but this platform does not expose cell temperatures or voltages — thermal and Δcell views are unavailable, not inferred.",
    );
  } else if (H.canObservability === "full") {
    findings.push("CAN + GPS uplink present: thermal and electrical stress views are grounded in live gateway data.");
  } else {
    findings.push("CAN + GPS uplink present: thermal and electrical stress views are grounded in live gateway data.");
  }

  if (H.dutyCycleIndex >= 76) {
    findings.push(
      `Duty-cycle index is high (${H.dutyCycleIndex}/100) versus typical urban 2W dispatch — compare with shift logs for overload.`,
    );
    actions.push("Review route length, swap policy, and peak-hour dispatch with the depot supervisor.");
  }

  if (canGps && H.canObservability === "full" && (H.thermalStressIndex ?? 0) >= 68) {
    findings.push(
      `CAN thermal stress is elevated (${H.thermalStressIndex}/100): motor or stage temperatures often leave the comfort band.`,
    );
    actions.push("Correlate trips with grade and ambient temperature; consider staggered charging to reduce heat-soak starts.");
  }

  if (H.depthOfDischargeScore <= 42) {
    findings.push(
      `Depth-of-discharge score is low (${H.depthOfDischargeScore}/100): assets often return with SOC under a healthy band, which accelerates calendar fade.`,
    );
    actions.push("Raise minimum reporting SOC in depot charging policy where operations allow.");
  } else if (H.depthOfDischargeScore >= 78) {
    findings.push(
      `Depth-of-discharge score is strong (${H.depthOfDischargeScore}/100): riders are landing in a gentler average SOC band.`,
    );
  }

  if (H.reliabilityIndex < 52) {
    findings.push(
      `Composite reliability index is ${H.reliabilityIndex}/100 (wear endpoint ${lastWear}): modelled unplanned downtime risk is higher than peers.`,
    );
    actions.push("Add a fortnightly mechanical inspection until the index recovers or service is completed.");
  } else if (H.reliabilityIndex >= 78) {
    findings.push(`Reliability index ${H.reliabilityIndex}/100 supports keeping standard PM cadence without extra audits.`);
  }

  findings.push(
    `Model envelope before major overhaul band: about ${p.remainingUsefulLifeKm.toLocaleString("en-IN")} km of remaining useful life (RUL).`,
  );

  if (H.warrantyClockMonthsRemaining != null) {
    findings.push(
      `Nominal warranty-style clock (demo): ~${H.warrantyClockMonthsRemaining} months remain on a 36-month style programme for budgeting.`,
    );
  }

  if (actions.length === 0) {
    actions.push("Maintain current preventive-maintenance schedule; re-check after the next utilisation review cycle.");
  }

  return {
    summary: headline,
    findings: findings.slice(0, 8),
    actions: actions.slice(0, 6),
  };
}
