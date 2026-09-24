# e-inter

**Repository:** [github.com/hari8g/e_inter_bluewheelz](https://github.com/hari8g/e_inter_bluewheelz)

**e-inter** is the Bosch intermediate electric-fleet console, configured here as a **BluWheelz GPS + trip** demo: operator login, three file-ingested vehicles, command-centre map/playback/stops, and honesty-gated battery / lifecycle / driver / portfolio pages.

The repo is split into **`frontend/`** (React + Vite + Tailwind + Recharts + Leaflet) and **`backend/`** (Express + TypeScript). Full feature list: **[FEATURES.md](FEATURES.md)**. Partner / second-app HTTP contract: **[docs/e-inter-api.md](docs/e-inter-api.md)** and **[docs/e-inter-api.pdf](docs/e-inter-api.pdf)**.

## Features (summary)

| Area | Notes |
|------|--------|
| **Login** | Entire dashboard gated. Default `bluewheelz` / `bluewheelz`. Bosch + BluWheelz logos. |
| **File fleet** | `Database/` GPS CSVs + trip xlsx → KA01AS1071 (Ace), KA01AS1094 (Zor Grand), KA01AS7048 (Pro X). |
| **Command centre** | KPIs, OSM map, playback, stops, geofences, asset strip, daily km, trip ledger. |
| **Telemetry** | GPS/trip workspace; CAN/cells gated when not in the files. |
| **Honesty** | No invented CAN cell voltages or SOH %. Zor Grand SOC stays null. |
| **Ops pages** | GPS devices, maintenance, policy, add vehicle. |
| **Analytics** | Battery, lifecycle, trip quality (Drivers), portfolio FMV — null where unobservable. |
| **Live path** | Optional Kafka + Postgres ingest (not the BluWheelz file demo). |

## Requirements

- **Node.js** 20+ (LTS recommended)
- **npm** 9+

## Quick start

Run **backend** and **frontend** in two terminals from the repo root.

### Backend (API on port `8787`)

```bash
cd backend
npm install
npm run dev
```

Default is **demo mode**. If `Database/` is present, the API loads the three BluWheelz GPS traces and trip workbook. Sign in at the UI with **`bluewheelz` / `bluewheelz`**.

### Live Intellicar path

Bosch operates the Kafka cluster; Intellicar **produces** into `intellicar.telemetry.raw.v1`. This repo consumes, normalizes, and serves the SPA.

```bash
# 1. Local brokers + Postgres
docker compose up -d

# 2. Backend live
cd backend
cp .env.example .env   # then edit
# DEMO_MODE=0
# BOOTSTRAP_PILOT=1
# DATABASE_URL=postgres://einter:einter@localhost:5432/e_inter
# KAFKA_BOOTSTRAP=localhost:9092
# KAFKA_SSL=false
# KAFKA_SASL_MECHANISM=
# ADMIN_API_TOKEN=change-me
# ALLOWED_ORIGINS=http://localhost:5173
npm run migrate:dev && npm run seed:pilot
npm run dev            # API — migrates on boot when DEMO_MODE≠1
npm run ingest:dev     # worker — another terminal
npm run produce:sample # optional local fixture
```

Point Intellicar at your real brokers (Confluent Cloud / MSK). Fill `KAFKA_*` from the exposure package. Set `ALLOWED_ORIGINS` to the Vercel host before production CORS will allow the SPA.

On Render, apply `render.yaml` (API + ingest worker + Postgres). Set Kafka secrets and `ALLOWED_ORIGINS`. `BOOTSTRAP_PILOT=1` registers `KA01EV1001`–`1005` on API boot.

### Frontend (Vite on port `5173`, proxies `/api` → backend)

```bash
cd frontend
npm install
npm run dev
```

Open **http://localhost:5173** in the browser.

### Production builds

```bash
cd backend && npm run build && npm start
cd frontend && npm run build && npm run preview
```

For production you normally set **`VITE_API_ORIGIN`** on the frontend host to your API’s public URL (see below). In development the Vite proxy sends `/api` to `localhost:8787`.

## Deployment: **Render** (API) + **Vercel** (SPA)

Repo: [hari8g/e_inter_bluewheelz](https://github.com/hari8g/e_inter_bluewheelz). The **backend** is a long-lived Node **Web Service** on [Render](https://render.com) (it can also serve the built SPA). The **frontend** can be a static Vite app on [Vercel](https://vercel.com); on Vercel leave **`VITE_API_ORIGIN` unset** so `/api` is rewritten to Render.

### In-memory API note

Fleet state is **in memory**. On Render, the process stays up while the instance runs; free tiers may **sleep** after idle time (cold wake). Production fleets should use a **database** behind the same API.

### 1) Backend on Render

**Option A — Blueprint (recommended)**  
Root file **`render.yaml`** defines a Web Service `e-inter-api` with `rootDir: backend`.

1. [Render Dashboard](https://dashboard.render.com) → **New** → **Blueprint** → connect this GitHub repo.
2. Apply the blueprint. Render runs **`npm ci && npm run build`** then **`npm start`** inside `backend/`.
3. When the deploy is live, copy the service URL, e.g. `https://e-inter-api.onrender.com`.

**Option B — Manual Web Service**  
1. **New** → **Web Service** → connect the repo.  
2. **Root Directory:** `backend`.  
3. **Build Command:** `npm ci && npm run build`  
4. **Start Command:** `npm start`  
5. **Health check path:** `/api/v1/health`  
6. Instance type: **Free** is fine for demos (expect cold starts).

Render injects **`PORT`** and **`RENDER=true`**. `npm start` runs **`node dist/runLocal.js`**, which listens on `PORT`.

### 2) Frontend on Vercel

1. [Vercel Dashboard](https://vercel.com/dashboard) → **Add New…** → **Project** → import `hari8g/e_inter_bluewheelz`.
2. **Root Directory:** `frontend`.
3. **Framework Preset:** Vite (or **Other** with **Build Command** `npm run build` and **Output Directory** `dist`).
4. **Environment variables** → add:

   | Name | Value | Environments |
   |------|--------|----------------|
   | `VITE_API_ORIGIN` | `https://<your-render-service>.onrender.com` | Production (and Preview if previews should hit a preview API) |

   Use the **exact** Render URL: **`https://`**, host only, **no** trailing slash, **no** `/api/v1` in the value.

5. **Redeploy** the frontend after changing env vars so Vite embeds them at build time.

**Local dev:** leave **`VITE_API_ORIGIN`** unset; run **`npm run dev`** in **`backend/`** (port **8787**) and **`frontend/`**; Vite proxies `/api` per `frontend/vite.config.ts`.

### 3) CORS

The API uses **`cors({ origin: true })`**, so requests from your **`*.vercel.app`** (or custom) frontend origin are reflected and allowed for this demo.

## API overview

Base path: **`/api/v1`**

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/auth/login` | Operator session (public). |
| `GET` | `/health` | Liveness / product id (public). |
| `GET` | `/command-center` | Aggregated fleet + vehicles + policy. |
| `GET`/`PUT` | `/policy` | Read/update fleet policy. |
| `GET`/`POST` | `/vehicles` | List / register vehicles. |
| `GET`/`POST` | `/devices` | List / register devices; `POST /devices/:id/unpair`. |
| `GET`/`POST`/`PATCH` | `/maintenance` | List, create, update status. |
| `GET` | `/analytics/battery-health` | Battery points + history/forecast/heuristics. |
| `GET` | `/analytics/asset-lifecycle` | Lifecycle stages + heuristics. |
| `GET` | `/analytics/driver-classification` | Driver scores. |
| `GET` | `/analytics/portfolio-valuation` | FMV, residual, and enterprise roll-up for NBFC / lessor views. |

## Project layout

```
e-inter/
├── backend/           # Express API, seed data, prognosis enrichment
│   ├── src/
│   └── package.json
├── frontend/          # React SPA (deploy root = frontend/ on Vercel)
│   ├── src/
│   ├── vercel.json    # SPA fallback → index.html
│   └── package.json
├── render.yaml        # Optional Render Blueprint (Web Service → backend/)
└── README.md
```

## Tech stack

- **Frontend:** React 18, TypeScript, Vite 6, Tailwind CSS, React Router, Leaflet / react-leaflet, Recharts, Lucide icons.
- **Backend:** Express 4, TypeScript, Zod (validation), in-memory store with periodic CAN noise for demos.

## License

Demo / educational use unless you attach your own license.

---

## Publishing to GitHub

After creating an empty repository on GitHub (for example `e-inter`), run:

```bash
cd /path/to/e-inter
git init
git add .
git commit -m "Initial commit: e-inter fleet SaaS (frontend + backend)"
git branch -M main
git remote add origin https://github.com/<YOUR_USER>/e-inter.git
git push -u origin main
```

If you use SSH:

```bash
git remote add origin git@github.com:<YOUR_USER>/e-inter.git
git push -u origin main
```

With the [GitHub CLI](https://cli.github.com/) (`gh`), from the repo root:

```bash
gh repo create e-inter --public --source=. --remote=origin --push
```
