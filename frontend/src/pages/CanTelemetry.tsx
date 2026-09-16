import { Radio } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { api } from "@/api/client";
import { FleetMap } from "@/components/FleetMap";
import { SignalGate } from "@/components/SignalGate";
import { chart, cartesianGrid, axisProps, tooltipProps } from "@/lib/chartTheme";
import { PageHeader } from "@/layout/AppShell";
import { Card } from "@/ui/Card";
import type {
  CanLivePayload,
  CellSnapshotPayload,
  DailyDistancePoint,
  FleetPolicy,
  GpsHistoryPayload,
  GpsMetrics,
  TripLedgerRow,
  Vehicle,
} from "@/types/api";

function fmt(v: unknown, unit = "") {
  if (v == null) return "—";
  if (typeof v === "boolean") return v ? "On" : "Off";
  if (typeof v === "number") return `${Number.isInteger(v) ? v : v.toFixed(2)}${unit ? ` ${unit}` : ""}`;
  if (Array.isArray(v)) return `${v.length} values`;
  return String(v);
}

const CAN_DOMAINS = new Set(["Vehicle & drive", "Battery & BMS", "Charging", "Driver", "Body", "Drive modes"]);

const FALLBACK_POLICY: FleetPolicy = {
  showMap: true,
  showSocStrip: true,
  showImmobilise: false,
  highlightLowSoc: false,
  showAssetStrip: true,
  showTripLedger: true,
  highlightStaleGps: true,
  gpsUplinkTargetSeconds: 30,
  stalePositionMinutes: 15,
  lowSocAlertPercent: 20,
  geofenceBreachAlerts: false,
  deviceBatteryAlertVolts: 3.9,
  highlightGpsReportMismatch: true,
};

