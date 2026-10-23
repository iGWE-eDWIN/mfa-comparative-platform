#!/usr/bin/env node
/**
 * Renders the Chapter 4 results tables (Markdown) directly from campaign summary.json files,
 * so no number in the chapter is typed by hand.
 * Usage: node scripts/results-tables.mjs <campaign-dir> [<ablation-dir>] [--start=7] > tables.md
 */
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const [campaignDir, ablationDir] = args.filter((a) => !a.startsWith('--'));
// Tables are numbered in emission order from --start (default 1), e.g. --start=7 → Table 4.7, 4.8, ...
let tableNo = Number(args.find((a) => a.startsWith('--start='))?.split('=')[1] ?? 1);
const s = JSON.parse(fs.readFileSync(path.join(campaignDir, 'summary.json'), 'utf8'));
const P = s.settings.protocols;
const out = [];
const f = (x, d = 3) => (x === null || x === undefined ? '—' : Number(x).toFixed(d));
const ms =
  (k, d = 3) =>
  (p) => {
    const v = s.protocols[p][k];
    return v ? `${f(v.mean, d)} ± ${f(v.sd, d)}` : '—';
  };
const table = (id, caption, header, rows) => {
  out.push(
    `<!-- ${id} -->`,
    '',
    `| ${header.join(' | ')} |`,
    `|${header.map((_, i) => (i ? '---:' : '---')).join('|')}|`,
  );
  for (const r of rows) out.push(`| ${r.join(' | ')} |`);
  out.push('', `*${caption.replace(/^Table 4\.\d+:/, `Table 4.${tableNo++}:`)}*`, '');
};

const e = s.environment;
table(
  'T-ENV',
  'Table 4.2: Benchmark execution environment (recorded automatically with every job)',
  ['Parameter', 'Value'],
  [
    ['Runtime', `Node.js ${e.node} (V8 ${e.v8}, OpenSSL ${e.openssl})`],
    ['Operating system', `${e.osType} ${e.osRelease} (${e.platform}/${e.arch})`],
    ['CPU', `${e.cpuModel}, ${e.cpuCount} logical cores`],
    ['Memory', `${e.totalMemoryMB} MB`],
    [
      'Load average at job creation (1/5/15 min)',
      e.loadAverage.map((x) => x.toFixed(2)).join(' / '),
    ],
    [
      'Browser for WebAuthn ceremonies',
      `Chromium/Chrome ${e.browser} (headless) with CDP virtual authenticator`,
    ],
    [
      'Email channel',
      `${e.mail.provider} (${e.mail.tls}); requested: ${e.mail.requested}; fallback: ${e.mail.fallbackReason ?? 'none'}`,
    ],
    ['Benchmark isolation', e.isolation],
    [
      'Key libraries',
      Object.entries(e.libraries)
        .map(([k, v]) => `${k} ${v}`)
        .join(', '),
    ],
    [
      'Campaign',
      `${s.settings.runs} runs × ${s.settings.iterations} measured iterations per protocol after ${s.settings.warmup} discarded warm-up iterations; job ids ${s.jobIds.join(', ')}`,
    ],
  ],
);

table(
  'T-LAT',
  `Table 4.3: End-to-end latency per authentication transaction (ms), mean ± SD across ${s.settings.runs} runs of ${s.settings.iterations} iterations`,
  ['Statistic', ...P],
  [
    ['Mean', ...P.map(ms('latencyMean'))],
    ['Median', ...P.map(ms('latencyMedian'))],
    ['p95', ...P.map(ms('latencyP95'))],
    ['p99', ...P.map(ms('latencyP99'))],
    ['Standard deviation (within run)', ...P.map(ms('latencyStdDev'))],
    ['Minimum', ...P.map(ms('latencyMin'))],
    ['Maximum', ...P.map(ms('latencyMax'))],
    [
      `Pooled median / p95 / p99 (n = ${s.protocols[P[0]].pooledLatency.n})`,
      ...P.map((p) => {
        const q = s.protocols[p].pooledLatency;
        return `${f(q.median)} / ${f(q.p95)} / ${f(q.p99)}`;
      }),
    ],
  ],
);

