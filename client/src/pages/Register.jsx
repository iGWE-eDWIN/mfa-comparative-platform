import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { api } from '../lib/api.js';
import { useAuth } from '../auth/AuthContext.jsx';
import { ErrorAlert, Field } from '../components/ui.jsx';

/** Client-side checks mirror the server's Zod schema; the server remains authoritative. */
export function validateRegistration(f) {
  const e = {};
  if (!/^[a-zA-Z0-9_.-]{3,32}$/.test(f.username))
    e.username = '3–32 characters: letters, digits, _ . -';
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email)) e.email = 'Enter a valid email address';
  if (f.password.length < 10) e.password = 'At least 10 characters';
  if (f.confirmPassword !== f.password) e.confirmPassword = 'Passwords do not match';
  return e;
}

export default function Register() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', email: '', password: '', confirmPassword: '' });
  const [touched, setTouched] = useState({});
  const [error, setError] = useState(null);
  const [busy, setBusy] = useState(false);
  if (user) return <Navigate to="/" replace />;
  const errors = validateRegistration(form);
  const show = (k) => (touched[k] ? errors[k] : undefined);
  const bind = (k) => ({
    value: form[k],
    onChange: (e) => setForm({ ...form, [k]: e.target.value }),
    onBlur: () => setTouched({ ...touched, [k]: true }),
  });

  const submit = async (e) => {
    e.preventDefault();
    setTouched({ username: true, email: true, password: true, confirmPassword: true });
    if (Object.keys(errors).length) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api('/auth/register', { method: 'POST', body: form });
      setUser(r.user);
      navigate('/');
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <main className="card auth-card" id="main">
        <h1>Create an account</h1>
        <form onSubmit={submit} noValidate>
          <ErrorAlert error={error} />
          <Field label="Username" error={show('username')}>
            {(p) => <input {...p} type="text" autoComplete="username" {...bind('username')} />}
          </Field>
          <Field label="Email" error={show('email')}>
            {(p) => <input {...p} type="email" autoComplete="email" {...bind('email')} />}
          </Field>
          <Field
            label="Password"
            hint="At least 10 characters. Length matters more than symbols."
            error={show('password')}
          >
            {(p) => (
              <input {...p} type="password" autoComplete="new-password" {...bind('password')} />
            )}
          </Field>
          <Field label="Confirm password" error={show('confirmPassword')}>
            {(p) => (
              <input
                {...p}
                type="password"
                autoComplete="new-password"
                {...bind('confirmPassword')}
              />
            )}
          </Field>
          <button className="btn primary" type="submit" disabled={busy} style={{ width: '100%' }}>
            {busy ? 'Creating…' : 'Create account'}
          </button>
        </form>
        <p className="small" style={{ marginTop: 16 }}>
          Already registered? <Link to="/login">Sign in</Link>
        </p>
      </main>
    </div>
  );
}
