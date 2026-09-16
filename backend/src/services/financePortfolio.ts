import type {
  AssetLifecycleStage,
  BatteryHealthPoint,
  PortfolioValuationEnterprise,
  PortfolioValuationItem,
  PortfolioValuationPayload,
  PortfolioValueBand,
  Vehicle,
} from "../types/domain.js";

function clamp01(n: number): number {
  return Math.min(1, Math.max(0, n));
}

function listPriceInr(v: Vehicle): number {
  const m = v.model.toLowerCase();
  if (m.includes("ace")) return 950_000;
  if (m.includes("zor")) return 425_000;
  if (m.includes("pro x") || m.includes("prox")) return 380_000;
  return Math.round((88_000 + v.kwhPack * 36_000 + v.model.length * 900) / 500) * 500;
}

export function buildPortfolioValuation(
  vehicles: Vehicle[],
  batteryItems: BatteryHealthPoint[],
  lifecycleItems: AssetLifecycleStage[],
  now: Date,
): PortfolioValuationPayload {
  const batById = new Map(batteryItems.map((b) => [b.vehicleId, b]));
  const lifeById = new Map(lifecycleItems.map((l) => [l.vehicleId, l]));

  const items: PortfolioValuationItem[] = vehicles.map((v) => {
    const bat = batById.get(v.id);
    const life = lifeById.get(v.id);
    const soh = bat?.sohPercent ?? null;
    const observable = soh != null && bat?.sohMethod !== "unavailable";
    const indicative = listPriceInr(v);

    const odoF = clamp01(1 - v.odometerKm / 70_000);
    const pathKm = v.gpsMetrics?.pathKm ?? 0;
    const weeklyUtil = pathKm / 7;
    const utilF = pathKm > 0 ? clamp01(0.5 + weeklyUtil / 180) : 0.82;
    const sohF = observable ? clamp01(soh / 100) : utilF;
    let stack = odoF * (observable ? sohF : utilF) * (v.telemetryMode === "can_gps" ? 1.04 : 0.98);
    if (bat?.trend === "degrading") stack *= 0.93;
    if (life?.stage === "watch") stack *= 0.91;
    if (life?.stage === "retire_candidate") stack *= 0.84;
    if (!v.deviceId) stack *= 0.96;
    if (!observable) stack *= 0.92;

    const fmv = Math.round((indicative * stack) / 500) * 500;
    const leaseResidualFactor = clamp01(0.38 + sohF * 0.28 - Math.min(0.14, v.odometerKm / 180_000));
    const residual = Math.round((fmv * leaseResidualFactor) / 500) * 500;

    const notes: string[] = [];
    if (!observable) {
      notes.push(
        bat?.sohMethod === "unavailable"
          ? "SOH is unobservable on this asset — FMV uses odometer, GPS utilisation, and model list price only."
          : "No SOH estimate yet — FMV does not invent a health percentage.",
      );
    }
    if (!v.deviceId) notes.push("No live GPS/CAN link — confidence on usage and residual is lower.");
    if (bat?.trend === "degrading") notes.push("SOH trend marked degrading — model applies a sharper haircut.");
    if (life?.stage === "watch" || life?.stage === "retire_candidate") {
      notes.push("Lifecycle in watch or retire band — residual depends on remarketing and part-out assumptions.");
    }
    if (v.telemetryMode === "gps_only") {
      notes.push("GPS-only asset — pack SOH is unobservable; NBFC workflows should still require BMS evidence.");
    }
    if (notes.length === 0) notes.push("Sits in the normal band for a portfolio screen.");

    const valuationConfidence: PortfolioValuationItem["valuationConfidence"] = !observable
      ? "low"
      : bat?.prognosis.confidence === "high"
        ? "high"
        : "medium";

    let valueBand: PortfolioValueBand = "normal";
    if (!observable) valueBand = "soft";
    else if (stack >= 0.82) valueBand = "strong";
    else if (stack < 0.62) valueBand = "stressed";
    else if (stack < 0.75) valueBand = "soft";

    return {
      vehicleId: v.id,
      registration: v.registration,
      displayName: v.displayName,
      model: v.model,
      telemetryMode: v.telemetryMode,
      odometerKm: v.odometerKm,
      sohPercent: soh,
      sohObservable: observable,
      valuationConfidence,
      indicativeListPriceInr: indicative,
      fairMarketValueInr: fmv,
      residualValueInr: residual,
      valueBand,
      notes: notes.slice(0, 4),
    };
  });

  const totalFmv = items.reduce((s, i) => s + i.fairMarketValueInr, 0);
  const watchFmv = items
    .filter((i) => {
      const l = lifeById.get(i.vehicleId);
      return l?.stage === "watch" || l?.stage === "retire_candidate";
    })
    .reduce((s, i) => s + i.fairMarketValueInr, 0);

  const observed = items.filter((i) => i.sohPercent != null);
  const enterprise: PortfolioValuationEnterprise = {
    vehicleCount: items.length,
    totalIndicativeListInr: items.reduce((s, i) => s + i.indicativeListPriceInr, 0),
    totalFairMarketValueInr: totalFmv,
    totalResidualValueInr: items.reduce((s, i) => s + i.residualValueInr, 0),
    avgSohPercent: observed.length
      ? Math.round(observed.reduce((s, i) => s + (i.sohPercent ?? 0), 0) / observed.length)
      : null,
    portfolioRiskShare: totalFmv > 0 ? Math.round((watchFmv / totalFmv) * 1000) / 1000 : 0,
  };

  return {
    updatedAt: now.toISOString(),
    currency: "INR",
    disclaimer:
      "Indicative model only — not an appraisal, inspection report, or credit sanction. Pair with your policy, bureau data, and physical valuation before booking. SOH is omitted from the average when the platform cannot observe it.",
    assumedLeaseMonths: 36,
    enterprise,
    items,
  };
}
