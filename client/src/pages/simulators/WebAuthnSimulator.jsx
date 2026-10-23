import { useState } from 'react';
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
} from '@simplewebauthn/browser';
import { api } from '../../lib/api.js';
import { ms } from '../../lib/format.js';
import { ErrorAlert } from '../../components/ui.jsx';

export default function WebAuthnSimulator() {
  const [log, setLog] = useState([]);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const supported = browserSupportsWebAuthn();

  const run = async (kind) => {
    setBusy(true);
    setError(null);
    try {
      const t0 = performance.now();
      const options = await api(
        `/simulator/webauthn/${kind === 'register' ? 'register' : 'authenticate'}/options`,
        { method: 'POST' },
      );
      const c0 = performance.now();
      const response =
        kind === 'register'
          ? await startRegistration({ optionsJSON: options })
          : await startAuthentication({ optionsJSON: options });
      const ceremonyMs = performance.now() - c0;
      const r = await api(
        `/simulator/webauthn/${kind === 'register' ? 'register' : 'authenticate'}/verify`,
        { method: 'POST', body: { response } },
      );
      setLog((l) =>
        [
          {
            at: new Date(),
            kind,
            ok: r.ok ?? true,
            reason: r.reason,
            serverMs: r.serverVerifyTimeMs,
            ceremonyMs,
            totalMs: performance.now() - t0,
          },
          ...l,
        ].slice(0, 10),
      );
    } catch (e) {
      setError(
        e.name === 'NotAllowedError'
          ? new Error('The browser prompt was cancelled or timed out.')
          : e,
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-2">
      <section className="card" aria-labelledby="wa-h">
        <h2 id="wa-h">Register and authenticate</h2>
        <p className="small">
          W3C WebAuthn ceremonies through your browser. The server checks the challenge, origin, RP
          ID and signature.
        </p>
        <p className="note">
          No passkey hardware? In Chrome open DevTools → ⋮ → More tools → <strong>WebAuthn</strong>,
          tick “Enable virtual authenticator environment” and add a ctap2 / internal authenticator.
          Benchmarks use the same Virtual Authenticator API automatically.
        </p>
        {!supported && <div className="alert error">This browser does not support WebAuthn.</div>}
        <ErrorAlert error={error} />
        <div className="row">
          <button
            className="btn primary"
            disabled={busy || !supported}
            onClick={() => run('register')}
          >
            Register a credential
          </button>
          <button className="btn" disabled={busy || !supported} onClick={() => run('authenticate')}>
            Authenticate
          </button>
        </div>
      </section>
      <section className="card" aria-labelledby="walog-h">
        <h2 id="walog-h">Ceremonies</h2>
        {log.length === 0 ? (
          <p className="muted small">Nothing yet.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Ceremony</th>
                <th>Result</th>
                <th className="num">Server verify</th>
                <th className="num">Browser ceremony</th>
                <th className="num">Total</th>
              </tr>
            </thead>
            <tbody>
              {log.map((l, i) => (
                <tr key={i}>
                  <td>{l.kind === 'register' ? 'Registration' : 'Authentication'}</td>
                  <td>{l.ok ? '✓' : `✕ ${l.reason}`}</td>
                  <td className="num">{ms(l.serverMs)}</td>
                  <td className="num">{ms(l.ceremonyMs)}</td>
                  <td className="num">{ms(l.totalMs)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
        <p className="small muted" style={{ marginTop: 8 }}>
          Browser ceremony and total include your interaction time; server verify is the server's
          compute.
        </p>
      </section>
    </div>
  );
}