table(
  'T-PROC',
  'Table 4.4: Server-side processing time per transaction (ms) — issuance plus verification compute only, mean ± SD across runs',
  ['Statistic', ...P],
  [
    ['Mean', ...P.map(ms('processingMean', 4))],
    ['Median', ...P.map(ms('processingMedian', 4))],
    ['p95', ...P.map(ms('processingP95', 4))],
    ['p99', ...P.map(ms('processingP99', 4))],
  ],
);

table(
  'T-CHAN',
  'Table 4.5: Channel components reported separately (ms), mean ± SD across runs',
  ['Component', 'Protocol', 'Mean', 'Median'],
  [
    [
      'SMTP submission (send) time',
      'OOB Email',
      ms('emailSendMean')('OOB Email'),
      ms('emailSendMedian')('OOB Email'),
    ],
    [
      'Server verification (verifyAuthenticationResponse)',
      'WebAuthn',
      ms('serverVerifyMean')('WebAuthn'),
      ms('serverVerifyMedian')('WebAuthn'),
    ],
    [
      'Browser ceremony (navigator.credentials.get, virtual authenticator)',
      'WebAuthn',
      ms('ceremonyMean')('WebAuthn'),
      ms('ceremonyMedian')('WebAuthn'),
    ],
  ],
);

table(
  'T-THR',
  'Table 4.6: Throughput, error rate and enrolment time',
  ['Metric', ...P],
  [
    ['Throughput (successful ops/s), mean ± SD', ...P.map(ms('opsPerSec', 1))],
    [
      'Errors / attempted (all runs)',
      ...P.map((p) => `${s.protocols[p].errorsTotal} / ${s.protocols[p].attemptedTotal}`),
    ],
    [
      'Error rate',
      ...P.map(
        (p) => `${f((100 * s.protocols[p].errorsTotal) / s.protocols[p].attemptedTotal, 2)}%`,
      ),
    ],
    ['Enrolment / registration (ms), mean ± SD', ...P.map(ms('enrolmentMs'))],
  ],
);

table(
  'T-RES',
  'Table 4.7: Server-side resource observations over the measured phase (benchmark thread; browser process excluded)',
  ['Metric', ...P],
  [
    ['CPU time per operation (µs), mean ± SD', ...P.map(ms('cpuPerOpUs', 1))],
    [
      `Heap delta over ${s.settings.iterations} iterations (KB), mean ± SD`,
      ...P.map(ms('heapDeltaKB', 1)),
    ],
  ],
);

table(
  'T-CV',
  'Table 4.8: Run-to-run variation — coefficient of variation (SD/mean) of each run statistic across runs',
  ['Statistic', ...P],
  [
    ['Latency mean', ...P.map((p) => f(s.protocols[p].latencyMean.cv))],
    ['Latency median', ...P.map((p) => f(s.protocols[p].latencyMedian.cv))],
    ['Latency p95', ...P.map((p) => f(s.protocols[p].latencyP95.cv))],
    ['Processing median', ...P.map((p) => f(s.protocols[p].processingMedian.cv))],
    ['Throughput', ...P.map((p) => f(s.protocols[p].opsPerSec.cv))],
  ],
);

const runRows = (k, d = 4) =>
  P.map((p) => [
    p,
    ...s.protocols[p][k].perRun.map((x) => f(x, d)),
    f(s.protocols[p][k].mean, d),
    f(s.protocols[p][k].sd, d),
  ]);
table(
  'T-RUNS',
  'Table 4.9: Median end-to-end latency per run (ms)',
  ['Protocol', ...s.jobIds.map((_, i) => `Run ${i + 1}`), 'Mean', 'SD'],
  runRows('latencyMedian'),
);

