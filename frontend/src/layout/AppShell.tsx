import {
  BarChart3,
  BatteryCharging,
  Bike,
  IndianRupee,
  LayoutGrid,
  Radio,
  MapPin,
  Route,
  Settings2,
  Shield,
  UserRound,
  Wrench,
} from "lucide-react";
import type { ReactNode } from "react";
import { NavLink, Outlet, useNavigate } from "react-router-dom";
import { useAuth } from "@/auth/AuthProvider";

const nav = [
  { to: "/", label: "Command center", icon: LayoutGrid, end: true },
  { to: "/add-vehicle", label: "Add vehicle", icon: Bike },
  { to: "/gps-devices", label: "GPS devices", icon: MapPin },
  { to: "/maintenance", label: "Maintenance", icon: Wrench },
  { to: "/policy", label: "Policy & visibility", icon: Settings2 },
  { to: "/analytics", label: "Analytics", icon: BarChart3 },
  { to: "/battery-health", label: "Battery health", icon: BatteryCharging },
  { to: "/asset-lifecycle", label: "Asset lifecycle", icon: Route },
  { to: "/drivers", label: "Drivers", icon: Shield },
  { to: "/portfolio-value", label: "Portfolio value", icon: IndianRupee },
  { to: "/can-telemetry", label: "Telemetry", icon: Radio },
];

function formatClock() {
  return new Intl.DateTimeFormat("en-IN", {
    weekday: "short",
    day: "numeric",
    month: "short",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date());
}

export function AppShell({ clock }: { clock?: string }) {
  const time = clock ?? formatClock();
  const { user, logout } = useAuth();
  const navTo = useNavigate();

  function signOut() {
    logout();
    navTo("/login", { replace: true });
  }

  return (
    <div className="flex min-h-full pb-16 lg:pb-0">
      <aside className="hidden w-64 shrink-0 border-r border-line bg-white lg:block">
        <div className="flex h-full flex-col gap-6 px-4 py-6">
          <div className="flex items-center gap-3 px-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand text-white">
              <Bike className="h-5 w-5" aria-hidden />
            </div>
            <div>
              <div className="text-sm font-semibold text-ink">e-inter</div>
              <div className="text-xs text-ink-muted">Intermediate fleet stack</div>
            </div>
          </div>
          <nav className="flex flex-1 flex-col gap-1">
            {nav.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  [
                    "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition",
                    isActive
                      ? "border border-brand-border bg-brand-muted text-brand"
                      : "text-ink-muted hover:bg-surface-page hover:text-ink",
                  ].join(" ")
                }
              >
                <item.icon className="h-4 w-4 shrink-0" aria-hidden />
                {item.label}
              </NavLink>
            ))}
          </nav>
          <div className="rounded-lg border border-dashed border-line px-3 py-2 text-xs text-ink-muted">
            GPS + trip · BluWheelz files · Bosch e-inter
          </div>
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="border-b border-line bg-white">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-8">
            <div className="flex min-w-0 items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand text-white lg:hidden">
                <Bike className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="truncate text-lg font-semibold tracking-tight text-ink">
                  e-inter <span className="font-normal text-ink-muted">Electric fleet operations</span>
                </div>
                <div className="text-xs font-medium uppercase tracking-wide text-ink-faint">
                  GPS telematics · Intellicar CAN · Bosch e-inter
                </div>
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-sm text-ink-muted">{time}</span>
              <span className="inline-flex items-center gap-1 rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-semibold text-live ring-1 ring-emerald-100">
                <span className="h-1.5 w-1.5 rounded-full bg-live" />
                LIVE
              </span>
              <span className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium text-ink shadow-sm">
                <UserRound className="h-4 w-4 text-ink-muted" />
                {user?.displayName ?? user?.username ?? "Operator"}
              </span>
              <button
                type="button"
                onClick={signOut}
                className="inline-flex items-center gap-2 rounded-lg border border-line bg-white px-3 py-2 text-sm font-medium text-ink shadow-sm hover:bg-surface-page"
              >
                Sign out
              </button>
            </div>
          </div>
        </header>
        <main className="flex-1 px-4 py-8 sm:px-8">
          <Outlet />
        </main>
      </div>
      <MobileNav />
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-8 flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
      <div className="max-w-3xl space-y-2">
        <h1 className="text-3xl font-semibold tracking-tight text-ink">{title}</h1>
        {description ? <p className="text-sm leading-relaxed text-ink-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap gap-2">{actions}</div> : null}
    </div>
  );
}

export function MobileNav() {
  return (
    <div className="fixed bottom-0 left-0 right-0 z-40 border-t border-line bg-white/95 px-2 py-2 backdrop-blur lg:hidden">
      <div className="mx-auto flex max-w-lg justify-between gap-1 overflow-x-auto">
        {nav
          .filter((item) => ["/", "/can-telemetry", "/gps-devices", "/maintenance", "/analytics"].includes(item.to))
          .map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
              [
                "flex min-w-[4.5rem] flex-col items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold",
                isActive ? "text-brand" : "text-ink-muted",
              ].join(" ")
            }
          >
            <item.icon className="h-4 w-4" />
            <span className="line-clamp-2 text-center leading-tight">{item.label}</span>
          </NavLink>
        ))}
        <NavLink
          to="/analytics"
          className={({ isActive }) =>
            `flex min-w-[4.5rem] flex-col items-center gap-1 rounded-md px-2 py-1 text-[10px] font-semibold ${isActive ? "text-brand" : "text-ink-muted"}`
          }
        >
          <BarChart3 className="h-4 w-4" />
          More
        </NavLink>
      </div>
    </div>
  );
}
