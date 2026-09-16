# Kafka Pipeline — Detailed Implementation Plan

**Repo:** `hari8g/e_inter` · branch `feat/intellicar-kafka-ingest`
**Baseline:** the ingestion layer is built and merged (33 files, 48 tests passing, typechecks clean)
**Companion:** `INTELLICAR_KAFKA_EXPOSURE_PACKAGE.md` — everything Intellicar needs from us
**Goal:** 5 pilot vehicles across ≥2 OEM platforms, live CAN telemetry, 14-day soak at SLO

---

## 1. Where we are

### Built and tested

| Layer | Status | Evidence |
|---|---|---|
| Canonical signal vocabulary (40 IDs) | ✅ | `src/signals/canonical.ts` |
| Capability matrix (95 params, 4 platforms) | ✅ | 12 tests in `capabilities.test.ts` |
| Signal profiles (4 JSON files) | ✅ | Cross-validated against the matrix at boot |
| Envelope parsing (batch + realtime) | ✅ | `envelope.test.ts` |
| Quality guards (incl. `-80` sentinel) | ✅ | 15 tests in `guards.test.ts` |
| Profile-driven normalizer | ✅ | 15 tests across all four platforms |
| Kafka consumer (4 rules) | ✅ | 6 tests asserting commit ordering + DLQ |
| Postgres schema (11 tables, partitioned) | ✅ | `migrations/0001`, `0002` |
| Repositories (idempotent + time-guarded upserts) | ✅ | `telemetryRepo.ts` |
| API: `/ops/ingest-health`, `/signal-profiles`, `/can-live`, `/can-history`, `/cells` | ✅ | `routes/` |
| Deployment blueprint (db + worker + api) | ✅ | `render.yaml` |

### Not built

| Gap | Blocks | Phase |
|---|---|---|
| Rollup job (`daily_vehicle_rollup`) | EFC, DoD, thermal minutes, coverage history | 4 |
| SOH service (3 methods + unavailable) | Battery Health page | 4 |
| Driver event extraction | Drivers page | 4 |
| `prognosis.ts` rewiring | Every analytics number is still synthetic | 5 |
| `FleetStore` split (seed vs Postgres) | API still reads the in-memory seed | 5 |
| Frontend `<SignalGate>` + CAN page | Honest empty states | 6 |
| Kafka cluster provisioning | **Everything** | 1 |

**`bmsHealthScore` and `tickCanNoise()` are still in the repo.** The ingest layer writes real telemetry
to Postgres, but the API still serves the seed fleet. Phase 5 is where those two worlds join.

---

## 2. Critical path

```
Phase 0 ── Intellicar contract + security review        (BLOCKING, start today)
   │
Phase 1 ── Provision Kafka cluster + handover           (2 wk, overlaps 0)
   │
Phase 2 ── Staging validation, one vehicle              (1 wk)
   │
Phase 3 ── Onboard pilot fleet, ingest at steady state  (1 wk)
   │
Phase 4 ── Rollups + SOH + driver events                (2.5 wk)
   │
Phase 5 ── FleetStore split + prognosis rewiring        (2 wk)
   │
Phase 6 ── Frontend capability gating                   (2 wk)
   │
Phase 7 ── Soak, parity, runbook, handover              (2 wk)
```

**~12 weeks.** Phase 6 can start midway through Phase 5 against mock payloads. The long pole is not
code — it is the Bosch security review for an internet-reachable Kafka listener, which is why
Phase 0 starts on day one regardless of engineering readiness.

---

## Phase 0 — Contract and approvals (blocking)

### 0.1 Send Intellicar the exposure package

Send `INTELLICAR_KAFKA_EXPOSURE_PACKAGE.md` §7 (the questionnaire). Four answers gate architecture:

| Question | Why it gates |
|---|---|
| Which SASL mechanisms does your producer support? | **Eliminates MSK Serverless** (IAM-only). Decides the cluster flavour. |
| Do you set the message key to `vehicleno`? | Decides whether per-vehicle ordering is free or engineered around. |
| If our brokers are unreachable, how long do you buffer before dropping? | This is our entire maintenance-window budget. |
| Confirm the JSON keys per platform (§3 of the package) | 44 of our 63 mappings are **assumed**. A wrong key = a silently empty chart. |

