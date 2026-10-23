import { useState } from 'react';
import { api } from '../lib/api.js';
import { ErrorAlert, ProtocolName } from './ui.jsx';

function Group({ title, value, onChange }) {
  return (
    <fieldset style={{ border: 0, padding: 0, margin: '0 0 12px' }}>
      <legend className="label">{title}</legend>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Criterion</th>
              <th className="num">Score (1–5)</th>
              <th>Basis</th>
            </tr>
          </thead>
          <tbody>
            {value.criteria.map((c) => (
              <tr key={c.criterion}>
                <td>
                  {c.label}
                  {c.measured && <span className="small muted"> (measured)</span>}
                </td>
                <td className="num">
                  <select
                    aria-label={`${c.label} score`}
                    value={c.score}
                    disabled={c.measured}
                    onChange={(e) =>
                      onChange({
                        ...value,
                        criteria: value.criteria.map((x) =>
                          x.criterion === c.criterion ? { ...x, score: Number(e.target.value) } : x,
                        ),
                      })
                    }
                    style={{ width: 70 }}
                  >
                    {[1, 2, 3, 4, 5].map((n) => (
                      <option key={n} value={n}>
                        {n}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="small">{c.basis}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <label className="small" style={{ display: 'block', marginTop: 8 }}>
        Observations
        <textarea
          value={value.observations ?? ''}
          maxLength={2000}
          onChange={(e) => onChange({ ...value, observations: e.target.value })}
        />
      </label>
    </fieldset>
  );
}

/** FR12: structured usability and integration observations, editable by the job owner. */
export default function AssessmentEditor({ result, onSaved }) {
  const [integration, setIntegration] = useState(result.integrationAssessment);
  const [usability, setUsability] = useState(result.usabilityAssessment);
  const [state, setState] = useState({ busy: false, error: null, saved: false });

  const payload = (v) => ({
    scores: Object.fromEntries(
      v.criteria.filter((c) => !c.measured).map((c) => [c.criterion, c.score]),
    ),
    observations: v.observations ?? '',
  });
  const save = async () => {
    setState({ busy: true, error: null, saved: false });
    try {
      const r = await api(`/results/${result._id}/assessment`, {
        method: 'PATCH',
        body: { integration: payload(integration), usability: payload(usability) },
      });
      setIntegration(r.integrationAssessment);
      setUsability(r.usabilityAssessment);
      setState({ busy: false, error: null, saved: true });
      onSaved?.(result._id, r);
    } catch (error) {
      setState({ busy: false, error, saved: false });
    }
  };

  return (
    <details className="card">
      <summary>
        <ProtocolName name={result.protocolName} />: integration effort{' '}
        <strong>{integration.effortScore}</strong>/5 · usability <strong>{usability.score}</strong>
        /5
      </summary>
      <div style={{ marginTop: 12 }}>
        <p className="small muted">
          {integration.source}. Measured criteria are computed from the implementation; the others
          are the documented initial assessment and can be revised here.
          {integration.editedAt
            ? ` Last edited ${new Date(integration.editedAt).toLocaleString('en-GB')}.`
            : ''}
        </p>
        <ErrorAlert error={state.error} />
        <Group title="Integration effort" value={integration} onChange={setIntegration} />
        <Group title="Usability" value={usability} onChange={setUsability} />
        <div className="row">
          <button className="btn primary" onClick={save} disabled={state.busy}>
            {state.busy ? 'Saving…' : 'Save observations'}
          </button>
          {state.saved && (
            <span className="small" role="status" style={{ color: 'var(--good-text)' }}>
              Saved.
            </span>
          )}
        </div>
      </div>
    </details>
  );
}
