/** In-process counters and gauges, surfaced on /api/v1/ops/ingest-health. */

type Labels = Record<string, string | number>;

const counters = new Map<string, number>();
const gauges = new Map<string, number>();
const histograms = new Map<string, number[]>();

function keyOf(name: string, labels?: Labels): string {
  if (!labels || Object.keys(labels).length === 0) return name;
  const parts = Object.entries(labels)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}=${v}`);
  return `${name}{${parts.join(",")}}`;
}

export const metrics = {
  increment(name: string, labels?: Labels, by = 1): void {
    const k = keyOf(name, labels);
    counters.set(k, (counters.get(k) ?? 0) + by);
  },
  gauge(name: string, value: number, labels?: Labels): void {
    gauges.set(keyOf(name, labels), value);
  },
  observe(name: string, value: number, labels?: Labels): void {
    const k = keyOf(name, labels);
    const arr = histograms.get(k) ?? [];
    arr.push(value);
    if (arr.length > 1000) arr.shift();
    histograms.set(k, arr);
  },
  snapshot() {
    const hist: Record<string, { count: number; p50: number; p95: number; max: number }> = {};
    for (const [k, values] of histograms) {
      if (values.length === 0) continue;
      const sorted = [...values].sort((a, b) => a - b);
      hist[k] = {
        count: sorted.length,
        p50: sorted[Math.floor(sorted.length * 0.5)],
        p95: sorted[Math.floor(sorted.length * 0.95)],
        max: sorted[sorted.length - 1],
      };
    }
    return {
      counters: Object.fromEntries(counters),
      gauges: Object.fromEntries(gauges),
      histograms: hist,
      collectedAt: new Date().toISOString(),
    };
  },
  reset(): void {
    counters.clear();
    gauges.clear();
    histograms.clear();
  },
};
