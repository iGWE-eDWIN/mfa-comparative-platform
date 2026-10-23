import { useEffect, useState } from 'react';
import { api } from '../../lib/api.js';
import { ms } from '../../lib/format.js';
import { ErrorAlert, Field } from '../../components/ui.jsx';

export default function OobSimulator() {
  const [sent, setSent] = useState(null);
  const [code, setCode] = useState('');
  const [result, setResult] = useState(null);
  const [inbox, setInbox] = useState(null);
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const send = async () => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      setSent(await api('/simulator/oob/send', { method: 'POST' }));
      setInbox(null);
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
      setResult(
        await api('/simulator/oob/verify', {
          method: 'POST',
          body: { challengeId: sent.challengeId, code },
        }),
      );
    } catch (err) {
      setError(err);
    }
  };
  const secs = (d) => Math.max(0, Math.ceil((new Date(d) - now) / 1000));

  return (
    <div className="grid grid-2">
      <section className="card" aria-labelledby="send-h">
        <h2 id="send-h">1. Send a code by email</h2>
        <p className="small">
          A 6-digit code from <code>crypto.randomInt</code> is stored only as a salted HMAC-SHA-256,
          expires after 5 minutes, works once and allows 5 attempts. Resending has a 30-second
          cooldown.
        </p>
        <button
          className="btn primary"
          onClick={send}
          disabled={busy || (sent && secs(sent.resendAvailableAt) > 0)}
        >
          {sent
            ? secs(sent.resendAvailableAt) > 0
              ? `Resend in ${secs(sent.resendAvailableAt)}s`
              : 'Resend code'
            : 'Send code'}
        </button>
        {sent && (
          <dl
            className="small"
            style={{
              display: 'grid',
              gridTemplateColumns: 'auto 1fr',
              gap: '4px 12px',
              marginTop: 12,
            }}
            aria-live="polite"
          >
            <dt className="muted">Sent to</dt>
            <dd style={{ margin: 0 }}>{sent.destination}</dd>
            <dt className="muted">Provider</dt>
            <dd style={{ margin: 0 }}>
              {sent.delivery.provider} · {sent.delivery.tls}
            </dd>
            <dt className="muted">Generation + hashing</dt>
            <dd style={{ margin: 0 }}>{ms(sent.generationTimeMs)} (server compute)</dd>
            <dt className="muted">Email send time</dt>
            <dd style={{ margin: 0 }}>{ms(sent.delivery.sendTimeMs)} (provider/network)</dd>
            <dt className="muted">Expires in</dt>
            <dd style={{ margin: 0 }}>{secs(sent.expiresAt)} s</dd>
          </dl>
        )}
        {sent?.delivery.fallbackReason && <p className="note">{sent.delivery.fallbackReason}</p>}
        {sent?.delivery.previewUrl && (
          <p>
            <a href={sent.delivery.previewUrl} target="_blank" rel="noreferrer">
              Open the message in the Ethereal test mailbox
            </a>
          </p>
        )}
        {sent?.delivery.provider === 'local' && (
          <div style={{ marginTop: 8 }}>
            <button
              className="btn small"
              onClick={() =>
                api('/simulator/oob/inbox')
                  .then((r) => setInbox(r.messages))
                  .catch(setError)
              }
            >
              Open development inbox
            </button>
            {inbox && (
              <ul className="small">
                {inbox.slice(0, 3).map((m) => (
                  <li key={m.id}>
                    <span className="muted">
                      {new Date(m.receivedAt).toLocaleTimeString('en-GB')}{' '}
                      {m.secure ? '(TLS)' : '(plaintext!)'}
                    </span>{' '}
                    {m.text}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>
      <section className="card" aria-labelledby="v-h">
        <h2 id="v-h">2. Enter the code</h2>
        <ErrorAlert error={error} />
        <form onSubmit={verify}>
          <Field label="Code from the email">
            {(p) => (
              <input
                {...p}
                className="code-input"
                inputMode="numeric"
                autoComplete="one-time-code"
                maxLength={8}
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
                disabled={!sent}
              />
            )}
          </Field>
          <button className="btn primary" disabled={!sent || code.length < 6}>
            Verify
          </button>
        </form>
        {result && (
          <div
            className={`alert ${result.ok ? 'ok' : 'error'}`}
            role="status"
            style={{ marginTop: 12 }}
          >
            {result.ok
              ? '✓ Accepted'
              : `✕ Rejected: ${result.reason}${result.attemptsLeft !== undefined ? ` (${result.attemptsLeft} attempts left)` : ''}`}{' '}
            · server verification {ms(result.serverTimeMs)}
          </div>
        )}
      </section>
    </div>
  );
}
