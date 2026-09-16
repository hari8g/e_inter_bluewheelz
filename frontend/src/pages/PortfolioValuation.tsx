import { IndianRupee, PieChart as PieChartIcon, Scale } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/api/client";
import { chart, cartesianGrid, axisProps, tooltipProps } from "@/lib/chartTheme";
import { PageHeader } from "@/layout/AppShell";
import { Card } from "@/ui/Card";
import type { PortfolioValuationItem, PortfolioValuationPayload } from "@/types/api";

const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const bandLabel: Record<PortfolioValuationItem["valueBand"], string> = {
  strong: "Strong value",
  normal: "Normal",
  soft: "Soft",
  stressed: "Stressed",
};

const bandClass: Record<PortfolioValuationItem["valueBand"], string> = {
  strong: "bg-emerald-50 text-emerald-900 ring-emerald-100",
  normal: "bg-slate-50 text-slate-800 ring-slate-200",
  soft: "bg-amber-50 text-amber-900 ring-amber-100",
  stressed: "bg-rose-50 text-rose-900 ring-rose-100",
};

function Kpi({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <Card className="p-4">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="mt-1 text-xl font-semibold tabular-nums text-ink">{value}</div>
      {hint ? <p className="mt-1 text-[11px] leading-snug text-ink-muted">{hint}</p> : null}
    </Card>
  );
}