### 0.2 Confirm the JSON keys — highest-value single task

Our normalizer expects specific snake_case keys. Only 19 are confirmed from Intellicar's published
sample; **44 are inferred from the validation report**. Get `getarbidparammap` output per pilot
vehicle and diff it against the profiles.

```bash
TOKEN=$(curl -s https://apiplatform.intellicar.in/api/standard/gettoken \
  -H 'Content-Type: application/json' -d '{"username":"'"$U"'","password":"'"$P"'"}' | jq -r .data.token)

for V in KA01EV1001 KA01EV1003 KA01EV1004 KA01EV1005; do
  curl -s https://apiplatform.intellicar.in/api/standard/getarbidparammap \
    -H 'Content-Type: application/json' -d '{"token":"'"$TOKEN"'","vehicleno":"'"$V"'"}' \
    | jq -r '.data[].params[]' | sort -u > /tmp/keys_$V.txt
done
```

Then correct each profile's `source` field and flip `keySource` to `"confirmed"`. The worker logs the
remaining assumed keys at boot — that count should reach zero before Phase 3.

### 0.3 Bosch security review

Submit the pack in the exposure package §6: data-flow diagram, DPDP classification, threat model,
ACL design, penetration-test scope. **Book the pentest slot now** — it is usually the scheduling
constraint, not the review itself.

### 0.4 Commercial and legal

- Kafka push activation on the Intellicar account for the pilot vehicles
- DPA covering DPDP 2023: purpose limitation, sub-processors, breach SLA, deletion on termination
- India data residency for primary, backup and DR — contractual, not verbal
- Support SLA and a named 02:00 escalation contact
- Written position on the erasure path (Kafka as a 14-day transient buffer; deletion satisfied in
  Postgres and object storage)

**Exit:** all four questions answered in writing; keys confirmed; security review in flight; DPA drafted.

---

## Phase 1 — Provision the cluster

### 1.1 Choose the flavour

Driven entirely by Intellicar's answer to the SASL question:

| Their answer | Our choice |
|---|---|
| SCRAM-SHA-512 or PLAIN-over-TLS | **Confluent Cloud** (ap-south-1) — cross-org access is its normal case |
| mTLS client certificates | Confluent Cloud (Standard+) or MSK provisioned |
| AWS IAM | Unlikely; would allow MSK Serverless |
| Only plaintext | **Reject.** Escalate — no unauthenticated data plane |

### 1.2 Provision as code

```
infra/
├── cluster.tf        Confluent Cloud Standard, ap-south-1, MULTI_ZONE
├── topics.tf         raw.v1 (6 partitions, 14d), dlq.v1 (3 partitions, 30d)
├── identities.tf     intellicar-producer (write), bosch-normalizer (read)
├── acls.tf           topic-scoped only; no cluster Describe
└── quotas.tf         producer_byte_rate 5 MB/s
```

Topic settings that matter:

```properties
replication.factor  = 3
min.insync.replicas = 2
retention.ms        = 1209600000   # 14 days — THE REPLAY WINDOW
max.message.bytes   = 1048576
cleanup.policy      = delete
```

Retention is the feature. Fourteen days means a normalizer bug found on Friday is fixed and the
whole week reprocessed by resetting an offset. Set it deliberately; the 7-day default is a floor.

### 1.3 Negative-test the ACLs before handover

```bash
# The producer credential MUST NOT be able to read
kcat -b $BOOTSTRAP -F intellicar.properties -C -t intellicar.telemetry.raw.v1 -o beginning -e
#   expected: TOPIC_AUTHORIZATION_FAILED

# It MUST NOT be able to enumerate other topics
kcat -b $BOOTSTRAP -F intellicar.properties -L
#   expected: only intellicar.telemetry.raw.v1
```

An over-broad ACL on an internet-facing broker is the failure mode that matters, and it is invisible
unless you test for it. **Do not skip this.**

### 1.4 Deploy the Bosch side

```bash
render blueprint launch        # database + e-inter-api + e-inter-ingest
npm run migrate                # schema + signal profiles
npm run seed:pilot             # register pilot vehicleno aliases
```

Two deployment facts: the worker must not run on a plan that sleeps (a sleeping consumer accrues lag,
and lag beyond retention is permanent loss), and the API leaves the free plan at the same time.

