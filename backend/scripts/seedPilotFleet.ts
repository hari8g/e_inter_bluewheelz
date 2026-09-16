/**
 * Registers pilot vehicles and their vehicleno aliases.
 *
 *   DATABASE_URL=... npm run seed:pilot
 */
import { closePool } from "../src/db/client.js";
import { seedPilotFleet } from "../src/db/seedPilot.js";

seedPilotFleet()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
