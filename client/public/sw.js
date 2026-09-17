/* MaintenanceMap service worker.
 *
 * Keeps the app shell available with no connection so a walk-round can carry on;
 * issues and photos logged offline are queued in IndexedDB by the page itself
 * (see src/offline/) and sent when the connection returns.
 *
 * API calls are never served from the cache: stale maintenance data would be worse
 * than an honest error.
 */
const VERSION = "mm-v1";
const SHELL = `${VERSION}-shell`;
const ASSETS = `${VERSION}-assets`;

// Paths the dev server owns; caching them would fight hot reloading.
const DEV_PATHS = ["/src/", "/@vite", "/@react-refresh", "/@fs", "/node_modules/"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL)
      .then((cache) => cache.addAll(["/", "/index.html", "/manifest.webmanifest", "/icon.svg"]).catch(() => undefined))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

function isDevPath(url) {
  return DEV_PATHS.some((p) => url.pathname.startsWith(p));
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;
  if (url.pathname.startsWith("/api/")) return; // Always live.
  if (isDevPath(url)) return;

  // Navigations: try the network, fall back to the cached shell when offline.
  if (request.mode === "navigate") {
    event.respondWith(
      fetch(request)
        .then((response) => {
          const copy = response.clone();
          caches.open(SHELL).then((cache) => cache.put("/index.html", copy));
          return response;
        })
        .catch(() => caches.match("/index.html").then((cached) => cached ?? Response.error()))
    );
    return;
  }

  // Built assets are content-hashed, so serve them from the cache first.
  event.respondWith(
    caches.match(request).then((cached) => {
      const network = fetch(request)
        .then((response) => {
          if (response.ok && (response.type === "basic" || response.type === "default")) {
            const copy = response.clone();
            caches.open(ASSETS).then((cache) => cache.put(request, copy));
          }
          return response;
        })
        .catch(() => cached ?? Response.error());
      return cached ?? network;
    })
  );
});

// The page asks for a flush when it comes back online, or when the user taps Sync.
self.addEventListener("message", (event) => {
  if (event.data === "mm-skip-waiting") self.skipWaiting();
});
