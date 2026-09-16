# Intellicar ↔ Bosch MPS — Kafka Integration Exposure Package

**Purpose:** everything Bosch MPS exposes to Intellicar so their platform can produce telemetry into
our Kafka cluster, plus everything we need back from them.
**Direction:** Intellicar is the **producer**. Bosch operates the cluster and consumes.
**Status:** template — fill the `<PLACEHOLDER>` fields, then send §1–§5 and §7 to Intellicar.

> **Read this first.** Intellicar's documentation specifies the client supplies *"Kafka client
> endpoints, topic name, authentication."* Their sample hostnames are `clientkafka-node-1.example.com:9094`.
> **The client is us.** We stand up the brokers, expose them, and issue a write-only credential.
> This is not consuming from Intellicar's Kafka.

---

## 1. What we expose — the three fields Intellicar asks for

### 1.1 Kafka client endpoints

```
<BOOTSTRAP_1>:<PORT>
<BOOTSTRAP_2>:<PORT>
<BOOTSTRAP_3>:<PORT>
```

Port depends on the platform — send what we actually provisioned, not the sample from their docs:

| Platform | Port | Notes |
|---|---|---|
| Confluent Cloud | `9092` | Single bootstrap hostname, TLS always on |
| Amazon MSK — SASL/SCRAM | `9096` | |
| Amazon MSK — TLS/mTLS | `9094` | Matches their sample |
| Self-managed | `9094` | External SASL_SSL listener by convention |

### 1.2 Topic

| | |
|---|---|
| **Topic name** | `intellicar.telemetry.raw.v1` |
| Partitions | 6 |
| Replication factor | 3 (`min.insync.replicas = 2`) |
| Retention | 14 days |
| Max message size | 1 MB (`max.message.bytes = 1048576`) |
| Cleanup policy | `delete` |
| Auto-create | **Disabled.** Producing to any other topic will fail. |

Intellicar's sample uses `vehicle-data`. If their tooling assumes that name, say so in §7 Q9 and we
will provision an alias topic — but the versioned name is preferred, because a `.v2` topic is how we
introduce a breaking payload change later without a flag-day cutover.

### 1.3 Authentication

```
Security protocol : SASL_SSL
SASL mechanism    : SCRAM-SHA-512
Username          : intellicar-producer
Password          : <DELIVERED SEPARATELY — see §1.4>
TLS               : server certificate from a public CA; no custom truststore required
Minimum TLS       : 1.2
```

**Plaintext listeners are disabled.** There is no unauthenticated path to these brokers.

### 1.4 Credential delivery

The password is **never** sent in the same channel as the endpoints. Use one of:

- Bosch secure file transfer, recipient-restricted
- PGP-encrypted email to a named Intellicar engineer (we supply the public key)
- A one-time secret link expiring in 24 hours

Rotation: every 90 days. We operate a **dual-credential window** — the new secret is activated, we
confirm traffic on the new principal, then the old one is retired. Expect ~10 days' notice.

---

## 2. Permissions granted — and deliberately withheld

The `intellicar-producer` principal is scoped to one topic with write access only.

| Resource | Operation | Granted |
|---|---|---|
| Topic `intellicar.telemetry.raw.v1` | `WRITE` | ✅ |
| Topic `intellicar.telemetry.raw.v1` | `DESCRIBE` | ✅ (metadata for partition discovery) |
| Topic `intellicar.telemetry.raw.v1` | `READ` | ❌ |
| Any other topic | any | ❌ |
| Cluster | `DESCRIBE` / `CREATE` / `ALTER` | ❌ |
| Consumer groups | any | ❌ |

Two consequences worth stating plainly, because they surprise people:

1. **The producer cannot read back what it wrote.** Delivery is confirmed by broker acknowledgement
   (`acks=all`), not by consuming. If verification-by-read is part of Intellicar's normal workflow,
   raise it in §7 Q10 — we can provision a separate read credential on a dedicated test topic, but not
   on the production one.
2. **The producer cannot list topics.** A `--list` will show only the one topic.

