/**
 * Live prognosis: only measured inputs. Demo synthesis lives in seed/demoPrognosis.ts.
 */
import { analyticFeasibility } from "../signals/capabilities.js";
import type {
  AssetLifecycleHeuristics,
  AssetLifecycleStage,
  BatteryDeterioration,
  BatteryDeteriorationBreakdownPct,
  BatteryHealthPoint,
  BatteryHeuristics,
  DriverClassification,
  Vehicle,
} from "../types/domain.js";
import type { SohEstimate } from "./soh.js";

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}
function clamp01(n: number): number {
  return clamp(n, 0, 1);
}
function monthLabel(offset: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return d.toLocaleString("en-IN", { month: "short", year: "2-digit" });
}

function emptyBreakdown(): BatteryDeteriorationBreakdownPct {
  return { calendarAgeing: 0, cyclicElectrical: 0, cellImbalance: 0, thermalElectrical: 0 };
}

export interface LiveBatteryInputs {
  soh: SohEstimate;
  efcAccrued: number;
  cellDeltaMvP95: number | null;
  thermalMinutesOver45c: number | null;
  coveragePct: number;
  history: { period: string; soh: number }[];
}

export function enrichLiveBattery(v: Vehicle, input: LiveBatteryInputs): BatteryHealthPoint {
  const feas = v.oemPlatform ? analyticFeasibility(v.oemPlatform) : null;
  const nowSoh = input.soh.sohPercent;
  const mv = feas?.cellImbalance ? input.cellDeltaMvP95 : null;
  const unavailable = input.soh.method === "unavailable" || nowSoh == null;

  let imbalanceRisk: BatteryHealthPoint["prognosis"]["imbalanceRisk"] = "normal";
  if (mv == null) imbalanceRisk = "normal";
  else if (mv >= 52) imbalanceRisk = "elevated";
  else if (mv >= 36) imbalanceRisk = "watch";

  const confidence: BatteryHealthPoint["prognosis"]["confidence"] =
    input.coveragePct >= 80 && !unavailable ? "high" : input.coveragePct >= 40 ? "medium" : "low";

  const cellImbalanceSeverity0to100 = mv == null ? 0 : round1(clamp01((mv - 18) / 52) * 100);
  const cycleLoadIndex0to100 = round1(clamp01(input.efcAccrued / 800) * 100);
  const packCalendarAgeIndex0to100 = v.commissionedOn
    ? round1(clamp01(monthsSince(v.commissionedOn) / 60) * 100)
    : round1(clamp01(v.odometerKm / 80_000) * 100);
  const thermalStress0to100 =
    feas?.packThermal && input.thermalMinutesOver45c != null
      ? round1(clamp01(input.thermalMinutesOver45c / 120) * 100)
      : null;
  const bmsObservationQuality0to100 = round1(clamp(input.coveragePct, 0, 100));
  const depthOfDischargeStress0to100 = round1(clamp(48 + (100 - v.socPercent) * 0.5, 10, 98));
  const modelHealthScore0to100 = nowSoh == null
    ? 0
    : round1(clamp(0.55 * nowSoh + 0.2 * (100 - cellImbalanceSeverity0to100) + 0.15 * bmsObservationQuality0to100, 0, 99));

  const rationale: string[] = [];
  if (unavailable) {
    rationale.push(
      `${v.oemPlatform ?? "This platform"} does not expose a capacity or cell-level health channel. SOC, DTE and cycle proxy are shown; SOH % is unavailable.`,
    );
  } else if (input.soh.method === "ocv_incremental") {
    rationale.push("Value is a pack-condition index from Δcell, not a coulomb-counted capacity %.");
  } else if (input.soh.method === "coulomb_counted") {
    rationale.push(
      input.soh.lastEstimateAt
        ? `Coulomb-counted from rest windows; last estimate ${input.soh.lastEstimateAt.slice(0, 10)} (${input.soh.sampleCount} samples).`
        : "Coulomb-counted SOH waiting for a rest window with |ΔSOC| ≥ 30%.",
    );
  }
  if (mv != null && mv >= 36) rationale.push(`Measured Δcell p95 ${mv} mV.`);
  if (thermalStress0to100 != null && thermalStress0to100 >= 55) rationale.push("Pack spent elevated minutes above 45 °C.");
  if (rationale.length === 0) rationale.push("Measured indices sit inside the expected envelope for this platform.");

  const history = input.history;
  const past12mSohLossPct = history.length >= 2 && nowSoh != null
    ? round1(Math.max(0, history[0]!.soh - nowSoh))
    : 0;
  const forecast = nowSoh == null ? [] : buildForecast(nowSoh, past12mSohLossPct);
  const sohProjected12m = forecast.length ? forecast[forecast.length - 1]!.soh : nowSoh ?? 0;
  const monthsTo80 =
    nowSoh != null && nowSoh > 80 && past12mSohLossPct > 0.4
      ? Math.min(120, Math.ceil((nowSoh - 80) / Math.max(0.05, past12mSohLossPct / 12)))
      : nowSoh != null && nowSoh <= 80
        ? 0
        : null;

  const breakdown = unavailable
    ? emptyBreakdown()
    : {
        calendarAgeing: packCalendarAgeIndex0to100 > 0 ? round1((packCalendarAgeIndex0to100 / (packCalendarAgeIndex0to100 + cycleLoadIndex0to100 + cellImbalanceSeverity0to100 + (thermalStress0to100 ?? 0) + 1)) * 100) : 0,
        cyclicElectrical: 0,
        cellImbalance: 0,
        thermalElectrical: 0,
      };
  if (!unavailable) {
    const wCal = packCalendarAgeIndex0to100 + 8;
    const wCyc = cycleLoadIndex0to100 + 8;
    const wImb = feas?.cellImbalance ? cellImbalanceSeverity0to100 + 4 : 0;
    const wTh = thermalStress0to100 ?? 0;
    const s = wCal + wCyc + wImb + wTh || 1;
    breakdown.calendarAgeing = round1((wCal / s) * 100);
    breakdown.cyclicElectrical = round1((wCyc / s) * 100);
    breakdown.cellImbalance = round1((wImb / s) * 100);
    breakdown.thermalElectrical = round1((wTh / s) * 100);
  }

  const deterioration: BatteryDeterioration = {
    past12mSohLossPct,
    projectedNext12mLossPct: nowSoh == null ? 0 : round1(Math.max(0, nowSoh - sohProjected12m)),
    impliedHistoricalFadePctPerMonth: round1(past12mSohLossPct / 12),
    impliedForecastFadePctPerMonth: nowSoh == null ? 0 : round1(Math.max(0, nowSoh - sohProjected12m) / 12),
    breakdownPastFade: breakdown,
  };

  const heuristics: BatteryHeuristics = {
    cellImbalanceSeverity0to100: feas?.cellImbalance ? cellImbalanceSeverity0to100 : 0,
    cycleLoadIndex0to100,
    packCalendarAgeIndex0to100,
    thermalStress0to100,
    bmsObservationQuality0to100,
    depthOfDischargeStress0to100,
    modelHealthScore0to100,
    rationale,
  };

  const summary = unavailable
    ? "SOH is not observable on this platform. Do not treat EFC or SOC as a health percentage."
    : input.soh.method === "ocv_incremental"
      ? `Pack-condition index ${nowSoh}% from cell spread. Not a capacity SOH.`
      : nowSoh == null
        ? "Waiting for a valid coulomb-count window (rest ≥20 min and |ΔSOC| ≥ 30%)."
        : `Measured SOH ${nowSoh}%. Coverage ${input.coveragePct}% over 24 h.`;

  return {
    vehicleId: v.id,
    registration: v.registration,
    sohPercent: nowSoh,
    sohMethod: input.soh.method,
    cycleEstimate: Math.round(input.efcAccrued),
    imbalanceMv: mv,
    lastEstimateAt: input.soh.lastEstimateAt,
    trend: past12mSohLossPct > 4 ? "degrading" : "stable",
    sohHistory: history,
    sohForecast: forecast,
    heuristics,
    deterioration,
    prognosis: {
      thresholdSoh: 80,
      monthsToThreshold: unavailable ? null : monthsTo80,
      sohProjected12m,
      confidence,
      summary,
      imbalanceRisk: mv == null ? "normal" : imbalanceRisk,
    },
  };
}

