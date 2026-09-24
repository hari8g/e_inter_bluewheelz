# e-inter API — integration guide

**Audience:** teams that will call e-inter from another app (backend, mobile, partner portal, notebook).  
**Product:** Bosch e-inter × BluWheelz electric-fleet console.  
**Version:** 1.1.0  
**Date:** 24 September 2026  
**Repository:** https://github.com/hari8g/e_inter_bluewheelz

This is the HTTP contract. The React dashboard is only one client of these routes. You do **not** need the UI to use the features.

Related product documentation: `FEATURES.md` in the repo root.

---

## 1. Overview

| Item | Value |
|------|--------|
| Style | REST, JSON |
| Base path | `/api/v1` |
| Auth | Bearer session from `POST /auth/login` |
| Ops auth | Header `X-Admin-Token` (ingest/admin only) |
| Time format | ISO-8601 strings (`2026-09-14T18:22:00.000Z`) |
| Nulls | `null` means *not observed*. Do not treat as zero. |
| CORS | The API reflects the request `Origin` (browser apps are allowed) |

### Base URLs

| Environment | Origin | Example health URL |
|-------------|--------|--------------------|
| Production (this demo) | `https://e-inter-bluewheelz.onrender.com` | `https://e-inter-bluewheelz.onrender.com/api/v1/health` |
| Local | `http://127.0.0.1:8787` | `http://127.0.0.1:8787/api/v1/health` |
| Vercel UI (same-origin proxy) | your `*.vercel.app` host | `https://<app>.vercel.app/api/v1/health` |

**Use the Render (or local) API origin for server-to-server integrations.** Do not call `https://e-inter-api.onrender.com` — that host is an older API without login.

### Demo fleet IDs

When `Database/` GPS files are loaded (default demo):

| Registration | `vehicleId` | Model | Telemetry |
|--------------|-------------|-------|-----------|
| KA01AS1071 | `v_ka01as1071` | Tata Ace | `gps_only` |
| KA01AS1094 | `v_ka01as1094` | Zor Grand | `gps_only` |
| KA01AS7048 | `v_ka01as7048` | Pro X | `gps_only` |

Device IDs follow `d_<plate lowercase>` (example: `d_ka01as1071`).

---

## 2. Quick start (5 minutes)

```bash
BASE=https://e-inter-bluewheelz.onrender.com/api/v1

# 1. Public health
curl -sS "$BASE/health"

# 2. Login
TOKEN=$(curl -sS -X POST "$BASE/auth/login" \
  -H 'Content-Type: application/json' \
  -d '{"username":"bluewheelz","password":"bluewheelz"}' \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["token"])')

# 3. Call a feature
curl -sS "$BASE/command-center" -H "Authorization: Bearer $TOKEN"
curl -sS "$BASE/vehicles/v_ka01as1071/gps-metrics" -H "Authorization: Bearer $TOKEN"
```

Default operator credentials (overridable with `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD`):

- Username: `bluewheelz`
- Password: `bluewheelz`

Token lifetime: **12 hours**.

---

## 3. Authentication

### 3.1 Login

`POST /api/v1/auth/login` — **public**

Request:

```json
{ "username": "bluewheelz", "password": "bluewheelz" }
```

Response `200`:

```json
{
  "token": "eyJzdWIiOiJibHVld2hlZWx6IiwiZXhwIjoxNzg5NjIxNDI2NDA1fQ.<hmac>",
  "username": "bluewheelz",
  "displayName": "BluWheelz"
}
```

Errors:

| Status | Body | Meaning |
|--------|------|---------|
| 400 | `{ "error": "invalid_body" }` | Missing username or password |
| 401 | `{ "error": "invalid_credentials" }` | Wrong username or password |

### 3.2 Using the token

Send on every protected request:

```
Authorization: Bearer <token>
Content-Type: application/json
```

(`Content-Type` is required on POST / PUT / PATCH.)

### 3.3 Who am I

`GET /api/v1/auth/me` — session required

