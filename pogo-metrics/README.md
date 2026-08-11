# POGO Metrics

A privacy-first, **bring-your-own-data** web app: drop your official Niantic Pokémon GO
data export into the browser and get a beautiful, digestible summary & dashboard
of your trainer journey. Nothing is uploaded — every file is parsed locally with JavaScript,
and the site ships **none of your data**. (The only datasets in the repo are `demo/`, a fully
anonymized sample used by the Live Example page, and `data/trainer-model/`, the anonymized
friends-list cohort behind the Trainer Model page.)

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
- **`trainer-model.html`** — The **Trainer Model**: the research layer. A real friends-list
  cohort (390 trainers, February 2025, cap 50; 493 trainers, August 2026, cap 80) plotted as a
  population — what the level cap does to trainer numbers, why the project's original
  straight-line model fails at the level-50 wall, and a benchmark for where your own stats
  land. Data ships in `data/trainer-model/` with placeholder handles; per-level stats are
  withheld below five trainers per level. The two eras are never mixed — the XP rebalance
  made levels incomparable across them.

## Code

- **`js/catalog.js`** — The knowledge base: one entry per Niantic export file (friendly name,
  filename matcher, what it contains, raw column names, sensitivity rating + note, the story it
  unlocks, and Niantic's rough retention window). Shared by the landing catalog and the app's
  file detection.
- **`js/app.js`** — The engine. Reads each `File` with `.text()`, routes it by filename to a
  parser, accumulates into a single `STATE`, then renders independent story chapters:
  - **Gameplay.txt** → trainer card, collection by region, top species, medal cabinet, bag
    breakdown + egg bench, and the rolling end-of-file activity log (a close-up of the last
    session, the only place in the export where individual Pokémon and their CP appear)
  - **Player_Journey/\*.csv** → activity totals, monthly stacked timeline, breakdown donut,
    hour-of-week heat grid, **year-over-year comparison** with downloadable per-year recap
    cards (PNG), the world globe, remote-raid detection (≥50 km via haversine), and the
    most-visited PokéStops and raid gyms (ranked, never with coordinates)
  - **GameplayLocationHistory.tsv** → day-segmented GPS trail on the map
  - **FriendList / RecentlyUnfriended / RecentInviteActions / ActivityInvites** → social world
  - **InAppPurchases.tsv** → spending: coin flow, top items, spend by currency, storefront
    split, free daily boxes and support gifts
  - **FitnessData.tsv** → Adventure Sync steps + real-world equivalents
  - **ImageData.txt** → the GO Snapshot photo album (dates only — never an image)
  - **App_Sessions / App_Installs** → sessions, devices, login cities and countries
  - **SupportInteractions\*.tsv** → ticket count and subjects (never the message bodies)
  - **LiveEventRegistrationHistory** → ticketed events; **wayfarer_player_data.json** → contributions
  Beyond the chapters, `app.js` also drives four things the toolbar exposes once a build finishes:
  `storyMode()` (a full-screen Wrapped-style recap, also `demo.html`'s hero CTA and promised twice
  on `index.html`), `downloadJourneyCard()` and `downloadYearCard()` (canvas-rendered shareable
  PNGs — drawn from the data rather than screenshotted, so they work offline), and
  `downloadStatsJSON()`. That last one writes `STATE.profile` to disk and deliberately omits every
  location field; if you add a stat to it, keep that split intact and update the `note` string it
  embeds.
- **`js/catalog-ui.js`** — The "Filter Deck" that renders the catalog on the landing page.
  Every file is on screen with **nothing nested** — no `<details>` anywhere. Four stat tiles
  double as filters, three chip rails slice by sensitivity / what-we-do / group, a
  LIST · CARDS · FULL density switch controls how much of each entry shows, and the search box
  indexes the raw Niantic column names and echoes the matching fragment back (typing `latitude`
  surfaces the two files that carry it, quoting `Player_Latitude`). Filter state round-trips
  through the URL hash — no storage, no requests.
- **`js/pokedex.js`** — Name → National Dex map for gens 1–3, recovering region-of-origin
  info for older Pokémon that exports list by plain display name.
- **`js/trainer-model.js`** — The Trainer Model dashboard engine: loads the two cohort JSONs
  from `data/trainer-model/`, computes the fits (OLS, log-linear, median- and mean-per-level)
  and percentile ranks client-side, and renders the eight chapters — including the every-trainer
  scatter of the cap-80 era, a single "where you stand" benchmark with an era toggle (2026
  cap-80 cohort by default, banded ≤55 / 56–65 / 66–75 / 76–79 / 80; 2025 cohort one tap away),
  the milestone ladder table, and a full-screen tappable "ladder story" that reuses the site's
  story-mode styles. The story never converts totals into
  time-to-level — the data has no timestamps, and it says so. Its page-only styles live in
  `css/trainer-model.css`, scoped under `.tmodel` so they can't leak into the rest of the site.
- **`js/nav.js`** — Shared top nav (`data-active="home|guide|demo|model|app"`).

The world chapter prefers a 3D globe (vendored globe.gl); when WebGL isn't available it
falls back to a flat Leaflet heatmap with the same data.

## Privacy

- 100% client-side. There is no backend, no upload, no account.
- Emails, IP addresses, advertising IDs and order numbers are never parsed, rendered, or exported,
  even when the raw file contains them. Be precise when writing this claim down: `ingest()` reads
  each accepted file whole with `.text()`, and `parseRows` builds a row object per line with every
  column on it, so those values do pass through memory. What is true — and what the wording must
  say — is that no parser extracts them, no chapter shows them, `downloadStatsJSON` omits them, and
  `connect-src 'self'` means nothing can fetch, XHR, WebSocket or beacon them off-origin (that
  directive governs those APIs, not navigation). An allowlisting parser would make
  the stronger claim literally true; it has been judged not worth the bug surface.
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

The scrubber **generates** all GPS coordinates rather than transforming the real ones — it builds a
synthetic world (one home city, seven travel cities) and assigns each distinct real coordinate a
place in it by how often it appears, never by where it is. It also fakes or drops every name,
email, account ID, referral code, order number, IP and ad-ID, drops support message bodies, remaps
cities and countries, and uniformly downsamples the big event logs. Numbers, dates, medals, species
and timing are preserved so the story still feels real.

It then checks its own work: every file it wrote is re-read, and it deletes the output rather than
shipping if any redacted identifier, email, IP or real coordinate value survived. **No real
personal data is present in `demo/`**, and that is verified on every run.

> An earlier version translated every coordinate by one global offset. That is not anonymisation —
> a rigid translation preserves every distance and bearing, so the published demo was one
> subtraction away from the real map. Don't reintroduce it.

> Independent fan project. Not affiliated with Niantic, Scopely, Nintendo, or The Pokémon Company.
