# Intellicar → e-inter CAN ingestion

Kafka consumer that turns Intellicar's OEM-specific CAN/GPS payloads into canonical,
quality-tagged telemetry in Postgres.

```
Intellicar Cloud ──produces──▶ intellicar.telemetry.raw.v1 ──▶ worker.ts
                                                                  │
                             parse envelope ─ resolve vehicle ─ apply profile
                             ─ quality guards ─ derive ─ persist (one transaction)
                                                                  │
                                                                  ▼
                                    telemetry_gps · telemetry_can · vehicle_state_current
```

## Quick start (local, Redpanda)

```bash
docker run -d --name redpanda -p 9092:9092 redpandadata/redpanda:latest \
  redpanda start --overprovisioned --smp 1 --check=false

export DATABASE_URL=postgres://localhost:5432/e_inter
export KAFKA_BOOTSTRAP=localhost:9092
export KAFKA_SSL=false
export KAFKA_SASL_MECHANISM=

npm run migrate:dev      # schema + signal profiles
npm run seed:pilot       # register pilot vehicles and their vehicleno aliases
npm run ingest:dev       # start the consumer
npm run produce:sample   # in another shell — sends 6 test messages
```

Expected result: 4 vehicles normalized, `KA99XX0000` quarantined (not auto-created),
the malformed message in the DLQ, and the partition still moving.

## Four rules the consumer encodes

1. **`autoCommit: false`.** Auto-commit acknowledges messages that may not be
   persisted; a crash between commit and write is silent, permanent loss.
2. **Commit after persist.** At-least-once delivery + idempotent upsert on
   `(vehicle_id, captured_at)` = effectively-once.
3. **Poison messages go to the DLQ**, never block the partition.
4. **Heartbeat inside the batch loop**, or the broker evicts the consumer mid-work.

`test/consumer.test.ts` asserts all four. They are silent in production when broken.

## Design decisions worth knowing

**GPS and CAN are separate tables.** Intellicar states the two sources are sampled at
different rates with independent timestamps. Merging them into one row would fabricate
co-temporality. Read them back with the nearest-neighbour join in `telemetryRepo.latestJoined`,
which returns `joinGapSeconds` so the UI can distinguish a 55-second-old pin from a fresh one.

**CAN is sparse.** An absent key means *not received*, never zero. Every CAN column is
nullable and `telemetry_can.raw` keeps the complete payload, so a parameter Intellicar adds
next month can be back-promoted by replaying Kafka.

**Absence is a value.** A signal a platform does not expose is reported `unavailable`,
never inferred. Only Tata Ace EV has cell-level data; only Eicher has pack current.

**Unknown `vehicleno` is quarantined, never auto-created.** Auto-creation is how another
customer's vehicle silently joins your fleet and how a typo becomes a phantom asset.

## The sentinel trap

Intellicar's sample payload contains:

```json
"no_of_temperature_sensors": 4,
"cell_temperature_01": 38, ... "cell_temperature_04": 38,
"cell_temperature_05": -80, "cell_temperature_06": -80
```

Sensors 5 and 6 do not exist. `-80` is a sentinel. Aggregate all six and a pack sitting at
38 °C reads as **−1.3 °C** on a mean and **−80 °C** on a minimum — a false thermal alarm.

`guards.truncateArray` slices to `countKey` *before* range-filtering. Never aggregate an
untruncated array.

## Files

| File | Role |
|---|---|
| `config.ts` | Env → `IngestConfig`, fails fast at boot |
| `envelope.ts` | Batch + realtime payload shapes; `vehicleno` normalization |
| `guards.ts` | Range, monotonicity, rate, array truncation, Δcell, timestamps |
| `normalizer.ts` | Profile-driven OEM keys → canonical signals |
| `vehicleResolver.ts` | `vehicleno` → `vehicle_id`, cached, quarantine on miss |
| `consumer.ts` | Batch loop, offsets, DLQ routing |
| `dlq.ts` | Dead-letter producer with failure headers |
| `metrics.ts` | Counters/gauges for `/api/v1/ops/ingest-health` |
| `worker.ts` | Entry point, graceful shutdown |

## Operations

```bash
# Health, coverage, rejects, quarantine
curl -H "X-Admin-Token: $ADMIN_API_TOKEN" localhost:8787/api/v1/ops/ingest-health | jq

# Capability matrix + signal dictionary
curl localhost:8787/api/v1/signal-profiles | jq '.feasibility'

# Live CAN state for a vehicle
curl localhost:8787/api/v1/vehicles/v_ka01ev1001/can-live | jq

# Replay the last 24h after fixing a normalizer bug (consumer stopped first)
kafka-consumer-groups --bootstrap-server $KAFKA_BOOTSTRAP \
  --group e-inter-normalizer-v1 --topic intellicar.telemetry.raw.v1 \
  --reset-offsets --to-datetime 2026-09-07T00:00:00.000 --execute
```

Replay is always safe: the upserts are idempotent.

## Known limitations

- **KafkaJS 2.x has no static group membership**, so every worker restart triggers a
  rebalance. Tolerable at pilot scale; consider `confluent-kafka-javascript` if you run
  many consumer instances.
- **Signal JSON keys are partly assumed.** Keys marked `"keySource": "assumed"` in the
  profiles were inferred from the validation report, not confirmed against Intellicar's
  `getarbidparammap`. The worker logs a warning at boot listing them. Confirm before the
  pilot: if a key is wrong, that signal silently reads `unavailable`.
- **Rollups, SOH estimation and driver-event extraction are not implemented here.** The
  schema and repositories are in place; the derivation services are the next phase.
