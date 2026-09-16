import { Fragment, useMemo } from "react";
import { Circle, CircleMarker, MapContainer, Polyline, Popup, TileLayer, Tooltip } from "react-leaflet";
import type { FleetPolicy, GpsStop, Vehicle } from "@/types/api";
import "leaflet/dist/leaflet.css";

export const BENGALURU_GEOFENCES = [
  { id: "hosur_road", label: "Hosur Road / Electronic City", lat: 12.8423, lng: 77.6831, radiusKm: 1.2 },
  { id: "whitefield", label: "Whitefield", lat: 12.9309, lng: 77.7452, radiusKm: 1.2 },
  { id: "peenya", label: "West Bengaluru / Peenya", lat: 12.9343, lng: 77.4841, radiusKm: 1.5 },
  { id: "south_depot", label: "South depot cluster", lat: 12.784, lng: 77.7, radiusKm: 1.2 },
] as const;

function staleMinutes(lastFixAt: string, thresholdMin: number) {
  const diff = Date.now() - new Date(lastFixAt).getTime();
  return diff > thresholdMin * 60 * 1000;
}

export function modelColor(model: string): string {
  const m = model.toLowerCase();
  if (m.includes("ace")) return "#136a62";
  if (m.includes("zor")) return "#7c3aed";
  if (m.includes("pro")) return "#2563eb";
  return "#0f766e";
}

export function FleetMap({
  vehicles,
  policy,
  playback,
  stops,
}: {
  vehicles: Vehicle[];
  policy: FleetPolicy;
  playback?: { vehicleId: string; points: { lat: number; lng: number; t: string }[]; index: number };
  stops?: GpsStop[];
}) {
  const markers = useMemo(() => vehicles, [vehicles]);
  const center = useMemo<[number, number]>(() => {
    if (playback?.points.length) {
      const p = playback.points[Math.min(playback.index, playback.points.length - 1)]!;
      return [p.lat, p.lng];
    }
    if (!vehicles.length) return [12.95, 77.62];
    const lat = vehicles.reduce((s, v) => s + v.position.lat, 0) / vehicles.length;
    const lng = vehicles.reduce((s, v) => s + v.position.lng, 0) / vehicles.length;
    return [lat, lng];
  }, [vehicles, playback]);

  return (
    <div className="h-[420px] w-full overflow-hidden rounded-xl border border-line shadow-card sm:h-[520px]">
      <MapContainer center={center} zoom={11} className="h-full w-full" scrollWheelZoom>
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OSM</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {policy.geofenceBreachAlerts
          ? BENGALURU_GEOFENCES.map((g) => (
              <Circle
                key={g.id}
                center={[g.lat, g.lng]}
                radius={g.radiusKm * 1000}
                pathOptions={{ color: "#0f766e", weight: 1, fillOpacity: 0.06 }}
              >
                <Tooltip>{g.label}</Tooltip>
              </Circle>
            ))
          : null}
        {stops?.map((s, i) => (
          <CircleMarker
            key={`stop-${i}`}
            center={[s.lat, s.lng]}
            radius={6}
            pathOptions={{ color: "#b45309", weight: 1, fillColor: "#f59e0b", fillOpacity: 0.7 }}
          >
            <Tooltip>
              Stop {Math.round(s.dwellMin)} min
              <br />
              {s.startedAt.slice(11, 16)}–{s.endedAt.slice(11, 16)}
            </Tooltip>
          </CircleMarker>
        ))}
        {markers.map((v) => {
          const isCharging = v.status === "charging";
          const isStale = policy.highlightStaleGps && staleMinutes(v.position.lastFixAt, policy.stalePositionMinutes);
          const color = isCharging ? "#7c3aed" : isStale ? "#f59e0b" : modelColor(v.model);
          const path =
            playback && playback.vehicleId === v.id
              ? playback.points.slice(0, Math.max(2, playback.index + 1)).map((p) => [p.lat, p.lng] as [number, number])
              : (v.track ?? []).map((p) => [p.lat, p.lng] as [number, number]);
          const playPt =
            playback && playback.vehicleId === v.id
              ? playback.points[Math.min(playback.index, playback.points.length - 1)]
              : null;
          const mismatch =
            policy.highlightGpsReportMismatch &&
            v.gpsMetrics?.distanceDeltaKm != null &&
            Math.abs(v.gpsMetrics.distanceDeltaKm) > 40;
          const lowDevice =
            policy.deviceBatteryAlertVolts != null &&
            v.gps?.deviceBatteryV != null &&
            v.gps.deviceBatteryV < policy.deviceBatteryAlertVolts;
          return (
            <Fragment key={v.id}>
              {path.length > 1 ? (
                <Polyline positions={path} pathOptions={{ color, weight: 3, opacity: 0.55 }} />
              ) : null}
              {v.trip?.startLat != null && v.trip.startLng != null ? (
                <CircleMarker
                  center={[v.trip.startLat, v.trip.startLng]}
                  radius={7}
                  pathOptions={{ color, weight: 2, fillColor: "#ffffff", fillOpacity: 1 }}
                >
                  <Tooltip>Start {v.registration}</Tooltip>
                </CircleMarker>
              ) : null}
              {v.trip?.endLat != null && v.trip.endLng != null ? (
                <CircleMarker
                  center={[v.trip.endLat, v.trip.endLng]}
                  radius={7}
                  pathOptions={{ color: "#ffffff", weight: 2, fillColor: color, fillOpacity: 0.95 }}
                >
                  <Tooltip>End {v.registration}</Tooltip>
                </CircleMarker>
              ) : null}
              <CircleMarker
                center={playPt ? [playPt.lat, playPt.lng] : [v.position.lat, v.position.lng]}
                radius={11}
                pathOptions={{
                  color: "#ffffff",
                  weight: 2,
                  fillColor: color,
                  fillOpacity: 0.95,
                }}
              >
                <Tooltip direction="top" offset={[0, -6]} opacity={1} permanent={false}>
                  <div className="text-xs font-semibold">{v.registration}</div>
                  <div className="text-[11px] text-gray-600">{v.model}</div>
                </Tooltip>
                <Popup>
                  <div className="space-y-1 text-sm">
                    <div className="font-semibold">{v.registration}</div>
                    <div className="text-gray-600">{v.model}</div>
                    {v.gps ? (
                      <div className="text-xs text-gray-600">
                        {v.gps.speedKph ?? "—"} km/h · ign {v.gps.ignition ? "On" : "Off"}
                        <br />
                        Device {v.gps.deviceBatteryV ?? "—"} V · 12V {v.gps.auxBatteryV ?? "—"} V
                        {lowDevice ? " · device low" : ""}
                      </div>
                    ) : null}
                    <div className="text-xs text-gray-600">
                      Path {v.gpsMetrics?.pathKm ?? "—"} km vs report {v.gpsMetrics?.reportKm ?? v.trip?.distanceKm ?? "—"} km
                      {mismatch ? " · mismatch" : ""}
                    </div>
                    <div className="text-xs text-gray-600">Trip score {v.gpsMetrics?.tripScore ?? v.trip?.score ?? "—"}</div>
                    {playPt ? <div className="text-xs text-gray-500">{playPt.t.replace("T", " ").slice(0, 19)}</div> : null}
                  </div>
                </Popup>
              </CircleMarker>
            </Fragment>
          );
        })}
      </MapContainer>
    </div>
  );
}
