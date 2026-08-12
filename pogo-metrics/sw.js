/* POGO Metrics service worker — offline support for a tool whose whole pitch
 * is that it never needs the network. Once installed, the app works in
 * airplane mode: the strongest possible proof that nothing is uploaded.
 *
 * Strategy:
 *   • pages + app js/css → network-first (deploys land immediately),
 *     cached copy when offline
 *   • vendor/ (pinned libs, textures, fonts, geojson) → cache-first
 * Bump VERSION on any release to sweep old caches. */
const VERSION = "pogo-metrics-v20260811k";
const CORE = [
  "/", "favicon.ico", "index.html", "metrics.html", "demo.html", "trainer-model.html", "404.html",
  "css/style.css?v=20260811k", "css/trainer-model.css?v=20260811k",
  "js/nav.js?v=20260811k", "js/catalog.js?v=20260811k", "js/catalog-ui.js?v=20260811k",
  "js/pokedex.js?v=20260811k", "js/app.js?v=20260811k", "js/trainer-model.js?v=20260811k",
  // The Trainer Model page draws entirely from these two files, so an installed
  // app opened offline still gets the full research layer.
  "data/trainer-model/trainers.json", "data/trainer-model/era2.json",
  "vendor/fonts/fonts.css",
  // Chart.js is precached so an installed app opened offline still draws its
  // charts. globe.gl (1.4MB) is deliberately left to the cache-first /vendor/
  // rule — it lands the first time a build actually needs it.
  "vendor/chart.umd.min.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(CORE)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;

  if (url.pathname.includes("/vendor/")) {
    // immutable library builds — cache wins, network fills the cache once
    e.respondWith(
      caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || fetch(e.request).then((r) => {
        if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
        return r;
      }))
    );
    return;
  }

  e.respondWith(
    fetch(e.request).then((r) => {
      if (r.ok) { const copy = r.clone(); caches.open(VERSION).then((c) => c.put(e.request, copy)); }
      return r;
    }).catch(() =>
      caches.match(e.request, { ignoreSearch: true }).then((hit) =>
        hit || (e.request.mode === "navigate" ? caches.match("index.html") : Response.error()))
    )
  );
});
