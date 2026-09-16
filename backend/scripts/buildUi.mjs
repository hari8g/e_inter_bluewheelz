import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

if (process.env.SKIP_FRONTEND_BUILD === "1") {
  console.log("[build] SKIP_FRONTEND_BUILD=1, not building dashboard UI");
  process.exit(0);
}

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const frontend = path.resolve(backendRoot, "../frontend");

if (!existsSync(path.join(frontend, "package.json"))) {
  console.warn("[build] frontend app not found at", frontend);
  process.exit(0);
}

function run(command, args) {
  const result = spawnSync(command, args, {
    cwd: frontend,
    stdio: "inherit",
    env: process.env,
  });
  if (result.status !== 0) process.exit(result.status ?? 1);
}

run("npm", ["ci"]);
run("npm", ["run", "build"]);