function monthsSince(iso: string): number {
  const then = new Date(iso);
  return Math.max(0, (Date.now() - then.getTime()) / (30.44 * 86_400_000));
}

function buildForecast(nowSoh: number, past12mLoss: number): { period: string; soh: number }[] {
  const monthly = Math.max(0.05, past12mLoss / 12);
  const out: { period: string; soh: number }[] = [];
  let prev = nowSoh;
  for (let j = 1; j <= 6; j++) {
    prev = Math.max(40, prev - monthly);
    out.push({ period: monthLabel(j), soh: round1(prev) });
  }
  return out;
}

export function enrichLiveLifecycle(
  v: Vehicle,
  opts: {
    efc: number;
    thermalMinutes: number | null;
    coveragePct: number;
    ignOnPct?: number;
    movingPct?: number;
    distanceDeltaKm?: number | null;
    idleMin?: number | null;
    lowAuxV?: boolean;
  },
): AssetLifecycleStage {
  const feas = v.oemPlatform ? analyticFeasibility(v.oemPlatform) : null;
  const serviceEvery = v.oemPlatform === "eicher_ev" ? 20_000 : v.oemPlatform === "tata_ace_ev" ? 10_000 : 8_000;
  const projectedMajorServiceKm = Math.ceil((v.odometerKm + 1) / serviceEvery) * serviceEvery;
  const kmToNextMajorService = Math.max(0, projectedMajorServiceKm - v.odometerKm);
  const stage =
    v.odometerKm > serviceEvery * 4 ? "watch" : v.odometerKm < serviceEvery * 0.4 ? "ramp" : "steady";
  const utilizationScore =
    opts.ignOnPct != null
      ? clamp(Math.round(opts.ignOnPct * 0.65 + (opts.movingPct ?? opts.ignOnPct) * 0.35), 10, 99)
      : clamp(Math.round(40 + opts.efc * 0.4 + v.odometerKm / 800), 10, 99);

  const startKm = Math.max(0, v.odometerKm - 9000);
  const wearSeries: { km: number; wearIndex: number }[] = [];
  const endWear = clamp(Math.round(v.odometerKm / 400 + opts.efc / 8), 0, 100);
  for (let i = 0; i <= 10; i++) {
    const km = Math.round(startKm + ((v.odometerKm - startKm) * i) / 10);
    wearSeries.push({ km, wearIndex: round1((endWear * i) / 10) });
  }

  const impliedKmPerMonth = 800;
  const estimatedMonthsToMajorService = Math.max(0.25, kmToNextMajorService / impliedKmPerMonth);
  const due = new Date();
  due.setDate(due.getDate() + Math.round(estimatedMonthsToMajorService * 30.44));

  const thermalStressIndex =
    v.telemetryMode !== "can_gps"
      ? null
      : feas?.packThermal && opts.thermalMinutes != null
        ? clamp(Math.round(opts.thermalMinutes / 1.2), 0, 100)
        : null;
  const canObservability: AssetLifecycleHeuristics["canObservability"] =
    v.telemetryMode !== "can_gps" ? "gps_only" : feas?.cellImbalance || feas?.packThermal ? "full" : "partial";
  const dataConfidence: AssetLifecycleHeuristics["dataConfidence"] =
    opts.coveragePct >= 80 ? "high" : opts.coveragePct >= 40 ? "medium" : "low";

  const flags: string[] = [];
  if (canObservability === "partial") flags.push("CAN present; cell thermal/imbalance not exposed");
  if (feas && !feas.packThermal && v.telemetryMode === "can_gps") flags.push("No pack thermal stream");
  if (v.socPercent > 0 && v.socPercent < 28) flags.push("Deep discharge exposure");
  if (kmToNextMajorService < 2500) flags.push("Major service window closing");
  if (opts.distanceDeltaKm != null && Math.abs(opts.distanceDeltaKm) > 40) {
    flags.push(`GPS–report distance delta ${opts.distanceDeltaKm} km`);
  }
  if (opts.lowAuxV) flags.push("12V sag on GPS trace");
  if (opts.idleMin != null && opts.idleMin > 60) flags.push(`High idle (${Math.round(opts.idleMin)} min)`);
  if (!flags.length) flags.push("Within measured envelope");

  const heuristics: AssetLifecycleHeuristics = {
    telemetryMode: v.telemetryMode,
    canObservability,
    kmToNextMajorService,
    dutyCycleIndex: utilizationScore,
    thermalStressIndex,
    depthOfDischargeScore: v.socPercent > 0 ? clamp(Math.round(v.socPercent), 10, 98) : clamp(Math.round(opts.ignOnPct ?? 50), 10, 98),
    calendarAgeMonths: v.commissionedOn ? Math.round(monthsSince(v.commissionedOn)) : Math.round(v.odometerKm / 800),
    reliabilityIndex: clamp(100 - endWear * 0.4, 20, 99),
    warrantyClockMonthsRemaining: v.commissionedOn
      ? Math.max(0, 36 - Math.round(monthsSince(v.commissionedOn)))
      : null,
    dataConfidence,
    flags: flags.slice(0, 5),
  };

  const grounded = canObservability === "full";
  const findings: string[] = [
    `Next major service near ${projectedMajorServiceKm.toLocaleString("en-IN")} km (${due.toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}).`,
  ];
  if (!grounded) {
    findings.push(
      canObservability === "partial"
        ? "CAN uplink is present but this platform does not expose cell temperatures or voltages — thermal and Δcell views are unavailable, not inferred."
        : "GPS-only path: thermal and electrical stress are not measured.",
    );
  } else {
    findings.push("Cell-level CAN is present: thermal and imbalance views use measured frames.");
  }

  const prognosis = {
    remainingUsefulLifeKm: Math.max(2000, serviceEvery * 6 - v.odometerKm),
    majorServiceWindowKm: [projectedMajorServiceKm - 1800, projectedMajorServiceKm + 2200] as [number, number],
    summary: stage === "watch" ? "Elevated wear vs commissioned life — schedule a pack audit." : "Steady measured duty.",
    nextDecisionGate: monthLabel(2),
    nextMajorServiceDueIso: due.toISOString().slice(0, 10),
    nextMajorServiceDueLabel: due.toLocaleDateString("en-IN", { weekday: "short", day: "numeric", month: "short", year: "numeric" }),
    estimatedMonthsToMajorService: round1(estimatedMonthsToMajorService),
  };

  return {
    vehicleId: v.id,
    registration: v.registration,
    stage,
    utilizationScore,
    projectedMajorServiceKm,
    odometerKm: v.odometerKm,
    notes: grounded ? "CAN-backed wear model." : "Observability-limited; no fabricated thermal claim.",
    wearSeries,
    heuristics,
    operatorSummary: `${v.registration} — ${stage.replace("_", " ")} on ${v.oemPlatform ?? v.model}.`,
    operatorFindings: findings.slice(0, 8),
    operatorActions: grounded
      ? ["Keep current PM cadence; re-check after the next utilisation review."]
      : ["Do not schedule thermal diagnostics from this screen — the platform does not expose cell temperature."],
    prognosis,
  };
}

