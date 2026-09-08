import { HashRouter, Link, Route, Routes } from "react-router-dom";
import { AuthProvider, useAuth } from "./auth/AuthContext";
import Login from "./pages/Login";
import PropertiesList from "./pages/PropertiesList";
import PropertyWorkspace from "./pages/PropertyWorkspace";
import Report from "./pages/Report";

function AppShell() {
  const { state, logout } = useAuth();

  if (state.status === "loading") {
    return <div className="page">Loading…</div>;
  }

  if (state.status === "needs-setup" || state.status === "anonymous") {
    return <Login />;
  }

  return (
    <HashRouter>
      <div className="app-shell">
        <header className="app-header">
          <Link to="/" className="app-title">
            🗺️ MaintenanceMap
          </Link>
          <div className="app-header-right">
            <span className="app-header-user">{state.username}</span>
            <button className="btn btn-small" onClick={() => logout()}>
              Sign out
            </button>
          </div>
        </header>
        <main className="app-main">
          <Routes>
            <Route path="/" element={<PropertiesList />} />
            <Route path="/properties/:id" element={<PropertyWorkspace />} />
            <Route path="/properties/:id/report" element={<Report />} />
          </Routes>
        </main>
      </div>
    </HashRouter>
  );
}

export default function App() {
  return (
    <AuthProvider>
      <AppShell />
    </AuthProvider>
  );
}