We negative-test both before handover. If either succeeds, our ACLs are wrong and we fix them before
anyone connects.

### 2.1 Quota

```
producer_byte_rate = 5242880    # 5 MB/s for the intellicar-producer principal
```

Roughly 50× expected pilot volume. It is a ceiling against a runaway producer filling our disks, not
a throttle you should ever hit. If you expect to exceed it, tell us in §7 Q8 and we will raise it.

---

## 3. Payload contract

This is what our normalizer parses. **Deviations cause silent data loss**, so please confirm each
table rather than assuming.

### 3.1 Envelope

Both shapes are accepted.

**Batch** (preferred — one message may carry many records, for many vehicles):

```json
{
  "bulkData": [
    { "vehicleno": "KA01EV1001", "type": "gps",
      "data": { "time": 1757320800000, "lat": 12.9716, "lng": 77.5946, "speed": 34, "ignstatus": 1 } },
    { "vehicleno": "KA01EV1001", "type": "can",
      "data": { "time": 1757320803000, "soc": 67, "odometer": 12400, "no_of_cells": 29 } }
  ]
}
```

**Realtime** (bare record, no wrapper):

```json
{ "vehicleno": "KA01EV1001", "type": "can", "data": { "time": 1757320803000, "soc": 67 } }
```

| Field | Rule |
|---|---|
| `vehicleno` | Registration number. **The only join key.** Normalized our side: uppercased, spaces/hyphens stripped, so `KA 01 EV 1001` and `ka-01-ev-1001` both resolve. |
| `type` | `"gps"` or `"can"` exactly. Any other value is rejected. |
| `data.time` | **Epoch milliseconds, 13 digits, UTC.** A 10-digit (seconds) value is rejected at the schema boundary. |
| GPS `lat` / `lng` | Required on GPS records. Decimal degrees. |
| CAN `data` | Everything except `time` is optional and profile-driven. Unknown keys are retained verbatim. |

### 3.2 Sparseness — please confirm

We have built on the assumption from Intellicar's documentation that *"we will send all parameters we
receive and exclude any parameters we don't receive."*

**An absent key means "not received". We never treat it as zero.**

Confirm there are no sentinel values for absent scalars — no `0`, `null`, `-1`, `0xFFFF`, `65535`.
A sentinel silently averaged into an aggregate is the most damaging failure mode in this integration.

**Known exception we already handle:** `cell_temperature_05` and `_06` carry `-80` when
`no_of_temperature_sensors` is 4. We truncate arrays by their count key before any aggregation. Please
confirm `-80` is the standard absent-sensor marker, and tell us if equivalents exist elsewhere.

### 3.3 Expected JSON keys — **the most important table in this document**

Our normalizer looks for these exact keys. **44 of 63 are inferred from the 03-Sep validation report,
not confirmed.** A wrong key means that signal reads as "unavailable" with no error anywhere — a
silent failure. Please correct anything wrong, or confirm as-is.

#### Mahindra Zeo (13 parameters)

| Report parameter | Key we expect | Confirmed? |
|---|---|---|
| Odometer | `odometer` | ❓ |
| SOC | `soc` | ✅ |
| DTE | `dte` | ❓ |
| Parking Brake | `parking_brake` | ❓ |
| Indicators | `indicators` | ❓ **and: bitfield or enum? which bit is left/right?** |
| Headlight | `headlight` | ❓ **and: low beam only, or combined?** |
| Acceleration | `acceleration` | ❓ |
| Brake Pedal | `brake_pedal` | ✅ |
| Eco Mode | `eco_mode` | ❓ |
| Power Mode | `power_mode` | ❓ |
| Gear State | `gear_state` | ❓ **and: enum values?** |
| Charging Parameters *(pending)* | `charging_status` | ❓ |
| Vehicle Speed *(pending)* | `vehicle_speed` | ❓ |

#### Tata Ace EV (58 parameters)