```json
{ "username": "bluewheelz", "displayName": "BluWheelz" }
```

### 3.4 Errors common to all protected routes

| Status | Body | Meaning |
|--------|------|---------|
| 401 | `{ "error": "unauthorized" }` | Missing, invalid, or expired token |
| 404 | `{ "error": "not_found" }` | Unknown vehicle or resource |
| 400 | `{ "error": ... }` | Validation failure (often a Zod flatten object) |

### 3.5 Admin / ops token (separate)

Routes under `/api/v1/ops/*` do **not** use the dashboard Bearer token.

```
X-Admin-Token: <ADMIN_API_TOKEN>
```

If `ADMIN_API_TOKEN` is unset on the server, these routes return `503 { "error": "ops_not_configured" }`.

---

## 4. Feature → endpoint map

Use this table to expose a dashboard screen as an API.

| Product feature | Method | Path | Notes |
|-----------------|--------|------|-------|
| Health | GET | `/health` | Public |
| Login | POST | `/auth/login` | Public |
| Session | GET | `/auth/me` | |
| Command centre | GET | `/command-center` | KPIs + vehicles + policy + optional trips |
| Trip ledger | GET | `/trips` | File-demo only; empty in live Kafka mode |
| One trip | GET | `/vehicles/:id/trip` | |
| Map / playback | GET | `/vehicles/:id/gps-history` | Point list; UI draws the map |
| Idle, stops, harsh, geofences | GET | `/vehicles/:id/gps-metrics` | |
| Daily utilisation | GET | `/vehicles/:id/daily-distance` | |
| Telemetry workspace | GET | `/vehicles/:id/can-live` | |
| History sparkline | GET | `/vehicles/:id/can-history` | |
| Cell pack | GET | `/vehicles/:id/cells` | `available: false` on this fleet |
| Battery health | GET | `/analytics/battery-health` | SOH may be `null` |
| Asset lifecycle | GET | `/analytics/asset-lifecycle` | |
| Drivers / trip quality | GET | `/analytics/driver-classification` | Not named drivers |
| Portfolio FMV | GET | `/analytics/portfolio-valuation` | INR, heuristic |
| List / add vehicles | GET, POST | `/vehicles` | |
| GPS devices | GET, POST | `/devices` | |
| Unpair device | POST | `/devices/:id/unpair` | |
| Maintenance | GET, POST, PATCH | `/maintenance`, `/maintenance/:id` | |
| Policy | GET, PUT | `/policy` | Immediate apply |
| Signal dictionary | GET | `/signal-profiles/` | |
| Ingest health | GET | `/ops/ingest-health` | Admin token |
| Rollup | POST | `/ops/rollup` | Admin token; live only |
| Quarantine | GET | `/ops/quarantine` | Admin token |

**Not an API:** immobilise (UI button only). Map tiles are OSM in the browser; your app should render `gps-history` itself.

---

## 5. Public and fleet routes

### 5.1 Health — `GET /api/v1/health`

Public. Use as a liveness probe.

```json
{
  "ok": true,
  "product": "e-inter",
  "layer": "api",
  "mode": "demo",
  "database": false
}
```

| Field | Meaning |
|-------|---------|
| `mode` | `demo` (file/seed store) or `live` (Postgres + Kafka) |
| `database` | `true` only in live mode when Postgres answers `SELECT 1` |

### 5.2 Command centre — `GET /api/v1/command-center`

Primary fleet snapshot. Same payload the home screen uses.

Important fields:

| Field | Type | Meaning |
|-------|------|---------|
| `mode` | `demo` \| `live` | Store in use |
| `fleetTotal` | number | Vehicle count |
| `reporting` | number | Vehicles with a recent fix |
| `noLink` | number | Stale / offline |
| `distanceTodayKm` | number | Last GPS-day path km (file fleet) |
| `avgSocPercent` | number | Average trip-end SOC **only where SOC exists** |
| `avgSocSampleCount` | number | How many vehicles entered that average |
| `estRangePoolKm` | number | DTE sum; treat as unused if `rangePoolAvailable` is false |
| `rangePoolAvailable` | boolean | False on the BluWheelz file fleet |
| `energyLedgerKwh` | number | Currently `0` (not computed) |
| `reportDistanceKm` | number | Workbook km (demo) |
| `dataSource` | string | e.g. file path label |
| `policy` | object | Current visibility policy |
| `vehicles` | array | Full vehicle objects (see §8) |
| `trips` | array | Trip ledger (demo) |

### 5.3 Vehicles — `GET /api/v1/vehicles`

Returns `Vehicle[]`. See §8 for the schema.

### 5.4 Register vehicle — `POST /api/v1/vehicles`

```json
{
  "registration": "KA01AS9999",
  "displayName": "Pilot Ace",
  "model": "Tata Ace",
  "telemetryMode": "gps_only",
  "allowImmobilise": false,
  "seedLat": 12.9716,
  "seedLng": 77.5946,
  "kwhPack": 21.3,
  "odometerKm": 12000,
  "socPercent": 60,
  "locationLabel": "Bengaluru",
  "oemPlatform": "tata_ace_ev",
  "nominalCapacityAh": null,
  "commissionedOn": "2025-01-15"
}
```

| Field | Required | Notes |
|-------|----------|-------|
| `registration` | yes | min 3 chars |
| `displayName` | yes | |
| `model` | yes | |
| `telemetryMode` | yes | `gps_only` or `can_gps` |
| `allowImmobilise` | yes | UI flag only |
| `seedLat`, `seedLng` | yes | numbers |
| `kwhPack` | yes | > 0 |
| `odometerKm` | yes | ≥ 0 |
| `socPercent` | yes | 0–100 |
| `locationLabel` | yes | |
| `oemPlatform` | live mode | `mahindra_zeo` \| `tata_ace_ev` \| `switch_ev` \| `eicher_ev` |

Response: `201` + `Vehicle`. Live mode without `oemPlatform` → `400 { "error": "oem_platform_required" }`.

---

## 6. GPS, trip, and telemetry

`:id` is the canonical vehicle id (`v_ka01as1071`).

### 6.1 GPS history — `GET /vehicles/:id/gps-history`

Query:

| Param | Default | Meaning |
|-------|---------|---------|
| `max` | 1500 (API) / 1200 (UI) | Max points after downsample |
| `from` | optional | ISO start |
| `to` | optional | ISO end |

Response:

```json
{
  "vehicleId": "v_ka01as1071",
  "registration": "KA01AS1071",
  "from": "2026-09-10T00:00:00.000Z",
  "to": "2026-09-14T18:00:00.000Z",
  "count": 840,
  "points": [
    {
      "t": "2026-09-14T08:01:00.000Z",
      "lat": 12.91,
      "lng": 77.63,
      "speedKph": 22.4,
      "deviceBatteryV": 4.05,
      "auxBatteryV": 13.1,
      "ignition": true
    }
  ]
}
```

Use `points` to draw a polyline, start/end pins, and playback. There is no separate “map API”.

### 6.2 GPS metrics — `GET /vehicles/:id/gps-metrics`

Derived from the GPS trace (and workbook km when present).

| Field | Meaning |
|-------|---------|
| `pathKm` | Haversine path length |
| `reportKm` | Trip-report km (`null` if absent) |
| `distanceDeltaKm` | Report − path |
| `maxSpeedKph` | Peak GPS speed |
| `ignOnPct` | Share of samples with ignition on |
| `movingPct` | Ignition on and speed ≥ 3 km/h |
| `idleGpsMin` | Idle minutes (ign off or speed &lt; 3) |
| `stopCount` | Dwells ≥ 5 min within ~80 m |
| `stops[]` | `{ startedAt, endedAt, dwellMin, lat, lng }` |
| `harshAccel` / `harshBrake` | Coarse GPS Δv/Δt, threshold 2.5 m/s² |
| `peakAccelMps2` / `peakBrakeMps2` | Peak magnitudes |
| `medianGapSec` | Median sample gap |
| `coveragePct` | Time coverage estimate |
| `firstFixAt` / `lastFixAt` | Trace bounds |
| `pointCount` | Raw / kept points |
| `deviceBatteryV` / `auxBatteryV` | Last values |
| `deviceMinV` … `auxMaxV` | Spans |
| `lowDeviceV` | Device &lt; 3.9 V seen |
| `lowAuxV` | Aux &lt; 12.2 V seen |
| `geofences` | Names of depot disks that were hit |

