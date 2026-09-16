import { existsSync } from "node:fs";
import path from "node:path";
import express from "express";
import cors from "cors";
import { requireAuth } from "./auth/requireAuth.js";
import { apiRouter } from "./routes/api.js";
import { authRouter } from "./routes/auth.js";
import { opsRouter } from "./routes/ops.js";
import { signalProfilesRouter } from "./routes/signalProfiles.js";
import { canTelemetryRouter } from "./routes/canTelemetry.js";

export const app = express();

const frontendDir = process.env.FRONTEND_DIST
  ? path.resolve(process.env.FRONTEND_DIST)
  : path.resolve(process.cwd(), "dist/public");
const frontendIndex = path.join(frontendDir, "index.html");
const hasFrontend = existsSync(frontendIndex);

/**
 * Reflect the requesting origin unless ALLOWED_ORIGINS is set. Production used to
 * default to `origin: false`, which blocked a Vercel UI from calling this API.
 */
const allowed = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
app.use(cors({ origin: allowed.length > 0 ? allowed : true }));
app.use(express.json());

if (!hasFrontend) {
  app.get("/", (_req, res) => {
    res.json({
      name: "e-inter API",
      version: "1.1.0",
      docs: "Mount frontend separately; API under /api/v1",
    });
  });
}

app.use("/api/v1/auth", authRouter);
app.use("/api/v1/ops", opsRouter);
app.use("/api/v1/signal-profiles", requireAuth, signalProfilesRouter);
app.use("/api/v1/vehicles", requireAuth, canTelemetryRouter);
app.use(
  "/api/v1",
  (req, res, next) => {
    if (req.path === "/health" || req.path.startsWith("/auth")) return next();
    return requireAuth(req, res, next);
  },
  apiRouter,
);

if (hasFrontend) {
  app.use(express.static(frontendDir));
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (req.path.startsWith("/api")) return next();
    res.sendFile(frontendIndex);
  });
}
