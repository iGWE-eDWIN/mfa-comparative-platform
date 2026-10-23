import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { startAuthentication } from '@simplewebauthn/browser';
import { api } from '../lib/api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { ErrorAlert, Field } from '../components/ui.jsx';

/** Second factor at sign-in, for users who chose a login factor (docs/DECISIONS.md D13). */
export default function MfaChallenge() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const { state } = useLocation();
  const method = state?.method;
  const [code, setCode] = useState('');
  const [oob, setOob] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  if (!method) return <Navigate to="/login" replace />;

  const done = (r) => {
    setUser(r.user);
    navigate(state?.from ?? '/', { replace: true });
  };
  const run = async (fn) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  const submitCode = (e) => {
    e.preventDefault();
    run(async () =>
      done(
        await api('/auth/mfa/verify', {
          method: 'POST',
          body: method === 'OOB Email' ? { code, challengeId: oob?.challengeId } : { code },
        }),
      ),
    );
  };

  return (
    <div className="auth-wrap">
      <main className="card auth-card" id="main">
        <h1>Second factor</h1>
        <p className="muted">Your account requires {method} to finish signing in.</p>
        <ErrorAlert error={error} />
        {method === 'WebAuthn' ? (
          <button
            className="btn primary"
            disabled={busy}
            onClick={() =>
              run(async () => {
                const options = await api('/auth/mfa/webauthn/options', { method: 'POST' });
                const response = await startAuthentication({ optionsJSON: options });
                done(await api('/auth/mfa/verify', { method: 'POST', body: { response } }));
              })
            }
          >
            Use passkey / security key
          </button>
        ) : (
          <form onSubmit={submitCode}>
            {method === 'OOB Email' && (
              <div className="stack" style={{ marginBottom: 12 }}>
                <button
                  type="button"
                  className="btn"
                  disabled={busy}
                  onClick={() =>
                    run(async () => setOob(await api('/auth/mfa/oob/send', { method: 'POST' })))
                  }
                >
                  {oob ? 'Resend code' : 'Email me a code'}
                </button>
                {oob && (
                  <p className="small" role="status">
                    Code sent to {oob.destination}.{' '}
                    {oob.delivery.previewUrl && (
                      <a href={oob.delivery.previewUrl} target="_blank" rel="noreferrer">
                        Open test mailbox
                      </a>
                    )}
                  </p>
                )}
              </div>
            )}
            <Field label="Code">
              {(p) => (
                <input
                  {...p}
                  className="code-input"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  maxLength={8}
                  value={code}
                  onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                />
              )}
            </Field>
            <button
              className="btn primary"
              type="submit"
              disabled={busy || code.length < 6 || (method === 'OOB Email' && !oob)}
            >
              Verify
            </button>
          </form>
        )}
        <p className="small" style={{ marginTop: 16 }}>
          <Link to="/login">Back to sign in</Link>
        </p>
      </main>
    </div>
  );
}
