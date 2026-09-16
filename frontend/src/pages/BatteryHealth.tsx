import { Activity, TrendingDown, TrendingUp, Waves } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  Bar,
  BarChart,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceArea,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/api/client";
import { SignalGate } from "@/components/SignalGate";
import { chart, cartesianGrid, axisProps, tooltipProps } from "@/lib/chartTheme";
import { PageHeader } from "@/layout/AppShell";
import { Card } from "@/ui/Card";
import type { BatteryDeteriorationBreakdownPct, BatteryHealthPoint } from "@/types/api";

const BD_COLORS = {
  calendarAgeing: "#64748b",
  cyclicElectrical: "#7c3aed",
  cellImbalance: "#d97706",
  thermalElectrical: "#e11d48",
} as const;

function TrendIcon({ t }: { t: BatteryHealthPoint["trend"] }) {
  if (t === "improving") return <TrendingUp className="h-4 w-4 text-emerald-600" />;
  if (t === "degrading") return <TrendingDown className="h-4 w-4 text-amber-600" />;
  return <Waves className="h-4 w-4 text-slate-500" />;
}

type SohPoint = { label: string; observed: number | null; forecast: number | null };

function mergeObservedForecast(b: BatteryHealthPoint): SohPoint[] {
  const h = b.sohHistory;
  const f = b.sohForecast;
  const rows: SohPoint[] = h.map((p) => ({
    label: p.period,
    observed: p.soh,
    forecast: null,
  }));
  const lastObs = h[h.length - 1]?.soh ?? 0;
  if (f.length) {
    rows.push({ label: f[0]!.period, observed: lastObs, forecast: f[0]!.soh });
    for (let i = 1; i < f.length; i++) {
      rows.push({ label: f[i]!.period, observed: null, forecast: f[i]!.soh });
    }
  }
  return rows;
}

function fleetAverageHistory(items: BatteryHealthPoint[]) {
  const withHist = items.filter((b) => b.sohPercent != null && b.sohHistory.length);
  if (!withHist.length || !withHist[0]?.sohHistory.length) return [];
  const len = withHist[0].sohHistory.length;
  return Array.from({ length: len }, (_, i) => ({
    label: withHist[0].sohHistory[i]!.period,
    soh: Math.round((withHist.reduce((s, b) => s + (b.sohHistory[i]?.soh ?? 0), 0) / withHist.length) * 10) / 10,
  }));
}

function confidenceStyles(c: BatteryHealthPoint["prognosis"]["confidence"]) {
  if (c === "high") return "bg-emerald-50 text-emerald-900 ring-emerald-100";
  if (c === "medium") return "bg-amber-50 text-amber-900 ring-amber-100";
  return "bg-rose-50 text-rose-900 ring-rose-100";
}

function riskStyles(r: BatteryHealthPoint["prognosis"]["imbalanceRisk"]) {
  if (r === "elevated") return "text-rose-700 bg-rose-50 ring-rose-100";
  if (r === "watch") return "text-amber-800 bg-amber-50 ring-amber-100";
  return "text-brand bg-brand-muted/80 ring-brand-border";
}

function clampPct(n: number) {
  return Math.min(100, Math.max(0, n));
}

/** Stress-style meter: higher value = more fill toward “hot” (right). */
function StressMeter({ label, value, hint }: { label: string; value: number; hint?: string }) {
  const v = clampPct(value);
  const bg = v >= 72 ? "bg-rose-500" : v >= 48 ? "bg-amber-500" : "bg-emerald-600";
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2.5 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{label}</span>
        <span className="text-sm font-bold tabular-nums text-ink">{Math.round(v)}</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-page ring-1 ring-line/80">
        <div className={`h-full rounded-full transition-all ${bg}`} style={{ width: `${v}%` }} />
      </div>
      {hint ? <p className="mt-1 text-[10px] leading-snug text-ink-faint">{hint}</p> : null}
    </div>
  );
}

