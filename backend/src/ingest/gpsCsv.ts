import { readFileSync } from "node:fs";

export interface GpsCsvRow {
  capturedAt: Date;
  speedKph: number;
  deviceBatteryV: number | null;
  auxBatteryV: number | null;
  ignition: boolean;
  lat: number;
  lng: number;
}

const MONTHS: Record<string, number> = {
  Jan: 0, Feb: 1, Mar: 2, Apr: 3, May: 4, Jun: 5,
  Jul: 6, Aug: 7, Sep: 8, Oct: 9, Nov: 10, Dec: 11,
};

export function parseGpsTimestamp(raw: string): Date | null {
  const m = raw.trim().match(/^(\d{2})-([A-Za-z]{3})-(\d{4})\s+(\d{2}):(\d{2}):(\d{2})$/);
  if (!m) return null;
  const month = MONTHS[m[2]!];
  if (month == null) return null;
  return new Date(Date.UTC(Number(m[3]), month, Number(m[1]), Number(m[4]), Number(m[5]), Number(m[6])));
}

function splitCsvLine(line: string): string[] {
  const parts: string[] = [];
  let cur = "";
  let inq = false;
  for (const ch of line) {
    if (ch === '"') {
      inq = !inq;
      continue;
    }
    if (ch === "," && !inq) {
      parts.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  parts.push(cur.trim());
  return parts;
}

function num(v: string | undefined): number | null {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function parseGpsCsv(text: string): GpsCsvRow[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]!).map((h) => h.replace(/^"|"$/g, ""));
  const idx = (name: string) => header.findIndex((h) => h.toLowerCase() === name.toLowerCase());
  const iTime = idx("Time");
  const iSpeed = idx("Speed");
  const iDev = idx("Device Battery");
  const iCar = idx("Car Battery");
  const iIgn = idx("Ignition");
  const iAddr = idx("Address");
  const out: GpsCsvRow[] = [];
  for (const line of lines.slice(1)) {
    const cols = splitCsvLine(line);
    const capturedAt = parseGpsTimestamp((cols[iTime] ?? "").replace(/^"|"$/g, ""));
    const addr = (cols[iAddr] ?? "").replace(/^"|"$/g, "");
    const [latS, lngS] = addr.split(",");
    const lat = Number(latS);
    const lng = Number(lngS);
    if (!capturedAt || !Number.isFinite(lat) || !Number.isFinite(lng)) continue;
    if (lat < -90 || lat > 90 || lng < -180 || lng > 180) continue;
    const speed = num(cols[iSpeed]) ?? 0;
    const ignRaw = (cols[iIgn] ?? "").replace(/^"|"$/g, "").toLowerCase();
    out.push({
      capturedAt,
      speedKph: speed,
      deviceBatteryV: num(cols[iDev]),
      auxBatteryV: num(cols[iCar]),
      ignition: ignRaw === "on" || ignRaw === "1" || ignRaw === "true",
      lat,
      lng,
    });
  }
  out.sort((a, b) => a.capturedAt.getTime() - b.capturedAt.getTime());
  return out;
}

export function readGpsCsvFile(path: string): GpsCsvRow[] {
  return parseGpsCsv(readFileSync(path, "utf8"));
}

export function plateFromGpsFilename(name: string): string | null {
  const m = name.toUpperCase().match(/([A-Z]{2}\d{1,2}[A-Z]{1,3}\d{1,4})/);
  return m ? m[1]!.replace(/\s/g, "") : null;
}
