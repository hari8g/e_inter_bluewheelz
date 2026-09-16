import type {
  AssetLifecycleHeuristics,
  AssetLifecycleStage,
  BatteryDeterioration,
  BatteryDeteriorationBreakdownPct,
  BatteryHealthPoint,
  BatteryHeuristics,
  DriverClassification,
  DriverSeed,
  Vehicle,
} from "../types/domain.js";

function seedHash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

function monthLabel(offset: number): string {
  const d = new Date();
  d.setMonth(d.getMonth() + offset);
  return d.toLocaleString("en-IN", { month: "short", year: "2-digit" });
}

/** Smoothstep for natural-looking SOH curves */
function smoothstep01(t: number): number {
  const x = Math.min(1, Math.max(0, t));
  return x * x * (3 - 2 * x);
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

type BatteryBase = Pick<
  BatteryHealthPoint,
  "vehicleId" | "registration" | "sohPercent" | "sohMethod" | "cycleEstimate" | "imbalanceMv" | "trend"
>;

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function clampNum(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

function normBreakdown(wCal: number, wCyc: number, wImb: number, wTherm: number): BatteryDeteriorationBreakdownPct {
  const s = wCal + wCyc + wImb + wTherm;
  if (s < 1e-6) {
    return { calendarAgeing: 25, cyclicElectrical: 25, cellImbalance: 25, thermalElectrical: 25 };
  }
  return {
    calendarAgeing: round1((wCal / s) * 100),
    cyclicElectrical: round1((wCyc / s) * 100),
    cellImbalance: round1((wImb / s) * 100),
    thermalElectrical: round1((wTherm / s) * 100),
  };
}

export function enrichBatteryHealth(vehicles: Vehicle[], base: BatteryBase[]): BatteryHealthPoint[] {
  return base.map((row, idx) => {
    const v = vehicles[idx];
    const h = seedHash(row.vehicleId);
    const nowSoh = row.sohPercent ?? 82;
    const odo = v?.odometerKm ?? 0;
    const can = v?.telemetryMode === "can_gps";
    // Past anchor: near-new pack (≤100%), with extra headroom above "now" so the curve shows clear ageing
    const packAgeDrop =
      row.trend === "degrading" ? 14 + (h % 9) * 0.6 : row.trend === "improving" ? 7 + (h % 5) * 0.5 : 10 + (h % 7) * 0.55;
    // Anchor past state near “as-new” (≤100%), with enough spread to show realistic fade to today
    const startSoh = Math.min(100, Math.max(98.2, nowSoh + packAgeDrop));
    const history: { period: string; soh: number }[] = [];
    for (let k = 0; k < 12; k++) {
      const t = k / 11;
      const u = smoothstep01(t);
      let soh = startSoh + (nowSoh - startSoh) * u;
      const wobble = ((((h >> k) & 7) + ((h >> (k + 3)) & 3)) / 10 - 0.45) * 0.12;
      soh = Math.min(100, Math.max(50, soh + wobble));
      history.push({ period: monthLabel(k - 11), soh: round1(soh) });
    }
    history[11] = { period: history[11]!.period, soh: round1(nowSoh) };
    // Oldest → newest: SOH non-increasing (calendar + cycle fade)
    for (let k = 1; k < 12; k++) {
      const cap = round1(history[k - 1]!.soh - 0.12);
      if (history[k]!.soh > cap) history[k] = { ...history[k]!, soh: cap };
    }
    history[11] = { period: history[11]!.period, soh: round1(nowSoh) };

    // Forecast: sustained calendar + cycle fade (clear downward vs today)
    const monthlyLoss =
      row.trend === "degrading"
        ? 0.48 + (h % 6) * 0.06
        : row.trend === "improving"
          ? 0.22 + (h % 4) * 0.04
          : 0.32 + (h % 5) * 0.05;
    const forecast: { period: string; soh: number }[] = [];
    let prev = nowSoh;
    for (let j = 1; j <= 6; j++) {
      const taper = 1 + (j - 1) * 0.04;
      prev = Math.max(68, prev - monthlyLoss * taper - ((h >> j) & 3) * 0.04);
      forecast.push({ period: monthLabel(j), soh: round1(prev) });
    }

    const last4 = history.slice(-4).map((x) => x.soh);
    let slopePerMonth = (last4[3]! - last4[0]!) / 3;
    if (slopePerMonth >= -0.03) {
      slopePerMonth = (forecast[0]!.soh - nowSoh) / 1;
    }
    if (slopePerMonth >= -0.02) {
      slopePerMonth = -monthlyLoss;
    }

    const m6 = forecast[5]!.soh;
    const decline6m = nowSoh - m6;
    const sohProjected12m = round1(Math.max(58, m6 - Math.max(0.15, decline6m / 6) * 6));

    let monthsTo80: number | null = null;
    if (nowSoh > 80 && slopePerMonth < -0.02) {
      monthsTo80 = Math.ceil((nowSoh - 80) / Math.abs(slopePerMonth));
      monthsTo80 = Math.min(120, Math.max(4, monthsTo80));
    } else if (nowSoh <= 80) {
      monthsTo80 = 0;
    }

    const mv = row.imbalanceMv ?? 20;
    let imbalanceRisk: BatteryHealthPoint["prognosis"]["imbalanceRisk"];
    if (can) {
      if (mv >= 52) imbalanceRisk = "elevated";
      else if (mv >= 36) imbalanceRisk = "watch";
      else imbalanceRisk = "normal";
    } else {
      if (mv >= 30) imbalanceRisk = "elevated";
      else if (mv >= 22) imbalanceRisk = "watch";
      else imbalanceRisk = "normal";
    }

    let confidence: BatteryHealthPoint["prognosis"]["confidence"] = "medium";
    if (can && v?.deviceId && (v.can?.bmsHealthScore ?? 0) >= 82) confidence = "high";
    else if (!v?.deviceId || (!can && odo > 22_000)) confidence = "low";

    const cellImbalanceSeverity0to100 = round1(clamp01((mv - (can ? 18 : 12)) / (can ? 52 : 34)) * 100);
    const expectedEfc = 380 + odo / 42;
    const cycleRatio = (row.cycleEstimate ?? 400) / Math.max(220, expectedEfc);
    const cycleLoadIndex0to100 = round1(clamp01((cycleRatio - 0.88) * 2.4 + 0.35 + (h % 9) / 100) * 100);
    const packCalendarAgeIndex0to100 = round1(clamp01(odo / 48_000) * 100);
    const thermalStress0to100 = v?.can && v.can.motorTempC != null
      ? round1(clamp01((v.can.motorTempC - 31) / 22) * 100)
      : null;
    const bmsObservationQuality0to100 = v?.can && v.can.bmsHealthScore != null
      ? round1(clamp01((v.can.bmsHealthScore - 65) / 34) * 100)
      : null;
    const soc = v?.socPercent ?? 55;
    const depthRaw = 48 + (100 - soc) * 0.82 + (soc < 26 ? 20 : 0) + (h % 8) * 0.6;
    const depthOfDischargeStress0to100 = round1(clampNum(depthRaw, 14, 98));
    const modelHealthScore0to100 = round1(
      clampNum(
        0.5 * nowSoh +
          0.14 * (100 - cellImbalanceSeverity0to100) +
          0.12 * (100 - cycleLoadIndex0to100) +
          0.1 * (100 - packCalendarAgeIndex0to100) +
          0.1 * (100 - depthOfDischargeStress0to100) +
          0.08 * (100 - (thermalStress0to100 ?? 32)) +
          (bmsObservationQuality0to100 != null ? 0.06 * bmsObservationQuality0to100 : 3),
        38,
        99,
      ),
    );

    const rationale: string[] = [];
    if (can && mv >= 36) rationale.push(`Measured Δcell ${mv} mV — balancing workload likely rising.`);
    else if (!can && mv >= 22) rationale.push(`Inferred cell spread ${mv} mV (GPS-only) — confirm with workshop BMS read when possible.`);
    if (cycleRatio > 1.05) rationale.push("Equivalent full cycles run ahead of distance-implied norm — check duty mix.");
    else if (cycleRatio < 0.95) rationale.push("Cycles trail distance norm — gentler electrical load vs cohort.");
    if (thermalStress0to100 != null && thermalStress0to100 >= 55) rationale.push("CAN thermal headroom is tightening; correlate with summer routes and charge timing.");
    else if (depthOfDischargeStress0to100 >= 62) rationale.push("Frequent low-SOC operation accelerates fade vs mid-band operation.");
    if (rationale.length === 0) rationale.push("Indices sit inside expected 2W urban envelope for this telemetry mode.");

    const past12mSohLossPct = round1(Math.max(0, history[0]!.soh - nowSoh));
    const projectedNext12mLossPct = round1(Math.max(0, nowSoh - sohProjected12m));
    const impliedHistoricalFadePctPerMonth = round1(past12mSohLossPct / 12);
    const impliedForecastFadePctPerMonth = round1((nowSoh - m6) / 6);

    const wCal = Math.pow(odo / 44_000, 1.05) * 34 + (h % 8);
    const wCyc = clamp01(((row.cycleEstimate ?? 400) - 360) / 820) * 30 + (row.trend === "degrading" ? 14 : row.trend === "improving" ? 4 : 8);
    // Fade-driver mix for ops charts: deterministic from pack id + odometer (not live CAN noise),
    // so the attributed-fade view stays steady between refreshes while stress tiles still use live CAN.
    const mvAttribution = can
      ? 24 + (h % 33) + Math.min(14, Math.floor(odo / 12_000))
      : mv;
    const wImbAttribution = clamp01(mvAttribution / (can ? 58 : 36)) * 36 + (mvAttribution >= (can ? 44 : 28) ? 10 : 0);
    const thermAttribution = can ? 5 + ((h >> 5) % 15) : 7 + (h % 6);
    const wThermAttribution = can ? clamp01(thermAttribution / 16) * 28 + 4 : thermAttribution;
    const breakdownPastFade = normBreakdown(wCal, wCyc, wImbAttribution, wThermAttribution);

    const deterioration: BatteryDeterioration = {
      past12mSohLossPct,
      projectedNext12mLossPct,
      impliedHistoricalFadePctPerMonth,
      impliedForecastFadePctPerMonth,
      breakdownPastFade,
    };

    const heuristics: BatteryHeuristics = {
      cellImbalanceSeverity0to100,
      cycleLoadIndex0to100,
      packCalendarAgeIndex0to100,
      thermalStress0to100,
      bmsObservationQuality0to100,
      depthOfDischargeStress0to100,
      modelHealthScore0to100,
      rationale,
    };

    const summary =
      row.trend === "degrading"
        ? `Pack fading faster than fleet median (${past12mSohLossPct}% SOH over trailing 12 mo). At current slope, plan deep diagnostics within ${monthsTo80 ?? "N/A"} months if SOH below 80% is your retire band.`
        : row.trend === "improving"
          ? "Recent balancing / thermal improvement suggests transient recovery; keep CAN logging on to confirm persistence."
          : `Trajectory is near-flat (${past12mSohLossPct}% trailing fade); continue scheduled balancing checks and seasonal temperature audits.`;
    return {
      ...row,
      sohPercent: nowSoh,
      sohMethod: row.sohMethod ?? "demo",
      cycleEstimate: row.cycleEstimate ?? 400,
      imbalanceMv: mv,
      sohHistory: history,
      sohForecast: forecast,
      heuristics,
      deterioration,
      prognosis: {
        thresholdSoh: 80,
        monthsToThreshold: monthsTo80,
        sohProjected12m: sohProjected12m,
        confidence,
        summary,
        imbalanceRisk,
      },
    };
  });
}

type LifecycleBase = Pick<
  AssetLifecycleStage,
  "vehicleId" | "registration" | "stage" | "utilizationScore" | "projectedMajorServiceKm" | "odometerKm" | "notes"
>;

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

type LifecyclePrognosisBrief = Pick<
  AssetLifecycleStage["prognosis"],
  "remainingUsefulLifeKm" | "estimatedMonthsToMajorService" | "nextMajorServiceDueLabel" | "majorServiceWindowKm"
>;

/** Plain-language readout for workshop / control-room operators (not raw model jargon). */
function buildLifecycleOperatorReadout(
  row: LifecycleBase,
  v: Vehicle,
  H: AssetLifecycleHeuristics,
  prognosis: LifecyclePrognosisBrief,
  lastWearIndex: number,
): Pick<AssetLifecycleStage, "operatorSummary" | "operatorFindings" | "operatorActions"> {
  const reg = row.registration;
  const findings: string[] = [];
  const actions: string[] = [];

  let headline = "";
  if (row.stage === "retire_candidate") {
    headline = `${reg} — retirement candidate: odometer and wear profile suggest exiting primary revenue duty soon.`;
    actions.push("Book end-of-life workshop sign-off (mechanical + traction pack).");
    actions.push("Align with finance on replacement, auction, or second-life redeployment.");
  } else if (row.stage === "watch") {
    headline = `${reg} — watch list: utilisation and wear sit above the usual band for this fleet cohort.`;
    actions.push("Schedule extended diagnostics before the next high-season demand spike.");
    if (v.telemetryMode === "can_gps") {
      actions.push("Export last 14 days of CAN motor temp and Δcell for OEM or pack engineer review.");
    }
  } else if (row.stage === "ramp") {
    headline = `${reg} — early life (ramp): first ~8k km should stay gentle while the wear curve settles.`;
    actions.push("Avoid sustained low-SOC returns and heavy payload until utilisation normalises.");
  } else {
    headline = `${reg} — steady service: headline indicators sit inside the normal envelope for this asset class.`;
  }

  if (H.kmToNextMajorService <= 1500) {
    findings.push(
      `Major service is imminent — about ${H.kmToNextMajorService.toLocaleString("en-IN")} km remaining (~${prognosis.estimatedMonthsToMajorService} months at implied fleet usage).`,
    );
    actions.push(`Aim to complete service on or before ${prognosis.nextMajorServiceDueLabel}.`);
  } else if (H.kmToNextMajorService <= 4000) {
    findings.push(
      `Major service is approaching: ~${H.kmToNextMajorService.toLocaleString("en-IN")} km to the planned ${row.projectedMajorServiceKm.toLocaleString("en-IN")} km odometer target (planning date ${prognosis.nextMajorServiceDueLabel}).`,
    );
    actions.push("Pre-order parts and hold a depot bay before the shaded window tightens.");
  } else {
    findings.push(
      `Next major service is targeted near ${row.projectedMajorServiceKm.toLocaleString("en-IN")} km odometer (${prognosis.nextMajorServiceDueLabel} on the planning calendar).`,
    );
  }

  findings.push(
    `The shaded band on the wear chart is the acceptable booking window (${prognosis.majorServiceWindowKm[0].toLocaleString("en-IN")}–${prognosis.majorServiceWindowKm[1].toLocaleString("en-IN")} km).`,
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
  } else {
    findings.push("CAN + GPS uplink present: thermal and electrical stress views are grounded in live gateway data.");
  }

  if (H.dutyCycleIndex >= 76) {
    findings.push(
      `Duty-cycle index is high (${H.dutyCycleIndex}/100) versus typical urban 2W dispatch — compare with shift logs for overload.`,
    );
    actions.push("Review route length, swap policy, and peak-hour dispatch with the depot supervisor.");
  }

  if (v.telemetryMode === "can_gps" && (H.thermalStressIndex ?? 0) >= 68) {
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
      `Composite reliability index is ${H.reliabilityIndex}/100 (wear endpoint ${lastWearIndex}): modelled unplanned downtime risk is higher than peers.`,
    );
    actions.push("Add a fortnightly mechanical inspection until the index recovers or service is completed.");
  } else if (H.reliabilityIndex >= 78) {
    findings.push(`Reliability index ${H.reliabilityIndex}/100 supports keeping standard PM cadence without extra audits.`);
  }

  findings.push(
    `Model envelope before major overhaul band: about ${prognosis.remainingUsefulLifeKm.toLocaleString("en-IN")} km of remaining useful life (RUL).`,
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
    operatorSummary: headline,
    operatorFindings: findings.slice(0, 8),
    operatorActions: actions.slice(0, 6),
  };
}

export function enrichLifecycle(vehicles: Vehicle[], base: LifecycleBase[]): AssetLifecycleStage[] {
  return base.map((row, idx) => {
    const v = vehicles[idx]!;
    const h = seedHash(row.vehicleId + "lc");
    const startKm = Math.max(0, v.odometerKm - 9000);
    const series: { km: number; wearIndex: number }[] = [];
    const steps = 10;
    /** End-point wear (today) — same rough scale as before. */
    const endWear = Math.min(
      100,
      Math.round(35 + (v.odometerKm / 250) + ((h >> 11) & 7) + (v.telemetryMode === "can_gps" ? 6 : 0)),
    );
    /** Start near 0 at the left of the window so the chart reads as “build-up over life”, not a floating band. */
    const startWear = Math.max(0, Math.min(6, 1 + (h % 4) * 0.8));
    for (let i = 0; i <= steps; i++) {
      const km = startKm + ((v.odometerKm - startKm) * i) / steps;
      const t = i / steps;
      const u = smoothstep01(t);
      let wearIndex = startWear + (endWear - startWear) * u + ((((h >> i) & 3) - 1) * 0.35);
      wearIndex = clamp(round1(wearIndex), 0, 100);
      series.push({ km: Math.round(km), wearIndex });
    }
    for (let k = 1; k < series.length; k++) {
      if (series[k]!.wearIndex + 1e-6 < series[k - 1]!.wearIndex) {
        series[k] = { ...series[k]!, wearIndex: series[k - 1]!.wearIndex };
      }
    }
    series[series.length - 1] = { ...series[series.length - 1]!, wearIndex: endWear };
    const rulKm = Math.max(2000, 52000 - v.odometerKm - (h % 4000));
    const lo = row.projectedMajorServiceKm - 1800;
    const hi = row.projectedMajorServiceKm + 2200;
    const summary =
      row.stage === "retire_candidate"
        ? "Retirement watch: align capital planning with second-life repurposing or auction."
        : row.stage === "watch"
          ? "Elevated wear vs cohort — schedule CAN-backed pack audit before next monsoon peak."
          : row.stage === "ramp"
            ? "Ramp phase: bias toward gentle depth-of-discharge until 8k km equivalent."
            : "Steady state: keep current PM cadence; telemetry variance within expected band.";

    const kmToNextMajorService = Math.max(0, row.projectedMajorServiceKm - v.odometerKm);
    const impliedKmPerMonth = 560 + row.utilizationScore * 4.8 + (h % 140);
    const estimatedMonthsToMajorService = Math.max(0.25, kmToNextMajorService / impliedKmPerMonth);
    const due = new Date();
    due.setDate(due.getDate() + Math.round(estimatedMonthsToMajorService * 30.44));
    const nextMajorServiceDueIso = due.toISOString().slice(0, 10);
    const nextMajorServiceDueLabel = due.toLocaleDateString("en-IN", {
      weekday: "short",
      day: "numeric",
      month: "short",
      year: "numeric",
    });

    const dutyCycleIndex = clamp(Math.round(38 + row.utilizationScore * 0.52 + (h % 12)), 0, 100);
    let thermalStressIndex: number | null =
      v.telemetryMode === "can_gps" ? 42 + (h % 22) : null;
    if (v.can && v.can.motorTempC != null) {
      thermalStressIndex = clamp(Math.round(((v.can.motorTempC - 28) / 26) * 100), 8, 98);
    }
    const depthOfDischargeScore = clamp(
      Math.round(v.socPercent < 22 ? 36 : v.socPercent < 38 ? 55 : 72 + (v.socPercent / 3) - (h % 8)),
      18,
      98,
    );
    const calendarAgeMonths = clamp(Math.round(v.odometerKm / 440 + (h % 5)), 6, 96);
    const lastWear = series[series.length - 1]?.wearIndex ?? 50;
    const reliabilityIndex = clamp(
      Math.round(100 - lastWear * 0.38 - (row.stage === "watch" ? 10 : row.stage === "retire_candidate" ? 16 : 4)),
      22,
      99,
    );
    const warrantyUsedMonths = clamp(Math.floor(v.odometerKm / 1450), 0, 48);
    const warrantyClockMonthsRemaining =
      warrantyUsedMonths < 38 ? Math.max(0, Math.round(36 - warrantyUsedMonths + (h % 4))) : null;

    const dataConfidence: AssetLifecycleHeuristics["dataConfidence"] =
      v.telemetryMode === "can_gps" && v.deviceId ? "high" : v.deviceId ? "medium" : "low";

    const flags: string[] = [];
    if (row.utilizationScore >= 82) flags.push("High duty cycle");
    if (v.can && v.can.motorTempC != null && v.can.motorTempC >= 42) flags.push("Thermal load elevated");
    if (v.socPercent < 28) flags.push("Deep discharge exposure");
    if (row.stage === "watch" || row.stage === "retire_candidate") flags.push("Lifecycle watchlist");
    if (v.telemetryMode === "gps_only") flags.push("Wear model partially inferred (GPS-only)");
    if (kmToNextMajorService < 2500) flags.push("Major service window closing");
    if (flags.length === 0) flags.push("Within nominal envelope");

    const heuristics: AssetLifecycleHeuristics = {
      telemetryMode: v.telemetryMode,
      canObservability: v.telemetryMode === "can_gps" ? "full" : "gps_only",
      kmToNextMajorService,
      dutyCycleIndex,
      thermalStressIndex,
      depthOfDischargeScore,
      calendarAgeMonths,
      reliabilityIndex,
      warrantyClockMonthsRemaining,
      dataConfidence,
      flags: flags.slice(0, 5),
    };

    const prognosisBlock: AssetLifecycleStage["prognosis"] = {
      remainingUsefulLifeKm: rulKm,
      majorServiceWindowKm: [lo, hi],
      summary,
      nextDecisionGate: monthLabel(2),
      nextMajorServiceDueIso,
      nextMajorServiceDueLabel,
      estimatedMonthsToMajorService: round1(estimatedMonthsToMajorService),
    };

    const operator = buildLifecycleOperatorReadout(row, v, heuristics, prognosisBlock, lastWear);

    const enriched: AssetLifecycleStage = {
      ...row,
      wearSeries: series,
      heuristics,
      ...operator,
      prognosis: prognosisBlock,
    };
    return enriched;
  });
}

export function enrichDrivers(base: DriverSeed[]): DriverClassification[] {
  return base.map((d) => {
    const h = seedHash(d.driverId);
    const smoothness = Math.min(100, Math.max(68, d.safetyScore + (h % 4) - (d.band === "C" ? 6 : 0)));
    const ecoDrive = d.energyEfficiencyPercentile;
    const compliance = Math.min(100, Math.max(58, Math.round(d.safetyScore * 0.94 + (h % 5))));
    const fatigueRisk =
      d.band === "A" ? 14 + (h % 7) : d.band === "B" ? 24 + (h % 9) : 40 + (h % 11);
    const weeks = 10;
    const safetyHistory: { week: string; score: number }[] = [];
    const startLift = d.band === "A" ? 5 : d.band === "B" ? 9 : 14;
    const startSafety = Math.min(96, d.safetyScore + startLift);
    let idx = 0;
    for (let i = -weeks + 1; i <= 0; i++) {
      const wk = `W${String(Math.abs(i) + 1).padStart(2, "0")}`;
      const t = idx / (weeks - 1);
      const u = smoothstep01(t);
      const noise = (((h >> (idx + 2)) & 5) - 2) * 0.35;
      const score = Math.min(100, Math.max(38, startSafety + (d.safetyScore - startSafety) * u + noise));
      safetyHistory.push({ week: wk, score: Math.round(score) });
      idx++;
    }
    safetyHistory[safetyHistory.length - 1] = {
      ...safetyHistory[safetyHistory.length - 1]!,
      score: d.safetyScore,
    };
    const tail = safetyHistory.slice(-4).reduce((a, b) => a + b.score, 0) / 4;
    const projectedBand90d: "A" | "B" | "C" = tail > 82 ? "A" : tail > 68 ? "B" : "C";
    const priority =
      d.band === "C" || projectedBand90d === "C" ? "intervene" : d.band === "B" ? "coach" : "maintain";
    const summary =
      priority === "intervene"
        ? "Riding style needs a closer look: pair this rider with a supervisor for a few weeks and cut harsh acceleration until scores improve."
        : priority === "coach"
          ? "Doing okay overall — a short refresher on smooth riding and saving battery will lift scores without much hassle."
          : "Strong, safe riding — good example for new joiners; keep recognising steady habits.";
    return {
      ...d,
      eventSource: "demo" as const,
      profile: { smoothness, ecoDrive, compliance, fatigueRisk },
      safetyHistory,
      prognosis: { summary, projectedBand90d, priority, reviewBy: monthLabel(1) },
    };
  });
}