function HealthMeter({ label, value }: { label: string; value: number }) {
  const v = clampPct(value);
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2.5 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{label}</span>
        <span className="text-sm font-bold tabular-nums text-brand">{Math.round(v)}</span>
      </div>
      <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-surface-page">
        <div className="h-full rounded-full bg-brand" style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

function DeteriorationStack({ bd }: { bd: BatteryDeteriorationBreakdownPct }) {
  const parts = [
    { key: "calendarAgeing" as const, label: "Calendar", pct: bd.calendarAgeing },
    { key: "cyclicElectrical" as const, label: "Cyclic electrical", pct: bd.cyclicElectrical },
    { key: "cellImbalance" as const, label: "Cell imbalance", pct: bd.cellImbalance },
    { key: "thermalElectrical" as const, label: "Thermal / inverter", pct: bd.thermalElectrical },
  ];
  return (
    <div className="space-y-2">
      <div className="flex h-5 w-full overflow-hidden rounded-md ring-1 ring-line shadow-inner">
        {parts.map((p) => (
          <div
            key={p.key}
            title={`${p.label}: ${p.pct}%`}
            className="h-full first:rounded-l-md last:rounded-r-md"
            style={{ width: `${clampPct(p.pct)}%`, backgroundColor: BD_COLORS[p.key] }}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-[10px] text-ink-muted">
        {parts.map((p) => (
          <span key={p.key} className="inline-flex items-center gap-1.5">
            <span className="h-2 w-2 shrink-0 rounded-sm" style={{ backgroundColor: BD_COLORS[p.key] }} />
            <span className="font-medium text-ink">{p.label}</span>
            <span className="tabular-nums">{p.pct}%</span>
          </span>
        ))}
      </div>
    </div>
  );
}

export default function BatteryHealth() {
  const [items, setItems] = useState<BatteryHealthPoint[]>([]);
  const [updatedAt, setUpdatedAt] = useState<string>("");

  useEffect(() => {
    let alive = true;
    const load = () =>
      api.batteryHealth().then((r) => {
        if (!alive) return;
        setItems(r.items);
        setUpdatedAt(r.updatedAt);
      });
    load();
    const t = setInterval(load, 120_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  const fleetHist = useMemo(() => fleetAverageHistory(items), [items]);
  const fleetBars = useMemo(
    () =>
      [...items]
        .filter((b) => b.sohPercent != null)
        .sort((a, b) => (b.sohPercent ?? 0) - (a.sohPercent ?? 0))
        .map((b) => ({
          reg: b.registration.length > 13 ? `${b.registration.slice(0, 12)}…` : b.registration,
          soh: b.sohPercent,
          trend: b.trend,
        })),
    [items],
  );

  const gpsEnergyMode = items.length > 0 && items.every((b) => b.sohMethod === "unavailable");
  const tripRank = useMemo(
    () =>
      [...items].sort((a, b) => {
        if (a.tripEndSocPct == null && b.tripEndSocPct == null) return (b.gpsDistanceKm ?? 0) - (a.gpsDistanceKm ?? 0);
        if (a.tripEndSocPct == null) return 1;
        if (b.tripEndSocPct == null) return -1;
        return (b.tripEndSocPct ?? 0) - (a.tripEndSocPct ?? 0);
      }),
    [items],
  );

  const stackChartData = useMemo(
    () =>
      items
        .filter((b) => b.sohMethod !== "unavailable")
        .map((b) => {
        const { calendarAgeing, cyclicElectrical, cellImbalance, thermalElectrical } = b.deterioration.breakdownPastFade;
        return {
          reg: b.registration.length > 11 ? `${b.registration.slice(0, 10)}…` : b.registration,
          calendarAgeing: Math.round(calendarAgeing),
          cyclicElectrical: Math.round(cyclicElectrical),
          cellImbalance: Math.round(cellImbalance),
          thermalElectrical: Math.round(thermalElectrical),
        };
      }),
    [items],
  );

  return (
    <div className="pb-20 lg:pb-0">
      <PageHeader
        title="Trip energy and 12V"
        description={
          gpsEnergyMode
            ? "These files have no pack SOH %. Ranking uses trip-end SOC (nulls last), GPS path km, report energy, and mileage. 12V / device batteries are accessory health, not pack SOH."
            : "SOH trajectories, attributed fade drivers, and stress indices are aligned to telemetry mode (CAN vs GPS)."
        }
      />
      <div className="mb-6 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-muted">
        <span>
          Last data refresh{" "}
          {updatedAt
            ? new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "medium" }).format(new Date(updatedAt))
            : "—"}{" "}
          · auto-refresh ~2 min
        </span>
        {gpsEnergyMode ? (
          <span className="rounded-full bg-brand-muted/60 px-2 py-1 font-medium text-brand ring-1 ring-brand-border">
            SOH % not in these files
          </span>
        ) : (
        <span className="rounded-full bg-brand-muted/60 px-2 py-1 font-medium text-brand ring-1 ring-brand-border">
          Prognosis threshold · SOH {items[0]?.prognosis.thresholdSoh ?? 80}%
        </span>
        )}
      </div>

      {gpsEnergyMode ? (
        <Card className="mb-8 overflow-x-auto p-0">
          <div className="border-b border-line px-5 py-3 text-sm font-semibold text-ink">
            Ranking · trip-end SOC, GPS path, report energy, mileage
          </div>
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-page text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-5 py-3">Vehicle</th>
                <th className="px-5 py-3">Trip-end SOC</th>
                <th className="px-5 py-3">GPS path</th>
                <th className="px-5 py-3">Energy used</th>
                <th className="px-5 py-3">Mileage</th>
                <th className="px-5 py-3">km / SOC pt</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {tripRank.map((b) => (
                <tr key={b.vehicleId}>
                  <td className="px-5 py-3 font-semibold text-ink">{b.registration}</td>
                  <td className="px-5 py-3 tabular-nums">{b.tripEndSocPct != null ? `${b.tripEndSocPct}%` : "—"}</td>
                  <td className="px-5 py-3 tabular-nums">{b.gpsDistanceKm != null ? `${b.gpsDistanceKm} km` : "—"}</td>
                  <td className="px-5 py-3 tabular-nums">{b.tripEnergyUsed ?? "—"}</td>
                  <td className="px-5 py-3 tabular-nums">{b.tripEfficiency ?? "—"}</td>
                  <td className="px-5 py-3 tabular-nums">{b.kmPerSocPoint ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : (
      <div className="mb-8 grid gap-6 lg:grid-cols-2">
        <Card className="p-5">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-ink">Fleet SOH distribution</h2>
            <p className="text-xs text-ink-muted">Sorted high → low for dispatch prioritisation.</p>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={fleetBars} layout="vertical" margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
                <CartesianGrid {...cartesianGrid} horizontal={false} />
                <XAxis type="number" domain={[50, 100]} {...axisProps} />
                <YAxis type="category" dataKey="reg" width={100} {...axisProps} />
                <Tooltip {...tooltipProps} formatter={(v: number) => [`${v}%`, "SOH"]} />
                <Bar dataKey="soh" name="SOH %" radius={[0, 6, 6, 0]} fill={chart.brand} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-5">
          <div className="mb-4">
            <h2 className="text-sm font-semibold text-ink">Fleet mean SOH trajectory</h2>
            <p className="text-xs text-ink-muted">Twelve-month cohort blend; shaded band highlights sub-threshold risk.</p>
          </div>
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={fleetHist} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                <defs>
                  <linearGradient id="fleetSohFill" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor={chart.brand} stopOpacity={0.22} />
                    <stop offset="100%" stopColor={chart.brand} stopOpacity={0.02} />
                  </linearGradient>
                </defs>
                <CartesianGrid {...cartesianGrid} />
                <XAxis dataKey="label" {...axisProps} interval={2} />
                <YAxis domain={[55, 100]} {...axisProps} width={36} />
                <Tooltip {...tooltipProps} formatter={(v: number) => [`${v}%`, "Mean SOH"]} />
                <ReferenceArea
                  y1={50}
                  y2={items[0]?.prognosis.thresholdSoh ?? 80}
                  fill={chart.warn}
                  fillOpacity={0.08}
                  ifOverflow="extendDomain"
                />
                <ReferenceLine
                  y={items[0]?.prognosis.thresholdSoh ?? 80}
                  stroke={chart.warn}
                  strokeDasharray="4 4"
                  label={{ value: "Policy floor", fill: chart.warn, fontSize: 10 }}
                />
                <Area type="monotone" dataKey="soh" stroke={chart.brand} fill="url(#fleetSohFill)" strokeWidth={2} />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>
      )}

      {stackChartData.length > 0 ? (
        <Card className="mb-8 p-5">
          <div className="mb-3 flex items-center gap-2">
            <Activity className="h-4 w-4 text-brand" aria-hidden />
            <h2 className="text-sm font-semibold text-ink">Attributed fade drivers (trailing 12 mo)</h2>
          </div>
          <p className="mb-4 text-xs text-ink-muted">
            Each bar is the{" "}
            <strong className="font-semibold text-ink">share of responsibility</strong> the model assigns for past-year fade (always 100% across the four drivers). Values
            are <strong className="font-semibold text-ink">stable per vehicle</strong> so this wall-chart does not flicker with live CAN noise; the page refreshes about every
            2 minutes. Compare rows to see who is calendar-led vs cycle-led vs imbalance-led.
          </p>
          <div
            className="min-h-[200px] w-full max-h-[440px]"
            style={{ height: Math.min(440, Math.max(200, items.length * 36)) }}
          >
            <ResponsiveContainer width="100%" height="100%">
              <BarChart
                layout="vertical"
                data={stackChartData}
                margin={{ top: 4, right: 16, left: 4, bottom: 4 }}
                stackOffset="expand"
              >
                <CartesianGrid {...cartesianGrid} horizontal={false} />
                <XAxis type="number" tickFormatter={(x) => `${Math.round(Number(x) * 100)}%`} {...axisProps} />
                <YAxis type="category" dataKey="reg" width={88} {...axisProps} />
                <Tooltip
                  {...tooltipProps}
                  formatter={(value: number, name: string) => [`${Math.round(Number(value) * 100)}% of mix`, name]}
                />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar
                  dataKey="calendarAgeing"
                  name="Calendar"
                  stackId="a"
                  fill={BD_COLORS.calendarAgeing}
                  isAnimationActive={false}
                />
                <Bar
                  dataKey="cyclicElectrical"
                  name="Cyclic"
                  stackId="a"
                  fill={BD_COLORS.cyclicElectrical}
                  isAnimationActive={false}
                />
                <Bar dataKey="cellImbalance" name="Δcell" stackId="a" fill={BD_COLORS.cellImbalance} isAnimationActive={false} />
                <Bar
                  dataKey="thermalElectrical"
                  name="Thermal"
                  stackId="a"
                  fill={BD_COLORS.thermalElectrical}
                  isAnimationActive={false}
                />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-2">
        {items.map((b) => {
          const merged = mergeObservedForecast(b);
          const p = b.prognosis;
          const H = b.heuristics;
          const D = b.deterioration;
          if (b.sohMethod === "unavailable" || b.sohPercent == null) {
            const socMissing = b.tripStartSocPct == null || b.tripEndSocPct == null;
            return (
              <Card key={b.vehicleId} className="p-5">
                <div className="text-lg font-semibold text-ink">{b.registration}</div>
                <p className="mt-2 text-sm text-ink-muted">{p.summary}</p>
                <div className="mt-4 grid gap-2 text-sm sm:grid-cols-2">
                  {socMissing ? (
                    <div className="sm:col-span-2">
                      <SignalGate state="unavailable" label="SOC not in trip report for this vehicle" />
                    </div>
                  ) : (
                    <div className="rounded-lg border border-line bg-surface-page px-3 py-2">
                      Startfl → Endfl{" "}
                      <span className="font-semibold text-ink">
                        {b.tripStartSocPct}% → {b.tripEndSocPct}%
                      </span>
                    </div>
                  )}
                  <div className="rounded-lg border border-line bg-surface-page px-3 py-2">
                    Startdte → Enddte{" "}
                    <span className="font-semibold text-ink">
                      {b.tripStartDteKm || b.tripEndDteKm ? `${b.tripStartDteKm ?? "—"} → ${b.tripEndDteKm ?? "—"}` : "—"}
                    </span>
                  </div>
                  <div className="rounded-lg border border-line bg-surface-page px-3 py-2">
                    GPS distance{" "}
                    <span className="font-semibold text-ink">{b.gpsDistanceKm != null ? `${b.gpsDistanceKm} km` : "—"}</span>
                  </div>
                  <div className="rounded-lg border border-line bg-surface-page px-3 py-2">
                    Report energy used <span className="font-semibold text-ink">{b.tripEnergyUsed ?? "—"}</span>
                  </div>
                  <div className="rounded-lg border border-line bg-surface-page px-3 py-2">
                    Mileage <span className="font-semibold text-ink">{b.tripEfficiency ?? "—"}</span>
                  </div>
                  <div className="rounded-lg border border-line bg-surface-page px-3 py-2">
                    Charging min <span className="font-semibold text-ink">{b.tripChargingMin ?? "—"}</span>
                  </div>
                  <div className="rounded-lg border border-line bg-surface-page px-3 py-2">
                    km per SOC point <span className="font-semibold text-ink">{b.kmPerSocPoint ?? "—"}</span>
                  </div>
                  <div className="rounded-lg border border-line bg-surface-page px-3 py-2">
                    Cycle proxy (gps km / typical range){" "}
                    <span className="font-semibold text-ink">{b.cycleEstimate ?? "—"}</span>
                  </div>
                  <div className="rounded-lg border border-line bg-surface-page px-3 py-2 sm:col-span-2">
                    Electrical accessory health — device {b.deviceMinV ?? "—"}–{b.deviceMaxV ?? "—"} V · 12V {b.auxMinV ?? "—"}–
                    {b.auxMaxV ?? "—"} V (not pack SOH)
                  </div>
                </div>
                <p className="mt-3 text-xs text-ink-faint">
                  Capacity SOH % is unavailable from GPS + trip files. Cell ΔmV is not in the workbook.
                </p>
              </Card>
            );
          }
          const lastFc = b.sohForecast[b.sohForecast.length - 1]?.soh ?? b.sohPercent ?? 0;
          const yMin = Math.max(48, Math.min(p.thresholdSoh - 12, lastFc - 6));
          return (
            <Card key={b.vehicleId} className="overflow-hidden p-0">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line bg-surface-page/80 px-5 py-4">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Vehicle</div>
                  <div className="text-lg font-semibold text-ink">{b.registration}</div>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ring-1 ${riskStyles(p.imbalanceRisk)}`}>
                    Δcell {p.imbalanceRisk}
                  </span>
                  <span className={`rounded-full px-2 py-1 text-[10px] font-bold uppercase ring-1 ${confidenceStyles(p.confidence)}`}>
                    {p.confidence} confidence
                  </span>
                  <TrendIcon t={b.trend} />
                </div>
              </div>

              <div className="h-[260px] w-full px-2 pt-3">
                <ResponsiveContainer width="100%" height="100%">
                  <ComposedChart data={merged} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                    <CartesianGrid {...cartesianGrid} />
                    <XAxis dataKey="label" {...axisProps} interval={3} angle={-22} textAnchor="end" height={50} />
                    <YAxis domain={[yMin, 100]} {...axisProps} width={34} />
                    <Tooltip {...tooltipProps} />
                    <Legend wrapperStyle={{ fontSize: 11 }} />
                    <ReferenceArea y1={yMin} y2={p.thresholdSoh} fill={chart.warn} fillOpacity={0.1} />
                    <ReferenceLine y={p.thresholdSoh} stroke={chart.warn} strokeDasharray="3 3" />
                    <Area
                      type="monotone"
                      dataKey="observed"
                      name="Observed"
                      stroke={chart.brand}
                      fill={chart.brand}
                      fillOpacity={0.14}
                      strokeWidth={2}
                      connectNulls
                    />
                    <Line
                      type="monotone"
                      dataKey="forecast"
                      name="Forecast"
                      stroke={chart.forecast}
                      strokeWidth={2.5}
                      strokeDasharray="6 4"
                      dot={{ r: 2, fill: chart.forecast }}
                      connectNulls
                    />
                  </ComposedChart>
                </ResponsiveContainer>
              </div>

              <div className="border-t border-line bg-gradient-to-b from-rose-50/40 to-transparent px-5 py-4">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-rose-900/90">SOH deterioration</div>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-xl border border-rose-100 bg-white px-4 py-3 shadow-sm">
                    <div className="text-[10px] font-semibold uppercase text-rose-800/80">Trailing 12 mo loss</div>
                    <div className="mt-1 text-3xl font-bold tabular-nums text-rose-700">−{D.past12mSohLossPct}%</div>
                    <div className="mt-1 text-xs text-ink-muted">
                      ≈ {D.impliedHistoricalFadePctPerMonth}% SOH / month (fitted to history)
                    </div>
                  </div>
                  <div className="rounded-xl border border-amber-100 bg-white px-4 py-3 shadow-sm">
                    <div className="text-[10px] font-semibold uppercase text-amber-900/80">Projected next 12 mo</div>
                    <div className="mt-1 text-3xl font-bold tabular-nums text-amber-800">−{D.projectedNext12mLossPct}%</div>
                    <div className="mt-1 text-xs text-ink-muted">
                      ≈ {D.impliedForecastFadePctPerMonth}% SOH / month (from forecast leg)
                    </div>
                  </div>
                </div>
                <div className="mt-4">
                  <div className="mb-2 text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                    Model attribution of trailing fade
                  </div>
                  <DeteriorationStack bd={D.breakdownPastFade} />
                </div>
              </div>

              <div className="border-t border-line bg-surface-page/70 px-4 py-4">
                <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-brand">Heuristic indices (0–100)</div>
                <p className="mb-3 text-[11px] leading-relaxed text-ink-muted">
                  Stress meters rise with electrical / usage pressure; model health blends SOH with those stresses. CAN paths unlock thermal + BMS quality.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <StressMeter
                    label="Cell imbalance severity"
                    value={H.cellImbalanceSeverity0to100}
                    hint="From measured Δcell mV (CAN) or inferred spread (GPS-only)."
                  />
                  <StressMeter label="Cycle load index" value={H.cycleLoadIndex0to100} hint="EFC vs distance-implied norm for cohort." />
                  <StressMeter label="Pack calendar age" value={H.packCalendarAgeIndex0to100} hint="Odometer-proxied calendar stress." />
                  <StressMeter
                    label="Depth-of-discharge stress"
                    value={H.depthOfDischargeStress0to100}
                    hint="Low operating SOC bands accelerate fade."
                  />
                  {H.thermalStress0to100 != null ? (
                    <StressMeter label="Thermal stress (CAN)" value={H.thermalStress0to100} hint="Motor / stage heat vs comfort band." />
                  ) : (
                    <div className="rounded-lg border border-dashed border-line bg-white/80 px-3 py-2 text-[10px] text-ink-muted">
                      Thermal stress N/A — GPS-only asset (no live stage temp stream).
                    </div>
                  )}
                  {H.bmsObservationQuality0to100 != null ? (
                    <HealthMeter label="BMS observation quality" value={H.bmsObservationQuality0to100} />
                  ) : (
                    <div className="rounded-lg border border-dashed border-line bg-white/80 px-3 py-2 text-[10px] text-ink-muted">
                      BMS quality score N/A without CAN gateway.
                    </div>
                  )}
                </div>
                <div className="mt-3">
                  <HealthMeter label="Composite model health score" value={H.modelHealthScore0to100} />
                </div>
                <ul className="mt-3 space-y-1.5 border-t border-line/80 pt-3 text-xs leading-relaxed text-ink-muted">
                  {H.rationale.map((line, i) => (
                    <li key={i} className="flex gap-2">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand" />
                      <span>{line}</span>
                    </li>
                  ))}
                </ul>
              </div>

              <div className="grid grid-cols-3 gap-px border-t border-line bg-line sm:grid-cols-3">
                <div className="bg-white px-4 py-3 text-center">
                  <div className="text-[10px] font-semibold uppercase text-ink-muted">SOH now</div>
                  <div className="text-xl font-semibold text-brand">{b.sohPercent}%</div>
                </div>
                <div className="bg-white px-4 py-3 text-center">
                  <div className="text-[10px] font-semibold uppercase text-ink-muted">12m projection</div>
                  <div className="text-xl font-semibold text-ink">{p.sohProjected12m}%</div>
                </div>
                <div className="bg-white px-4 py-3 text-center">
                  <div className="text-[10px] font-semibold uppercase text-ink-muted">Months to {p.thresholdSoh}%</div>
                  <div className="text-xl font-semibold text-ink">
                    {p.monthsToThreshold === null ? "—" : p.monthsToThreshold === 0 ? "Now" : p.monthsToThreshold}
                  </div>
                </div>
              </div>
              <div className="border-t border-line bg-brand-muted/20 px-5 py-4">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-brand">Prognosis</div>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{p.summary}</p>
                <div className="mt-3 flex flex-wrap gap-3 text-xs text-ink-muted">
                  <span>
                    EFC* <span className="font-semibold text-ink">{b.cycleEstimate}</span>
                  </span>
                  <span>
                    Δ mV <span className="font-semibold text-ink">{b.imbalanceMv}</span>
                  </span>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
      <p className="mt-6 text-center text-xs text-ink-faint">
        *Equivalent full cycles (modelled). Attribution is a fleet-normalised heuristic — validate with workshop capacity tests and cell logging.
      </p>
    </div>
  );
}