export default function PortfolioValuation() {
  const [data, setData] = useState<PortfolioValuationPayload | null>(null);

  useEffect(() => {
    api.portfolioValuation().then(setData);
  }, []);

  const barRows = useMemo(() => {
    if (!data) return [];
    return [...data.items]
      .sort((a, b) => b.fairMarketValueInr - a.fairMarketValueInr)
      .map((i) => ({
        reg: i.registration.length > 12 ? `${i.registration.slice(0, 11)}…` : i.registration,
        fmv: Math.round(i.fairMarketValueInr / 1000),
        residual: Math.round(i.residualValueInr / 1000),
      }));
  }, [data]);

  if (!data) {
    return <div className="text-sm text-ink-muted">Loading portfolio snapshot…</div>;
  }

  const e = data.enterprise;

  return (
    <div className="pb-20 lg:pb-0">
      <PageHeader
        title="Portfolio value & residual"
        description="Enterprise snapshot for NBFCs and dry-lease lessors: model list prices for Ace / Zor Grand / Pro X, FMV from odometer and GPS utilisation. Pack SOH is unobservable on this file fleet and is not invented."
      />

      <Card className="mb-6 border-amber-200/80 bg-amber-50/40 p-4 text-sm leading-relaxed text-amber-950">
        <div className="flex items-start gap-2">
          <Scale className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
          <p>{data.disclaimer}</p>
        </div>
      </Card>

      <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi
          label="Fleet fair market value (total)"
          value={inr.format(e.totalFairMarketValueInr)}
          hint="Sum of model FMV across all vehicles on the book today."
        />
        <Kpi
          label="Total residual (assumed tenor)"
          value={inr.format(e.totalResidualValueInr)}
          hint={`Rough end-of-term value at ~${data.assumedLeaseMonths} months for dry-lease style checks.`}
        />
        <Kpi
          label="List-price reference (total)"
          value={inr.format(e.totalIndicativeListInr)}
          hint="Comparable new price roll-up — not invoice or OEM ex-showroom."
        />
        <Kpi
          label="Fleet quality"
          value={e.avgSohPercent == null ? "SOH unobservable" : `${e.avgSohPercent}% avg SOH`}
          hint={`Watch/retire share of FMV: ${Math.round(e.portfolioRiskShare * 100)}% — higher means more book in elevated lifecycle bands.`}
        />
      </div>

      <div className="mb-6 grid gap-6 lg:grid-cols-5">
        <Card className="p-5 lg:col-span-3">
          <div className="mb-3 flex items-center gap-2">
            <IndianRupee className="h-4 w-4 text-brand" aria-hidden />
            <h2 className="text-sm font-semibold text-ink">FMV vs residual by asset (₹ thousands)</h2>
          </div>
          <p className="mb-4 text-xs text-ink-muted">Bars in thousands of INR for readability. FMV = estimated market value today; Residual = lease-end style bucket.</p>
          <div className="h-[320px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={barRows} margin={{ left: 4, right: 8, top: 8, bottom: 48 }}>
                <CartesianGrid {...cartesianGrid} />
                <XAxis dataKey="reg" interval={0} angle={-28} textAnchor="end" height={70} {...axisProps} />
                <YAxis tickFormatter={(v) => `${v}k`} {...axisProps} width={44} />
                <Tooltip {...tooltipProps} formatter={(v: number) => [`₹${v}k`, ""]} />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                <Bar dataKey="fmv" name="FMV (k INR)" fill={chart.brand} radius={[4, 4, 0, 0]} isAnimationActive={false} />
                <Bar dataKey="residual" name="Residual (k INR)" fill={chart.forecast} radius={[4, 4, 0, 0]} isAnimationActive={false} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
        <Card className="p-5 lg:col-span-2">
          <div className="mb-2 flex items-center gap-2">
            <PieChartIcon className="h-4 w-4 text-brand" aria-hidden />
            <h2 className="text-sm font-semibold text-ink">Book mix</h2>
          </div>
          <ul className="space-y-3 text-sm text-ink-muted">
            <li>
              <span className="font-semibold text-ink">{e.vehicleCount}</span> vehicles on the demo fleet.
            </li>
            <li>
              FMV represents <strong className="text-ink">{(e.totalFairMarketValueInr / Math.max(1, e.totalIndicativeListInr) * 100).toFixed(1)}%</strong> of rolled-up list reference — quick
              sanity for LTV-style screens.
            </li>
            <li>
              Residual pool is <strong className="text-ink">{inr.format(e.totalResidualValueInr)}</strong> vs FMV{" "}
              <strong className="text-ink">{inr.format(e.totalFairMarketValueInr)}</strong> (
              {e.totalFairMarketValueInr > 0
                ? `${Math.round((e.totalResidualValueInr / e.totalFairMarketValueInr) * 100)}%`
                : "—"}
              ).
            </li>
          </ul>
          <p className="mt-4 text-xs text-ink-faint">
            Updated {new Intl.DateTimeFormat("en-IN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(data.updatedAt))}
          </p>
        </Card>
      </div>

      <Card className="overflow-hidden p-0">
        <div className="border-b border-line bg-surface-page/80 px-4 py-3 text-sm font-semibold text-ink">Asset-level register</div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-left text-sm">
            <thead className="border-b border-line bg-white text-[10px] font-bold uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-4 py-2">Registration</th>
                <th className="px-4 py-2">Asset</th>
                <th className="px-4 py-2 text-right">List ref.</th>
                <th className="px-4 py-2 text-right">FMV</th>
                <th className="px-4 py-2 text-right">Residual</th>
                <th className="px-4 py-2 text-center">SOH</th>
                <th className="px-4 py-2">Band</th>
                <th className="px-4 py-2">Notes for credit desk</th>
              </tr>
            </thead>
            <tbody>
              {data.items.map((row) => (
                <tr key={row.vehicleId} className="border-b border-line/80 odd:bg-surface-page/40">
                  <td className="px-4 py-2.5 font-mono text-xs font-semibold text-ink">{row.registration}</td>
                  <td className="px-4 py-2.5">
                    <div className="font-medium text-ink">{row.displayName}</div>
                    <div className="text-xs text-ink-muted">
                      {row.model} · {row.odometerKm.toLocaleString("en-IN")} km · {row.telemetryMode === "can_gps" ? "CAN+GPS" : "GPS"}
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right tabular-nums">{inr.format(row.indicativeListPriceInr)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold tabular-nums text-brand">{inr.format(row.fairMarketValueInr)}</td>
                  <td className="px-4 py-2.5 text-right tabular-nums text-ink">{inr.format(row.residualValueInr)}</td>
                  <td className="px-4 py-2.5 text-center tabular-nums">
                    {row.sohPercent == null ? "n/a" : `${row.sohPercent}%`}
                  </td>
                  <td className="px-4 py-2.5">
                    <span className={`inline-flex rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ring-1 ${bandClass[row.valueBand]}`}>
                      {bandLabel[row.valueBand]}
                    </span>
                  </td>
                  <td className="max-w-[280px] px-4 py-2.5 text-xs leading-snug text-ink-muted">
                    <ul className="list-inside list-disc">
                      {row.notes.map((n, i) => (
                        <li key={i}>{n}</li>
                      ))}
                    </ul>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}
