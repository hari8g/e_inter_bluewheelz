-- e-inter telemetry schema, v1.
--
-- Design notes that matter:
--  * telemetry_gps and telemetry_can are SEPARATE tables. Intellicar states GPS and
--    CAN are sampled at different rates with independent timestamps; merging them
--    into one row would fabricate co-temporality.
--  * EVERY CAN column is nullable. CAN payloads are sparse — an absent key means
--    "not received", never zero.
--  * telemetry_can.raw keeps the complete payload so parameters added later can be
--    back-promoted by replaying Kafka.

CREATE TABLE IF NOT EXISTS signal_profile (
  id              TEXT PRIMARY KEY,
  oem_platform    TEXT NOT NULL,
  definition      JSONB NOT NULL,
  effective_from  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS vehicle (
  id                   TEXT PRIMARY KEY,
  registration         TEXT NOT NULL UNIQUE,
  display_name         TEXT NOT NULL,
  model                TEXT NOT NULL,
  oem_platform         TEXT NOT NULL,
  asset_class          TEXT NOT NULL,
  vin                  TEXT,
  signal_profile_id    TEXT NOT NULL REFERENCES signal_profile(id),
  telemetry_mode       TEXT NOT NULL DEFAULT 'can_gps',
  kwh_pack             NUMERIC(8,2),
  nominal_capacity_ah  NUMERIC(8,2),
  allow_immobilise     BOOLEAN NOT NULL DEFAULT false,
  location_label       TEXT,
  commissioned_on      DATE,
  expected_uplink_sec  INTEGER NOT NULL DEFAULT 30,
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- vehicleno (registration) is Intellicar's only join key, and registrations change.
CREATE TABLE IF NOT EXISTS vehicle_alias (
  vehicleno   TEXT PRIMARY KEY,
  vehicle_id  TEXT NOT NULL REFERENCES vehicle(id) ON DELETE CASCADE,
  valid_from  TIMESTAMPTZ NOT NULL DEFAULT now(),
  valid_to    TIMESTAMPTZ,
  source      TEXT NOT NULL DEFAULT 'onboarding'
);
CREATE INDEX IF NOT EXISTS vehicle_alias_vehicle_idx ON vehicle_alias(vehicle_id);

CREATE TABLE IF NOT EXISTS telemetry_gps (
  vehicle_id   TEXT        NOT NULL,
  captured_at  TIMESTAMPTZ NOT NULL,
  received_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  lat          NUMERIC(9,6),
  lng          NUMERIC(9,6),
  alti         NUMERIC(7,1),
  speed_kph    NUMERIC(5,1),
  ign_status   SMALLINT,
  heading      NUMERIC(5,1),
  PRIMARY KEY (vehicle_id, captured_at)
) PARTITION BY RANGE (captured_at);

CREATE TABLE IF NOT EXISTS telemetry_can (
  vehicle_id       TEXT        NOT NULL,
  captured_at      TIMESTAMPTZ NOT NULL,
  received_at      TIMESTAMPTZ NOT NULL DEFAULT now(),
  skew_seconds     INTEGER,
  -- promoted hot scalars: ALL NULLABLE, because CAN is sparse
  soc_pct          NUMERIC(5,2),
  odometer_km      NUMERIC(10,1),
  speed_kph        NUMERIC(5,1),
  dte_km           NUMERIC(6,1),
  gear_state       TEXT,
  trip_distance_km NUMERIC(8,1),
  pack_voltage_v   NUMERIC(7,2),
  pack_current_a   NUMERIC(8,2),
  pack_power_kw    NUMERIC(9,2),
  cell_v           NUMERIC(5,3)[],   -- truncated to no_of_cells
  cell_t           NUMERIC(5,2)[],   -- truncated to no_of_temperature_sensors; -80 is a sentinel
  cell_v_max       NUMERIC(5,3),
  cell_v_min       NUMERIC(5,3),
  cell_delta_mv    NUMERIC(7,2),
  cell_temp_max_c  NUMERIC(5,2),
  cell_temp_min_c  NUMERIC(5,2),
  charging_status  TEXT,
  ttc_min          INTEGER,
  accel_pedal_pct  NUMERIC(5,2),
  brake_pedal      BOOLEAN,
  parking_brake    BOOLEAN,
  raw              JSONB NOT NULL,
  quality          JSONB NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (vehicle_id, captured_at)
) PARTITION BY RANGE (captured_at);

CREATE TABLE IF NOT EXISTS driver_event (
  id          BIGSERIAL PRIMARY KEY,
  vehicle_id  TEXT NOT NULL REFERENCES vehicle(id) ON DELETE CASCADE,
  occurred_at TIMESTAMPTZ NOT NULL,
  kind        TEXT NOT NULL,
  mean_mps2   NUMERIC(5,2),
  peak_mps2   NUMERIC(5,2),
  interval_s  NUMERIC(8,2),
  source      TEXT NOT NULL,
  UNIQUE (vehicle_id, occurred_at, kind)
);

CREATE TABLE IF NOT EXISTS vehicle_state_current (
  vehicle_id   TEXT PRIMARY KEY REFERENCES vehicle(id) ON DELETE CASCADE,
  state        JSONB NOT NULL,
  captured_at  TIMESTAMPTZ NOT NULL,
  updated_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS daily_vehicle_rollup (
  vehicle_id               TEXT NOT NULL REFERENCES vehicle(id) ON DELETE CASCADE,
  day                      DATE NOT NULL,
  distance_km              NUMERIC(9,1),
  moving_minutes           INTEGER,
  frames_received          INTEGER,
  frames_expected          INTEGER,
  soc_band_minutes         JSONB,
  cell_delta_mv_p95        NUMERIC(7,2),
  cell_temp_max_c          NUMERIC(5,2),
  thermal_minutes_over_45c INTEGER,
  efc_accrued              NUMERIC(9,3),
  harsh_brake_count        INTEGER,
  harsh_accel_count        INTEGER,
  provisional              BOOLEAN NOT NULL DEFAULT true,
  computed_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (vehicle_id, day)
);

CREATE TABLE IF NOT EXISTS battery_soh_daily (
  vehicle_id   TEXT NOT NULL REFERENCES vehicle(id) ON DELETE CASCADE,
  day          DATE NOT NULL,
  soh_pct      NUMERIC(5,2),
  method       TEXT NOT NULL,
  ci_low       NUMERIC(5,2),
  ci_high      NUMERIC(5,2),
  sample_count INTEGER,
  PRIMARY KEY (vehicle_id, day)
);

-- Counters for /ops/ingest-health: fastest detector of an upstream schema change.
CREATE TABLE IF NOT EXISTS ingest_reject (
  vehicle_id  TEXT NOT NULL,
  signal      TEXT NOT NULL,
  reason      TEXT NOT NULL,
  day         DATE NOT NULL,
  count       INTEGER NOT NULL DEFAULT 0,
  last_value  TEXT,
  PRIMARY KEY (vehicle_id, signal, reason, day)
);

-- Unknown vehicleno values are quarantined here, NEVER auto-created as vehicles.
CREATE TABLE IF NOT EXISTS ingest_quarantine (
  id          BIGSERIAL PRIMARY KEY,
  vehicleno   TEXT,
  reason      TEXT NOT NULL,
  payload     JSONB NOT NULL,
  received_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ingest_quarantine_time_idx ON ingest_quarantine(received_at DESC);
