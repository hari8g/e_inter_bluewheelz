import { CalendarClock, ClipboardList, Gauge, Sparkles } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  ReferenceArea,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";
import { api } from "@/api/client";
import { resolveLifecycleOperatorReadout } from "@/lib/lifecycleOperatorReadout";
import { chart, cartesianGrid, axisProps, tooltipProps } from "@/lib/chartTheme";
import { PageHeader } from "@/layout/AppShell";
import { Card } from "@/ui/Card";
import type { AssetLifecycleStage } from "@/types/api";

const stageLabel: Record<AssetLifecycleStage["stage"], string> = {
  ramp: "Ramp / burn-in",
  steady: "Steady utilisation",
  watch: "Elevated wear watch",
  retire_candidate: "Retire candidate",
};

const stageFill: Record<AssetLifecycleStage["stage"], string> = {
  ramp: "#0ea5e9",
  steady: "#136a62",
  watch: "#d97706",
  retire_candidate: "#e11d48",
};

function confidenceChip(c: AssetLifecycleStage["heuristics"]["dataConfidence"]) {
  if (c === "high") return "bg-emerald-50 text-emerald-900 ring-emerald-100";
  if (c === "medium") return "bg-amber-50 text-amber-900 ring-amber-100";
  return "bg-slate-100 text-slate-800 ring-slate-200";
}

