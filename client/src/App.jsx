import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { useAuth } from './auth/AuthContext.jsx';
import Layout from './components/Layout.jsx';
import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import MfaChallenge from './pages/MfaChallenge.jsx';
import Dashboard from './pages/Dashboard.jsx';
import Configure from './pages/Configure.jsx';
import Monitor from './pages/Monitor.jsx';
import Results from './pages/Results.jsx';
import History from './pages/History.jsx';
import Simulators from './pages/simulators/Simulators.jsx';
import Credentials from './pages/Credentials.jsx';
import AdminUsers from './pages/admin/Users.jsx';
import AdminProtocols from './pages/admin/Protocols.jsx';
import AdminAudit from './pages/admin/AuditLogs.jsx';
import NotFound from './pages/NotFound.jsx';

function Protected({ children, role }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading)
    return (
      <p className="main" role="status">
        Loading…
      </p>
    );
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (role && user.role !== role) return <Navigate to="/" replace />;
  return children;
}

/** Route map follows Figure 3.6: Login → Dashboard → Configure → Monitor → Results → History. */
export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />
      <Route path="/mfa" element={<MfaChallenge />} />
      <Route
        element={
          <Protected>
            <Layout />
          </Protected>
        }
      >
        <Route index element={<Dashboard />} />
        <Route path="configure" element={<Configure />} />
        <Route path="jobs/:id/monitor" element={<Monitor />} />
        <Route path="jobs/:id/results" element={<Results />} />
        <Route path="history" element={<History />} />
        <Route path="simulators/:protocol?" element={<Simulators />} />
        <Route path="credentials" element={<Credentials />} />
        <Route
          path="admin/users"
          element={
            <Protected role="admin">
              <AdminUsers />
            </Protected>
          }
        />
        <Route
          path="admin/protocols"
          element={
            <Protected role="admin">
              <AdminProtocols />
            </Protected>
          }
        />
        <Route
          path="admin/audit"
          element={
            <Protected role="admin">
              <AdminAudit />
            </Protected>
          }
        />
        <Route path="*" element={<NotFound />} />
      </Route>
    </Routes>
  );
}
