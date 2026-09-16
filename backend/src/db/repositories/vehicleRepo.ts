/** Vehicle registry and vehicleno -> vehicle_id resolution. */
import { query } from "../client.js";
import { normalizeVehicleno } from "../../ingest/envelope.js";
import type { AssetClass, OemPlatform } from "../../signals/canonical.js";

export interface VehicleRow {
  id: string;
  registration: string;
  display_name: string;
  model: string;
  oem_platform: OemPlatform;
  asset_class: AssetClass;
  vin: string | null;
  signal_profile_id: string;
  telemetry_mode: string;
  kwh_pack: string | null;
  nominal_capacity_ah: string | null;
  allow_immobilise: boolean;
  location_label: string | null;
  commissioned_on: Date | null;
  expected_uplink_sec: number;
}

export async function listVehicles(): Promise<VehicleRow[]> {
  return query<VehicleRow>(`SELECT * FROM vehicle ORDER BY registration`);
}

export async function getVehicle(id: string): Promise<VehicleRow | null> {
  const rows = await query<VehicleRow>(`SELECT * FROM vehicle WHERE id = $1`, [id]);
  return rows[0] ?? null;
}

export async function resolveByVehicleno(vehicleno: string): Promise<VehicleRow | null> {
  const key = normalizeVehicleno(vehicleno);
  const rows = await query<VehicleRow>(
    `SELECT v.* FROM vehicle_alias a
       JOIN vehicle v ON v.id = a.vehicle_id
      WHERE a.vehicleno = $1 AND (a.valid_to IS NULL OR a.valid_to > now())
      LIMIT 1`,
    [key],
  );
  return rows[0] ?? null;
}

export interface InsertVehicleInput {
  id: string;
  registration: string;
  displayName: string;
  model: string;
  oemPlatform: OemPlatform;
  assetClass: AssetClass;
  signalProfileId: string;
  vin?: string | null;
  telemetryMode?: string;
  kwhPack?: number | null;
  nominalCapacityAh?: number | null;
  allowImmobilise?: boolean;
  locationLabel?: string | null;
  commissionedOn?: string | null;
  expectedUplinkSec?: number;
}

export async function insertVehicle(input: InsertVehicleInput): Promise<VehicleRow> {
  const rows = await query<VehicleRow>(
    `INSERT INTO vehicle (id, registration, display_name, model, oem_platform, asset_class, vin,
       signal_profile_id, telemetry_mode, kwh_pack, nominal_capacity_ah, allow_immobilise,
       location_label, commissioned_on, expected_uplink_sec)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)
     RETURNING *`,
    [
      input.id, input.registration, input.displayName, input.model, input.oemPlatform,
      input.assetClass, input.vin ?? null, input.signalProfileId,
      input.telemetryMode ?? "can_gps", input.kwhPack ?? null, input.nominalCapacityAh ?? null,
      input.allowImmobilise ?? false, input.locationLabel ?? null, input.commissionedOn ?? null,
      input.expectedUplinkSec ?? 30,
    ],
  );
  await linkAlias(input.registration, input.id, "onboarding");
  return rows[0];
}

export async function linkAlias(vehicleno: string, vehicleId: string, source: string): Promise<void> {
  await query(
    `INSERT INTO vehicle_alias (vehicleno, vehicle_id, source) VALUES ($1,$2,$3)
     ON CONFLICT (vehicleno) DO UPDATE SET vehicle_id = EXCLUDED.vehicle_id, valid_to = NULL`,
    [normalizeVehicleno(vehicleno), vehicleId, source],
  );
}
