import type { LucideIcon } from "lucide-react";
import { Battery, Eye, Gauge, MapPinned, Settings, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { api } from "@/api/client";
import { FleetMap, modelColor } from "@/components/FleetMap";
import { SignalGate } from "@/components/SignalGate";
import { chart, cartesianGrid, axisProps, tooltipProps } from "@/lib/chartTheme";
import { PageHeader } from "@/layout/AppShell";
import { Button } from "@/ui/Button";
import { Card } from "@/ui/Card";
import type {
  CommandCenterPayload,
  DailyDistancePoint,
  GpsHistoryPayload,
  GpsMetrics,
  TripLedgerRow,
  Vehicle,
} from "@/types/api";

function Kpi({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: LucideIcon;
}) {
  return (
    <Card className="relative overflow-hidden p-5">
      <Icon className="absolute right-4 top-4 h-4 w-4 text-ink-faint" aria-hidden />
      <div className="text-xs font-semibold uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="mt-2 text-3xl font-semibold tracking-tight text-ink">{value}</div>
      <div className="mt-2 text-xs text-ink-muted">{hint}</div>
    </Card>
  );
}

function badgeForStatus(v: Vehicle) {
  if (v.status === "charging") return { text: "CHARGING", cls: "bg-violet-50 text-charge ring-violet-100" };
  if (v.status === "idle") return { text: "IDLE", cls: "bg-amber-50 text-amber-800 ring-amber-100" };
  if (v.status === "offline") return { text: "OFFLINE", cls: "bg-slate-100 text-slate-700 ring-slate-200" };
  return { text: "ACTIVE", cls: "bg-emerald-50 text-live ring-emerald-100" };
}

function formatTime(iso: string) {
  return new Intl.DateTimeFormat("en-IN", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(iso));
}

function fmt(n: number | null | undefined, suffix = "") {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n}${suffix}`;
}

export default function CommandCenter() {
  const [data, setData] = useState<CommandCenterPayload | null>(null);
  const [trips, setTrips] = useState<TripLedgerRow[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [gpsHist, setGpsHist] = useState<GpsHistoryPayload | null>(null);
  const [metrics, setMetrics] = useState<GpsMetrics | null>(null);
  const [daily, setDaily] = useState<DailyDistancePoint[]>([]);
  const [playIdx, setPlayIdx] = useState(0);

  useEffect(() => {
    let alive = true;
    const load = () => {
      Promise.all([api.commandCenter(), api.trips()])
        .then(([d, t]) => {
          if (!alive) return;
          setData(d);
          setTrips(t.items.length ? t.items : d.trips ?? []);
          setErr(null);
          setSelectedId((cur) => cur ?? d.vehicles[0]?.id ?? null);
        })
        .catch((e: Error) => alive && setErr(e.message));
    };
    load();
    const t = setInterval(load, 15000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, []);

  useEffect(() => {
    if (!selectedId) return;
    let alive = true;
    Promise.all([api.gpsHistory(selectedId, { max: 900 }), api.gpsMetrics(selectedId), api.dailyDistance(selectedId)])
      .then(([h, m, d]) => {
        if (!alive) return;
        setGpsHist(h);
        setMetrics(m);
        setDaily(d.items);
        setPlayIdx(h.points.length ? h.points.length - 1 : 0);
      })
      .catch(() => {
        if (!alive) return;
        setGpsHist(null);
        setMetrics(null);
        setDaily([]);
      });
    return () => {
      alive = false;
    };
  }, [selectedId]);

  const selected = data?.vehicles.find((v) => v.id === selectedId) ?? null;
  const playback = useMemo(() => {
    if (!gpsHist || !selectedId) return undefined;
    return { vehicleId: selectedId, points: gpsHist.points, index: playIdx };
  }, [gpsHist, selectedId, playIdx]);

  if (err) {
    return (
      <div>
        <PageHeader title="Command center" description="Live operations for the Bosch e-inter fleet." />
        <Card className="border-red-200 bg-red-50 text-sm text-red-800">
          <p>
            Could not reach API ({err}). For local dev, start the backend on port 8787 or run{" "}
            <code className="rounded bg-white/80 px-1">npm run dev</code> in <code className="rounded bg-white/80 px-1">backend/</code>
            .
          </p>
        </Card>
      </div>
    );
  }

  if (!data) {
    return <div className="text-sm text-ink-muted">Loading command centre…</div>;
  }

  const p = data.policy;
  const policyTags = [
    p.showMap ? "Map on" : "Map off",
    p.showAssetStrip ? "Strip on" : "Strip off",
    p.showTripLedger ? "Ledger on" : "Ledger off",
    p.showImmobilise ? "Immobilise UI on" : "Immobilise UI off",
  ];

  const staleList = data.vehicles.filter((v) => {
    const diff = Date.now() - new Date(v.position.lastFixAt).getTime();
    return diff > p.stalePositionMinutes * 60 * 1000;
  });

  const socHint =
    (data.avgSocSampleCount ?? 0) > 0
      ? `Mean of ${data.avgSocSampleCount} vehicles with trip-end SOC`
      : "Trip-end SOC not in report for this fleet";

  return (
    <div className="pb-20 lg:pb-0">
      <PageHeader
        title="Command center"
        description={
          data.mode === "live"
            ? "Live map and KPIs from Intellicar CAN/GPS. Unmeasured channels stay empty."
            : data.dataSource?.startsWith("file:")
              ? "BluWheelz Database/ GPS traces and trip workbook, mapped onto the master canonical signal list."
              : "Demo seed fleet. Set DATABASE_URL and unset DEMO_MODE to serve Intellicar live."
        }
        actions={
          <>
            <Button variant="ghost" className="text-xs font-semibold uppercase tracking-wide">
              <Eye className="h-4 w-4" />
              Visibility: full
            </Button>
            <Link to="/policy">
              <Button variant="secondary" className="text-xs font-semibold uppercase tracking-wide">
                <Settings className="h-4 w-4" />
                Edit policy
              </Button>
            </Link>
          </>
        }
      />

      <div className="mb-4 flex flex-wrap gap-2 rounded-xl border border-brand-border bg-brand-muted/50 px-4 py-3 text-xs text-ink">
        <span className="font-semibold text-brand">Fleet policy → command centre</span>
        <span className="text-ink-muted">·</span>
        {policyTags.map((t) => (
          <span
            key={t}
            className="rounded-full bg-white/80 px-2 py-0.5 font-medium text-ink ring-1 ring-brand-border/60"
          >
            {t}
          </span>
        ))}
        <span className="text-ink-muted">·</span>
        <span>
          GPS interval {p.gpsUplinkTargetSeconds}s · Stale SLA {p.stalePositionMinutes} min · Trip-end SOC band &lt;{" "}
          {p.lowSocAlertPercent}%
          {p.deviceBatteryAlertVolts != null ? ` · Device V &lt; ${p.deviceBatteryAlertVolts}` : ""}
        </span>
      </div>

      <div className="mb-6 flex flex-wrap items-center gap-2 rounded-xl border border-line bg-white px-4 py-3 text-sm text-ink-muted">
        <span className="font-semibold text-ink">Position freshness</span>
        <span className="text-ink-muted">—</span>
        {staleList.length === 0 ? (
          <span>All assets within freshness SLA.</span>
        ) : (
          <span>
            {staleList.length} asset{staleList.length > 1 ? "s" : ""} past GPS freshness SLA (files end 14 Sep 2026 — shown stale on purpose).
          </span>
        )}
      </div>

      <div className="mb-8 grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <Kpi
          label="Fleet"
          value={String(data.fleetTotal)}
          hint={`${data.reporting} reporting GPS files · ${data.noLink} no link`}
          icon={Users}
        />
        <Kpi
          label="Last GPS day"
          value={`${data.distanceTodayKm} km`}
          hint={`Report distance (xlsx) ${data.reportDistanceKm ?? "—"} km`}
          icon={MapPinned}
        />
        <Kpi label="Avg trip-end SOC" value={`${data.avgSocPercent}%`} hint={socHint} icon={Battery} />
        <Kpi
          label="Range pool"
          value={data.rangePoolAvailable ? `${data.estRangePoolKm} km` : "n/a"}
          hint={
            data.rangePoolAvailable
              ? "Sum of trip-end DTE"
              : "Not available — no DTE stream in these files"
          }
          icon={Gauge}
        />
      </div>

      <div className="grid gap-6 xl:grid-cols-12">
        <div className="xl:col-span-7">
          {p.showMap ? (
            <>
              <FleetMap vehicles={data.vehicles} policy={p} playback={playback} stops={metrics?.stops} />
              {gpsHist && gpsHist.points.length > 2 ? (
                <div className="mt-3 rounded-xl border border-line bg-white px-4 py-3">
                  <div className="mb-2 flex items-center justify-between text-xs text-ink-muted">
                    <span>
                      Trace playback · {selected?.registration ?? "vehicle"} · ~{metrics?.medianGapSec ?? 30}s GPS
                    </span>
                    <span className="tabular-nums">{gpsHist.points[playIdx]?.t.replace("T", " ").slice(0, 19)}</span>
                  </div>
                  <input
                    type="range"
                    className="w-full accent-brand"
                    min={0}
                    max={gpsHist.points.length - 1}
                    value={playIdx}
                    onChange={(e) => setPlayIdx(Number(e.target.value))}
                  />
                </div>
              ) : null}
            </>
          ) : null}
        </div>
        {p.showAssetStrip ? (
          <div className="space-y-3 xl:col-span-5">
            <div className="text-sm font-semibold text-ink">Live asset strip</div>
            <div className="max-h-[520px] space-y-3 overflow-y-auto pr-1">
              {data.vehicles.map((v) => {
                const b = badgeForStatus(v);
                const endSoc = v.trip?.endSocPct;
                const low = p.highlightLowSoc && endSoc != null && endSoc < p.lowSocAlertPercent;
                const mismatch =
                  p.highlightGpsReportMismatch &&
                  v.gpsMetrics?.distanceDeltaKm != null &&
                  Math.abs(v.gpsMetrics.distanceDeltaKm) > 40;
                const lowDev =
                  p.deviceBatteryAlertVolts != null &&
                  v.gps?.deviceBatteryV != null &&
                  v.gps.deviceBatteryV < p.deviceBatteryAlertVolts;
                return (
                  <div
                    key={v.id}
                    className="cursor-pointer"
                    onClick={() => setSelectedId(v.id)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") setSelectedId(v.id);
                    }}
                    role="button"
                    tabIndex={0}
                  >
                  <Card
                    className={`p-4 ${selectedId === v.id ? "ring-2 ring-brand" : ""} ${low || mismatch ? "ring-2 ring-amber-200" : ""}`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="font-semibold text-ink">{v.registration}</div>
                        <div className="text-xs text-ink-muted">{v.displayName}</div>
                      </div>
                      <span
                        className="rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ring-1"
                        style={{ color: modelColor(v.model), backgroundColor: `${modelColor(v.model)}14` }}
                      >
                        {v.model}
                      </span>
                    </div>
                    <div className="mt-2 flex items-center justify-between text-xs text-ink-muted">
                      <span>{v.locationLabel}</span>
                      <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase ring-1 ${b.cls}`}>
                        {b.text}
                      </span>
                    </div>
                    <div className="mt-1 text-[11px] text-ink-faint">Updated {formatTime(v.position.lastFixAt)}</div>
                    {v.gps ? (
                      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-ink-muted">
                        <div className="rounded-lg bg-surface-page px-2 py-1.5">
                          Speed <span className="font-semibold text-ink">{fmt(v.gps.speedKph, " km/h")}</span>
                        </div>
                        <div className="rounded-lg bg-surface-page px-2 py-1.5">
                          Ignition <span className="font-semibold text-ink">{v.gps.ignition ? "On" : "Off"}</span>
                        </div>
                        <div className={`rounded-lg px-2 py-1.5 ${lowDev ? "bg-amber-50" : "bg-surface-page"}`}>
                          Device <span className="font-semibold text-ink">{fmt(v.gps.deviceBatteryV, " V")}</span>
                        </div>
                        <div className="rounded-lg bg-surface-page px-2 py-1.5">
                          12V <span className="font-semibold text-ink">{fmt(v.gps.auxBatteryV, " V")}</span>
                        </div>
                      </div>
                    ) : null}
                    <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] text-ink-muted">
                      <div className="rounded-lg bg-surface-page px-2 py-1.5">
                        Ign-on <span className="font-semibold text-ink">{fmt(v.gpsMetrics?.ignOnPct, "%")}</span>
                      </div>
                      <div className="rounded-lg bg-surface-page px-2 py-1.5">
                        Max speed <span className="font-semibold text-ink">{fmt(v.gpsMetrics?.maxSpeedKph, " km/h")}</span>
                      </div>
                      <div className={`rounded-lg px-2 py-1.5 ${mismatch ? "bg-amber-50" : "bg-surface-page"}`}>
                        Path/report{" "}
                        <span className="font-semibold text-ink">
                          {fmt(v.gpsMetrics?.pathKm)} / {fmt(v.gpsMetrics?.reportKm ?? v.trip?.distanceKm)} km
                        </span>
                      </div>
                      <div className="rounded-lg bg-surface-page px-2 py-1.5">
                        Trip score <span className="font-semibold text-ink">{fmt(v.gpsMetrics?.tripScore ?? v.trip?.score)}</span>
                      </div>
                    </div>
                    {p.showSocStrip ? (
                      endSoc != null ? (
                        <div className="mt-3">
                          <div className="mb-1 flex justify-between text-xs text-ink-muted">
                            <span>Trip-end SOC (report)</span>
                            <span className="font-semibold text-ink">{endSoc}%</span>
                          </div>
                          <div className="h-2 w-full overflow-hidden rounded-full bg-surface-page">
                            <div
                              className={`h-full rounded-full ${low ? "bg-amber-500" : "bg-brand"}`}
                              style={{ width: `${endSoc}%` }}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="mt-3">
                          <SignalGate state="unavailable" label="SOC not in trip report" />
                        </div>
                      )
                    ) : null}
                    <Link to={`/can-telemetry/${v.id}`} className="mt-2 inline-block text-[11px] font-semibold text-brand">
                      Open telemetry →
                    </Link>
                    {p.showImmobilise && v.allowImmobilise ? (
                      <div className="mt-3">
                        <Button variant="secondary" className="w-full py-2 text-xs">
                          Immobilise
                        </Button>
                      </div>
                    ) : null}
                  </Card>
                  </div>
                );
              })}
            </div>
          </div>
        ) : null}
      </div>

      {daily.length > 0 ? (
        <Card className="mt-8 p-5">
          <div className="mb-3 text-sm font-semibold text-ink">
            Daily utilisation · {selected?.registration ?? "selected vehicle"} (GPS path km)
          </div>
          <div className="h-[180px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={daily} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                <CartesianGrid {...cartesianGrid} />
                <XAxis dataKey="day" tickFormatter={(d) => String(d).slice(5)} {...axisProps} />
                <YAxis {...axisProps} width={36} />
                <Tooltip {...tooltipProps} formatter={(v: number) => [`${v} km`, "Path"]} />
                <Bar dataKey="km" name="GPS path km" fill={chart.brand} radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      ) : null}

      {metrics && metrics.stops.length > 0 ? (
        <Card className="mt-6 overflow-x-auto p-0">
          <div className="border-b border-line px-5 py-3 text-sm font-semibold text-ink">
            Stop timeline · {metrics.registration} ({metrics.stopCount} clusters ≥ 5 min)
          </div>
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-page text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-5 py-3">Start</th>
                <th className="px-5 py-3">End</th>
                <th className="px-5 py-3">Dwell</th>
                <th className="px-5 py-3">Lat / lng</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {metrics.stops.slice(0, 12).map((s, i) => (
                <tr key={`${s.startedAt}-${i}`}>
                  <td className="px-5 py-2 tabular-nums text-ink-muted">{s.startedAt.replace("T", " ").slice(0, 19)}</td>
                  <td className="px-5 py-2 tabular-nums text-ink-muted">{s.endedAt.replace("T", " ").slice(0, 19)}</td>
                  <td className="px-5 py-2 tabular-nums">{s.dwellMin} min</td>
                  <td className="px-5 py-2 tabular-nums text-xs">
                    {s.lat.toFixed(4)}, {s.lng.toFixed(4)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}

      {p.showTripLedger && trips.length > 0 ? (
        <Card className="mt-8 overflow-x-auto p-0">
          <div className="border-b border-line px-5 py-3 text-sm font-semibold text-ink">Trip ledger (BluWheelz report + GPS path)</div>
          <table className="min-w-full text-left text-sm">
            <thead className="border-b border-line bg-surface-page text-[11px] font-semibold uppercase tracking-wide text-ink-muted">
              <tr>
                <th className="px-5 py-3">Vehicle</th>
                <th className="px-5 py-3">Model</th>
                <th className="px-5 py-3">Score</th>
                <th className="px-5 py-3">Report km</th>
                <th className="px-5 py-3">GPS path</th>
                <th className="px-5 py-3">Δ km</th>
                <th className="px-5 py-3">Duration</th>
                <th className="px-5 py-3">Avg / idle</th>
                <th className="px-5 py-3">SOC</th>
                <th className="px-5 py-3">DTE</th>
                <th className="px-5 py-3">Odo</th>
                <th className="px-5 py-3">Energy / mileage</th>
                <th className="px-5 py-3">Fuel</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {trips.map((t) => (
                <tr key={t.vehicleId} className="hover:bg-surface-page/80">
                  <td className="px-5 py-3">
                    <Link to={`/can-telemetry/${t.vehicleId}`} className="font-semibold text-brand">
                      {t.registration}
                    </Link>
                    <div className="text-[11px] text-ink-faint">{t.operator}</div>
                  </td>
                  <td className="px-5 py-3 text-ink-muted">{t.model}</td>
                  <td className="px-5 py-3 tabular-nums">{t.score ?? "—"}</td>
                  <td className="px-5 py-3 tabular-nums">{t.distanceKm ?? "—"} km</td>
                  <td className="px-5 py-3 tabular-nums">{t.gpsDistanceKm ?? "—"} km</td>
                  <td className="px-5 py-3 tabular-nums">{t.distanceDeltaKm ?? "—"}</td>
                  <td className="px-5 py-3 tabular-nums">{t.durationMin != null ? Math.round(t.durationMin) : "—"} min</td>
                  <td className="px-5 py-3 tabular-nums text-xs">
                    {t.avgSpeedKph ?? "—"} km/h
                    <br />
                    idle {t.idleMin ?? "—"} / AC {t.acIdleMin ?? "—"}
                  </td>
                  <td className="px-5 py-3 tabular-nums">
                    {t.startSocPct != null && t.endSocPct != null ? `${t.startSocPct}% → ${t.endSocPct}%` : "—"}
                  </td>
                  <td className="px-5 py-3 tabular-nums">
                    {t.startDteKm || t.endDteKm ? `${t.startDteKm ?? "—"} → ${t.endDteKm ?? "—"}` : "—"}
                  </td>
                  <td className="px-5 py-3 tabular-nums text-xs">
                    {t.startOdoKm != null && t.endOdoKm != null
                      ? `${Math.round(t.startOdoKm).toLocaleString("en-IN")} → ${Math.round(t.endOdoKm).toLocaleString("en-IN")}`
                      : "—"}
                  </td>
                  <td className="px-5 py-3 tabular-nums text-xs">
                    {t.energyUsed ?? "—"}
                    <br />
                    {t.efficiency ?? "—"} · chg {t.chargingMin ?? "—"} min
                  </td>
                  <td className="px-5 py-3 text-xs">{t.fuelType ?? "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      ) : null}
    </div>
  );
}