Harsh events are **not** CAN harsh channels. Sampling on these files is ~30 s.

### 6.3 Daily distance — `GET /vehicles/:id/daily-distance`

```json
{
  "vehicleId": "v_ka01as1071",
  "items": [
    { "day": "2026-09-14", "km": 42.1, "ignOnPct": 61, "maxSpeedKph": 48, "harshTotal": 3 }
  ]
}
```

### 6.4 Trips — `GET /trips`

```json
{
  "updatedAt": "2026-09-24T14:00:00.000Z",
  "items": [ { "vehicleId": "v_ka01as1071", "registration": "KA01AS1071", "distanceKm": 38.2 } ]
}
```

File demo: one row per ingested workbook trip, plus `gpsDistanceKm` and `distanceDeltaKm`.  
Live Kafka mode: `items` is `[]`.

### 6.5 Trip detail — `GET /vehicles/:id/trip`

One `TripLedgerRow`. `404` if none.

### 6.6 Canonical live — `GET /vehicles/:id/can-live`

Signal grid used by Telemetry.

```json
{
  "vehicleId": "v_ka01as1071",
  "registration": "KA01AS1071",
  "capturedAt": "2026-09-14T18:00:00.000Z",
  "freshnessSeconds": null,
  "signals": [
    {
      "id": "gps.speed_kph",
      "label": "GPS speed",
      "unit": "km/h",
      "domain": "gps",
      "domainLabel": "GPS trace",
      "value": 0,
      "quality": "measured"
    }
  ],
  "position": { "lat": 12.91, "lng": 77.63, "gpsSpeedKph": 0, "joinGapSeconds": null },
  "observability": {
    "oemPlatform": "tata_ace_ev",
    "signalProfileId": "file_gps",
    "availableSignals": ["gps.speed_kph", "trip.distance_km"],
    "pendingSignals": [],
    "unavailableSignals": ["batt.cell_voltage_v"],
    "lastFrameAt": null,
    "coverage24hPct": 0
  },
  "trip": { "distanceKm": 38.2, "endSocPct": 64 }
}
```

On this fleet, CAN domains are listed as unavailable. Do not invent cell voltages from `signals`.

### 6.7 History — `GET /vehicles/:id/can-history`

Query: `signal` (required in live), optional `from`, `to`.

**Demo mode** (file fleet): `signal` defaults to `gps.speed_kph`. Supported picks: `gps.speed_kph`, `veh.speed_kph`, `gps.device_battery_v`, `gps.aux_battery_v`, `gps.ignition` (0/1).

**Live mode:** `signal` must be one of:

`batt.soc_pct`, `veh.odometer_km`, `veh.speed_kph`, `batt.dte_km`, `batt.pack_voltage_v`, `batt.pack_current_a`, `batt.pack_power_kw`, `batt.cell_delta_mv`, `batt.cell_temp_max_c`, `batt.cell_v_max`, `batt.cell_v_min`, `drv.accel_pedal_pct`.

Response:

```json
{
  "signal": "gps.speed_kph",
  "unit": "km/h",
  "from": "...",
  "to": "...",
  "points": [{ "t": "...", "v": 22.4 }]
}
```

### 6.8 Cells — `GET /vehicles/:id/cells`

On the BluWheelz file fleet:

