# Kafka CAN Ingestion — What Was Built

Implemented against `hari8g/e_inter` @ `main`. **Typechecks clean, 48 tests passing, builds to `dist/`.**

Two artefacts:
- `e_inter_kafka_ingest.patch` — `git am` onto your branch
- `e_inter_kafka_ingest.tar.gz` — the raw files if you prefer to copy them in

```bash
git checkout -b feat/intellicar-kafka-ingest
git am < e_inter_kafka_ingest.patch
cd backend && npm install && npm run build && npm test
```

---

## What runs

```
Intellicar ──produces──▶ intellicar.telemetry.raw.v1
                                   │
                          worker.ts (Render worker service)
                                   │
        parse ─ resolve vehicle ─ apply profile ─ guards ─ derive ─ persist (1 txn)
                                   │
                telemetry_gps · telemetry_can · vehicle_state_current · ingest_reject
                                   │
                          e-inter API ──▶ /can-live, /can-history, /cells, /ops/ingest-health
```

## Files added (33)

**Signal layer** — the report encoded as data
| File | What |
|---|---|
| `src/signals/canonical.ts` | 40 canonical signal IDs, units, labels, domains |
| `src/signals/capabilities.ts` | Capability matrix + `analyticFeasibility()` per platform |
| `src/signals/profileRegistry.ts` | Loads/validates profiles; **cross-checks against the matrix and throws at boot on mismatch** |
| `src/signals/profiles/*.json` | 4 profiles: Zeo 13, Tata 58, Switch 10, Eicher 14 = 95 params |

**Ingest** — `src/ingest/`
| File | What |
|---|---|
| `config.ts` | Env → config, fails fast at boot |
| `envelope.ts` | Batch + realtime shapes; `vehicleno` normalization |
| `guards.ts` | Range, monotonicity, rate, **array truncation**, Δcell, timestamp clamping |
| `normalizer.ts` | Profile-driven OEM keys → canonical signals |
| `vehicleResolver.ts` | `vehicleno` → `vehicle_id`, cached, quarantine on miss |
| `consumer.ts` | Batch loop, manual offsets, DLQ routing |
| `dlq.ts`, `metrics.ts`, `worker.ts` | Dead-letter producer, counters, entry point |
| `README.md` | Local Redpanda quick-start + ops runbook |

**Persistence** — `src/db/`
`client.ts`, `migrate.ts`, `migrations/0001_init.sql` (11 tables), `migrations/0002_partitions.sql`
(13 monthly partitions + DEFAULT + BRIN), `repositories/telemetryRepo.ts`, `repositories/vehicleRepo.ts`

**API** — `routes/ops.ts`, `routes/signalProfiles.ts`, `routes/canTelemetry.ts`
**Scripts** — `scripts/seedPilotFleet.ts`, `scripts/produceSample.ts`, `scripts/copyAssets.mjs`
**Tests** — 48 across `guards`, `normalizer`, `capabilities`, `consumer`

**Modified:** `app.ts` (CORS tightened, new routers), `package.json` (kafkajs, pg, vitest + 7 scripts),
`render.yaml` (database + worker service, off free plans).

---

## Five decisions worth reviewing

**1. The consumer's four rules are enforced by tests, not comments.**
`autoCommit: false`; offsets resolve only after the transaction commits; poison messages go to the
DLQ without blocking the partition; `heartbeat()` between messages. `test/consumer.test.ts` asserts
the ordering explicitly — every one of these is silent in production when broken.

**2. GPS and CAN are separate tables.**
Intellicar states the sources are sampled independently. `telemetryRepo.latestJoined()` does a
bounded nearest-neighbour join and returns `joinGapSeconds`, so the UI can tell a 55-second-old pin
from a fresh one instead of implying they were simultaneous.

**3. `telemetry_can.raw` keeps the whole payload.**
CAN is sparse and dynamic. Promoted columns are all nullable; the full JSON is retained so a
parameter Intellicar adds next month is captured from day one and can be back-promoted by replaying
Kafka rather than lost.

