import type {
  AssetLifecycleStage,
  BatteryHealthPoint,
  DriverSeed,
  FleetPolicy,
  GpsDevice,
  MaintenanceItem,
  Vehicle,
} from "../types/domain.js";

const now = () => new Date().toISOString();

export const initialPolicy: FleetPolicy = {
  showMap: true,
  showSocStrip: true,
  showImmobilise: true,
  highlightLowSoc: true,
  showAssetStrip: true,
  showTripLedger: true,
  highlightStaleGps: true,
  gpsUplinkTargetSeconds: 60,
  stalePositionMinutes: 15,
  lowSocAlertPercent: 20,
  geofenceBreachAlerts: false,
  deviceBatteryAlertVolts: 3.9,
  highlightGpsReportMismatch: true,
};

const baseVehicles: Vehicle[] = [
  {
    id: "v1",
    registration: "KA01DM1001",
    displayName: "Ops · MG Road",
    model: "E-2W Urban Pro",
    telemetryMode: "can_gps",
    allowImmobilise: true,
    kwhPack: 3.2,
    odometerKm: 12400,
    socPercent: 78,
    status: "active",
    locationLabel: "Ops - MG Road",
    deviceId: "d1",
    position: {
      lat: 12.9716,
      lng: 77.5946,
      lastFixAt: now(),
    },
    can: {
      motorTempC: 41,
      packVoltageV: 52.4,
      minCellV: 3.61,
      maxCellV: 3.66,
      bmsHealthScore: 94,
      capturedAt: now(),
    },
  },
  {
    id: "v2",
    registration: "KA01DM1002",
    displayName: "Depot north lead",
    model: "E-2W Urban Pro",
    telemetryMode: "gps_only",
    allowImmobilise: true,
    kwhPack: 3.2,
    odometerKm: 9800,
    socPercent: 22,
    status: "active",
    locationLabel: "Indiranagar",
    deviceId: "d2",
    position: {
      lat: 12.9784,
      lng: 77.6408,
      lastFixAt: now(),
    },
  },
  {
    id: "v3",
    registration: "KA01DM1003",
    displayName: "Whitefield loop",
    model: "City Glide X",
    telemetryMode: "can_gps",
    allowImmobilise: true,
    kwhPack: 4.1,
    odometerKm: 15200,
    socPercent: 45,
    status: "charging",
    locationLabel: "Whitefield hub",
    deviceId: "d3",
    position: {
      lat: 12.9698,
      lng: 77.75,
      lastFixAt: now(),
    },
    can: {
      motorTempC: 36,
      packVoltageV: 48.1,
      minCellV: 3.52,
      maxCellV: 3.58,
      bmsHealthScore: 88,
      capturedAt: now(),
    },
  },
  {
    id: "v4",
    registration: "KA01DM1004",
    displayName: "Koramangala",
    model: "E-2W Urban Pro",
    telemetryMode: "gps_only",
    allowImmobilise: false,
    kwhPack: 3.2,
    odometerKm: 7600,
    socPercent: 91,
    status: "active",
    locationLabel: "Koramangala 5th Block",
    deviceId: "d4",
    position: {
      lat: 12.9352,
      lng: 77.6245,
      lastFixAt: now(),
    },
  },
  {
    id: "v5",
    registration: "KA01DM1005",
    displayName: "HSR sector",
    model: "City Glide X",
    telemetryMode: "can_gps",
    allowImmobilise: true,
    kwhPack: 4.1,
    odometerKm: 20100,
    socPercent: 54,
    status: "idle",
    locationLabel: "HSR Layout",
    deviceId: "d5",
    position: {
      lat: 12.9121,
      lng: 77.6446,
      lastFixAt: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
    },
    can: {
      motorTempC: 33,
      packVoltageV: 51.2,
      minCellV: 3.55,
      maxCellV: 3.62,
      bmsHealthScore: 81,
      capturedAt: now(),
    },
  },
  {
    id: "v6",
    registration: "KA01DM1006",
    displayName: "JP Nagar",
    model: "E-2W Urban Pro",
    telemetryMode: "gps_only",
    allowImmobilise: true,
    kwhPack: 3.2,
    odometerKm: 4300,
    socPercent: 67,
    status: "active",
    locationLabel: "JP Nagar 2nd Phase",
    deviceId: null,
    position: {
      lat: 12.9063,
      lng: 77.5857,
      lastFixAt: now(),
    },
  },
  {
    id: "v7",
    registration: "KA01DM1007",
    displayName: "Yelahanka",
    model: "E-2W Urban Pro",
    telemetryMode: "can_gps",
    allowImmobilise: true,
    kwhPack: 3.2,
    odometerKm: 8900,
    socPercent: 33,
    status: "active",
    locationLabel: "Yelahanka",
    deviceId: "d6",
    position: {
      lat: 13.1007,
      lng: 77.5963,
      lastFixAt: now(),
    },
    can: {
      motorTempC: 44,
      packVoltageV: 49.8,
      minCellV: 3.48,
      maxCellV: 3.57,
      bmsHealthScore: 86,
      capturedAt: now(),
    },
  },
  {
    id: "v8",
    registration: "KA01DM1008",
    displayName: "Electronic City",
    model: "City Glide X",
    telemetryMode: "can_gps",
    allowImmobilise: true,
    kwhPack: 4.1,
    odometerKm: 17800,
    socPercent: 88,
    status: "charging",
    locationLabel: "Electronic City Phase 1",
    deviceId: "d7",
    position: {
      lat: 12.8456,
      lng: 77.6603,
      lastFixAt: now(),
    },
    can: {
      motorTempC: 38,
      packVoltageV: 53.9,
      minCellV: 3.64,
      maxCellV: 3.68,
      bmsHealthScore: 92,
      capturedAt: now(),
    },
  },
  {
    id: "v9",
    registration: "KA01DM1009",
    displayName: "Marathahalli",
    model: "E-2W Urban Pro",
    telemetryMode: "gps_only",
    allowImmobilise: true,
    kwhPack: 3.2,
    odometerKm: 11200,
    socPercent: 71,
    status: "active",
    locationLabel: "Marathahalli bridge",
    deviceId: "d8",
    position: {
      lat: 12.9591,
      lng: 77.6974,
      lastFixAt: now(),
    },
  },
  {
    id: "v10",
    registration: "KA01DM1010",
    displayName: "BTM layout",
    model: "E-2W Urban Pro",
    telemetryMode: "can_gps",
    allowImmobilise: true,
    kwhPack: 3.2,
    odometerKm: 5600,
    socPercent: 19,
    status: "active",
    locationLabel: "BTM 2nd Stage",
    deviceId: "d9",
    position: {
      lat: 12.9166,
      lng: 77.6101,
      lastFixAt: now(),
    },
    can: {
      motorTempC: 47,
      packVoltageV: 47.2,
      minCellV: 3.42,
      maxCellV: 3.51,
      bmsHealthScore: 79,
      capturedAt: now(),
    },
  },
];