function HeuristicBar({ label, value, hint }: { label: string; value: number | null; hint?: string }) {
  if (value == null) {
    return (
      <div className="rounded-lg border border-dashed border-line bg-white px-3 py-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{label}</div>
        <p className="mt-1 text-[11px] text-ink-muted">{hint ?? "Not measured on GPS-only traces."}</p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-line bg-white px-3 py-2.5 shadow-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{label}</span>
        <span className="text-lg font-semibold tabular-nums text-brand">{value}</span>
      </div>
      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-surface-page">
        <div className="h-full rounded-full bg-brand transition-all" style={{ width: `${clamp(value, 0, 100)}%` }} />
      </div>
      {hint ? <p className="mt-1 text-[10px] leading-snug text-ink-faint">{hint}</p> : null}
    </div>
  );
}

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

export default function AssetLifecycle() {
  const [items, setItems] = useState<AssetLifecycleStage[]>([]);

  useEffect(() => {
    api.assetLifecycle().then((r) => setItems(r.items));
  }, []);

  const scatter = useMemo(
    () =>
      items.map((a) => ({
        reg: a.registration,
        km: a.odometerKm,
        util: a.utilizationScore,
        stage: a.stage,
        fill: stageFill[a.stage],
      })),
    [items],
  );

  return (
    <div className="pb-20 lg:pb-0">
      <PageHeader
        title="Asset lifecycle — odometer and duty"
        description="Odometer from trip-end odo. Duty is GPS ign-on % and moving time. Service windows follow odo gates. Thermal stress is omitted on GPS-only assets."
      />

      <Card className="mb-8 p-5">
        <div className="mb-4 flex flex-wrap items-end justify-between gap-2">
          <div>
            <h2 className="text-sm font-semibold text-ink">Fleet posture</h2>
            <p className="text-xs text-ink-muted">Odometer vs utilisation score — bubble colour encodes lifecycle stage.</p>
          </div>
          <div className="flex flex-wrap gap-3 text-[10px] font-semibold uppercase">
            {(["ramp", "steady", "watch", "retire_candidate"] as const).map((s) => (
              <span key={s} className="flex items-center gap-1.5 text-ink-muted">
                <span className="h-2 w-2 rounded-full" style={{ background: stageFill[s] }} />
                {stageLabel[s]}
              </span>
            ))}
          </div>
        </div>
        <div className="h-[320px] w-full">
          <ResponsiveContainer width="100%" height="100%">
            <ScatterChart margin={{ left: 8, right: 16, top: 8, bottom: 8 }}>
              <CartesianGrid {...cartesianGrid} />
              <XAxis type="number" dataKey="km" name="Odometer" unit=" km" {...axisProps} />
              <YAxis type="number" dataKey="util" name="Utilisation" domain={[40, 100]} {...axisProps} width={36} />
              <ZAxis type="number" dataKey="util" range={[60, 400]} />
              <Tooltip
                {...tooltipProps}
                cursor={{ strokeDasharray: "3 3" }}
                formatter={(v: number, name: string) => {
                  if (name === "km") return [`${v.toLocaleString()} km`, "Odometer"];
                  if (name === "util") return [v, "Utilisation"];
                  return [v, name];
                }}
                labelFormatter={(_, payload) => {
                  const p = payload?.[0]?.payload as { reg?: string } | undefined;
                  return p?.reg ?? "";
                }}
              />
              <Scatter name="Assets" data={scatter} fill={chart.brand}>
                {scatter.map((row, i) => (
                  <Cell key={row.reg + i} fill={row.fill} />
                ))}
              </Scatter>
            </ScatterChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid gap-6 lg:grid-cols-2">
        {items.map((a) => {
          const [lo, hi] = a.prognosis.majorServiceWindowKm;
          const H = a.heuristics;
          const op = resolveLifecycleOperatorReadout(a);
          return (
            <Card key={a.vehicleId} className="overflow-hidden p-0">
              <div className="border-b border-line bg-gradient-to-br from-brand-muted/50 to-white px-5 py-5">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="space-y-1">
                    <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-muted">Current odometer</div>
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-bold tabular-nums tracking-tight text-ink">
                        {a.odometerKm.toLocaleString()}
                      </span>
                      <span className="text-sm font-medium text-ink-muted">km</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      <span className="text-sm font-semibold text-ink">{a.registration}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ring-1 ${confidenceChip(H.dataConfidence)}`}>
                        Model confidence · {H.dataConfidence}
                      </span>
                    </div>
                  </div>
                  <span
                    className="shrink-0 rounded-full px-3 py-1.5 text-xs font-bold uppercase text-white shadow-sm"
                    style={{ background: stageFill[a.stage] }}
                  >
                    {stageLabel[a.stage]}
                  </span>
                </div>

                <div className="mt-5 rounded-xl border border-emerald-200/90 bg-emerald-50/50 p-4 ring-1 ring-emerald-100/80">
                  <div className="flex items-start gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-emerald-700 text-white shadow-sm">
                      <ClipboardList className="h-5 w-5" aria-hidden />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="text-[10px] font-bold uppercase tracking-wide text-emerald-900/90">Operator diagnosis</div>
                      <p className="mt-1.5 text-sm font-semibold leading-snug text-emerald-950">{op.summary}</p>
                      <div className="mt-3 grid gap-4 sm:grid-cols-2">
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-900/75">What we see</div>
                          <ul className="mt-1.5 list-outside list-disc space-y-1.5 pl-4 text-xs leading-relaxed text-emerald-950/95">
                            {op.findings.map((line, i) => (
                              <li key={i}>{line}</li>
                            ))}
                          </ul>
                        </div>
                        <div>
                          <div className="text-[10px] font-semibold uppercase tracking-wide text-emerald-900/75">Suggested next steps</div>
                          <ol className="mt-1.5 list-outside list-decimal space-y-1.5 pl-4 text-xs font-medium leading-relaxed text-emerald-950">
                            {op.actions.map((line, i) => (
                              <li key={i}>{line}</li>
                            ))}
                          </ol>
                        </div>
                      </div>
                    </div>
                  </div>
                </div>

                <div className="mt-5 grid gap-3 rounded-xl border border-brand-border/60 bg-white/90 p-4 sm:grid-cols-2">
                  <div className="flex gap-3 sm:col-span-2">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-brand text-white">
                      <CalendarClock className="h-5 w-5" aria-hidden />
                    </div>
                    <div className="min-w-0">
                      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">
                        Next major service (planning date)
                      </div>
                      <div className="text-lg font-semibold text-ink">{a.prognosis.nextMajorServiceDueLabel}</div>
                      <div className="mt-1 text-xs text-ink-muted">
                        Target odometer{" "}
                        <span className="font-semibold text-ink tabular-nums">
                          {a.projectedMajorServiceKm.toLocaleString()} km
                        </span>
                        <span className="text-ink-faint"> · </span>
                        <span className="tabular-nums">{H.kmToNextMajorService.toLocaleString()} km to go</span>
                        <span className="text-ink-faint"> · </span>
                        <span className="tabular-nums">~{a.prognosis.estimatedMonthsToMajorService} mo</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-start gap-2 rounded-lg bg-surface-page px-3 py-2 text-xs text-ink-muted">
                    <Gauge className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
                    <span>
                      Window <span className="font-medium text-ink">{lo.toLocaleString()}–{hi.toLocaleString()} km</span>{" "}
                      on chart; date uses implied fleet km/month from utilisation score.
                    </span>
                  </div>
                </div>
              </div>

              <div className="h-[200px] w-full px-2 pt-3">
                {(() => {
                  const wearVals = a.wearSeries.map((w) => w.wearIndex);
                  const wearMax = Math.max(5, ...wearVals);
                  const wearYHi = Math.min(100, Math.max(20, Math.ceil(wearMax / 5) * 5 + 8));
                  return (
                    <ResponsiveContainer width="100%" height="100%">
                      <ComposedChart data={a.wearSeries} margin={{ left: 0, right: 8, top: 4, bottom: 0 }}>
                        <defs>
                          <linearGradient id={`wear-${a.vehicleId}`} x1="0" y1="0" x2="0" y2="1">
                            <stop offset="0%" stopColor={stageFill[a.stage]} stopOpacity={0.25} />
                            <stop offset="100%" stopColor={stageFill[a.stage]} stopOpacity={0.02} />
                          </linearGradient>
                        </defs>
                        <CartesianGrid {...cartesianGrid} />
                        <XAxis dataKey="km" tickFormatter={(v) => `${Math.round(v / 1000)}k`} {...axisProps} />
                        <YAxis domain={[0, wearYHi]} {...axisProps} width={36} tickFormatter={(v) => `${v}`} />
                        <Tooltip
                          {...tooltipProps}
                          formatter={(v: number) => [`${v} / 100`, "Wear index"]}
                          labelFormatter={(l) => `${l} km`}
                        />
                        <Legend wrapperStyle={{ fontSize: 11 }} />
                        <ReferenceArea x1={lo} x2={hi} fill={chart.warn} fillOpacity={0.06} />
                        <Area
                          type="monotone"
                          dataKey="wearIndex"
                          name="Wear index (0 = light, higher = more wear)"
                          stroke={stageFill[a.stage]}
                          fill={`url(#wear-${a.vehicleId})`}
                          strokeWidth={2}
                          isAnimationActive={false}
                        />
                      </ComposedChart>
                    </ResponsiveContainer>
                  );
                })()}
              </div>
              <p className="border-b border-line px-4 pb-3 text-center text-[11px] leading-snug text-ink-muted">
                Vertical axis starts at <strong className="text-ink">0</strong> (almost new) and runs up only as far as this asset needs, so the line is easier to read than a
                fixed 0–100 scale.
              </p>

              <div className="border-t border-line bg-surface-page/60 px-4 py-4">
                <div className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-wide text-brand">
                  <Sparkles className="h-4 w-4" aria-hidden />
                  Reference indices (0–100)
                </div>
                <p className="mb-3 text-[11px] leading-relaxed text-ink-muted">
                  Numbers below support the diagnosis above; higher duty / thermal scores usually mean harder life for the pack.
                </p>
                <div className="grid gap-2 sm:grid-cols-2">
                  <HeuristicBar
                    label="Duty cycle index"
                    value={H.dutyCycleIndex}
                    hint="Blended shift intensity vs fleet baseline."
                  />
                  <HeuristicBar
                    label="Thermal stress index"
                    value={H.thermalStressIndex}
                    hint={
                      H.thermalStressIndex == null
                        ? "Null — GPS-only files have no pack thermal stream."
                        : H.canObservability === "full"
                        ? "From measured pack temperature."
                        : H.canObservability === "partial"
                          ? "Not exposed on this OEM platform."
                          : "Inferred (no CAN thermal stream)."
                    }
                  />
                  <HeuristicBar
                    label="Depth-of-discharge score"
                    value={H.depthOfDischargeScore}
                    hint="Higher = gentler SOC banding for pack ageing."
                  />
                  <HeuristicBar label="Reliability index" value={H.reliabilityIndex} hint="Composite of wear stage + trend." />
                </div>
                <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
                  <div className="rounded-lg border border-line bg-white px-3 py-2">
                    <span className="text-ink-muted">Calendar age (model)</span>{" "}
                    <span className="font-semibold text-ink">{H.calendarAgeMonths} mo</span>
                  </div>
                  <div className="rounded-lg border border-line bg-white px-3 py-2">
                    <span className="text-ink-muted">Warranty clock</span>{" "}
                    <span className="font-semibold text-ink">
                      {H.warrantyClockMonthsRemaining != null
                        ? `${H.warrantyClockMonthsRemaining} mo est. remaining`
                        : "Outside demo window"}
                    </span>
                  </div>
                  <div className="rounded-lg border border-line bg-white px-3 py-2 sm:col-span-2">
                    <span className="text-ink-muted">Telemetry</span>{" "}
                    <span className="font-semibold text-ink">{H.telemetryMode === "can_gps" ? "CAN + GPS" : "GPS-only"}</span>
                    <span className="text-ink-faint"> · </span>
                    <span className="text-ink-muted">Observability</span>{" "}
                    <span className="font-semibold capitalize text-ink">{H.canObservability.replace("_", " ")}</span>
                  </div>
                </div>
                <div className="mt-3 flex flex-wrap gap-2">
                  {H.flags.map((f) => (
                    <span
                      key={f}
                      className="rounded-full bg-white px-2.5 py-1 text-[10px] font-semibold text-ink ring-1 ring-line"
                    >
                      {f}
                    </span>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-2 gap-px border-t border-line bg-line">
                <div className="bg-white px-4 py-3">
                  <div className="text-[10px] font-semibold uppercase text-ink-muted">Utilisation score</div>
                  <div className="text-2xl font-semibold text-brand">{a.utilizationScore}</div>
                </div>
                <div className="bg-white px-4 py-3">
                  <div className="text-[10px] font-semibold uppercase text-ink-muted">Service at km</div>
                  <div className="text-2xl font-semibold text-ink tabular-nums">{a.projectedMajorServiceKm.toLocaleString()}</div>
                </div>
              </div>
              <div className="border-t border-line bg-white px-5 py-4">
                <div className="text-[11px] font-semibold uppercase tracking-wide text-brand">Prognosis</div>
                <p className="mt-2 text-sm leading-relaxed text-ink-muted">{a.prognosis.summary}</p>
                <div className="mt-3 grid gap-2 text-xs text-ink-muted sm:grid-cols-2">
                  <div className="rounded-lg border border-line bg-surface-page px-3 py-2">
                    <span className="font-semibold text-ink">RUL (model)</span> ·{" "}
                    {a.prognosis.remainingUsefulLifeKm.toLocaleString()} km remaining envelope
                  </div>
                  <div className="rounded-lg border border-line bg-surface-page px-3 py-2">
                    <span className="font-semibold text-ink">Decision gate</span> · {a.prognosis.nextDecisionGate}
                  </div>
                  <div className="rounded-lg border border-dashed border-amber-200/80 bg-amber-50/50 px-3 py-2 sm:col-span-2">
                    Major service risk window · {lo.toLocaleString()}–{hi.toLocaleString()} km (shaded band)
                  </div>
                </div>
                <p className="mt-3 text-xs text-ink-faint">{a.notes}</p>
              </div>
            </Card>
          );
        })}
      </div>
    </div>
  );
}