**Exit:** cluster live, ACLs negative-tested, worker connected with zero lag, handover sent.

---

## Phase 2 — Staging validation, one vehicle

Ask Intellicar to point **one** staging vehicle at the topic. Do not onboard the fleet yet.

### 2.1 Validate the payload contract

```bash
kcat -b $BOOTSTRAP -F bosch.properties -C -t intellicar.telemetry.raw.v1 -o -20 -e \
  -f 'p%p o%o key=%k\n%s\n---\n' | tee /tmp/real_payload.json
```

Check, in order:

1. **Message key** — is it `vehicleno`? If empty, messages round-robin and ordering is lost.
2. **Envelope shape** — `{bulkData:[...]}` or a bare record? Both parse; confirm which.
3. **Timestamps** — 13-digit epoch ms? A 10-digit value is rejected by our schema.
4. **Key names** — diff against the profiles. This is the real test of Phase 0.2.
5. **Sentinels** — does `cell_temperature_05` show `-80` when `no_of_temperature_sensors` is 4?
6. **Sparseness** — are absent parameters omitted, or sent as `null`/`0`/`0xFFFF`?

Turn the captured payload into a golden vector:

```bash
cp /tmp/real_payload.json backend/test/golden/tata_ace_ev/real-2026-xx-xx.json
npm test    # locks the contract into CI
```

### 2.2 Verify the pipeline

```sql
-- Sentinel handling: temps truncated to the real sensor count
SELECT cardinality(cell_t) AS temps, cell_temp_min_c, cell_delta_mv
  FROM telemetry_can ORDER BY captured_at DESC LIMIT 1;
--   expect: temps = no_of_temperature_sensors, cell_temp_min_c well above -80

-- Sparseness: a platform without cells must show NULL, not zero
SELECT oem_platform, count(*) FILTER (WHERE cell_v IS NULL) AS no_cells
  FROM telemetry_can c JOIN vehicle v ON v.id = c.vehicle_id GROUP BY 1;

-- Rejects: a step change here means a key or scale is wrong
SELECT signal, reason, count FROM ingest_reject ORDER BY count DESC LIMIT 20;

-- Quarantine must be empty
SELECT * FROM ingest_quarantine;
```

### 2.3 Chaos tests

| Test | Expected |
|---|---|
| `kill -9` the worker mid-batch | Zero records lost; offsets replay; upsert absorbs duplicates |
| Produce a malformed message | Lands in DLQ; partition continues; alarm fires |
| Produce an unknown `vehicleno` | Quarantined; **no vehicle auto-created** |
| Stop the worker 2 h, restart | Lag drains; no gap in `telemetry_can` |
| Reset offsets to `--to-earliest` | Identical derived output (idempotence proof) |

**Exit:** real payloads normalized correctly; golden vector in CI; all five chaos tests pass;
assumed-key count is zero.

---

## Phase 3 — Onboard the pilot fleet

1. Register all pilot vehicles: edit `scripts/seedPilotFleet.ts`, run `npm run seed:pilot`.
   **`vehicleno` must match exactly** what Intellicar sends (case and spacing are normalized).
2. Intellicar switches the remaining vehicles to the topic.
3. Watch `/api/v1/ops/ingest-health` for 48 hours.

### 3.1 Wire the alarms

| Condition | Severity | Means |
|---|---|---|
| **Zero messages fleet-wide for 5 min** | Critical | Producer down — the single most important monitor |
| Consumer lag > 10 000 rising 10 min | Critical | Consumer stuck or under-provisioned |
| DLQ depth > 0 for 15 min | Critical | Payload change or normalizer bug |
| `ingest.unknown_vehicle` > 0 | Critical | Mis-provisioning or cross-tenant leak |
| Single vehicle silent 24 h | Warning | Device or vehicle out of service |
| Reject rate > 1 % in 15 min | Critical | Key, scale or enum mapping wrong |
| Fleet coverage < 80 % for 1 h | Critical | Integration failure, not fleet behaviour |

Lag behaves diagnostically: rising **with** messages arriving means our consumer; flat at zero
**without** messages means their producer. One metric separates the two.

