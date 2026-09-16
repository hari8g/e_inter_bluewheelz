-- Operator tables the SPA already expects: policy, GPS devices, maintenance.
-- Telemetry tables live in 0001; this is the command-centre write path.

CREATE TABLE IF NOT EXISTS fleet_policy (
  id         TEXT PRIMARY KEY DEFAULT 'default',
  policy     JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

INSERT INTO fleet_policy (id, policy) VALUES (
  'default',
  '{
    "showMap": true,
    "showSocStrip": true,
    "showImmobilise": true,
    "highlightLowSoc": true,
    "showAssetStrip": true,
    "showTripLedger": true,
    "highlightStaleGps": true,
    "gpsUplinkTargetSeconds": 60,
    "stalePositionMinutes": 15,
    "lowSocAlertPercent": 20,
    "geofenceBreachAlerts": false
  }'::jsonb
) ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS gps_device (
  id                 TEXT PRIMARY KEY,
  serial             TEXT NOT NULL UNIQUE,
  firmware           TEXT NOT NULL DEFAULT '2.4.1',
  type               TEXT NOT NULL DEFAULT 'GPS',
  last_seen_at       TIMESTAMPTZ NOT NULL DEFAULT now(),
  paired_vehicle_id  TEXT REFERENCES vehicle(id) ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS maintenance_item (
  id                   TEXT PRIMARY KEY,
  vehicle_id           TEXT NOT NULL REFERENCES vehicle(id) ON DELETE CASCADE,
  work_type            TEXT NOT NULL,
  title                TEXT NOT NULL,
  due_date             DATE NOT NULL,
  odometer_at_due_km   NUMERIC(10,1),
  vendor               TEXT,
  notes                TEXT NOT NULL DEFAULT '',
  status               TEXT NOT NULL DEFAULT 'open',
  created_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS maintenance_item_vehicle_idx ON maintenance_item(vehicle_id);
