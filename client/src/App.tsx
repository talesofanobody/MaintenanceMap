import { HashRouter, Link, Navigate, NavLink, Outlet, Route, Routes, useLocation } from "react-router-dom";
import { AuthProvider, useAuth, useCan } from "./auth/AuthContext";
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
import InspectionsReport from "./inspections/InspectionsReport";
import Projects from "./inspections/Projects";
import Walkthrough from "./inspections/Walkthrough";
import { useEffect, useRef, useState } from "react";

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
  // Gated on what the login may do rather than on its role name, so a new role
  // gets the right nav from the capability table without touching this file.
  const can = useCan();
  const [menuOpen, setMenuOpen] = useState(false);
  const location = useLocation();
  const toggleRef = useRef<HTMLButtonElement>(null);

  // Going somewhere closes it. Without this the drawer sits over the page you
  // just asked for, which on a phone makes every navigation two taps.
  useEffect(() => {
    setMenuOpen(false);
  }, [location.pathname]);

  // Escape closes it and hands focus back to the button that opened it, so a
  // keyboard does not end up somewhere off-screen.
  useEffect(() => {
    if (!menuOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      setMenuOpen(false);
      toggleRef.current?.focus();
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [menuOpen]);

  return (
    <div className={`app-shell${menuOpen ? " is-menu-open" : ""}`}>
      <header className="app-header">
        <div className="app-header-left">
          <button
            ref={toggleRef}
            type="button"
            className="nav-toggle"
            aria-expanded={menuOpen}
            aria-controls="main-nav"
            aria-label={menuOpen ? "Close the menu" : "Open the menu"}
            onClick={() => setMenuOpen((open) => !open)}
          >
            <span className="nav-toggle-bars" aria-hidden="true">
              <i />
              <i />
              <i />
            </span>
          </button>
          <Link to="/" className="app-title">
            <BrandMark />
            <span>MaintenanceMap</span>
          </Link>
        </div>
        <div className="app-header-right">
          {user.technicianId && <ActiveTimer />}
          <NotificationBell />
          {can("export.view") && (
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
      {/* Clicking away is how a drawer is dismissed on every platform. */}
      <div className="nav-scrim" onClick={() => setMenuOpen(false)} aria-hidden="true" />

      {/**
        * Fourteen destinations. In a row they were unreadable and the last few
        * scrolled off the end; in a column they need grouping or they are just a
        * long list. The headings are the reason for moving it, not the drawer.
        */}
      <nav id="main-nav" className="app-nav" aria-label="Main">
        <p className="nav-group-label">Work</p>
        {(user.technicianId || can("issue.assign")) && <NavLink to="/today">Today</NavLink>}
        <NavLink to="/inspections">Inspections</NavLink>
        {can("inspection.run") && <NavLink to="/walkthrough">Walk-through</NavLink>}
        {can("project.write") && <NavLink to="/projects">Projects</NavLink>}
        {can("issue.assign") && <NavLink to="/scheduler">Scheduler</NavLink>}
        {can("request.review") && <RequestsLink />}

        <p className="nav-group-label">Places</p>
        <NavLink to="/properties">Properties</NavLink>
        {can("issue.assign") && <NavLink to="/crew">Crew map</NavLink>}
        {can("schedule.write") && <NavLink to="/schedules">Schedules</NavLink>}

        {can("technician.write") && <p className="nav-group-label">People</p>}
        {can("technician.write") && <NavLink to="/team">Team</NavLink>}

        <p className="nav-group-label">Looking back</p>
        <NavLink to="/dashboard">Dashboards</NavLink>
        {can("insights.view") && <NavLink to="/reports">Reports</NavLink>}
        {can("activity.view") && <NavLink to="/activity">Activity</NavLink>}

        {(can("user.manage") || can("settings.write")) && <p className="nav-group-label">Setup</p>}
        {can("user.manage") && <NavLink to="/access">Access</NavLink>}
        {can("settings.write") && <NavLink to="/settings">Settings</NavLink>}

        <div className="nav-drawer-foot">
          <Link to="/account" className="nav-account">
            {user.technician?.name ?? user.username} · {ROLE_LABELS[user.role]}
          </Link>
        </div>
      </nav>

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

  // Routes gated the same way as the nav. The server checks every call anyway;
  // this is so nobody is shown a page that will only tell them no.
  const caps = new Set(user.capabilities ?? []);
  const able = (c: string) => caps.has(c);

  return (
    <HashRouter>
      <Routes>
        <Route element={<MainLayout user={user} onLogout={() => logout()} />}>
          <Route path="/" element={<Navigate to={user.role === "technician" ? "/today" : "/properties"} replace />} />
          <Route path="/properties" element={<PropertiesList />} />
          {(user.technicianId || able("issue.assign")) && <Route path="/today" element={<MyDay />} />}
          {(user.technicianId || able("issue.assign")) && <Route path="/planner" element={<Planner />} />}
          <Route path="/properties/:id" element={<PropertyWorkspace />} />
          <Route path="/properties/:id/report" element={<Report />} />
          <Route path="/inspections" element={<Inspections />} />
          <Route path="/inspections/report" element={<InspectionsReport />} />
          <Route path="/inspections/:id" element={<InspectionRun />} />
          <Route path="/inspections/:id/report" element={<InspectionReport />} />
          {able("inspection.run") && <Route path="/walkthrough" element={<Walkthrough />} />}
          {able("inspection.run") && <Route path="/walkthrough/:id" element={<Walkthrough />} />}
          {able("project.write") && <Route path="/projects" element={<Projects />} />}
          <Route path="/account" element={<Account />} />
          {able("technician.write") && <Route path="/team" element={<Technicians />} />}
          {able("technician.write") && <Route path="/team/rota" element={<Rota />} />}
          {/* The page was called Technicians until the team grew past the trades.
              Anyone's bookmark or pinned tab still lands in the right place. */}
          <Route path="/technicians" element={<Navigate to="/team" replace />} />
          <Route path="/technicians/rota" element={<Navigate to="/team/rota" replace />} />
          {able("issue.assign") && <Route path="/scheduler" element={<Scheduler />} />}
          {able("issue.assign") && <Route path="/crew" element={<CrewMap />} />}
          {able("schedule.write") && <Route path="/schedules" element={<Schedules />} />}
          {able("request.review") && <Route path="/requests" element={<Requests />} />}
          {able("insights.view") && <Route path="/reports" element={<Reports />} />}
          {able("activity.view") && <Route path="/activity" element={<Activity />} />}
          {able("user.manage") && <Route path="/access" element={<Access />} />}
          {able("settings.write") && <Route path="/settings" element={<Settings />} />}
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