**Exit:** all pilot vehicles reporting; coverage ≥ 95 %; alarms firing correctly in a drill.

---

## Phase 4 — Derivation services

Now that real frames are landing, build the analytics that consume them.

### 4.1 Rollup job — `src/jobs/rollup.ts`

Per vehicle per day, from `telemetry_can` / `telemetry_gps` / `driver_event`:

| Field | Derivation |
|---|---|
| `distance_km` | Odometer delta, guarded against resets |
| `moving_minutes` | Frames with `speed_kph > 3` |
| `frames_received` / `frames_expected` | Coverage from `expected_uplink_sec` |
| `soc_band_minutes` | JSONB histogram — the input to depth-of-discharge |
| `efc_accrued` | `Σ\|ΔSOC\| / 200` — a genuine cycle count, all platforms |
| `cell_delta_mv_p95`, `thermal_minutes_over_45c` | **Tata only**, else `NULL` |
| `harsh_brake_count` / `harsh_accel_count` | From `driver_event` |

**Reprocess a 7-day trailing window each run**, not just yesterday. Devices in dead zones buffer and
dump, so late arrivals must update already-computed buckets. Mark buckets `provisional` until the
window closes.

### 4.2 SOH service — `src/services/soh.ts`

| Platform | Method | Approach |
|---|---|---|
| **Eicher** | `coulomb_counted` | Rest points (`\|I\| < 2 A` for ≥20 min), `C_est = ∫I dt / (ΔSOC/100)`. Accept only when `\|ΔSOC\| ≥ 30 %`. Rolling median of last 10; IQR as CI. Expect one estimate every few days — expose `lastEstimateAt`. |
| **Tata Ace EV** | `ocv_incremental` | No current channel, so capacity is not observable. Return a 0–100 **pack-condition index** from Δcell p95, per-cell rested-OCV drift and monthly OCV↔SOC shift. Label it an index, not a capacity %. |
| **Zeo, Switch** | `unavailable` | `sohPercent: null`. Do not infer. Do not dress EFC up as health. |

### 4.3 Driver events — `src/services/driverEvents.ts`

- **Tata**: read `drv.harsh_*` from `telemetry_can.raw`, emit rows with `source: "can_measured"`,
  weight by `mean`/`peak` rather than a bare count, handle counter rollover.
- **Switch, Eicher, Zeo (once speed validates)**: differentiate `veh.speed_kph`, threshold
  `|a| > 3.0 m/s²` sustained ≥1 s, `source: "derived_speed"`.
  **Guard: require ≥1 Hz sampling.** If the median inter-frame gap exceeds 2 s, return
  `eventSource: "unavailable"` rather than fabricating events from 10-second samples.
- **No platform provides driver identity.** Score the vehicle, not the person, and say so.

**Exit:** rollups reproducible by replaying Kafka from offset 0; a Switch fixture returns
`sohPercent: null`; 10-second-spaced speed produces zero derived events.

---

## Phase 5 — Join the two worlds

The riskiest phase: the API stops serving the seed and starts serving Postgres.

### 5.1 Split `FleetStore` (three commits)

1. Extract `fleetStore.interface.ts` from the current class surface; read methods return promises.
2. Rename the existing class to `SeedFleetStore`. **Delete `tickCanNoise()` and its `setInterval`.**
3. Implement `PgFleetStore` over the repositories.

```ts
export const fleetStore: FleetStore =
  process.env.DEMO_MODE === "1" ? new SeedFleetStore() : new PgFleetStore();
```

Route handlers gain `await`. No response shape changes — the SPA keeps working.

### 5.2 Rewire `prognosis.ts`

**Goal: `grep -rn "Math.random\|seedHash\|bmsHealthScore" backend/src/services/` returns nothing.**

| Replace | With |
|---|---|
| `sohPercent` (`bmsHealthScore / 5`) | `estimateSoh()` |
| `imbalanceMv` (`charCodeAt`) | Measured `cell_delta_mv_p95`; `null` where unavailable |
| `cycleEstimate` (`400 + odo/40`) | `efc_accrued` |
| SOH history / forecast (`seedHash` + smoothstep) | `battery_soh_daily` + regression |
| Fade attribution | Measured stressors only; **hide the bar** when unmeasured |
| `bmsObservationQuality0to100` | Data coverage `frames_received / frames_expected` |
| `thermalStressIndex` | `thermal_minutes_over_45c`; `null` elsewhere |
| `calendarAgeMonths` (`odo/440`) | `commissioned_on` → today |
| `projectedMajorServiceKm` (`odo + 3500`) | OEM service schedule per platform |
| `enrichDrivers(seeds)` | `driver_event` rows |

