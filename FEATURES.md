# e-inter feature documentation

This document describes **what is implemented in the code today** for the Bosch e-inter × BluWheelz dashboard. It is the product reference for operators, reviewers, and deployers.

**Repository:** [github.com/hari8g/e_inter_bluewheelz](https://github.com/hari8g/e_inter_bluewheelz)

To expose these features to another app, use the HTTP contract in **[docs/e-inter-api.md](docs/e-inter-api.md)** (PDF: [docs/e-inter-api.pdf](docs/e-inter-api.pdf)).

**Stack:** React 18 + Vite 6 + Tailwind + Leaflet + Recharts (`frontend/`) and Express 4 + TypeScript (`backend/`).

---

## 1. What the product is

e-inter is an intermediate electric-fleet operations console. For this BluWheelz demo it is a **GPS + trip-report** command centre:

- Three BluWheelz vehicles from Intellicar GPS CSVs and a trip workbook
- Operator login
- Map, playback, stops, idle, daily utilisation, and a trip ledger
- Battery, lifecycle, driver, and portfolio pages that stay honest when CAN / SOH is missing
- An optional **live** path: Kafka CAN ingest into Postgres (not used by the file demo)

The login screen is branded **Bosch** + **BluWheelz**. The signed-in shell is labelled e-inter / electric fleet operations.

---

## 2. Sign-in

The entire dashboard except `/login` is gated.

| Item | Value |
|------|--------|
| Default username | `bluewheelz` |
| Default password | `bluewheelz` |
| Env overrides | `DASHBOARD_USERNAME`, `DASHBOARD_PASSWORD`, `AUTH_SECRET` |
| Session | HMAC-signed token in `sessionStorage` (`e-inter.session`), 12-hour TTL |
| Public API | `POST /api/v1/auth/login`, `GET /api/v1/health` |
| Protected API | All other `/api/v1/*` routes require `Authorization: Bearer <token>` |

`GET /api/v1/auth/me` validates the token on page load. A 401 on any protected call signs the operator out.

Ops/admin routes under `/api/v1/ops/*` use `X-Admin-Token` (`ADMIN_API_TOKEN`), not the dashboard session.

---

## 3. Demo fleet (file ingest)

When `Database/` (or `FLEET_DATA_DIR`) is present, demo mode **replaces** the old synthetic Bengaluru 2W seed with the BluWheelz files.

| Registration | Canonical ID | Model | Pack (declared) | Telemetry | OEM profile |
|--------------|--------------|-------|-----------------|-----------|-------------|
| KA01AS1071 | `v_ka01as1071` | Tata Ace | 21.3 kWh | `gps_only` | `tata_ace_ev` |
| KA01AS1094 | `v_ka01as1094` | Zor Grand | 10.2 kWh | `gps_only` | — |
| KA01AS7048 | `v_ka01as7048` | Pro X | 8.8 kWh | `gps_only` | — |

**Source files**

| File | Role |
|------|------|
| `Database/KA01AS1071_GPS.csv` | Intellicar GPS trace |
| `Database/KA01AS1094_GPS .csv` | Intellicar GPS trace (filename has a space) |
| `Database/KA01AS7048_GPS.csv` | Intellicar GPS trace |
| `Database/Bluwheelz report.xlsx` | Trip report (start/end, km, SOC bookends when present) |

Loaders: `backend/src/ingest/fileFleet.ts`, `gpsCsv.ts`, `xlsxWorkbook.ts`. At build time `scripts/copyAssets.mjs` copies `Database/` into `backend/data/vehicles` and `backend/dist/data/vehicles`.

If those files are missing, the API falls back to ten synthetic Bengaluru plates `KA01DM1001`–`KA01DM1010` (`backend/src/seed/bengaluruFleet.ts`). That fallback is **not** the BluWheelz demo.

---

## 4. Honesty rules (what we never invent)

These are enforced in ingest, stores, and tests (`backend/test/fileFleet.test.ts`).

1. **No fabricated CAN cell voltages or temperatures.** File-fleet vehicles have no `can` snapshot. `GET /vehicles/:id/cells` returns `available: false` with a reason.
2. **No invented SOH %.** File fleet uses `sohMethod: "unavailable"`. Battery charts gate empty CAN/SOH domains instead of drawing fake fade curves.
3. **KA01AS1094 (Zor Grand) SOC stays null.** The workbook has no start/end fuel (SOC) for that vehicle. Command-centre average SOC excludes it. The UI says SOC is not in the trip report.
4. **Ace SOC bookends are real.** KA01AS1071 start/end SOC from the workbook is shown and aliased to `batt.soc_pct` only when present.
5. **All three BluWheelz vehicles are `gps_only`.** CAN domains on Telemetry are collapsed with “not in these files”.
6. **Harsh accel/brake is a coarse GPS derivative** (~30 s samples, 2.5 m/s²), not a CAN harsh channel.
7. **GPS files end around 14 Sep 2026.** Stale / offline badges on the command centre are intentional.
8. **Immobilise** is a UI control only. There is no immobilise API.
9. **Live Kafka mode has an empty trip ledger.** Workbook trips exist only in file-demo mode.

---

## 5. Operator screens

All screens below sit behind login, inside `AppShell` (desktop sidebar + mobile bottom nav).

### 5.1 Login (`/login`)

Bosch and BluWheelz logos, operator credentials, error text if the API is unreachable or credentials are wrong.

### 5.2 Command centre (`/`)

Primary operations view. Polls command-centre + trips about every 15 seconds.

**KPIs**

- Fleet size
- Last GPS-day kilometres (sum of latest daily path km)
- Average trip-end SOC (only vehicles that have SOC)
- Range pool (DTE sum) — unavailable for this file fleet

**Also on this page**

- Policy strip (current visibility / thresholds)
- Stale-GPS callout
- OpenStreetMap fleet map (see Fleet map)
- Asset strip: per-vehicle GPS stats, SOC bar or “unavailable”, immobilise (UI only), link to Telemetry
- Daily utilisation bar chart for the selected vehicle
- Stop timeline
- Full trip ledger from the workbook + GPS path km

### 5.3 Fleet map (Command centre and Telemetry)

Leaflet / OSM. Implemented in `frontend/src/components/FleetMap.tsx`.

- Marker colour by model
- Start / end pins
- Optional **geofence** disks when policy `geofenceBreachAlerts` is on (Hosur Rd, Whitefield, Peenya, South depot)
- **Stop clusters** (≥ 5 minutes, ~80 m)
- **Playback** slider along the GPS polyline
- Stale highlighting vs `policy.stalePositionMinutes`

### 5.4 Telemetry (`/can-telemetry`, `/can-telemetry/:id`)

GPS / trip workspace, not a CAN lab for this fleet.

- Vehicle selector
- Platform, freshness, profile cards
- Full trip-report field grid (workbook columns)
- Map + playback
- Speed, ignition, and 12 V / device-battery sparklines
- Daily GPS path-km chart
- Stop table
- Cell pack panel **or** an explicit unavailable reason
- Canonical signal groups: GPS trace and trip report first; CAN groups collapsed

### 5.5 Battery health (`/battery-health`)

Per-vehicle SOH history, forecast, fade attribution (calendar / cyclic / Δcell / thermal), imbalance, fleet charts.

On the BluWheelz file fleet, SOH and cell fade are **gated**. What remains observable is trip energy / 12 V context, not a invented SOH %.

### 5.6 Asset lifecycle (`/asset-lifecycle`)

Stage badges (ramp / steady / watch / retire candidate), odometer-forward wear, RUL-style fields, operator readout.

Thermal / cell heuristics stay null when those signals are missing. Duty and odometer come from GPS + trip.

### 5.7 Drivers (`/drivers`)

Labelled as **vehicle trip quality**, not named drivers. Radar (safety, smoothness, eco, compliance, alertness), safety trajectory, trip score and idle ratio from GPS harsh events + workbook fields.

### 5.8 Analytics hub (`/analytics`)

Summary tiles (indicative FMV, GPS km, average trip score) and links into battery, lifecycle, drivers, portfolio, and a fifth GPS utilisation tile.

### 5.9 Portfolio value (`/portfolio-value`)

NBFC / lessor snapshot: indicative list, FMV, and residual in INR. When SOH is unobservable the model uses a utilisation proxy and a conservative discount. It does **not** invent SOH to price the pack.

### 5.10 GPS devices (`/gps-devices`)

List file-ingested units (`BLU-GPS-{plate}`), register a new serial, unpair. Point count and battery span come from the CSVs. Copy states that pairing is inventory, not a live uplink.

### 5.11 Maintenance (`/maintenance`)

Work list with status `open` / `in_progress` / `done`. File ingest seeds items (service window, odometer vs report mismatch). New items can be added; odometer prefills from trip end when known.

### 5.12 Policy & visibility (`/policy`)

Immediate `PUT` on toggle. Controls:

| Toggle / field | Effect |
|----------------|--------|
| Show map | Command-centre map |
| Show asset strip | Vehicle strip |
| Show SOC strip | SOC bars when SOC exists |
| Show trip ledger | Ledger table |
| Show immobilise | Immobilise buttons (UI only) |
| Highlight low SOC | Threshold `lowSocAlertPercent` |
| Highlight stale GPS | Threshold `stalePositionMinutes` |
| Highlight GPS vs report mismatch | Path km vs workbook km |
| Geofence breach alerts | Map disks + metric hits |
| GPS uplink target (seconds) | Policy label |
| Device battery alert (volts) | Device-battery flag |

### 5.13 Add vehicle (`/add-vehicle`)

Register a vehicle: `gps_only` or `can_gps`, OEM platform (required in live mode), seed lat/lng, pack kWh, odometer, SOC. A banner explains that the current demo fleet is file-backed.

---

## 6. GPS and trip metrics

Derived in `backend/src/ingest/gpsDerived.ts`. Exposed on `GET /api/v1/vehicles/:id/gps-metrics` and embedded on the command centre.

| Metric | How it is computed |
|--------|--------------------|
| Path distance | Haversine sum of GPS points |
| Report vs path delta | Workbook km minus path km; large gaps can seed maintenance |
| Idle minutes | Ignition off or speed &lt; 3 km/h, sample gap 5–180 s |
| Stops | Dwell ≥ 5 min within ~80 m |
| Daily distance | Per calendar day: km, ignition-on %, max speed, harsh total |
| Moving % | Ignition on and speed ≥ 3 km/h |
| Harsh accel / brake | Δspeed / Δt, threshold 2.5 m/s² |
| Geofence hits | Count of samples inside the four Bengaluru depot disks |
| Device / aux battery flags | Device &lt; 3.9 V, aux &lt; 12.2 V |
| Playback | Frontend walks `gps-history` points |

Trip rows (`GET /trips`, `GET /vehicles/:id/trip`) merge workbook fields with `gpsDistanceKm`.

---

## 7. HTTP API (`/api/v1`)

Unless noted, routes require a dashboard Bearer token.

### Auth

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| POST | `/auth/login` | Public | Username / password → token |
| GET | `/auth/me` | Session | Current operator |

### Fleet and policy

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/health` | Liveness: `product`, `mode` (`demo` \| `live`), `database` |
| GET | `/command-center` | Fleet KPIs, vehicles, policy |
| GET / PUT | `/policy` | Visibility and thresholds |
| GET / POST | `/vehicles` | List / register |
| GET / POST | `/devices` | List / register GPS units |
| POST | `/devices/:id/unpair` | Unpair |
| GET / POST | `/maintenance` | List / create |
| PATCH | `/maintenance/:id` | Status |
| GET | `/trips` | Trip ledger (file demo only) |

### Per-vehicle telemetry

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/vehicles/:id/can-live` | Canonical signal grid |
| GET | `/vehicles/:id/can-history` | Time series (demo: GPS signals; live: CAN columns) |
| GET | `/vehicles/:id/cells` | Cell snapshot or honest `available: false` |
| GET | `/vehicles/:id/gps-history` | Downsampled track (`max`, `from`, `to`) |
| GET | `/vehicles/:id/gps-metrics` | Idle, stops, harsh, batteries, geofences |
| GET | `/vehicles/:id/daily-distance` | Daily km series |
| GET | `/vehicles/:id/trip` | One trip ledger row |

### Analytics

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/analytics/battery-health` | Battery points + heuristics |
| GET | `/analytics/asset-lifecycle` | Lifecycle stages |
| GET | `/analytics/driver-classification` | Trip-quality scores |
| GET | `/analytics/portfolio-valuation` | FMV / residual |

### Profiles and ops

| Method | Path | Auth | Purpose |
|--------|------|------|---------|
| GET | `/signal-profiles/` | Session | OEM profiles, capability matrix, file column map |
| GET | `/ops/ingest-health` | Admin token | Kafka / DB ingest health |
| POST | `/ops/rollup` | Admin token | Run a 7-day rollup |
| GET | `/ops/quarantine` | Admin token | Quarantined unknown vehicle numbers |

---

## 8. Demo mode vs live Kafka mode

| | Demo (file / seed) | Live |
|--|-------------------|------|
| Switch | `DEMO_MODE=1` **or** no `DATABASE_URL` | `DATABASE_URL` set and `DEMO_MODE` not `1` |
| Store | `SeedFleetStore` | `PgFleetStore` |
| Fleet | BluWheelz files if present, else 10 seed 2Ws | Postgres vehicles + Kafka telemetry |
| Trips | Workbook ledger | Empty |
| SOH / cells | Unavailable unless a seed `can_gps` vehicle exists | Platform-specific (`soh.ts`); unknown plates quarantined |
| Boot | No migrate | `migrate()`; `BOOTSTRAP_PILOT=1` registers `KA01EV1001`–`1005` |

Live ingest worker (`npm run ingest`): Kafka topic `intellicar.telemetry.raw.v1` → normalize → Postgres. Unknown `vehicleno` values go to quarantine / DLQ; they are **not** auto-created.

---

## 9. Deployment

### Combined Render URL (recommended for this demo)

Render web service, root `backend/`:

1. Build compiles the API **and** the Vite UI into `backend/dist/public`.
2. Express serves the SPA for non-`/api` GET routes.
3. Login is same-origin: `https://e-inter-bluewheelz.onrender.com`.

Health check: `GET /api/v1/health`.

### Vercel SPA + Render API

- Vercel root directory: `frontend`
- Framework: Vite, output `dist`
- `frontend/vercel.json` rewrites `/api/*` to `https://e-inter-bluewheelz.onrender.com/api/*`
- On `*.vercel.app` the client **must** call same-origin `/api` (do **not** set `VITE_API_ORIGIN` on Vercel). A baked Render URL is cross-origin and will fail if CORS is locked.

Do not point the UI at `https://e-inter-api.onrender.com`. That host is an older API **without** `/auth/login`.

### Local

```bash
cd backend && npm install && npm run dev   # :8787
cd frontend && npm install && npm run dev  # :5173, proxies /api → 8787
```

Open `http://localhost:5173`, sign in with `bluewheelz` / `bluewheelz`.

Node 20 is pinned for Render (`.nvmrc`, `engines`).

---

## 10. Environment variables

### Backend

| Variable | Default / notes |
|----------|-----------------|
| `DEMO_MODE` | `1` or unset `DATABASE_URL` → file/seed store |
| `DATABASE_URL` | Postgres; presence without `DEMO_MODE=1` → live store |
| `BOOTSTRAP_PILOT` | `1` registers KA01EV1001–1005 on live boot |
| `FLEET_DATA_DIR` | Override path to GPS CSVs + xlsx |
| `PORT` | `8787` locally; Render injects `PORT` |
| `DASHBOARD_USERNAME` / `DASHBOARD_PASSWORD` | `bluewheelz` / `bluewheelz` |
| `AUTH_SECRET` | HMAC secret for sessions |
| `ADMIN_API_TOKEN` | `/api/v1/ops/*` |
| `GPS_CAN_JOIN_WINDOW_SEC` | Default `60` (live join) |
| `KAFKA_*` | Ingest worker (see `backend/.env.example`) |
| `FRONTEND_DIST` | Override SPA static directory |
| `SKIP_FRONTEND_BUILD` | `1` on the ingest worker so it does not build the UI |
| `ALLOWED_ORIGINS` | Documented but **not enforced**; CORS reflects any Origin |

### Frontend

| Variable | Notes |
|----------|--------|
| `VITE_API_ORIGIN` | Leave unset for local Vite and for Vercel. Same-origin `/api` is required on `*.vercel.app` and on the combined Render host. |

---

## 11. Feature map (quick index)

| Area | Implemented |
|------|-------------|
| Operator login + session | Yes |
| Bosch / BluWheelz login branding | Yes |
| File ingest of 3 GPS CSVs + trip xlsx | Yes |
| Canonical IDs `v_ka01as1071` / `1094` / `7048` | Yes |
| Command-centre KPIs, asset strip, trip ledger | Yes |
| OSM map, start/end, playback, stops, geofences | Yes |
| GPS metrics API (idle, daily km, harsh, batteries) | Yes |
| Telemetry as GPS/trip workspace | Yes |
| Battery / lifecycle / drivers / portfolio honesty pass | Yes |
| Policy toggles including GPS/stale/geofence | Yes |
| GPS devices + maintenance + add vehicle | Yes |
| Kafka + Postgres live path | Yes (optional; not the BluWheelz file demo) |
| Immobilise command to the vehicle | No (UI only) |
| Invented CAN cells / SOH % on file fleet | No (explicitly refused) |

---

## 12. Related files

| Topic | Path |
|-------|------|
| HTTP app + CORS + SPA | `backend/src/app.ts` |
| File fleet | `backend/src/ingest/fileFleet.ts` |
| GPS math | `backend/src/ingest/gpsDerived.ts` |
| Auth | `backend/src/auth/session.ts`, `frontend/src/auth/` |
| API client | `frontend/src/api/client.ts` |
| Routes | `frontend/src/App.tsx` |
| Render blueprint | `render.yaml` |
| Vercel rewrites | `frontend/vercel.json` |
| Honesty tests | `backend/test/fileFleet.test.ts`, `backend/test/auth.test.ts` |
