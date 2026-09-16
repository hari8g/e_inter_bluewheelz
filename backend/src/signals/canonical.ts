/**
 * Canonical signal vocabulary.
 *
 * Intellicar delivers OEM-specific CAN parameter names ("Maximum Cell Voltage",
 * `max_cell_voltage`). Nothing downstream of the normalizer should ever see one.
 * Every signal is mapped into the IDs below, which are stable across platforms.
 *
 * Source: Intellicar CAN Parameter Validation Report, Bosch, 2026-09-03.
 */

export type OemPlatform = "mahindra_zeo" | "tata_ace_ev" | "switch_ev" | "eicher_ev";

export const OEM_PLATFORMS: readonly OemPlatform[] = [
  "mahindra_zeo",
  "tata_ace_ev",
  "switch_ev",
  "eicher_ev",
] as const;

export type AssetClass = "e2w" | "e3w" | "micro_4w" | "scv" | "lcv" | "bus" | "hcv";

/** Whether a platform exposes a signal at all, and whether Intellicar has validated it. */
export type SignalAvailability = "validated" | "pending" | "unavailable";

/**
 * Per-observation quality. `unavailable` = platform does not expose it.
 * `pending_validation` = Intellicar is still validating the decode; stored but never
 * allowed to feed a customer-facing KPI.
 */
export type SignalQuality =
  | "ok"
  | "stale"
  | "out_of_range"
  | "unavailable"
  | "pending_validation"
  | "incomplete";

export const CANONICAL_SIGNALS = [
  // vehicle & drive
  "veh.odometer_km",
  "veh.speed_kph",
  "veh.gear_state",
  "veh.trip_distance_km",
  "veh.road_speed_limit_status",
  // battery & BMS
  "batt.soc_pct",
  "batt.dte_km",
  "batt.cell_voltage_v",
  "batt.cell_temp_c",
  "batt.cell_v_max",
  "batt.cell_v_min",
  "batt.cell_temp_max_c",
  "batt.cell_temp_min_c",
  "batt.pack_voltage_v",
  "batt.pack_voltage_aux_v",
  "batt.pack_current_a",
  "batt.cell_delta_mv",
  "batt.pack_power_kw",
  // charging
  "chg.status",
  "chg.time_to_charge_min",
  // driver inputs
  "drv.accel_pedal_pct",
  "drv.brake_pedal",
  "drv.parking_brake",
  "drv.accel_low_idle_switch_1",
  "drv.accel_low_idle_switch_2",
  "drv.accel_kickdown",
  // driver behaviour — harsh events
  "drv.harsh_brake_count",
  "drv.harsh_brake_interval_s",
  "drv.harsh_brake_mean_mps2",
  "drv.harsh_brake_peak_mps2",
  "drv.harsh_accel_count",
  "drv.harsh_accel_interval_s",
  "drv.harsh_accel_mean_mps2",
  "drv.harsh_accel_peak_mps2",
  // body
  "body.headlight_low",
  "body.headlight_high",
  "body.indicator_left",
  "body.indicator_right",
  // drive modes
  "mode.eco",
  "mode.power",
  // GPS file (BluWheelz / Intellicar GPS CSV)
  "gps.lat",
  "gps.lng",
  "gps.speed_kph",
  "gps.device_battery_v",
  "gps.aux_battery_v",
  "gps.ignition",
  // trip report (BluWheelz workbook)
  "trip.distance_km",
  "trip.duration_min",
  "trip.avg_speed_kph",
  "trip.energy_used",
  "trip.efficiency",
  "trip.idle_min",
  "trip.ac_idle_min",
  "trip.start_odo_km",
  "trip.end_odo_km",
  "trip.score",
  "trip.start_lat",
  "trip.start_lng",
  "trip.end_lat",
  "trip.end_lng",
  "trip.fuel_type",
  "trip.start_soc_pct",
  "trip.end_soc_pct",
  "trip.start_dte_km",
  "trip.end_dte_km",
  "trip.charging_min",
] as const;

export type CanonicalSignalId = (typeof CANONICAL_SIGNALS)[number];

const SIGNAL_SET: ReadonlySet<string> = new Set(CANONICAL_SIGNALS);

export function isCanonicalSignal(id: string): id is CanonicalSignalId {
  return SIGNAL_SET.has(id);
}

export type SignalDomain = "veh" | "batt" | "chg" | "drv" | "body" | "mode" | "gps" | "trip";

export function domainOf(id: CanonicalSignalId): SignalDomain {
  return id.split(".")[0] as SignalDomain;
}

export const DOMAIN_LABELS: Record<SignalDomain, string> = {
  veh: "Vehicle & drive",
  batt: "Battery & BMS",
  chg: "Charging",
  drv: "Driver",
  body: "Body",
  mode: "Drive modes",
  gps: "GPS trace",
  trip: "Trip report",
};

