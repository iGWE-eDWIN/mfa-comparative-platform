import v8 from 'node:v8';
import vm from 'node:vm';
import { performance } from 'node:perf_hooks';
import { setImmediate as yieldToLoop } from 'node:timers/promises';
import { createModule, getModuleClass } from '../../protocols/ProtocolManager.js';
import { summarise, nsToMs } from '../../lib/stats.js';
import { withTimeout } from '../../lib/timing.js';
import { runSecuritySimulations } from '../securitySimulationService.js';

/**
 * Benchmark controller (Chapter 3 §3.8.1, Figure 3.3). The identical procedure is applied to
 * every selected protocol, through the common interface only:
 *   configure → initialize → warm-up (discarded) → measured iterations of execute+verify →
 *   collectMetrics → security simulations → reset.
 * It has no database or socket dependencies, so it can be unit-tested and run in a worker.
 */

let forceGc = null;
function gc() {
  if (!forceGc) {
    v8.setFlagsFromString('--expose-gc');
    forceGc = vm.runInNewContext('gc');
  }
  forceGc();
}

const cpuNow = () => (typeof process.threadCpuUsage === 'function' ? process.threadCpuUsage() : process.cpuUsage());
const CPU_SOURCE = typeof process.threadCpuUsage === 'function' ? 'process.threadCpuUsage (benchmark thread only)' : 'process.cpuUsage (whole process)';
const round = (x, d = 6) => (x === null || x === undefined ? x : Math.round(x * 10 ** d) / 10 ** d);
const roundSummary = (s) => Object.fromEntries(Object.entries(s).map(([k, v]) => [k, k === 'n' ? v : round(v)]));

export class CancelledError extends Error {
  constructor() {
    super('Job cancelled by user');
    this.code = 'CANCELLED';
  }
}

/**
 * @param {object} p
 * @param {{ name: string, config: object }[]} p.protocols
 * @param {{ iterations: number, warmupIterations: number, timeoutMs: number, operationTimeoutMs: number, runSecuritySimulations: boolean }} p.settings
 * @param {(clock?: { offsetMs: number }) => import('../../protocols/ProtocolModule.js').ModuleContext} p.makeCtx
 * @param {(event: string, payload: object) => void} [p.emit]
 * @param {() => boolean} [p.isCancelled]
 */
