#!/usr/bin/env node
/**
 * Benchmark campaign (Sprint 8): runs N identical comparison jobs through the real API,
 * waits for each, and exports raw JSON + CSV plus a cross-run summary to docs/results/.
 * Every number written here comes from the stored results of those jobs.
 *
 * Usage: node scripts/campaign.mjs [--base=http://localhost:4000] [--user=demo] [--password=DemoPass#2026]
 *        [--runs=3] [--iterations=1000] [--warmup=50] [--protocols=HOTP,TOTP,OOB Email,WebAuthn] [--out=docs/results]
 *        [--config='{"HOTP":{"lookAheadWindow":2}}'] [--name=campaign]
 */
import fs from 'node:fs';
import path from 'node:path';

const flags = Object.fromEntries(
  process.argv.slice(2).map((a) => a.replace(/^--/, '').split(/=(.*)/s).slice(0, 2)),
);
const base = flags.base ?? 'http://localhost:4000';
const runs = Number(flags.runs ?? 3);
const iterations = Number(flags.iterations ?? 1000);
const warmup = Number(flags.warmup ?? 50);
const protocols = (flags.protocols ?? 'HOTP,TOTP,OOB Email,WebAuthn').split(',');
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const config = flags.config ? JSON.parse(flags.config) : {};
const out = path.join(flags.out ?? 'docs/results', `${flags.name ?? 'campaign'}-${stamp}`);
fs.mkdirSync(out, { recursive: true });

let cookie = '';
async function api(p, opts = {}) {
  const res = await fetch(`${base}/api${p}`, {
    ...opts,
    headers: { 'Content-Type': 'application/json', Cookie: cookie, ...(opts.headers ?? {}) },
  });
  const set = res.headers.getSetCookie?.() ?? [];
  const session = set.find((c) => c.startsWith('mfa_session='));
  if (session) cookie = session.split(';')[0];
  if (!res.ok) throw new Error(`${opts.method ?? 'GET'} ${p} → ${res.status} ${await res.text()}`);
  return res.headers.get('content-type')?.includes('json') ? res.json() : res.text();
}

await api('/auth/login', {
  method: 'POST',
  body: JSON.stringify({
    identifier: flags.user ?? 'demo',
    password: flags.password ?? 'DemoPass#2026',
  }),
});
console.log(
  `Campaign: ${runs} run(s) × ${protocols.join(', ')} × ${iterations} iterations after ${warmup} warm-up → ${out}`,
);

const jobs = [];
for (let run = 1; run <= runs; run++) {
  const { job } = await api('/jobs', {
    method: 'POST',
    body: JSON.stringify({
      protocols: protocols.map((name) => ({ name, config: config[name] ?? {} })),
      iterations,
      warmupIterations: warmup,
      timeoutMs: 3 * 3600 * 1000,
      operationTimeoutMs: 30000,
      runSecuritySimulations: true,
      label: `${flags.name ?? 'Campaign'} ${stamp} run ${run}/${runs}`,
    }),
  });
  process.stdout.write(`run ${run}: job ${job._id} `);
  let j;
  for (;;) {
    await new Promise((r) => setTimeout(r, 2000));
    ({ job: j } = await api(`/jobs/${job._id}`));
    process.stdout.write(
      `\rrun ${run}: job ${job._id} ${j.status} ${j.progress.percent.toFixed(1)}% ${j.progress.currentProtocol ?? ''}        `,
    );
    if (['Completed', 'Failed', 'Cancelled'].includes(j.status)) break;
  }
  console.log();
  if (j.status !== 'Completed') throw new Error(`Run ${run} ended ${j.status}: ${j.error}`);
  const json = await api(`/jobs/${job._id}/export?format=json`);
  fs.writeFileSync(
    path.join(out, `run-${run}-${job._id}.json`),
    typeof json === 'string' ? json : JSON.stringify(json, null, 2),
  );
  fs.writeFileSync(
    path.join(out, `run-${run}-${job._id}.csv`),
    await api(`/jobs/${job._id}/export?format=csv`),
  );
  jobs.push(
    JSON.parse(fs.readFileSync(path.join(out, `run-${run}-${job._id}.json`), 'utf8')).jobs[0],
  );
}