if (ablationDir) {
  const a = JSON.parse(fs.readFileSync(path.join(ablationDir, 'summary.json'), 'utf8'));
  const am = (p, k, d = 4) => `${f(a.protocols[p][k].mean, d)} ± ${f(a.protocols[p][k].sd, d)}`;
  table(
    'T-ABL',
    `Table 4.12: Ablation runs (${a.settings.runs} × ${a.settings.iterations} iterations after ${a.settings.warmup} warm-up), compared with the main campaign`,
    [
      'Configuration',
      'Processing mean (ms)',
      'Processing median (ms)',
      'Latency mean (ms)',
      'Throughput (ops/s)',
    ],
    [
      [
        'HOTP, look-ahead window 10 (main campaign, 11 HMACs per verification)',
        ms('processingMean', 4)('HOTP'),
        ms('processingMedian', 4)('HOTP'),
        ms('latencyMean', 4)('HOTP'),
        ms('opsPerSec', 1)('HOTP'),
      ],
      [
        'HOTP, look-ahead window 2 (3 HMACs per verification)',
        am('HOTP', 'processingMean'),
        am('HOTP', 'processingMedian'),
        am('HOTP', 'latencyMean'),
        am('HOTP', 'opsPerSec', 1),
      ],
      [
        'TOTP, window ±1 (main campaign, 3 HMACs per verification)',
        ms('processingMean', 4)('TOTP'),
        ms('processingMedian', 4)('TOTP'),
        ms('latencyMean', 4)('TOTP'),
        ms('opsPerSec', 1)('TOTP'),
      ],
      [
        'OOB Email with SMTP delivery (main campaign)',
        ms('processingMean', 4)('OOB Email'),
        ms('processingMedian', 4)('OOB Email'),
        ms('latencyMean', 4)('OOB Email'),
        ms('opsPerSec', 1)('OOB Email'),
      ],
      [
        'OOB Email, sendEmail = false (server compute only)',
        am('OOB Email', 'processingMean'),
        am('OOB Email', 'processingMedian'),
        am('OOB Email', 'latencyMean'),
        am('OOB Email', 'opsPerSec', 1),
      ],
    ],
  );
}
const SEC = [
  ['phishingTest', 'Phishing (relay / origin)'],
  ['replayTest', 'Replay'],
  ['bruteForceTest', 'Brute force / lockout'],
  ['expiredCodeTest', 'Expired code / challenge'],
  ['desynchronisationObservation', 'Desynchronisation'],
];
const label = { pass: 'Pass', fail: 'Fail', 'not-applicable': 'N/A', error: 'Error' };
table(
  'T-SEC',
  `Table 4.10: Controlled security simulation outcomes (identical in all ${s.settings.runs} runs unless stated)`,
  ['Scenario', ...P],
  SEC.map(([k, l]) => [
    l,
    ...P.map((p) => {
      const xs = s.protocols[p].security[k];
      return new Set(xs).size === 1 ? label[xs[0]] : xs.map((x) => label[x]).join('/');
    }),
  ]),
);

table(
  'T-ASSESS',
  'Table 4.11: Integration-effort and usability assessment (rubric scores 1–5; "m" = measured)',
  ['Criterion', ...P],
  [
    ...s.protocols[P[0]].integrationAssessment.criteria.map((c, i) => [
      `Integration: ${c.label}${c.measured ? ' (m)' : ''}`,
      ...P.map((p) => {
        const x = s.protocols[p].integrationAssessment.criteria[i];
        return `${x.score}${x.measuredValue !== undefined ? ` (${x.measuredValue})` : ''}`;
      }),
    ]),
    [
      '**Integration effort score**',
      ...P.map((p) => `**${s.protocols[p].integrationAssessment.effortScore}**`),
    ],
    ...s.protocols[P[0]].usabilityAssessment.criteria.map((c, i) => [
      `Usability: ${c.label}`,
      ...P.map((p) => String(s.protocols[p].usabilityAssessment.criteria[i].score)),
    ]),
    ['**Usability score**', ...P.map((p) => `**${s.protocols[p].usabilityAssessment.score}**`)],
  ],
);

process.stdout.write(out.join('\n') + '\n');
