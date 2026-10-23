import { describe, expect, it } from 'vitest';
import { runBenchmark, summaryOf } from '../../src/services/benchmark/runner.js';
import { fakeMailer, makeCtx } from '../helpers/fakes.js';

const settings = (o = {}) => ({
  iterations: 30,
  warmupIterations: 5,
  timeoutMs: 60000,
  operationTimeoutMs: 5000,
  runSecuritySimulations: false,
  ...o,
});
const ctxFactory =
  (mailer = fakeMailer()) =>
  (clock = { offsetMs: 0 }) =>
    makeCtx({ mailer, clock });

describe('Benchmark runner (identical procedure for every protocol)', () => {
  it('measures all metrics and discards warm-up', async () => {
    const events = [];
    const mailer = fakeMailer();
    const { results, interrupted } = await runBenchmark({
      protocols: [
        { name: 'HOTP', config: {} },
        { name: 'TOTP', config: {} },
        { name: 'OOB Email', config: {} },
      ],
      settings: settings(),
      makeCtx: ctxFactory(mailer),
      emit: (e, p) => events.push([e, p]),
    });
    expect(interrupted).toBeNull();
    expect(results).toHaveLength(3);
    for (const r of results) {
      expect(r.status).toBe('Completed');
      expect(r.metrics.rawSamples.latency).toHaveLength(30);
      expect(r.metrics.latency.n).toBe(30);
      expect(r.metrics.latency.p95).toBeGreaterThanOrEqual(r.metrics.latency.median);
      expect(r.metrics.processingTime.mean).toBeGreaterThan(0);
      expect(r.metrics.processingTime.mean).toBeLessThanOrEqual(r.metrics.latency.mean);
      expect(r.metrics.throughput.successfulOps).toBe(30);
      expect(r.metrics.errorRate).toBe(0);
      expect(r.metrics.resources.cpuTotalMs).toBeGreaterThanOrEqual(0);
      expect(typeof r.metrics.resources.heapDeltaKB).toBe('number');
    }
    // 5 warm-up + 30 measured emails
    expect(mailer.sent).toHaveLength(35);
    expect(results[2].metrics.channel.sendTime.n).toBe(30);
    const names = events.map(([e]) => e);
    expect(names.filter((e) => e === 'protocol:started')).toHaveLength(3);
    expect(names.filter((e) => e === 'protocol:completed')).toHaveLength(3);
    expect(names).toContain('iteration:progress');
    expect(events.filter(([e]) => e === 'iteration:progress').at(-1)[1].percent).toBe(100);
    expect(summaryOf(results[0])).toMatchObject({ protocol: 'HOTP', status: 'Completed' });
  });

  it('counts failed verifications in the error rate', async () => {
    const { results } = await runBenchmark({
      protocols: [
        { name: 'HOTP', config: { counterDrift: 20, lookAheadWindow: 10, maxAttempts: 100 } },
      ],
      settings: settings({ iterations: 10, warmupIterations: 0 }),
      makeCtx: ctxFactory(),
    });
    expect(results[0].metrics.errorRate).toBe(1);
    expect(results[0].metrics.errors).toEqual([{ reason: 'invalid_code', count: 10 }]);
    expect(results[0].metrics.throughput.successfulOps).toBe(0);
  });

  it('records a protocol that cannot initialise and continues with the others', async () => {
    const { results } = await runBenchmark({
      protocols: [
        { name: 'OOB Email', config: {} },
        { name: 'HOTP', config: {} },
      ],
      settings: settings(),
      makeCtx: (clock) => ({ ...makeCtx({ clock }), mailer: null }),
    });
    expect(results[0]).toMatchObject({ status: 'Failed', protocolName: 'OOB Email' });
    expect(results[1].status).toBe('Completed');
    expect(summaryOf(results[0]).status).toBe('Failed');
  });

  it('counts delivery exceptions as errors without aborting', async () => {
    const { results } = await runBenchmark({
      protocols: [{ name: 'OOB Email', config: {} }],
      settings: settings({ iterations: 5, warmupIterations: 1 }),
      makeCtx: ctxFactory(fakeMailer({ fail: true })),
    });
    expect(results[0].metrics.errorCount).toBe(5);
    expect(results[0].metrics.errors[0].reason).toBe('DELIVERY_FAILED');
  });

  it('stops on cancellation', async () => {
    let n = 0;
    const { results, interrupted } = await runBenchmark({
      protocols: [
        { name: 'HOTP', config: {} },
        { name: 'TOTP', config: {} },
      ],
      settings: settings({ iterations: 1000 }),
      makeCtx: ctxFactory(),
      isCancelled: () => ++n > 50,
    });
    expect(interrupted.code).toBe('CANCELLED');
    expect(results).toHaveLength(0);
  });

  it('fails on job timeout and on operation timeout', async () => {
    const slow = fakeMailer({ delayMs: 40 });
    const t = await runBenchmark({
      protocols: [{ name: 'OOB Email', config: {} }],
      settings: settings({ iterations: 100, warmupIterations: 0, timeoutMs: 300 }),
      makeCtx: ctxFactory(slow),
    });
    expect(t.interrupted.code).toBe('ETIMEDOUT');
    const op = await runBenchmark({
      protocols: [{ name: 'OOB Email', config: {} }],
      settings: settings({ iterations: 3, warmupIterations: 0, operationTimeoutMs: 10 }),
      makeCtx: ctxFactory(slow),
    });
    expect(op.results[0].metrics.errors).toEqual([{ reason: 'ETIMEDOUT', count: 3 }]);
  });

  it('runs security simulations when enabled', async () => {
    const { results } = await runBenchmark({
      protocols: [{ name: 'TOTP', config: {} }],
      settings: settings({ iterations: 5, runSecuritySimulations: true }),
      makeCtx: ctxFactory(),
    });
    expect(results[0].securityOutcome.replayTest.status).toBe('pass');
  });
});
