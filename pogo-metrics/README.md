# POGO Metrics

A privacy-first, **bring-your-own-data** web app: drop your official Niantic Pokémon GO
data export into the browser and get a beautiful, digestible summary & dashboard
of your trainer journey. Nothing is uploaded — every file is parsed locally with JavaScript,
and the site ships **none of your data**. (The only dataset in the repo is `demo/`, a fully
anonymized sample used by the Live Example page.)

## Pages

- **`index.html`** — Landing + guide. Hero, "how it works", how to request your export from
  Niantic (the in-app Poké Ball → Settings → Help flow), privacy principles, and a full
  **dataset catalog** (data from `js/catalog.js`, rendered by `js/catalog-ui.js`) that teaches
  what every file in a Niantic export contains, how sensitive it is, and what story this site
  can build from it.
- **`metrics.html`** — The app. Drag-and-drop (files *or* a whole folder), client-side parse,
  and a per-file story. Each recognised file lights up its own chapter, so uploading only
  `FriendList.tsv` yields just the social chapter, while a full export yields everything.
- **`demo.html`** — The **Live Example**: a permanent reference build that auto-runs the
  parser over the bundled anonymized sample export, so visitors can preview every chart
  before requesting their own data. (`metrics.html?demo=1` still works as a shortcut.)

## Code

- **`js/catalog.js`** — The knowledge base: one entry per Niantic export file (friendly name,
  filename matcher, what it contains, raw column names, sensitivity rating + note, the story it
  unlocks, and Niantic's rough retention window). Shared by the landing catalog and the app's
  file detection.
- **`js/app.js`** — The engine. Reads each `File` with `.text()`, routes it by filename to a
  parser, accumulates into a single `STATE`, then renders independent story chapters:
  - **Gameplay.txt** → trainer card, collection by region, top species, medal cabinet
  - **Player_Journey/\*.csv** → activity totals, monthly stacked timeline, breakdown donut,
    hour-of-week heat grid, **year-over-year comparison** with downloadable per-year recap
    cards (PNG), the world globe, and remote-raid detection (≥50 km via haversine)
  - **GameplayLocationHistory.tsv** → day-segmented GPS trail on the map
  - **FriendList / RecentlyUnfriended / RecentInviteActions / ActivityInvites** → social world
  - **InAppPurchases.tsv** → spending: coin flow, top items, spend by currency
  - **FitnessData.tsv** → Adventure Sync steps + real-world equivalents
  - **App_Sessions / App_Installs** → sessions, devices, login cities
  - **LiveEventRegistrationHistory** → ticketed events; **wayfarer_player_data.json** → contributions
- **`js/catalog-ui.js`** — The "Filter Deck" that renders the catalog on the landing page.
  All 21 files are on screen with **nothing nested** — no `<details>` anywhere. Four stat tiles
  double as filters, three chip rails slice by sensitivity / what-we-do / group, a
  LIST · CARDS · FULL density switch controls how much of each entry shows, and the search box
  indexes the raw Niantic column names and echoes the matching fragment back (typing `latitude`
  surfaces the two files that carry it, quoting `Player_Latitude`). Filter state round-trips
  through the URL hash — no storage, no requests.
- **`js/pokedex.js`** — Name → National Dex map for gens 1–3, recovering region-of-origin
  info for older Pokémon that exports list by plain display name.
- **`js/nav.js`** — Shared top nav (`data-active="home|guide|demo|app"`).

The world chapter prefers a 3D globe (vendored globe.gl); when WebGL isn't available it
falls back to a flat Leaflet heatmap with the same data.

## Privacy

- 100% client-side. There is no backend, no upload, no account.
- Emails, IP addresses, advertising IDs and order numbers are never read at all, even when the
  raw file contains them.
- Locations **are** read — the globe and map are the point. They are drawn on-device and
  published nowhere, but they do plot where the user played, and `renderGlobe()` derives a
  `home` point from the densest activity bin and centres the camera on it. The UI says so
  rather than claiming otherwise.
- The sensitivity ratings in the catalog warn the user *before* they open anything.

## Vendored, offline-capable

Chart.js, Leaflet + leaflet-heat, globe.gl, the Outfit/JetBrains Mono fonts, the globe
textures and `countries.geo.json`/`us-states.geo.json` are all vendored under `vendor/`.
There are **no runtime network calls at all** — every request the site makes is same-origin,
and the Netlify `Content-Security-Policy` (`connect-src 'self'`, see `netlify.toml`) makes
that browser-enforced rather than merely promised.
The flat-map fallback deliberately ships without a remote tile layer: a third-party basemap
would leak the viewer's IP plus tile coordinates centred on their own hotspots, so the map is
drawn from the vendored country outlines instead.

The heavy libraries are **not** loaded at page open: `app.js` injects Chart.js — and
globe.gl *or* Leaflet, whichever the data needs — only when a dashboard is actually built,
so the upload page is interactive immediately.

`sw.js` (registered by `nav.js` on the deployed site only, never on localhost) makes the
app installable and fully offline-capable — parsing an export works in airplane mode, which
is the strongest demonstration of the no-upload claim.

## Local preview

Asset loading needs a real HTTP server (not `file://`):

```sh
node static-server.mjs "$PWD" 8770
# then open http://127.0.0.1:8770/index.html
```

(The server resolves its root against the process working directory, so pass an
absolute path — a bare `.` makes every request fall outside the root and 403.)

Or open `demo.html` to load the bundled, fully anonymized `demo/` dataset and preview
every chart.

## Demo dataset

`demo/` is a scrubbed, downsampled sample export used by the Live Example page. Regenerate
it from any real export with:

```sh
node tools/scrub-demo.mjs "<path to an unzipped export>"
```

The scrubber translates + jitters all GPS coordinates to a fake city, fakes or drops every name,
email, order number, IP and ad-ID, remaps cities, and uniformly downsamples the big event logs.
Numbers, dates, medals, species and timing are preserved so the story still feels real. **No real
personal data is present in `demo/`.**

> Independent fan project. Not affiliated with Niantic, Scopely, Nintendo, or The Pokémon Company.