| Report parameter | Key we expect | Confirmed? |
|---|---|---|
| Cell Voltage 01–29 | `cell_voltage_01` … `cell_voltage_29` | ✅ |
| Cell Temperature 01–06 | `cell_temperature_01` … `cell_temperature_06` | ✅ |
| *(count keys)* | `no_of_cells`, `no_of_temperature_sensors` | ✅ |
| Maximum Cell Voltage | `max_cell_voltage` | ❓ |
| Minimum Cell Voltage | `min_cell_voltage` | ❓ |
| Maximum Cell Temperature | `max_cell_temperature` | ❓ |
| Minimum Cell Temperature | `min_cell_temperature` | ❓ |
| Vehicle Speed | `vehicle_speed` | ❓ |
| Gear State | `gear_state` | ❓ |
| SOC | `soc` | ✅ |
| DTE | `dte` | ❓ |
| Brake Pedal | `brake_pedal` | ✅ |
| Acceleration Pedal Position | `acceleration_pedal_position` | ✅ |
| Odometer | `odometer` | ✅ |
| Head Light - Low Beam | `head_light_low_beam` | ❓ |
| Head Light - High Beam | `head_light_high_beam` | ❓ |
| Charging Status | `charging_status` | ❓ **enum values?** |
| TTC | `ttc` | ❓ **unit: minutes?** |
| Harsh Braking | `harsh_braking` | ❓ **cumulative or per-window?** |
| Harsh Braking Interval | `harsh_braking_interval` | ❓ |
| Harsh Braking Mean | `harsh_braking_mean` | ❓ **unit: m/s²?** |
| Harsh Braking Peak | `harsh_braking_peak` | ❓ |
| Harsh Acceleration | `harsh_acceleration` | ❓ |
| Harsh Acceleration Interval | `harsh_acceleration_interval` | ❓ |
| Harsh Acceleration Mean | `harsh_acceleration_mean` | ❓ |
| Harsh Acceleration Peak | `harsh_acceleration_peak` | ❓ |

#### Switch (10 parameters)

| Report parameter | Key we expect | Confirmed? |
|---|---|---|
| SOC | `soc` | ✅ |
| DTE | `dte` | ❓ |
| Odometer | `odometer` | ❓ |
| Vehicle Speed | `vehicle_speed` | ❓ |
| Charging Status | `charging_status` | ❓ |
| Gear | `gear` | ❓ |
| Acceleration Pedal | `acceleration_pedal` | ❓ |
| Brake Pedal | `brake_pedal` | ✅ |
| Handbrake | `handbrake` | ❓ |
| Trip A | `trip_a` | ❓ **resettable? rollover value?** |

#### Eicher (14 parameters)

| Report parameter | Key we expect | Confirmed? |
|---|---|---|
| SOC | `soc` | ✅ |
| DTE | `dte` | ❓ |
| Odometer | `odometer` | ❓ |
| Trip | `trip` | ❓ |
| Vehicle Speed | `vehicle_speed` | ❓ |
| Brake Pedal | `brake_pedal` | ✅ |
| Current | `current` | ✅ **sign convention: is positive discharge?** |
| HV Volt | `battery_voltage` | ✅ **pack total?** |
| HV Volt 01 | `hv_volt_01` | ❓ **how does this differ from HV Volt?** |
| Accel Pedal 1 - Low Idle Switch | `accel_pedal_1_low_idle_switch` | ❓ |
| Accel Pedal 2 - Low Idle Switch | `accel_pedal_2_low_idle_switch` | ❓ |
| Accel Pedal Kick Down Switch | `accel_pedal_kick_down_switch` | ❓ |
| Road Speed Limit Status | `road_speed_limit_status` | ❓ **enum values?** |
| Acceleration Pedal | `acceleration_pedal` | ❓ |

> If it is easier, send us `getarbidparammap` output for each pilot vehicle and we will reconcile it
> ourselves. That is our preferred route — a machine-readable map beats a table either of us typed.

### 3.4 Units

We expect engineering units as delivered, not raw counts. Confirm:

| Signal | Expected unit |
|---|---|
| Odometer, DTE, Trip | km |
| Vehicle speed | km/h |
| SOC | % (0–100) |
| Cell voltage | V (e.g. `3.612`) |
| Cell temperature | °C |
| Pack voltage | V |
| Current | A, signed |
| Accelerator pedal | % (0–100) |
| TTC | minutes |
| Harsh mean/peak | m/s² |

