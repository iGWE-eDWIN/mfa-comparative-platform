import { useId } from 'react';
import { seriesVar } from '../lib/format.js';

export function Field({ label, hint, error, children, id: given }) {
  const auto = useId();
  const id = given ?? auto;
  const child =
    typeof children === 'function'
      ? children({
          id,
          'aria-invalid': error ? 'true' : undefined,
          'aria-describedby': hint || error ? `${id}-desc` : undefined,
        })
      : children;
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      {child}
      {(hint || error) && (
        <span id={`${id}-desc`} className={error ? 'error' : 'hint'}>
          {error || hint}
        </span>
      )}
    </div>
  );
}

const JOB_STATUS = {
  Completed: 'good',
  Running: 'warning',
  Pending: 'neutral',
  Failed: 'critical',
  Cancelled: 'serious',
};
export function JobStatus({ status }) {
  return (
    <span className={`badge status-${JOB_STATUS[status] ?? 'neutral'}`}>
      <span className="dot" aria-hidden="true" />
      {status}
    </span>
  );
}

const OUTCOME = {
  pass: ['good', '✓ Pass'],
  fail: ['critical', '✕ Fail'],
  'not-applicable': ['neutral', '– N/A'],
  error: ['serious', '! Error'],
};
export function Outcome({ status }) {
  const [tone, text] = OUTCOME[status] ?? ['neutral', status ?? '—'];
  return (
    <span className={`badge status-${tone}`}>
      <span className="dot" aria-hidden="true" />
      {text}
    </span>
  );
}

export function ProtocolName({ name }) {
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      <span className="swatch" style={{ background: seriesVar(name) }} aria-hidden="true" />
      {name}
    </span>
  );
}

export function ErrorAlert({ error }) {
  if (!error) return null;
  return (
    <div className="alert error" role="alert">
      {error.message ?? String(error)}
      {error.details?.length > 0 && (
        <ul className="small" style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          {error.details.map((d, i) => (
            <li key={i}>
              {d.path ? <code>{d.path}</code> : null} {d.message}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function Stat({ label, value, sub }) {
  return (
    <div className="stat">
      <span className="label">{label}</span>
      <span className="value">{value}</span>
      {sub && <span className="small muted">{sub}</span>}
    </div>
  );
}
