import { isDemoMode } from "../db/client.js";
import type { FleetStore } from "./fleetStore.interface.js";
import { PgFleetStore } from "./pgFleetStore.js";
import { SeedFleetStore } from "./seedFleetStore.js";

const seed = new SeedFleetStore();

export const fleetStore: FleetStore = isDemoMode() ? seed : new PgFleetStore();

/** Demo CAN jitter: long-lived hosts only (Render sets RENDER; local dev uses LISTEN). Live mode never jitters. */
if (isDemoMode() && (String(process.env.RENDER).toLowerCase() === "true" || process.env.LISTEN === "1")) {
  setInterval(() => seed.tickCanNoise(), 8000);
}
