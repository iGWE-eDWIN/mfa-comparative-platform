import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext.jsx';
import ThemeToggle from './ThemeToggle.jsx';

const link = ({ isActive }) => `nav-link${isActive ? ' active' : ''}`;

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [location.pathname]);

  return (
    <div className="shell">
      <a href="#main" className="skip-link">
        Skip to content
      </a>
      <nav className="sidebar" aria-label="Main navigation" data-open={open}>
        <div className="brand">
          MFA Comparative Platform
          <small>HOTP · TOTP · OOB Email · WebAuthn</small>
        </div>
        <button
          className="btn small menu-toggle"
          aria-expanded={open}
          aria-controls="nav-items"
          onClick={() => setOpen((o) => !o)}
        >
          Menu
        </button>
        <div className="nav-collapsible" id="nav-items">
          <span className="nav-group">Compare</span>
          <NavLink to="/" end className={link}>
            Dashboard
          </NavLink>
          <NavLink to="/configure" className={link}>
            New comparison
          </NavLink>
          <NavLink to="/history" className={link}>
            History &amp; export
          </NavLink>
          <span className="nav-group">Try a protocol</span>
          <NavLink to="/simulators" className={link}>
            Simulators
          </NavLink>
          <NavLink to="/credentials" className={link}>
            My factors
          </NavLink>
          {user?.role === 'admin' && (
            <>
              <span className="nav-group">Administration</span>
              <NavLink to="/admin/users" className={link}>
                Users
              </NavLink>
              <NavLink to="/admin/protocols" className={link}>
                Protocols
              </NavLink>
              <NavLink to="/admin/audit" className={link}>
                Audit logs
              </NavLink>
            </>
          )}
          <div className="sidebar-foot">
            <span>
              Signed in as <strong>{user?.username}</strong> ({user?.role})
            </span>
            <div className="row">
              <ThemeToggle />
              <button
                className="btn small"
                onClick={async () => {
                  await logout();
                  navigate('/login');
                }}
              >
                Sign out
              </button>
            </div>
          </div>
        </div>
      </nav>
      <main id="main" className="main" tabIndex={-1}>
        <Outlet />
      </main>
    </div>
  );
}
