import { BarChart3, BatteryCharging, IndianRupee, Radio, Route, Shield } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Area, AreaChart, ResponsiveContainer, Tooltip } from "recharts";
import { api } from "@/api/client";
import { chart, tooltipProps } from "@/lib/chartTheme";
import { PageHeader } from "@/layout/AppShell";
import { Card } from "@/ui/Card";

type Summary = { fmvLakh: number; gpsKm: number; tripScore: number };

function Spark({ data, color }: { data: { v: number }[]; color: string }) {
  const gid = useId().replace(/:/g, "");
  return (
    <div className="h-14 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 2, right: 0, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.35} />
              <stop offset="100%" stopColor={color} stopOpacity={0} />
            </linearGradient>
          </defs>
          <Tooltip {...tooltipProps} formatter={(v: number) => [`${v}`, ""]} />
          <Area
            type="monotone"
            dataKey="v"
            stroke={color}
            fill={`url(#${gid})`}
            strokeWidth={1.5}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}

export default function Analytics() {
  const [summary, setSummary] = useState<Summary | null>(null);
  const [kmSpark, setKmSpark] = useState<{ v: number }[]>([]);
  const [scoreSpark, setScoreSpark] = useState<{ v: number }[]>([]);
  const [wearSpark, setWearSpark] = useState<{ v: number }[]>([]);
  const [driverSpark, setDriverSpark] = useState<{ v: number }[]>([]);

  useEffect(() => {
    let alive = true;
    Promise.all([api.portfolioValuation(), api.trips(), api.drivers(), api.assetLifecycle(), api.vehicles()])
      .then(async ([pv, trips, drv, life, vehicles]) => {
        if (!alive) return;
        const scores = trips.items.map((t) => t.score).filter((n): n is number => n != null);
        setSummary({
          fmvLakh: Math.round(pv.enterprise.totalFairMarketValueInr / 100_000) / 10,
          gpsKm: Math.round(trips.items.reduce((s, t) => s + (t.gpsDistanceKm ?? 0), 0)),
          tripScore: scores.length ? Math.round(scores.reduce((s, n) => s + n, 0) / scores.length) : 0,
        });
        setScoreSpark(trips.items.map((t) => ({ v: t.score ?? 0 })));
        const wear = life.items[0]?.wearSeries ?? [];
        setWearSpark(wear.map((w) => ({ v: w.wearIndex })));
        const sc = drv.items[0]?.safetyHistory ?? [];
        setDriverSpark(sc.map((s) => ({ v: s.score })));
        if (vehicles[0]) {
          const daily = await api.dailyDistance(vehicles[0].id);
          if (alive) setKmSpark(daily.items.map((d) => ({ v: d.km })));
        }
      })
      .catch(() => alive && setSummary({ fmvLakh: 0, gpsKm: 0, tripScore: 0 }));
    return () => {
      alive = false;
    };
  }, []);

  const sparkSafe = useMemo(() => (kmSpark.length ? kmSpark : [{ v: 12 }]), [kmSpark]);

  const tiles = [
    {
      to: "/can-telemetry",
      title: "Trip and GPS workspace",
      operatorLine: "What did the traces actually measure this week?",
      desc: "Workbook fields, GPS path vs report km, ignition and 12V charts, stop clusters, and playback. Start here before any CAN-shaped screen.",
      icon: Radio,
      stat: summary ? `${summary.gpsKm} km GPS path · mean trip score ${summary.tripScore || "—"}` : "—",
      spark: sparkSafe,
      sparkColor: chart.brand,
    },
    {
      to: "/battery-health",
      title: "Trip energy & 12V",
      operatorLine: "SOC bookends, report energy, accessory batteries — not pack SOH.",
      desc: "Ranking by trip-end SOC (nulls last), GPS path km, mileage, and 12V/device min-max. Capacity SOH % is not invented from these files.",
      icon: BatteryCharging,
      stat: summary ? "SOH unobservable on this fleet" : "—",
      spark: scoreSpark.length ? scoreSpark : [{ v: 70 }],
      sparkColor: chart.brand,
    },
    {
      to: "/asset-lifecycle",
      title: "Asset lifecycle",
      operatorLine: "When is the next major service, and how hard is the asset being used?",
      desc: "Odometer-forward view: wear index, projected major-service window, duty and thermal hints. Good for workshop planning and retire/watch decisions.",
      icon: Route,
      stat: "Open for wear curve and service horizon",
      spark: wearSpark.length ? wearSpark : [{ v: 42 }],
      sparkColor: chart.warn,
    },
    {
      to: "/drivers",
      title: "Vehicle trip quality",
      operatorLine: "Which GPS traces look harsh, idle-heavy, or low-scoring?",
      desc: "Trip score plus coarse GPS harsh (~30 s). No named drivers. Daily GPS harsh / distance is the history, not empty arrays.",
      icon: Shield,
      stat: summary ? `Mean trip score ${summary.tripScore || "—"}` : "—",
      spark: driverSpark.length ? driverSpark : [{ v: 75 }],
      sparkColor: chart.accent,
    },
    {
      to: "/portfolio-value",
      title: "Portfolio value",
      operatorLine: "What is the fleet worth on paper for NBFC or dry-lease review?",
      desc: "Indicative list, fair market value, and 36-month-style residual in INR — enterprise totals plus per-asset notes for credit desks.",
      icon: IndianRupee,
      stat: summary ? `~₹${summary.fmvLakh}L model FMV (demo)` : "—",
      spark: [
        { v: 62 },
        { v: 64 },
        { v: 63 },
        { v: 66 },
        { v: 65 },
        { v: 68 },
        { v: 67 },
        { v: 70 },
      ],
      sparkColor: chart.brand,
    },
  ];

  return (
    <div className="pb-20 lg:pb-0">
      <PageHeader
        title="Analytics hub"
        description="One place for fleet analysts and control-room operators: pick a workspace below. Each card opens the full module; sparklines are a quick pulse only."
        actions={
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-xs font-semibold uppercase tracking-wide text-ink shadow-sm hover:bg-surface-page"
          >
            <BarChart3 className="h-4 w-4 text-brand" />
            Back to command centre
          </Link>
        }
      />

      <Card className="mb-6 border-brand-border/60 bg-brand-muted/25 p-4 text-sm leading-relaxed text-ink">
        <div className="text-xs font-bold uppercase tracking-wide text-brand">How to use this page</div>
        <ul className="mt-2 list-inside list-disc space-y-1 text-ink-muted marker:text-brand">
          <li>Start with <strong className="text-ink">Trip and GPS workspace</strong> for the measured traces and workbook.</li>
          <li>Use <strong className="text-ink">Trip energy &amp; 12V</strong> for SOC bookends and accessory batteries — not pack SOH.</li>
          <li>Use <strong className="text-ink">Asset lifecycle</strong> for odometer-based service planning.</li>
          <li>Open <strong className="text-ink">Vehicle trip quality</strong> for trip score and coarse GPS harsh.</li>
          <li>Open <strong className="text-ink">Portfolio value</strong> for NBFC / lessor FMV (SOH unobservable).</li>
        </ul>
      </Card>

      <div className="grid gap-5 md:grid-cols-2">
        {tiles.map((t) => (
          <Link key={t.to} to={t.to} className="group block">
            <Card className="h-full overflow-hidden transition group-hover:border-brand-border group-hover:shadow-md">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-brand">Workspace</div>
                  <h2 className="mt-1 text-lg font-semibold text-ink group-hover:text-brand">{t.title}</h2>
                </div>
                <t.icon className="h-5 w-5 text-ink-faint group-hover:text-brand" />
              </div>
              <p className="mt-1 text-xs font-medium text-ink">{t.operatorLine}</p>
              <p className="mt-2 text-sm leading-relaxed text-ink-muted">{t.desc}</p>
              <div className="mt-4 rounded-lg border border-line bg-surface-page/80 px-2 py-2">
                <Spark data={t.spark} color={t.sparkColor} />
              </div>
              <div className="mt-3 text-xs font-semibold text-ink">{t.stat}</div>
              <div className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-brand opacity-0 transition group-hover:opacity-100">
                Open module →
              </div>
            </Card>
          </Link>
        ))}
      </div>
    </div>
  );
}