If any arrive as raw counts needing a scale/offset, tell us the factors and we will apply them in the
signal profile.

---

## 4. Producer configuration we request

| Setting | Requested | Why |
|---|---|---|
| **`key`** | **`vehicleno`** | **Most important.** Keying by registration puts each vehicle on one partition, preserving per-vehicle ordering. Without a key, messages round-robin and ordering is lost. We tolerate it — our primary key is `(vehicle_id, captured_at)` and the state write is time-guarded — but ordering is free if you set it. |
| `acks` | `all` | With `min.insync.replicas=2`, a write is durable before acknowledgement |
| `enable.idempotence` | `true` | Prevents duplicates from producer-side retries |
| `compression.type` | `zstd` or `snappy` | ~4× reduction on this payload |
| `max.request.size` | ≤ 1 048 576 | Matches our `max.message.bytes` |
| `linger.ms` | 100–1000 | Batching efficiency; harmless at our freshness target |
| `retries` | high, with backoff | Survives a broker rolling restart |
| Push mode | **Batch, 30 s** | Cuts request volume by ~10× vs realtime; 30 s staleness is invisible on a fleet dashboard |

### 4.1 Buffering during Bosch maintenance

We will need occasional broker maintenance windows. **How long does your producer buffer when brokers
are unreachable before dropping data?** That figure is our entire maintenance budget, and we will
schedule inside it. Please answer in §7 Q3.

---

## 5. Network exposure

### 5.1 What we open

| Direction | Source | Destination | Port | Protocol |
|---|---|---|---|---|
| Inbound | Intellicar egress CIDRs **only** | Bosch broker endpoints | `<PORT>` | TCP / TLS 1.2+ |

Controls in force simultaneously:

1. **TLS 1.2+ encryption** — no plaintext listener exists
2. **SASL/SCRAM-SHA-512 authentication** — no anonymous access
3. **Topic-scoped ACLs** — write-only, one topic (§2)
4. **IP allowlist** — only your declared egress ranges reach the port
5. **Per-principal quota** — 5 MB/s ceiling

A stolen credential used from an unlisted IP still fails. That is the point of running four controls
rather than one.

### 5.2 What we need from you

**Your egress IP ranges, in CIDR notation, in writing** — plus the notice period if they change.
Traffic from any other address is dropped at the network layer before it reaches a broker.

```
Intellicar egress CIDRs: <TO BE SUPPLIED BY INTELLICAR>
Notice period for changes: <TO BE SUPPLIED>
```

### 5.3 Preferred alternative — private connectivity

If Intellicar runs on AWS in `ap-south-1`, **AWS PrivateLink is our preferred end state**: no public
endpoint, no IP management, no internet path. Confluent Cloud and MSK both support it. This removes
an entire category of security review on our side and is worth the setup cost if the relationship is
long-term. Please indicate feasibility in §7 Q6.

---

## 6. Bosch-side security review pack

Internal; listed here so both sides understand what gates the timeline.

- Data-flow diagram: Intellicar producer → broker listener → topic → consumer → Postgres
- Classification: GPS + driver behaviour = **personal data under DPDP Act 2023**
- Residency: all storage, compute, backups and DR inside India
- Threat model:

| Threat | Control |
|---|---|
| Credential theft | Secret manager, 90-day rotation, dual-credential window |
| Unauthorised topic read | Write-only ACL; negative-tested before handover |
| Topic enumeration | No cluster `DESCRIBE` |
| Volumetric abuse | Per-principal quota |
| Spoofed producer | SASL_SSL + IP allowlist |
| Data at rest | Customer-managed KMS key, not the cloud default |
| Data in transit | TLS 1.2+; plaintext listeners disabled |

- **Erasure position (DPDP):** Kafka is a 14-day transient buffer, append-only. Per-subject deletion
  is satisfied in Postgres and object storage, not in Kafka. This must be agreed in writing before
  go-live — it is far harder to argue retrospectively.
