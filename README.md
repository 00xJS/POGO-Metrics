# POGO Metrics

**Your Pokémon GO journey, visualized.**

Niantic keeps years of your trainer life — every catch, raid, friendship, step and purchase.
You have the right to a free copy of all of it. POGO Metrics turns that raw export into a
digestible summary & dashboard of your whole adventure.

Every file is parsed **locally in your browser**. There is no backend, no upload, no account.
Your data never leaves your device.

**[→ Try it](https://pogo-metrics.netlify.app/)**  ·  **[→ See a live example first](https://pogo-metrics.netlify.app/demo.html)**

---

## Why this exists

Getting your Pokémon GO data is easy. Understanding it is not.

What Niantic sends back is a zip of `.tsv`, `.csv`, `.txt` and `.json` files with names like
`Sfida_capture1.csv` and column headers like `Fort_Latitude`. Somewhere in there is the story
of every place you've played, every friend you've made, and every year you've put into the game
— but you'd need a spreadsheet and a free afternoon to see any of it.

POGO Metrics reads those files the way they actually are and gives you the story instead.

It also solves a smaller problem: **requesting your export takes 3–5 days.** Rather than leaving
you staring at a "come back later" page, the site spends that gap teaching you exactly what
Niantic holds on you, file by file, and how revealing each one is — so when the zip arrives you
already know what you're looking at and can upload only what you're comfortable with.

That catalog is searchable down to Niantic's own column names: type `latitude` and it shows you
the two files that carry your coordinates, quoting the real `Player_Latitude` header back at you.
Filter by sensitivity, or by the files this site deliberately never reads.

## What you get

Each file you drop in lights up its own chapter. Upload one file or the whole export:

| Chapter | Built from |
|---|---|
| **Trainer card** — level, XP, distance, collection by region, medal cabinet | `Gameplay.txt` |
| **Your bag** — what you're carrying, by kind, plus the eggs on your bench | `Gameplay.txt` |
| **Adventure log** — monthly timeline, hour-of-week rhythm, activity breakdown | `Player_Journey/*.csv` |
| **Your rhythm** — play sessions rebuilt from timestamps, and the stops and gyms you keep going back to | `Player_Journey/*.csv` |
| **Your last day on the map** — a minute-by-minute close-up of your most recent session, with the CP of the ones that got away | `Gameplay.txt` |
| **Year over year** — every year compared, plus a shareable recap card per year (downloadable PNG; single-year journeys get their card too) | `Player_Journey/*.csv` |
| **Your world** — a 3D globe of everywhere you've played, GPS trail, and remote-raid arcs | location files |
| **Social** — friendships over time, how you connect, who reaches out first | `FriendList.tsv` and friends |
| **Spending** — coin flow, top items, which storefront, free boxes and support gifts | `InAppPurchases.tsv` |
| **Fitness** — Adventure Sync steps and real-world equivalents | `FitnessData.tsv` |
| **Photo album** — every GO Snapshot you've taken, by month | `ImageData.txt` |
| **Behind the screen** — sessions, devices, cities, countries, support tickets | app sessions, installs, support |
| **Live events and Wayfarer contributions** | tickets, `wayfarer_player_data.json` |

Nothing is required. Upload only `FriendList.tsv` and you'll get exactly the social chapter and
nothing else.

## Privacy, concretely

This is the whole point, so it should be checkable rather than promised:

- **100% client-side.** Files are read with `FileReader`/`.text()` and parsed in the browser.
  There is no server to upload to. Close the tab and it's gone.
- **No account, no tracking, no analytics, no cookies.**
- **No external requests at all.** Chart.js, Leaflet, globe.gl, the fonts,
  the globe textures and the country borders are all vendored into `vendor/`.
- **Your locations are mapped, and nothing else sensitive is.** The globe and the map are the
  point, so they do plot where you played — on your device, published nowhere. Your email, IP
  addresses and advertising IDs are never read at all. The visualizations only touch the parts that tell
  a story. The catalog on the landing page rates how sensitive each file is *before* you open it.
- **The browser enforces it.** The deployed site ships a `Content-Security-Policy` with
  `connect-src 'self'` (see `netlify.toml`), so no script — ours or otherwise — *can* send your
  data anywhere off-origin.
- **It works in airplane mode.** Once visited, a service worker makes the whole app run offline —
  the strongest proof there's nothing to upload to.
- **You can audit all of it** — it's ~3,000 lines of vanilla JavaScript in this repo, no build step.

## Getting your data from Niantic

In Pokémon GO: **Poké Ball → Settings → Help → Chat with us → New Conversation → My account →
Request my data → Continue.** You'll get a download link and a password by email, usually within
3–5 days (Niantic allows up to 7). Unzip it, then drop the files in.

This is a free right under privacy laws like GDPR and CCPA — not a hack or a third-party service.

## Running it locally

Static HTML/CSS/JS. No build step, no dependencies to install.

```sh
node pogo-metrics/static-server.mjs pogo-metrics 8770
```

Then open <http://127.0.0.1:8770/>. A real HTTP server is needed because the globe textures and
map data load over `fetch()`, which `file://` blocks.

## Repository layout

```
pogo-metrics/          the deployed site (netlify.toml publishes this folder as-is)
├── index.html         landing page + the file-by-file data catalog
├── metrics.html       the app: drag in your export, get your chapters
├── demo.html          live example, rendered from an anonymized sample
├── js/
│   ├── app.js         the engine — parsers + every chapter
│   ├── catalog.js     knowledge base: one entry per file in a Niantic export
│   ├── catalog-ui.js  the filterable catalog on the landing page
│   ├── nav.js         shared top navigation
│   └── pokedex.js     name → National Dex map (gens 1–3)
├── css/style.css      the whole stylesheet — one file, no preprocessor
├── demo/              anonymized sample export
├── tools/scrub-demo.mjs   regenerates demo/ from a real export
├── og-card.html       source for the share image; render it to regenerate og-image.png
├── og-image.png       1200×630 Open Graph / Twitter card
├── 404.html           branded not-found page (Netlify serves it automatically)
├── sw.js              service worker: installable + fully offline-capable
├── site.webmanifest   PWA manifest (+ favicon-32 / apple-touch-icon / icon-192 / icon-512)
├── robots.txt         keeps demo data + og-card out of search; sitemap.xml alongside
├── static-server.mjs  tiny dependency-free static server for local preview
└── vendor/            Chart.js, Leaflet, globe.gl, fonts, geo — all vendored, lazy-loaded
```

## The demo dataset

`demo/` is generated from a real export by `tools/scrub-demo.mjs`. Every name, email, order number,
IP, ad-ID, account ID and referral code is faked or dropped, support message bodies are removed,
cities and countries are remapped, and the big event logs are downsampled. Numbers, dates, medals,
species and timing are preserved so the story still feels real.

**Coordinates are generated, not anonymized.** No location in `demo/` is derived from a real one.
The scrubber builds a synthetic world — one home city and seven travel cities — and assigns each
distinct real coordinate a place in it by *how often it appears*, never by where it is. Frequency
rank is the only thing that crosses over, and visit counts are already on screen in the app, so
nothing new is exposed. Two real stops that were metres apart routinely land on different
continents. What survives is the *distribution* that makes the demo worth looking at: one stop you
visit constantly, a long tail you don't, a home city, some travel, and raids far enough away to
count as remote.

The scrubber will not let you ship a half-anonymized demo: it records every identifier it
replaces, then re-reads everything it wrote and fails — deleting the output rather than
publishing it — if any of them survived, or if any email address, IP address, or real coordinate
value appears anywhere. **No real personal data is present**, and that is checked rather than
asserted.

```sh
node pogo-metrics/tools/scrub-demo.mjs "<path to an unzipped export>"
```

## Part of the Observation Deck

POGO Metrics is one instrument in the [Observation Deck](https://observation-deck.netlify.app/) —
a fleet of small, live web tools built from a curious mind that loves to learn.

---

Independent fan project, made for the community. Not affiliated with, endorsed by, or sponsored by
Niantic, Scopely, Nintendo, or The Pokémon Company. Pokémon and Pokémon GO are trademarks of their
respective owners.
