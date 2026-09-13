/* POGO Metrics service worker — offline support for a tool whose whole pitch
 * is that it never needs the network. Once installed, the app works in
 * airplane mode: the strongest possible proof that nothing is uploaded.
 *
 * Strategy:
 *   • pages + app js/css → network-first (deploys land immediately),
 *     cached copy when offline
 *   • vendor/ (pinned libs, textures, fonts, geojson) → cache-first
 * Bump VERSION on any release to sweep old caches. */
const VERSION = "pogo-metrics-v20260913a";
const CORE = [
  "/", "favicon.ico", "index.html", "metrics.html", "demo.html", "trainer-model.html", "404.html",
  // Every page links the web manifest, so offline a missing copy is an error on
  // each, and once it loads the browser fetches the icon it names (57 KB).
  "site.webmanifest", "icon-192.png",
  "css/style.css?v=20260913a", "css/trainer-model.css?v=20260913a",
  "js/nav.js?v=20260913a", "js/catalog.js?v=20260913a", "js/catalog-ui.js?v=20260913a",
  "js/pokedex.js?v=20260913a", "js/app.js?v=20260913a", "js/trainer-model.js?v=20260913a",
  // The Live Example's page flag. Without it an offline demo.html never sets
  // DEMO_PAGE, so it never loads the sample.
  "js/demo-page.js?v=20260913a",
  // The landing's live preview and section sub-nav, and the compact sample
  // summary the preview is built from — an installed app opened offline gets
  // the same hero, not the static fallback slide.
  "js/landing.js?v=20260913a", "data/sample-preview.json",
  // The Trainer Model page draws entirely from these two files, so an installed
  // app opened offline still gets the full research layer.
  "data/trainer-model/trainers.json", "data/trainer-model/era2.json",
  "vendor/fonts/fonts.css",
  // ...and every face it names (113 KB for all eight). A first visit fetches its
  // fonts before this worker controls the page, so the worker never saw them,
  // and an offline reload had no fonts at all.
  "vendor/fonts/1cd702cd25.woff2", "vendor/fonts/c8e7a734b1.woff2",
  "vendor/fonts/76306ee877.woff2", "vendor/fonts/f37fa50e91.woff2",
  "vendor/fonts/8ea5e19410.woff2", "vendor/fonts/9cb20f35ff.woff2",
  "vendor/fonts/982bf4a95e.woff2", "vendor/fonts/ffa6bbabb7.woff2",
  // Chart.js is precached so an installed app opened offline still draws its
  // charts. It is the same file app.js and trainer-model.html load, under its
  // versioned name. globe.gl (1.9MB) is deliberately left to the cache-first
  // /vendor/ rule — it lands the first time a build actually needs it.
  "vendor/chart-4.5.1.umd.min.js",
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

/* The Live Example builds itself from sample-export/, so demo.html opened
 * offline straight after a first visit needs those files too, or it shows its
 * "couldn't load" card. They are listed by the sample's own manifest.json, so a
 * regenerated sample needs no edit here. About 2.5 MB, 0.4 MB gzipped, fetched
 * once per release. Best-effort, like PRETTY: a file that fails leaves the Live
 * Example online-only and never fails the install. globe.gl stays out as above,
 * so an offline Live Example that never ran online draws no globe. */
const SAMPLE = "sample-export/manifest.json";
const precacheSample = (c) => c.add(SAMPLE)
  .then(() => c.match(SAMPLE)).then((r) => r.json())
  .then((m) => Promise.all((m.files || []).map((p) => c.add("sample-export/" + p).catch(() => {}))))
  .catch(() => {});

self.addEventListener("install", (e) => {
  e.waitUntil(
    caches.open(VERSION)
      .then((c) => c.addAll(CORE).then(() =>
        Promise.all([...PRETTY.map((u) => c.add(u).catch(() => {})), precacheSample(c)])))
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
        /* Unknown URL offline → the precached 404 page, not a silent copy of
         * the homepage wearing the wrong address. Its recovery links all point
         * at precached pages, so getting out of it is one tap. index.html
         * remains the last resort if the 404 copy is somehow missing. */
        hit || (e.request.mode === "navigate"
          ? caches.match("404.html").then((nf) => nf || caches.match("index.html"))
          : Response.error()))
    )
  );
});
