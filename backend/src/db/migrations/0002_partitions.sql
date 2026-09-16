-- Monthly partitions for the telemetry hypertables, plus DEFAULT catch-alls so an
-- unexpected timestamp never causes an insert failure at 3am.
--
-- If your Postgres host offers TimescaleDB, replace this file with
--   SELECT create_hypertable('telemetry_can', 'captured_at', chunk_time_interval => INTERVAL '1 day');
-- and use continuous aggregates for the rollups. Native partitioning below is
-- sufficient at pilot scale.

DO $$
DECLARE
  start_month DATE := date_trunc('month', now())::date - INTERVAL '1 month';
  m           DATE;
  tbl         TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['telemetry_gps', 'telemetry_can'] LOOP
    FOR i IN 0..12 LOOP
      m := (start_month + (i || ' month')::INTERVAL)::date;
      EXECUTE format(
        'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I FOR VALUES FROM (%L) TO (%L)',
        tbl || '_' || to_char(m, 'YYYY_MM'), tbl, m, (m + INTERVAL '1 month')::date
      );
    END LOOP;
    EXECUTE format(
      'CREATE TABLE IF NOT EXISTS %I PARTITION OF %I DEFAULT', tbl || '_default', tbl
    );
  END LOOP;
END $$;

CREATE INDEX IF NOT EXISTS telemetry_can_brin  ON telemetry_can  USING BRIN (captured_at);
CREATE INDEX IF NOT EXISTS telemetry_gps_brin  ON telemetry_gps  USING BRIN (captured_at);
CREATE INDEX IF NOT EXISTS telemetry_can_vt    ON telemetry_can  (vehicle_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS telemetry_gps_vt    ON telemetry_gps  (vehicle_id, captured_at DESC);
CREATE INDEX IF NOT EXISTS driver_event_vt     ON driver_event   (vehicle_id, occurred_at DESC);
