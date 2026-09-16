export type TelemetryMode = "gps_only" | "can_gps";

export type VehicleStatus = "active" | "charging" | "idle" | "offline";

export type OemPlatform = "mahindra_zeo" | "tata_ace_ev" | "switch_ev" | "eicher_ev";

export type SohMethod = "coulomb_counted" | "ocv_incremental" | "unavailable" | "demo";

export type DriverEventSource = "can_measured" | "derived_speed" | "unavailable" | "demo";

export interface Position {
  lat: number;
  lng: number;
  lastFixAt: string;
}

export interface CanSnapshot {
  motorTempC: number | null;
  packVoltageV: number | null;
  minCellV: number | null;
  maxCellV: number | null;
  bmsHealthScore: number | null;
  cellDeltaMv?: number | null;
  capturedAt: string;
}

export interface GpsSnapshot {
  speedKph: number | null;
  deviceBatteryV: number | null;
  auxBatteryV: number | null;
  ignition: boolean | null;
  capturedAt: string;
}

export interface TripSnapshot {
  distanceKm: number | null;
  durationMin: number | null;
  avgSpeedKph: number | null;
  startSocPct: number | null;
  endSocPct: number | null;
  startOdoKm: number | null;
  endOdoKm: number | null;
  energyUsed: number | null;
  efficiency: number | null;
  idleMin: number | null;
  acIdleMin: number | null;
  score: number | null;
  chargingMin: number | null;
  startDteKm: number | null;
  endDteKm: number | null;
  startLat: number | null;
  startLng: number | null;
  endLat: number | null;
  endLng: number | null;
  startAt: string | null;
  endAt: string | null;
  fuelType: string | null;
  operator: string | null;
  model: string | null;
}

export interface TripLedgerRow {
  vehicleId: string;
  registration: string;
  model: string;
  operator: string;
  startAt: string | null;
  endAt: string | null;
  distanceKm: number | null;
  durationMin: number | null;
  avgSpeedKph: number | null;
  startSocPct: number | null;
  endSocPct: number | null;
  startOdoKm: number | null;
  endOdoKm: number | null;
  energyUsed: number | null;
  gpsDistanceKm: number | null;
  efficiency: number | null;
  idleMin: number | null;
  acIdleMin: number | null;
  score: number | null;
  chargingMin: number | null;
  startDteKm: number | null;
  endDteKm: number | null;
  startLat: number | null;
  startLng: number | null;
  endLat: number | null;
  endLng: number | null;
  fuelType: string | null;
  distanceDeltaKm: number | null;
}

export interface GpsStop {
  startedAt: string;
  endedAt: string;
  dwellMin: number;
  lat: number;
  lng: number;
}

export interface DailyDistancePoint {
  day: string;
  km: number;
  ignOnPct: number;
  maxSpeedKph: number;
  harshTotal: number;
}

export interface GpsMetrics {
  vehicleId: string;
  registration: string;
  pathKm: number;
  reportKm: number | null;
  distanceDeltaKm: number | null;
  maxSpeedKph: number;
  ignOnPct: number;
  movingPct: number;
  idleGpsMin: number;
  stopCount: number;
  harshAccel: number;
  harshBrake: number;
  peakAccelMps2: number;
  peakBrakeMps2: number;
  medianGapSec: number | null;
  coveragePct: number;
  firstFixAt: string | null;
  lastFixAt: string | null;
  pointCount: number;
  deviceBatteryV: number | null;
  auxBatteryV: number | null;
  deviceMinV: number | null;
  deviceMaxV: number | null;
  auxMinV: number | null;
  auxMaxV: number | null;
  lowDeviceV: boolean;
  lowAuxV: boolean;
  geofences: string[];
  stops: GpsStop[];
}

export interface GpsMetricsLite {
  pathKm: number;
  reportKm: number | null;
  distanceDeltaKm: number | null;
  maxSpeedKph: number;
  ignOnPct: number;
  tripScore: number | null;
  stopCount: number;
  idleGpsMin: number;
}

export interface Vehicle {
  id: string;
  registration: string;
  displayName: string;
  model: string;
  telemetryMode: TelemetryMode;
  allowImmobilise: boolean;
  kwhPack: number;
  odometerKm: number;
  socPercent: number;
  status: VehicleStatus;
  locationLabel: string;
  position: Position;
  deviceId: string | null;
  can?: CanSnapshot;
  oemPlatform?: OemPlatform;
  assetClass?: string;
  commissionedOn?: string | null;
  nominalCapacityAh?: number | null;
  expectedUplinkSec?: number;
  signalProfileId?: string;
  sohMethod?: SohMethod;
  joinGapSeconds?: number | null;
  coverage24hPct?: number | null;
  gps?: GpsSnapshot;
  trip?: TripSnapshot;
  track?: { lat: number; lng: number }[];
  gpsMetrics?: GpsMetricsLite;
}

