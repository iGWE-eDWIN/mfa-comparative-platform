import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { durationBetween, ms, num, pct, when } from '../lib/format.js';
import { ErrorAlert, JobStatus, ProtocolName } from '../components/ui.jsx';
import { DistributionGrid, ProtocolBarChart, TimeChart } from '../components/charts/Charts.jsx';
import SecurityMatrix from '../components/SecurityMatrix.jsx';
import AssessmentEditor from '../components/AssessmentEditor.jsx';
import LiteraturePanel from '../components/LiteraturePanel.jsx';

const ORDER = ['HOTP', 'TOTP', 'OOB Email', 'WebAuthn'];

const ROWS = [
  ['Latency — mean', (r) => ms(r.metrics.latency.mean)],
  ['Latency — median', (r) => ms(r.metrics.latency.median)],
  ['Latency — p95', (r) => ms(r.metrics.latency.p95)],
  ['Latency — p99', (r) => ms(r.metrics.latency.p99)],
  ['Latency — min / max', (r) => `${ms(r.metrics.latency.min)} / ${ms(r.metrics.latency.max)}`],
  ['Latency — std. dev.', (r) => ms(r.metrics.latency.stdDev)],
  ['Processing — mean', (r) => ms(r.metrics.processingTime.mean)],
  ['Processing — median', (r) => ms(r.metrics.processingTime.median)],
  [
    'Processing — p95 / p99',
    (r) => `${ms(r.metrics.processingTime.p95)} / ${ms(r.metrics.processingTime.p99)}`,
  ],
  ['Throughput', (r) => `${num(r.metrics.throughput.opsPerSec, 1)} ops/s`],
  [
    'Successful / attempted',
    (r) => `${num(r.metrics.throughput.successfulOps)} / ${num(r.metrics.attempted)}`,
  ],
  ['Error rate', (r) => pct(r.metrics.errorRate)],
  ['CPU per operation', (r) => `${num(r.metrics.resources.cpuPerOpUs, 1)} µs`],
  ['Heap delta (measured phase)', (r) => `${num(r.metrics.resources.heapDeltaKB, 1)} KB`],
  ['Enrolment / registration', (r) => ms(r.metrics.enrolmentTimeMs)],
  [
    'Email send — mean',
    (r) =>
      r.metrics.channel?.sendTime
        ? `${ms(r.metrics.channel.sendTime.mean)} (${r.metrics.channel.provider})`
        : '—',
  ],
  [
    'WebAuthn server verify — mean',
    (r) => (r.metrics.serverVerifyTime ? ms(r.metrics.serverVerifyTime.mean) : '—'),
  ],
  [
    'WebAuthn browser ceremony — mean',
    (r) => (r.metrics.channel?.ceremonyTime ? ms(r.metrics.channel.ceremonyTime.mean) : '—'),
  ],
  ['Hardware requirement', (r) => r.hardwareRequirement],
  ['Channel dependency', (r) => r.channelDependency],
  ['Integration effort (1–5)', (r) => r.integrationAssessment?.effortScore],
  ['Usability (1–5)', (r) => r.usabilityAssessment?.score],
];

