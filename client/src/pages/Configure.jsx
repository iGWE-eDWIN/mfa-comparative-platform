import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { metaFor } from '../lib/params.js';
import { ErrorAlert, Field, ProtocolName } from '../components/ui.jsx';

const ORDER = ['HOTP', 'TOTP', 'OOB Email', 'WebAuthn'];

function ParamInput({ protocol, param, value, onChange }) {
  const m = metaFor(protocol, param.name);
  return (
    <Field label={m.label} hint={m.hint}>
      {(p) =>
        param.type === 'boolean' ? (
          <select
            {...p}
            value={String(value)}
            onChange={(e) => onChange(e.target.value === 'true')}
          >
            <option value="true">Yes</option>
            <option value="false">No</option>
          </select>
        ) : m.options ? (
          <select
            {...p}
            value={String(value)}
            onChange={(e) =>
              onChange(param.type === 'number' ? Number(e.target.value) : e.target.value)
            }
          >
            {m.options.map((o) => (
              <option key={o} value={String(o)}>
                {m.names?.[String(o)] ?? o}
              </option>
            ))}
          </select>
        ) : param.type === 'number' ? (
          <input
            {...p}
            type="number"
            min={m.min}
            max={m.max}
            value={value}
            onChange={(e) => onChange(e.target.value === '' ? '' : Number(e.target.value))}
          />
        ) : (
          <input {...p} type="text" value={value} onChange={(e) => onChange(e.target.value)} />
        )
      }
    </Field>
  );
}

