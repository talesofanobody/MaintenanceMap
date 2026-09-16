import { HashRouter, Link, NavLink, Outlet, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import Login from "./pages/Login";
import PropertiesList from "./pages/PropertiesList";
import PropertyWorkspace from "./pages/PropertyWorkspace";
import Report from "./pages/Report";
import Technicians from "./pages/Technicians";
import DashboardLayout from "./dashboard/DashboardLayout";
import MapDashboard from "./dashboard/MapDashboard";
import DepartureBoard from "./dashboard/DepartureBoard";
import SummaryBoard from "./dashboard/SummaryBoard";
import TvView from "./dashboard/TvView";

export function BrandMark() {
  return (
    <svg className="brand-mark" viewBox="0 0 40 48" aria-hidden="true">
      <g fill="#2563eb" stroke="#fff" strokeWidth="2.5">
        <path d="M14 33 L20 47 L26 33 Z" />
        <circle cx="20" cy="20" r="17" />
      </g>
      <path d="M13 21 l5 5 l10 -11" fill="none" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function MainLayout({ username, onLogout }: { username: string; onLogout: () => void }) {
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-left">
          <Link to="/" className="app-title">
            <BrandMark />
            <span className="hide-mobile">MaintenanceMap</span>
          </Link>
          <nav className="app-nav" aria-label="Main">
            <NavLink to="/" end>
              Properties
            </NavLink>
            <NavLink to="/technicians">Technicians</NavLink>
            <NavLink to="/dashboard">Dashboards</NavLink>
          </nav>
        </div>
        <div className="app-header-right">
          <span className="app-header-user hide-mobile">{username}</span>
          <button type="button" className="btn btn-ghost btn-small" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </header>
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}

function AppRoutes() {
  const { state, logout } = useAuth();

  if (state.status === "loading") {
    return <div className="page loading-state">Loading…</div>;
  }

  if (state.status === "needs-setup" || state.status === "anonymous") {
    return <Login />;
  }

  return (
    <HashRouter>
      <Routes>
        <Route element={<MainLayout username={state.username} onLogout={() => logout()} />}>
          <Route path="/" element={<PropertiesList />} />
          <Route path="/properties/:id" element={<PropertyWorkspace />} />
          <Route path="/properties/:id/report" element={<Report />} />
          <Route path="/technicians" element={<Technicians />} />
        </Route>
        <Route path="/dashboard" element={<DashboardLayout />}>
          <Route index element={<TvView />} />
          <Route path="map" element={<MapDashboard />} />
          <Route path="board" element={<DepartureBoard />} />
          <Route path="summary" element={<SummaryBoard />} />
        </Route>
      </Routes>
    </HashRouter>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppRoutes />
    </AuthProvider>
  );
}
