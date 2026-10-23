import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api.js';
import { when } from '../lib/format.js';
import { ErrorAlert, ProtocolName } from '../components/ui.jsx';

/** Enrolled factors and the choice of second factor at sign-in. */
export default function Credentials() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(
    () =>
      api('/credentials')
        .then((r) => setItems(r.items))
        .catch(setError),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);

  const act = async (fn) => {
    setError(null);
    try {
      await fn();
      await load();
    } catch (e) {
      setError(e);
    }
  };

  return (
    <>
      <header className="page-head">
        <div>
          <h1>My factors</h1>
          <p>
            Factors you enrolled in the simulators. Choose one to require it, after your password,
            when you sign in.
          </p>
        </div>
        <Link className="btn" to="/simulators">
          Enrol a factor
        </Link>
      </header>
      <ErrorAlert error={error} />
      <section className="card">
        {!items ? (
          <p role="status">Loading…</p>
        ) : items.length === 0 ? (
          <p className="muted">No factors yet.</p>
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Protocol</th>
                  <th>Label</th>
                  <th>Status</th>
                  <th>Last used</th>
                  <th>Login factor</th>
                  <th>
                    <span className="sr-only">Delete</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <ProtocolName name={c.protocol} />
                    </td>
                    <td>{c.label}</td>
                    <td>
                      {c.status}
                      {c.lockedUntil && new Date(c.lockedUntil) > new Date()
                        ? ` (locked until ${when(c.lockedUntil)})`
                        : ''}
                    </td>
                    <td>{when(c.lastUsedAt)}</td>
                    <td>
                      <label className="check">
                        <input
                          type="checkbox"
                          checked={c.isLoginFactor}
                          disabled={c.status !== 'active'}
                          onChange={(e) =>
                            act(() =>
                              api(`/credentials/${c.id}`, {
                                method: 'PATCH',
                                body: { isLoginFactor: e.target.checked },
                              }),
                            )
                          }
                        />
                        <span className="small">
                          {c.status !== 'active'
                            ? 'Verify once first'
                            : c.isLoginFactor
                              ? 'Required at sign-in'
                              : 'Not required'}
                        </span>
                      </label>
                    </td>
                    <td>
                      <button
                        className="btn small danger"
                        onClick={() =>
                          window.confirm(`Delete this ${c.protocol} factor?`) &&
                          act(() => api(`/credentials/${c.id}`, { method: 'DELETE' }))
                        }
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </>
  );
}
