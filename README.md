# POGO Metrics

**Your Pokémon GO journey, visualized.**

Pokémon GO keeps years of your trainer life — every catch, raid, friendship, step and purchase.
You have the right to a free copy of all of it. POGO Metrics turns that raw export into a
digestible summary & dashboard of your whole adventure.

Every file is parsed **locally in your browser**. There is no backend, no upload, no account.
Your data never leaves your device.

**[→ Try it](https://pogo-metrics.netlify.app/)**  ·  **[→ See a live example first](https://pogo-metrics.netlify.app/demo.html)**

---

## Why this exists

Getting your Pokémon GO data is easy. Understanding it is not.

What comes back is a zip of `.tsv`, `.csv`, `.txt` and `.json` files with names like
`Sfida_capture1.csv` and column headers like `Fort_Latitude`. Somewhere in there is the story
of every place you've played, every friend you've made, and every year you've put into the game
— but you'd need a spreadsheet and a free afternoon to see any of it.

POGO Metrics reads those files the way they actually are and gives you the story instead.

It also solves a smaller problem: **requesting your export takes anywhere from a day to a few weeks.** Rather than leaving
you staring at a "come back later" page, the site spends that gap teaching you exactly what
the game holds on you, file by file, and how revealing each one is — so when the zip arrives you
already know what you're looking at and can upload only what you're comfortable with.

That catalog is searchable down to the export's own column names: type `latitude` and it shows you
the two files that carry your coordinates, quoting the real `Player_Latitude` header back at you.
Filter by sensitivity, or by the files this site deliberately never reads.

## What you get

Each file you drop in lights up its own chapter. Upload one file or the whole export:

| Chapter | Built from |
|---|---|
| **Trainer card** — level, XP, distance, collection by region, medal cabinet, trainers you referred | `Gameplay.txt` |
| **Your bag** — what you're carrying, by kind, plus the eggs on your bench | `Gameplay.txt` |
| **Adventure log** — monthly timeline, hour-of-week rhythm, activity breakdown | `Player_Journey/*.csv` |
| **Your rhythm** — play sessions rebuilt from timestamps, and the stops and gyms you keep going back to | `Player_Journey/*.csv` |
| **Your last day on the map** — a minute-by-minute close-up of your most recent session, with the CP of the ones that got away and the gifts friends sent | `Gameplay.txt` |
| **Year over year** — every year compared, plus a shareable recap card per year (downloadable PNG; single-year journeys get their card too), with a "🎪 I was there" badge for any in-person GO Fest your export places you at | `Player_Journey/*.csv` |
| **Your world** — a 3D globe of everywhere you've played, GPS trail, and remote-raid arcs | location files |
| **Social** — friendships over time, how you connect, who reaches out first, and which weekdays your invites land on | `FriendList.tsv` and friends |
| **Spending** — coin flow, top items, which storefront, free boxes and support gifts | `InAppPurchases.tsv` |
| **Fitness** — Adventure Sync steps and real-world equivalents | `FitnessData.tsv` |
| **Photo album** — every GO Snapshot you've taken, by month | `ImageData.txt` |
| **Record book** — your personal bests, plus **next-milestone countdowns** projected from your recent pace (with one-tap calendar reminders) | `Player_Journey/*.csv` |
| **You vs. a friend** — send a friend your compare file (My numbers → Send my compare file), add the one they send back, and each of you gets a side-by-side chapter: action by action, and who peaked when | a friend's `pogo-metrics-stats-*.json` compare file |
| **Behind the screen** — sessions, devices, cities, countries, support tickets, your device eras (app and OS versions) and your install history | app sessions, installs, support |
| **Live events and map-making** — the events you bought into, with add-on orders counted as a yes or a no (never what the add-on was), and your Wayfarer review activity and the star ratings you gave | tickets, `wayfarer_player_data.json` |
| **Around the Campfire** — meetups hosted, RSVP'd and actually attended, hours at meetups and typical turnout, what gets you out the door, club chat by month and its chattiest hour, your Campfire circle (counts and dates only) | the Campfire app's own export CSV |

Nothing is required. Upload only `FriendList.tsv` and you'll get exactly the social chapter and
nothing else.

The journey logs record encounters — on the map, from incense and lures, and through GO Plus — but
not whether each Pokémon was caught, so the report calls that sum what it is: Pokémon encountered.

### Five things to do with the result

Once your story is built (it builds itself moments after a drop), the toolbar above it offers:

- **▶ Play my story** — a full-screen recap in the Wrapped grammar: slides auto-advance with a
  filling progress bar, hold to pause, swipe (or tap the edges, or use arrow keys) to move, Esc
  or the Android Back button to close. It ends on your computed **trainer type** ("The Raid
  Boss", "The Night Owl"…) and — if `Gameplay.txt` was included — where your level lands among
  the Trainer Model's real cohort. Every stat slide has a **Share this** button that renders
  that one number as a phone-story-sized (1080×1920) image straight into the share sheet, and
  each card in the Year-over-year chapter has a **▶ Play <year>'s story** of its own.
- **Journey card** — your entire journey as one shareable PNG: headline totals, a month-by-month
  chart with a legend, and auto-awarded badges (your trainer type leads them). The Year-over-year
  chapter offers the same thing per year.
- **Poster** — a print-ready 2480×3508 PNG for the wall: your name, lifetime numbers, and one
  calendar heat-strip for every year of the journey. (The report also carries print styles now,
  so plain Cmd+P works too.)
- **My numbers** — two files. **Send my compare file** makes the small file a friend's
  You-vs-a-friend chapter reads: your trainer name, your action totals, actions per month and per
  day, and your friend count, nothing else. It goes out through your device's share sheet, or
  downloads where there is none. **Download my full stats** saves every figure the app computed,
  for anyone who'd rather have the data than the pictures; it includes your trainer profile,
  spending, devices and daily steps, so it is marked as just for you — treat it like any personal
  export. **Location data is left out of both** — no GPS trail, no stop or activity coordinates,
  no cities, no countries. Those stay in the browser.
- **Add more files** — drop in the rest of your export later and the new chapters appear
  alongside the ones you already have. Drop an older or newer export as well, and the two stack
  into one history (see "More than one export" below).

On the globe, **▶ Replay my journey** plays your whole history chronologically — spots,
remote-raid arcs and the GPS trail accumulate month by month under a date ticker.

### Finding your way around

A chapter rail sits beside the report (a strip under the nav on phones) and follows the scroll,
so you always know where you are in seventeen chapters. **One at a time** at the top of the rail
switches to reader mode: a single chapter with previous and next at its foot. On the upload page,
a **build console** lists every chapter and the file that unlocks it before you add a thing, and
lights them up as files land; once a report exists the picker folds into one strip.

### More than one export

An export only remembers so much — its GPS trail keeps about two months — so the report ends with a
reminder to export again in 60 days: a calendar file made on your device, with nothing sent
anywhere. Keep every export, then drop them all at once — as folders, ZIPs or loose files, in one
drop or several — and they stack into one history:

- **Journey logs** keep every event once. An event two exports share is matched on its exact
  timestamp and counted once, and a row repeated byte for byte inside one file counts once too.
- **Rolling logs and ledgers** (purchases, the invite log and the like) keep every row either export
  holds, each as many times as the copy that holds it most.
- **Snapshots** — your friend list, your profile, Wayfarer — come from the newest export, judged by
  the dates inside it, never by file dates or the order things were dropped in.

Copies are harmless: Finder's "Keep Both" (`Pokestop_spin1 2.csv`) and Duplicate (`Gameplay
copy.txt`), a browser's `FriendList (1).tsv`, Windows' `FriendList - Copy.tsv`, a ZIP beside its
own unzipped folder, a folder dropped twice. Identical copies are recognised by their SHA-256 and
counted once, and the report's header says how many exports it merged and how many identical
copies it counted once.

## Privacy, concretely

This is the whole point, so it should be checkable rather than promised:

- **100% client-side.** Files are read with `FileReader`/`.text()` and parsed in the browser.
  There is no server to upload to. Close the tab and it's gone.
- **No account, no tracking, no analytics, no cookies.**
- **No external requests at all.** Chart.js, Leaflet, globe.gl, the fonts,
  the globe textures and the country borders are all vendored into `vendor/`. Each library ships
  under a versioned filename and carries a `sha384` integrity hash, so the browser runs only the
  exact bytes committed here.
- **Your locations are mapped, and nothing else sensitive is.** The globe and the map are the
  point, so they do plot where you played — on your device, published nowhere. Your email, IP
  addresses and advertising IDs are never shown, charted, or written to any export. To be exact
  about it: the browser hands the app whole files, so those columns pass through memory like every
  other column — no parser extracts them, nothing renders them, and the `connect-src 'self'` policy
  below means nothing *could* send them anywhere. The catalog on the landing page rates how
  sensitive each file is *before* you open it.
- **The browser enforces it.** The deployed site ships a `Content-Security-Policy` with
  `connect-src 'self'` (see `netlify.toml`), so no script — ours or otherwise — *can* fetch, XHR,
  WebSocket or beacon your data off-origin. (Precisely that: `connect-src` governs those APIs, not
  navigation. Nothing here navigates with parsed data, but this section invites you to check it,
  so it should survive the check.) Scripts are `script-src 'self'` and nothing else: no page has
  an inline script or an inline event handler, so an injected one has nothing to run on. Every page
  repeats the policy in a `<meta>` tag, so a copy opened from anywhere else stays under it. The site
  also sends a `Permissions-Policy` (no camera, microphone, location, payments or USB), a
  `Cross-Origin-Opener-Policy`, and a `Cross-Origin-Resource-Policy` that stops other sites from
  loading its scripts, styles and data (only the share images stay embeddable). Everything read
  from your files is escaped before it reaches the page, and the test suite plants markup in every
  field the parsers read to check that none of it renders.
- **It works in airplane mode.** A service worker caches the pages, both stylesheets, every app
  script, the chart library and the Trainer Model's cohort data, so once you've visited, the app
  loads and parses an export — and the research layer draws — with no network at all. The 3D
  globe's assets are large and cache on first use instead, so the globe chapter needs one online
  build before it too works offline.
- **You can audit all of it** — it's ~10,700 lines of vanilla JavaScript in this repo, no build step.

## Getting your data

In Pokémon GO: **Poké Ball → Settings → Help → Chat with us → New Conversation → My account →
Request my data → Continue.** You'll get a download link and a password by email — within a day
under Niantic, about four weeks for our first request since Scopely took over the game. Drop the
downloaded ZIP on the upload page and type its password: the ZIP is opened in your browser, the
`Player_Journey.zip` inside it too, and the password never leaves your device and isn't stored. If
you'd rather unzip it yourself, Keka or The Unarchiver (Mac) and 7-Zip (Windows) open it; then drop
the whole folder in.

**Niantic → Scopely Explore.** Scopely acquired Niantic's games business in 2025 and in July 2026
renamed the team Scopely Explore; the privacy policy in effect since August 20, 2026 is in the name
of Scopely Explore, Inc. (formerly Niantic, Inc.). We diffed a June 2026
export against an August 2026 one: the same 22 files and the same 21-file journey archive, identical
column headers (some still say "Niantic"), the same timestamp formats and the same retention windows.
Only the folder name changed (a random ID instead of `Pokemon GO Data`) and the wait got longer —
about four weeks for our one request, against the privacy policy's stated target of 30 days. The
landing page carries the full before/after table. Campfire, meanwhile, has an export of its own — a
single CSV you can request from the Campfire app — and this site reads it as one more chapter.

This is a free right under privacy laws like GDPR and CCPA — not a hack or a third-party service.

## Running it locally

Static HTML/CSS/JS. No build step, no dependencies to install.

```sh
node pogo-metrics/static-server.mjs pogo-metrics 8770
```

Then open <http://127.0.0.1:8770/>. A real HTTP server is needed because the globe textures and
map data load over `fetch()`, which `file://` blocks. The server sends the same security headers as
the live site, so a local preview runs under the real policy, and it answers only requests
addressed to `127.0.0.1` or `localhost` on its own port.

## Repository layout

```
pogo-metrics/          the deployed site (netlify.toml publishes this folder as-is)
├── index.html         landing page + the file-by-file data catalog
├── metrics.html       the app: drag in your export, get your chapters
├── demo.html          live example, rendered from an anonymized sample
├── trainer-model.html the Trainer Model: a friends-list cohort vs. the level cap
├── js/
│   ├── app.js         the engine — parsers + every chapter
│   ├── catalog.js     knowledge base: one entry per file in an export
│   ├── catalog-ui.js  the filterable catalog on the landing page
│   ├── demo-page.js   the Live Example's page flag (a file, because no page has inline script)
│   ├── landing.js     landing page: live preview, section sub-nav, level-50 histogram
│   ├── nav.js         shared top navigation, icon set and chapter-rail builder
│   ├── pokedex.js     name → National Dex map (gens 1–3)
│   └── trainer-model.js   the Trainer Model dashboard engine
├── css/style.css      the site-wide stylesheet — no preprocessor
├── css/trainer-model.css  page-only styles for the Trainer Model, scoped under .tmodel
├── sample-export/     anonymized sample export (named for what it is, not for the
│                      page that loads it — see netlify.toml on the name collision)
├── data/trainer-model/    the pseudonymized cohort JSONs behind the Trainer Model page
├── tools/scrub-demo.mjs   regenerates sample-export/ from a real export
├── tools/campfire-sample.mjs  invents the sample's synthetic Campfire CSV (nothing derived)
├── tools/test-parsers.mjs runs every parser against sample-export/ as a regression check
├── tools/sri.mjs          checks every vendor integrity hash (--write updates them)
├── tools/fixtures/        tiny password-protected test archives built from invented files
│                          (make-fixtures.sh rebuilds them with bsdtar)
├── og-card.html       source for the share image; render it to regenerate og-image.png
│                      (og-card-demo.html / og-card-model.html do the same for their pages)
├── og-image.png       1200×630 Open Graph / Twitter card (+ -demo and -model variants)
├── 404.html           branded not-found page (Netlify serves it automatically)
├── sw.js              service worker: installable + fully offline-capable
├── site.webmanifest   PWA manifest (+ favicon-32 / apple-touch-icon / icon-192 / icon-512)
├── robots.txt         keeps the og-card pages out of search (sample export + cohort data are
│                      excluded via noindex headers instead — see netlify.toml); sitemap.xml alongside
├── static-server.mjs  tiny dependency-free static server for local preview
└── vendor/            Chart.js, Leaflet, globe.gl, fonts, geo — vendored under versioned names,
                       lazy-loaded
```

## The sample export

`sample-export/` is generated from a real export by `tools/scrub-demo.mjs`. Every name, codename,
friend nickname, gift sender, email, order number, IP, ad-ID, account ID, referral code and carrier
is faked or dropped, support message bodies are removed, the labels typed on Pokémon are stripped
(species kept), live-event ticket names are replaced with invented ones, cities and countries are
remapped (the cities to Pokémon-world towns), and the big event logs are downsampled. Every
in-person event medal becomes a neutral key (`BADGE_EVENT_IN_PERSON_1`, `_2`, …) that keeps its
count but names no event, place, year, day or session. A few columns are kept because the report
reads them, each only in its public shape: install time, app and OS version, platform, and device
model and category in the session logs; each support ticket's date and topic, under a new ticket
number; each Wayfarer entry's date and star rating; and a live-event add-on only as the word
"add-on". The account's counters are perturbed, never copied, because a trainer profile
shows several of them to every friend: the start date moves a few weeks earlier, and total XP,
PokéCoins, Stardust, distance walked, eggs hatched, the bag's quantities and badge progress move by
a believable amount, every medal staying in its tier. Level, medal tiers, spend amounts, species, and
the journey's dates and timing are preserved so the story still feels real.

**Coordinates are generated, not anonymized.** No location in `sample-export/` is derived from a real one.
The scrubber builds a synthetic world — one home city and seven travel cities — and assigns each
distinct real coordinate a place in it by *how often it appears*, never by where it is. Frequency
rank is the only thing that crosses over, and visit counts are already on screen in the app, so
nothing new is exposed. Two real stops that were metres apart routinely land on different
continents. What survives is the *distribution* that makes the sample worth looking at: one stop you
visit constantly, a long tail you don't, a home city, some travel, and raids far enough away to
count as remote.

The scrubber will not let you ship a half-anonymized demo. Before it writes a single file it
records every real value it can find — in the export being scrubbed and in any older one named with
`--also` — and the last thing it does is sweep every output file for all of them, and for email
addresses, IP addresses, UUIDs, URLs, long digit runs, any real coordinate value and any point
within 120 m of a real place, measured. The new sample is built in a temporary folder and swapped in
only when that sweep is clean: a hit, or an interrupted run, publishes nothing and leaves the
previous sample exactly as it was, and a failure names the kind of value, the file and the line,
never the value. **No identifying personal data is present**, and that is checked rather than
asserted; `sample-export/README.md` lists the real values it keeps on purpose.

Two files are not derived from a real export at all. The Campfire CSV is invented by
`tools/campfire-sample.mjs` from a seeded generator — a Campfire export is mostly other people's
words plus meetup coordinates, and no scrubber should be trusted with that. The rival trainer's
stats file behind the You-vs-a-friend chapter is fictional, and each regeneration carries it over.

```sh
node pogo-metrics/tools/scrub-demo.mjs "<export folder>" [out-dir] [--also "<older export>"]...
```

The export folder can hold the journey logs unzipped (`Player_Journey/`) or the way the export
ships them (`Player_Journey.zip`, read in memory). The committed sample was built from an August
2026 export with a June 2026 export passed as `--also`, and it ships both halves of each journey
pair.

## The Trainer Model layer

Everything above is one player's story, told from their own export. `trainer-model.html` is the
population view: a real friends-list cohort — 390 trainers in a single snapshot from February
2025 (when the level cap was 50) and 493 trainers re-recorded across three sessions in August
2026 (under the new cap of 80) — plotted to show what the level cap does to trainer stats. It marks the project's
original straight-line level model honestly against reality, lets visitors benchmark their own
numbers against their level band, and keeps the two eras strictly separate, because the XP
rebalance made levels incomparable across them.

Because that second era was recorded more than once, it is also the only place a clock touches
this data: trainers seen in two sessions give a measured interval, published as an aggregate
`pace` block. It is reported as what happened in one short window — 8 of 213 re-recorded
trainers gained a level — and deliberately never extrapolated into a time-to-80.

The data ships in `data/trainer-model/` as two JSONs. Handles are replaced with placeholder IDs
before the data ever enters this repo; every stat is real and unmodified, so the rows are
pseudonymized rather than anonymized: each one is a single trainer's exact figures. Per-level statistics
are withheld wherever fewer than five trainers share a level — at that size a "median" is just
one person's numbers, so publishing it would be neither an average nor anonymous. Like `/sample-export/*`,
the raw files are crawlable but carry an `X-Robots-Tag: noindex` header (see `netlify.toml`) so
they never surface in search results themselves.

## Part of the Observation Deck

POGO Metrics is one instrument in the [Observation Deck](https://observation-deck.netlify.app/) —
a fleet of small, live web tools built from a curious mind that loves to learn.

---

Independent fan project, made for the community. Not affiliated with, endorsed by, or sponsored by
Scopely Explore, Inc. (formerly Niantic, Inc.), Scopely, Nintendo, or The Pokémon Company. Pokémon
and Pokémon GO are trademarks of their respective owners.