export function enrichLiveDrivers(
  v: Vehicle,
  counts: { total: number; source: DriverClassification["eventSource"] },
): DriverClassification {
  const harsh = counts.total;
  const safety = clamp(96 - harsh * 3, 35, 98);
  const band: "A" | "B" | "C" = safety >= 85 ? "A" : safety >= 68 ? "B" : "C";
  const unavailable = counts.source === "unavailable";
  return {
    driverId: `veh-${v.id}`,
    vehicleId: v.id,
    label: v.registration,
    eventSource: counts.source,
    safetyScore: unavailable ? 0 : safety,
    energyEfficiencyPercentile: unavailable ? 0 : clamp(90 - Math.round((100 - v.socPercent) / 4), 20, 99),
    harshEvents7d: unavailable ? 0 : harsh,
    band: unavailable ? "C" : band,
    profile: {
      smoothness: unavailable ? 0 : safety,
      ecoDrive: unavailable ? 0 : clamp(v.socPercent, 20, 99),
      compliance: unavailable ? 0 : safety,
      fatigueRisk: unavailable ? 0 : clamp(harsh * 4, 8, 70),
    },
    safetyHistory: [],
    prognosis: {
      summary: unavailable
        ? "Harsh-event scoring is unavailable: speed is not sampled at ≥1 Hz and this platform has no measured harsh channels. Scores are not inferred."
        : counts.source === "can_measured"
          ? "Events come from the vehicle CAN harsh channels. This scores the asset, not a named driver."
          : "Events derived from speed. This scores the asset, not a named driver.",
      projectedBand90d: band,
      priority: unavailable ? "maintain" : band === "C" ? "intervene" : band === "B" ? "coach" : "maintain",
      reviewBy: monthLabel(1),
    },
  };
}
