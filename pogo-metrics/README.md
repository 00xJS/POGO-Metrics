# POGO Metrics

A privacy-first, **bring-your-own-data** web app: drop your official Pokémon GO
data export (Niantic's format, shipped unchanged by Scopely Explore) into the browser and get a beautiful, digestible summary & dashboard
of your trainer journey. Nothing is uploaded — every file is parsed locally with JavaScript,
and the site ships **none of your data**. (The only datasets in the repo are `sample-export/`, a fully
anonymized sample used by the Live Example page, and `data/trainer-model/`, the pseudonymized
friends-list cohort behind the Trainer Model page.)

## Pages

- **`index.html`** — Landing + guide. Hero, "how it works", how to request your export
  in-game (the Poké Ball → Settings → Help flow — unchanged under Scopely), privacy principles, and a full
  **dataset catalog** (data from `js/catalog.js`, rendered by `js/catalog-ui.js`) that teaches
  what every file in an export contains, how sensitive it is, and what story this site
  can build from it — plus a **Niantic → Scopely Explore before/after panel** measured on two real
  exports (June and August 2026): same files, same columns, same retention windows; only the folder
  name, the company's name — Scopely Explore, Inc. (formerly Niantic, Inc.) — and the wait changed,
  and Campfire gained an export of its own.
- **`metrics.html`** — The app. Drag-and-drop (files, a whole folder, or the password-protected
  download ZIP itself — anywhere on the page), client-side parse, and a per-file story that now
  **builds itself** moments after a drop. Each recognised file lights up its own chapter, so
  uploading only `FriendList.tsv` yields just the social chapter, while a full export yields
  everything — ending in a Wrapped-style auto-advancing story with per-slide share cards, a
  computed trainer type, per-year replays, a wall poster, and a **You vs. a friend** chapter when
  someone sends you their compare file from this site. Drop more than one export and they stack
  into one history.
- **`demo.html`** — The **Live Example**: a permanent reference build that auto-runs the
  parser over the bundled anonymized sample export, so visitors can preview every chart
  before requesting their own data. (`metrics.html?demo=1` still works as a shortcut.)
- **`trainer-model.html`** — The **Trainer Model**: the research layer. A real friends-list
  cohort (390 trainers in a single February 2025 snapshot, cap 50; 493 trainers recorded across
  three sessions in August 2026, cap 80) plotted as a population — what the level cap does to trainer numbers, why the project's original
  straight-line model fails at the level-50 wall, and a benchmark for where your own stats
  land. Data ships in `data/trainer-model/` with placeholder handles, so each row is one trainer's
  exact figures, pseudonymized rather than anonymized; per-level stats are withheld below five
  trainers per level. The two eras are never mixed — the XP rebalance
  made levels incomparable across them.

## Code

- **`js/catalog.js`** — The knowledge base: one entry per export file (friendly name,
  filename matcher, what it contains, raw column names, sensitivity rating + note, the story it
  unlocks, and its rough retention window). Shared by the landing catalog and the app's
  file detection.
- **`js/app.js`** — The engine. Reads each `File` with `.text()`, routes it by filename to a
  parser, accumulates into a single `STATE`, then renders independent story chapters:
  - **Gameplay.txt** → trainer card, collection by region, top species, medal cabinet, trainers
    referred, bag breakdown + egg bench, and the rolling end-of-file activity log (a close-up of
    the last session, the only place in the export where individual Pokémon and their CP appear,
    plus how many gifts friends sent)
  - **Player_Journey/\*.csv** → activity totals, monthly stacked timeline, breakdown donut,
    hour-of-week heat grid (each moment on the hour the viewer's clock showed then, daylight
    saving included), **year-over-year comparison** with downloadable per-year recap cards
    (PNG), the world globe, remote-raid detection (≥50 km via haversine), the most-visited
    PokéStops and raid gyms (ranked, never with coordinates), and the in-person GO Fest badge
  - **GameplayLocationHistory.tsv** → day-segmented GPS trail on the map
  - **FriendList / RecentlyUnfriended / RecentInviteActions / ActivityInvites** → social world,
    including which weekday your invites land on (the other trainer's field is never read)
  - **InAppPurchases.tsv** → spending: coin flow, top items, spend by currency, storefront
    split, free daily boxes and support gifts
  - **FitnessData.tsv** → Adventure Sync steps + real-world equivalents
  - **ImageData.txt** → the GO Snapshot photo album (dates only — never an image)
  - **App_Sessions / App_Installs** → sessions, devices, login cities and countries, device eras
    (app and OS versions over time), and an install history drawn from both files
  - **SupportInteractions\*.tsv** → ticket count and subjects (never the message bodies)
  - **LiveEventRegistrationHistory** → ticketed events and add-on orders (a yes or a no per order,
    never what the add-on was; an order for add-ons alone counts no tickets);
    **wayfarer_player_data.json** → review activity and the star ratings you gave
  - **The Campfire export** (`<codename>_<yyyymmdd>_<hhmmss>.csv` — one CSV, ten sections, quoted
    multi-line messages; recognised by name or by its first line) → meetups hosted, RSVP'd and
    attended (show-up rate), hours at meetups and typical turnout, what kinds of events get you
    out, club chat by month with its chattiest hour (each message on its own local hour), and your
    Campfire circle. **Counts and dates only**: `parseCampfire` drops every message, name, title,
    coordinate and the IP address as it reads, and `test-parsers` asserts no string reaches
    `STATE.campfire`.

  Two things about `Player_Journey` worth knowing. Every event ships as a **pair**:
  `Pokestop_spin1.csv` is the trailing ~15 months with precise positions, and `Pokestop_spin2.csv` the
  trailing ~3 years of the *same* events with every position blurred to a cell a few kilometres wide
  (measured against the GPS trail: a median 230 m off in the "1" file, 4.1 km in the "2"). So the
  long file is the timeline and the precise file is the map: `parsePlayerJourney` reads a "1" file
  in full, then its "2" twin with the shared window skipped and its blurred positions kept out of
  the map and the stop rankings (raid distances still use them — a few km is nothing against the
  50 km that makes a raid remote). Before this, a whole-folder drop counted fifteen months twice
  and ranked a blurred cell with 37,000 "visits" as the top stop. And `ingest()` opens both
  archives in the browser, with a small central-directory reader over the native
  `DecompressionStream`. The download itself is locked with WinZip AES: its password is typed into
  a panel under the dropzone, checked against the archive's password-check bytes and then its
  HMAC-SHA1 code through WebCrypto, and the entries are decrypted by a small AES-CTR core in
  `app.js` (WinZip's counter starts at 1 and is little-endian, which WebCrypto's AES-CTR can't do).
  The plain `Player_Journey.zip` inside is opened one level deep and no deeper. Neither archive's
  header is trusted: `ZIP_LIMITS` allows 80 MB per entry, and 200 entries and 256 MB inflated
  (counted as it streams) per dropped archive, shared with any archive opened from inside it, so
  one drop can't add more than 200 files however it's nested. Entries that share or overlap bytes
  are refused, as is ZIP64. A ZipCrypto archive gets a plain "not supported" message that names Keka, The Unarchiver
  and 7-Zip.

  In-person GO Fests earn a badge. `GO_FESTS` in `app.js` is the one list of festivals, each with
  its first and last days and, for an in-person one, a city-sized box and its UTC offset; to add a
  festival, add an entry there. A position from a precise "1" journey file inside a festival's box
  during its local dates earns "🎪 I was there · GO Fest <city> <year>", shown on the page year
  card and drawn first on the year-card and journey PNGs. Only venue ids, counts and UTC days are
  kept, never a coordinate, and the badge names a city and a year, never a date or a venue.
  `eventFor()` labels an in-person festival day only for a trainer who was there. The event logs
  record encounters, not catches, so every label on `catchesOf()`'s sum says "encountered".

  **Stacking exports.** `RAW` keeps every copy of a file, and `parseRaw()` merges each file's
  copies before routing (`mergeCopies()`), by kind. Journey logs keep every event once, matched on
  its exact instant, so an event two exports share counts once and so does a row repeated byte for
  byte inside one file; the "1" and "2" files stay apart. Rolling logs and cumulative ledgers keep
  each row as many times as the copy that holds it most. Snapshots — the friend list, the profile
  and the rest of Gameplay.txt, Wayfarer — come from the newest copy, ranked by the latest moment
  the data itself mentions, never by arrival order or `File.lastModified`. Build order is fixed by
  the files themselves ("1" before "2", then by name), so every arrival order builds the same
  report. Copy markers (Finder's "Keep Both" and Duplicate, a browser's "(1)", Windows' "- Copy")
  come off a name before it is matched, identical copies are told apart by SHA-256 and counted
  once, and "N files added" counts what is in the folder, an archive once. The report ends with a
  60-day export-again reminder, an `.ics` made on the device and not shown for the sample.

  Around the chapters, `shellReport()` turns the flat run of panels into an application layout:
  a trainer masthead with a monthly sparkline, a sticky chapter rail with scroll-spy (a column
  beside the report on wide screens, a strip under the nav on phones), a **reader mode** toggle
  that shows one chapter at a time with previous/next, a stat-grid balancer that picks the column
  count with the fullest last row, panels that fade up as they arrive, and a floating Play button
  for phones. On `metrics.html`, `renderUnlocks()` draws the **build console** — every chapter
  and the file that unlocks it, lit as files land — and `mountUploadStrip()` folds the picker into
  one strip once a report exists. Each chapter carries one hue (`CHAPTER_META`) for its eyebrow,
  icon chip and top rule.
  Beyond the chapters, `app.js` also drives four things the toolbar exposes once a build finishes:
  `storyMode()` (a full-screen Wrapped-style recap, also `demo.html`'s hero CTA and promised twice
  on `index.html`), `downloadJourneyCard()` and `downloadYearCard()` (canvas-rendered shareable
  PNGs — drawn from the data rather than screenshotted, so they work offline), and the **My
  numbers** panel, which offers two files. The compare file (`compareFileData()`) holds only a
  trainer name, action totals, actions per month and per day, and a friend count: it is what a
  friend's You-vs-a-friend chapter reads. `shareCompareFile()` hands it to `deliverFile()`, which
  uses the share sheet where the browser can share a file and downloads it everywhere else; its
  name must start with `pogo-metrics-stats`, which is how the friend's copy of this site knows it.
  The personal stats file (`statsFileData()`, saved by `downloadStatsJSON()` as
  `pogo-metrics-personal-stats.json`) is every figure, the profile included, and says it is not
  for sharing. Both deliberately omit every location field; if you add a stat to either, keep that
  split intact and update the `note` string each embeds.
- **`js/catalog-ui.js`** — The "Filter Deck" that renders the catalog on the landing page (list density by default).
  Every file is on screen with **nothing nested** — no `<details>` anywhere. Three of the four
  stat tiles double as filters (the file-count tile is a plain stat), three chip rails slice by
  sensitivity / what-we-do / group, a
  LIST · CARDS · FULL density switch controls how much of each entry shows, and the search box
  indexes the raw column names and echoes the matching fragment back (typing `latitude`
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
- **`js/nav.js`** — Shared top nav (`data-active="home|guide|demo|model|app"`), plus the
  site's inline SVG icon set (`window.ICON(name)`, hydration of any `[data-icon]` element,
  and `window.fileIcon()` for the catalog's files) and `window.chapterRail()`, the rail
  builder the Trainer Model page shares.
- **`js/landing.js`** — The landing page's live preview: a miniature of the report masthead and
  story player cycling through real slides from `data/sample-preview.json` (a compact summary of
  the sample export — no locations; after a new sample, regenerate its numbers from the Live
  Example, keep the "WILD ENCOUNTERS" / "Pokémon encountered" wording, and keep `index.html`'s
  static fallback slide, `og-card-demo.html`, `og-image-demo.png` and `demo.html`'s
  `og:image:alt` in step), the section sub-nav that follows the scroll, and the
  trainers-per-level histogram in section 04, drawn from the Trainer Model's own
  `trainers.json`. It also holds what `index.html` used to keep in an inline script: the
  redirect for a file dropped on the landing page, and the request reminder's `.ics`.
- **`js/demo-page.js`** — Sets `window.DEMO_PAGE` before `app.js` runs, so `demo.html` loads the
  sample. It is a file of its own because no page may carry an inline script.

The world chapter prefers a 3D globe (vendored globe.gl); when WebGL isn't available it
falls back to a flat Leaflet heatmap with the same data.

## Privacy

- 100% client-side. There is no backend, no upload, no account.
- Emails, IP addresses, advertising IDs and order numbers are never parsed, rendered, or exported,
  even when the raw file contains them. Be precise when writing this claim down: `ingest()` reads
  each accepted file whole with `.text()`, and `parseRows` builds a row object per line with every
  column on it, so those values do pass through memory. What is true — and what the wording must
  say — is that no parser extracts them, no chapter shows them, neither My numbers file carries
  them, and `connect-src 'self'` means nothing can fetch, XHR, WebSocket or beacon them off-origin (that
  directive governs those APIs, not navigation). An allowlisting parser would make
  the stronger claim literally true; it has been judged not worth the bug surface.
- Locations **are** read — the globe and map are the point. They are drawn on-device and
  published nowhere, but they do plot where the user played, and `renderGlobe()` derives a
  `home` point from the densest activity bin and centres the camera on it. The UI says so
  rather than claiming otherwise.
- The sensitivity ratings in the catalog warn the user *before* they open anything.
- Every string read from a file is escaped before it reaches the page (`esc()` encodes both
  quote kinds as well as `&`, `<` and `>`), and the suite's taint test plants markup in every
  field the parsers read and checks that none of it renders as markup.

## Vendored, offline-capable

Chart.js, Leaflet + leaflet-heat, globe.gl, the Outfit/JetBrains Mono fonts, the globe
textures and `countries.geo.json`/`us-states.geo.json` are all vendored under `vendor/`.
There are **no runtime network calls at all** — every request the site makes is same-origin,
and the Netlify `Content-Security-Policy` (`connect-src 'self'`, see `netlify.toml`) makes
that browser-enforced rather than merely promised. Its `script-src` is `'self'` alone: no page
carries an inline script, an `on*` attribute or a `javascript:` URL, and every page repeats the
policy in a `<meta http-equiv>` tag, so a copy served from anywhere else stays under it. Alongside
it the site sends `Permissions-Policy`, `Cross-Origin-Opener-Policy: same-origin`, and
`Cross-Origin-Resource-Policy` — `same-origin` on the asset folders, `cross-origin` on the share
images, each path from exactly one rule.

`vendor/` is served `immutable` for a year and cache-first by `sw.js`, so a file there is never
overwritten: an upgrade ships under a new, versioned filename (`globe.gl-2.46.2.min.js`,
`chart-4.5.1.umd.min.js`). Every vendor script and stylesheet carries a `sha384` subresource
integrity hash — on the tag for the ones a page loads directly, and through the `VENDOR_SRI` map
in `app.js` for the libraries `ensureScript()` and `ensureCSS()` load on demand. A copy the
browser refuses is dropped from the service worker's cache and tried once more at a fresh
`?retry=` address with the same hash, so a page mends itself in the same tab. After changing
anything in `vendor/`, run `node tools/sri.mjs --write` to bring every hash back in line;
`test-parsers` fails on drift. The `og-card*.html` render sources deliberately carry no integrity
attribute: they may be rendered straight from disk, and Chrome refuses every integrity check on a
`file://` response.

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

The server sends the same security headers as the live site — the CSP, `Permissions-Policy`,
`Cross-Origin-Opener-Policy` and the per-folder `Cross-Origin-Resource-Policy` — so a CSP break
shows up here first, not after a deploy. It answers only requests addressed to
`127.0.0.1:<port>` or `localhost:<port>` (a DNS-rebinding page can't borrow it), a malformed path
is a 400, and no path can climb out of the root. A relative root such as `.` works too.

Or open `demo.html` to load the bundled, fully anonymized `sample-export/` dataset and preview
every chart.

## The sample export

`sample-export/` is a scrubbed, downsampled sample export used by the Live Example page. Regenerate
it from a real export with:

```sh
node tools/scrub-demo.mjs "<export folder>" [out-dir] [--also "<older export>"]...
```

The export folder can hold the journey logs unzipped (`Player_Journey/`) or the way the export
ships them (`Player_Journey.zip`, read in memory with size and CRC checks, never extracted to
disk). `--also` names another export of the same account: every real value and place in it is
chased as well, and nothing is written from it. The committed sample was built from an August 2026
export with a June 2026 export passed as `--also`; it ships both halves of each Player_Journey pair.

The scrubber **generates** all GPS coordinates rather than transforming the real ones — it builds a
synthetic world (one home city, seven travel cities) and assigns each distinct real coordinate a
place in it by how often it appears, never by where it is, and it keeps every synthetic point at
least 120 m from every real place, measured, and out of the ~100 m map cell around each. It fakes or drops every name, codename, friend
nickname, gift sender, email, account ID, referral code, order number, IP, ad-ID and carrier, drops
support message bodies, strips the labels typed on Pokémon (species kept), replaces live-event
ticket names with invented ones, remaps cities (to Pokémon-world towns) and countries, and uniformly
downsamples the big event logs. Every in-person event medal becomes a neutral
`BADGE_EVENT_IN_PERSON_n` key that keeps its count and names no event, place, year, day or session
(the event-family test is read from `app.js`, so the medal totals can't drift), and a real city left
in any other event key becomes a Pokémon-world town. A few columns are kept because the report reads
them, each only in its expected shape: install time, app and OS version, platform, and device model
and category in the session logs; each support ticket's date and topic, under a new ticket number;
each Wayfarer entry's date and star rating; and a live-event add-on only as the word "add-on".
The account's counters are perturbed, never copied, because a trainer profile shows
several of them to every friend: the start date moves 15–45 days earlier; total XP, distance walked
and eggs hatched grow 4–12 % (distance and eggs inside their Jogger and Hatcher tiers); PokéCoins,
Stardust, bag quantities of ten or more and badge progress move 5–25 % either way, and the bag's
total becomes their new sum; an incubating egg's progress is redrawn. The draws come from a stream
of their own, seeded from the export itself, so every other file comes out byte for byte as before
and nobody without the export can run the arithmetic backwards. Level, medal tiers, spend amounts,
species, and the journey's dates and timing are preserved so the story still feels real.

It fails closed. Every real value it can find is registered before a single file is written, from
the export being scrubbed and from every `--also` export. The last step sweeps every output file for
all of them — identifiers as substrings; places, labels and the carrier as whole words; places again
in the game's own UPPER_SNAKE key form; every account counter of five digits or more as a whole
number or decimal, and the start date as a whole date — and for emails, IPv4 and IPv6 addresses, UUIDs, URLs, 12+
digit runs, real coordinate values, columns that must stay empty, map-link coordinate pairs, and any
point within 120 m of a real place (from the journey logs, the location history, Campfire
meetups and map links, and Wayfarer). Failures name the kind of value, the file and the line, never
the value. The new sample is built in a temporary folder and swapped in only after a clean sweep, so
a hit — or a run stopped by Ctrl+C, SIGTERM or SIGHUP — publishes nothing and leaves the previous
sample exactly as it was (a folder stranded by SIGKILL is gitignored). **No identifying personal data
is present in `sample-export/`**, and that is verified on every run; its own README lists the real
values it keeps on purpose. The `README.md` inside the sample
is written by the scrubber from a template in `tools/scrub-demo.mjs`: edit the template, not the
file.

Two files owe nothing to a real export. The Campfire CSV (`AshDemo_20260812_120000.csv`) is
invented outright by `tools/campfire-sample.mjs` from a seeded generator, with Pokémon-world club and
venue names and meetups placed out at sea — a Campfire export is mostly other people's words plus the
coordinates of every meetup attended, which is nothing a scrubber should be trusted with. The
scrubber regenerates it and checks it byte for byte. The rival trainer's stats file behind the
You-vs-a-friend chapter is fictional: it is carried over from the sample being replaced (or else the
committed one), and with neither the run stops before writing anything.

`tools/test-parsers.mjs` covers all of it and more: the goldens (the Campfire ones included), the
Player_Journey pair rule, the exact-duplicate and stacking rules, a ZIP round trip through the app's
own reader, the WinZip AES download against archives written by an independent encoder
(`tools/fixtures/`, rebuilt by `make-fixtures.sh` with bsdtar from invented files and a public,
synthetic password) and the `ZIP_LIMITS`, the taint test, the subresource-integrity hashes, and a
check that every file `sw.js` precaches is on disk. It then reruns itself under five time zones.

> An earlier version translated every coordinate by one global offset. That is not anonymization —
> a rigid translation preserves every distance and bearing, so the published demo was one
> subtraction away from the real map. Don't reintroduce it.

> Independent fan project. Not affiliated with Scopely Explore, Inc. (formerly Niantic, Inc.), Scopely,
> Nintendo, or The Pokémon Company.