Gate `buildLifecycleOperatorReadout` on `observability`. It currently emits *"CAN + GPS uplink
present: thermal and electrical stress views are grounded in live gateway data."* A Switch vehicle
has no cell data and must never say that.

**Exit:** grep clean; demo mode still renders the seed; a Switch fixture produces no thermal claim.

---

## Phase 6 — Frontend

| Component | Change |
|---|---|
| `<SignalGate>` | Three states: available → children; pending → amber badge; unavailable → muted panel |
| `CanTelemetry.tsx` (new) | Live signal table by domain, 29-cell bar + 6-temp strip for Tata, explicit "not exposed" section, `joinGapSeconds` freshness banner |
| `BatteryHealth.tsx` | Three card variants by `sohMethod`; `unavailable` shows SOC/DTE/cycles + the honest message |
| `AssetLifecycle.tsx` | Wear curve from rollups; findings gated on capability |
| `Drivers.tsx` | `eventSource` badge; vehicle-not-person scoping explicit |
| `AddVehicle.tsx` | OEM platform select; capability preview; `nominalCapacityAh` required for Eicher |
| `PortfolioValuation.tsx` | Confidence band from observability; wider band where SOH is unobservable |

**Acceptance test for the whole project:** load every page with a **Switch** vehicle selected. No
fabricated number appears anywhere. Every value is measured or explicitly labelled unavailable.

---

## Phase 7 — Soak and handover

14 consecutive days at SLO:

| SLO | Target |
|---|---|
| Ingest availability | 99.9 % |
| Freshness p95 (capture → queryable) | < 60 s |
| Completeness vs Intellicar dashboard | ≥ 99.5 % |
| Odometer / SOC parity | within 1 % |
| Consumer lag p95 | < 1 000 |
| DLQ depth | 0 sustained |

Runbook entries to write: consumer lag alarm, DLQ non-empty, unknown vehicleno, credential rotation,
schema change detected, replay procedure, broker maintenance window.

---

## Risk register

| Risk | Impact | Mitigation |
|---|---|---|
| Security rejects internet-exposed brokers | Approach blocked | Phase 0 pack early; PrivateLink and VPN fallback designs ready |
| MSK Serverless chosen before confirming SASL | Cluster rebuilt, weeks lost | Q1 answered **before** provisioning |
| 44 assumed JSON keys wrong | Silently empty charts | Phase 0.2 diff; worker logs assumed keys at boot |
| Intellicar doesn't key by `vehicleno` | No per-vehicle ordering | Time-guarded upserts tolerate it; ask anyway |
| Retention expires before a bug is noticed | Unrecoverable window | 14-day retention + S3 sink connector from day one |
| Phase 5 destabilises the demo mid-sales-cycle | Commercial exposure | `DEMO_MODE=1` preserved; three-commit split; parallel run |
| Speed sampling below 1 Hz | Derived harsh events not credible on 3 of 4 platforms | Guard returns `unavailable`; confirm cadence in Phase 0 |
| KafkaJS lacks static membership | Rebalance on every restart | Tolerable at pilot scale; revisit at many consumer instances |
| Worker on a sleeping plan | Lag past retention = permanent loss | `plan: starter` in `render.yaml`; lag alarm |

---

## Definition of done

- [ ] All 95 parameters mapped with `keySource: "confirmed"`
- [ ] Golden vectors from real payloads in CI for every pilot platform
- [ ] Five chaos tests passing
- [ ] `grep -rn "Math.random\|seedHash\|bmsHealthScore" backend/src/` → no results
- [ ] `tickCanNoise` deleted
- [ ] Switch vehicle renders `sohPercent: null` with the unavailable message on every page
- [ ] 14 days at SLO with parity within 1 %
- [ ] Runbook signed off; on-call rotation live
- [ ] `DEMO_MODE=1` still renders the seed fleet for sales
