import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { PROTOCOLS, when } from '../lib/format.js';
import { ErrorAlert, JobStatus, ProtocolName } from '../components/ui.jsx';

const DESCRIPTIONS = {
  HOTP: 'Counter-based one-time password (RFC 4226).',
  TOTP: 'Time-based one-time password (RFC 6238).',
  'OOB Email': 'One-time code delivered by email (out-of-band).',
  WebAuthn: 'FIDO2 public-key challenge-response via a Virtual Authenticator.',
};

export default function Dashboard() {
  const [protocols, setProtocols] = useState([]);
  const [recent, setRecent] = useState([]);
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    Promise.all([api('/protocols'), api('/jobs/recent'), api('/system/status')])
      .then(([p, r, s]) => {
        setProtocols(
          [...p.items].sort((a, b) => PROTOCOLS.indexOf(a.name) - PROTOCOLS.indexOf(b.name)),
        );
        setRecent(r.items);
        setStatus(s);
      })
      .catch(setError);
  }, []);

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p>Compare four MFA mechanisms under identical, controlled conditions.</p>
        </div>
        <Link to="/configure" className="btn primary">
          New comparison
        </Link>
      </header>
      <ErrorAlert error={error} />
      <section aria-labelledby="protocols-h" className="stack">
        <h2 id="protocols-h">Protocols</h2>
        <div className="grid grid-4">
          {protocols.map((p) => (
            <article key={p._id} className="card">
              <h3>
                <ProtocolName name={p.name} />
              </h3>
              <p className="small">{DESCRIPTIONS[p.name]}</p>
              <p className="small muted" style={{ marginBottom: 8 }}>
                {p.version}
              </p>
              <div className="row spread">
                <span className={`badge status-${p.status === 'active' ? 'good' : 'neutral'}`}>
                  <span className="dot" aria-hidden="true" />
                  {p.status}
                </span>
                <Link
                  className="small"
                  to={`/simulators/${p.name === 'OOB Email' ? 'oob' : p.name.toLowerCase()}`}
                >
                  Try it
                </Link>
              </div>
            </article>
          ))}
        </div>
      </section>
      <div className="grid grid-2" style={{ marginTop: 20 }}>
        <section className="card" aria-labelledby="recent-h">
          <div className="row spread">
            <h2 id="recent-h">Recent comparisons</h2>
            <Link className="small" to="/history">
              All history
            </Link>
          </div>
          {recent.length === 0 ? (
            <p className="muted">
              No comparisons yet. <Link to="/configure">Run your first one.</Link>
            </p>
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Created</th>
                    <th>Protocols</th>
                    <th>Status</th>
                    <th>
                      <span className="sr-only">Open</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {recent.map((j) => (
                    <tr key={j._id}>
                      <td>{when(j.createdAt)}</td>
                      <td>{j.protocols.map((p) => p.name).join(', ')}</td>
                      <td>
                        <JobStatus status={j.status} />
                      </td>
                      <td>
                        <Link
                          to={
                            j.status === 'Running' || j.status === 'Pending'
                              ? `/jobs/${j._id}/monitor`
                              : `/jobs/${j._id}/results`
                          }
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>
        <section className="card" aria-labelledby="status-h">
          <h2 id="status-h">System status</h2>
          {status ? (
            <dl
              className="small"
              style={{
                display: 'grid',
                gridTemplateColumns: 'auto 1fr',
                gap: '6px 14px',
                margin: 0,
              }}
            >
              <dt className="muted">Database</dt>
              <dd style={{ margin: 0 }}>{status.db}</dd>
              <dt className="muted">Benchmarks</dt>
              <dd style={{ margin: 0 }}>
                {status.benchmark.running.length} running, {status.benchmark.queued.length} queued
              </dd>
              <dt className="muted">Email provider</dt>
              <dd style={{ margin: 0 }}>
                {status.mail.provider}
                {status.mail.tls ? ` · ${status.mail.tls}` : ''}
                {status.mail.fallbackReason ? ` (${status.mail.fallbackReason})` : ''}
              </dd>
              <dt className="muted">WebAuthn RP</dt>
              <dd style={{ margin: 0 }}>
                {status.webauthn.rpId} · {status.webauthn.origin}
              </dd>
              <dt className="muted">Node.js</dt>
              <dd style={{ margin: 0 }}>{status.node}</dd>
            </dl>
          ) : (
            <p className="muted" role="status">
              Loading…
            </p>
          )}
          <p className="note" style={{ marginTop: 12 }}>
            WebAuthn results use a <strong>software Virtual Authenticator</strong>, not hardware
            keys. Email send time depends on the provider and the network. Security tests are
            controlled simulations, not penetration testing.
          </p>
        </section>
      </div>
    </>
  );
}
