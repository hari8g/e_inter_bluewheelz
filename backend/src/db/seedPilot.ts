import { insertVehicle, linkAlias, resolveByVehicleno } from "./repositories/vehicleRepo.js";
import { getProfileForPlatform } from "../signals/profileRegistry.js";
import type { OemPlatform } from "../signals/canonical.js";

interface PilotVehicle {
  vehicleno: string;
  displayName: string;
  model: string;
  platform: OemPlatform;
  kwhPack: number;
  nominalCapacityAh?: number;
  locationLabel: string;
  commissionedOn: string;
  expectedUplinkSec?: number;
}

/** Edit this list to match vehicles Intellicar has provisioned. */
export const PILOT_FLEET: PilotVehicle[] = [
  { vehicleno: "KA01EV1001", displayName: "Ops · MG Road", model: "Tata Ace EV", platform: "tata_ace_ev", kwhPack: 21.3, locationLabel: "Bengaluru", commissionedOn: "2024-03-15", expectedUplinkSec: 30 },
  { vehicleno: "KA01EV1002", displayName: "Depot north lead", model: "Tata Ace EV", platform: "tata_ace_ev", kwhPack: 21.3, locationLabel: "Bengaluru", commissionedOn: "2024-06-01", expectedUplinkSec: 30 },
  { vehicleno: "KA01EV1003", displayName: "Whitefield loop", model: "Mahindra Zeo", platform: "mahindra_zeo", kwhPack: 10.2, locationLabel: "Bengaluru", commissionedOn: "2025-01-20", expectedUplinkSec: 30 },
  { vehicleno: "KA01EV1004", displayName: "Koramangala", model: "Switch IeV", platform: "switch_ev", kwhPack: 25.0, locationLabel: "Bengaluru", commissionedOn: "2024-11-05", expectedUplinkSec: 30 },
  { vehicleno: "KA01EV1005", displayName: "HSR trunk", model: "Eicher Pro X", platform: "eicher_ev", kwhPack: 110.0, nominalCapacityAh: 200, locationLabel: "Bengaluru", commissionedOn: "2024-08-12", expectedUplinkSec: 30 },
];

export async function seedPilotFleet(): Promise<void> {
  for (const v of PILOT_FLEET) {
    const existing = await resolveByVehicleno(v.vehicleno);
    if (existing) {
      await linkAlias(v.vehicleno, existing.id, "seed");
      console.log(`  = ${v.vehicleno} already registered as ${existing.id}`);
      continue;
    }
    const profile = getProfileForPlatform(v.platform);
    const id = `v_${v.vehicleno.toLowerCase()}`;
    await insertVehicle({
      id,
      registration: v.vehicleno,
      displayName: v.displayName,
      model: v.model,
      oemPlatform: v.platform,
      assetClass: profile.assetClass,
      signalProfileId: profile.profileId,
      kwhPack: v.kwhPack,
      nominalCapacityAh: v.nominalCapacityAh ?? null,
      locationLabel: v.locationLabel,
      commissionedOn: v.commissionedOn,
      expectedUplinkSec: v.expectedUplinkSec ?? 30,
    });
    console.log(`  + ${v.vehicleno} -> ${id} (${v.platform}, profile ${profile.profileId})`);
  }
  console.log(`\n${PILOT_FLEET.length} pilot vehicles ready.`);
  console.log("Vehicles NOT listed here will be quarantined on arrival, not auto-created.");
}
