// tsc does not copy .sql or .json assets. Ship them alongside the compiled output.
import { cpSync, mkdirSync } from "node:fs";
mkdirSync("dist/db/migrations", { recursive: true });
cpSync("src/db/migrations", "dist/db/migrations", { recursive: true });
mkdirSync("dist/signals/profiles", { recursive: true });
cpSync("src/signals/profiles", "dist/signals/profiles", { recursive: true });
mkdirSync("dist/data", { recursive: true });
try {
  cpSync("../Database", "dist/data/vehicles", { recursive: true });
  mkdirSync("data", { recursive: true });
  cpSync("../Database", "data/vehicles", { recursive: true });
  console.log("[build] copied Database/ vehicle files into dist/data/vehicles and data/vehicles");
} catch (err) {
  const message = err instanceof Error ? err.message : String(err);
  console.warn("[build] Database/ not copied:", message);
}
