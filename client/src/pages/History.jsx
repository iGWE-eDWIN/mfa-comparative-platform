import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api, qs } from '../lib/api.js';
import { PROTOCOLS, durationBetween, num, when } from '../lib/format.js';
import { ErrorAlert, Field, JobStatus } from '../components/ui.jsx';

/** History / Export (Figure 3.6; FR10). */
export default function History() {
  const [filters, setFilters] = useState({ status: '', protocol: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    const ctrl = new AbortController();
    api(
      `/jobs${qs({ ...filters, to: filters.to ? `${filters.to}T23:59:59` : '', page, limit: 20 })}`,
      { signal: ctrl.signal },
    )
      .then(setData)
      .catch((e) => e.name !== 'AbortError' && setError(e));
    return () => ctrl.abort();
  }, [filters, page]);

  const set = (k) => (e) => {
    setPage(1);
    setFilters({ ...filters, [k]: e.target.value });
  };
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  const exportQs = qs({ status: filters.status, protocol: filters.protocol });

  return (
    <>
      <header className="page-head">
        <div>
          <h1>History &amp; export</h1>
          <p>Your previous comparison jobs. Only you can see them.</p>
        </div>
        <div className="row">
          <a
            className="btn"
            href={`/api/jobs/export${exportQs}${exportQs ? '&' : '?'}format=csv`}
            download
          >
            Export CSV
          </a>
          <a
            className="btn"
            href={`/api/jobs/export${exportQs}${exportQs ? '&' : '?'}format=json`}
            download
          >
            Export JSON
          </a>
        </div>
      </header>
      <section className="card" aria-label="Filters">
        <div className="param-grid" style={{ marginTop: 0 }}>
          <Field label="Status">
            {(p) => (
              <select {...p} value={filters.status} onChange={set('status')}>
                <option value="">Any</option>
                {['Pending', 'Running', 'Completed', 'Failed', 'Cancelled'].map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Protocol">
            {(p) => (
              <select {...p} value={filters.protocol} onChange={set('protocol')}>
                <option value="">Any</option>
                {PROTOCOLS.map((s) => (
                  <option key={s}>{s}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="From">
            {(p) => <input {...p} type="date" value={filters.from} onChange={set('from')} />}
          </Field>
          <Field label="To">
            {(p) => <input {...p} type="date" value={filters.to} onChange={set('to')} />}
          </Field>
        </div>
      </section>
      <ErrorAlert error={error} />
      <section className="card">
        {!data ? (
          <p role="status">Loading…</p>
        ) : data.items.length === 0 ? (
          <p className="muted">No jobs match these filters.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <caption>{num(data.total)} job(s)</caption>
              <thead>
                <tr>
                  <th>Created</th>
                  <th>Label</th>
                  <th>Protocols</th>
                  <th className="num">Iterations</th>
                  <th>Status</th>
                  <th>Duration</th>
                  <th>
                    <span className="sr-only">Actions</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((j) => (
                  <tr key={j._id}>
                    <td>{when(j.createdAt)}</td>
                    <td>
                      {j.settings.label || <span className="muted mono">{j._id.slice(-6)}</span>}
                    </td>
                    <td>{j.protocols.map((p) => p.name).join(', ')}</td>
                    <td className="num">{num(j.settings.iterations)}</td>
                    <td>
                      <JobStatus status={j.status} />
                      {j.error && (
                        <div className="small muted" title={j.error}>
                          {j.error.slice(0, 60)}
                        </div>
                      )}
                    </td>
                    <td>{durationBetween(j.startedAt, j.finishedAt)}</td>
                    <td className="row">
                      <Link to={`/jobs/${j._id}/results`}>Results</Link>
                      {['Pending', 'Running'].includes(j.status) && (
                        <Link to={`/jobs/${j._id}/monitor`}>Monitor</Link>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn small" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            Previous
          </button>
          <span className="small">
            Page {page} of {pages}
          </span>
          <button className="btn small" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            Next
          </button>
        </div>
      </section>
    </>
  );
}
