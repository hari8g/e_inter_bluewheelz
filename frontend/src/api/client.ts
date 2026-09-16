import type {
  AssetLifecycleStage,
  BatteryHealthPoint,
  CommandCenterPayload,
  DriverClassification,
  FleetPolicy,
  GpsDevice,
  MaintenanceItem,
  PortfolioValuationPayload,
  Vehicle,
  CanLivePayload,
  CellSnapshotPayload,
  DailyDistancePoint,
  GpsHistoryPayload,
  GpsMetrics,
  TripLedgerRow,
} from "@/types/api";

/** Live BluWheelz API (serves login + dashboard). The older e-inter-api host has no /auth/login. */
const CANONICAL_API_ORIGIN = "https://e-inter-bluewheelz.onrender.com";
const LEGACY_API_HOSTS = new Set(["e-inter-api.onrender.com"]);

/**
 * Reads `VITE_API_ORIGIN` with common dashboard / .env mistakes removed (quotes,
 * CR/LF). Vite only exposes `VITE_*` to the client as strings.
 */
function readApiOriginEnv(): string {
  let raw = String(import.meta.env.VITE_API_ORIGIN ?? "").trim();
  if (
    (raw.startsWith('"') && raw.endsWith('"')) ||
    (raw.startsWith("'") && raw.endsWith("'"))
  ) {
    raw = raw.slice(1, -1).trim();
  }
  raw = raw.replace(/[\r\n\t]+/g, "");
  return raw;
}

function parseHttpOrigin(raw: string): string | null {
  let toParse = raw.replace(/\/$/, "");
  if (!/^https?:\/\//i.test(toParse)) {
    if (/^(\[::1\]|localhost|127\.0\.0\.1)/i.test(toParse)) {
      toParse = `http://${toParse}`;
    } else {
      toParse = `https://${toParse}`;
    }
  }
  try {
    const u = new URL(toParse);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    if (!u.hostname) return null;
    if (LEGACY_API_HOSTS.has(u.hostname)) return CANONICAL_API_ORIGIN;
    return u.origin;
  } catch {
    return null;
  }
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "[::1]";
}

function useSameOriginApi(hostname: string): boolean {
  return (
    isLocalHost(hostname) ||
    hostname.endsWith(".vercel.app") ||
    hostname === "e-inter-bluewheelz.onrender.com"
  );
}

/**
 * Vercel and the Render combined host must use same-origin `/api/v1` (proxy/rewrite).
 * Absolute Render URLs trigger a CORS preflight that the browser will block.
 */
function resolveApiBase(): string {
  if (typeof window !== "undefined" && useSameOriginApi(window.location.hostname)) {
    return "/api/v1";
  }
  const raw = readApiOriginEnv();
  if (raw) {
    const origin = parseHttpOrigin(raw);
    if (origin) return `${origin}/api/v1`;
    console.warn("[e-inter] Invalid VITE_API_ORIGIN; using canonical API", raw);
    return `${CANONICAL_API_ORIGIN}/api/v1`;
  }
  if (typeof window !== "undefined") {
    return `${CANONICAL_API_ORIGIN}/api/v1`;
  }
  return "/api/v1";
}

let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(handler: (() => void) | null) {
  unauthorizedHandler = handler;
}

function getAuthToken(): string | null {
  if (typeof sessionStorage === "undefined") return null;
  return sessionStorage.getItem("e-inter.session");
}

function parseError(status: number, text: string): Error {
  const trimmed = text.trim();
  if (
    trimmed.startsWith("<") ||
    /cannot post \/api\/v1\/auth\/login/i.test(trimmed)
  ) {
    return new Error(
      "Login did not reach the e-inter API. Open the Render API URL (not a separate frontend host), or set VITE_API_ORIGIN to that API URL and rebuild.",
    );
  }
  try {
    const body = JSON.parse(text) as { error?: string };
    if (body.error === "invalid_credentials") return new Error("Invalid username or password.");
    if (body.error === "unauthorized") return new Error("Session expired. Please sign in again.");
    if (body.error) return new Error(body.error.replace(/_/g, " "));
  } catch {
    /* raw text */
  }
  return new Error(text || `Request failed (${status})`);
}

function isMissingLoginRoute(status: number, text: string): boolean {
  return status === 404 && /cannot post \/api\/v1\/auth\/login/i.test(text);
}

/**
 * Relative `/api/v1/…` cannot be resolved by `fetch` on `file:` pages or opaque
 * origins (`location.origin === "null"`), which surfaces as WebKit’s
 * "The string did not match the expected pattern."
 */