export interface GpsDevice {
  id: string;
  serial: string;
  firmware: string;
  type: "GPS" | "CAN_GATEWAY";
  lastSeenAt: string;
  pairedVehicleId: string | null;
  pointCount?: number;
  firstFixAt?: string | null;
  lastDeviceBatteryV?: number | null;
  lastAuxBatteryV?: number | null;
}

export type MaintenanceStatus = "open" | "in_progress" | "done";

export interface MaintenanceItem {
  id: string;
  vehicleId: string;
  workType: string;
  title: string;
  dueDate: string;
  odometerAtDueKm: number | null;
  vendor: string | null;
  notes: string;
  status: MaintenanceStatus;
  createdAt: string;
}

export interface CommandCenterPayload {
  mode: "demo" | "live";
  fleetTotal: number;
  reporting: number;
  noLink: number;
  distanceTodayKm: number;
  avgSocPercent: number;
  estRangePoolKm: number;
  energyLedgerKwh: number;
  policy: FleetPolicy;
  vehicles: Vehicle[];
  trips?: TripLedgerRow[];
  dataSource?: string;
  reportDistanceKm?: number;
  avgSocSampleCount?: number;
  rangePoolAvailable?: boolean;
}

export interface FleetPolicy {
  showMap: boolean;
  showSocStrip: boolean;
  showImmobilise: boolean;
  highlightLowSoc: boolean;
  showAssetStrip: boolean;
  showTripLedger: boolean;
  highlightStaleGps: boolean;
  gpsUplinkTargetSeconds: number;
  stalePositionMinutes: number;
  lowSocAlertPercent: number;
  geofenceBreachAlerts: boolean;
  deviceBatteryAlertVolts: number;
  highlightGpsReportMismatch: boolean;
}

/** Higher = more electrical stress on cells (not SOH %). */
export interface BatteryHeuristics {
  cellImbalanceSeverity0to100: number;
  cycleLoadIndex0to100: number;
  packCalendarAgeIndex0to100: number;
  thermalStress0to100: number | null;
  bmsObservationQuality0to100: number | null;
  depthOfDischargeStress0to100: number;
  /** Composite 0–100 (higher = healthier pack in this model). */
  modelHealthScore0to100: number;
  rationale: string[];
}

/** Attributed shares of past fade + forward-looking loss (for visuals); shares sum ~100. */
export interface BatteryDeteriorationBreakdownPct {
  calendarAgeing: number;
  cyclicElectrical: number;
  cellImbalance: number;
  thermalElectrical: number;
}

export interface BatteryDeterioration {
  past12mSohLossPct: number;
  projectedNext12mLossPct: number;
  impliedHistoricalFadePctPerMonth: number;
  impliedForecastFadePctPerMonth: number;
  breakdownPastFade: BatteryDeteriorationBreakdownPct;
}

export interface BatteryHealthPoint {
  vehicleId: string;
  registration: string;
  sohPercent: number | null;
  sohMethod: SohMethod;
  tripStartSocPct?: number | null;
  tripEndSocPct?: number | null;
  tripEnergyUsed?: number | null;
  tripEfficiency?: number | null;
  tripChargingMin?: number | null;
  tripStartDteKm?: number | null;
  tripEndDteKm?: number | null;
  gpsDistanceKm?: number | null;
  kmPerSocPoint?: number | null;
  deviceMinV?: number | null;
  deviceMaxV?: number | null;
  auxMinV?: number | null;
  auxMaxV?: number | null;
  cycleEstimate: number | null;
  imbalanceMv: number | null;
  lastEstimateAt?: string | null;
  trend: "improving" | "stable" | "degrading";
  sohHistory: { period: string; soh: number }[];
  sohForecast: { period: string; soh: number }[];
  heuristics: BatteryHeuristics;
  deterioration: BatteryDeterioration;
  prognosis: {
    thresholdSoh: number;
    monthsToThreshold: number | null;
    sohProjected12m: number;
    confidence: "high" | "medium" | "low";
    summary: string;
    imbalanceRisk: "normal" | "watch" | "elevated";
  };
}

export interface AssetLifecycleHeuristics {
  telemetryMode: "gps_only" | "can_gps";
  canObservability: "full" | "partial" | "gps_only";
  kmToNextMajorService: number;
  dutyCycleIndex: number;
  thermalStressIndex: number | null;
  depthOfDischargeScore: number;
  calendarAgeMonths: number;
  reliabilityIndex: number;
  warrantyClockMonthsRemaining: number | null;
  dataConfidence: "high" | "medium" | "low";
  flags: string[];
}

