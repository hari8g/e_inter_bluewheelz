# e-inter

**Repository:** [github.com/hari8g/e_inter](https://github.com/hari8g/e_inter)

**e-inter** is an intermediate electric-fleet SaaS demo: everything you would expect from a lightweight **GPS telematics** command centre (in the spirit of **e-lite**), plus **CAN-aware** signals, **battery health** analytics with deterioration attribution, **asset lifecycle** planning (odometer, major-service dates, heuristics), **driver classification**, and **maintenance** hooks.

The repo is split into **`frontend/`** (React + Vite + Tailwind + Recharts + Leaflet) and **`backend/`** (Express + TypeScript, in-memory demo fleet).

## Features

| Area | Notes |
|------|--------|
| **Command centre** | KPIs, policy strip, OSM map, live asset strip; CAN extras when the vehicle is `can_gps`. |
| **Register vehicle** | GPS-only vs **CAN + GPS** telematics mode. |
| **GPS / gateway devices** | Register units, pair/unpair semantics on the server. |
| **Maintenance** | Work list + predictive-style work types. |
| **Fleet policy** | Visibility toggles and thresholds; `PUT` applies immediately. |
| **Battery health** | SOH history/forecast, imbalance risk, **fade attribution** (calendar / cyclic / Δcell / thermal), heuristic indices, fleet charts. |
| **Asset lifecycle** | Odometer-forward cards, **next major service date**, wear curve, RUL-style fields, heuristic flags. |
| **Driver classification** | Radar + safety trajectory (demo drivers). |
| **Portfolio value** | NBFC / dry-lease snapshot: indicative list, FMV, and residual in INR. |

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

Default is **demo mode** (in-memory Bengaluru seed, plates `KA01DM1001`–`1010`).

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

Repo: [hari8g/e_inter](https://github.com/hari8g/e_inter). The **backend** is a long-lived Node **Web Service** on [Render](https://render.com). The **frontend** is a static/Vite SPA on [Vercel](https://vercel.com). The browser talks to Render using **`VITE_API_ORIGIN`**.

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

1. [Vercel Dashboard](https://vercel.com/dashboard) → **Add New…** → **Project** → import `hari8g/e_inter`.
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
| `GET` | `/health` | Liveness / product id. |
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
