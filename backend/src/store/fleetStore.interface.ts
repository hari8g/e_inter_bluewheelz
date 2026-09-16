import type {
  CommandCenterPayload,
  DriverClassification,
  FleetPolicy,
  GpsDevice,
  MaintenanceItem,
  PortfolioValuationPayload,
  Vehicle,
  CanLivePayload,
  GpsHistoryPayload,
  CellSnapshotPayload,
  TripLedgerRow,
  GpsMetrics,
  DailyDistancePoint,
} from "../types/domain.js";
import type { BatteryHealthPoint, AssetLifecycleStage } from "../types/domain.js";

export interface AddVehicleInput {
  registration: string;
  displayName: string;
  model: string;
  telemetryMode: Vehicle["telemetryMode"];
  allowImmobilise: boolean;
  seedLat: number;
  seedLng: number;
  kwhPack: number;
  odometerKm: number;
  socPercent: number;
  locationLabel: string;
  oemPlatform?: Vehicle["oemPlatform"];
  nominalCapacityAh?: number | null;
  commissionedOn?: string | null;
}

export interface FleetStore {
  mode: "demo" | "live";
  getPolicy(): Promise<FleetPolicy>;
  updatePolicy(patch: Partial<FleetPolicy>): Promise<FleetPolicy>;
  listVehicles(): Promise<Vehicle[]>;
  getVehicle(id: string): Promise<Vehicle | null>;
  addVehicle(input: AddVehicleInput): Promise<Vehicle>;
  listDevices(): Promise<GpsDevice[]>;
  registerDevice(serial?: string): Promise<GpsDevice>;
  unpairDevice(deviceId: string): Promise<GpsDevice | null>;
  listMaintenance(): Promise<MaintenanceItem[]>;
  addMaintenance(item: Omit<MaintenanceItem, "id" | "createdAt" | "status">): Promise<MaintenanceItem>;
  updateMaintenanceStatus(id: string, status: MaintenanceItem["status"]): Promise<MaintenanceItem | null>;
  commandCenterSummary(): Promise<CommandCenterPayload>;
  batteryHealth(): Promise<BatteryHealthPoint[]>;
  lifecycle(): Promise<AssetLifecycleStage[]>;
  drivers(): Promise<DriverClassification[]>;
  portfolioValuation(): Promise<PortfolioValuationPayload>;
  getCanonicalLive(id: string): Promise<CanLivePayload | null>;
  getGpsHistory(id: string, opts?: { max?: number; from?: string; to?: string }): Promise<GpsHistoryPayload | null>;
  getCellSnapshot(id: string): Promise<CellSnapshotPayload | null>;
  listTrips(): Promise<TripLedgerRow[]>;
  getGpsMetrics(id: string): Promise<GpsMetrics | null>;
  getDailyDistance(id: string): Promise<DailyDistancePoint[] | null>;
  getTripDetail(id: string): Promise<TripLedgerRow | null>;
}