```json
{
  "vehicleId": "v_ka01as1094",
  "available": false,
  "reason": "Cell voltages are not in the GPS or trip files.",
  "cellVoltagesV": [],
  "cellTempsC": []
}
```

When `available` is `false`, **do not** plot empty arrays as a pack.

---

## 7. Analytics routes

All return JSON. Wrap lists as shown.

### 7.1 Battery — `GET /analytics/battery-health`

```json
{ "updatedAt": "...", "items": [ /* BatteryHealthPoint */ ] }
```

On file fleet, `sohPercent` is `null` and `sohMethod` is `unavailable`. Trip energy / 12 V fields may still be filled. History/forecast arrays can be empty — that is honest, not a bug.

### 7.2 Lifecycle — `GET /analytics/asset-lifecycle`

```json
{ "updatedAt": "...", "items": [ /* AssetLifecycleStage */ ] }
```

`heuristics.thermalStressIndex` may be `null`. Prefer `operatorSummary` / `operatorFindings` / `operatorActions` for operator copy.

### 7.3 Drivers (trip quality) — `GET /analytics/driver-classification`

```json
{ "updatedAt": "...", "items": [ /* DriverClassification */ ] }
```

`driverId` is a vehicle-scoped id. `eventSource` is `derived_speed` on this fleet. There is no driver identity table.

### 7.4 Portfolio — `GET /analytics/portfolio-valuation`

```json
{
  "updatedAt": "...",
  "currency": "INR",
  "disclaimer": "...",
  "assumedLeaseMonths": 36,
  "enterprise": {
    "vehicleCount": 3,
    "totalIndicativeListInr": 0,
    "totalFairMarketValueInr": 0,
    "totalResidualValueInr": 0,
    "avgSohPercent": null,
    "portfolioRiskShare": 0
  },
  "items": []
}
```

Heuristic INR model. When SOH is unobservable, valuation confidence is lowered. Not an invoice or certified appraisal.

---

## 8. Core schemas

Types match `backend/src/types/domain.ts`. Only fields you will always see are listed as required; others may be omitted.

### 8.1 Vehicle

| Field | Type | Notes |
|-------|------|-------|
| `id` | string | Canonical id |
| `registration` | string | Plate |
| `displayName` | string | |
| `model` | string | Tata Ace / Zor Grand / Pro X |
| `telemetryMode` | `gps_only` \| `can_gps` | File fleet is `gps_only` |
| `allowImmobilise` | boolean | UI only |
| `kwhPack` | number | Declared pack size |
| `odometerKm` | number | From trip end odo when known |
| `socPercent` | number | **0 when SOC was never in the file** (Zor Grand) |
| `status` | `active` \| `charging` \| `idle` \| `offline` | Stale files → often `offline` |
| `locationLabel` | string | |
| `position` | `{ lat, lng, lastFixAt }` | Last GPS fix |
| `deviceId` | string \| null | |
| `gps` | object \| omitted | Last speed, ignition, batteries |
| `trip` | object \| omitted | Workbook bookends |
| `track` | `{ lat, lng }[]` | Optional short track |
| `gpsMetrics` | lite object | pathKm, stopCount, tripScore, … |
| `can` | omitted on file fleet | Never invent |
| `sohMethod` | `unavailable` on file fleet | |

**KA01AS1094:** `trip.startSocPct` / `endSocPct` are `null`. Do not average SOC across the fleet without checking `avgSocSampleCount` or per-vehicle nulls.

### 8.2 TripLedgerRow

| Field | Type |
|-------|------|
| `vehicleId`, `registration`, `model`, `operator` | string |
| `startAt`, `endAt` | string \| null |
| `distanceKm`, `durationMin`, `avgSpeedKph` | number \| null |
| `startSocPct`, `endSocPct` | number \| null |
| `startOdoKm`, `endOdoKm` | number \| null |
| `energyUsed`, `efficiency`, `idleMin`, `acIdleMin` | number \| null |
| `score`, `chargingMin`, `startDteKm`, `endDteKm` | number \| null |
| `startLat`, `startLng`, `endLat`, `endLng` | number \| null |
| `fuelType` | string \| null |
| `gpsDistanceKm` | number \| null |
| `distanceDeltaKm` | number \| null |