- Penetration test against the broker endpoint before production vehicles onboard.

---

## 7. Questions for Intellicar

Please answer in writing. Q1–Q4 gate our architecture.

**Authentication and connectivity**

1. Which SASL mechanisms does your Kafka producer support: `SCRAM-SHA-512`, `SCRAM-SHA-256`,
   `PLAIN` over TLS, `OAUTHBEARER`, or mTLS client certificates?
   *(This eliminates or confirms cluster options on our side — we cannot provision until we know.)*
2. Can your producer validate a server certificate from a public CA, or do you need a custom
   truststore?
3. **If our brokers are unreachable, how long does your producer buffer before dropping data?**
4. **Do you set the Kafka message key? If so, to what — `vehicleno`?**

**Payload**

5. Confirm or correct the JSON keys in §3.3 — or send `getarbidparammap` output per pilot vehicle.
6. Confirm §3.2: absent parameters are omitted entirely, with no sentinel values for scalars.
   Is `-80` the standard absent-sensor marker for temperatures? Are there equivalents elsewhere?
7. Confirm the units in §3.4, and supply scale/offset factors for anything sent as raw counts.
8. Enum values for `charging_status`, `gear_state` / `gear`, `road_speed_limit_status`, and the bit
   layout for Zeo `indicators`.
9. Are `harsh_braking` / `harsh_acceleration` cumulative lifetime counters or per-window counts?
   What window do `interval` / `mean` / `peak` describe?
10. On Eicher, how does `HV Volt 01` differ from `HV Volt`? Is `Current` positive on discharge?
11. Expected message rate and average message size per vehicle, per platform.
12. Uplink cadence per signal class — specifically, **is `Vehicle Speed` sampled at 1 Hz or slower?**
    *(This determines whether we can derive harsh-event scoring on platforms without the dedicated
    harsh channels.)*

**Operational**

13. Your egress IP CIDRs, and the notice period if they change.
14. Is AWS PrivateLink / VPC peering available as an alternative to a public endpoint (§5.3)?
15. Does your tooling require the topic to be named `vehicle-data`, or can it use
    `intellicar.telemetry.raw.v1`?
16. Do your workflows require read-back from the topic to confirm delivery? (We grant write-only —
    see §2.)
17. What advance notice do we get before payload schema changes?
18. Timeline for the two pending Mahindra Zeo parameters (`Vehicle Speed`, `Charging Parameters`),
    and confirmation they will arrive under the same keys.
19. Support SLA, status page, and the escalation contact for a 02:00 incident.
20. Can the producer credential be scoped to only our pilot vehicles on your side, so another
    customer's `vehicleno` can never reach our topic?

---

## 8. Vehicle provisioning list

Both sides must agree this exactly. **`vehicleno` must match what arrives in the payload** — our
resolver normalizes case and separators, but an unregistered value is quarantined, never auto-created.

| `vehicleno` | OEM platform | Model | Pack (kWh) | Nominal (Ah) | Commissioned | Depot |
|---|---|---|---|---|---|---|
| `<KA01EV1001>` | Tata Ace EV | | | | | |
| `<KA01EV1002>` | Tata Ace EV | | | | | |
| `<KA01EV1003>` | Mahindra Zeo | | | — | | |
| `<KA01EV1004>` | Switch | | | — | | |
| `<KA01EV1005>` | Eicher | | | **required** | | |

**Nominal capacity in Ah is required for Eicher** — it is the denominator in coulomb-counted SOH, and
Eicher is the only platform where that calculation is possible.

**Start with a Tata Ace EV.** Its 58 parameters exercise every code path — cell arrays, sentinels,
harsh events, charging enums. The other platforms are subsets.

---

## 9. Cutover sequence