/** Comparative Results dashboard (Figure 3.6; FR9, FR10, FR12). */
export default function Results() {
  const { id } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [dist, setDist] = useState('latency');

  useEffect(() => {
    api(`/jobs/${id}/results`).then(setData).catch(setError);
  }, [id]);

  if (error) return <ErrorAlert error={error} />;
  if (!data) return <p role="status">Loading results…</p>;
  const { job } = data;
  const results = [...data.results].sort(
    (a, b) => ORDER.indexOf(a.protocolName) - ORDER.indexOf(b.protocolName),
  );
  const env = job.environment ?? {};
  const allZeroErrors = results.every((r) => r.metrics.errorCount === 0);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Comparative results</h1>
          <p>
            {job.settings.label || `Job ${id.slice(-6)}`} · {when(job.createdAt)} ·{' '}
            {num(job.settings.iterations)} iterations per protocol after{' '}
            {num(job.settings.warmupIterations)} discarded warm-up · duration{' '}
            {durationBetween(job.startedAt, job.finishedAt)}
          </p>
        </div>
        <div className="row">
          <JobStatus status={job.status} />
          <a className="btn" href={`/api/jobs/${id}/export?format=csv`} download>
            Export CSV
          </a>
          <a className="btn" href={`/api/jobs/${id}/export?format=json`} download>
            Export JSON
          </a>
        </div>
      </header>
      {job.status === 'Failed' && (
        <div className="alert error" role="alert">
          This job failed: {job.error}. Results of protocols that completed are shown.
        </div>
      )}
      {job.status === 'Cancelled' && (
        <div className="alert" role="status">
          This job was cancelled; only protocols that completed are shown.
        </div>
      )}
      {results.length === 0 ? (
        <div className="card">
          <p>No results were stored for this job.</p>
          <Link to="/configure">Run a new comparison</Link>
        </div>
      ) : (
        <>
          <section className="card" aria-labelledby="side-h">
            <h2 id="side-h">Side-by-side comparison</h2>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Metric</th>
                    {results.map((r) => (
                      <th scope="col" className="num" key={r._id}>
                        <ProtocolName name={r.protocolName} />
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {ROWS.map(([label, f]) => (
                    <tr key={label}>
                      <th scope="row">{label}</th>
                      {results.map((r) => (
                        <td className="num" key={r._id} style={{ whiteSpace: 'normal' }}>
                          {f(r) ?? '—'}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="note" style={{ marginTop: 12 }}>
              <strong>Latency</strong> is the whole transaction (incl. simulated claimant, email
              send, browser ceremony). <strong>Processing</strong> is server compute only. WebAuthn
              uses a <strong>software Virtual Authenticator</strong>; email send time depends on the
              provider ({env.mail?.provider ?? 'n/a'}) and the network.
            </p>
          </section>

          <section aria-labelledby="charts-h" style={{ marginTop: 20 }}>
            <h2 id="charts-h">Charts</h2>
            <TimeChart results={results} />
            <div className="row" style={{ margin: '20px 0 10px' }}>
              <h3 style={{ margin: 0 }}>Distribution</h3>
              <div className="chips" role="group" aria-label="Distribution measure">
                <button
                  type="button"
                  aria-pressed={dist === 'latency'}
                  onClick={() => setDist('latency')}
                >
                  Latency
                </button>
                <button
                  type="button"
                  aria-pressed={dist === 'processing'}
                  onClick={() => setDist('processing')}
                >
                  Processing
                </button>
              </div>
            </div>
            <DistributionGrid results={results} kind={dist} />
            <div className="grid grid-2" style={{ marginTop: 16 }}>
              <ProtocolBarChart
                title="Throughput"
                subtitle="Successful authentications per second of measured wall time (sequential, one worker)"
                data={results.map((r) => ({
                  name: r.protocolName,
                  value: r.metrics.throughput.opsPerSec,
                }))}
                unit="ops/s"
                format={(v) => num(v, v < 10 ? 2 : 0)}
                log
              />
              {allZeroErrors ? (
                <div className="card">
                  <h3>Error rate</h3>
                  <p className="stat">
                    <span className="value">0%</span>
                    <span className="label">
                      No failed operations in{' '}
                      {num(results.reduce((a, r) => a + r.metrics.attempted, 0))} measured attempts
                      across all protocols
                    </span>
                  </p>
                </div>
              ) : (
                <ProtocolBarChart
                  title="Error rate"
                  subtitle="Failed / attempted operations"
                  data={results.map((r) => ({
                    name: r.protocolName,
                    value: r.metrics.errorRate * 100,
                  }))}
                  unit="%"
                  format={(v) => v.toFixed(2)}
                />
              )}
              <ProtocolBarChart
                title="Resource load: CPU time per operation"
                subtitle="Benchmark thread CPU (server work + claimant simulation; browser excluded)"
                data={results.map((r) => ({
                  name: r.protocolName,
                  value: r.metrics.resources.cpuPerOpUs,
                }))}
                unit="µs"
                format={(v) => num(v, 1)}
                log
              />
              <ProtocolBarChart
                title="Resource load: heap delta"
                subtitle="Retained V8 heap across the measured phase (GC forced before and after)"
                data={results.map((r) => ({
                  name: r.protocolName,
                  value: r.metrics.resources.heapDeltaKB,
                }))}
                unit="KB"
                format={(v) => num(v, 1)}
              />
            </div>
          </section>

          <section className="card" aria-labelledby="sec-h" style={{ marginTop: 20 }}>
            <h2 id="sec-h">Security matrix</h2>
            <SecurityMatrix results={results} />
          </section>

          <section aria-labelledby="ux-h" style={{ marginTop: 20 }}>
            <h2 id="ux-h">Usability and integration observations</h2>
            <div className="stack">
              {results.map((r) => (
                <AssessmentEditor key={r._id} result={r} />
              ))}
            </div>
          </section>

          <div style={{ marginTop: 20 }}>
            <LiteraturePanel />
          </div>

          <section className="card" aria-labelledby="env-h" style={{ marginTop: 20 }}>
            <h2 id="env-h">Environment (reproducibility)</h2>
            <dl
              className="small"
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                gap: '4px 14px',
                margin: 0,
              }}
            >
              <dt className="muted">Node.js / V8 / OpenSSL</dt>
              <dd style={{ margin: 0 }}>
                {env.node} / {env.v8} / {env.openssl}
              </dd>
              <dt className="muted">OS</dt>
              <dd style={{ margin: 0 }}>
                {env.osType} {env.osRelease} ({env.platform}/{env.arch})
              </dd>
              <dt className="muted">CPU</dt>
              <dd style={{ margin: 0 }}>
                {env.cpuModel} × {env.cpuCount}
              </dd>
              <dt className="muted">Memory</dt>
              <dd style={{ margin: 0 }}>{num(env.totalMemoryMB)} MB total</dd>
              <dt className="muted">Browser (WebAuthn)</dt>
              <dd style={{ margin: 0 }}>{env.browser ?? '—'}</dd>
              <dt className="muted">Email</dt>
              <dd style={{ margin: 0 }}>
                {env.mail ? `${env.mail.provider} · ${env.mail.tls}` : '—'}
              </dd>
              <dt className="muted">Isolation</dt>
              <dd style={{ margin: 0 }}>{env.isolation}</dd>
              <dt className="muted">Libraries</dt>
              <dd style={{ margin: 0 }} className="mono">
                {Object.entries(env.libraries ?? {})
                  .map(([k, v]) => `${k}@${v}`)
                  .join(' · ')}
              </dd>
            </dl>
          </section>
        </>
      )}
    </>
  );
}
