/**
 * Descriptive statistics for benchmark samples (Chapter 3 §3.8).
 * Percentiles use the nearest-rank method on the sorted sample.
 */

/** @param {number[]} sorted ascending */
export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const rank = Math.ceil((p / 100) * sorted.length);
  return sorted[Math.min(sorted.length - 1, Math.max(0, rank - 1))];
}

/**
 * @param {number[]} samples
 * @returns {{ n: number, mean: number|null, median: number|null, p95: number|null, p99: number|null,
 *   min: number|null, max: number|null, stdDev: number|null }}
 */
export function summarise(samples) {
  const n = samples.length;
  if (n === 0) return { n: 0, mean: null, median: null, p95: null, p99: null, min: null, max: null, stdDev: null };
  const sorted = [...samples].sort((a, b) => a - b);
  const mean = sorted.reduce((s, x) => s + x, 0) / n;
  // Sample standard deviation (n - 1); zero for a single sample.
  const variance = n > 1 ? sorted.reduce((s, x) => s + (x - mean) ** 2, 0) / (n - 1) : 0;
  const median = n % 2 ? sorted[(n - 1) / 2] : (sorted[n / 2 - 1] + sorted[n / 2]) / 2;
  return {
    n,
    mean,
    median,
    p95: percentile(sorted, 95),
    p99: percentile(sorted, 99),
    min: sorted[0],
    max: sorted[n - 1],
    stdDev: Math.sqrt(variance),
  };
}

/**
 * Fixed-width histogram for latency distribution charts.
 * @returns {{ binStart: number, binEnd: number, count: number }[]}
 */
export function histogram(samples, bins = 30) {
  if (samples.length === 0) return [];
  const sorted = [...samples].sort((a, b) => a - b);
  // Clip the display range at p99 so one outlier does not flatten the chart; the overflow bin keeps the count honest.
  const lo = sorted[0];
  const hi = percentile(sorted, 99);
  const width = hi > lo ? (hi - lo) / bins : 1;
  const out = Array.from({ length: bins }, (_, i) => ({ binStart: lo + i * width, binEnd: lo + (i + 1) * width, count: 0 }));
  let overflow = 0;
  for (const x of sorted) {
    if (x > hi) overflow++;
    else out[Math.min(bins - 1, Math.floor((x - lo) / width))].count++;
  }
  if (overflow) out.push({ binStart: hi, binEnd: sorted[sorted.length - 1], count: overflow, overflow: true });
  return out;
}

export const nsToMs = (ns) => Number(ns) / 1e6;
