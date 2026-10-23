import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { ErrorAlert, Field } from '../components/ui.jsx';

export default function Login() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [form, setForm] = useState({ identifier: '', password: '' });
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const r = await api('/auth/login', { method: 'POST', body: form });
      if (r.mfaRequired)
        return navigate('/mfa', { state: { method: r.method, from: location.state?.from } });
      setUser(r.user);
      navigate(location.state?.from ?? '/', { replace: true });
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <main className="card auth-card" id="main">
        <h1>Sign in</h1>
        <p className="muted">MFA Comparative Platform</p>
        <form onSubmit={submit} noValidate>
          <ErrorAlert error={error} />
          <Field label="Username or email">
            {(p) => (
              <input
                {...p}
                type="text"
                autoComplete="username"
                required
                value={form.identifier}
                onChange={(e) => setForm({ ...form, identifier: e.target.value })}
              />
            )}
          </Field>
          <Field label="Password">
            {(p) => (
              <input
                {...p}
                type="password"
                autoComplete="current-password"
                required
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
              />
            )}
          </Field>
          <button
            className="btn primary"
            type="submit"
            disabled={busy || !form.identifier || !form.password}
            style={{ width: '100%' }}
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </button>
        </form>
        <p className="small" style={{ marginTop: 16 }}>
          No account? <Link to="/register">Create one</Link>
        </p>
      </main>
    </div>
  );
}
