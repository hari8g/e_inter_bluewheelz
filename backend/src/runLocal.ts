/**
 * HTTP server entry: used by `npm start` (Render, local prod) and `npm run dev`
 * (via `tsx watch`). Binds `PORT` from the host or 8787 locally.
 */
import { app } from "./app.js";
import { isDemoMode } from "./db/client.js";

const port = Number(process.env.PORT) || 8787;

async function boot() {
  if (!isDemoMode()) {
    const { migrate } = await import("./db/migrate.js");
    await migrate();
    if (process.env.BOOTSTRAP_PILOT === "1") {
      const { seedPilotFleet } = await import("./db/seedPilot.js");
      await seedPilotFleet();
    }
  }

  app.listen(port, () => {
    const mode = isDemoMode() ? "demo" : "live";
    console.log(`e-inter API listening on port ${port} (${mode})`);
  });
}

boot().catch((err) => {
  console.error("[api] boot failed", err);
  process.exit(1);
});
