import { Shield } from "lucide-react";
import { useEffect, useState } from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/api/client";
import { chart, cartesianGrid, axisProps, tooltipProps } from "@/lib/chartTheme";
import { PageHeader } from "@/layout/AppShell";
import { Card } from "@/ui/Card";
import type { DriverClassification } from "@/types/api";

const bandColor: Record<DriverClassification["band"], string> = {
  A: "#136a62",
  B: "#2563eb",
  C: "#dc2626",
};

function bandInPlainWords(b: DriverClassification["band"]): string {
  if (b === "A") return "Top group — riding is safe and steady.";
  if (b === "B") return "Middle group — a few habits could be better.";
  return "Needs help soon — safety or style is off track.";
}

function priorityPlain(p: DriverClassification["prognosis"]["priority"]): { label: string; hint: string } {
  if (p === "intervene") return { label: "Needs attention now", hint: "Manager or trainer should step in this week." };
  if (p === "coach") return { label: "Coaching suggested", hint: "Short talk or ride-along usually fixes this." };
  return { label: "On track", hint: "Keep routine check-ins only." };
}

function radarRows(d: DriverClassification) {
  return [
    { subject: "Safety", score: d.safetyScore },
    { subject: "Smoothness (GPS harsh)", score: d.profile.smoothness },
    { subject: "Eco / mileage", score: d.profile.ecoDrive },
    { subject: "Idle compliance", score: d.profile.compliance },
    { subject: "Alertness", score: 100 - d.profile.fatigueRisk },
  ];
}

function priorityStyles(p: DriverClassification["prognosis"]["priority"]) {
  if (p === "intervene") return "bg-rose-50 text-rose-900 ring-rose-100";
  if (p === "coach") return "bg-amber-50 text-amber-900 ring-amber-100";
  return "bg-emerald-50 text-emerald-900 ring-emerald-100";
}

export default function Drivers() {
  const [items, setItems] = useState<DriverClassification[]>([]);

  useEffect(() => {
    api.drivers().then((r) => setItems(r.items));
  }, []);

  return (
    <div className="pb-20 lg:pb-0">
      <PageHeader
        title="Vehicle trip quality"
        description="No driver identity in these files. Primary metric is trip.score. Smoothness uses coarse GPS harsh counts (~30 s sampling). Eco uses mileage / SOC bookend rate when present. Compliance is idle ratio."
      />
      <div className="grid gap-6">
        {items.map((d) => {
          const stroke = bandColor[d.band];
          const pri = priorityPlain(d.prognosis.priority);
          return (
            <Card key={d.driverId} className="overflow-hidden p-0">
              <div className="flex flex-wrap items-start justify-between gap-3 border-b border-line px-5 py-4">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
                    Vehicle (no driver identity)
                  </div>
                  <div className="text-lg font-semibold text-ink">{d.label}</div>
                  {d.tripScore != null ? (
                    <div className="text-xs text-ink-muted">Trip score {d.tripScore}</div>
                  ) : null}
                  {d.eventSource && d.eventSource !== "demo" ? (
                    <div className="mt-1 text-[11px] font-medium text-ink-muted">Event source: {d.eventSource}</div>
                  ) : null}
                  <p className="mt-1 max-w-xl text-sm text-ink-muted">{bandInPlainWords(d.band)}</p>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className="flex h-10 w-10 items-center justify-center rounded-full text-sm font-bold text-white shadow"
                    style={{ background: stroke }}
                    title={bandInPlainWords(d.band)}
                  >
                    {d.band}
                  </span>
                  <div className="flex flex-col items-end gap-0.5">
                    <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold uppercase ring-1 ${priorityStyles(d.prognosis.priority)}`}>
                      {pri.label}
                    </span>
                    <span className="max-w-[200px] text-right text-[10px] text-ink-muted">{pri.hint}</span>
                  </div>
                </div>
              </div>
              <div className="grid gap-4 p-4 lg:grid-cols-12">
                <div className="lg:col-span-4">
                  <div className="mb-2 text-center text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    Five scores at a glance
                  </div>
                  <p className="mb-2 text-center text-[10px] leading-snug text-ink-faint">
                    Spider chart: further from centre = better on that row.
                  </p>
                  <div className="h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <RadarChart cx="50%" cy="50%" outerRadius={100} data={radarRows(d)}>
                        <PolarGrid stroke={chart.grid} />
                        <PolarAngleAxis dataKey="subject" tick={{ fontSize: 10, fill: chart.label }} />
                        <PolarRadiusAxis angle={30} domain={[0, 100]} tick={{ fontSize: 9, fill: chart.label }} />
                        <Radar
                          name="Score / 100"
                          dataKey="score"
                          stroke={stroke}
                          fill={stroke}
                          fillOpacity={0.28}
                          strokeWidth={2}
                          isAnimationActive={false}
                        />
                        <Tooltip {...tooltipProps} formatter={(v: number) => [`${v} / 100`, ""]} />
                      </RadarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                <div className="lg:col-span-8">
                  <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                    Weekly safety score (0 = worst we show, 100 = best)
                  </div>
                  <div className="h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={d.safetyHistory} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                        <defs>
                          <linearGradient id={`safe-${d.driverId}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={stroke} stopOpacity={0.2} />
                            <stop offset="100%" stopColor={stroke} stopOpacity={0} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid {...cartesianGrid} />
                        <XAxis dataKey="week" {...axisProps} />
                        <YAxis domain={[0, 100]} {...axisProps} width={36} />
                        <Tooltip {...tooltipProps} formatter={(v: number) => [`${v} / 100`, "Safety"]} />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <Line
                          type="monotone"
                          dataKey="score"
                          name="Safety score"
                          stroke={stroke}
                          strokeWidth={2.5}
                          dot={{ r: 3, fill: stroke }}
                          activeDot={{ r: 5 }}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              </div>
              <div className="border-t border-line bg-brand-muted/15 px-5 py-4">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-brand">What to do next</div>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{d.prognosis.summary}</p>
                <div className="mt-3 grid gap-2 text-sm text-ink sm:grid-cols-3">
                  <div className="rounded-lg border border-line bg-white px-3 py-2">
                    <div className="text-[10px] font-semibold uppercase text-ink-muted">Hard events (7 days)</div>
                    <div className="text-lg font-semibold text-ink">{d.harshEvents7d}</div>
                    <div className="text-[10px] text-ink-muted">Sudden brakes / harsh riding picks</div>
                  </div>
                  <div className="rounded-lg border border-line bg-white px-3 py-2">
                    <div className="text-[10px] font-semibold uppercase text-ink-muted">Vs other riders (efficiency)</div>
                    <div className="text-lg font-semibold text-ink">{d.energyEfficiencyPercentile}th</div>
                    <div className="text-[10px] text-ink-muted">Percentile — 50 is middle of the fleet</div>
                  </div>
                  <div className="rounded-lg border border-line bg-white px-3 py-2">
                    <div className="text-[10px] font-semibold uppercase text-ink-muted">Next formal check-in</div>
                    <div className="text-base font-semibold text-ink">{d.prognosis.reviewBy}</div>
                    <div className="text-[10px] text-ink-muted">Suggested review month</div>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-line bg-white/80 px-3 py-2 text-xs text-ink-muted">
                  <Shield className="h-4 w-4 shrink-0 text-brand" aria-hidden />
                  <span>
                    In the next three months we expect this rider to stay in <strong className="text-ink">band {d.prognosis.projectedBand90d}</strong> if nothing changes — use
                    that to plan who gets extra coaching first.
                  </span>
                </div>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