### 8.3 FleetPolicy

| Field | Type | Range / default role |
|-------|------|----------------------|
| `showMap` | boolean | |
| `showSocStrip` | boolean | |
| `showImmobilise` | boolean | |
| `highlightLowSoc` | boolean | |
| `showAssetStrip` | boolean | |
| `showTripLedger` | boolean | |
| `highlightStaleGps` | boolean | |
| `geofenceBreachAlerts` | boolean | |
| `highlightGpsReportMismatch` | boolean | |
| `gpsUplinkTargetSeconds` | number | 10–600 |
| `stalePositionMinutes` | number | 1–240 |
| `lowSocAlertPercent` | number | 5–80 |
| `deviceBatteryAlertVolts` | number | 2–6 |

`PUT /policy` accepts a **partial** object; omitted keys stay unchanged. Response is the full policy.

### 8.4 GpsDevice

```json
{
  "id": "d_ka01as1071",
  "serial": "BLU-GPS-KA01AS1071",
  "firmware": "file-1",
  "type": "GPS",
  "lastSeenAt": "...",
  "pairedVehicleId": "v_ka01as1071",
  "pointCount": 7315,
  "firstFixAt": "...",
  "lastDeviceBatteryV": 4.05,
  "lastAuxBatteryV": 13.1
}
```

`POST /devices` body: `{ "serial": "optional-string" }` → `201`.  
`POST /devices/:id/unpair` → updated device or `404`.

### 8.5 MaintenanceItem

```json
{
  "id": "m1",
  "vehicleId": "v_ka01as1071",
  "workType": "odometer_audit",
  "title": "GPS path vs trip report km",
  "dueDate": "2026-09-20",
  "odometerAtDueKm": 18400,
  "vendor": null,
  "notes": "Path and report differ by more than 40 km.",
  "status": "open",
  "createdAt": "..."
}
```

Create (`POST /maintenance`): `vehicleId`, `workType`, `title`, `dueDate`, `notes`; optional `odometerAtDueKm`, `vendor`.  
Patch (`PATCH /maintenance/:id`): `{ "status": "open" | "in_progress" | "done" }`.

---

## 9. Policy, devices, profiles, ops

### 9.1 Policy

- `GET /api/v1/policy` → `FleetPolicy`
- `PUT /api/v1/policy` → partial update, returns full policy

### 9.2 Signal profiles — `GET /api/v1/signal-profiles/`

Returns OEM profiles, capability matrix, feasibility, observability sets, canonical dictionary, and `fileCanonicalMap` (workbook/CSV column → signal id). Use this to decide which analytics a platform can honestly support.

### 9.3 Ops (admin token)

| Method | Path | Demo behaviour |
|--------|------|----------------|
| GET | `/ops/ingest-health` | `{ mode: "demo", metrics, vehicles: [] }` |
| POST | `/ops/rollup` | `503 { "error": "demo_mode" }` |
| GET | `/ops/quarantine` | `[]` |

---

## 10. Honesty contract (required for integrators)

1. **`null` is data.** Do not coerce SOC, SOH, DTE, or cell arrays to zero.
2. **No CAN cells on this demo fleet.** If `cells.available === false`, show the `reason`.
3. **No invented SOH %.** `sohMethod === "unavailable"` means do not draw a fade curve from empty history.
4. **Zor Grand (KA01AS1094) has no trip SOC.** Exclude it from SOC averages unless you document the gap.
5. **GPS files end ~14 Sep 2026.** `offline` / stale is expected.
6. **Harsh counts are GPS-derived**, not CAN.
7. **Portfolio INR values are a model**, not a valuation certificate.
8. **Immobilise is not remotely executed.**

---

## 11. Language examples

