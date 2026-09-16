/**
 * vehicleno -> vehicle_id, with a short-lived cache.
 *
 * An unknown vehicleno returns null and is quarantined. It is NEVER auto-created:
 * auto-creation is how another customer's vehicle silently joins your fleet, and how
 * a registration typo becomes a phantom asset with its own dashboard.
 */
import { resolveByVehicleno, type VehicleRow } from "../db/repositories/vehicleRepo.js";
import { normalizeVehicleno } from "./envelope.js";

const TTL_MS = 5 * 60_000;
const cache = new Map<string, { row: VehicleRow | null; at: number }>();

export async function resolveVehicle(vehicleno: string): Promise<VehicleRow | null> {
  const key = normalizeVehicleno(vehicleno);
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.row;

  const row = await resolveByVehicleno(key);
  cache.set(key, { row, at: Date.now() });
  return row;
}

export function invalidateResolverCache(): void {
  cache.clear();
}
