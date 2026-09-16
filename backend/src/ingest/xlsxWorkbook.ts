/**
 * Minimal xlsx reader for the BluWheelz trip workbook (sharedStrings + one sheet).
 * Avoids an Excel dependency; uses the host `unzip` binary.
 */
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";

function unzipEntry(xlsxPath: string, entry: string): string {
  return execFileSync("unzip", ["-p", xlsxPath, entry], {
    encoding: "utf8",
    maxBuffer: 8 * 1024 * 1024,
  });
}

function sharedStrings(xml: string): string[] {
  const out: string[] = [];
  const siRe = /<si>([\s\S]*?)<\/si>/g;
  let m: RegExpExecArray | null;
  while ((m = siRe.exec(xml))) {
    const texts = [...m[1]!.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((t) => decodeXml(t[1]!));
    out.push(texts.join(""));
  }
  return out;
}

function decodeXml(s: string): string {
  return s
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

function colRow(ref: string): { col: number; row: number } {
  const m = ref.match(/^([A-Z]+)(\d+)$/);
  if (!m) return { col: 0, row: 0 };
  let col = 0;
  for (const ch of m[1]!) col = col * 26 + (ch.charCodeAt(0) - 64);
  return { col, row: Number(m[2]) };
}

export type CellValue = string | number | null;

export function readFirstSheet(xlsxPath: string): CellValue[][] {
  if (!existsSync(xlsxPath)) throw new Error(`xlsx_not_found: ${xlsxPath}`);
  const sst = sharedStrings(unzipEntry(xlsxPath, "xl/sharedStrings.xml"));
  const sheet = unzipEntry(xlsxPath, "xl/worksheets/sheet1.xml");
  const rows = new Map<number, Map<number, CellValue>>();
  const cellRe = /<c r="([A-Z]+\d+)"([^>]*)>(?:<v>([^<]*)<\/v>)?<\/c>/g;
  let m: RegExpExecArray | null;
  while ((m = cellRe.exec(sheet))) {
    const { col, row } = colRow(m[1]!);
    const attrs = m[2] ?? "";
    const raw = m[3];
    let value: CellValue = null;
    if (raw != null) {
      if (/\bt="s"/.test(attrs)) value = sst[Number(raw)] ?? String(raw);
      else if (raw === "") value = null;
      else if (/^-?\d+(\.\d+)?(e[-+]?\d+)?$/i.test(raw)) value = Number(raw);
      else value = raw;
    }
    if (!rows.has(row)) rows.set(row, new Map());
    rows.get(row)!.set(col, value);
  }
  const maxRow = Math.max(0, ...rows.keys());
  const maxCol = Math.max(0, ...[...rows.values()].flatMap((r) => [...r.keys()]));
  const table: CellValue[][] = [];
  for (let r = 1; r <= maxRow; r++) {
    const line: CellValue[] = [];
    const map = rows.get(r) ?? new Map();
    for (let c = 1; c <= maxCol; c++) line.push(map.get(c) ?? null);
    table.push(line);
  }
  return table;
}

/** Excel serial (1900 date system) → ISO. */
export function excelSerialToIso(serial: number): string {
  const ms = Math.round((serial - 25569) * 86400 * 1000);
  return new Date(ms).toISOString();
}