export const SIGNAL_UNITS: Record<CanonicalSignalId, string> = {
  "veh.odometer_km": "km",
  "veh.speed_kph": "km/h",
  "veh.gear_state": "",
  "veh.trip_distance_km": "km",
  "veh.road_speed_limit_status": "",
  "batt.soc_pct": "%",
  "batt.dte_km": "km",
  "batt.cell_voltage_v": "V",
  "batt.cell_temp_c": "°C",
  "batt.cell_v_max": "V",
  "batt.cell_v_min": "V",
  "batt.cell_temp_max_c": "°C",
  "batt.cell_temp_min_c": "°C",
  "batt.pack_voltage_v": "V",
  "batt.pack_voltage_aux_v": "V",
  "batt.pack_current_a": "A",
  "batt.cell_delta_mv": "mV",
  "batt.pack_power_kw": "kW",
  "chg.status": "",
  "chg.time_to_charge_min": "min",
  "drv.accel_pedal_pct": "%",
  "drv.brake_pedal": "",
  "drv.parking_brake": "",
  "drv.accel_low_idle_switch_1": "",
  "drv.accel_low_idle_switch_2": "",
  "drv.accel_kickdown": "",
  "drv.harsh_brake_count": "count",
  "drv.harsh_brake_interval_s": "s",
  "drv.harsh_brake_mean_mps2": "m/s²",
  "drv.harsh_brake_peak_mps2": "m/s²",
  "drv.harsh_accel_count": "count",
  "drv.harsh_accel_interval_s": "s",
  "drv.harsh_accel_mean_mps2": "m/s²",
  "drv.harsh_accel_peak_mps2": "m/s²",
  "body.headlight_low": "",
  "body.headlight_high": "",
  "body.indicator_left": "",
  "body.indicator_right": "",
  "mode.eco": "",
  "mode.power": "",
  "gps.lat": "°",
  "gps.lng": "°",
  "gps.speed_kph": "km/h",
  "gps.device_battery_v": "V",
  "gps.aux_battery_v": "V",
  "gps.ignition": "",
  "trip.distance_km": "km",
  "trip.duration_min": "min",
  "trip.avg_speed_kph": "km/h",
  "trip.energy_used": "",
  "trip.efficiency": "",
  "trip.idle_min": "min",
  "trip.ac_idle_min": "min",
  "trip.start_odo_km": "km",
  "trip.end_odo_km": "km",
  "trip.score": "",
  "trip.start_lat": "°",
  "trip.start_lng": "°",
  "trip.end_lat": "°",
  "trip.end_lng": "°",
  "trip.fuel_type": "",
  "trip.start_soc_pct": "%",
  "trip.end_soc_pct": "%",
  "trip.start_dte_km": "km",
  "trip.end_dte_km": "km",
  "trip.charging_min": "min",
};

export const SIGNAL_LABELS: Record<CanonicalSignalId, string> = {
  "veh.odometer_km": "Odometer",
  "veh.speed_kph": "Vehicle speed",
  "veh.gear_state": "Gear state",
  "veh.trip_distance_km": "Trip distance",
  "veh.road_speed_limit_status": "Road speed limit status",
  "batt.soc_pct": "State of charge",
  "batt.dte_km": "Distance to empty",
  "batt.cell_voltage_v": "Cell voltages",
  "batt.cell_temp_c": "Cell temperatures",
  "batt.cell_v_max": "Maximum cell voltage",
  "batt.cell_v_min": "Minimum cell voltage",
  "batt.cell_temp_max_c": "Maximum cell temperature",
  "batt.cell_temp_min_c": "Minimum cell temperature",
  "batt.pack_voltage_v": "Pack voltage (HV)",
  "batt.pack_voltage_aux_v": "Pack voltage (aux)",
  "batt.pack_current_a": "Pack current",
  "batt.cell_delta_mv": "Cell imbalance (Δcell)",
  "batt.pack_power_kw": "Pack power",
  "chg.status": "Charging status",
  "chg.time_to_charge_min": "Time to charge",
  "drv.accel_pedal_pct": "Accelerator pedal",
  "drv.brake_pedal": "Brake pedal",
  "drv.parking_brake": "Parking brake",
  "drv.accel_low_idle_switch_1": "Accel pedal 1 low-idle switch",
  "drv.accel_low_idle_switch_2": "Accel pedal 2 low-idle switch",
  "drv.accel_kickdown": "Accel pedal kickdown",
  "drv.harsh_brake_count": "Harsh braking events",
  "drv.harsh_brake_interval_s": "Harsh braking interval",
  "drv.harsh_brake_mean_mps2": "Harsh braking mean",
  "drv.harsh_brake_peak_mps2": "Harsh braking peak",
  "drv.harsh_accel_count": "Harsh acceleration events",
  "drv.harsh_accel_interval_s": "Harsh acceleration interval",
  "drv.harsh_accel_mean_mps2": "Harsh acceleration mean",
  "drv.harsh_accel_peak_mps2": "Harsh acceleration peak",
  "body.headlight_low": "Headlight (low beam)",
  "body.headlight_high": "Headlight (high beam)",
  "body.indicator_left": "Indicator (left)",
  "body.indicator_right": "Indicator (right)",
  "mode.eco": "Eco mode",
  "mode.power": "Power mode",
  "gps.lat": "Latitude",
  "gps.lng": "Longitude",
  "gps.speed_kph": "GPS speed",
  "gps.device_battery_v": "Device battery",
  "gps.aux_battery_v": "Vehicle 12V battery",
  "gps.ignition": "Ignition",
  "trip.distance_km": "Trip distance (report)",
  "trip.duration_min": "Trip duration",
  "trip.avg_speed_kph": "Average speed",
  "trip.energy_used": "Energy / fuel used (report)",
  "trip.efficiency": "Reported efficiency",
  "trip.idle_min": "Idling time",
  "trip.ac_idle_min": "AC idling time",
  "trip.start_odo_km": "Trip start odometer",
  "trip.end_odo_km": "Trip end odometer",
  "trip.score": "Trip score",
  "trip.start_lat": "Trip start latitude",
  "trip.start_lng": "Trip start longitude",
  "trip.end_lat": "Trip end latitude",
  "trip.end_lng": "Trip end longitude",
  "trip.fuel_type": "Fuel type",
  "trip.start_soc_pct": "Trip start SOC",
  "trip.end_soc_pct": "Trip end SOC",
  "trip.start_dte_km": "Trip start DTE",
  "trip.end_dte_km": "Trip end DTE",
  "trip.charging_min": "Charging time",
};