**4. Unknown `vehicleno` is quarantined, never auto-created.**
It goes to `ingest_quarantine` + the DLQ and raises a counter. Auto-creation is how another
customer's vehicle silently joins your fleet.

**5. `vehicle_state_current` upsert is time-guarded.**
`WHERE captured_at < EXCLUDED.captured_at`. Devices in dead zones buffer and dump, so an old frame
can land after a new one. Without the guard the command centre jumps backwards in time.

---

## A correction to my earlier documents

I wrote that averaging the six temperature values with the `-80` sentinels gives −13 °C. **That was
wrong** — the test caught it. The real figures for a pack at 38 °C with 4 real sensors:

| Aggregate | Naive (6 values) | Correct (truncated to 4) |
|---|---|---|
| Mean | **−1.33 °C** | 38 °C |
| Minimum | **−80 °C** | 38 °C |

The minimum is the dangerous one — it would fire a false thermal alarm. `truncateArray` slices to
`countKey` before range-filtering, and `test/guards.test.ts` asserts both figures.

---

## Verify locally

```bash
docker run -d --name redpanda -p 9092:9092 redpandadata/redpanda:latest \
  redpanda start --overprovisioned --smp 1 --check=false
createdb e_inter

export DATABASE_URL=postgres://localhost:5432/e_inter
export KAFKA_BOOTSTRAP=localhost:9092 KAFKA_SSL=false KAFKA_SASL_MECHANISM=

npm run migrate:dev && npm run seed:pilot && npm run ingest:dev
npm run produce:sample     # another shell
```

`produce:sample` sends 6 messages deliberately including the `-80` sentinels, an unknown
`vehicleno`, and a malformed record. Expected: 4 vehicles normalized, 1 quarantined, 1 in the DLQ,
partition still moving.

```sql
SELECT vehicle_id, cardinality(cell_t) AS temps, cell_temp_min_c, cell_delta_mv
  FROM telemetry_can ORDER BY captured_at DESC LIMIT 1;
-- temps = 4, cell_temp_min_c = 34.5 (NOT -80), cell_delta_mv ≈ 48
```

---

## What is NOT built

Deliberately scoped out — the schema and repositories are ready for all of it:

- **Rollup job** (`daily_vehicle_rollup`): EFC accrual, SOC-band histograms, thermal minutes, coverage
- **SOH service**: coulomb-counted (Eicher), OCV index (Tata), `unavailable` (Zeo/Switch)
- **Driver events**: measured harsh channels (Tata), derived from speed elsewhere
- **`prognosis.ts` rewiring**: still `seedHash()`. `bmsHealthScore` and `tickCanNoise()` still present
- **`FleetStore` split**: still the in-memory singleton; `DEMO_MODE` helper exists but isn't wired
- **All frontend work**: `<SignalGate>`, CAN telemetry page, capability-gated pages

Tasks 11–19 of the Cursor plan cover these and are unchanged by this implementation.

---

## Two things to do before the pilot

**Confirm the JSON keys.** Signals marked `"keySource": "assumed"` were inferred from the validation
report, not confirmed against `getarbidparammap`. The worker logs them at boot. If a key is wrong,
that signal silently reads `unavailable` — the failure is quiet, which is exactly why it needs
checking first. Pull the map per pilot vehicle and diff it against the profiles.

**Ask Intellicar to key messages by `vehicleno`.** Without a key, messages round-robin across
partitions and per-vehicle ordering is lost. The design tolerates it — the primary key is
`(vehicle_id, captured_at)` and the state upsert is time-guarded — but ordering is free if they set it.

One limitation to note: KafkaJS 2.x has no static group membership, so every worker restart triggers
a rebalance. Fine at pilot scale (seconds, and reprocessing is idempotent); worth revisiting if you
scale to many consumer instances.
