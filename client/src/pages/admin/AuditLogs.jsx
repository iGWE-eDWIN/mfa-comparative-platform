import { useEffect, useState } from 'react';
import { api, qs } from '../../lib/api.js';
import { ErrorAlert, Field } from '../../components/ui.jsx';

export default function AuditLogs() {
  const [filters, setFilters] = useState({ action: '', from: '', to: '' });
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  useEffect(() => {
    const ctrl = new AbortController();
    api(`/admin/audit-logs${qs({ ...filters, page, limit: 50 })}`, { signal: ctrl.signal })
      .then(setData)
      .catch((e) => e.name !== 'AbortError' && setError(e));
    return () => ctrl.abort();
  }, [filters, page]);
  const set = (k) => (e) => {
    setPage(1);
    setFilters({ ...filters, [k]: e.target.value });
  };
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Audit logs</h1>
          <p>Security-relevant events (FR11). Codes, secrets and passwords are never recorded.</p>
        </div>
      </header>
      <section className="card">
        <div className="param-grid" style={{ marginTop: 0 }}>
          <Field label="Action prefix" hint="e.g. auth. or job.">
            {(p) => <input {...p} type="search" value={filters.action} onChange={set('action')} />}
          </Field>
          <Field label="From">
            {(p) => <input {...p} type="date" value={filters.from} onChange={set('from')} />}
          </Field>
          <Field label="To">
            {(p) => <input {...p} type="date" value={filters.to} onChange={set('to')} />}
          </Field>
        </div>
        <ErrorAlert error={error} />
        {!data ? (
          <p role="status">Loading…</p>
        ) : (
          <div className="table-wrap">
            <table>
              <caption>{data.total} event(s)</caption>
              <thead>
                <tr>
                  <th>Time</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Details</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((a) => (
                  <tr key={a._id}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {new Date(a.timestamp).toLocaleString('en-GB')}
                    </td>
                    <td>{a.userId?.username ?? <span className="muted">—</span>}</td>
                    <td className="mono">{a.action}</td>
                    <td className="mono small" style={{ wordBreak: 'break-word' }}>
                      {JSON.stringify(a.details)}
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
