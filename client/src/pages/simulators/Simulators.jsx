import { NavLink, Navigate, useParams } from 'react-router-dom';
import OtpSimulator from './OtpSimulator.jsx';
import OobSimulator from './OobSimulator.jsx';
import WebAuthnSimulator from './WebAuthnSimulator.jsx';

const TABS = [
  ['hotp', 'HOTP'],
  ['totp', 'TOTP'],
  ['oob', 'OOB Email'],
  ['webauthn', 'WebAuthn'],
];

/** Single-flow simulators (FR4): try each protocol manually and see the server-side timings. */
export default function Simulators() {
  const { protocol } = useParams();
  if (!protocol) return <Navigate to="/simulators/hotp" replace />;
  return (
    <>
      <header className="page-head">
        <div>
          <h1>Protocol simulators</h1>
          <p>
            Run one authentication flow by hand. Timings shown are measured on the server for this
            request.
          </p>
        </div>
      </header>
      <nav className="tabs" aria-label="Protocols">
        {TABS.map(([k, label]) => (
          <NavLink
            key={k}
            to={`/simulators/${k}`}
            className={({ isActive }) => (isActive ? 'active' : '')}
          >
            {label}
          </NavLink>
        ))}
      </nav>
      {protocol === 'hotp' && <OtpSimulator key="hotp" protocol="HOTP" />}
      {protocol === 'totp' && <OtpSimulator key="totp" protocol="TOTP" />}
      {protocol === 'oob' && <OobSimulator />}
      {protocol === 'webauthn' && <WebAuthnSimulator />}
    </>
  );
}