export async function runBenchmark({ protocols, settings, makeCtx, emit = () => {}, isCancelled = () => false }) {
  const deadline = Date.now() + settings.timeoutMs;
  const perProtocolWork = settings.warmupIterations + settings.iterations;
  const totalWork = perProtocolWork * protocols.length;
  let doneWork = 0;
  const results = [];

  const checkpoint = () => {
    if (isCancelled()) throw new CancelledError();
    if (Date.now() > deadline) {
      const err = new Error(`Job exceeded its timeout of ${settings.timeoutMs} ms`);
      err.code = 'ETIMEDOUT';
      throw err;
    }
  };

  for (const [index, { name, config }] of protocols.entries()) {
    checkpoint();
    emit('protocol:started', { protocol: name, index, total: protocols.length });
    const M = getModuleClass(name);
    const ctx = makeCtx({ offsetMs: 0 });
    let module = null;
    const base = { protocolName: name, config, hardwareRequirement: M.metadata.hardwareRequirement, channelDependency: M.metadata.channelDependency };
    try {
      module = createModule(name, ctx, config);
      const { enrolmentNs } = await withTimeout(module.initialize(), settings.operationTimeoutMs * 2, `${name} initialisation`);

      let lastEmit = 0;
      const progress = (phase, i, n) => {
        doneWork++;
        const now = Date.now();
        if (now - lastEmit >= 200 || i === n) {
          lastEmit = now;
          emit('iteration:progress', { protocol: name, phase, iteration: i, of: n, percent: round((doneWork / totalWork) * 100, 1) });
        }
      };

      const once = async () => {
        const t0 = process.hrtime.bigint();
        const tx = await withTimeout(module.execute(), settings.operationTimeoutMs, `${name} execute`);
        const v = await withTimeout(module.verify(tx), settings.operationTimeoutMs, `${name} verify`);
        return { tx, v, latencyNs: process.hrtime.bigint() - t0 };
      };

      for (let i = 1; i <= settings.warmupIterations; i++) {
        checkpoint();
        try {
          await once();
        } catch (err) {
          if (err instanceof CancelledError) throw err;
        }
        progress('warmup', i, settings.warmupIterations);
        if (i % 25 === 0) await yieldToLoop();
      }

      const samples = { latency: [], processing: [], send: [], serverVerify: [], ceremony: [] };
      const errorsByReason = {};
      let success = 0;
      gc();
      const heapBefore = v8.getHeapStatistics().used_heap_size;
      const rssBefore = process.memoryUsage.rss();
      const cpu0 = cpuNow();
      const elu0 = performance.eventLoopUtilization();
      const wall0 = process.hrtime.bigint();
      for (let i = 1; i <= settings.iterations; i++) {
        checkpoint();
        try {
          const { tx, v, latencyNs } = await once();
          samples.latency.push(round(nsToMs(latencyNs)));
          samples.processing.push(round(nsToMs(tx.serverNs + v.serverNs)));
          if (tx.meta?.sendNs !== undefined) samples.send.push(round(nsToMs(tx.meta.sendNs)));
          if (tx.meta?.ceremonyNs !== undefined) samples.ceremony.push(round(nsToMs(tx.meta.ceremonyNs)));
          if (name === 'WebAuthn') samples.serverVerify.push(round(nsToMs(v.meta?.serverVerifyNs ?? v.serverNs)));
          if (v.ok) success++;
          else errorsByReason[v.reason] = (errorsByReason[v.reason] ?? 0) + 1;
        } catch (err) {
          if (err instanceof CancelledError) throw err;
          const reason = err.code ?? 'exception';
          errorsByReason[reason] = (errorsByReason[reason] ?? 0) + 1;
        }
        progress('measure', i, settings.iterations);
        // Let worker messages (cancellation) through; outside the timed region.
        if (i % 25 === 0) await yieldToLoop();
      }
      const wallNs = process.hrtime.bigint() - wall0;
      const elu = performance.eventLoopUtilization(elu0);
      const cpu = cpuNow();
      gc();
      const heapAfter = v8.getHeapStatistics().used_heap_size;

      const attempted = settings.iterations;
      const errorCount = attempted - success;
      const wallSeconds = Number(wallNs) / 1e9;
      const cpuUserMs = (cpu.user - cpu0.user) / 1000;
      const cpuSystemMs = (cpu.system - cpu0.system) / 1000;
      const observations = module.collectMetrics();
      const metrics = {
        processingTime: roundSummary(summarise(samples.processing)),
        latency: roundSummary(summarise(samples.latency)),
        throughput: {
          opsPerSec: round(success / wallSeconds, 3),
          successfulOps: success,
          iterations: attempted,
          successPerIteration: round(success / attempted, 6),
          measuredWallMs: round(wallSeconds * 1000, 3),
        },
        errorCount,
        errorRate: round(errorCount / attempted, 6),
        attempted,
        resources: {
          cpuUserMs: round(cpuUserMs, 3),
          cpuSystemMs: round(cpuSystemMs, 3),
          cpuTotalMs: round(cpuUserMs + cpuSystemMs, 3),
          cpuPerOpUs: round(((cpuUserMs + cpuSystemMs) * 1000) / attempted, 3),
          heapDeltaKB: round((heapAfter - heapBefore) / 1024, 2),
          rssDeltaKB: round((process.memoryUsage.rss() - rssBefore) / 1024, 2),
          eventLoopUtilisation: round(elu.utilization, 4),
          cpuSource: CPU_SOURCE,
          heapSource: 'v8.getHeapStatistics().used_heap_size, GC forced before and after',
          note: name === 'WebAuthn' ? 'Browser (Chromium) CPU and memory are in a separate process and are not included.' : undefined,
        },
        enrolmentTimeMs: round(nsToMs(enrolmentNs)),
        protocolObservations: observations,
        errors: Object.entries(errorsByReason).map(([reason, count]) => ({ reason, count })),
        rawSamples: { latency: samples.latency, processing: samples.processing },
      };
      if (name === 'OOB Email') {
        metrics.channel = { provider: observations.provider, tls: observations.tls, fallbackReason: observations.fallbackReason, sendTime: roundSummary(summarise(samples.send)), note: 'SMTP submission time; depends on provider and network. Excluded from processingTime, included in latency.' };
        metrics.rawSamples.send = samples.send;
      }
      if (name === 'WebAuthn') {
        metrics.serverVerifyTime = roundSummary(summarise(samples.serverVerify));
        metrics.channel = { ceremonyTime: roundSummary(summarise(samples.ceremony)), note: 'Browser ceremony with a CDP Virtual Authenticator (software). Included in latency only.' };
        metrics.rawSamples.serverVerify = samples.serverVerify;
        metrics.rawSamples.ceremony = samples.ceremony;
      }

      let securityOutcome = null;
      if (settings.runSecuritySimulations) {
        checkpoint();
        emit('iteration:progress', { protocol: name, phase: 'security', iteration: 0, of: 0, percent: round((doneWork / totalWork) * 100, 1) });
        securityOutcome = await runSecuritySimulations(name, module.config, (clock) => makeCtx(clock));
      }
      const result = { ...base, config: module.config, status: 'Completed', metrics, securityOutcome };
      results.push(result);
      emit('protocol:completed', { protocol: name, index, summary: summaryOf(result) });
    } catch (err) {
      if (err instanceof CancelledError || err.code === 'ETIMEDOUT') {
        return { results, interrupted: err };
      }
      // A protocol that cannot run (e.g. mail provider not configured) is recorded and the job continues.
      results.push({ ...base, status: 'Failed', error: err.message });
      doneWork = (index + 1) * perProtocolWork;
      emit('protocol:completed', { protocol: name, index, failed: true, error: err.message });
    } finally {
      await module?.reset().catch(() => {});
    }
  }
  return { results, interrupted: null };
}

/** Compact summary for Socket.IO events. */
export function summaryOf(r) {
  if (r.status !== 'Completed') return { protocol: r.protocolName, status: r.status, error: r.error };
  return {
    protocol: r.protocolName,
    status: r.status,
    latencyMeanMs: r.metrics.latency.mean,
    latencyP95Ms: r.metrics.latency.p95,
    processingMeanMs: r.metrics.processingTime.mean,
    opsPerSec: r.metrics.throughput.opsPerSec,
    errorRate: r.metrics.errorRate,
  };
}
