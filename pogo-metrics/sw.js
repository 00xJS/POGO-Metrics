/* POGO Metrics service worker — offline support for a tool whose whole pitch
 * is that it never needs the network. Once installed, the app works in
 * airplane mode: the strongest possible proof that nothing is uploaded.
 *
 * Strategy:
 *   • pages + app js/css → network-first (deploys land immediately),
 *     cached copy when offline
 *   • vendor/ (pinned libs, textures, fonts, geojson) → cache-first
 * Bump VERSION on any release to sweep old caches. */
const VERSION = "pogo-metrics-v20260812b";
const CORE = [
  "/", "favicon.ico", "index.html", "metrics.html", "demo.html", "trainer-model.html", "404.html",
  "css/style.css?v=20260812b", "css/trainer-model.css?v=20260812b",
  "js/nav.js?v=20260812b", "js/catalog.js?v=20260812b", "js/catalog-ui.js?v=20260812b",
  "js/pokedex.js?v=20260812b", "js/app.js?v=20260812b", "js/trainer-model.js?v=20260812b",
  // The Trainer Model page draws entirely from these two files, so an installed
  // app opened offline still gets the full research layer.
  "data/trainer-model/trainers.json", "data/trainer-model/era2.json",
  "vendor/fonts/fonts.css",
  // Chart.js is precached so an installed app opened offline still draws its
  // charts. globe.gl (1.4MB) is deliberately left to the cache-first /vendor/
  // rule — it lands the first time a build actually needs it.
  "vendor/chart.umd.min.js",
];

/* The same pages again, without their extension. Netlify serves them at both
 * paths and its Pretty-URLs post-processing rewrites every in-body href to this
 * form — so offline the browser asks for /metrics, not metrics.html. Cache.match
 * keys on the whole path (ignoreSearch only drops the query), so without these
 * the navigate fallback below sent every in-page CTA back to the landing page.
 *
 * Kept OUT of CORE deliberately: addAll is atomic, so one 404 would fail the
 * whole install and leave the app with no offline cache at all — and these 404
 * on any plain static server, including the one in this repo. They are added
 * individually below, and allowed to fail. */
const PRETTY = ["/metrics", "/demo", "/trainer-model"];

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(CORE).then(() =>
        Promise.all(PRETTY.map((u) => c.add(u).catch(() => {})))))
      .then(() => self.skipWaiting())
  );
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
