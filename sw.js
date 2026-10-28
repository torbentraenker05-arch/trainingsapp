// Service Worker: App offline verfügbar machen. Bei jeder Änderung VERSION erhöhen.
const VERSION = "v1";
const CACHE = "trainingsbuch-" + VERSION;
const SHELL = ["./", "index.html", "css/app.css", "manifest.webmanifest", "icons/icon.svg", "icons/apple-touch-icon.png",
  "js/app.js", "js/util.js", "js/sports.js", "js/store.js", "js/config.js", "js/planner.js", "js/plan-ui.js", "js/stats.js", "js/profile.js", "js/proposals.js"];

self.addEventListener("install", e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener("fetch", e => {
  const req = e.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Supabase-API nie cachen
  if (url.hostname.endsWith("supabase.co")) return;
  const isLib = url.hostname === "cdn.jsdelivr.net" || url.hostname.startsWith("fonts.");
  if (url.origin !== location.origin && !isLib) return;
  // Netzwerk zuerst für eigene Dateien (damit Updates sofort ankommen), Cache als Offline-Fallback
  if (url.origin === location.origin) {
    e.respondWith(fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })
      .catch(() => caches.match(req, { ignoreSearch: true }).then(r => r || caches.match("index.html"))));
    return;
  }
  // Bibliotheken und Schriften: Cache zuerst
  e.respondWith(caches.match(req).then(r => r || fetch(req).then(res => { const copy = res.clone(); caches.open(CACHE).then(c => c.put(req, copy)); return res; })));
});