function buildFetchUrl(path: string, apiBase = resolveApiBase()): string {
  const joined = `${apiBase}${path}`;
  if (joined.startsWith("http://") || joined.startsWith("https://")) {
    try {
      return new URL(joined).href;
    } catch {
      console.warn("[e-inter] Invalid resolved API URL", joined);
      return `http://127.0.0.1:8787/api/v1${path}`;
    }
  }
  if (typeof window !== "undefined") {
    const { protocol, origin } = window.location;
    if (protocol === "file:" || origin === "null" || origin === "") {
      return `http://127.0.0.1:8787/api/v1${path}`;
    }
  }
  return joined;
}

async function j<T>(path: string, init?: RequestInit, apiBase?: string): Promise<T> {
  const url = buildFetchUrl(path, apiBase);
  const headers = init?.headers ? new Headers(init.headers as HeadersInit) : new Headers();
  if (init?.body != null && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }
  const token = getAuthToken();
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  const res = await fetch(url, {
    ...init,
    headers,
  });
  if (!res.ok) {
    const text = await res.text();
    const canonicalBase = `${CANONICAL_API_ORIGIN}/api/v1`;
    if (
      path === "/auth/login" &&
      isMissingLoginRoute(res.status, text) &&
      apiBase !== canonicalBase &&
      !url.startsWith(canonicalBase)
    ) {
      return j<T>(path, init, canonicalBase);
    }
    if (res.status === 401 && path !== "/auth/login") {
      unauthorizedHandler?.();
    }
    throw parseError(res.status, text);
  }
  return res.json() as Promise<T>;
}

export const api = {
  login: (username: string, password: string) =>
    j<{ token: string; username: string; displayName: string }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ username, password }),
    }),
  me: () => j<{ username: string; displayName: string }>("/auth/me"),
  commandCenter: () => j<CommandCenterPayload>("/command-center"),
  policy: () => j<FleetPolicy>("/policy"),
  updatePolicy: (body: Partial<FleetPolicy>) =>
    j<FleetPolicy>("/policy", { method: "PUT", body: JSON.stringify(body) }),
  vehicles: () => j<Vehicle[]>("/vehicles"),
  registerVehicle: (body: Record<string, unknown>) =>
    j<Vehicle>("/vehicles", { method: "POST", body: JSON.stringify(body) }),
  devices: () => j<GpsDevice[]>("/devices"),
  registerDevice: (serial?: string) =>
    j<GpsDevice>("/devices", { method: "POST", body: JSON.stringify({ serial }) }),
  unpairDevice: (id: string) => j<GpsDevice>(`/devices/${id}/unpair`, { method: "POST" }),
  maintenance: () => j<MaintenanceItem[]>("/maintenance"),
  addMaintenance: (body: Record<string, unknown>) =>
    j<MaintenanceItem>("/maintenance", { method: "POST", body: JSON.stringify(body) }),
  updateMaintenanceStatus: (id: string, status: MaintenanceItem["status"]) =>
    j<MaintenanceItem>(`/maintenance/${id}`, {
      method: "PATCH",
      body: JSON.stringify({ status }),
    }),
  batteryHealth: () => j<{ updatedAt: string; items: BatteryHealthPoint[] }>("/analytics/battery-health"),
  assetLifecycle: () => j<{ updatedAt: string; items: AssetLifecycleStage[] }>("/analytics/asset-lifecycle"),
  drivers: () => j<{ updatedAt: string; items: DriverClassification[] }>("/analytics/driver-classification"),
  portfolioValuation: () => j<PortfolioValuationPayload>("/analytics/portfolio-valuation"),
  canLive: (id: string) => j<CanLivePayload>(`/vehicles/${id}/can-live`),
  cells: (id: string) => j<CellSnapshotPayload>(`/vehicles/${id}/cells`),
  gpsHistory: (id: string, opts?: { max?: number; from?: string; to?: string }) => {
    const q = new URLSearchParams();
    q.set("max", String(opts?.max ?? 1200));
    if (opts?.from) q.set("from", opts.from);
    if (opts?.to) q.set("to", opts.to);
    return j<GpsHistoryPayload>(`/vehicles/${id}/gps-history?${q.toString()}`);
  },
  gpsMetrics: (id: string) => j<GpsMetrics>(`/vehicles/${id}/gps-metrics`),
  dailyDistance: (id: string) => j<{ vehicleId: string; items: DailyDistancePoint[] }>(`/vehicles/${id}/daily-distance`),
  tripDetail: (id: string) => j<TripLedgerRow>(`/vehicles/${id}/trip`),
  trips: () => j<{ updatedAt: string; items: TripLedgerRow[] }>("/trips"),
};