| Step | Owner | Action | Verification |
|---|---|---|---|
| 1 | Bosch | Provision cluster, topic, ACLs, quota | ACL negative tests pass (§10) |
| 2 | Bosch | Send §1–§5 + credential out-of-band | Intellicar acknowledges receipt |
| 3 | Intellicar | Configure producer; confirm connectivity | `kcat -L` succeeds from your side |
| 4 | Intellicar | Enable **one staging vehicle** | First message lands on the topic |
| 5 | Bosch | Validate payload against §3 | Golden vector committed to CI |
| 6 | Both | Reconcile any key mismatches | All keys `confirmed`, zero assumed |
| 7 | Bosch | Chaos tests (kill worker, poison message, replay) | All pass |
| 8 | Intellicar | Enable remaining pilot vehicles | Coverage ≥ 95 % over 48 h |
| 9 | Both | 14-day soak; daily parity reconciliation | Odometer/SOC within 1 % |
| 10 | Both | Sign-off; on-call handover | Runbook agreed |

**Do not skip step 4.** One vehicle first. A fleet-wide switch before the payload is validated turns a
one-hour fix into a two-week backfill.

---

## 10. Pre-handover verification (Bosch, before step 2)

```bash
# Connectivity and auth as the producer principal
kcat -b $BOOTSTRAP -F intellicar.properties -L

# Produce a representative record
echo 'KA01EV1001:{"bulkData":[{"vehicleno":"KA01EV1001","type":"can","data":{"time":1757320800000,"soc":67,"no_of_cells":29,"no_of_temperature_sensors":4,"cell_temperature_05":-80}}]}' \
  | kcat -b $BOOTSTRAP -F intellicar.properties -P -t intellicar.telemetry.raw.v1 -K:

# NEGATIVE TEST — producer must NOT read
kcat -b $BOOTSTRAP -F intellicar.properties -C -t intellicar.telemetry.raw.v1 -o beginning -e
#   REQUIRED: TOPIC_AUTHORIZATION_FAILED

# NEGATIVE TEST — producer must NOT enumerate other topics
kcat -b $BOOTSTRAP -F intellicar.properties -L | grep -c "^  topic"
#   REQUIRED: 1

# Consumer side reads normally
kcat -b $BOOTSTRAP -F bosch.properties -C -t intellicar.telemetry.raw.v1 -o beginning -e
```

Both negative tests must fail as expected before any credential leaves Bosch. An over-broad ACL on an
internet-facing broker is invisible unless you test for it.

---

## Appendix A — Ready-to-send handover summary

```
To: <Intellicar engineering>
Subject: Bosch MPS Kafka endpoint — connection details for telemetry push

Kafka client endpoints
  <BOOTSTRAP_1>:<PORT>
  <BOOTSTRAP_2>:<PORT>
  <BOOTSTRAP_3>:<PORT>

Topic name
  intellicar.telemetry.raw.v1        (6 partitions, 14-day retention, max 1 MB/message)

Authentication
  Security protocol : SASL_SSL
  SASL mechanism    : SCRAM-SHA-512
  Username          : intellicar-producer
  Password          : sent separately via <CHANNEL>
  TLS               : public CA; no custom truststore needed

Requested producer configuration
  key                : vehicleno          <- please set this
  acks               : all
  enable.idempotence : true
  compression.type   : zstd
  max.request.size   : 1048576
  push mode          : Batch, 30 s

Please confirm
  - your egress IP CIDRs (only these will be permitted)
  - the JSON key table in section 3.3 of the attached package
  - the questions in section 7

Start with ONE staging vehicle. We will validate the payload and confirm before
you enable the remainder of the pilot fleet.

Bosch technical contact: <NAME / EMAIL / PHONE>
```

## Appendix B — What Bosch does NOT expose

Stated explicitly for the security review:

- ❌ No read access to any topic
- ❌ No access to any topic other than `intellicar.telemetry.raw.v1`
- ❌ No cluster-level operations (create, alter, delete, describe cluster)
- ❌ No consumer group access
- ❌ No database access — Postgres has no route from the internet
- ❌ No API access — the e-inter API is a separate service, separately authenticated
- ❌ No plaintext listener
- ❌ No access from any IP outside the declared allowlist

The entire exposed surface is: **one TCP port, one topic, write-only, rate-limited, IP-restricted,
TLS-encrypted, SCRAM-authenticated.**