export type PortfolioValueBand = "strong" | "normal" | "soft" | "stressed";

export interface PortfolioValuationItem {
  vehicleId: string;
  registration: string;
  displayName: string;
  model: string;
  telemetryMode: TelemetryMode;
  odometerKm: number;
  sohPercent: number | null;
  sohObservable: boolean;
  valuationConfidence: "high" | "medium" | "low";
  /** Demo comparable “new” price in INR (not an invoice). */
  indicativeListPriceInr: number;
  /** Model-estimated fair market value today (INR). */
  fairMarketValueInr: number;
  /** Lease-style residual / end-of-term value at assumed tenor (INR). */
  residualValueInr: number;
  valueBand: PortfolioValueBand;
  notes: string[];
}

export interface PortfolioValuationEnterprise {
  vehicleCount: number;
  totalIndicativeListInr: number;
  totalFairMarketValueInr: number;
  totalResidualValueInr: number;
  avgSohPercent: number | null;
  /** Share of portfolio FMV in lifecycle watch or retire_candidate (0–1). */
  portfolioRiskShare: number;
}

export interface PortfolioValuationPayload {
  updatedAt: string;
  currency: "INR";
  disclaimer: string;
  assumedLeaseMonths: number;
  enterprise: PortfolioValuationEnterprise;
  items: PortfolioValuationItem[];
}

export interface AssetLifecycleStage {
  vehicleId: string;
  registration: string;
  stage: "ramp" | "steady" | "watch" | "retire_candidate";
  utilizationScore: number;
  projectedMajorServiceKm: number;
  odometerKm: number;
  notes: string;
  wearSeries: { km: number; wearIndex: number }[];
  heuristics: AssetLifecycleHeuristics;
  /** Plain-language readout for control-room / workshop operators. */
  operatorSummary: string;
  operatorFindings: string[];
  operatorActions: string[];
  prognosis: {
    remainingUsefulLifeKm: number;
    majorServiceWindowKm: [number, number];
    summary: string;
    nextDecisionGate: string;
    nextMajorServiceDueIso: string;
    nextMajorServiceDueLabel: string;
    estimatedMonthsToMajorService: number;
  };
}

export interface DriverSeed {
  driverId: string;
  label: string;
  safetyScore: number;
  energyEfficiencyPercentile: number;
  harshEvents7d: number;
  band: "A" | "B" | "C";
}

export interface DriverClassification extends DriverSeed {
  eventSource: DriverEventSource;
  vehicleId?: string;
  tripScore?: number | null;
  idleRatio?: number | null;
  profile: {
    smoothness: number;
    ecoDrive: number;
    compliance: number;
    fatigueRisk: number;
  };
  safetyHistory: { week: string; score: number }[];
  prognosis: {
    summary: string;
    projectedBand90d: "A" | "B" | "C";
    priority: "maintain" | "coach" | "intervene";
    reviewBy: string;
  };
}

export interface CanLiveSignal {
  id: string;
  label: string;
  unit: string;
  domain: string;
  domainLabel: string;
  value: unknown;
  quality: string;
}

export interface CanLivePayload {
  vehicleId: string;
  registration: string;
  capturedAt: string | null;
  freshnessSeconds: number | null;
  signals: CanLiveSignal[];
  position: { lat: number | null; lng: number | null; gpsSpeedKph: number | null; joinGapSeconds: number | null } | null;
  observability: {
    oemPlatform: OemPlatform | "file_gps";
    signalProfileId: string;
    availableSignals: string[];
    pendingSignals: string[];
    unavailableSignals: string[];
    lastFrameAt: string | null;
    coverage24hPct: number;
  };
  trip?: TripSnapshot | null;
}

export interface GpsHistoryPoint {
  t: string;
  lat: number;
  lng: number;
  speedKph: number;
  deviceBatteryV: number | null;
  auxBatteryV: number | null;
  ignition: boolean;
}

export interface GpsHistoryPayload {
  vehicleId: string;
  registration: string;
  from: string;
  to: string;
  count: number;
  points: GpsHistoryPoint[];
}

export interface CellSnapshotPayload {
  vehicleId: string;
  available: boolean;
  reason?: string;
  capturedAt?: string;
  cellCount?: number;
  tempSensorCount?: number;
  cellVoltagesV: number[];
  cellTempsC: number[];
  cellVMaxV?: number;
  cellVMinV?: number;
  cellDeltaMv?: number;
  cellTempMaxC?: number | null;
  cellTempMinC?: number | null;
}
