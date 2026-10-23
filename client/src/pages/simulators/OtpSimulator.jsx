import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { ms } from '../../lib/format.js';
import { hotp, totp } from '../../lib/virtualToken.js';
import { ErrorAlert, Field } from '../../components/ui.jsx';

function VirtualToken({ protocol, enrol }) {
  const [counter, setCounter] = useState(0);
  const [code, setCode] = useState('');
  const [now, setNow] = useState(Date.now());
  const cfg = enrol.config;
  useEffect(() => {
    if (protocol !== 'TOTP') return undefined;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [protocol]);
  const step = Math.floor(now / 1000 / (cfg.timeStep ?? 30));
  useEffect(() => {
    let live = true;
    const p =
      protocol === 'HOTP'
        ? hotp(enrol.secretBase32, counter, cfg)
        : totp(enrol.secretBase32, { ...cfg, at: step * (cfg.timeStep ?? 30) * 1000 });
    p.then((c) => live && setCode(c));
    return () => {
      live = false;
    };
  }, [protocol, enrol, counter, step, cfg]);
  const remaining =
    protocol === 'TOTP'
      ? (cfg.timeStep ?? 30) - (Math.floor(now / 1000) % (cfg.timeStep ?? 30))
      : null;
  return (
    <div className="note">
      <p className="small">
        <strong>Virtual token</strong> (runs in this browser with WebCrypto; the secret is never
        sent back to the server).
      </p>
      <div className="row">
        <span className="token" aria-live="polite">
          {code}
        </span>
        {protocol === 'HOTP' ? (
          <button className="btn small" onClick={() => setCounter((c) => c + 1)}>
            Press button (counter {counter} → {counter + 1})
          </button>
        ) : (
          <span className="small">changes in {remaining}s</span>
        )}
      </div>
      {protocol === 'HOTP' && (
        <p className="small muted" style={{ marginTop: 6 }}>
          Pressing without logging in moves the token ahead of the server; up to{' '}
          {cfg.lookAheadWindow} presses are resynchronised automatically.
        </p>
      )}
    </div>
  );
}

export default function OtpSimulator({ protocol }) {
  const [opts, setOpts] = useState({ digits: 6, algorithm: 'SHA1' });
  const [enrol, setEnrol] = useState(null);
  const [code, setCode] = useState('');
  const [attempts, setAttempts] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);

  const start = async () => {
    setBusy(true);
    setError(null);
    try {
      setEnrol(
        await api(`/simulator/otp/${protocol.toLowerCase()}/enrol`, {
          method: 'POST',
          body: { config: opts },
        }),
      );
      setAttempts([]);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  };
  const verify = async (e) => {
    e.preventDefault();
    setError(null);
    try {
      const r = await api(`/simulator/otp/credentials/${enrol.credentialId}/verify`, {
        method: 'POST',
        body: { code },
      });
      setAttempts((a) => [{ at: new Date(), code, ...r }, ...a].slice(0, 10));
      setCode('');
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div className="grid grid-2">
      <section className="card" aria-labelledby="enrol-h">
        <h2 id="enrol-h">1. Enrol</h2>
        <p className="small">
          {protocol === 'HOTP'
            ? 'RFC 4226: the code depends on a shared secret and an event counter.'
            : 'RFC 6238: the code depends on a shared secret and the current 30-second time step.'}
        </p>
        <div className="row">
          <Field label="Digits">
            {(p) => (
              <select
                {...p}
                value={opts.digits}
                onChange={(e) => setOpts({ ...opts, digits: Number(e.target.value) })}
              >
                {[6, 7, 8].map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Algorithm">
            {(p) => (
              <select
                {...p}
                value={opts.algorithm}
                onChange={(e) => setOpts({ ...opts, algorithm: e.target.value })}
              >
                {['SHA1', 'SHA256', 'SHA512'].map((d) => (
                  <option key={d}>{d}</option>
                ))}
              </select>
            )}
          </Field>
        </div>
        <button className="btn primary" onClick={start} disabled={busy}>
          {enrol ? 'Enrol a new secret' : `Enrol ${protocol}`}
        </button>
        {enrol && (
          <div className="stack" style={{ marginTop: 16 }}>
            <img
              className="qr"
              src={enrol.qrDataUrl}
              alt={`QR code for enrolling the ${protocol} secret in an authenticator app`}
            />
            <p className="small">
              Scan with an authenticator app, or use the virtual token below. Secret (shown once):{' '}
              <code>{enrol.secretBase32}</code>
            </p>
            <VirtualToken protocol={protocol} enrol={enrol} />
          </div>
        )}
      </section>
      <section className="card" aria-labelledby="verify-h">
        <h2 id="verify-h">2. Verify a code</h2>
        <ErrorAlert error={error} />
        <form onSubmit={verify}>
          <Field label="One-time code">
            {(p) => (
              <input
                {...p}
                className="code-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={8}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                disabled={!enrol}
              />
            )}
          </Field>
          <button className="btn primary" disabled={!enrol || code.length < 6}>
            Verify
          </button>
        </form>
        {attempts.length > 0 && (
          <table style={{ marginTop: 16 }}>
            <caption>Attempts (try the same code twice to see replay protection)</caption>
            <thead>
              <tr>
                <th>Time</th>
                <th>Code</th>
                <th>Result</th>
                <th className="num">Server time</th>
              </tr>
            </thead>
            <tbody>
              {attempts.map((a, i) => (
                <tr key={i}>
                  <td>{a.at.toLocaleTimeString('en-GB')}</td>
                  <td className="mono">{a.code}</td>
                  <td>
                    {a.ok ? `✓ accepted${a.drift ? ` (drift ${a.drift})` : ''}` : `✕ ${a.reason}`}
                  </td>
                  <td className="num">{ms(a.serverTimeMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
