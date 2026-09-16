import { Router } from "express";
import { z } from "zod";
import { isDemoMode } from "../db/client.js";
import { fleetStore } from "../store/fleetStore.js";
export const apiRouter = Router();

apiRouter.get("/health", async (_req, res) => {
  let database = false;
  if (!isDemoMode()) {
    try {
      const { getPool } = await import("../db/client.js");
      await getPool().query("SELECT 1");
      database = true;
    } catch {
      database = false;
    }
  }
  res.json({
    ok: true,
    product: "e-inter",
    layer: "api",
    mode: isDemoMode() ? "demo" : "live",
    database,
  });
});

apiRouter.get("/command-center", async (_req, res) => {
  res.json(await fleetStore.commandCenterSummary());
});

apiRouter.get("/policy", async (_req, res) => {
  res.json(await fleetStore.getPolicy());
});

const policySchema = z.object({
  showMap: z.boolean().optional(),
  showSocStrip: z.boolean().optional(),
  showImmobilise: z.boolean().optional(),
  highlightLowSoc: z.boolean().optional(),
  showAssetStrip: z.boolean().optional(),
  showTripLedger: z.boolean().optional(),
  highlightStaleGps: z.boolean().optional(),
  gpsUplinkTargetSeconds: z.number().min(10).max(600).optional(),
  stalePositionMinutes: z.number().min(1).max(240).optional(),
  lowSocAlertPercent: z.number().min(5).max(80).optional(),
  geofenceBreachAlerts: z.boolean().optional(),
  deviceBatteryAlertVolts: z.number().min(2).max(6).optional(),
  highlightGpsReportMismatch: z.boolean().optional(),
});

apiRouter.put("/policy", async (req, res) => {
  const parsed = policySchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  res.json(await fleetStore.updatePolicy(parsed.data));
});

apiRouter.get("/vehicles", async (_req, res) => {
  res.json(await fleetStore.listVehicles());
});

const registerVehicleSchema = z.object({
  registration: z.string().min(3),
  displayName: z.string().min(1),
  model: z.string().min(1),
  telemetryMode: z.enum(["gps_only", "can_gps"]),
  allowImmobilise: z.boolean(),
  seedLat: z.number(),
  seedLng: z.number(),
  kwhPack: z.number().positive(),
  odometerKm: z.number().nonnegative(),
  socPercent: z.number().min(0).max(100),
  locationLabel: z.string().min(1),
  oemPlatform: z.enum(["mahindra_zeo", "tata_ace_ev", "switch_ev", "eicher_ev"]).optional(),
  nominalCapacityAh: z.number().positive().nullable().optional(),
  commissionedOn: z.string().optional(),
});

apiRouter.post("/vehicles", async (req, res) => {
  const parsed = registerVehicleSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  if (!isDemoMode() && !parsed.data.oemPlatform) {
    return res.status(400).json({ error: "oem_platform_required" });
  }
  try {
    const v = await fleetStore.addVehicle(parsed.data);
    res.status(201).json(v);
  } catch (err) {
    const status = (err as { status?: number }).status ?? 500;
    res.status(status).json({ error: (err as Error).message });
  }
});

apiRouter.get("/devices", async (_req, res) => {
  res.json(await fleetStore.listDevices());
});

apiRouter.post("/devices", async (req, res) => {
  const serial = typeof req.body?.serial === "string" ? req.body.serial : undefined;
  res.status(201).json(await fleetStore.registerDevice(serial));
});

apiRouter.post("/devices/:id/unpair", async (req, res) => {
  const d = await fleetStore.unpairDevice(req.params.id);
  if (!d) return res.status(404).json({ error: "not_found" });
  res.json(d);
});

apiRouter.get("/maintenance", async (_req, res) => {
  res.json(await fleetStore.listMaintenance());
});

const maintSchema = z.object({
  vehicleId: z.string(),
  workType: z.string(),
  title: z.string(),
  dueDate: z.string(),
  odometerAtDueKm: z.number().nullable().optional(),
  vendor: z.string().nullable().optional(),
  notes: z.string(),
});

apiRouter.post("/maintenance", async (req, res) => {
  const parsed = maintSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: parsed.error.flatten() });
  const row = await fleetStore.addMaintenance({
    ...parsed.data,
    odometerAtDueKm: parsed.data.odometerAtDueKm ?? null,
    vendor: parsed.data.vendor ?? null,
  });
  res.status(201).json(row);
});

apiRouter.patch("/maintenance/:id", async (req, res) => {
  const status = z.enum(["open", "in_progress", "done"]).safeParse(req.body?.status);
  if (!status.success) return res.status(400).json({ error: "invalid_status" });
  const row = await fleetStore.updateMaintenanceStatus(req.params.id, status.data);
  if (!row) return res.status(404).json({ error: "not_found" });
  res.json(row);
});

apiRouter.get("/analytics/battery-health", async (_req, res) => {
  res.json({ updatedAt: new Date().toISOString(), items: await fleetStore.batteryHealth() });
});

apiRouter.get("/analytics/asset-lifecycle", async (_req, res) => {
  res.json({ updatedAt: new Date().toISOString(), items: await fleetStore.lifecycle() });
});

apiRouter.get("/analytics/driver-classification", async (_req, res) => {
  res.json({ updatedAt: new Date().toISOString(), items: await fleetStore.drivers() });
});

apiRouter.get("/analytics/portfolio-valuation", async (_req, res) => {
  res.json(await fleetStore.portfolioValuation());
});

apiRouter.get("/trips", async (_req, res) => {
  res.json({ updatedAt: new Date().toISOString(), items: await fleetStore.listTrips() });
});