/** Protocol selection & configuration (Figure 3.6; FR2, FR3). */
export default function Configure() {
  const navigate = useNavigate();
  const [protocols, setProtocols] = useState([]);
  const [selected, setSelected] = useState({});
  const [config, setConfig] = useState({});
  const [settings, setSettings] = useState({
    iterations: 200,
    warmupIterations: 20,
    timeoutSeconds: 600,
    operationTimeoutMs: 15000,
    runSecuritySimulations: true,
    label: '',
  });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api('/protocols')
      .then(({ items }) => {
        const sorted = ORDER.map((n) => items.find((p) => p.name === n)).filter(Boolean);
        setProtocols(sorted);
        setConfig(
          Object.fromEntries(
            sorted.map((p) => [
              p.name,
              Object.fromEntries(p.defaultConfig.parameters.map((x) => [x.name, x.value])),
            ]),
          ),
        );
        setSelected(
          Object.fromEntries(
            sorted.filter((p) => p.status === 'active').map((p) => [p.name, true]),
          ),
        );
      })
      .catch(setError);
  }, []);

  const chosen = protocols.filter((p) => selected[p.name]);
  const problems = useMemo(() => {
    const e = [];
    if (chosen.length === 0) e.push('Select at least one protocol.');
    if (!(settings.iterations >= 1 && settings.iterations <= 10000))
      e.push('Iterations must be between 1 and 10,000.');
    if (!(settings.warmupIterations >= 0 && settings.warmupIterations <= 1000))
      e.push('Warm-up must be between 0 and 1,000.');
    if (!(settings.timeoutSeconds >= 1)) e.push('Timeout must be at least 1 second.');
    return e;
  }, [chosen.length, settings]);

  const run = async (e) => {
    e.preventDefault();
    if (problems.length) return;
    setBusy(true);
    setError(null);
    try {
      const { job } = await api('/jobs', {
        method: 'POST',
        body: {
          protocols: chosen.map((p) => ({ name: p.name, config: config[p.name] })),
          iterations: settings.iterations,
          warmupIterations: settings.warmupIterations,
          timeoutMs: Math.round(settings.timeoutSeconds * 1000),
          operationTimeoutMs: settings.operationTimeoutMs,
          runSecuritySimulations: settings.runSecuritySimulations,
          label: settings.label,
        },
      });
      navigate(`/jobs/${job._id}/monitor`);
    } catch (err) {
      setError(err);
      setBusy(false);
    }
  };

  const set = (k) => (e) =>
    setSettings({
      ...settings,
      [k]:
        e.target.type === 'checkbox'
          ? e.target.checked
          : e.target.type === 'number'
            ? Number(e.target.value)
            : e.target.value,
    });

  return (
    <form onSubmit={run}>
      <header className="page-head">
        <div>
          <h1>New comparison</h1>
          <p>
            Select protocols, set their parameters, then run them all through the same benchmark
            procedure.
          </p>
        </div>
      </header>
      <ErrorAlert error={error} />
      <fieldset className="grid grid-2" style={{ border: 0, padding: 0, margin: 0 }}>
        <legend className="label" style={{ marginBottom: 8 }}>
          Protocols
        </legend>
        {protocols.map((p) => (
          <div key={p._id} className="protocol-option" data-selected={Boolean(selected[p.name])}>
            <label className="check">
              <input
                type="checkbox"
                checked={Boolean(selected[p.name])}
                disabled={p.status !== 'active'}
                onChange={(e) => setSelected({ ...selected, [p.name]: e.target.checked })}
              />
              <span>
                <strong>
                  <ProtocolName name={p.name} />
                </strong>
                <span className="small muted" style={{ display: 'block' }}>
                  {p.version}
                  {p.status !== 'active' ? ' · disabled by administrator' : ''}
                </span>
              </span>
            </label>
            {selected[p.name] && (
              <details open={false} style={{ marginTop: 8 }}>
                <summary className="small">Parameters</summary>
                <div className="param-grid">
                  {p.defaultConfig.parameters.map((param) => (
                    <ParamInput
                      key={param.name}
                      protocol={p.name}
                      param={param}
                      value={config[p.name]?.[param.name] ?? ''}
                      onChange={(v) =>
                        setConfig({ ...config, [p.name]: { ...config[p.name], [param.name]: v } })
                      }
                    />
                  ))}
                </div>
              </details>
            )}
          </div>
        ))}
      </fieldset>
      <section className="card" style={{ marginTop: 16 }} aria-labelledby="settings-h">
        <h2 id="settings-h">Benchmark settings</h2>
        <div className="param-grid" style={{ marginTop: 0 }}>
          <Field label="Iterations" hint="Measured authentications per protocol">
            {(p) => (
              <input
                {...p}
                type="number"
                min={1}
                max={10000}
                value={settings.iterations}
                onChange={set('iterations')}
              />
            )}
          </Field>
          <Field label="Warm-up iterations" hint="Run first and discarded">
            {(p) => (
              <input
                {...p}
                type="number"
                min={0}
                max={1000}
                value={settings.warmupIterations}
                onChange={set('warmupIterations')}
              />
            )}
          </Field>
          <Field label="Job timeout (s)" hint="Job fails if exceeded">
            {(p) => (
              <input
                {...p}
                type="number"
                min={1}
                value={settings.timeoutSeconds}
                onChange={set('timeoutSeconds')}
              />
            )}
          </Field>
          <Field label="Operation timeout (ms)" hint="Per execute/verify call">
            {(p) => (
              <input
                {...p}
                type="number"
                min={500}
                max={120000}
                value={settings.operationTimeoutMs}
                onChange={set('operationTimeoutMs')}
              />
            )}
          </Field>
          <Field label="Label (optional)">
            {(p) => (
              <input
                {...p}
                type="text"
                maxLength={100}
                value={settings.label}
                onChange={set('label')}
              />
            )}
          </Field>
        </div>
        <label className="check">
          <input
            type="checkbox"
            checked={settings.runSecuritySimulations}
            onChange={set('runSecuritySimulations')}
          />
          <span>
            Run controlled security simulations (phishing relay/origin, replay, brute force, expired
            code, desynchronisation)
          </span>
        </label>
        {problems.length > 0 && (
          <ul className="form-error" aria-live="polite">
            {problems.map((p) => (
              <li key={p}>{p}</li>
            ))}
          </ul>
        )}
        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary" type="submit" disabled={busy || problems.length > 0}>
            {busy ? 'Starting…' : 'Run Comparison'}
          </button>
          <span className="small muted">
            Every selected protocol runs the same procedure: initialise → warm-up → measured
            iterations → security checks.
          </span>
        </div>
      </section>
    </form>
  );
}