export const initialVehicles: Vehicle[] = baseVehicles;

export const initialDevices: GpsDevice[] = [
  {
    id: "d1",
    serial: "ELITE-GPS-77821",
    firmware: "2.4.1",
    type: "CAN_GATEWAY",
    lastSeenAt: now(),
    pairedVehicleId: "v1",
  },
  {
    id: "d2",
    serial: "ELITE-GPS-77822",
    firmware: "2.4.1",
    type: "GPS",
    lastSeenAt: now(),
    pairedVehicleId: "v2",
  },
  {
    id: "d3",
    serial: "ELITE-GPS-77823",
    firmware: "2.4.0",
    type: "CAN_GATEWAY",
    lastSeenAt: now(),
    pairedVehicleId: "v3",
  },
  {
    id: "d4",
    serial: "ELITE-GPS-77824",
    firmware: "2.4.1",
    type: "GPS",
    lastSeenAt: now(),
    pairedVehicleId: "v4",
  },
  {
    id: "d5",
    serial: "ELITE-GPS-77825",
    firmware: "2.4.1",
    type: "CAN_GATEWAY",
    lastSeenAt: now(),
    pairedVehicleId: "v5",
  },
  {
    id: "d6",
    serial: "ELITE-GPS-77826",
    firmware: "2.3.9",
    type: "CAN_GATEWAY",
    lastSeenAt: now(),
    pairedVehicleId: "v7",
  },
  {
    id: "d7",
    serial: "ELITE-GPS-77827",
    firmware: "2.4.1",
    type: "CAN_GATEWAY",
    lastSeenAt: now(),
    pairedVehicleId: "v8",
  },
  {
    id: "d8",
    serial: "ELITE-GPS-77828",
    firmware: "2.4.1",
    type: "GPS",
    lastSeenAt: now(),
    pairedVehicleId: "v9",
  },
  {
    id: "d9",
    serial: "ELITE-GPS-77829",
    firmware: "2.4.1",
    type: "CAN_GATEWAY",
    lastSeenAt: now(),
    pairedVehicleId: "v10",
  },
];

