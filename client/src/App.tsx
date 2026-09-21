import { HashRouter, Link, Navigate, NavLink, Outlet, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import { api } from "./api";
import { ROLE_LABELS, type AuthUser } from "./types";
import Login from "./pages/Login";
import PropertiesList from "./pages/PropertiesList";
import PropertyWorkspace from "./pages/PropertyWorkspace";
import Report from "./pages/Report";
import Technicians from "./pages/Technicians";
import Access from "./pages/Access";
import Account from "./pages/Account";
import Activity from "./pages/Activity";
import DashboardLayout from "./dashboard/DashboardLayout";
import NotificationBell from "./notifications/NotificationBell";
import ActiveTimer from "./time/ActiveTimer";
import OfflineBar from "./offline/OfflineBar";
import MyDay from "./pages/MyDay";
import Settings from "./pages/Settings";
import Schedules from "./pages/Schedules";
import Rota from "./pages/Rota";
import Planner from "./pages/Planner";
import Reports from "./pages/Reports";
import { SettingsProvider } from "./settings/SettingsContext";
import MapDashboard from "./dashboard/MapDashboard";
import DepartureBoard from "./dashboard/DepartureBoard";
import TicketBoard from "./dashboard/TicketBoard";
import SummaryBoard from "./dashboard/SummaryBoard";
import TvView from "./dashboard/TvView";
import GuestReport, { parseIntakeHash } from "./pages/GuestReport";
import Requests from "./pages/Requests";
import Scheduler from "./pages/Scheduler";
import CrewMap from "./pages/CrewMap";
import Inspections from "./inspections/Inspections";
import InspectionRun from "./inspections/InspectionRun";
import InspectionReport from "./inspections/InspectionReport";
import Projects from "./inspections/Projects";
import { useEffect, useState } from "react";

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

/** The Requests link carries the number waiting, so nobody has to remember to look. */
function RequestsLink() {
  const [pending, setPending] = useState(0);
  useEffect(() => {
    let alive = true;
    const check = () =>
      api
        .guestReportPendingCount()
        .then((r) => alive && setPending(r.pendingCount))
        .catch(() => {});
    check();
    const timer = setInterval(check, 60000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, []);
  return (
    <NavLink to="/requests">
      Requests
      {pending > 0 && <span className="nav-count">{pending}</span>}
    </NavLink>
  );
}

function MainLayout({ user, onLogout }: { user: AuthUser; onLogout: () => void }) {
  const isAdmin = user.role === "admin";
  return (
    <div className="app-shell">
      <header className="app-header">
        <div className="app-header-left">
          <Link to="/" className="app-title">
            <BrandMark />
            <span className="hide-mobile">MaintenanceMap</span>
          </Link>
          <nav className="app-nav" aria-label="Main">
            {(user.technicianId || isAdmin) && <NavLink to="/today">Today</NavLink>}
            <NavLink to="/properties">Properties</NavLink>
            <NavLink to="/inspections">Inspections</NavLink>
            {isAdmin && <NavLink to="/projects">Projects</NavLink>}
            {isAdmin && <NavLink to="/technicians">Technicians</NavLink>}
            {isAdmin && <NavLink to="/scheduler">Scheduler</NavLink>}
            {isAdmin && <NavLink to="/crew">Crew map</NavLink>}
            {isAdmin && <NavLink to="/schedules">Schedules</NavLink>}
            <NavLink to="/dashboard">Dashboards</NavLink>
            {isAdmin && <RequestsLink />}
            {isAdmin && <NavLink to="/reports">Reports</NavLink>}
            {isAdmin && <NavLink to="/activity">Activity</NavLink>}
            {isAdmin && <NavLink to="/access">Access</NavLink>}
            {isAdmin && <NavLink to="/settings">Settings</NavLink>}
          </nav>
        </div>
        <div className="app-header-right">
          {user.technicianId && <ActiveTimer />}
          <NotificationBell />
          {isAdmin && (
            <a className="btn btn-ghost btn-small hide-mobile" href={api.exportIssuesUrl()} download title="Download every issue across all properties as a spreadsheet">
              Export CSV
            </a>
          )}
          <Link to="/account" className="app-header-user hide-mobile" title="Your account">
            {user.technician?.name ?? user.username} · {ROLE_LABELS[user.role]}
          </Link>
          <button type="button" className="btn btn-ghost btn-small" onClick={onLogout}>
            Sign out
          </button>
        </div>
      </header>
      <OfflineBar />
      <main className="app-main">
        <Outlet />
      </main>
    </div>
  );
}

function DashboardRoutes() {
  return (
    <Route path="/dashboard" element={<DashboardLayout />}>
      <Route index element={<TvView />} />
      <Route path="map" element={<MapDashboard />} />
      <Route path="board" element={<DepartureBoard />} />
      <Route path="tickets" element={<TicketBoard />} />
      <Route path="summary" element={<SummaryBoard />} />
    </Route>
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

  const user = state.user;

  if (user.mustChangePassword) {
    return <Account forced />;
  }

  if (user.role === "display") {
    return (
      <HashRouter>
        <Routes>
          {DashboardRoutes()}
          <Route path="*" element={<Navigate to="/dashboard" replace />} />
        </Routes>
      </HashRouter>
    );
  }

  const isAdmin = user.role === "admin";

  return (
    <HashRouter>
      <Routes>
        <Route element={<MainLayout user={user} onLogout={() => logout()} />}>
          <Route path="/" element={<Navigate to={user.role === "technician" ? "/today" : "/properties"} replace />} />
          <Route path="/properties" element={<PropertiesList />} />
          {(user.technicianId || isAdmin) && <Route path="/today" element={<MyDay />} />}
          {(user.technicianId || isAdmin) && <Route path="/planner" element={<Planner />} />}
          <Route path="/properties/:id" element={<PropertyWorkspace />} />
          <Route path="/properties/:id/report" element={<Report />} />
          <Route path="/inspections" element={<Inspections />} />
          <Route path="/inspections/:id" element={<InspectionRun />} />
          <Route path="/inspections/:id/report" element={<InspectionReport />} />
          {isAdmin && <Route path="/projects" element={<Projects />} />}
          <Route path="/account" element={<Account />} />
          {isAdmin && <Route path="/technicians" element={<Technicians />} />}
          {isAdmin && <Route path="/technicians/rota" element={<Rota />} />}
          {isAdmin && <Route path="/scheduler" element={<Scheduler />} />}
          {isAdmin && <Route path="/crew" element={<CrewMap />} />}
          {isAdmin && <Route path="/schedules" element={<Schedules />} />}
          {isAdmin && <Route path="/requests" element={<Requests />} />}
          {isAdmin && <Route path="/reports" element={<Reports />} />}
          {isAdmin && <Route path="/activity" element={<Activity />} />}
          {isAdmin && <Route path="/access" element={<Access />} />}
          {isAdmin && <Route path="/settings" element={<Settings />} />}
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
        {DashboardRoutes()}
      </Routes>
    </HashRouter>
  );
}

export default function App() {
  // The guest reporting form is public. It is checked before anything else so no session
  // is fetched, no login screen flashes up, and nothing of the app is loaded around it.
  const [intake, setIntake] = useState(() => parseIntakeHash(window.location.hash));
  useEffect(() => {
    const onHash = () => setIntake(parseIntakeHash(window.location.hash));
    window.addEventListener("hashchange", onHash);
    return () => window.removeEventListener("hashchange", onHash);
  }, []);

  if (intake) return <GuestReport token={intake.token} room={intake.room} />;

  return (
    <AuthProvider>
      <SettingsProvider>
        <AppRoutes />
      </SettingsProvider>
    </AuthProvider>
  );
}
