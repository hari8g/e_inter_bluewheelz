import express from "express";
import cors from "cors";
import { requireAuth } from "./auth/requireAuth.js";
import { apiRouter } from "./routes/api.js";
import { authRouter } from "./routes/auth.js";
import { opsRouter } from "./routes/ops.js";
import { signalProfilesRouter } from "./routes/signalProfiles.js";
import { canTelemetryRouter } from "./routes/canTelemetry.js";

export const app = express();

/**
 * `origin: true` reflects any origin. Acceptable for a demo, not for a service that
 * sits alongside vehicle telemetry. Set ALLOWED_ORIGINS in production.
 */
const allowed = (process.env.ALLOWED_ORIGINS ?? "").split(",").map((o) => o.trim()).filter(Boolean);
app.use(cors({ origin: allowed.length > 0 ? allowed : process.env.NODE_ENV === "production" ? false : true }));
app.use(express.json());

app.get("/", (_req, res) => {
  res.json({
    name: "e-inter API",
    version: "1.1.0",
    docs: "Mount frontend separately; API under /api/v1",
  });
});

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
