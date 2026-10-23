import { describe, expect, it } from 'vitest';
import { histogram, percentile, summarise } from '../../src/lib/stats.js';

describe('summarise', () => {
  it('computes descriptive statistics', () => {
    const s = summarise([2, 4, 4, 4, 5, 5, 7, 9]);
    expect(s.n).toBe(8);
    expect(s.mean).toBe(5);
    expect(s.median).toBe(4.5);
    expect(s.min).toBe(2);
    expect(s.max).toBe(9);
    expect(s.stdDev).toBeCloseTo(2.13809, 4); // sample standard deviation
  });
  it('odd n median, single sample and empty input', () => {
    expect(summarise([3, 1, 2]).median).toBe(2);
    expect(summarise([7])).toMatchObject({ mean: 7, stdDev: 0, p99: 7 });
    expect(summarise([]).mean).toBeNull();
  });
  it('nearest-rank percentiles', () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(xs, 95)).toBe(95);
    expect(percentile(xs, 99)).toBe(99);
    expect(percentile(xs, 100)).toBe(100);
    expect(percentile([], 50)).toBeNull();
  });
  it('does not mutate the input', () => {
    const xs = [3, 1, 2];
    summarise(xs);
    expect(xs).toEqual([3, 1, 2]);
  });
});

describe('histogram', () => {
  it('counts every sample, with an overflow bin above p99', () => {
    const xs = [...Array.from({ length: 99 }, (_, i) => i / 10), 1000];
    const h = histogram(xs, 10);
    expect(h.reduce((a, b) => a + b.count, 0)).toBe(100);
    expect(h.at(-1)).toMatchObject({ overflow: true, count: 1 });
  });
  it('handles constant and empty samples', () => {
    expect(histogram([5, 5, 5], 4).reduce((a, b) => a + b.count, 0)).toBe(3);
    expect(histogram([])).toEqual([]);
  });
});
