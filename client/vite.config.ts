import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      "/api": "http://localhost:4000",
    },
  },
  // `vite preview` serves the production build, which is what the service worker and
  // offline queue are built for; it needs the same API proxy as the dev server.
  preview: {
    port: 4173,
    proxy: {
      "/api": "http://localhost:4000",
    },
  },
});