export const initialMaintenance: MaintenanceItem[] = [
  {
    id: "m1",
    vehicleId: "v2",
    workType: "Scheduled service",
    title: "A-service + brake check",
    dueDate: new Date().toISOString().slice(0, 10),
    odometerAtDueKm: 10000,
    vendor: "Workshop A",
    notes: "Low SOC band watch — align with pack inspection.",
    status: "open",
    createdAt: now(),
  },
  {
    id: "m2",
    vehicleId: "v5",
    workType: "Predictive (CAN)",
    title: "Cell imbalance trending — BMS review",
    dueDate: new Date(Date.now() + 3 * 86400000).toISOString().slice(0, 10),
    odometerAtDueKm: null,
    vendor: null,
    notes: "Triggered from CAN delta pack metrics.",
    status: "in_progress",
    createdAt: now(),
  },
];

type BatteryHealthCore = Pick<
  BatteryHealthPoint,
  "vehicleId" | "registration" | "sohPercent" | "sohMethod" | "cycleEstimate" | "imbalanceMv" | "trend"
>;

export function buildBatteryHealth(vehicles: Vehicle[]): BatteryHealthCore[] {
  return vehicles.map((v) => ({
    vehicleId: v.id,
    registration: v.registration,
    sohPercent: v.can
      ? Math.min(99, 72 + Math.round((v.can.bmsHealthScore ?? 90) / 5))
      : 78 + (v.odometerKm % 7),
    sohMethod: "demo" as const,
    cycleEstimate: 400 + Math.round(v.odometerKm / 40),
    imbalanceMv: v.can && v.can.maxCellV != null && v.can.minCellV != null
      ? Math.round((v.can.maxCellV - v.can.minCellV) * 1000)
      : 12 + (v.id.charCodeAt(1) % 9),
    trend:
      v.can && (v.can.bmsHealthScore ?? 90) < 85
        ? "degrading"
        : v.can && (v.can.bmsHealthScore ?? 90) > 91
          ? "improving"
          : "stable",
  }));
}

type LifecycleCore = Pick<
  AssetLifecycleStage,
  "vehicleId" | "registration" | "stage" | "utilizationScore" | "projectedMajorServiceKm" | "odometerKm" | "notes"
>;

export function buildLifecycle(vehicles: Vehicle[]): LifecycleCore[] {
  return vehicles.map((v) => {
    const stage =
      v.odometerKm > 19000
        ? "watch"
        : v.odometerKm > 14000
          ? "steady"
          : v.odometerKm < 6000
            ? "ramp"
            : "steady";
    return {
      vehicleId: v.id,
      registration: v.registration,
      stage: stage === "watch" && v.socPercent < 25 ? "retire_candidate" : stage,
      utilizationScore: 55 + (v.odometerKm % 40),
      projectedMajorServiceKm: v.odometerKm + 3500,
      odometerKm: v.odometerKm,
      notes:
        v.telemetryMode === "can_gps"
          ? "CAN-backed wear model enabled."
          : "GPS-only; lifecycle inferred from distance + age.",
    };
  });
}

export const initialDriverSeeds: DriverSeed[] = [
  {
    driverId: "drv-01",
    label: "Arjun Mehta",
    safetyScore: 94,
    energyEfficiencyPercentile: 91,
    harshEvents7d: 0,
    band: "A",
  },
  {
    driverId: "drv-02",
    label: "Rohan Krishnan",
    safetyScore: 83,
    energyEfficiencyPercentile: 74,
    harshEvents7d: 4,
    band: "B",
  },
  {
    driverId: "drv-03",
    label: "Karthik Pillai",
    safetyScore: 76,
    energyEfficiencyPercentile: 63,
    harshEvents7d: 6,
    band: "B",
  },
  {
    driverId: "drv-04",
    label: "Aditya Rao",
    safetyScore: 61,
    energyEfficiencyPercentile: 41,
    harshEvents7d: 16,
    band: "C",
  },
];