function TripField({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-surface-page px-3 py-2">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-ink-muted">{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-ink">{value}</div>
    </div>
  );
}

export default function CanTelemetry() {
  const { id } = useParams();
  const [vehicles, setVehicles] = useState<Vehicle[]>([]);
  const [live, setLive] = useState<CanLivePayload | null>(null);
  const [cells, setCells] = useState<CellSnapshotPayload | null>(null);
  const [gps, setGps] = useState<GpsHistoryPayload | null>(null);
  const [metrics, setMetrics] = useState<GpsMetrics | null>(null);
  const [daily, setDaily] = useState<DailyDistancePoint[]>([]);
  const [trip, setTrip] = useState<TripLedgerRow | null>(null);
  const [policy, setPolicy] = useState<FleetPolicy>(FALLBACK_POLICY);
  const [playIdx, setPlayIdx] = useState(0);
  const [err, setErr] = useState<string | null>(null);
  const [canOpen, setCanOpen] = useState(false);
  const selected = id ?? vehicles[0]?.id;
  const vehicle = vehicles.find((v) => v.id === selected) ?? null;
  const gpsOnly = vehicle?.telemetryMode === "gps_only" || live?.observability.oemPlatform === "file_gps";

  useEffect(() => {
    api.vehicles().then(setVehicles).catch((e: Error) => setErr(e.message));
    api.policy().then(setPolicy).catch(() => undefined);
  }, []);

  useEffect(() => {
    if (!selected) return;
    let alive = true;
    const load = () => {
      Promise.all([
        api.canLive(selected),
        api.cells(selected),
        api.gpsHistory(selected, { max: 1200 }),
        api.gpsMetrics(selected),
        api.dailyDistance(selected),
        api.tripDetail(selected).catch(() => null),
      ])
        .then(([l, c, g, m, d, t]) => {
          if (!alive) return;
          setLive(l);
          setCells(c);
          setGps(g);
          setMetrics(m);
          setDaily(d.items);
          setTrip(t);
          setPlayIdx(g.points.length ? g.points.length - 1 : 0);
          setErr(null);
        })
        .catch((e: Error) => {
          if (alive) setErr(e.message);
        });
    };
    load();
    const t = setInterval(load, 30_000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [selected]);

  const grouped = useMemo(() => {
    const map = new Map<string, CanLivePayload["signals"]>();
    for (const s of live?.signals ?? []) {
      const list = map.get(s.domainLabel) ?? [];
      list.push(s);
      map.set(s.domainLabel, list);
    }
    return [...map.entries()];
  }, [live]);

  const gpsTripDomains = grouped.filter(([d]) => d === "GPS trace" || d === "Trip report");
  const canDomains = grouped.filter(([d]) => CAN_DOMAINS.has(d));
  const canAllEmpty = canDomains.every(([, signals]) => signals.every((s) => s.quality === "unavailable"));

  const spark = useMemo(
    () =>
      (gps?.points ?? []).map((p) => ({
        t: p.t.slice(11, 16),
        speed: p.speedKph,
        device: p.deviceBatteryV,
        aux: p.auxBatteryV,
        ign: p.ignition ? 1 : 0,
      })),
    [gps],
  );

  const tripSnap = trip ?? live?.trip ?? null;
  const mapVehicle = vehicle
    ? {
        ...vehicle,
        track: (gps?.points ?? []).map((p) => ({ lat: p.lat, lng: p.lng })),
      }
    : null;

  return (
    <div className="pb-20 lg:pb-0">
      <PageHeader
        title="Telemetry"
        description="GPS/trip workspace from BluWheelz files. Canonical GPS and trip fields first; CAN domains stay collapsed when the source files do not expose them."
      />
      <div className="mb-4 flex flex-wrap gap-2">
        {vehicles.map((v) => (
          <Link
            key={v.id}
            to={`/can-telemetry/${v.id}`}
            className={`rounded-full px-3 py-1 text-xs font-semibold ring-1 ${
              v.id === selected ? "bg-brand-muted text-brand ring-brand-border" : "bg-white text-ink-muted ring-line"
            }`}
          >
            {v.registration}
          </Link>
        ))}
      </div>
      {err ? (
        <Card className="border-amber-200 bg-amber-50 text-sm text-amber-950">{err}</Card>
      ) : null}
      {live ? (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <Card className="p-4 text-sm">
              <div className="text-[10px] font-semibold uppercase text-ink-muted">Platform</div>
              <div className="mt-1 font-semibold text-ink">{live.observability.oemPlatform}</div>
              <div className="text-xs text-ink-muted">Coverage {live.observability.coverage24hPct}%</div>
            </Card>
            <Card className="p-4 text-sm">
              <div className="text-[10px] font-semibold uppercase text-ink-muted">Last GPS / CAN frame</div>
              <div className="mt-1 font-semibold text-ink">
                {live.freshnessSeconds == null ? "No frame yet" : `${Math.round(live.freshnessSeconds / 3600)} h ago`}
              </div>
              {live.position?.gpsSpeedKph != null ? (
                <div className="text-xs text-ink-muted">GPS speed {live.position.gpsSpeedKph} km/h</div>
              ) : null}
            </Card>
            <Card className="p-4 text-sm">
              <div className="flex items-center gap-2 text-[10px] font-semibold uppercase text-ink-muted">
                <Radio className="h-3 w-3" /> Profile
              </div>
              <div className="mt-1 font-mono text-xs text-ink">{live.observability.signalProfileId}</div>
              {metrics ? (
                <div className="text-xs text-ink-muted">
                  {metrics.pointCount.toLocaleString("en-IN")} points · path {metrics.pathKm} km
                </div>
              ) : null}
            </Card>
          </div>

          {tripSnap ? (
            <Card className="mb-6 p-4">
              <div className="mb-3 text-sm font-semibold text-ink">Trip report (workbook)</div>
              <div className="grid gap-2 sm:grid-cols-3 lg:grid-cols-4">
                <TripField label="Model / operator" value={`${tripSnap.model ?? "—"} · ${tripSnap.operator ?? "—"}`} />
                <TripField label="Score" value={fmt("score" in tripSnap ? tripSnap.score : live.trip?.score)} />
                <TripField label="Report distance" value={fmt(tripSnap.distanceKm, " km")} />
                <TripField label="GPS path" value={fmt(metrics?.pathKm, " km")} />
                <TripField label="Duration" value={tripSnap.durationMin != null ? `${Math.round(tripSnap.durationMin)} min` : "—"} />
                <TripField label="Avg speed" value={fmt(tripSnap.avgSpeedKph, " km/h")} />
                <TripField label="Idle / AC idle" value={`${fmt(tripSnap.idleMin, " min")} / ${fmt("acIdleMin" in tripSnap ? tripSnap.acIdleMin : live.trip?.acIdleMin, " min")}`} />
                <TripField label="Mileage" value={fmt(tripSnap.efficiency)} />
                <TripField
                  label="SOC bookends"
                  value={
                    tripSnap.startSocPct != null && tripSnap.endSocPct != null
                      ? `${tripSnap.startSocPct}% → ${tripSnap.endSocPct}%`
                      : "not in report"
                  }
                />
                <TripField
                  label="DTE bookends"
                  value={
                    (tripSnap.startDteKm || tripSnap.endDteKm)
                      ? `${fmt(tripSnap.startDteKm)} → ${fmt(tripSnap.endDteKm)} km`
                      : "—"
                  }
                />
                <TripField
                  label="Odometer"
                  value={
                    tripSnap.startOdoKm != null && tripSnap.endOdoKm != null
                      ? `${Math.round(tripSnap.startOdoKm).toLocaleString("en-IN")} → ${Math.round(tripSnap.endOdoKm).toLocaleString("en-IN")}`
                      : "—"
                  }
                />
                <TripField label="Energy used (report units)" value={fmt(tripSnap.energyUsed)} />
                <TripField label="Charging" value={fmt(tripSnap.chargingMin, " min")} />
                <TripField label="Fuel type" value={fmt(tripSnap.fuelType)} />
                <TripField
                  label="Start lat/lng"
                  value={
                    tripSnap.startLat != null && tripSnap.startLng != null
                      ? `${tripSnap.startLat.toFixed(4)}, ${tripSnap.startLng.toFixed(4)}`
                      : "—"
                  }
                />
                <TripField
                  label="End lat/lng"
                  value={
                    tripSnap.endLat != null && tripSnap.endLng != null
                      ? `${tripSnap.endLat.toFixed(4)}, ${tripSnap.endLng.toFixed(4)}`
                      : "—"
                  }
                />
                <TripField label="Start" value={tripSnap.startAt ? tripSnap.startAt.replace("T", " ").slice(0, 19) : "—"} />
                <TripField label="End" value={tripSnap.endAt ? tripSnap.endAt.replace("T", " ").slice(0, 19) : "—"} />
              </div>
            </Card>
          ) : null}

          {mapVehicle && gps && gps.points.length > 1 ? (
            <Card className="mb-6 p-4">
              <div className="mb-3 text-sm font-semibold text-ink">GPS explorer</div>
              <FleetMap
                vehicles={[mapVehicle]}
                policy={policy}
                playback={{ vehicleId: mapVehicle.id, points: gps.points, index: playIdx }}
                stops={metrics?.stops}
              />
              <div className="mt-3">
                <div className="mb-1 flex justify-between text-xs text-ink-muted">
                  <span>Playback · ~{metrics?.medianGapSec ?? 30}s sampling</span>
                  <span className="tabular-nums">{gps.points[playIdx]?.t.replace("T", " ").slice(0, 19)}</span>
                </div>
                <input
                  type="range"
                  className="w-full accent-brand"
                  min={0}
                  max={gps.points.length - 1}
                  value={playIdx}
                  onChange={(e) => setPlayIdx(Number(e.target.value))}
                />
              </div>
              <div className="mt-4 grid gap-4 lg:grid-cols-3">
                <div className="h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={spark} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                      <CartesianGrid {...cartesianGrid} />
                      <XAxis dataKey="t" {...axisProps} interval={Math.max(0, Math.floor(spark.length / 6))} />
                      <YAxis {...axisProps} width={32} />
                      <Tooltip {...tooltipProps} />
                      <Line type="monotone" dataKey="speed" name="Speed km/h" stroke={chart.brand} dot={false} strokeWidth={1.4} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={spark} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                      <CartesianGrid {...cartesianGrid} />
                      <XAxis dataKey="t" {...axisProps} interval={Math.max(0, Math.floor(spark.length / 6))} />
                      <YAxis domain={[0, 1]} {...axisProps} width={32} />
                      <Tooltip {...tooltipProps} />
                      <Line type="stepAfter" dataKey="ign" name="Ignition" stroke={chart.warn} dot={false} strokeWidth={1.6} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
                <div className="h-[180px]">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={spark} margin={{ left: 0, right: 8, top: 8, bottom: 0 }}>
                      <CartesianGrid {...cartesianGrid} />
                      <XAxis dataKey="t" {...axisProps} interval={Math.max(0, Math.floor(spark.length / 6))} />
                      <YAxis {...axisProps} width={32} />
                      <Tooltip {...tooltipProps} />
                      <Legend wrapperStyle={{ fontSize: 10 }} />
                      <Line type="monotone" dataKey="device" name="Device V" stroke="#64748b" dot={false} strokeWidth={1.2} isAnimationActive={false} />
                      <Line type="monotone" dataKey="aux" name="12V" stroke={chart.forecast} dot={false} strokeWidth={1.2} isAnimationActive={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </Card>
          ) : null}

          {daily.length > 0 ? (
            <Card className="mb-6 p-4">
              <div className="mb-2 text-sm font-semibold text-ink">Daily GPS path km</div>
              <div className="h-[160px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={daily}>
                    <CartesianGrid {...cartesianGrid} />
                    <XAxis dataKey="day" tickFormatter={(d) => String(d).slice(5)} {...axisProps} />
                    <YAxis {...axisProps} width={36} />
                    <Tooltip {...tooltipProps} />
                    <Bar dataKey="km" fill={chart.brand} name="km" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          ) : null}

          {metrics && metrics.stops.length > 0 ? (
            <Card className="mb-6 overflow-x-auto p-0">
              <div className="border-b border-line px-4 py-3 text-sm font-semibold text-ink">
                Stop clusters (≥ 5 min, ~80 m)
              </div>
              <table className="min-w-full text-left text-sm">
                <thead className="bg-surface-page text-[11px] font-semibold uppercase text-ink-muted">
                  <tr>
                    <th className="px-4 py-2">Start</th>
                    <th className="px-4 py-2">Dwell</th>
                    <th className="px-4 py-2">Position</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {metrics.stops.map((s, i) => (
                    <tr key={`${s.startedAt}-${i}`}>
                      <td className="px-4 py-2 tabular-nums text-xs">{s.startedAt.replace("T", " ").slice(0, 19)}</td>
                      <td className="px-4 py-2 tabular-nums">{s.dwellMin} min</td>
                      <td className="px-4 py-2 tabular-nums text-xs">
                        {s.lat.toFixed(4)}, {s.lng.toFixed(4)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </Card>
          ) : null}

          {cells ? (
            cells.available ? (
              <Card className="mb-6 p-4">
                <div className="mb-2 text-sm font-semibold text-ink">
                  Cell pack · {cells.cellCount} V / {cells.tempSensorCount} T · Δ{cells.cellDeltaMv} mV
                </div>
                <div className="flex h-16 items-end gap-0.5">
                  {cells.cellVoltagesV.map((v, i) => (
                    <div
                      key={i}
                      className="flex-1 rounded-t bg-brand/80"
                      style={{ height: `${Math.max(8, ((v - 3.2) / 0.6) * 100)}%` }}
                      title={`Cell ${i + 1}: ${v} V`}
                    />
                  ))}
                </div>
              </Card>
            ) : (
              <div className="mb-6">
                <SignalGate state="unavailable" label={cells.reason} />
              </div>
            )
          ) : null}

          <div className="grid gap-4 lg:grid-cols-2">
            {gpsTripDomains.map(([domain, signals]) => (
              <Card key={domain} className="p-4">
                <h2 className="mb-3 text-sm font-semibold text-ink">{domain}</h2>
                <div className="space-y-2">
                  {signals.map((s) => {
                    const state =
                      s.quality === "unavailable" ? "unavailable" : s.quality === "pending_validation" ? "pending" : "available";
                    if (state !== "available") {
                      return <SignalGate key={s.id} state={state} label={`${s.label} — ${s.quality}`} />;
                    }
                    return (
                      <div key={s.id} className="flex items-baseline justify-between gap-3 text-sm">
                        <span className="text-ink-muted">{s.label}</span>
                        <span className="font-semibold tabular-nums text-ink">{fmt(s.value, s.unit)}</span>
                      </div>
                    );
                  })}
                </div>
              </Card>
            ))}
          </div>

          {canDomains.length > 0 ? (
            <Card className="mt-4 p-4">
              <button type="button" className="text-sm font-semibold text-ink" onClick={() => setCanOpen((o) => !o)}>
                CAN not in these files {canAllEmpty || gpsOnly ? "· collapsed" : ""} {canOpen ? "▾" : "▸"}
              </button>
              {canOpen ? (
                <div className="mt-4 grid gap-4 lg:grid-cols-2">
                  {canDomains.map(([domain, signals]) => (
                    <div key={domain}>
                      <h3 className="mb-2 text-xs font-semibold uppercase text-ink-muted">{domain}</h3>
                      <div className="space-y-2">
                        {signals.map((s) => {
                          const state =
                            s.quality === "unavailable"
                              ? "unavailable"
                              : s.quality === "pending_validation"
                                ? "pending"
                                : "available";
                          if (state !== "available") {
                            return <SignalGate key={s.id} state={state} label={`${s.label} — ${s.quality}`} />;
                          }
                          return (
                            <div key={s.id} className="flex items-baseline justify-between gap-3 text-sm">
                              <span className="text-ink-muted">{s.label}</span>
                              <span className="font-semibold tabular-nums text-ink">{fmt(s.value, s.unit)}</span>
                            </div>
                          );
                        })}
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="mt-2 text-xs text-ink-muted">
                  Vehicle / battery / charging / driver / body / mode CAN channels are unavailable in the GPS CSV and trip workbook.
                </p>
              )}
            </Card>
          ) : null}
        </>
      ) : !err ? (
        <p className="text-sm text-ink-muted">Select a vehicle to load telemetry.</p>
      ) : null}
    </div>
  );
}