### 11.1 JavaScript / TypeScript (browser or Node 18+)

```ts
const BASE = "https://e-inter-bluewheelz.onrender.com/api/v1";

async function login(username: string, password: string) {
  const res = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username, password }),
  });
  if (!res.ok) throw new Error(await res.text());
  return res.json() as Promise<{ token: string }>;
}

async function api<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...(init.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`${res.status} ${await res.text()}`);
  return res.json() as Promise<T>;
}

const { token } = await login("bluewheelz", "bluewheelz");
const fleet = await api(token, "/command-center");
const metrics = await api(token, "/vehicles/v_ka01as1071/gps-metrics");
```

### 11.2 Python

```python
import os
import requests

BASE = os.environ.get("EINTER_API", "https://e-inter-bluewheelz.onrender.com/api/v1")

def login(user="bluewheelz", password="bluewheelz"):
    r = requests.post(f"{BASE}/auth/login", json={"username": user, "password": password}, timeout=30)
    r.raise_for_status()
    return r.json()["token"]

def get(token, path):
    r = requests.get(f"{BASE}{path}", headers={"Authorization": f"Bearer {token}"}, timeout=60)
    r.raise_for_status()
    return r.json()

token = login()
print(get(token, "/health") if False else get(token, "/command-center")["fleetTotal"])
print(get(token, "/vehicles/v_ka01as1071/gps-metrics")["pathKm"])
```

### 11.3 Recommended integration flow

1. `GET /health` — confirm `product === "e-inter"`.
2. `POST /auth/login` — store token; refresh by logging in again after 12 h.
3. `GET /vehicles` — cache ids.
4. Fan-out per vehicle: `/gps-metrics`, `/gps-history`, `/trip`, `/can-live` as needed.
5. Pull `/analytics/*` on a slower cadence (they are derived, not live frames).
6. Treat `null` and `available: false` as first-class states in your UI.

---

## 12. Errors and limits

| Situation | What you see |
|-----------|----------------|
| No token | `401 { "error": "unauthorized" }` |
| Bad login | `401 { "error": "invalid_credentials" }` |
| Unknown vehicle | `404 { "error": "not_found" }` |
| Bad body | `400` + Zod flatten or `invalid_body` |
| Live register without OEM | `400 { "error": "oem_platform_required" }` |
| Live history unsupported signal | `400 { "error": "unsupported_signal", "supported": [...] }` |
| Ops without config | `503 { "error": "ops_not_configured" }` |
| Rollup in demo | `503 { "error": "demo_mode" }` |
| Render free tier sleep | First request after idle can take 30–60 s |

There is no published rate limit. Do not poll GPS history faster than every 10–15 s; the file fleet does not change in real time.

Demo store is **in memory** on the API process. A Render restart reloads files from disk; it does not persist vehicles you `POST` unless you run live Postgres.

---

## 13. Security notes for a partner app

- Prefer **server-side** calls if you cannot ship the operator password to a public client.
- Rotate `DASHBOARD_PASSWORD` and `AUTH_SECRET` before any external share.
- Set `ADMIN_API_TOKEN` if you expose `/ops/*`.
- CORS currently reflects any origin. For a locked partner list, change the API (today `ALLOWED_ORIGINS` is not enforced).
- The session token is an HMAC over `{ sub, exp }`. Treat it like a password.

---

## 14. Local run (for integration tests)

```bash
# Terminal 1
cd backend && npm install && npm run dev
# listens on http://127.0.0.1:8787

curl -sS http://127.0.0.1:8787/api/v1/health
```

Needs Node 20+. `Database/` must be present for the three BluWheelz vehicles.

---

## 15. Document set

| File | Use |
|------|-----|
| `docs/e-inter-api.md` | This specification (source) |
| `docs/e-inter-api.pdf` | Printable / email share |
| `FEATURES.md` | Operator-facing product features |
| `README.md` | Clone, run, deploy |

---

*Bosch e-inter · BluWheelz · API 1.1.0*
