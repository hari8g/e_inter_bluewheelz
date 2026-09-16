/**
 * Master file → canonical map.
 *
 * Every column in Database/*.csv and Database/Bluwheelz report.xlsx lands on
 * exactly one canonical signal. Downstream UI never sees "Device Battery" or
 * "Startfl" — only these IDs.
 */
import type { CanonicalSignalId } from "./canonical.js";

export type FileKind = "gps_csv" | "trip_xlsx";

export interface FileCanonicalBinding {
  file: FileKind;
  source: string;
  canonical: CanonicalSignalId;
  note?: string;
  /** When set, the same source column also aliases onto a CAN-era KPI id. */
  aliases?: CanonicalSignalId[];
}

export const FILE_CANONICAL_MAP: readonly FileCanonicalBinding[] = [
  { file: "gps_csv", source: "Speed", canonical: "gps.speed_kph", aliases: ["veh.speed_kph"] },
  { file: "gps_csv", source: "Device Battery", canonical: "gps.device_battery_v" },
  { file: "gps_csv", source: "Car Battery", canonical: "gps.aux_battery_v" },
  { file: "gps_csv", source: "Ignition", canonical: "gps.ignition" },
  { file: "gps_csv", source: "Address.lat", canonical: "gps.lat" },
  { file: "gps_csv", source: "Address.lng", canonical: "gps.lng" },

  { file: "trip_xlsx", source: "Distance", canonical: "trip.distance_km", aliases: ["veh.trip_distance_km"] },
  { file: "trip_xlsx", source: "Duration (in min)", canonical: "trip.duration_min" },
  { file: "trip_xlsx", source: "Avg Speed", canonical: "trip.avg_speed_kph" },
  { file: "trip_xlsx", source: "Fuel Used", canonical: "trip.energy_used", note: "Workbook units as delivered; not assumed kWh." },
  { file: "trip_xlsx", source: "Mileage", canonical: "trip.efficiency" },
  { file: "trip_xlsx", source: "Idling Time", canonical: "trip.idle_min" },
  { file: "trip_xlsx", source: "AC Idling Time", canonical: "trip.ac_idle_min" },
  { file: "trip_xlsx", source: "Startodo", canonical: "trip.start_odo_km" },
  { file: "trip_xlsx", source: "Endodo", canonical: "trip.end_odo_km", aliases: ["veh.odometer_km"] },
  { file: "trip_xlsx", source: "Trip Score", canonical: "trip.score" },
  { file: "trip_xlsx", source: "latLngSArr.lat", canonical: "trip.start_lat" },
  { file: "trip_xlsx", source: "latLngSArr.lng", canonical: "trip.start_lng" },
  { file: "trip_xlsx", source: "latLngEArr.lat", canonical: "trip.end_lat" },
  { file: "trip_xlsx", source: "latLngEArr.lng", canonical: "trip.end_lng" },
  { file: "trip_xlsx", source: "Fuel Type", canonical: "trip.fuel_type" },
  { file: "trip_xlsx", source: "Startfl", canonical: "trip.start_soc_pct" },
  { file: "trip_xlsx", source: "Endfl", canonical: "trip.end_soc_pct", aliases: ["batt.soc_pct"] },
  { file: "trip_xlsx", source: "Startdte", canonical: "trip.start_dte_km" },
  { file: "trip_xlsx", source: "Enddte", canonical: "trip.end_dte_km", aliases: ["batt.dte_km"] },
  { file: "trip_xlsx", source: "Charging Time", canonical: "trip.charging_min" },
] as const;
