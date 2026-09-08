import { HashRouter, Link, Route, Routes } from "react-router-dom";
import PropertiesList from "./pages/PropertiesList";
import PropertyWorkspace from "./pages/PropertyWorkspace";
import Report from "./pages/Report";

export default function App() {
  return (
    <HashRouter>
      <div className="app-shell">
        <header className="app-header">
          <Link to="/" className="app-title">
            🗺️ MaintenanceMap
          </Link>
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
