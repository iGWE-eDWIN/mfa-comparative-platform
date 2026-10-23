import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api.js';
import { ms, num, pct } from '../lib/format.js';
import { useJobSocket } from '../hooks/useJobSocket.js';
import { ErrorAlert, JobStatus, ProtocolName } from '../components/ui.jsx';

const TERMINAL = ['Completed', 'Failed', 'Cancelled'];
const PHASES = {
  warmup: 'Warm-up (discarded)',
  measure: 'Measuring',
  security: 'Security simulations',
  initialising: 'Initialising',
};

/** Live Benchmark Monitor (Figure 3.6, FR7). */
export default function Monitor() {
  const { id } = useParams();
  const navigate = useNavigate();
  const [job, setJob] = useState(null);
  const [live, setLive] = useState({
    percent: 0,
    protocol: null,
    phase: null,
    iteration: 0,
    of: 0,
  });
  const [completed, setCompleted] = useState({});
  const [log, setLog] = useState([]);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState(null);

  const load = useCallback(async () => {
    try {
      const { job: j } = await api(`/jobs/${id}`);
      setJob(j);
      setLive((l) => ({
        ...l,
        percent: Math.max(l.percent, j.progress?.percent ?? 0),
        protocol: l.protocol ?? j.progress?.currentProtocol,
      }));
    } catch (err) {
      setError(err);
    }
  }, [id]);

  useEffect(() => {
    load();
  }, [load]);
  // Polling fallback in case the socket is blocked by a proxy.
  useEffect(() => {
    if (job && TERMINAL.includes(job.status)) return undefined;
    const t = setInterval(load, connected ? 10000 : 2000);
    return () => clearInterval(t);
  }, [job, connected, load]);

  useJobSocket(id, (ev, p) => {
    if (ev === 'socket:connected') return setConnected(true);
    if (ev === 'socket:disconnected') return setConnected(false);
    if (ev === 'iteration:progress')
      setLive({
        percent: p.percent,
        protocol: p.protocol,
        phase: p.phase,
        iteration: p.iteration,
        of: p.of,
      });
    if (ev === 'protocol:started')
      setLive((l) => ({ ...l, protocol: p.protocol, phase: 'initialising', iteration: 0 }));
    if (ev === 'protocol:completed') setCompleted((c) => ({ ...c, [p.protocol]: p }));
    if (ev !== 'iteration:progress')
      setLog((l) => [{ at: new Date(), ev, text: describe(ev, p) }, ...l].slice(0, 50));
    if (['job:completed', 'job:failed', 'job:cancelled', 'job:started'].includes(ev)) load();
  });

  const cancel = async () => {
    try {
      await api(`/jobs/${id}/cancel`, { method: 'POST' });
      load();
    } catch (err) {
      setError(err);
    }
  };

  if (!job) return error ? <ErrorAlert error={error} /> : <p role="status">Loading…</p>;
  const done = TERMINAL.includes(job.status);
  const percent = job.status === 'Completed' ? 100 : live.percent;

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Live benchmark</h1>
          <p>
            {job.settings.label || `Job ${id.slice(-6)}`} · {num(job.settings.iterations)}{' '}
            iterations after {num(job.settings.warmupIterations)} warm-up
          </p>
        </div>
        <div className="row">
          <JobStatus status={job.status} />
          {!done && (
            <button className="btn danger" onClick={cancel} disabled={job.cancelRequested}>
              {job.cancelRequested ? 'Cancelling…' : 'Cancel job'}
            </button>
          )}
          {done && (
            <button className="btn primary" onClick={() => navigate(`/jobs/${id}/results`)}>
              View results
            </button>
          )}
        </div>
      </header>
      <ErrorAlert error={error} />
      {job.status === 'Failed' && (
        <div className="alert error" role="alert">
          Job failed: {job.error}
        </div>
      )}
      {job.status === 'Cancelled' && (
        <div className="alert" role="status">
          The job was cancelled. Results of protocols that finished before cancellation are kept.
        </div>
      )}
      <section className="card" aria-labelledby="progress-h">
        <div className="row spread">
          <h2 id="progress-h">Progress</h2>
          <span className="small muted">
            {connected ? 'Live via Socket.IO' : 'Connecting… (polling)'}
          </span>
        </div>
        <div
          className="progress"
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={Math.round(percent)}
          aria-label="Job progress"
        >
          <span style={{ width: `${percent}%` }} />
        </div>
        <p className="small" style={{ marginTop: 8 }} aria-live="polite">
          {done ? (
            `${job.status}.`
          ) : live.protocol ? (
            <>
              <strong>{live.protocol}</strong> — {PHASES[live.phase] ?? live.phase ?? 'starting'}
              {live.phase === 'measure' || live.phase === 'warmup'
                ? ` ${num(live.iteration)} / ${num(live.of)}`
                : ''}{' '}
              · {percent.toFixed(1)}%
            </>
          ) : job.status === 'Pending' ? (
            'Queued, waiting for a benchmark worker…'
          ) : (
            'Starting…'
          )}
        </p>
      </section>
      <section className="card" aria-labelledby="proto-h">
        <h2 id="proto-h">Protocols</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Protocol</th>
                <th>Status</th>
                <th className="num">Mean latency</th>
                <th className="num">p95 latency</th>
                <th className="num">Mean processing</th>
                <th className="num">Throughput</th>
                <th className="num">Error rate</th>
              </tr>
            </thead>
            <tbody>
              {job.protocols.map((p) => {
                const c = completed[p.name]?.summary;
                const status = completed[p.name]?.failed
                  ? 'Failed'
                  : c
                    ? 'Completed'
                    : live.protocol === p.name && !done
                      ? 'Running'
                      : p.status;
                return (
                  <tr key={p.name}>
                    <td>
                      <ProtocolName name={p.name} />
                    </td>
                    <td>
                      <JobStatus status={status} />
                      {completed[p.name]?.error && (
                        <div className="small form-error">{completed[p.name].error}</div>
                      )}
                    </td>
                    <td className="num">{c ? ms(c.latencyMeanMs) : '—'}</td>
                    <td className="num">{c ? ms(c.latencyP95Ms) : '—'}</td>
                    <td className="num">{c ? ms(c.processingMeanMs) : '—'}</td>
                    <td className="num">{c ? `${num(c.opsPerSec, 1)} ops/s` : '—'}</td>
                    <td className="num">{c ? pct(c.errorRate) : '—'}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
      <section className="card" aria-labelledby="events-h">
        <h2 id="events-h">Events</h2>
        {log.length === 0 ? (
          <p className="muted small">Waiting for events…</p>
        ) : (
          <ol className="small" style={{ margin: 0, paddingLeft: 18 }} aria-live="polite">
            {log.map((l, i) => (
              <li key={i}>
                <span className="muted mono">{l.at.toLocaleTimeString('en-GB')}</span> {l.text}
              </li>
            ))}
          </ol>
        )}
        {done && (
          <p style={{ marginTop: 12 }}>
            <Link to={`/jobs/${id}/results`}>Open the comparative results →</Link>
          </p>
        )}
      </section>
    </>
  );
}

function describe(ev, p) {
  switch (ev) {
    case 'job:started':
      return `Job started (${p.protocols?.join(', ')})`;
    case 'protocol:started':
      return `${p.protocol} started`;
    case 'protocol:completed':
      return p.failed ? `${p.protocol} failed: ${p.error}` : `${p.protocol} completed`;
    case 'job:completed':
      return `Job completed — ${p.resultCount} result(s) stored`;
    case 'job:failed':
      return `Job failed: ${p.error}`;
    case 'job:cancelled':
      return 'Job cancelled';
    default:
      return ev;
  }
}
