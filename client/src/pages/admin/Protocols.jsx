import { useCallback, useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { metaFor } from '../../lib/params.js';
import { ErrorAlert, ProtocolName } from '../../components/ui.jsx';

function ProtocolCard({ p, onSaved }) {
  const [values, setValues] = useState(() =>
    Object.fromEntries(p.defaultConfig.parameters.map((x) => [x.name, x.value])),
  );
  const [state, setState] = useState({ error: null, saved: false });
  const save = async (body) => {
    setState({ error: null, saved: false });
    try {
      await api(`/admin/protocols/${p._id}`, { method: 'PATCH', body });
      setState({ error: null, saved: true });
      onSaved();
    } catch (error) {
      setState({ error, saved: false });
    }
  };
  return (
    <article className="card">
      <div className="row spread">
        <h2 style={{ margin: 0 }}>
          <ProtocolName name={p.name} />
        </h2>
        <label className="check">
          <input
            type="checkbox"
            checked={p.status === 'active'}
            onChange={(e) => save({ status: e.target.checked ? 'active' : 'disabled' })}
          />
          <span>Enabled for comparisons</span>
        </label>
      </div>
      <p className="small muted">
        {p.version} · {p.type} · {p.implementation?.linesOfCode} lines across{' '}
        {p.implementation?.files?.length} files · interface:{' '}
        {p.implementation?.interface?.join(', ')}
      </p>
      <ErrorAlert error={state.error} />
      <div className="param-grid">
        {p.defaultConfig.parameters.map((x) => {
          const m = metaFor(p.name, x.name);
          return (
            <label key={x.name} className="field">
              <span className="label">{m.label}</span>
              {x.type === 'boolean' ? (
                <select
                  value={String(values[x.name])}
                  onChange={(e) => setValues({ ...values, [x.name]: e.target.value === 'true' })}
                >
                  <option value="true">Yes</option>
                  <option value="false">No</option>
                </select>
              ) : m.options ? (
                <select
                  value={String(values[x.name])}
                  onChange={(e) =>
                    setValues({
                      ...values,
                      [x.name]: x.type === 'number' ? Number(e.target.value) : e.target.value,
                    })
                  }
                >
                  {m.options.map((o) => (
                    <option key={o} value={String(o)}>
                      {m.names?.[String(o)] ?? o}
                    </option>
                  ))}
                </select>
              ) : (
                <input
                  type={x.type === 'number' ? 'number' : 'text'}
                  value={values[x.name]}
                  onChange={(e) =>
                    setValues({
                      ...values,
                      [x.name]: x.type === 'number' ? Number(e.target.value) : e.target.value,
                    })
                  }
                />
              )}
            </label>
          );
        })}
      </div>
      <div className="row">
        <button className="btn primary" onClick={() => save({ parameters: values })}>
          Save default parameters
        </button>
        {state.saved && (
          <span className="small" role="status" style={{ color: 'var(--good-text)' }}>
            Saved.
          </span>
        )}
      </div>
    </article>
  );
}

export default function Protocols() {
  const [items, setItems] = useState(null);
  const [error, setError] = useState(null);
  const load = useCallback(
    () =>
      api('/admin/protocols')
        .then((r) => setItems(r.items))
        .catch(setError),
    [],
  );
  useEffect(() => {
    load();
  }, [load]);
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Protocols</h1>
          <p>
            Default parameters (protocols.defaultConfig) and availability. Validated by each
            module's schema.
          </p>
        </div>
      </header>
      <ErrorAlert error={error} />
      {!items ? (
        <p role="status">Loading…</p>
      ) : (
        <div className="stack">
          {items.map((p) => (
            <ProtocolCard key={p._id} p={p} onSaved={load} />
          ))}
        </div>
      )}
    </>
  );
}
