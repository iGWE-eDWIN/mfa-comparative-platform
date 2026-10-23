import { useCallback, useEffect, useState } from 'react';
import { api, qs } from '../../lib/api.js';
import { when } from '../../lib/format.js';
import { useAuth } from '../../auth/AuthContext.jsx';
import { ErrorAlert, Field } from '../../components/ui.jsx';

export default function Users() {
  const { user: me } = useAuth();
  const [q, setQ] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(
    () =>
      api(`/admin/users${qs({ q, page })}`)
        .then(setData)
        .catch(setError),
    [q, page],
  );
  useEffect(() => {
    load();
  }, [load]);
  const patch = async (id, body) => {
    setError(null);
    try {
      await api(`/admin/users/${id}`, { method: 'PATCH', body });
      load();
    } catch (e) {
      setError(e);
    }
  };
  const pages = data ? Math.max(1, Math.ceil(data.total / data.limit)) : 1;
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Users</h1>
          <p>Manage roles and suspend accounts. Changes are audit-logged.</p>
        </div>
      </header>
      <section className="card">
        <Field label="Search username or email">
          {(p) => (
            <input
              {...p}
              type="search"
              value={q}
              onChange={(e) => {
                setPage(1);
                setQ(e.target.value);
              }}
            />
          )}
        </Field>
        <ErrorAlert error={error} />
        {!data ? (
          <p role="status">Loading…</p>
        ) : (
          <div className="table-wrap">
            <table>
              <caption>{data.total} user(s)</caption>
              <thead>
                <tr>
                  <th>Username</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Status</th>
                  <th className="num">Jobs</th>
                  <th>Created</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((u) => (
                  <tr key={u.id}>
                    <td>
                      {u.username}
                      {u.id === me.id && <span className="small muted"> (you)</span>}
                    </td>
                    <td>{u.email}</td>
                    <td>
                      <select
                        aria-label={`Role of ${u.username}`}
                        value={u.role}
                        disabled={u.id === me.id}
                        onChange={(e) => patch(u.id, { role: e.target.value })}
                      >
                        <option value="user">user</option>
                        <option value="admin">admin</option>
                      </select>
                    </td>
                    <td>
                      <select
                        aria-label={`Status of ${u.username}`}
                        value={u.status}
                        disabled={u.id === me.id}
                        onChange={(e) => patch(u.id, { status: e.target.value })}
                      >
                        <option value="active">active</option>
                        <option value="suspended">suspended</option>
                      </select>
                    </td>
                    <td className="num">{u.jobCount}</td>
                    <td>{when(u.createdAt)}</td>
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