// Cross-run summary: per protocol, the per-run statistic and its mean / sample SD across runs.
const across = (xs) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd =
    xs.length > 1 ? Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / (xs.length - 1)) : 0;
  return { perRun: xs, mean: m, sd, cv: m ? sd / m : null };
};
const pick = {
  latencyMean: (r) => r.metrics.latency.mean,
  latencyMedian: (r) => r.metrics.latency.median,
  latencyP95: (r) => r.metrics.latency.p95,
  latencyP99: (r) => r.metrics.latency.p99,
  latencyStdDev: (r) => r.metrics.latency.stdDev,
  latencyMin: (r) => r.metrics.latency.min,
  latencyMax: (r) => r.metrics.latency.max,
  processingMean: (r) => r.metrics.processingTime.mean,
  processingMedian: (r) => r.metrics.processingTime.median,
  processingP95: (r) => r.metrics.processingTime.p95,
  processingP99: (r) => r.metrics.processingTime.p99,
  opsPerSec: (r) => r.metrics.throughput.opsPerSec,
  errorRate: (r) => r.metrics.errorRate,
  cpuPerOpUs: (r) => r.metrics.resources.cpuPerOpUs,
  heapDeltaKB: (r) => r.metrics.resources.heapDeltaKB,
  enrolmentMs: (r) => r.metrics.enrolmentTimeMs,
  emailSendMean: (r) => r.metrics.channel?.sendTime?.mean ?? null,
  emailSendMedian: (r) => r.metrics.channel?.sendTime?.median ?? null,
  emailSendP95: (r) => r.metrics.channel?.sendTime?.p95 ?? null,
  serverVerifyMean: (r) => r.metrics.serverVerifyTime?.mean ?? null,
  serverVerifyMedian: (r) => r.metrics.serverVerifyTime?.median ?? null,
  ceremonyMean: (r) => r.metrics.channel?.ceremonyTime?.mean ?? null,
  ceremonyMedian: (r) => r.metrics.channel?.ceremonyTime?.median ?? null,
};
const summary = {
  generatedAt: new Date().toISOString(),
  settings: { runs, iterations, warmup, protocols, config },
  jobIds: jobs.map((j) => j.job._id),
  environment: jobs[0].job.environment,
  protocols: {},
};
for (const name of protocols) {
  const rs = jobs.map((j) => j.results.find((r) => r.protocolName === name));
  const s = {};
  for (const [k, f] of Object.entries(pick)) {
    const vals = rs.map(f);
    if (vals.every((v) => v !== null && v !== undefined)) s[k] = across(vals);
  }
  // Pooled distribution over all runs from the raw samples.
  const pooled = rs.flatMap((r) => r.metrics.rawSamples.latency).sort((a, b) => a - b);
  const q = (p) => pooled[Math.min(pooled.length - 1, Math.ceil((p / 100) * pooled.length) - 1)];
  s.pooledLatency = {
    n: pooled.length,
    median: q(50),
    p95: q(95),
    p99: q(99),
    min: pooled[0],
    max: pooled.at(-1),
  };
  s.errorsTotal = rs.reduce((a, r) => a + r.metrics.errorCount, 0);
  s.attemptedTotal = rs.reduce((a, r) => a + r.metrics.attempted, 0);
  s.security = Object.fromEntries(
    [
      'phishingTest',
      'replayTest',
      'bruteForceTest',
      'expiredCodeTest',
      'desynchronisationObservation',
    ].map((k) => [k, rs.map((r) => r.securityOutcome?.[k]?.status)]),
  );
  s.securityExample = rs[0].securityOutcome;
  s.integrationAssessment = rs[0].integrationAssessment;
  s.usabilityAssessment = rs[0].usabilityAssessment;
  s.protocolObservations = rs.map((r) => r.metrics.protocolObservations);
  s.channel = rs[0].metrics.channel ?? null;
  s.resourcesNote = rs[0].metrics.resources.note ?? null;
  s.config = rs[0].config;
  summary.protocols[name] = s;
}
fs.writeFileSync(path.join(out, 'summary.json'), JSON.stringify(summary, null, 2));
const head = [
  'protocol',
  'metric',
  ...Array.from({ length: runs }, (_, i) => `run${i + 1}`),
  'mean',
  'sd',
  'cv',
];
const lines = [head.join(',')];
for (const [name, s] of Object.entries(summary.protocols))
  for (const k of Object.keys(pick))
    if (s[k]) lines.push([name, k, ...s[k].perRun, s[k].mean, s[k].sd, s[k].cv ?? ''].join(','));
fs.writeFileSync(path.join(out, 'summary.csv'), lines.join('\n') + '\n');
console.log(`Done. Summary: ${path.join(out, 'summary.json')}`);
