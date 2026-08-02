// Forge Service Worker — caches the app shell for offline access.
// Strategy: network-first for API, cache-first for static assets.
const CACHE = "forge-v1";
const ASSETS = ["/", "/manifest.json"];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  // Never cache API requests — always go to network.
  if (url.pathname.startsWith("/api/")) return;
  // For navigation requests, try network first, fall back to cache.
  if (e.request.mode === "navigate") {
    e.respondWith(
      fetch(e.request).catch(() => caches.match("/").then((r) => r || caches.match(e.request))),
    );
    return;
  }
  // For static assets, cache first, then network.
  e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
});
