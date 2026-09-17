import React from "react";
import ReactDOM from "react-dom/client";
import "leaflet/dist/leaflet.css";
import "leaflet-draw/dist/leaflet.draw.css";
import "./styles.css";
import "./dashboard.css";
import App from "./App";
import { parseIntakeHash } from "./pages/GuestReport";

// Offline support: the worker keeps the app shell available with no connection, and
// issues logged offline queue in IndexedDB (see src/offline/).
// A guest reporting a broken tap is a one-off visitor, so their phone is left alone.
if ("serviceWorker" in navigator && !parseIntakeHash(window.location.hash)) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch((err) => console.warn("Service worker not registered", err));
  });
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
