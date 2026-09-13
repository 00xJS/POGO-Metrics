/* app.js — POGO Metrics engine.
 *
 * Reads raw Niantic Pokémon GO data-export files entirely in the browser,
 * parses each recognized file, and renders a per-file "story" module. Nothing
 * is uploaded anywhere — every File is read with FileReader/.text() locally.
 *
 * Each uploaded file lights up its own chapter, so a single FriendList.tsv
 * produces just the social module, while a full export produces the lot. */

/* ───────────────────────────── constants ───────────────────────────── */
/* CSS can't reach canvas/WebGL animation, so motion driven from JS checks this too. */
const REDUCED_MOTION = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const scrollBehavior = () => (REDUCED_MOTION ? "auto" : "smooth");
/* Chart/canvas colors, resolved ONCE from the stylesheet's custom properties.
 * Canvas contexts need literal values, so this is the one legitimate bridge out
 * of style.css — change a token there and every chart, the globe, and the PNG
 * cards follow. The literals below are only fallbacks for anything that runs
 * before the stylesheet; style.css is the source of truth.
 * Semantics worth keeping: `red` maps to --down (#ff6b6b), NOT --pokeball-red —
 * the stylesheet reserves the Pokéball red for the logo dot alone. */
const C = (() => {
  const fallback = {
    teal: "#41d8c6", yellow: "#ffcb05", red: "#ff6b6b", blue: "#3b6cff",
    purple: "#a06bff", pink: "#ff6bb3", orange: "#ff9a44", green: "#3ddc84",
    dim: "#9ba1c5", faint: "#848ab0", ink: "#e8eaf6", bg: "#0a0d1c", panel2: "#171c47",
    line: "rgba(255,255,255,.09)",
  };
  const tokens = {
    teal: "--accent", yellow: "--accent2", red: "--down", blue: "--blue",
    purple: "--purple", pink: "--pink", orange: "--orange", green: "--live",
    dim: "--ink-dim", faint: "--ink-faint", ink: "--ink", bg: "--bg", panel2: "--panel2",
    line: "--line",
  };
  const out = { grid: "rgba(255,255,255,.06)" };
  try {
    const cs = getComputedStyle(document.documentElement);
    for (const k of Object.keys(tokens)) out[k] = cs.getPropertyValue(tokens[k]).trim() || fallback[k];
  } catch (e) { Object.assign(out, fallback); }
  return out;
})();
const SERIES_COLORS = {
  "GO Plus catches": C.teal, "Spins": C.blue, "Encounters": C.yellow,
  "Berries fed": C.green, "Raids": C.red, "Incense": C.purple,
  "Gym battles": C.orange, "Lures": C.pink, "Deploys": "#7f8db8",
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const DAY_FULL = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const GEN_RANGES = [
  [1, 1, 151, "Kanto"], [2, 152, 251, "Johto"], [3, 252, 386, "Hoenn"],
  [4, 387, 493, "Sinnoh"], [5, 494, 649, "Unova"], [6, 650, 721, "Kalos"],
  [7, 722, 809, "Alola"], [8, 810, 905, "Galar"], [9, 906, 1025, "Paldea"],
];
/* maps a Player_Journey filename to its human event label */
const PJ_EVENTS = [
  [/pokestop_spin/i, "Spins"], [/sfida_capture/i, "GO Plus catches"],
  [/map_pokemon_encounter/i, "Encounters"], [/join_raid_lobby/i, "Raids"],
  [/gym_battle/i, "Gym battles"], [/feed_pokemon/i, "Berries fed"],
  [/deploy_pokemon/i, "Deploys"], [/incense_encounter/i, "Incense"],
  [/lure_encounter/i, "Lures"],
];
const CUR_SYM = { USD: "$", EUR: "€", GBP: "£", INR: "₹", IDR: "Rp ", JPY: "¥", AUD: "A$", CAD: "C$", BRL: "R$" };

/* GO Fest dates, used to turn anonymous activity spikes into memories ("your
 * #1 day was GO Fest 2024") and to award the "I was there" badge. One entry per
 * event, first to last day inclusive, in the event's own local dates.
 *
 * An entry with a `box` is an IN-PERSON festival. It counts only for a trainer
 * whose own precise positions put them inside that city box during those dates
 * (see FEST_VENUES and parsePlayerJourney) — a spin at home on Chicago's
 * Saturday is not a GO Fest day. Entries without a box are global and count for
 * anyone who played. Boxes are city-sized on purpose, [south, west, north, east]
 * in degrees: the badge claims a city and a year, never a park or a day. `tz` is
 * the venue's UTC offset during the event; `venue` is the park itself, kept only
 * so the test suite can check that every box contains its festival.
 *
 * Sources, checked 2026-09-11:
 *   pokemongo.com/post/gofest2022-finale-event — the 2022 Finale was one day,
 *     Saturday Aug 27, 10:00–18:00 local time.
 *   pokemongo.com/post/go-fest-2025-events-announcement — Osaka May 29–Jun 1
 *     (Expo '70 Commemorative Park, in Suita), Jersey City Jun 6–8 (Liberty
 *     State Park), Paris Jun 13–15 (Parc de Sceaux, just outside Paris),
 *     Global Jun 28–29.
 *   pokemongo.com/en/news/save-the-date-go-fest-2026 and
 *   pokemongohub.net/post/news/all-pokemon-go-fest-2026-locations-and-dates-revealed/
 *     — Tokyo May 29–Jun 1 (the Bay Area; the main park is in Odaiba), Chicago
 *     Jun 5–7 (Grant Park), Copenhagen Jun 12–14 (Fælledparken).
 *   pokemongo.com/news/gofest2026-finale-save-the-date — Mega Finale Sep 5–6, global.
 * The 2022–2024 in-person festivals are not listed yet: add them the same way,
 * one line each, once their dates are checked. */
const CITY_BOX = {
  chicago: [41.64, -87.94, 42.03, -87.52],     // city limits
  tokyo: [35.52, 139.56, 35.82, 139.92],       // the 23 wards, Odaiba included
  copenhagen: [55.61, 12.45, 55.73, 12.65],    // with Frederiksberg
  osaka: [34.58, 135.38, 34.85, 135.62],       // Osaka and Suita, where the Expo '70 park is
  jerseyCity: [40.66, -74.12, 40.77, -74.02],  // stops at the Hudson — Manhattan is not Jersey City
  paris: [48.70, 2.15, 48.95, 2.55],           // Paris and the inner suburbs, Sceaux included
};
const GO_FESTS = [
  { name: "GO Fest 2017 (Chicago)", from: "2017-07-22", to: "2017-07-22", city: "Chicago", tz: -5, box: CITY_BOX.chicago, venue: [41.8757, -87.6189] },
  { name: "GO Fest 2018 (Chicago)", from: "2018-07-14", to: "2018-07-15", city: "Chicago", tz: -5, box: CITY_BOX.chicago, venue: [41.9214, -87.6337] },
  { name: "GO Fest 2019 (Chicago)", from: "2019-06-13", to: "2019-06-16", city: "Chicago", tz: -5, box: CITY_BOX.chicago, venue: [41.9214, -87.6337] },
  { name: "GO Fest 2020 (Global)", from: "2020-07-25", to: "2020-07-26" },
  { name: "GO Fest 2021 (Global)", from: "2021-07-17", to: "2021-07-18" },
  { name: "GO Fest 2022 (Global)", from: "2022-06-04", to: "2022-06-05" },
  { name: "GO Fest 2022 Finale", from: "2022-08-27", to: "2022-08-27" },
  { name: "GO Fest 2023 (Global)", from: "2023-08-26", to: "2023-08-27" },
  { name: "GO Fest 2024 (Global)", from: "2024-07-13", to: "2024-07-14" },
  { name: "GO Fest 2025 (Osaka)", from: "2025-05-29", to: "2025-06-01", city: "Osaka", tz: 9, box: CITY_BOX.osaka, venue: [34.8095, 135.5323] },
  { name: "GO Fest 2025 (Jersey City)", from: "2025-06-06", to: "2025-06-08", city: "Jersey City", tz: -4, box: CITY_BOX.jerseyCity, venue: [40.7033, -74.0535] },
  { name: "GO Fest 2025 (Paris)", from: "2025-06-13", to: "2025-06-15", city: "Paris", tz: 2, box: CITY_BOX.paris, venue: [48.7716, 2.2990] },
  { name: "GO Fest 2025 (Global)", from: "2025-06-28", to: "2025-06-29" },
  { name: "GO Fest 2026 (Tokyo)", from: "2026-05-29", to: "2026-06-01", city: "Tokyo", tz: 9, box: CITY_BOX.tokyo, venue: [35.6298, 139.7745] },
  { name: "GO Fest 2026 (Chicago)", from: "2026-06-05", to: "2026-06-07", city: "Chicago", tz: -5, box: CITY_BOX.chicago, venue: [41.8757, -87.6189] },
  { name: "GO Fest 2026 (Copenhagen)", from: "2026-06-12", to: "2026-06-14", city: "Copenhagen", tz: 2, box: CITY_BOX.copenhagen, venue: [55.7006, 12.5717] },
  { name: "GO Fest 2026 (Global)", from: "2026-07-11", to: "2026-07-12" },
  { name: "GO Fest 2026 Mega Finale", from: "2026-09-05", to: "2026-09-06" },
];
const festDayMs = (iso) => Date.parse(iso + "T00:00:00Z");
function festDays(f) {
  const out = [];
  for (let t = festDayMs(f.from); t <= festDayMs(f.to); t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}
/* date → label for the GLOBAL festivals. Built from the list rather than written
 * as an object literal: two events on one day were two identical keys there, and
 * the later one silently won. Here they share the day. */
const GO_EVENTS = {};
for (const f of GO_FESTS) if (!f.box) for (const d of festDays(f)) GO_EVENTS[d] = GO_EVENTS[d] ? GO_EVENTS[d] + " · " + f.name : f.name;
/* The in-person festivals, each as a UTC window from the venue's first local
 * midnight to the one after its last day, so a journey row costs a few compares. */
const FEST_VENUES = GO_FESTS.filter((f) => f.box).map((f) => ({
  ...f, id: f.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""), year: f.from.slice(0, 4),
  t0: festDayMs(f.from) - f.tz * 3600000, t1: festDayMs(f.to) + 86400000 - f.tz * 3600000,
}));
const FEST_T0 = Math.min(...FEST_VENUES.map((v) => v.t0));
const FEST_T1 = Math.max(...FEST_VENUES.map((v) => v.t1));
/* One UTC day's label: every global festival on it, plus any in-person one the
 * export places this trainer at that day. An in-person date nobody here
 * attended stays unlabelled, so "GO Fest days attended" means what it says. */
function eventFor(iso) {
  const there = STATE.ev.there;
  const names = FEST_VENUES.filter((v) => there[v.id] && there[v.id].days[iso]).map((v) => v.name);
  if (GO_EVENTS[iso]) names.unshift(GO_EVENTS[iso]);
  return names.length ? names.join(" · ") : null;
}
/* "I was there": one badge per in-person festival the export places this
 * trainer at, for one year or for all of them. City and year only — never a
 * date, a venue or a coordinate — because it is drawn onto a PNG made to be shared. */
function festBadges(year) {
  const there = STATE.ev.there;
  return FEST_VENUES.filter((v) => there[v.id] && (!year || v.year === String(year)))
    .map((v) => `🎪 I was there · GO Fest ${v.city} ${v.year}`);
}

/* Gameplay.txt mixes real tiered medals with event/collection badges under the
 * same "BADGE_NAME: n" syntax. These families are participation badges whose
 * number is a count, not a Bronze-to-Platinum tier. */
const EVENT_BADGE = /^BADGE_(EVENT|GOFEST|GOTOUR|GO_TOUR|GOWA|SMORES|MINI_COLLECTION|COMMUNITY|SAFARI|CITY|WILD_AREA)/;

/* ───────────────────────────── tiny helpers ───────────────────────────── */
/* grouping follows the reader's locale — trainer-model.js already did; the
 * report was hard-locked to en-US, so the two pages disagreed on 1,234 vs 1.234 */
const fmt = (n) => Number(n).toLocaleString();
const round = (n) => Math.round(n);
/* Quotes too, not just < > &: an escaped value that lands inside an attribute
 * (data-info="…", aria-label="…") must not be able to close it. */
const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const titleCase = (s) => s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const base = (p) => (p || "").split("/").pop();
/* A second copy of an export file arrives under another name: Finder's "Keep
 * Both" calls it "Pokestop_spin1 2.csv", its Duplicate command "Gameplay
 * copy.txt", a browser download "FriendList (1).tsv", Windows "FriendList -
 * Copy.tsv". Routed under those names they read as files of their own — a
 * "Pokestop_spin1 2.csv" passed the loose event matcher as a third, precise
 * spin log and nearly doubled every journey total. The marker comes off before
 * anything is matched, and the file joins the others as another copy. */
const COPY_MARK = /(?:\s+-\s+copy(?:\s*\(\d+\))?|\s+copy(?:\s+\d+)?|\s*\(\d+\)|\s+\d+)$/i;
// a name with its copy markers taken off — a folder's too: "Player_Journey 2"
function stripCopyMark(stem) {
  let s = stem;
  for (let i = 0; i < 3 && COPY_MARK.test(s); i++) s = s.replace(COPY_MARK, "");
  return s || stem;
}
function canonicalName(name) {
  const b = base(name), dot = b.lastIndexOf(".");
  if (dot <= 0) return b;
  return stripCopyMark(b.slice(0, dot)) + b.slice(dot);
}
/* ISO-3166 code → country name, straight from the browser's own locale data:
 * a bundled 250-entry lookup table would be pure weight, and fetching one would
 * break the "no external requests at all" promise. Falls back to the raw code
 * wherever Intl.DisplayNames isn't available. */
const REGION_NAMES = (() => {
  try { return new Intl.DisplayNames(["en"], { type: "region" }); } catch (e) { return null; }
})();
function countryName(cc) {
  try { return (REGION_NAMES && REGION_NAMES.of(cc)) || cc; } catch (e) { return cc; }
}
let UID = 0;
const uid = () => "u" + ++UID;

/* All bucketing runs in UTC — the export's own timezone. Local getters here
 * would smear events near UTC month/day boundaries into neighbouring buckets
 * (even fabricating phantom years) and make the same export show different
 * numbers depending on the viewer's timezone. */
function monthKey(d) { return d.getUTCFullYear() + "-" + String(d.getUTCMonth() + 1).padStart(2, "0"); }
function fmtMonth(k) { const [y, m] = k.split("-"); return MONTHS[+m - 1] + " ’" + y.slice(2); }
function fmtDate(d) { return MONTHS[d.getUTCMonth()] + " " + d.getUTCDate() + ", " + d.getUTCFullYear(); }
function weekdayMon(d) { return (d.getUTCDay() + 6) % 7; } // 0 = Monday
/* The quarter hour a moment falls in, counted from the epoch. A tally keyed by
 * it stays UTC like every other bucket, yet still lets a card place each entry
 * in the viewer's own hour or weekday — with the offset in force at THAT moment,
 * daylight saving included, which one "current offset" for the lot cannot do.
 * Quarter hours, not hours: every offset in use is a whole number of them
 * (India +5:30, Nepal +5:45, Newfoundland −3:30), so the start of a slot sits in
 * the same local hour as everything inside it. A whole-hour key put anything
 * from the second half of a UTC hour an hour early in those places. */
const SLOT_MS = 15 * 60e3;
function slotKey(d) { return Math.floor(d.getTime() / SLOT_MS); }
function slotDate(k) { return new Date(k * SLOT_MS); }
function medianOf(a) {
  if (!a.length) return null;
  const s = a.slice().sort((x, y) => x - y), m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/* full inclusive list of month keys from first→last (fills gaps with zeros) */
function monthSpan(keys) {
  if (!keys.length) return [];
  const sorted = [...new Set(keys)].sort();
  const [y0, m0] = sorted[0].split("-").map(Number);
  const [y1, m1] = sorted[sorted.length - 1].split("-").map(Number);
  const out = [];
  let y = y0, m = m0;
  while (y < y1 || (y === y1 && m <= m1)) {
    out.push(y + "-" + String(m).padStart(2, "0"));
    if (++m > 12) { m = 1; y++; }
    if (out.length > 1000) break;
  }
  return out;
}

/* The shape ~99% of an export's timestamps actually are:
 *   2026-04-12 20:40:37.395 UTC   (Player_Journey, App_Sessions — the big files)
 *   2021-06-23T20:09:25.206Z      (FriendList, Fitness, ImageData, invites)
 * The trailing group is deliberately strict — empty, Z or " UTC" only. A stamp
 * carrying a real offset (…+05:00) must fall through to the branches below,
 * which hand it to Date and get the offset right; swallowing it here would
 * silently relabel it as UTC. */
const TS_UTC = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z| UTC)?$/;
function parseTS(s) {
  if (!s) return null;
  s = String(s).trim();
  /* Fast path first. Everything below it was written for the US-format
   * minority (InAppPurchases, the VS Seeker log) but ran on every row: the
   * common case paid a failed regex, three string replaces, a split and a
   * second regex before it matched. Measured over the 435,770 timestamps in a
   * real export: 209ms -> 126ms, and byte-identical output on all of them. */
  const f = TS_UTC.exec(s);
  if (f) return new Date(Date.UTC(+f[1], +f[2] - 1, +f[3], +f[4], +f[5], +f[6]));
  let m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d{2}):(\d{2}))?/);
  if (m) return new Date(Date.UTC(+m[3], +m[1] - 1, +m[2], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)));
  let t = s.replace(" UTC", "").replace("Z", "").replace("T", " ");
  if (t.includes(".")) t = t.split(".")[0];
  m = t.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ ](\d{2}):(\d{2}):(\d{2}))?$/);
  if (m) return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0)));
  const d = new Date(s);
  return isNaN(d) ? null : d;
}

function haversine(la1, lo1, la2, lo2) {
  const R = 6371, toR = (x) => (x * Math.PI) / 180;
  const dLa = toR(la2 - la1), dLo = toR(lo2 - lo1);
  const a = Math.sin(dLa / 2) ** 2 + Math.cos(toR(la1)) * Math.cos(toR(la2)) * Math.sin(dLo / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
}

/* Yield the main thread. MessageChannel, never setTimeout: a background tab
 * clamps timers to as little as once a minute, which would turn a paused build
 * into a stalled one. */
/* Async SUCCESS was silent to screen readers — errors have role=alert, but
 * files landing and the demo finishing produced nothing. One polite region,
 * cleared-then-set so repeat messages re-announce. */
let LIVE_EL = null;
function announce(msg) {
  if (!LIVE_EL) {
    LIVE_EL = document.createElement("div");
    LIVE_EL.className = "sr-only";
    LIVE_EL.setAttribute("role", "status");
    LIVE_EL.setAttribute("aria-live", "polite");
    document.body.appendChild(LIVE_EL);
  }
  LIVE_EL.textContent = "";
  setTimeout(() => { if (LIVE_EL) LIVE_EL.textContent = msg; }, 30);
}

function nextTick() {
  return new Promise((res) => { const mc = new MessageChannel(); mc.port1.onmessage = () => res(); mc.port2.postMessage(0); });
}

/* delimited parser: quote-aware for CSV, plain split for TSV */
function splitLines(text) {
  return text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((l) => l.length);
}
function lineSplitter(name) {
  if (/\.tsv$/i.test(name)) return (l) => l.split("\t");
  return (l) => {
    const out = []; let cur = "", q = false;
    for (let i = 0; i < l.length; i++) {
      const ch = l[i];
      if (q) { if (ch === '"') { if (l[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
      else if (ch === '"') q = true;
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur); return out;
  };
}

/* ── streaming rows, for the files that are actually big ──
 * parseRows below materialises EVERY row before returning, so one 8.9 MB
 * Sfida_capture was a single uninterruptible task — 458,944 row objects for a
 * real export, and a page frozen solid while they were built. Measured at 4x
 * CPU throttle the demo alone (4% the size of a real export) blocked for
 * 1,789 ms in one unbroken task.
 *
 * eachRow hands rows to a callback and yields every PARSE_CHUNK of them, so the
 * same work becomes many short tasks the browser can paint between. It also
 * stops early if the user hits Clear: DATA_GEN moves, and continuing to parse
 * into a STATE that has already been thrown away is pure waste. */
/* 5,000 rows per slice. Measured on a 450,000-row parse at 4x CPU throttle
 * (mid-range phone), longest single task: 15,000 rows -> 132ms, 8,000 -> 75ms,
 * 5,000 -> under the 50ms long-task threshold entirely, with total parse time
 * unchanged. Yield overhead is real but sits inside the noise; task length is
 * what a user feels. */
const PARSE_CHUNK = 5000;
async function eachRow(text, name, onRow, keepCells) {
  const lines = splitLines(text);
  if (!lines.length) return [];
  const splitLine = lineSplitter(name);
  const header = splitLine(lines[0]).map((h) => h.trim());
  const gen = DATA_GEN;
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]);
    const row = {};
    header.forEach((h, j) => (row[h] = (cells[j] || "").trim()));
    if (keepCells) row.__cells = cells;
    onRow(row, header);
    if (i % PARSE_CHUNK === 0) {
      await nextTick();
      if (gen !== DATA_GEN) return header;   // cleared mid-file — stop working
    }
  }
  return header;
}

/* keepCells: attach the raw positional cells to each row. Only the four
 * small-file parsers that fall back to positions when a header is missing or
 * renamed need it. The two parsers that see real volume (Player_Journey at
 * ~446k rows, and the GPS history) never read it, and attaching it there cost
 * ~37 MB of pointer arrays on a real export for nothing. */
function parseRows(text, name, keepCells) {
  const lines = splitLines(text);
  if (!lines.length) return { header: [], rows: [] };
  const splitLine = lineSplitter(name);
  const header = splitLine(lines[0]).map((h) => h.trim());
  const rows = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = splitLine(lines[i]);
    const row = {};
    header.forEach((h, j) => (row[h] = (cells[j] || "").trim()));
    if (keepCells) row.__cells = cells;
    rows.push(row);
  }
  return { header, rows };
}

/* ───────────────────────────── state ───────────────────────────── */
function freshState() {
  return {
    loaded: [],              // catalog names that produced data
    profile: null, collection: null, medals: [], recent: null, eggs: null,
    ev: {
      totals: {}, byMonth: {}, hourweek: Array.from({ length: 7 }, () => Array(24).fill(0)),
      hourweekLocal: Array.from({ length: 7 }, () => Array(24).fill(0)),   // the same moments on the viewer's clock, each on its own local hour
      days: new Set(), dayCounts: {}, geo: new Map(), geoKind: new Map(), first: null, last: null,
      stamps: [], forts: new Map(), gyms: new Map(),
      raidTotal: 0, raidRemote: 0, raidMaxKm: 0, raidKmSum: 0, raidWithDist: 0,
      raidArcs: new Map(), raidGymBins: new Map(), remoteRaidsByYear: {},
      geoFirst: new Map(), arcFirst: new Map(),   // first-seen month per spot/arc — feeds the globe timeline
      geoMonths: new Map(), arcMonths: new Map(), // per-spot / per-arc tallies by month — the timeline's "this month only" view
      win: {}, blurredRows: 0,   // each event's precise "1" file: its span, and its instants until the "2" twin has matched them; rows whose blurred positions were kept off the map
      there: {},                 // in-person GO Fests a precise position places you at: { id: { n, days: { UTC day on the festival's own dates: n } } } — never a coordinate
    },
    trail: [], trailCount: 0, trailStride: 1,
    bag: null,
    friends: { rows: [], monthly: {}, sources: {}, initiated: {}, games: {}, unfriendedMonthly: {}, unfriended: 0 },
    // slots: invites per quarter hour of the epoch, placed on your local weekday at
    // render (see slotKey and inviteTiming). Never the other trainer — see parseInvites.
    invites: { sent: 0, accepted: 0, declined: 0, failed: 0, monthly: {}, slots: {} },
    party: { received: 0, sent: 0, monthly: {}, slots: {} },
    spend: {
      coinsBought: 0, coinsSpent: 0, purchases: 0, spendEvents: 0, items: {}, cur: {}, vendor: {},
      boughtMonthly: {}, spentMonthly: {}, freeBundles: 0, paidBundles: 0, granted: 0, grantedItems: {},
    },
    fitness: { daily: {} },
    photos: { monthly: {}, days: {}, total: 0, first: null, last: null },
    support: { tickets: 0, messages: 0, topics: {}, first: null, last: null },
    sessions: {
      monthly: {}, devices: {}, cities: {}, countries: {}, places: {}, total: 0,
      apps: {}, oses: {},      // sessions per app / OS version — public release numbers
      eraMonths: {},           // "YYYY-MM" → { device: sessions } — see deviceEras
      deviceKind: {},          // device → { platform, kind }, from the files' enumerations only
    },
    // times: every install either file names, keyed by its instant (ms) → the
    // device it was made on — see installHistory
    installs: { count: 0, first: null, last: null, devices: {}, times: {} },
    referrals: null,         // { total, friends } — how many, never who
    liveEvents: [],
    wayfarer: null,
    campfire: null,          // counts and months only — see parseCampfire
  };
}
let STATE = freshState();
let RAW = [];               // one entry per copy of a file: [{ name, key, path, group, text, file, entry, oversize, … }] — see putCopy
let DROP_N = 0;             // numbers each ingest(), so files dropped together can be told from files dropped apart
const FILE_PATH = new WeakMap();   // File → its path inside a dropped folder (a drag and drop leaves webkitRelativePath empty)
const pathOf = (f) => ((f && FILE_PATH.get(f)) || (f && f.webkitRelativePath) || "").replace(/^\/+/, "");
const EMPTY_FILE = /^\s*No data found\.?\s*$/i;
/* Bumped whenever the user wipes their data (Clear / Start over / demo reload).
 * build() awaits file reads and library loads, so a Clear part-way through must
 * be able to abandon the in-flight build — otherwise it finishes and re-renders
 * the dashboard the user just told us to erase. */
let DATA_GEN = 0;
let CHARTS = [];
let MAP = null;
let GLOBE = null;
let GLOBE_CLEANUP = [];     // window listeners / observers tied to the current globe
let BUILDING = false;
let BUILD_AGAIN = false;    // files arrived while a build ran: build once more when it ends

/* Heavy vendor libraries load on demand, not at page open — the upload UI
 * must be interactive the moment the page paints, and most visits never need
 * the 1.9MB globe bundle at all.
 *
 * Each one carries a subresource-integrity hash from this one map. sw.js
 * serves /vendor/ cache-first and Netlify marks it immutable for a year, so a
 * copy that went bad in either cache would otherwise keep running; with the
 * hash on the tag the browser refuses any bytes but these. Same-origin, so no
 * crossorigin attribute is needed. `node tools/sri.mjs --write` rebuilds the
 * map from the vendor paths ensureScript/ensureCSS are called with, and
 * tools/test-parsers.mjs fails when a value drifts from its file. */
const VENDOR_SRI = {
  "vendor/chart-4.5.1.umd.min.js": "sha384-jb8JQMbMoBUzgWatfe6COACi2ljcDdZQ2OxczGA3bGNeWe+6DChMTBJemed7ZnvJ",
  "vendor/globe.gl-2.46.2.min.js": "sha384-1uolMBZ25k3zJcNwCLEv49+L+m2dZudqAzsoSAJfQTzDCSBxJzrMuZ2dkp/5JKiT",
  "vendor/leaflet.css": "sha384-sHL9NAb7lN7rfvG5lfHpm643Xkcjzp4jFvuavGOndn6pjVqS6ny56CAt3nsEVT4H",
  "vendor/leaflet.js": "sha384-cxOPjt7s7Iz04uaHJceBmS+qpjv2JkIHNVcuOrM+YHwZOmJGBXI00mdUXEq65HTH",
  "vendor/leaflet-heat.js": "sha384-mFKkGiGvT5vo1fEyGCD3hshDdKmW3wzXW/x+fWriYJArD0R3gawT6lMvLboM22c0",
};
const _libLoads = {};
function ensureScript(src) {
  if (_libLoads[src]) return _libLoads[src];
  const tag = (url) => new Promise((res, rej) => {
    const s = document.createElement("script");
    if (VENDOR_SRI[src]) s.integrity = VENDOR_SRI[src];
    s.src = url;
    s.onload = res;
    s.onerror = () => rej(new Error("failed to load " + src));
    document.head.appendChild(s);
  });
  return (_libLoads[src] = loadVendor(src, tag).catch((err) => { delete _libLoads[src]; throw err; }));
}
function ensureCSS(href) {
  if (_libLoads[href]) return _libLoads[href];
  const tag = (url) => new Promise((res, rej) => {
    const l = document.createElement("link");
    if (VENDOR_SRI[href]) l.integrity = VENDOR_SRI[href];
    l.rel = "stylesheet"; l.href = url;
    l.onload = res;
    l.onerror = () => rej(new Error("failed to load " + href));
    document.head.appendChild(l);
  });
  // an unstyled map still works, so a stylesheet that won't load never fails a build
  return (_libLoads[href] = loadVendor(href, tag).catch(() => { delete _libLoads[href]; }));
}
/* sw.js answers /vendor/ from its cache without looking at the network again,
 * so a cached copy that fails its integrity check would be handed straight
 * back every time. A failed load therefore drops that copy and goes once more,
 * at a fresh address. The same address won't do: the renderer's memory cache
 * keeps the bytes it just refused, and under the year-long immutable headers
 * stored beside them it reuses them for that URL — on "Try again", even after
 * a reload — without asking the service worker. The query string only changes
 * that key; sw.js matches /vendor/ with ignoreSearch and Netlify ignores it, so
 * it is the same pinned file checked against the same hash. A plain network
 * failure leaves nothing cached, and costs one more failed request. */
function loadVendor(path, tag) {
  return tag(path).catch(() => dropCachedVendor(path).then(() => tag(`${path}?retry=${Date.now()}`)));
}
function dropCachedVendor(src) {
  if (!VENDOR_SRI[src] || !window.caches) return Promise.resolve();
  return caches.keys()
    .then((keys) => Promise.all(keys.map((k) => caches.open(k).then((c) => c.delete(src, { ignoreSearch: true })))))
    .catch(() => {});
}

/* ───────────────────────────── ingest ───────────────────────────── */
const $ = (id) => document.getElementById(id);

function showError(msg, trustedHTML) {
  const el = $("upload-error");
  if (!el) { console.warn(msg); return; }
  el.style.display = "block";
  el.innerHTML = `<b>Heads up:</b> ${trustedHTML ? msg : esc(msg)}`;
  /* On a phone this banner renders roughly 325px BELOW the fold, so the most
   * common first-run failure — dropping the ZIP unopened — looked like the page
   * simply ignoring you. Bring it into view and let assistive tech announce it.
   * role=alert lives on the element (see metrics.html) so it is announced on
   * every message, not just the first. While a password panel is up, though,
   * the panel is what the reader needs: it goes to the top of the view instead,
   * with this note below it, rather than being scrolled away mid-password. */
  const panel = PENDING_ZIP && $("zip-unlock");
  (panel || el).scrollIntoView({ behavior: scrollBehavior(), block: panel ? "start" : "center" });
}
function clearError() { const el = $("upload-error"); if (el) el.style.display = "none"; }

/* ── ZIP support ──
 * The download support sends is a password-protected ZIP, and inside it sits a
 * second archive, Player_Journey.zip — the activity logs behind the biggest
 * chapters. Unzipping it by hand was the step the guide never quite got people
 * through. On a Mac, a double-click in Finder asks for the password and opens
 * it; only the command-line `unzip` and `ditto` refuse it (they skip the AES
 * entries). Windows' own extractor is untested here, so the advice names
 * 7-Zip there. Both archives open here regardless, on phones too.
 * A small central-directory reader walks the entries; the browser's native
 * DecompressionStream inflates them; the password lock (WinZip AES) is checked
 * and undone with WebCrypto plus the few dozen lines of AES below. No library,
 * nothing fetched, nothing leaves the tab.
 *
 * Measured on two real downloads: 21 and 22 entries, every data file AES-256
 * in the AE-2 flavour over deflate (one carries a single unencrypted entry
 * beside them), no ZIP64; Player_Journey.zip inside is 21 plain deflate
 * entries. Unzipped, one whole export comes to about 40 MB. */
const ZIP_OK = typeof DecompressionStream === "function";
/* PBKDF2 and HMAC come from WebCrypto, which only exists in a secure context
 * (https, or localhost while developing). A page opened some other way keeps
 * the "unzip it with a tool first" explainer. */
const ZIP_AES_OK = ZIP_OK && typeof crypto === "object" && !!crypto && !!crypto.subtle;
const ZIP_TOOLS = "a double-click on a Mac or 7-Zip on Windows";

/* An archive is a list of claims about sizes and offsets, and a hostile one
 * lies: a 66 KB file whose entries all pointed at one deflate stream expanded
 * to a gigabyte here in about a second. Nothing is inflated past these. The
 * real export has 22 entries and about 40 MB unzipped, so they leave room for
 * a far heavier player. A mutable object only so the tests can shrink it. */
const ZIP_LIMITS = {
  entries: 200,                    // listed by one archive — a journey archive inside it included; the export lists 22, its journey archive 21
  file: 80 * 1024 * 1024,          // the same ceiling ingest() puts on a loose file
  total: 256 * 1024 * 1024,        // inflated from one archive — a journey archive inside it included
};
class ZipError extends Error {
  // kind: "limit" | "password" | "damaged" | "unsupported"
  constructor(message, kind) { super(message); this.kind = kind; }
}
/* What one dropped archive may still do: bytes to inflate and entries to list.
 * Every archive opened from inside it draws on the same allowance. With a fresh
 * 200 entries for each archive, one plain ZIP of 200 ZIPs of 200 files each put
 * 40,000 rows in the list. */
const zipBudget = () => ({ left: ZIP_LIMITS.total, entries: ZIP_LIMITS.entries });
const zipMB = (n) => Math.round(n / 1024 / 1024);

async function unzipFile(file, budget) {
  const buf = new Uint8Array(await file.arrayBuffer());
  const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  // The end-of-central-directory record sits in the last 64 KB + 22 bytes.
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error("not a zip");
  const count = dv.getUint16(eocd + 10, true);
  budget = budget || zipBudget();
  if (count > budget.entries) {
    // An archive from inside another is refused as part of that one's allowance,
    // and marked so ingest() can name all such refusals in a single note.
    const inside = budget.entries < ZIP_LIMITS.entries;
    throw Object.assign(new ZipError(inside
      ? `with the archive it came in, it lists more than the ${ZIP_LIMITS.entries} entries this page will open from one archive`
      : `it lists ${count.toLocaleString()} entries, more than the ${ZIP_LIMITS.entries} this page will open`, "limit"), { crowded: inside });
  }
  budget.entries -= count;
  let off = dv.getUint32(eocd + 16, true);
  const dec = new TextDecoder();
  const entries = [], offsets = new Set();
  for (let k = 0; k < count && off + 46 <= buf.length; k++) {
    if (dv.getUint32(off, true) !== 0x02014b50) break;
    const flags = dv.getUint16(off + 8, true), method = dv.getUint16(off + 10, true);
    const crc = dv.getUint32(off + 16, true);
    const csize = dv.getUint32(off + 20, true), usize = dv.getUint32(off + 24, true);
    const nLen = dv.getUint16(off + 28, true), xLen = dv.getUint16(off + 30, true), cLen = dv.getUint16(off + 32, true);
    const lho = dv.getUint32(off + 42, true);
    if (csize === 0xffffffff || usize === 0xffffffff || lho === 0xffffffff) throw new Error("zip64 archives are not supported");
    // Two entries reading one set of bytes is how a small archive fakes a huge one.
    if (offsets.has(lho)) throw new ZipError("two of its entries point at the same data", "limit");
    offsets.add(lho);
    // WinZip AES stores method 99 in the header and the real method, key size
    // and flavour in extra field 0x9901: version (1 = AE-1, 2 = AE-2), "AE",
    // strength (1/2/3 = AES-128/192/256), then the actual compression method.
    let aes = null;
    for (let x = off + 46 + nLen, xEnd = Math.min(x + xLen, buf.length); x + 4 <= xEnd; ) {
      const id = dv.getUint16(x, true), sz = dv.getUint16(x + 2, true);
      if (id === 0x9901 && sz >= 7 && x + 11 <= xEnd)
        aes = { version: dv.getUint16(x + 4, true), strength: buf[x + 8], method: dv.getUint16(x + 9, true) };
      x += 4 + sz;
    }
    entries.push({ name: dec.decode(buf.subarray(off + 46, off + 46 + nLen)), method, crc, csize, usize, lho,
      encrypted: !!(flags & 1), aes: method === 99 ? aes : null });
    off += 46 + nLen + xLen + cLen;
  }
  // Each entry's bytes must lie inside the file and apart from every other's.
  let end = 0;
  for (const e of entries.slice().sort((a, b) => a.lho - b.lho)) {
    if (e.lho < end) throw new ZipError("its entries overlap one another", "limit");
    if (e.lho + 30 > buf.length || dv.getUint32(e.lho, true) !== 0x04034b50) throw new Error("bad local header for " + e.name);
    e.start = e.lho + 30 + dv.getUint16(e.lho + 26, true) + dv.getUint16(e.lho + 28, true);
    end = e.start + e.csize;
    if (end > buf.length) throw new ZipError("it's cut short — part of it is missing", "damaged");
  }
  return { entries, buf, dv, budget };
}

/* null, "aes" (openable here once the password is typed), or "unsupported" —
 * ZipCrypto, the older scheme, or anything else this reader can't undo. */
function zipLock(z) {
  const locked = z.entries.filter((e) => e.encrypted);
  if (!locked.length) return null;
  return locked.every((e) => e.aes && (e.aes.version === 1 || e.aes.version === 2) && e.aes.strength >= 1 && e.aes.strength <= 3)
    ? "aes" : "unsupported";
}

async function zipEntryFile(z, e, password) {
  const name = e.name.split("/").pop();
  if (e.usize > ZIP_LIMITS.file) throw new ZipError(`${name} says it unzips to ${zipMB(e.usize)} MB, over the ${zipMB(ZIP_LIMITS.file)} MB limit`, "limit");
  let data = z.buf.subarray(e.start, e.start + e.csize), method = e.method, crc = null;
  if (e.encrypted) {
    if (!e.aes) throw new ZipError(`${name} uses ZipCrypto`, "unsupported");
    data = await zipAesDecrypt(data, e.aes, password);
    method = e.aes.method;
    // AE-1 keeps the CRC as a second check; AE-2 zeroes it and leans on the HMAC.
    if (e.aes.version === 1) crc = e.crc;
  }
  if (method !== 0 && method !== 8) throw new Error("unsupported compression method " + method + " in " + e.name);
  return new File([await zipInflate(data, method, e.usize, z.budget, crc, name)], name);
}

/* Inflate one entry, counting every byte as it streams out. An entry may not
 * produce more than its header declared (that is the lie a bomb tells), and
 * the whole archive may not produce more than its budget; either one cancels
 * the stream on the spot rather than after a gigabyte has landed. */
async function zipInflate(data, method, declared, budget, crc, name) {
  let n = 0, c = ~0;
  const take = (chunk) => {
    n += chunk.length;
    if (n > declared) throw new ZipError(`${name} unzips to more than its header says`, "limit");
    if ((budget.left -= chunk.length) < 0)
      throw new ZipError(`it unzips to more than the ${zipMB(ZIP_LIMITS.total)} MB this page will open from one archive`, "limit");
    if (crc !== null) c = crc32Update(c, chunk);
  };
  const parts = [];
  if (method === 0) { take(data); parts.push(data); }
  else {
    const reader = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        take(value);
        parts.push(value);
      }
    } catch (err) { reader.cancel().catch(() => {}); throw err; }
  }
  if (crc !== null && (~c >>> 0) !== crc) throw new ZipError(`${name} failed its checksum`, "damaged");
  return new Blob(parts);
}

let CRC_TABLE = null;
function crc32Update(c, bytes) {
  if (!CRC_TABLE) {
    CRC_TABLE = new Int32Array(256);
    for (let n = 0; n < 256; n++) { let k = n; for (let j = 0; j < 8; j++) k = k & 1 ? 0xedb88320 ^ (k >>> 1) : k >>> 1; CRC_TABLE[n] = k; }
  }
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 255] ^ (c >>> 8);
  return c;
}

/* WinZip AES (the "AE-x" spec). The stored bytes are salt (8/12/16 bytes for
 * AES-128/192/256), a 2-byte password verifier, the ciphertext, and a 10-byte
 * authentication code. PBKDF2-HMAC-SHA1 over the password and salt, 1,000
 * rounds, gives the AES key, the HMAC key and the verifier, in that order.
 * Order matters here: the verifier answers "right password?" without touching
 * the data, the HMAC proves the ciphertext is intact, and only then is it
 * decrypted. The password itself goes no further than this function. */
async function zipAesKeys(data, aes, password) {
  const keyLen = 8 * (aes.strength + 1), saltLen = keyLen / 2;
  if (data.length < saltLen + 12) throw new ZipError("an entry is too short to be real", "damaged");
  const pw = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]);
  const bits = new Uint8Array(await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-1", salt: data.slice(0, saltLen), iterations: 1000 }, pw, (2 * keyLen + 2) * 8));
  const ok = bits[2 * keyLen] === data[saltLen] && bits[2 * keyLen + 1] === data[saltLen + 1];
  return { ok, keyLen, saltLen, bits };
}
async function zipAesDecrypt(data, aes, password) {
  const { ok, keyLen, saltLen, bits } = await zipAesKeys(data, aes, password);
  if (!ok) throw new ZipError("wrong password", "password");
  const body = data.slice(saltLen + 2, data.length - 10), mac = data.subarray(data.length - 10);
  const hk = await crypto.subtle.importKey("raw", bits.slice(keyLen, 2 * keyLen), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const sig = new Uint8Array(await crypto.subtle.sign("HMAC", hk, body));
  for (let i = 0; i < 10; i++) if (sig[i] !== mac[i]) throw new ZipError("its contents don't match their authentication code", "damaged");
  await aesCtrWinZip(bits.subarray(0, keyLen), body);
  bits.fill(0);
  return body;
}

/* AES, encryption direction only — counter mode never needs the inverse.
 * WebCrypto has AES-CTR, but it counts big-endian in the block's last bytes;
 * WinZip's counter is a little-endian integer in the FIRST eight, starting at
 * 1, so the keystream has to be made here. Standard T-table AES (FIPS-197),
 * tables built once from the field arithmetic rather than pasted in. */
let AES_T = null;
function aesTables() {
  if (AES_T) return AES_T;
  const S = new Uint8Array(256), T0 = new Uint32Array(256), T1 = new Uint32Array(256), T2 = new Uint32Array(256), T3 = new Uint32Array(256);
  const exp = new Uint8Array(256), log = new Uint8Array(256);
  const xt = (x) => ((x << 1) ^ (x & 0x80 ? 0x11b : 0)) & 255;
  for (let i = 0, x = 1; i < 255; i++) { exp[i] = x; log[x] = i; x ^= xt(x); }   // powers of the generator 3
  const rot = (x, k) => ((x << k) | (x >>> (8 - k))) & 255;
  for (let i = 0; i < 256; i++) {
    const inv = i ? exp[(255 - log[i]) % 255] : 0;
    const s = inv ^ rot(inv, 1) ^ rot(inv, 2) ^ rot(inv, 3) ^ rot(inv, 4) ^ 0x63;
    S[i] = s;
    const t = ((xt(s) << 24) | (s << 16) | (s << 8) | (xt(s) ^ s)) >>> 0;   // MixColumns weights 2,1,1,3
    T0[i] = t; T1[i] = (t >>> 8) | (t << 24); T2[i] = (t >>> 16) | (t << 16); T3[i] = (t >>> 24) | (t << 8);
  }
  return (AES_T = { S, T0, T1, T2, T3 });
}
function aesExpandKey(key) {
  const { S } = aesTables();
  const nk = key.length / 4, W = new Uint32Array(4 * (nk + 7));
  for (let i = 0; i < nk; i++) W[i] = (key[4 * i] << 24) | (key[4 * i + 1] << 16) | (key[4 * i + 2] << 8) | key[4 * i + 3];
  const sub = (t) => (S[t >>> 24] << 24) | (S[(t >>> 16) & 255] << 16) | (S[(t >>> 8) & 255] << 8) | S[t & 255];
  for (let i = nk, rcon = 1; i < W.length; i++) {
    let t = W[i - 1];
    if (i % nk === 0) { t = sub((t << 8) | (t >>> 24)) ^ (rcon << 24); rcon = ((rcon << 1) ^ (rcon & 0x80 ? 0x11b : 0)) & 255; }
    else if (nk > 6 && i % nk === 4) t = sub(t);
    W[i] = W[i - nk] ^ t;
  }
  return W;
}
/* XOR the WinZip keystream into `data` in place (encrypting and decrypting are
 * the same operation). Yields every megabyte so a big entry can't freeze the page. */
async function aesCtrWinZip(key, data) {
  const { S, T0, T1, T2, T3 } = aesTables();
  const W = aesExpandKey(key), R = W.length / 4 - 1;
  const bswap = (x) => ((x & 255) << 24) | ((x & 0xff00) << 8) | ((x >>> 8) & 0xff00) | (x >>> 24);
  for (let pos = 0, ctr = 1; pos < data.length; ctr++, pos += 16) {
    let s0 = bswap(ctr >>> 0) ^ W[0], s1 = bswap((ctr / 4294967296) >>> 0) ^ W[1], s2 = W[2], s3 = W[3];
    for (let r = 1, k = 4; r < R; r++, k += 4) {
      const t0 = T0[s0 >>> 24] ^ T1[(s1 >>> 16) & 255] ^ T2[(s2 >>> 8) & 255] ^ T3[s3 & 255] ^ W[k];
      const t1 = T0[s1 >>> 24] ^ T1[(s2 >>> 16) & 255] ^ T2[(s3 >>> 8) & 255] ^ T3[s0 & 255] ^ W[k + 1];
      const t2 = T0[s2 >>> 24] ^ T1[(s3 >>> 16) & 255] ^ T2[(s0 >>> 8) & 255] ^ T3[s1 & 255] ^ W[k + 2];
      const t3 = T0[s3 >>> 24] ^ T1[(s0 >>> 16) & 255] ^ T2[(s1 >>> 8) & 255] ^ T3[s2 & 255] ^ W[k + 3];
      s0 = t0; s1 = t1; s2 = t2; s3 = t3;
    }
    const k = 4 * R;
    const o = [
      ((S[s0 >>> 24] << 24) | (S[(s1 >>> 16) & 255] << 16) | (S[(s2 >>> 8) & 255] << 8) | S[s3 & 255]) ^ W[k],
      ((S[s1 >>> 24] << 24) | (S[(s2 >>> 16) & 255] << 16) | (S[(s3 >>> 8) & 255] << 8) | S[s0 & 255]) ^ W[k + 1],
      ((S[s2 >>> 24] << 24) | (S[(s3 >>> 16) & 255] << 16) | (S[(s0 >>> 8) & 255] << 8) | S[s1 & 255]) ^ W[k + 2],
      ((S[s3 >>> 24] << 24) | (S[(s0 >>> 16) & 255] << 16) | (S[(s1 >>> 8) & 255] << 8) | S[s2 & 255]) ^ W[k + 3],
    ];
    for (let j = 0, n = Math.min(16, data.length - pos); j < n; j++) data[pos + j] ^= o[j >> 2] >>> (24 - 8 * (j & 3));
    if ((ctr & 0xffff) === 0) await nextTick();
  }
}

/* Files an operating system writes into a folder by itself: the Finder's
 * .DS_Store, its AppleDouble "._" twins (on a non-Mac disk, or under __MACOSX/
 * in a ZIP the Finder made), .localized and a folder's Icon file, and Windows'
 * Thumbs.db and desktop.ini. Nobody put them in an export and nobody sees them
 * in the folder, so a drop passes over them without a word. They get no row in
 * the list and no "isn't a format this site reads" alert, which a plain Mac
 * export folder used to get on every drop. */
const OS_CLUTTER = /^(?:\.DS_Store|\._.*|\.localized|Icon\r|Thumbs\.db|ehthumbs\.db|desktop\.ini)$/i;
const isOsClutter = (name) => OS_CLUTTER.test(String(name).split("/").pop());

/* Pull the readable files out of an opened archive: the data files, plus —
 * unless this archive is itself nested — any ZIP inside it, to be opened ONE
 * level down and no further. An entry that declares more than the per-file
 * ceiling is never inflated; a data file becomes a stand-in the file list
 * reports as too large, the same as an oversized loose file. A ZIP inside a
 * nested archive stays shut and is named in `deeper`, so the page can say why. */
async function zipExtract(z, { nested = false, password = "", progress = null, stale = null } = {}) {
  const leaf = z.entries.filter((e) => !e.name.endsWith("/") && !/(?:^|\/)__MACOSX\//.test(e.name) && !isOsClutter(e.name));
  const want = leaf.filter((e) => /\.(tsv|csv|txt|json)$/i.test(e.name) || (!nested && /\.zip$/i.test(e.name)));
  const deeper = nested ? leaf.filter((e) => /\.zip$/i.test(e.name)).map((e) => e.name.split("/").pop()) : [];
  const files = [], tooBig = [];
  for (let i = 0; i < want.length; i++) {
    const e = want[i], name = e.name.split("/").pop();
    if (progress) progress(i + 1, want.length);
    if (e.usize > ZIP_LIMITS.file) {
      if (/\.zip$/i.test(name)) tooBig.push(name);
      else files.push({ name, size: e.usize, standIn: true });
      continue;
    }
    files.push(await zipEntryFile(z, e, password));
    if (stale && stale()) return null;
  }
  return { files, tooBig, deeper };
}
const zipTooBigNote = (inner, outer) =>
  `<b>${esc(inner)}</b> inside <b>${esc(base(outer))}</b> is over ${zipMB(ZIP_LIMITS.file)} MB, so it wasn't opened.`;
const zipDeeperNote = (inner, outer) => {
  const one = inner.length === 1;
  const names = inner.slice(0, 3).map((n) => `<b>${esc(n)}</b>`).join(", ") + (inner.length > 3 ? ` and ${inner.length - 3} more` : "");
  return `${names} inside <b>${esc(base(outer))}</b> ${one ? "wasn't" : "weren't"} opened — this page only opens one level down. Unzip ${one ? "it" : "them"} with ${ZIP_TOOLS}, then add the files inside.`;
};
/* The archives inside another that its shared entry allowance left shut, named
 * in one note rather than one note each. */
const zipCrowdNote = (inner, outer) => {
  const one = inner.length === 1;
  const names = inner.slice(0, 3).map((n) => `<b>${esc(n)}</b>`).join(", ") + (inner.length > 3 ? ` and ${inner.length - 3} more` : "");
  return `${names}${outer ? ` inside <b>${esc(base(outer))}</b>` : ""} ${one ? "wasn't" : "weren't"} opened — with the archive around ${one ? "it" : "them"}, that's more than the ${ZIP_LIMITS.entries} entries this page will open from one archive. Unzip ${one ? "it" : "them"} with ${ZIP_TOOLS}, then add the files inside.`;
};
/* The typed password, or — when that fails and trimming changes it — the
 * trimmed one: pasting from an email can bring a trailing space along.
 * A verifier is only two bytes, so about one wrong password in 65,536 gets
 * past any one entry's. Every locked entry has its own salt and verifier, so a
 * password is taken only once it passes all of them; then a wrong one almost
 * never reaches the HMAC, which is left to catch real damage. */
async function zipFindPassword(z, typed) {
  const locked = z.entries.filter((x) => x.encrypted && x.aes);
  for (const pw of typed.trim() && typed.trim() !== typed ? [typed, typed.trim()] : [typed]) {
    let ok = true;
    for (const e of locked) {
      const k = await zipAesKeys(z.buf.subarray(e.start, e.start + e.csize), e.aes, pw);
      k.bits.fill(0);
      if (!(ok = k.ok)) break;
    }
    if (ok) return pw;
  }
  throw new ZipError("wrong password", "password");
}
/* What the panel says when an unlock fails. A "damaged" verdict can't vouch
 * for the password: an archive with one locked entry has a single 2-byte
 * check, so a wrong password can (rarely) get as far as the HMAC. The copy
 * names both causes and puts the cheaper fix first. */
function zipUnlockMessage(err) {
  const kind = err && err.kind;
  return kind === "password" ? "That password didn't work. Check the message from support and try again — pasting it in is the surest way."
    : kind === "damaged" ? "This file looks damaged, or the password isn't quite right: its contents don't match their checksum. Check the password and try again. If it still won't open, download the file again from the link in the message and drop the new copy here."
    : kind === "limit" ? `This ZIP wasn't opened: ${err.message}.`
    : kind === "unsupported" ? `Part of this ZIP uses encryption this page can't open — unzip it with ${ZIP_TOOLS}.`
    : `Something went wrong opening this ZIP. Try again, or unzip it with ${ZIP_TOOLS}.`;
}

/* ── the password prompt ──
 * A locked download doesn't stop the drop: ingest() hands it here, the rest of
 * the drop carries on, and this panel under the dropzone asks for the password.
 * No <form>, on purpose — a form that failed to wire up could submit the
 * password into a URL. The password lives in the field and in unlockZip() for
 * as long as the unlock takes; the panel, field and all, is emptied the moment
 * it succeeds, and nothing writes it anywhere.
 * While the panel is up, the auto-build a drop would start waits (buildHeld):
 * build() moves focus to the report and scrolls to it, which took the field
 * away from someone mid-password. It runs once the panel is done with — after
 * the unlock, or on "Not now". */
let PENDING_ZIP = null;   // { file, z, busy, buildHeld, group, path } — a password-protected ZIP waiting on its password
function showUnlock(file, z, from = {}) {
  const el = $("zip-unlock");
  if (!el) return false;
  const I = (n) => (window.ICON ? window.ICON(n) : "");
  // a build held for an earlier panel stays held when a new locked ZIP replaces it;
  // group and path are where the download sat, for the files that come out of it
  PENDING_ZIP = { file, z, busy: false, buildHeld: !!(PENDING_ZIP && PENDING_ZIP.buildHeld), group: from.group, path: from.path };
  el.innerHTML = `<div class="zu-head">
      <span class="zu-ic" aria-hidden="true">${I("lock")}</span>
      <div>
        <h3 id="zu-title">This ZIP is password-protected</h3>
        <p><b>${esc(base(file.name))}</b> can be opened right here. Type the password from the message that came with your download link.</p>
      </div>
    </div>
    <div class="zu-field">
      <label for="zu-pass">Password</label>
      <div class="zu-row">
        <input id="zu-pass" type="password" autocomplete="off" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go" aria-describedby="zu-status zu-promise">
        <button class="btn btn-ghost zu-show" type="button" aria-pressed="false" aria-controls="zu-pass">Show</button>
        <button class="btn btn-primary" id="zu-go" type="button">Open my ZIP</button>
      </div>
    </div>
    <p class="zu-status" id="zu-status" role="status" aria-live="polite"></p>
    <p class="zu-promise" id="zu-promise">${I("lock")}<span>The password never leaves this device and isn't stored — it's used once, in this tab, to open the file.</span></p>
    <button class="linkish zu-cancel" type="button">Not now</button>`;
  el.hidden = false;
  const input = el.querySelector("#zu-pass");
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); unlockZip(); } });
  el.querySelector("#zu-go").addEventListener("click", unlockZip);
  el.querySelector(".zu-show").addEventListener("click", (e) => {
    const show = input.type === "password";
    input.type = show ? "text" : "password";
    e.currentTarget.setAttribute("aria-pressed", String(show));
    e.currentTarget.textContent = show ? "Hide" : "Show";
  });
  el.querySelector(".zu-cancel").addEventListener("click", cancelUnlock);
  el.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
  try { input.focus({ preventScroll: true }); } catch (e) {}
  announce("This ZIP is password-protected. Type its password to open it.");
  return true;
}
function hideUnlock() {
  PENDING_ZIP = null;
  const el = $("zip-unlock");
  if (el) { el.hidden = true; el.innerHTML = ""; }
}
async function unlockZip() {
  const P = PENDING_ZIP, el = $("zip-unlock");
  if (!P || !el || P.busy) return;
  const input = el.querySelector("#zu-pass"), go = el.querySelector("#zu-go"), status = el.querySelector("#zu-status");
  const say = (msg, bad) => { status.textContent = msg; status.classList.toggle("bad", !!bad); };
  if (!input.value) { say("Type the password first — it's in the message with your download link.", true); input.focus(); return; }
  // A Clear, a Start over or a fresh locked drop mid-unlock abandons this one.
  const gen = DATA_GEN, stale = () => gen !== DATA_GEN || PENDING_ZIP !== P;
  P.busy = true; go.disabled = true; input.readOnly = true; el.setAttribute("aria-busy", "true");
  say("Checking the password…");
  let got = null;
  try {
    // A retry gets the full byte allowance back. The entries this download
    // listed stay counted; nothing inside it has been opened yet.
    P.z.budget.left = ZIP_LIMITS.total;
    const password = await zipFindPassword(P.z, input.value);
    if (stale()) return;
    got = await zipExtract(P.z, { password, stale, progress: (i, n) => say(`Password accepted — opening file ${i} of ${n}…`) });
  } catch (err) {
    if (stale()) return;
    console.warn("Could not unlock the ZIP:", err && err.kind, err && err.message);
    say(zipUnlockMessage(err), true);
  } finally {
    if (PENDING_ZIP === P && !got) {
      P.busy = false; go.disabled = false; input.readOnly = false; el.removeAttribute("aria-busy");
      try { input.focus({ preventScroll: true }); input.select(); } catch (e) {}
    }
  }
  if (!got || stale()) return;
  const name = base(P.file.name), budget = P.z.budget;
  hideUnlock();   // the field, and the password in it, go with the panel
  const hash = await contentHash(P.z.buf);   // the download's own bytes, to tell it from another picked at the same place
  if (gen !== DATA_GEN) return;
  await ingest(got.files, { nested: true, budget, group: P.group, path: P.path || name,
    container: { name, n: got.files.length, unlocked: true, path: P.path || name, size: P.file.size, group: P.group, inside: false, hash },
    notes: got.tooBig.map((n) => zipTooBigNote(n, name)) });
  // ingest() starts its own build when there's something to build; when nothing
  // inside was readable it returns early, and a build this panel held still runs
  if (P.buildHeld && !AUTO_BUILD_T && gen === DATA_GEN) build();
}
/* "Not now": close the panel, and build what the drop brought if it was waiting on it. */
function cancelUnlock() {
  const held = PENDING_ZIP && PENDING_ZIP.buildHeld;
  hideUnlock();
  if (held) { build(); return; }
  // the focused field went with the panel: hand focus to the file picker, not the page
  const to = [$("browse-btn"), $("us-add")].find((b) => b && b.getClientRects().length);
  if (to) try { to.focus({ preventScroll: true }); } catch (e) {}
}

async function collectFiles(items) {
  /* recurse DataTransferItem entries so dropping a folder works */
  const out = [];
  const walk = (entry) =>
    new Promise((res) => {
      if (!entry) return res();
      if (entry.isFile) entry.file((f) => { FILE_PATH.set(f, entry.fullPath || ""); out.push(f); res(); }, () => res());
      else if (entry.isDirectory) {
        const reader = entry.createReader();
        const readBatch = () =>
          reader.readEntries(async (ents) => {
            if (!ents.length) return res();
            await Promise.all(ents.map(walk));
            readBatch();
          }, () => res());
        readBatch();
      } else res();
    });
  const entries = [];
  for (const it of items) {
    const e = it.webkitGetAsEntry && it.webkitGetAsEntry();
    if (e) entries.push(e);
    else if (it.getAsFile) { const f = it.getAsFile(); if (f) out.push(f); }
  }
  await Promise.all(entries.map(walk));
  return out;
}

/* opts — set only by unlockZip(), which calls back in with a download's files:
 *   nested    those files came out of an archive, so a ZIP among them is
 *             opened one level down and never asks for a password
 *   budget    the unlocked archive's byte allowance, shared with that level
 *   container { name, n: files inside, unlocked: true, path, size, group } —
 *             the download's own row in the list
 *   group     the export those files belong to: the download's
 *   path      where the download sat, so each file inside has a path too
 *   notes     explanations already written for entries left unopened */
async function ingest(files, opts = {}) {
  clearError();
  /* Reading files is a long await chain — one disk round-trip per file, and a
   * full export is 41 of them. build() has always been able to abandon a stale
   * run; ingest() could not, so hitting Clear part-way through a folder pick
   * silently refilled RAW after the wipe. For a tool whose promise is "close
   * the tab and it's gone", a Clear that half-undoes itself is the wrong kind
   * of surprise. */
  const gen = DATA_GEN;
  const stale = () => gen !== DATA_GEN;
  const dropped = [...files].filter((f) => f && f.name && !isOsClutter(f.name));   // see OS_CLUTTER
  /* Open any archive that can be opened here. A plain one (Player_Journey.zip)
   * is inflated on the spot and its files join the drop, along with any plain
   * ZIP inside it — one level down, never deeper. A password-protected one
   * (the download itself) waits in the panel under the dropzone; once its
   * password is typed, unlockZip() calls back in here with its files and
   * opts.nested, so nothing inside it can ask for a password again. Anything
   * that can't be opened is explained, never silently dropped. */
  const all = [];
  const opened = opts.container ? [opts.container] : [];   // { name, n: files inside, unlocked?, path, size, group, inside } per archive opened
  const zipNotes = opts.notes ? opts.notes.slice() : [];    // why an archive wasn't opened (HTML, names escaped)
  let waiting = false;     // the password panel is up
  let cantHere = false;    // a locked ZIP this browser can't open — the iPhone tip applies
  const crowded = new Map();   // outer archive's name → the archives inside it its entry allowance left shut
  /* Which export each file belongs to — its `group` — comes from where it sat:
   * the files of one folder are one export (a Player_Journey folder or ZIP
   * inside it belongs to the folder), a download ZIP is one, and loose files
   * dropped together are one. A group's latest moment is how new each of its
   * copies is, unless a copy carries a later one itself (see rankCopies), and
   * names the exports in the file list. `path` and the copy's SHA-256 (`hash`) tell a
   * second copy from the same file picked again, and `inside` marks what came
   * out of an archive. */
  const drop = ++DROP_N;
  const folderOf = (p) => {
    const parts = p.split("/").filter(Boolean);
    parts.pop();
    // a Player_Journey folder belongs to the export around it, and so does a
    // second unzip of it, which the Mac names "Player_Journey 2"
    if (parts.length && /^player_journey$/i.test(stripCopyMark(parts[parts.length - 1]))) parts.pop();
    return parts.join("/");
  };
  const zipGroup = (q) => (/^player_journey\.zip$/i.test(canonicalName(q.f.name)) ? q.group : q.group + ">" + base(q.f.name));
  const queue = dropped.map((f) => {
    const p = pathOf(f);
    return { f, nested: !!opts.nested, budget: opts.budget, inside: !!opts.nested, outer: opts.container ? opts.container.name : "",
      path: opts.path ? opts.path + "/" + base(f.name) : p || base(f.name),
      group: opts.group || `${drop}:${folderOf(p)}` };
  });
  for (let qi = 0; qi < queue.length; qi++) {
    const q = queue[qi], { f, nested, budget } = q;
    if (!/\.zip$/i.test(f.name)) { all.push(q); continue; }
    const zn = `<b>${esc(base(f.name))}</b>`;
    if (!ZIP_OK) { cantHere = true; zipNotes.push(`This browser can't open ZIP files here — unzip ${zn} with ${ZIP_TOOLS}, then drop the folder here.`); continue; }
    if (f.size > 200 * 1024 * 1024) { zipNotes.push(`${zn} is over 200 MB, too big to open in a browser tab — unzip it with ${ZIP_TOOLS} and add the files inside.`); continue; }
    try {
      const z = await unzipFile(f, budget);
      if (stale()) return;
      const lock = zipLock(z);
      if (lock === "aes" && !nested && !waiting && ZIP_AES_OK && showUnlock(f, z, { group: zipGroup(q), path: q.path })) { waiting = true; continue; }
      if (lock) {
        cantHere = true;
        zipNotes.push(lock === "unsupported"
          ? (z.entries.some((e) => e.encrypted && e.method !== 99)
            ? `${zn} is locked with ZipCrypto, an older kind of ZIP password this page doesn't open — unzip it with ${ZIP_TOOLS}, then drop the folder here.`
            : `${zn} uses a kind of ZIP encryption this page doesn't open — unzip it with ${ZIP_TOOLS}, then drop the folder here.`)
          : nested ? `${zn} is locked inside another archive, and this page only opens one level down — unzip it with ${ZIP_TOOLS}.`
          : waiting ? `${zn} is password-protected too — add it on its own once the first one is open.`
          : `${zn} is password-protected, and this browser can't unlock it here — unzip it with ${ZIP_TOOLS} (the password is in the message support sent), then drop the folder here.`);
        continue;
      }
      const got = await zipExtract(z, { nested, stale });
      if (!got || stale()) return;
      const zg = zipGroup(q);
      for (const g of got.files) {
        const item = { f: g, nested: true, budget: z.budget, inside: true, path: q.path + "/" + g.name, group: zg, outer: base(f.name) };
        if (/\.zip$/i.test(g.name)) queue.push(item); else all.push(item);
      }
      zipNotes.push(...got.tooBig.map((n) => zipTooBigNote(n, f.name)));
      if (got.deeper.length) zipNotes.push(zipDeeperNote(got.deeper, f.name));
      if (got.files.length) opened.push({ name: base(f.name), n: got.files.length, path: q.path, size: f.size, group: zg, inside: q.inside,
        hash: await contentHash(z.buf) });
      else if (!got.tooBig.length && !got.deeper.length) zipNotes.push(`${zn} has no .tsv, .csv, .txt or .json files inside, so there's nothing in it for this site to read.`);
    } catch (err) {
      // left shut by the allowance it shares with its archive: named with the others, in one note
      if (err && err.crowded) { crowded.set(q.outer, [...(crowded.get(q.outer) || []), base(f.name)]); continue; }
      console.warn("Could not open", f.name, err);
      const kind = err && err.kind;
      zipNotes.push(kind === "limit" ? `${zn} wasn't opened: ${esc(err.message)}.`
        : kind === "damaged" ? `${zn} looks damaged (${esc(err.message)}) — try downloading it again.`
        : `${zn} couldn't be opened here — unzip it with ${ZIP_TOOLS} and add the files inside.`);
    }
  }
  for (const [outer, inner] of crowded) zipNotes.push(zipCrowdNote(inner, outer));
  if (stale()) return;
  const list = all.filter((x) => /\.(tsv|csv|txt|json)$/i.test(x.f.name));
  // The iPhone's Files app can't open a password-protected ZIP either, so when
  // this browser can't, the way out is a computer.
  const iosTip = cantHere && (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1))
    ? " On an iPhone or iPad, AirDrop or email it to a computer first — the Files app can't open a password-protected ZIP." : "";
  if (!list.length) {
    // A drop that was only the locked download has its answer already: the panel.
    if (zipNotes.length) showError(zipNotes.join(" ") + iosTip + ' <a href="index.html#request">Full instructions →</a>', true);
    else if (!waiting) showError("No .tsv / .csv / .txt / .json files found in what you dropped.");
    return;
  }
  // The archive itself stays in the list, marked as opened, so the reader can
  // see where twenty-one extra files came from.
  for (const o of opened) {
    const name = canonicalName(o.name);
    putCopy({ name, orig: o.name !== name ? o.name : undefined, key: "zip:" + name.toLowerCase(), path: o.path, size: o.size,
      group: o.group, inside: !!o.inside, text: null, entry: null, container: o.n, unlocked: !!o.unlocked, hash: o.hash || null });
  }
  /* Reading a whole folder is seconds of silent awaits — put the dropzone into
   * a visible reading state so the drop never looks ignored. Restored in the
   * finally, including on a mid-read Clear. */
  const dzEl = $("dropzone");
  const dzHead = dzEl && dzEl.querySelector("h2, h3");
  const dzHead0 = dzHead ? dzHead.textContent : "";
  let added = 0, readN = 0;
  try {
    for (const x of list) {
      const f = x.f, orig = base(f.name), name = canonicalName(orig);
      let entry = window.catalogFor(name)
        // the app's own stats export is not an export file, but it has a chapter
        || (/^pogo-metrics-stats.*\.json$/i.test(name)
          ? { name: "Friend's compare file (from this site)", icon: "🤝", story: true, sensitivity: "low",
              summary: "A compare file made by POGO Metrics — a name, counts and dates. Unlocks the You vs. friend chapter." }
          : null);
      // one entry per copy, saying where it came from — a second copy is kept beside the first, not over it
      const copy = { name, orig: orig !== name ? orig : undefined, path: x.path, size: f.size, group: x.group, inside: x.inside };
      readN++;
      if (dzHead && list.length > 2) dzHead.textContent = `Reading your files… (${readN} of ${list.length})`;
      // Too large to read in a browser tab — keep it visible in the list instead
      // of silently vanishing, so the user knows why that chapter is missing.
      // (A stand-in from zipExtract() is an archive entry that declared itself
      // too big to inflate: it has a name and a size and nothing to read.)
      if (f.standIn || f.size > 80 * 1024 * 1024) {
        putCopy({ ...copy, key: fileKey(name), text: null, entry, oversize: Math.round(f.size / 1024 / 1024) });
        added++;
        continue;
      }
      let text, hash;
      // A file whose read throws must not vanish without a trace — keep it in
      // the list with its own honest status instead. Its bytes are read once:
      // decoded for the parsers exactly as File.text() would, and hashed, so a
      // copy can be told byte for byte from another at the same place.
      try {
        const bytes = await f.arrayBuffer();
        text = new TextDecoder().decode(bytes);
        hash = await contentHash(bytes);
      } catch (e) {
        putCopy({ ...copy, key: fileKey(name), text: null, entry, unreadable: true });
        continue;
      }
      if (stale()) return;   // cleared while this file was being read
      // Keep the File handle alongside the text. build() drops the text once it
      // has parsed it and re-reads from the handle on a rebuild, so a 40 MB
      // export stops costing ~72 MB of retained UTF-16 for the tab's lifetime.
      // Several files (sweepstakes, leaderboards, refunds) arrive containing
      // nothing but "No data found." — that isn't a file we failed to read, it's
      // the export saying there's nothing on record, and the list should say so.
      // A Campfire export is named after the trainer, not the product — when the
      // name gave nothing away, its first line does.
      if (!entry && /^\uFEFF?User'?s Clubs/.test(text.slice(0, 40))) entry = window.catalogFor("campfire.csv");
      const key = fileKey(name, text);
      putCopy({ ...copy, key, text, entry, file: f, empty: EMPTY_FILE.test(text), latest: copyLatest(name, key, text), hash });
      added++;
    }
  } finally {
    if (dzHead) dzHead.textContent = dzHead0;
  }
  if (stale()) return;   // cleared on the last file — leave the wipe alone
  if (!added && !RAW.length) showError("Couldn't read those files. Try choosing them again, or pick the folder.");
  // A mixed drop keeps its valid files — but the ones filtered out by
  // extension used to vanish silently, hiding a mis-drop.
  const skippedExt = all.filter((x) => !/\.(tsv|csv|txt|json)$/i.test(x.f.name)).map((x) => x.f);
  const notes = zipNotes.slice();
  if (skippedExt.length) {
    const names = skippedExt.slice(0, 4).map((f) => esc(f.name)).join(", ");
    notes.unshift(`${skippedExt.length} file${skippedExt.length > 1 ? "s" : ""} in that drop ${skippedExt.length > 1 ? "aren't formats" : "isn't a format"} this site reads (${names}${skippedExt.length > 4 ? ", …" : ""})`
      + " — only .tsv / .csv / .txt / .json carry chapters.");
  }
  if (notes.length) showError(notes.join(" ") + iosTip, true);
  renderDetected();
  const summaryEl = document.querySelector(".det-head h2");
  if (summaryEl) announce(summaryEl.textContent + ".");
  /* The landing page promises "drop the files here, and watch them turn into a
   * story" — and a whole-folder drop IS the "I'm done, show me" gesture. Build
   * after a short debounce (multi-drop sessions coalesce; DATA_GEN guards a
   * mid-wait Clear), keeping the button as a manual Rebuild. When nothing is
   * buildable yet, keep the old scroll-and-focus so the state is visible. */
  const buildable = RAW.some((r) => r.entry && r.entry.story && !r.empty && !r.oversize && !r.unreadable);
  if (buildable) {
    if (AUTO_BUILD_T) { clearTimeout(AUTO_BUILD_T); AUTO_BUILD_T = null; }
    const bb = $("build-btn");
    if (bb) bb.innerHTML = 'Rebuild my story';
    /* …unless a password panel is up, from this drop or an earlier one. The
     * build would move focus to the report and scroll to it, taking the field
     * from under someone mid-password; it waits for the panel instead (see
     * PENDING_ZIP), and the page stays where the panel is. */
    if (PENDING_ZIP) PENDING_ZIP.buildHeld = true;
    else {
      const genAt = DATA_GEN;
      AUTO_BUILD_T = setTimeout(() => {
        AUTO_BUILD_T = null;
        if (genAt !== DATA_GEN) return;
        // a locked ZIP dropped during the wait brought a panel up: hold for it too
        if (PENDING_ZIP) PENDING_ZIP.buildHeld = true; else build();
      }, 900);
      if ($("build-row")) $("build-row").scrollIntoView({ behavior: scrollBehavior(), block: "center" });
    }
  } else if (RAW.length && $("build-row") && !PENDING_ZIP) {
    $("build-row").scrollIntoView({ behavior: scrollBehavior(), block: "center" });
    try { $("build-btn").focus({ preventScroll: true }); } catch (e) {}
  }
}

/* True whenever what's on screen was built from the bundled sample export
 * rather than the reader's own files. `window.DEMO_PAGE` is NOT a substitute:
 * metrics.html?demo=1 loads the same invented trainer on a page that is
 * otherwise the real app. Anything that addresses the reader in the second
 * person about their own figures must check THIS. It is deliberately sticky —
 * if sample and real files are ever mixed, staying true suppresses a claim
 * rather than making a false one. */
let SAMPLE_DATA = false;
let AUTO_BUILD_T = null;   // pending auto-build after a drop (debounced)

/* Load the bundled, fully-scrubbed sample export so people can see the output
 * without uploading anything of their own.
 *
 * The folder is `sample-export/`, not `demo/`: a folder called demo collides
 * with the demo.html page once Netlify serves extensionless URLs, and the
 * netlify.toml `noindex` header written for the data would then land on the
 * page too. Different names, no collision. */
async function loadDemo() {
  clearError();
  try {
    const man = await fetch("sample-export/manifest.json").then((r) => {
      if (!r.ok) throw new Error("manifest.json " + r.status);
      return r.json();
    });
    // All in parallel — HTTP/2 serves the whole sample export in one round trip.
    const files = await Promise.all(man.files.map(async (p) => {
      const r = await fetch("sample-export/" + p);
      if (!r.ok) throw new Error(p + " " + r.status);
      return new File([await r.text()], p.split("/").pop());
    }));
    RAW = []; DATA_GEN++;
    SAMPLE_DATA = true;
    await ingest(files);
    build();
  } catch (e) {
    console.warn(e);
    // "live example" everywhere, including when it fails — and the upload advice
    // only applies on metrics.html, which is the only page with an upload UI.
    showError("Couldn't load the live example (" + (e && e.message ? e.message : "network error") + ")."
      + (window.DEMO_PAGE ? " Usually a connection blip — try again in a moment." : " Check your connection and try again — or upload your own files."));
    // On the live-example page there's no upload UI — give a real retry button
    // instead of stranding the visitor on a dead spinner.
    const res = window.DEMO_PAGE && $("results");
    if (res) {
      res.innerHTML = `<div class="empty-state"><div class="es-icon">${window.ICON ? window.ICON("sparkles") : "📡"}</div>
        <h3 style="margin:10px 0 6px">The live example couldn't load</h3>
        <p>The sample export didn't come through — usually a connection blip.</p></div>`;
      const rb = document.createElement("button");
      rb.className = "btn btn-teal"; rb.type = "button"; rb.style.marginTop = "14px";
      rb.innerHTML = '<span aria-hidden="true">↻</span> Try again';
      rb.onclick = () => { res.innerHTML = `<div class="empty-state"><div class="gl-spin" style="margin:0 auto 14px"></div><p>Building the example…</p></div>`; loadDemo(); };
      res.querySelector(".empty-state").appendChild(rb);
    }
  }
}

/* ── build console: what each file unlocks ──
   Visible from the first visit, before a single file is added: every chapter
   the app can build, which file unlocks it, and — as files arrive — which are
   lit. The old "N files added" line only spoke after the fact. */
const GROUP_ICON = { "Your Profile": "user", "Your Activity": "activity", "Your Social World": "users", "Your Spending": "card", "Your Fitness": "activity", "Events": "ticket", "Technical & Device": "phone" };
function renderUnlocks() {
  const el = $("unlocks");
  if (!el || !window.CATALOG) return;
  const list = window.CATALOG.filter((c) => c.story);
  const have = (c) => RAW.some((r) => c.match.test(r.name) && !r.oversize && !r.empty && !r.unreadable);
  const got = list.filter(have).length;
  const I = (n) => (window.ICON ? window.ICON(n) : "");
  const short = (t) => { const m = String(t || "").split(/[,.;—(]/)[0].trim(); return m.length > 64 ? m.slice(0, 61) + "…" : m; };
  el.hidden = false;
  el.innerHTML = `<div class="ul-head">
      <div><div class="ml">Build console</div><h3>${got} of ${list.length} chapters unlocked</h3></div>
      <div class="ul-side">
        <div class="ul-bar" aria-hidden="true"><i style="width:${Math.round((got / list.length) * 100)}%"></i></div>
        ${got ? "" : `<a class="btn btn-ghost ul-demo" href="demo.html">${I("play")} Not ready? See the live example</a>`}
      </div>
    </div>
    <div class="ul-grid">${list.map((c) => {
      const on = have(c), meta = CHAPTER_META[c.icon];
      return `<div class="ul-item${on ? " on" : ""}" data-hue="${meta ? meta[1] : "teal"}">
        <span class="ul-ic">${I(meta ? meta[0] : GROUP_ICON[c.group] || "folder")}</span>
        <div class="ul-t"><b>${esc(c.name)}</b><span class="ul-file">${esc(c.id)}</span><span class="ul-story">${on ? "Unlocked" : "Unlocks"}: ${esc(short(c.story))}</span></div>
        <span class="ul-st">${on ? I("award") + " Added" : "Not added"}</span>
      </div>`; }).join("")}</div>`;
}
function renderDetected() {
  const el = $("detected");
  if (!el) return; // results-only pages (e.g. the live-example page) skip the picker
  renderUnlocks();
  const buildRow = $("build-row");
  // hidden, never an inline display: an inline display beat the rule that folds
  // this section away once a report exists, and left Rebuild and Clear showing
  if (buildRow) buildRow.hidden = !RAW.length;
  if (!RAW.length) { el.innerHTML = ""; return; }
  const tally = { ready: 0, privacy: 0, noChapter: 0, empty: 0, oversize: 0, unknown: 0, container: 0 };
  // one row per file, however many copies of it arrived
  const rows = logicalFiles().map((g) => {
    const cs = g.copies, r = cs[0];
    const live = cs.filter((c) => !c.oversize && !c.unreadable);
    const empty = live.length > 0 && live.every((c) => c.empty);
    const oversize = !live.length ? Math.max(0, ...cs.map((c) => c.oversize || 0)) : 0;
    const unreadable = !live.length && !oversize;
    let cls = "unknown", status = "Not recognized", name = g.name, icon = window.ICON ? window.ICON("search") : "❓", note = "We don't have a story for this file.", kind = "unknown";
    if (r.entry) {
      name = r.entry.name; icon = window.fileIcon ? window.fileIcon(r.entry.icon, r.entry.group) : r.entry.icon; note = r.entry.summary;
      if (r.entry.story) { cls = "ok"; status = "Ready"; kind = "ready"; }
      // "skipped for privacy" and "we have no chapter for this yet" are very
      // different promises — don't tell someone we ignored a harmless file.
      else if (r.entry.sensitivity === "high") { cls = "skip"; status = "Skipped (privacy)"; kind = "privacy"; }
      else { cls = "skip"; status = "No chapter yet"; kind = "noChapter"; }
    }
    if (r.container) {
      const inside = cs.reduce((a, c) => a + (c.container || 0), 0), unlocked = cs.some((c) => c.unlocked);
      cls = "ok"; kind = "container"; icon = window.ICON ? window.ICON(unlocked ? "lock" : "folder") : "🗂️";
      status = `${unlocked ? "Unlocked" : "Opened"}${cs.length > 1 ? ` (${cs.length} copies)` : ""} — ${inside} file${inside === 1 ? "" : "s"} inside added`;
      note = unlocked ? "Opened right here with the password you typed, which was used once and not kept."
        : "Not password-protected, so it was opened right here in your browser.";
    }
    else if (r.entry && PJ_PAIR.test(g.name) && pjTwinPresent(g.name)) {
      note = /2\.csv$/i.test(g.name)
        ? "The 3-year timeline. Its positions are blurred to a few km in the export itself, so its “1” twin draws the map; the events they share are counted once."
        : "Precise positions for the last ~15 months — this file draws your map and ranks your stops; its “2” twin stretches the timeline to 3 years.";
    }
    // two or more copies with rows in them: say how they were combined (see
    // mergeRule) — or that they were identical, byte for byte, and count once
    const withRows = live.filter((c) => !c.empty), useful = withRows.length;
    if (!r.container && useful > 1) {
      const rule = mergeRule(g.name);
      const identical = new Set(withRows.map((c, i) => c.hash || "#" + i)).size === 1;
      note += identical ? ` ${useful} identical copies — counted once.`
        : rule === "newest" ? ` ${useful} copies — the newest one is used.`
        : rule === "gameplay" ? ` ${useful} copies — the newest one for your profile, the recent-activity log from all of them.`
        : ` ${useful} copies merged — rows they share are counted once.`;
      if (kind === "ready") status = identical ? `Ready — ${useful} identical copies`
        : rule === "newest" ? `Ready — newest of ${useful} copies` : `Ready — ${useful} copies merged`;
    }
    if (empty) { cls = "skip"; status = "Empty — nothing on record"; note = "The export shipped this file with no rows in it."; kind = "empty"; }
    if (oversize) { cls = "skip"; status = `Too large (${oversize} MB) — skipped`; kind = "oversize"; }
    if (unreadable) { cls = "unknown"; status = "Couldn't read — add it again"; note = "The browser couldn't open this file. Pick or drop it once more."; kind = "unknown"; }
    tally[kind]++;
    // every name a copy arrived under: "Pokestop_spin1.csv + Pokestop_spin1 2.csv"
    const names = [...new Set(cs.map((c) => c.orig || c.name))];
    const shown = names.join(" + ") + (cs.length > names.length ? ` (${cs.length} copies)` : "");
    return `<div class="file-chip ${cls}">
      <span class="fc-icon">${icon}</span>
      <div class="fc-main"><div class="fc-name">${esc(name)}</div><div class="fc-file">${esc(shown)} · ${esc(note)}</div></div>
      <span class="fc-status">${esc(status)}</span>
    </div>`;
  }).join("");
  /* An honest summary, not a flat "N files ready": counting a mis-drop as
   * "ready" hid the problem behind a closed disclosure until after Build. */
  // "chapters" means chapters: count the catalog entries a file unlocked, not
  // the files that have a story — nine Player_Journey shards are one chapter
  const chartable = (window.CATALOG || []).filter((c) => c.story);
  const unlocked = chartable.filter((c) => RAW.some((r) => c.match.test(r.name) && !r.oversize && !r.empty && !r.unreadable)).length;
  const bits = [`<b>${unlocked}</b> of ${chartable.length} chapters unlocked`];
  if (tally.privacy) bits.push(`${tally.privacy} privacy-skipped`);
  if (tally.noChapter) bits.push(`${tally.noChapter} no chapter yet`);
  if (tally.empty) bits.push(`${tally.empty} empty`);
  if (tally.oversize) bits.push(`${tally.oversize} too large`);
  if (tally.unknown) bits.push(`${tally.unknown} not recognized`);
  // wrong or unreadable drops must be visible BEFORE the Build click
  const attention = tally.unknown + tally.oversize > 0;
  // what a player can see in their own folder (an archive counts once, not once
  // more for every file inside it), and what merging copies did
  const visible = visibleFiles(), merged = mergeSummary();
  el.innerHTML = `
    <details class="det-files"${attention ? " open" : ""}>
      <summary class="det-head">
        <h2>${visible} file${visible === 1 ? "" : "s"} added${merged ? ` · ${esc(merged)}` : ""} · ${bits.join(" · ")}</h2>
        <span class="det-toggle">Review files</span>
      </summary>
      <div class="det-list">${rows}</div>
    </details>`;
}

/* ───────────────────────────── routing ───────────────────────────── */
/* Async because the three high-volume parsers stream and yield. Everything
 * else stays synchronous — awaiting a value that isn't a promise is free, and
 * making a 400-row file pay for scheduling would be noise. */
async function routeFile(name, text) {
  const n = name.toLowerCase();
  try {
    if (/gameplay\.txt$/i.test(n)) return parseGameplay(text);
    // Anchored, like the catalog. A loose match here once took "Pokestop_spin1
    // 2.csv" — a Finder copy — for a precise log of its own; copy markers now
    // come off in ingest(), and a name that isn't an event file isn't one here.
    if (PJ_FILE.test(base(n))) {
      const hit = PJ_EVENTS.find(([re]) => re.test(n));
      if (hit) {
        const m = PJ_PAIR.exec(base(n));
        const two = !!(m && m[2] === "2"), twin = m ? pjTwinPresent(n) : false;
        // awaited, not just returned, so a rejection lands in the catch below
        return await parsePlayerJourney(hit[1], text, { blurred: two, precise: !!(m && m[2] === "1"), skipWindow: two && twin, mapOK: !(two && twin), twin });
      }
    }
    if (/gameplaylocationhistory\.tsv$/i.test(n)) return await parseLocation(text);
    if (/friendlist\.tsv$/i.test(n)) return parseFriends(text);
    if (/recentlyunfriended\.tsv$/i.test(n)) return parseUnfriended(text);
    if (/recentinviteactions\.tsv$/i.test(n)) return parseInvites(text);
    if (/activityinvites(received|sent)\.tsv$/i.test(n)) return parseParty(text, /sent/i.test(n));
    if (/inapppurchases\.tsv$/i.test(n)) return parsePurchases(text);
    if (/fitnessdata\.tsv$/i.test(n)) return parseFitness(text);
    if (/app_sessions\.csv$/i.test(n)) return await parseSessions(text);
    if (/app_installs\.csv$/i.test(n)) return parseInstalls(text);
    if (/liveeventregistrationhistory_aspurchaser\.tsv$/i.test(n)) return parseLiveEvents(text);
    if (/wayfarer_player_data\.json$/i.test(n)) return parseWayfarer(text);
    // The app's own location-free stats export, re-imported: two friends swap
    // files over chat and each gets a You-vs-them chapter — no server involved.
    if (/^pogo-metrics-stats.*\.json$/i.test(n)) return parseCompare(text);
    if (/imagedata\.txt$/i.test(n)) return parsePhotos(text);
    // Campfire's export is named after the trainer (<codename>_<date>_<time>.csv),
    // so it is recognised by its shape as well as its name.
    if (/campfire|_\d{8}_\d{6}\.csv$/i.test(n) || /^\uFEFF?User'?s Clubs/.test(text.slice(0, 40))) return parseCampfire(text);
    if (/supportinteractions\d*\.tsv$/i.test(n)) return parseSupport(text);
  } catch (e) {
    console.warn("Failed to parse", name, e);
  }
}
function markLoaded(label) { if (!STATE.loaded.includes(label)) STATE.loaded.push(label); }

/* Every Player_Journey event ships as a PAIR — Pokestop_spin1.csv beside
 * Pokestop_spin2.csv — and they are not halves. Measured on two real exports
 * (June 2026 under Niantic, August 2026 under Scopely) and checked against the
 * GPS trail in GameplayLocationHistory.tsv:
 *   "1"  the trailing ~15 months, positions PRECISE — a median 230 m from the
 *        trail at the same minute (a spin happens within ~80 m of its stop).
 *   "2"  the trailing ~3 years of the SAME events (every "1" timestamp is in
 *        it), with every position blurred to a cell a few kilometres wide — a
 *        median 4.1 km from the trail, never within 100 m, and 159 distinct
 *        "stops" for 86,000 spins where the precise file holds 1,266.
 * So the two files answer different questions: the long one is the timeline,
 * the precise one is the map. A whole-folder drop used to parse both as if
 * they were independent — fifteen months counted twice, and a blurred cell
 * with 37,584 "visits" topping the regular-haunts list.
 * The rule: a "1" file is parsed in full. Its "2" twin is parsed with the "1"
 * window skipped (those events are already counted) and with its positions
 * kept out of the map and the stop/gym rankings — a blurred cell is not a
 * stop. Raid distances still use them: a few kilometres is nothing against
 * the 50 km that makes a raid remote. A "2" file dropped on its own keeps its
 * blurred positions for the map (a 4 km blur is invisible on a globe) but
 * still never ranks them as stops. */
const PJ_PAIR = /^(pokestop_spin|sfida_capture|map_pokemon_encounter|join_raid_lobby|gym_battle|feed_pokemon|deploy_pokemon|incense_encounter|lure_encounter)([12])\.csv$/i;
function pjTwinPresent(name) {
  const m = PJ_PAIR.exec(base(name));
  if (!m) return false;
  const twin = (m[1] + (m[2] === "1" ? "2" : "1") + ".csv").toLowerCase();
  return RAW.some((r) => r.name.toLowerCase() === twin && !r.oversize && !r.empty && !r.unreadable);
}
/* Build order: "1" files before their "2" twins, so the window to skip is known. */
function pjOrder(name) { const m = PJ_PAIR.exec(base(name)); return m && m[2] === "2" ? 1 : 0; }
/* Any Player_Journey event file, by its exact name — the catalog's own test. */
const PJ_FILE = /^(pokestop_spin|sfida_capture|map_pokemon_encounter|join_raid_lobby|gym_battle|feed_pokemon|deploy_pokemon|incense_encounter|lure_encounter)\d*\.csv$/i;

/* ───────────────────────────── copies ─────────────────────────────
 * The same export file can arrive more than once: two exports dropped
 * together, a Player_Journey.zip beside its unzipped folder, a Finder "Keep
 * Both" copy. RAW used to keep one file per name — whichever copy arrived last
 * — so a June and an August export dropped together built a different report
 * almost every time, and none matched either export. Now every copy is kept,
 * copies of one file share a key, and parseRaw() merges them into one text
 * before routing it, by what kind of file it is:
 *   rows      Player_Journey event logs, "1" and "2" kept apart: rows keyed by
 *             exact instant, each instant keeping as many rows as the copy
 *             holding the most distinct rows there (journeyRows)
 *   multiset  rolling logs (GPS trail, fitness, unfriends, friend invites,
 *             party invites) and cumulative ledgers (purchases, photos,
 *             support, sessions, installs, attribution, tickets): every row any
 *             copy holds, a row repeated inside one copy kept as often as the
 *             copy that repeats it most
 *   gameplay  Gameplay.txt: the newest copy, its recent-activity log stacked
 *             from every copy like the rolling logs
 *   newest    snapshots (friends, account, profile, contacts, Wayfarer, and
 *             anything not named above): the newest copy
 * "Newest" comes from the data — the later of the latest moment the copy
 * carries and the latest its export mentions (a Campfire export: the moment in
 * its name; see rankCopies) — never from arrival order or the file system's
 * dates, so the same files build the same report whatever order they came in. */
const MERGE_MULTISET = /^(gameplaylocationhistory\.tsv|fitnessdata\.tsv|recentlyunfriended\.tsv|recentinviteactions\.tsv|activityinvites(received|sent)\.tsv|inapppurchases\.tsv|imagedata\.txt|supportinteractions\d*\.tsv|app_sessions\.csv|app_installs\.csv|user_attribution_sessions\.csv|liveeventregistrationhistory_\w+\.tsv)$/i;
function mergeRule(name) {
  const n = canonicalName(name);
  return PJ_FILE.test(n) ? "rows" : MERGE_MULTISET.test(n) ? "multiset" : /^gameplay\.txt$/i.test(n) ? "gameplay" : "newest";
}
/* Copies of one file share this. A Campfire export is named after the trainer
 * and the moment it was made, so two of them are two copies of one file. */
function fileKey(name, text) {
  const n = canonicalName(name).toLowerCase();
  return /campfire|_\d{8}_\d{6}\.csv$/.test(n) || (text && /^\uFEFF?User'?s Clubs/.test(text.slice(0, 40))) ? "campfire" : n;
}
/* A copy's content, byte for byte: the SHA-256 of its bytes, in hex. Null
 * where the browser offers no Web Crypto (a page served over plain http). */
async function contentHash(bytes) {
  try {
    if (typeof crypto !== "object" || !crypto || !crypto.subtle) return null;
    const d = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    let h = "";
    for (const b of d) h += (b < 16 ? "0" : "") + b.toString(16);
    return h;
  } catch (e) { return null; }
}
/* One entry per copy. The same file picked again — the same key and place and,
 * byte for byte, the same content (its SHA-256) — takes its old entry's place,
 * which is how "add it again" still refreshes a file handle that went stale.
 * Anything else is another copy, however alike its path and size: two exports'
 * Player_Journey.zip picked one at a time put their files at the same path, and
 * a file's rows can change while its size stays put. A copy nothing was read
 * from (too large, or unreadable) holds no rows, so whatever arrives in its
 * place takes over from it. */
function putCopy(rec) {
  const i = RAW.findIndex((r) => r.key === rec.key && r.path === rec.path && !!r.container === !!rec.container
    && (r.hash ? r.hash === rec.hash : !!(r.oversize || r.unreadable)));
  if (i >= 0) RAW[i] = rec; else RAW.push(rec);
}
/* RAW's copies gathered by file, in arrival order: [{ key, name, copies }]. */
function logicalFiles() {
  const by = new Map();
  for (const r of RAW) {
    const k = r.key || (r.container ? "zip:" + r.name.toLowerCase() : fileKey(r.name));
    let g = by.get(k);
    if (!g) by.set(k, (g = { key: k, name: r.name, copies: [] }));
    g.copies.push(r);
  }
  return [...by.values()];
}
/* What a player can see in their own folder: an archive counts once, and what
 * came out of it is its contents, not more files added — a 22-file download
 * was reported as 43 files added. */
const visibleFiles = () => RAW.filter((r) => !r.inside).length;

/* The latest moment a copy mentions, "YYYY-MM-DD HH:MM:SS" ("" for none). Only
 * files up to 2 MB are read for it: scanning a whole 38 MB export takes about
 * 270 ms, the big files are activity logs that merge row by row and never need
 * a newest copy, and every snapshot is small. A Campfire export carries the
 * moment it was made in its name. */
const STAMP_SCAN_MAX = 2 * 1024 * 1024;
const ISO_STAMP = /(\d{4}-\d\d-\d\d)[ T](\d\d:\d\d:\d\d)/g;
const US_STAMP = /(^|[^\d/])(\d{1,2})\/(\d{1,2})\/(\d{4})(?:[ T](\d{1,2}):(\d\d):(\d\d))?/g;
function copyLatest(name, key, text) {
  const cf = key === "campfire" && /_(\d{4})(\d\d)(\d\d)_(\d\d)(\d\d)(\d\d)\.csv$/i.exec(canonicalName(name));
  if (cf) return `${cf[1]}-${cf[2]}-${cf[3]} ${cf[4]}:${cf[5]}:${cf[6]}`;
  if (!text || text.length > STAMP_SCAN_MAX) return "";
  let d = "", t = "";
  ISO_STAMP.lastIndex = 0;
  for (let m; (m = ISO_STAMP.exec(text)); ) if (m[1] > d || (m[1] === d && m[2] > t)) { d = m[1]; t = m[2]; }
  // month/day/year — InAppPurchases, and the log at the end of Gameplay.txt
  US_STAMP.lastIndex = 0;
  for (let m; (m = US_STAMP.exec(text)); ) {
    if (+m[2] < 1 || +m[2] > 12 || +m[3] < 1 || +m[3] > 31) continue;
    const dd = `${m[4]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`;
    const tt = m[5] ? `${m[5].padStart(2, "0")}:${m[6]}:${m[7]}` : "00:00:00";
    if (dd > d || (dd === d && tt > t)) { d = dd; t = tt; }
  }
  return d ? d + " " + t : "";
}
/* Each export's latest moment: group → the latest any of its files mentions.
 * Ticket and invite files can name a day ahead of the export (an event, an
 * expiry), a Campfire export is a request of its own, and a friend's compare
 * file is no export at all — none of them set an export's clock. */
const NO_CLOCK = /^(liveeventregistrationhistory_|activityinvites|pogo-metrics-stats)/i;
function groupClocks() {
  const at = new Map();
  for (const r of RAW) {
    if (r.container || !r.latest || !r.group || r.key === "campfire" || NO_CLOCK.test(r.name)) continue;
    if (r.latest > (at.get(r.group) || "")) at.set(r.group, r.latest);
  }
  return at;
}
/* Newest first. A copy is as new as the later of the latest moment it carries
 * and the latest moment of the export it sat in: every file of one export is
 * written at once, so a friend list whose last friendship is months old is as
 * new as its export. A Campfire export is a request of its own and sets no
 * export's clock, so it is as new as the moment in its name, wherever it sat.
 * Two copies from one export tie, and then the latest moment each carries
 * decides, then its export's moment, length and content, so even copies that
 * tie on everything come out in the same order every time.
 * Both halves matter. Ranked by its export alone, an older Campfire export
 * inside an export folder beat a newer one dropped beside it. Ranked by its
 * own latest moment first, a later export's friend list lost to an earlier
 * one whenever the friend added last had been removed since. The same rule
 * serves every file that takes its newest copy. `list` is [{ r, text }]. */
function rankCopies(list, clocks) {
  const cmp = (a, b) => (a < b ? -1 : a > b ? 1 : 0);
  const clockOf = (r) => (r.key === "campfire" ? "" : clocks.get(r.group) || "");
  const asOf = new Map(list.map((c) => { const own = c.r.latest || "", t = clockOf(c.r); return [c, own > t ? own : t]; }));
  return list.sort((a, b) => cmp(asOf.get(b), asOf.get(a)) || cmp(b.r.latest || "", a.r.latest || "")
    || cmp(clockOf(b.r), clockOf(a.r)) || b.text.length - a.text.length || cmp(b.text, a.text));
}
/* Every row the copies hold, each as many times as the copy that holds it most
 * often — an overlap counts once, and a row an export itself repeats (a line of
 * a support thread) stays repeated. The newest copy's rows come first. */
function multisetUnion(lists, key = (l) => l) {
  const out = [], kept = new Map();
  for (const ls of lists) {
    const here = new Map();
    for (const l of ls) {
      const k = key(l), n = (here.get(k) || 0) + 1;
      here.set(k, n);
      if (n > (kept.get(k) || 0)) { kept.set(k, n); out.push(k); }
    }
  }
  return out;
}
/* One copy's rows under the newest copy's header. Both exports measured ship
 * identical columns, so this is nearly always the rows as they are; should a
 * later export add or reorder a column, each row is rebuilt by column name
 * rather than read under the wrong heading. */
function alignRows(head, lines, csv) {
  if (!lines.length) return [];
  if (lines[0].trim() === head.trim()) return lines.slice(1);
  const split = lineSplitter(csv ? "x.csv" : "x.tsv");
  const have = split(lines[0]).map((h) => h.trim());
  const at = split(head).map((h) => have.indexOf(h.trim()));
  const cell = (v) => (csv && /[",]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
  return lines.slice(1).map((l) => { const c = split(l); return at.map((j) => cell(j < 0 ? "" : c[j] || "")).join(csv ? "," : "\t"); });
}
/* Gameplay.txt's recent-activity log: the lines under its header, up to the
 * blank line — the span parseRecentLog reads. */
function recentLogSpan(lines) {
  const h = lines.findIndex((l) => /^Date and time\tDescription/i.test(l));
  if (h < 0) return null;
  let e = h + 1;
  while (e < lines.length && lines[e].trim() && lines[e].includes("\t")) e++;
  return [h + 1, e];
}
/* A journey file's copies as one list of rows, keyed by exact instant. Within
 * one copy a row repeated byte for byte counts once; across copies each instant
 * keeps as many rows as the copy holding the most distinct rows there, the
 * newest copy's own rows first. A union of distinct rows would count one event
 * twice wherever two exports wrote the same instant in other bytes (a blur, a
 * rounding). On the owner's June and August exports every shared instant holds
 * the same rows in both, so their totals don't move. A row whose timestamp
 * can't be read is kept by its bytes. `bodies` are rows under one header. */
/* An instant as one canonical string, "YYYY-MM-DD HH:MM:SS.mmm UTC": nine
 * journey rows in ten already carry exactly that and are used as they are;
 * only the rest are parsed and written out the same way. Null for no time. */
const TS_CANON = /^\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d{3} UTC$/;
const TS_MS = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3})\d*)?(?:Z| UTC)?$/;
function instantKey(cell) {
  const s = (cell || "").trim();
  if (TS_CANON.test(s)) return s;
  const m = TS_MS.exec(s);
  let t;
  if (m) t = Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4], +m[5], +m[6]) + (m[7] ? +(m[7] + "00").slice(0, 3) : 0);
  else { const d = parseTS(s); if (!d) return null; t = d.getTime(); }
  if (!isFinite(t)) return null;
  const iso = new Date(t).toISOString();
  return iso.slice(0, 10) + " " + iso.slice(11, 23) + " UTC";
}
// the at-th cell of a CSV line that holds no quotes, without splitting all of it
function cellAt(l, at) {
  let s = 0;
  for (let i = 0; i < at; i++) { s = l.indexOf(",", s) + 1; if (!s) return ""; }
  const e = l.indexOf(",", s);
  return e < 0 ? l.slice(s) : l.slice(s, e);
}
/* Two whole exports are about 850,000 journey rows, so this yields like the
 * parsers do, and stops early once the files are cleared. */
async function journeyRows(head, bodies) {
  const split = lineSplitter("x.csv");
  const at = split(head).map((h) => h.trim()).indexOf("Timestamp");
  if (at < 0) return bodies.flat();
  // instant → the row kept there, or the rows when more than one (a copy's own map is shaped the same)
  const out = [], gen = DATA_GEN;
  let kept = null, n = 0;
  for (const body of bodies) {
    const mine = new Map();
    for (const l of body) {
      if (++n % PARSE_CHUNK === 0) {
        await nextTick();
        if (gen !== DATA_GEN) return out;
      }
      const t = instantKey(l.indexOf('"') < 0 ? cellAt(l, at) : split(l)[at]);
      const k = t === null ? "row:" + l : t;
      const m = mine.get(k);
      // a row repeated byte for byte lands on its own instant, so it is found there and counted once
      if (m === undefined) mine.set(k, l);
      else if (typeof m === "string") { if (m !== l) mine.set(k, [m, l]); }
      else if (!m.includes(l)) m.push(l);
    }
    if (!kept) {   // the newest copy: every one of its rows
      kept = mine;
      for (const v of mine.values()) if (typeof v === "string") out.push(v); else out.push(...v);
      continue;
    }
    for (const [k, v] of mine) {
      const have = kept.get(k);
      if (have === undefined) { kept.set(k, v); if (typeof v === "string") out.push(v); else out.push(...v); continue; }
      const rows = typeof v === "string" ? [v] : v, had = typeof have === "string" ? [have] : have;
      let need = rows.length - had.length;
      if (need <= 0) continue;
      const add = [];
      for (const l of rows) { if (!need) break; if (!had.includes(l)) { add.push(l); need--; } }
      out.push(...add);
      kept.set(k, had.concat(add));
    }
  }
  return out;
}
/* The copies of one file as one text. `texts` is newest first, empty copies left out. */
async function mergeCopies(name, texts) {
  if (texts.length < 2) return texts[0] || "";
  const rule = mergeRule(name);
  if (rule === "newest") return texts[0];
  if (rule === "gameplay") {
    const L = texts.map((t) => t.replace(/^\uFEFF/, "").replace(/\r\n?/g, "\n").split("\n"));
    const log = multisetUnion(L.map((ls) => { const s = recentLogSpan(ls); return s ? ls.slice(s[0], s[1]) : []; }));
    const out = L[0].slice(), s = recentLogSpan(out);
    if (s) out.splice(s[0], s[1] - s[0], ...log);
    else if (log.length) out.push("", "Date and time\tDescription", ...log, "");
    return out.join("\n");
  }
  const csv = /\.csv$/i.test(name);
  const headed = !/^recentinviteactions\.tsv$/i.test(canonicalName(name));   // this one ships with no header row
  const L = texts.map(splitLines);
  const head = headed ? L[0][0] : null;
  const bodies = L.map((ls) => (headed ? alignRows(head, ls, csv) : ls));
  // its lines differ between exports only in leading whitespace, which tells no two rows apart
  const rows = rule === "rows" ? await journeyRows(head, bodies) : multisetUnion(bodies, headed ? undefined : (l) => l.replace(/^\s+/, ""));
  if (headed) rows.unshift(head);
  return rows.join("\n") + "\n";
}
/* One plain line for the file list and the upload strip: what merging did. A
 * copy byte for byte like another (the same SHA-256) is identical: it changes
 * nothing and counts once. A copy whose rows differ was merged. "Duplicate"
 * used to cover both, so a newer friend list copied in beside the old one read
 * as a duplicate although its rows were stacked in.
 * Another export is claimed only where the data differ: each distinct copy is
 * dated by the latest export holding it, and exports are named when those
 * dates differ. An identical copy is never another export. A second unzip of
 * Player_Journey, or a file added again on its own, used to be dated by its
 * own files and read as "2 exports merged" beside a single export. */
function mergeSummary() {
  const clocks = groupClocks(), when = new Set();
  let same = 0, differ = 0;
  for (const g of logicalFiles()) {
    if (g.key.startsWith("zip:")) continue;
    const cs = g.copies.filter((r) => !r.oversize && !r.unreadable);
    if (cs.length < 2) continue;
    // content → the latest export holding it (a copy with no hash can't be vouched for as identical)
    const kinds = new Map();
    cs.forEach((r, i) => {
      const k = r.hash || "#" + i, t = clocks.get(r.group) || "";
      if (!kinds.has(k) || t > kinds.get(k)) kinds.set(k, t);
    });
    same += cs.length - kinds.size;
    if (kinds.size > 1) { differ += kinds.size - 1; for (const t of kinds.values()) if (t) when.add(t); }
  }
  const at = [...when].sort(), parts = [];
  if (at.length > 1) {
    const month = (t) => MONTHS[+t.slice(5, 7) - 1] + " " + t.slice(0, 4);
    const day = (t) => MONTHS[+t.slice(5, 7) - 1] + " " + +t.slice(8, 10) + ", " + t.slice(0, 4);
    const labels = at.map(new Set(at.map(month)).size === at.length ? month : day);
    parts.push(`${at.length} exports merged: ${labels.slice(0, -1).join(", ")} and ${labels[labels.length - 1]}`);
  } else if (differ) parts.push(`${differ} cop${differ === 1 ? "y" : "ies"} with different rows merged`);
  if (same) parts.push(`${same} identical cop${same === 1 ? "y" : "ies"} counted once`);
  return parts.join(" · ");
}

/* ───────────────────────────── parsers ───────────────────────────── */
function parseGameplay(text) {
  const grab = (re, cast = (x) => x, dflt = null) => { const m = text.match(re); return m ? cast(m[1]) : dflt; };
  const p = {
    username: grab(/Pokemon Home Trainer Name: (.+)/),
    startDate: grab(/Start date: (.+)/),
    level: grab(/Level: (\d+)/, Number, 0),
    totalXp: grab(/Total XP: (\d+)/, Number, 0),
    pokecoin: grab(/Pokecoin: (\d+)/, Number, 0),
    stardust: grab(/Stardust: (\d+)/, Number, 0),
    distanceWalkedKm: grab(/Distance walked: ([\d.]+) km/, Number, 0),
    eggsHatched: grab(/You have hatched (\d+)/, Number, 0),
    totalItems: grab(/You have (\d+) items/, Number, 0),
    medalCount: grab(/You have (\d+) medals/, Number, 0),
    buddy: grab(/Buddy nickname: (.+)/),
  };
  if (p.startDate) { const m = p.startDate.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/); if (m) p.startYear = m[3]; }
  STATE.profile = p;

  /* Medals. Gameplay.txt writes them three different ways:
   *   "\tBadge: Hatch X Eggs. where X is : 4"   → tier
   *   "\tBADGE_NAME: 4"                         → tier
   *   "\tBadge: hours defended: : 4"            → tier (name carries a colon)
   * The third shape was previously unmatched, which dropped five medals — four
   * of them Platinum, so a level-80 trainer showed 46 Platinum when 50 are
   * required to reach 80 at all.
   * A handful of event/collection badges (BADGE_MINI_COLLECTION, BADGE_SMORES_01)
   * store a PROGRESS COUNT rather than a 1-4 tier, so they are kept and counted
   * but deliberately left untiered instead of being charted as "tier 162". */
  parseBag(text);

  const medals = [];
  const re = /^[ \t]*Badge: (.+?)\.? where X is : (\d+)[ \t]*$|^[ \t]*(BADGE_\w+): (\d+)[ \t]*$|^[ \t]*Badge: ([^:\n]+): : (\d+)[ \t]*$/gm;
  let m;
  while ((m = re.exec(text))) {
    const token = m[3] || "";
    const raw = m[1] || m[5] || titleCase(token.replace(/^BADGE_/, ""));
    const name = String(raw || "").replace(/\bX\b/g, "…").trim();
    const value = +(m[2] || m[4] || m[6]);
    if (!name || !value) continue;
    /* Event and collection badges store PARTICIPATION, not a tier: a GO Fest
     * badge is "1" because you attended once, not because it is Bronze. Counting
     * them as Bronze put 70 of them in the cabinet and turned a level-80
     * trainer's 3 Bronze medals into 71. Only genuine medals carry tiers 1-4. */
    const isEvent = EVENT_BADGE.test(token);
    const tiered = !isEvent && value >= 1 && value <= 4;
    medals.push({ name, tier: tiered ? value : null, progress: tiered ? null : value, event: isEvent });
  }
  STATE.medals = medals.sort((a, b) => (b.tier || 0) - (a.tier || 0));

  // collection
  const cm = text.match(/Pokemon in your collection:\n((?:[ \t].+\n?)+)/);
  const species = {}, dex = {};
  let total = 0;
  if (cm) {
    cm[1].split("\n").forEach((line) => {
      const entry = line.trim().split("\t")[0].trim();
      if (!entry) return;
      total++;
      const mm = entry.match(/V(\d{4})_POKEMON_(\w+)/);
      if (mm) { const name = titleCase(mm[2]); species[name] = (species[name] || 0) + 1; const d = +mm[1]; dex[d] = (dex[d] || 0) + 1; }
      else {
        // Plain display name (older gens in real exports). Recover its dex
        // number from the name so its region of origin still counts.
        species[entry] = (species[entry] || 0) + 1;
        const d = window.dexFromName && window.dexFromName(entry);
        if (d) dex[d] = (dex[d] || 0) + 1;
      }
    });
  }
  const genCounts = {};
  GEN_RANGES.forEach(([gen, lo, hi, region]) => {
    let u = 0, t = 0;
    for (const d in dex) { const dn = +d; if (dn >= lo && dn <= hi) { u++; t += dex[d]; } }
    if (t) genCounts[region] = { gen, unique: u, total: t, dexSize: hi - lo + 1 };
  });
  STATE.collection = {
    total, uniqueSpecies: Object.keys(species).length,
    topSpecies: Object.entries(species).sort((a, b) => b[1] - a[1]).slice(0, 12),
    genCounts,
  };
  parseEggs(text);
  parseRecentLog(text);
  parseReferrals(text);
  markLoaded("Gameplay Summary");
}

/* ── Referral Connections (Gameplay.txt) ──
 * Every trainer who joined with your referral code, one per line, then whether
 * the two of you are friends:
 *   Player\tAreFriends
 *   <codename>\t\ttrue
 * Those codenames are other people's, so only the count survives: how many you
 * brought into the game, and how many of them are on your friend list. */
function parseReferrals(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  const start = lines.findIndex((l) => /^Referral Connections:/i.test(l));
  if (start < 0) return;
  let total = 0, friends = 0;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) break;                                   // the list ends at the blank line
    // its header — a codename can't hold a tab, and a real row ends in true/false
    if (i === start + 1 && /^Player\t/i.test(line) && !/\t(true|false)\s*$/i.test(line)) continue;
    const cells = line.split("\t");
    if (!cells[0].trim()) continue;
    total++;
    if (/^true$/i.test((cells[cells.length - 1] || "").trim())) friends++;
  }
  if (total) STATE.referrals = { total, friends };
}

/* ── egg pool (Gameplay.txt) ──
 * "You have hatched N and currently have M eggs:" is followed by one line per
 * egg — "\tEgg 1: in incubator - 3.3 / 10.0 km" or "\tEgg 3: 0 / 2.0 km". The
 * km figure is the egg's TIER (2/5/7/10/12), and "in incubator" says which ones
 * are actually walking. Only the hatched count was ever read. */
function parseEggs(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  const start = lines.findIndex((l) => /^You have hatched \d+ and currently have \d+ eggs:/.test(l));
  if (start < 0) return;
  const idle = text.match(/You have (\d+) incubators not in use/);
  const held = +lines[start].match(/currently have (\d+) eggs/)[1];
  const tiers = {};
  let incubating = 0;
  for (let i = start + 1; i < lines.length; i++) {
    const m = lines[i].match(/^\tEgg \d+:\s*(.*)$/);
    if (!m) break;                                  // the list ends at the blank line
    if (/in incubator/i.test(m[1])) incubating++;
    const km = m[1].match(/\/\s*([\d.]+)\s*km/);
    if (km) { const k = String(+km[1]); tiers[k] = (tiers[k] || 0) + 1; }
  }
  if (held || Object.keys(tiers).length) {
    STATE.eggs = { held, incubating, idleIncubators: idle ? +idle[1] : null, tiers };
  }
}

/* ── the rolling activity log (Gameplay.txt) ──
 * Under "VS Seeker Status" Niantic ships a short, fully timestamped log of the
 * last stretch you played: every stop and gym spun with its item haul, every
 * Pokémon caught or fled WITH ITS CP, hatches, research completed, buddy candy.
 * It has been in every export all along, and the app only ever counted two of
 * its line shapes into a pair of numbers it then never rendered. */
const RECENT_RE = {
  items: /^Received (\d+) items? from (PokeStop|Gym)\.?$/i,
  caught: /^(.+?) was caught! CP (\d+)$/,
  fled: /^(.+?) ran away! CP (\d+)$/,
  hatched: /^(.+?) was hatched! CP (\d+)$/,
  buddy: /^BUDDY_POKEMON .+ found a candy\.?$/i,
  /* Since August 2026 the log also names the friend behind each gift you open:
   * "Received 3 items from <codename>." Tried after `items`, so stops and gyms
   * are already taken; what is left is a trainer. The gift and its items are
   * counted, and the codename goes no further than this match. */
  gift: /^Received (\d+) items? from (.+?)\.?$/i,
};
/* "V0661_POKEMON_FLETCHLING" and "Growlithe" both appear in this log, exactly
 * as they do in the collection list. Show players the name they know. */
function prettySpecies(n) {
  const m = String(n).match(/^V\d{4}_POKEMON_(.+)$/);
  return titleCase(m ? m[1] : String(n));
}
function parseRecentLog(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  const head = lines.findIndex((l) => /^Date and time\tDescription/i.test(l));
  if (head < 0) return;
  const R = {
    caught: [], fled: [], hatched: [], research: 0, buddyCandy: 0, other: 0,
    items: 0, spins: { PokeStop: 0, Gym: 0 }, first: null, last: null, rows: 0,
    gifts: 0, giftItems: 0,
  };
  for (let i = head + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) break;                        // the log ends at the blank line
    const tab = line.indexOf("\t");
    if (tab < 0) break;
    const ts = parseTS(line.slice(0, tab));
    const desc = line.slice(tab + 1).trim();
    if (!ts || !desc) continue;
    R.rows++;
    if (!R.first || ts < R.first) R.first = ts;
    if (!R.last || ts > R.last) R.last = ts;
    let m;
    if ((m = desc.match(RECENT_RE.items))) {
      R.items += +m[1];
      R.spins[/gym/i.test(m[2]) ? "Gym" : "PokeStop"]++;
    } else if ((m = desc.match(RECENT_RE.gift))) {
      R.gifts++; R.giftItems += +m[1];               // m[2] is a friend's codename — not kept
    } else if ((m = desc.match(RECENT_RE.caught))) R.caught.push({ name: prettySpecies(m[1]), cp: +m[2], ts });
    else if ((m = desc.match(RECENT_RE.fled))) R.fled.push({ name: prettySpecies(m[1]), cp: +m[2], ts });
    else if ((m = desc.match(RECENT_RE.hatched))) R.hatched.push({ name: prettySpecies(m[1]), cp: +m[2], ts });
    else if (/^Completed Research:/i.test(desc)) R.research++;
    else if (RECENT_RE.buddy.test(desc)) R.buddyCandy++;
    else R.other++;
  }
  if (R.rows) STATE.recent = R;
}

/* The single biggest parse in the app — ~446k rows across the Player_Journey
 * files, and the reason a build used to lock the page. Streams and yields.
 * Two counting rules, measured on the June and August 2026 exports:
 *   • a row that appears twice in one file byte for byte — same instant, same
 *     cells — counts once (the old rule counted 15 such rows twice in the June
 *     export and 19 in the August one)
 *   • a "2" row inside its "1" twin's window is an event already counted only
 *     when the "1" file has a row at that exact instant; each "1" row answers
 *     for one "2" row, and a "2" row with no match counts (3 spins in each
 *     export exist only in the "2" file, and skipping the whole window lost them)
 * Both checks read the timestamp straight off the line, before any row object
 * is built — skipping the shared window used to build 126,694 blurred rows on
 * a real export only to throw them away. */
async function parsePlayerJourney(label, text, opts = {}) {
  const e = STATE.ev;
  const win = opts.skipWindow ? e.win[label] : null;   // the precise twin: its span, and the instants it holds
  const places = !opts.blurred;                         // only precise positions may rank as stops and gyms
  const mapOK = opts.mapOK !== false;                   // blurred positions draw the map only when nothing better exists
  const precise = !!opts.precise;                       // a "1" file: the only positions that can place you at a festival
  const lines = splitLines(text);
  if (lines.length < 2) return;
  const splitLine = lineSplitter("x.csv");
  const header = splitLine(lines[0]).map((h) => h.trim());
  const tsAt = header.indexOf("Timestamp");
  if (tsAt < 0) return;
  const seen = new Set();                               // this file's rows so far, byte for byte
  const own = precise && opts.twin ? [] : null;         // a "1" file's instants, for its "2" twin to match
  const gen = DATA_GEN;
  let n = 0, first = null, last = null;
  for (let i = 1; i < lines.length; i++) {
    if (i % PARSE_CHUNK === 0) {
      await nextTick();
      if (gen !== DATA_GEN) return;   // cleared mid-file — stop working
    }
    const line = lines[i];
    if (seen.has(line)) continue;
    seen.add(line);
    const cells = line.indexOf('"') < 0 ? line.split(",") : splitLine(line);
    const ts = parseTS(cells[tsAt]);
    if (!ts) continue;
    const t = ts.getTime();
    if (win && t >= win.first && t <= win.last && matchInstant(win, t)) continue;
    const row = {};
    header.forEach((h, j) => (row[h] = (cells[j] || "").trim()));
    if (own) own.push(t);
    n++;
    if (!first || ts < first) first = ts;
    if (!last || ts > last) last = ts;
    if (!e.first || ts < e.first) e.first = ts;
    if (!e.last || ts > e.last) e.last = ts;
    const mk = monthKey(ts);
    (e.byMonth[mk] = e.byMonth[mk] || {})[label] = (e.byMonth[mk][label] || 0) + 1;
    e.hourweek[weekdayMon(ts)][ts.getUTCHours()]++;
    e.hourweekLocal[(ts.getDay() + 6) % 7][ts.getHours()]++;   // the viewer's clock at that moment, daylight saving and all
    const iso = ts.toISOString().slice(0, 10);
    e.days.add(iso);
    e.dayCounts[iso] = (e.dayCounts[iso] || 0) + 1;
    e.stamps.push(ts.getTime()); // kept for session reconstruction (8 bytes/row)
    const lat = parseFloat(row.Player_Latitude), lon = parseFloat(row.Player_Longitude);
    let hasLoc = false;
    if (!isNaN(lat) && !isNaN(lon) && (lat || lon)) {
      hasLoc = true;
      /* "I was there": a precise position inside an in-person festival's city
       * box during its dates. Only "1" files qualify — a "2" position is blurred
       * a few kilometres in the export itself, enough to carry a trainer across
       * a city line. Venue ids, counts and UTC days are kept; the position isn't.
       * The badge follows the venue's local dates. A day label goes on the row's
       * UTC day, like every other day in the report, so it is kept only when that
       * day is one of the festival's own dates: breakfast in Tokyo on the first
       * morning is still May 28 in UTC, and May 28 was no GO Fest day. */
      if (precise && t >= FEST_T0 && t < FEST_T1) {
        for (const v of FEST_VENUES) {
          if (t < v.t0 || t >= v.t1 || lat < v.box[0] || lat > v.box[2] || lon < v.box[1] || lon > v.box[3]) continue;
          const s = e.there[v.id] || (e.there[v.id] = { n: 0, days: {} });
          s.n++;
          if (iso >= v.from && iso <= v.to) s.days[iso] = (s.days[iso] || 0) + 1;
        }
      }
      if (mapOK) {
        const key = lat.toFixed(3) + "," + lon.toFixed(3);
        e.geo.set(key, (e.geo.get(key) || 0) + 1);
        // the EARLIEST month, not the first file parsed — event files arrive in any order
        if (!e.geoFirst.has(key) || mk < e.geoFirst.get(key)) e.geoFirst.set(key, mk);
        let gm = e.geoMonths.get(key);
        if (!gm) { gm = {}; e.geoMonths.set(key, gm); }
        gm[mk] = (gm[mk] || 0) + 1;
        let kc = e.geoKind.get(key);
        if (!kc) { kc = {}; e.geoKind.set(key, kc); }
        kc[label] = (kc[label] || 0) + 1;
      } else e.blurredRows++;
    }
    /* Fort_/Gym_ coordinates identify the actual PokéStop or gym — the export
     * has carried them all along and nothing ever read them. Binned to ~11 m so
     * GPS scatter around one real stop collapses to a single place. */
    const flat = parseFloat(row.Fort_Latitude), flon = parseFloat(row.Fort_Longitude);
    if (places && !isNaN(flat) && !isNaN(flon) && (flat || flon)) {
      const fk = flat.toFixed(4) + "," + flon.toFixed(4);
      const f = e.forts.get(fk);
      if (f) { f.n++; if (ts < f.first) f.first = ts; if (ts > f.last) f.last = ts; }
      else e.forts.set(fk, { n: 1, first: ts, last: ts, lat: flat, lon: flon });
    }
    if (label === "Raids") {
      e.raidTotal++;
      const glat = parseFloat(row.Gym_Latitude), glon = parseFloat(row.Gym_Longitude);
      if (places && !isNaN(glat) && !isNaN(glon) && (glat || glon)) {
        const gk = glat.toFixed(4) + "," + glon.toFixed(4);
        const g = e.gyms.get(gk);
        if (g) { g.n++; if (ts < g.first) g.first = ts; if (ts > g.last) g.last = ts; }
        else e.gyms.set(gk, { n: 1, first: ts, last: ts, lat: glat, lon: glon });
      }
      if (hasLoc && !isNaN(glat) && !isNaN(glon) && (glat || glon)) {
        const d = haversine(lat, lon, glat, glon);
        e.raidKmSum += d; e.raidWithDist++;
        if (d > e.raidMaxKm) e.raidMaxKm = d;
        if (d >= 50) {
          e.raidRemote++;
          e.remoteRaidsByYear[ts.getUTCFullYear()] = (e.remoteRaidsByYear[ts.getUTCFullYear()] || 0) + 1;
          const ak = `${lat.toFixed(1)},${lon.toFixed(1)},${glat.toFixed(1)},${glon.toFixed(1)}`;
          e.raidArcs.set(ak, (e.raidArcs.get(ak) || 0) + 1);
          if (!e.arcFirst.has(ak) || mk < e.arcFirst.get(ak)) e.arcFirst.set(ak, mk);
          let am = e.arcMonths.get(ak);
          if (!am) { am = {}; e.arcMonths.set(ak, am); }
          am[mk] = (am[mk] || 0) + 1;
          const gk = `${glat.toFixed(1)},${glon.toFixed(1)}`;
          e.raidGymBins.set(gk, (e.raidGymBins.get(gk) || 0) + 1);
        }
      }
    }
  }
  e.totals[label] = (e.totals[label] || 0) + n;
  if (n && !opts.blurred) e.win[label] = { first: first.getTime(), last: last.getTime(),
    at: own ? Float64Array.from(own).sort() : null, used: own ? new Uint8Array(own.length) : null };
  if (win) win.at = win.used = null;   // matched — nothing else needs them
  if (n) markLoaded("Player Journey events");
}
/* Take one not-yet-matched "1" row at instant t. With no instants on record —
 * a "1" file parsed before its twin was known — the whole window stands in. */
function matchInstant(win, t) {
  const a = win.at;
  if (!a) return true;
  let lo = 0, hi = a.length;
  while (lo < hi) { const mid = (lo + hi) >> 1; if (a[mid] < t) lo = mid + 1; else hi = mid; }
  for (let i = lo; i < a.length && a[i] === t; i++) if (!win.used[i]) { win.used[i] = 1; return true; }
  return false;
}

/* GPS trail retention.
 * The map samples to 6,000 points and the globe to 15,000, so keeping every
 * point of a multi-year history (185 B each) burns hundreds of MB to render
 * none of it. Retain a uniform sample bounded by TRAIL_CAP: when the buffer
 * fills, halve it in place and double the stride, which keeps the sample
 * evenly spread over the whole time range no matter how long the file is.
 * STATE.trailCount stays exact so displayed totals never lie. */
const TRAIL_CAP = 60000; // 4x the globe's cap — plenty of shape, ~11 MB ceiling
function pushTrailPoint(pt) {
  STATE.trailCount++;
  if (STATE.trailCount % STATE.trailStride !== 0) return;
  STATE.trail.push(pt);
  if (STATE.trail.length >= TRAIL_CAP) {
    const kept = [];
    for (let i = 0; i < STATE.trail.length; i += 2) kept.push(STATE.trail[i]);
    STATE.trail = kept;
    STATE.trailStride *= 2;
  }
}

async function parseLocation(text) {
  let latKey, lonKey, tsKey;
  await eachRow(text, "x.tsv", (row, header) => {
    if (latKey === undefined) {
      latKey = header.find((h) => /lat/i.test(h)) || header[1];
      lonKey = header.find((h) => /lon/i.test(h)) || header[2];
      tsKey = header.find((h) => /date|time/i.test(h)) || header[0];
    }
    const lat = parseFloat(row[latKey]), lon = parseFloat(row[lonKey]);
    const ts = parseTS(row[tsKey]);
    if (!isNaN(lat) && !isNaN(lon) && (lat || lon)) pushTrailPoint({ lat, lon, ts });
  });
  if (STATE.trail.length) markLoaded("Location History");
}

function parseFriends(text) {
  const { rows } = parseRows(text, "x.tsv");
  const F = STATE.friends;
  for (const row of rows) {
    const ts = parseTS(row["Date of friendship start"]);
    const name = (row.Nickname || "").trim() || (row["Friend's codename"] || "").trim() || "?";
    F.rows.push({ ts, name });
    if (ts) F.monthly[monthKey(ts)] = (F.monthly[monthKey(ts)] || 0) + 1;
    const src = (row["Friendship Source"] || "Unknown").trim() || "Unknown";
    F.sources[src] = (F.sources[src] || 0) + 1;
    const by = (row["Friendship initiated by"] || "Unknown").trim();
    F.initiated[by] = (F.initiated[by] || 0) + 1;
    (row["Games they are Friends in"] || "").split(",").forEach((g) => {
      g = g.trim(); if (g) F.games[g] = (F.games[g] || 0) + 1;
    });
  }
  if (F.rows.length) markLoaded("Friend List");
}

function parseUnfriended(text) {
  const { rows } = parseRows(text, "x.tsv", true);
  const F = STATE.friends;
  for (const row of rows) {
    // cells[1] is the date column; cells[0] is the friend's NAME, and parseTS's
    // last resort (new Date(s)) will happily turn some codenames into dates.
    const ts = parseTS(row["Date and time"] || row.__cells[1]);
    if (ts) { F.unfriendedMonthly[monthKey(ts)] = (F.unfriendedMonthly[monthKey(ts)] || 0) + 1; F.unfriended++; }
  }
  if (F.unfriended) markLoaded("Recently Unfriended");
}

/* RecentInviteActions.tsv ships without a header row. Every line is four
 * fields — the action, its time, the OTHER trainer's codename, the result:
 *   Sent friend invitation\t08/24/2026 05:39:49 UTC\t<codename>\tSUCCESS
 * The action, the time and the result are read. The third field is someone
 * else's codename and is never touched: not stored, not counted, not looked at. */
function parseInvites(text) {
  const I = STATE.invites;
  for (const line of text.replace(/\r/g, "").split("\n")) {
    if (!line.trim()) continue;
    const cells = line.split("\t");
    // the real file puts a space before most actions (" Accepted friend invitation")
    const action = (cells[0] || "").trim().toLowerCase();
    const kind = action.includes("accept") ? "accepted" : action.includes("declin") ? "declined"
      : action.includes("sent") || action.includes("send") ? "sent" : null;
    if (!kind) continue;
    I[kind]++;
    const ts = parseTS(cells[1]);
    if (ts) {
      I.monthly[monthKey(ts)] = (I.monthly[monthKey(ts)] || 0) + 1;
      I.slots[slotKey(ts)] = (I.slots[slotKey(ts)] || 0) + 1;
    }
    const result = (cells[3] || "").trim();
    if (result && !/^success$/i.test(result)) I.failed++;
  }
  if (I.sent + I.accepted + I.declined) markLoaded("Recent Invite Actions");
}

/* Party Play invitations: an activity type (WEEKLY_CHALLENGE_PARTY on every
 * real row so far) and the moment the invite went out. Counted, and placed in
 * time the same way as friend invites; the type itself isn't shown. */
function parseParty(text, sent) {
  const { rows } = parseRows(text, "x.tsv", true);
  if (!rows.length) return;
  const P = STATE.party;
  P[sent ? "sent" : "received"] += rows.length;
  for (const row of rows) {
    const ts = parseTS(row["Date and time of invite (UTC)"] || row.__cells[1]);
    if (!ts) continue;
    P.monthly[monthKey(ts)] = (P.monthly[monthKey(ts)] || 0) + 1;
    P.slots[slotKey(ts)] = (P.slots[slotKey(ts)] || 0) + 1;
  }
  markLoaded("Party Play Invites");
}

/* A currency is an ISO 4217 code — three capital letters — and nothing else.
 * The column is file text like any other, and it ends up in a headline tile and
 * a chapter subtitle, so anything that isn't a plain code becomes "UNKNOWN". */
function currencyCode(s) {
  const c = String(s == null ? "" : s).trim().toUpperCase();
  return /^[A-Z]{3}$/.test(c) ? c : "UNKNOWN";
}

function parsePurchases(text) {
  const { rows } = parseRows(text, "x.tsv");
  const S = STATE.spend;
  for (const row of rows) {
    const ts = parseTS(row["Date and time"]);
    const typ = (row["Type of activity"] || "").trim();
    if (typ === "Pokecoin bought") {
      const cur = currencyCode(row.Currency);
      const vendor = (row.Vendor || "OTHER").trim() || "OTHER";
      const amt = parseFloat(row["Money spent on purchase"]) || 0;
      const coins = parseInt(parseFloat(row["Change in pokecoins"]) || 0, 10);
      S.coinsBought += coins; S.purchases++;
      if (ts) S.boughtMonthly[monthKey(ts)] = (S.boughtMonthly[monthKey(ts)] || 0) + coins;
      const c = (S.cur[cur] = S.cur[cur] || { native: 0, coins: 0, purchases: 0 });
      c.native += amt; c.coins += coins; c.purchases++;
      /* Track coins and purchase COUNT per vendor, never a summed native
       * amount: a player can buy in USD on one store and IDR on another, and
       * adding those together gives a number that means nothing. Coins are the
       * one unit every vendor shares. */
      const v = (S.vendor[vendor] = S.vendor[vendor] || { purchases: 0, coins: 0 });
      v.purchases++; v.coins += coins;
    } else if (typ === "In-game item bought") {
      const item = (row["Item purchased"] || "").trim();
      const q = Math.max(parseInt(parseFloat(row["Number of items"]) || 1, 10) || 1, 1);
      /* LPSKU_* are shop BUNDLES rather than single items, and they used to be
       * dropped whole. That threw away both the free daily box — the single
       * most repeated "purchase" in a real export — and every paid bundle. */
      if (item.startsWith("LPSKU")) {
        if (/\bFREE\b/i.test(item)) S.freeBundles += q; else S.paidBundles += q;
      } else if (item) S.items[item] = (S.items[item] || 0) + q;
    } else if (typ === "Pokecoin spent for in-game item") {
      S.spendEvents++;
      const delta = parseInt(parseFloat(row["Change in pokecoins"]) || 0, 10);
      if (delta < 0) {
        S.coinsSpent += -delta;
        if (ts) S.spentMonthly[monthKey(ts)] = (S.spentMonthly[monthKey(ts)] || 0) + -delta;
      }
    } else if (/granted by admin/i.test(typ)) {
      /* Niantic's own compensation for outages, bugs and broken raids. This
       * matched no branch at all before, so it was parsed and discarded. */
      const item = (row["Item purchased"] || "").trim();
      S.granted++;
      if (item) S.grantedItems[item] = (S.grantedItems[item] || 0) + Math.max(parseInt(parseFloat(row["Number of items"]) || 1, 10) || 1, 1);
    }
  }
  if (S.purchases || S.spendEvents || S.freeBundles || S.granted || Object.keys(S.items).length) markLoaded("In-App Purchases");
}

/* Read fitness columns BY HEADER, like every other parser. Reading c[1]/c[2]/c[3]
 * positionally meant a single inserted Niantic column would silently report
 * distance as steps — confidently wrong numbers rather than an obvious blank. */
function parseFitness(text) {
  const { header, rows } = parseRows(text, "x.tsv", true);
  const D = STATE.fitness.daily;
  const col = (re, fallback) => {
    const h = header.find((x) => re.test(x));
    return h !== undefined ? h : fallback;
  };
  const kTs = col(/date|time/i, header[0]);
  const kSteps = col(/step/i, header[1]);
  const kMeters = col(/meter|distance|km/i, header[2]);
  const kCal = col(/calor|energy/i, header[3]);
  let any = false;
  for (const row of rows) {
    const ts = parseTS(row[kTs] || row.__cells[0]);
    if (!ts) continue;
    const d = ts.toISOString().slice(0, 10);
    const rec = (D[d] = D[d] || { steps: 0, meters: 0, cal: 0 });
    rec.steps += parseInt(row[kSteps] || 0, 10) || 0;
    rec.meters += parseFloat(row[kMeters] || 0) || 0;
    rec.cal += parseInt(row[kCal] || 0, 10) || 0;
    any = true;
  }
  if (any) markLoaded("Adventure Sync Fitness");
}

/* Platform and Device_category are small enumerations in the session files
 * ("ios", "android"; "phone", "mobile_phone", "tablet", "unknown_device_category"),
 * and App_version / OS_version are public release numbers. Only those shapes
 * are kept — anything else in the columns is dropped or becomes "Other" — so no
 * free text rides into STATE on the back of a device era. */
const PLATFORMS = new Map([["ios", "iOS"], ["android", "Android"]]);
const DEVICE_KINDS = new Map([["phone", "phone"], ["mobile_phone", "phone"], ["smartphone", "phone"], ["tablet", "tablet"]]);
function platformOf(s) { const k = String(s == null ? "" : s).trim().toLowerCase(); return k ? PLATFORMS.get(k) || "Other" : ""; }
function deviceKindOf(s) { return DEVICE_KINDS.get(String(s == null ? "" : s).trim().toLowerCase()) || ""; }
function versionOf(s) { const v = String(s == null ? "" : s).trim(); return /^\d{1,4}(\.\d{1,5}){0,3}$/.test(v) ? v : ""; }
function versionCmp(a, b) {
  const x = a.split(".").map(Number), y = b.split(".").map(Number);
  for (let i = 0; i < Math.max(x.length, y.length); i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; }
  return 0;
}
/* One install history out of two files. Each install is keyed by its instant,
 * so the same install named in both counts once, and it keeps the device it was
 * made on — the difference between a new phone and a reinstall. */
function addInstall(ts, dev) {
  if (!ts) return;
  const t = STATE.installs.times, k = ts.getTime();
  if (!(k in t) || (!t[k] && dev)) t[k] = dev || "";
}

/* 20,771 rows and 32 columns on a real export — big enough to be worth
 * streaming alongside Player_Journey. */
async function parseSessions(text) {
  const S = STATE.sessions;
  const installs = new Set();   // Install_time values already handed to addInstall
  await eachRow(text, "x.csv", (row) => {
    const ts = parseTS(row.Event_time || row.__cells[0]);
    if (ts) S.monthly[monthKey(ts)] = (S.monthly[monthKey(ts)] || 0) + 1;
    const dev = ((row.Device_model || "") + "").split("::").pop().trim();
    if (dev) S.devices[dev] = (S.devices[dev] || 0) + 1;
    /* Country_code has always been in this file and was always read past. It is
     * the one geography the app can show WITHOUT any GPS file — a session-only
     * upload otherwise gets no world story at all. */
    const cc = (row.Country_code || "").trim().toUpperCase();
    if (/^[A-Z]{2}$/.test(cc)) S.countries[cc] = (S.countries[cc] || 0) + 1;
    const city = (row.City || "").trim();
    const state = (row.State || "").trim();
    const place = [city, state].filter(Boolean).join(", ");
    if (place) {
      S.cities[place] = (S.cities[place] || 0) + 1;
      // Keep WHEN each place was seen, not just how often — a city with dates
      // attached is a memory; a bare count is inventory.
      if (ts) {
        const rec = S.places[place] || (S.places[place] = { n: 0, first: ts, last: ts, days: new Set(), state });
        rec.n++;
        if (ts < rec.first) rec.first = ts;
        if (ts > rec.last) rec.last = ts;
        rec.days.add(ts.toISOString().slice(0, 10));
      }
    }
    /* Every session names the install it came from, which makes this file the
     * fuller install history: on a real account it names 42 installs back to
     * 2021, where App_Installs.csv lists 11 and stops in October 2025. */
    const it = (row.Install_time || "").trim();
    if (it && !installs.has(it)) { installs.add(it); addInstall(parseTS(it), dev); }
    // device eras: what you played on, month by month, and on which release
    const app = versionOf(row.App_version), os = versionOf(row.OS_version);
    if (app) S.apps[app] = (S.apps[app] || 0) + 1;
    if (os) S.oses[os] = (S.oses[os] || 0) + 1;
    if (dev) {
      const k = S.deviceKind[dev] || (S.deviceKind[dev] = { platform: "", kind: "" });
      if (!k.platform) k.platform = platformOf(row.Platform);
      if (!k.kind) k.kind = deviceKindOf(row.Device_category);
      if (ts) { const mo = S.eraMonths[monthKey(ts)] || (S.eraMonths[monthKey(ts)] = {}); mo[dev] = (mo[dev] || 0) + 1; }
    }
    S.total++;
  }, true);
  if (S.total) markLoaded("App Sessions");
}

function parseInstalls(text) {
  const { rows } = parseRows(text, "x.csv", true);
  const I = STATE.installs;
  for (const row of rows) {
    /* Real exports carry Install_time. The demo sample was once reshaped to
     * Event_time with no Install_time at all, so read BOTH names before falling
     * back to a position. Column 0 differs between the two files
     * (Attributed_touch_time vs Event_time), so the positional read is a
     * genuine last resort, not the working path. */
    const ts = parseTS(row.Install_time || row.Event_time || row.__cells[0]);
    if (ts && (!I.first || ts < I.first)) I.first = ts;
    if (ts && (!I.last || ts > I.last)) I.last = ts;
    const dev = ((row.Device_model || "") + "").split("::").pop().trim();
    if (dev) I.devices[dev] = (I.devices[dev] || 0) + 1;
    addInstall(ts, dev);
    I.count++;
  }
  if (I.count) markLoaded("App Installs");
}

function parseLiveEvents(text) {
  const { rows } = parseRows(text, "x.tsv");
  for (const row of rows) {
    const detail = (row["Event Details"] || "").trim();
    if (!detail) continue;
    /* An order can be add-ons alone. The export writes 0 tickets for it, and
     * "parseInt(0) || 1" counted that as a ticket. Zero stays zero; a blank
     * count still means one ticket, as it always has. Whether the order had an
     * add-on is a yes or no — what the add-on was is never read. */
    const n = parseInt(String(row["Number of Tickets on Order"] ?? "").trim(), 10);
    STATE.liveEvents.push({
      name: detail.split(",")[0].trim(),
      tickets: Number.isFinite(n) && n >= 0 ? n : 1,
      addOn: !!(row["AddOn Info"] || "").trim(),
      paid: parseFloat(row["Total Paid"]) || 0,
      // blank stays blank (the ticket isn't counted in a currency); anything
      // else must be a plain three-letter code, or it becomes "UNKNOWN"
      currency: (row["Currency Paid"] || "").trim() ? currencyCode(row["Currency Paid"]) : "",
      date: parseTS(row["Date of Order Placed"]),
    });
  }
  if (STATE.liveEvents.length) markLoaded("Live Event Tickets");
}

/* ── GO Snapshot photos (ImageData.txt) ──
 * Two columns: an opaque image handle and an upload timestamp. No image, no
 * caption, no coordinates — which makes this the one file in the export that is
 * all story and no sensitivity. */
function parsePhotos(text) {
  const { header, rows } = parseRows(text, "x.tsv", true);
  const P = STATE.photos;
  const kId = header.find((h) => /image|id/i.test(h)) || header[0];
  const kTs = header.find((h) => /date|time|upload/i.test(h)) || header[1];
  const seen = new Set();
  for (const row of rows) {
    const id = (row[kId] || row.__cells[0] || "").trim();
    const ts = parseTS(row[kTs] || row.__cells[1]);
    if (!ts) continue;
    if (id) { if (seen.has(id)) continue; seen.add(id); }   // the same photo can be listed twice
    P.total++;
    P.monthly[monthKey(ts)] = (P.monthly[monthKey(ts)] || 0) + 1;
    P.days[ts.toISOString().slice(0, 10)] = (P.days[ts.toISOString().slice(0, 10)] || 0) + 1;
    if (!P.first || ts < P.first) P.first = ts;
    if (!P.last || ts > P.last) P.last = ts;
  }
  if (P.total) markLoaded("Photo / Image Data");
}

/* ── support tickets (SupportInteractions*.tsv) ──
 * DATE AND SUBJECT ONLY. This file also carries the full text of everything you
 * ever wrote to Niantic support, plus custom fields and internal metadata; the
 * catalog promises those are never read, and this is where that promise is
 * kept. The ticket number is an identifier, so it is stripped from the subject
 * rather than stored. */
function parseSupport(text) {
  const { header, rows } = parseRows(text, "x.tsv", true);
  const S = STATE.support;
  const kTs = header.find((h) => /date|time/i.test(h)) || header[0];
  const kTitle = header.find((h) => /ticket/i.test(h)) || header[1];
  /* One TICKET is many ROWS — a conversation with support is one row per
   * message, all sharing "Ticket <number>: <subject>". Counting rows called a
   * six-reply conversation six tickets. Group on the ticket number, and fall
   * back to the subject when a row has none so an untitled row still counts
   * once rather than merging with every other untitled row. */
  const seen = new Set();
  let untitled = 0;
  for (const row of rows) {
    const ts = parseTS(row[kTs] || row.__cells[0]);
    const title = (row[kTitle] || row.__cells[1] || "").trim();
    const num = (title.match(/^\s*Ticket\s+(\d+)\s*:/i) || [])[1];
    const topic = title.replace(/^\s*Ticket\s+\d+\s*:\s*/i, "").trim();
    if (!ts && !title) continue;
    const id = num ? "#" + num : topic ? "t:" + topic + "|" + (ts ? ts.toISOString().slice(0, 10) : ++untitled) : "u:" + ++untitled;
    if (ts) {
      if (!S.first || ts < S.first) S.first = ts;
      if (!S.last || ts > S.last) S.last = ts;
    }
    if (seen.has(id)) continue;   // another message on a ticket already counted
    seen.add(id);
    S.tickets++;
    if (topic) S.topics[topic] = (S.topics[topic] || 0) + 1;
  }
  S.messages = rows.length;
  if (S.tickets) markLoaded("Support Interactions");
}

/* ── Wayfarer (wayfarer_player_data.json) ──
 * The profile's lifetime totals, and four logs Niantic still holds:
 *   OprAssignmentLog  candidates put in front of you to review   { Candidate ID, Time }
 *   OprSubmissionLog  the reviews you sent in, with your ratings  { Time, Rating for …, … }
 *   OprSkippedLog     candidates you skipped
 *   OprUpgradeLog     review upgrades you spent
 * The submission log is REVIEWS, not nominations: its fields are the stars you
 * gave someone else's candidate. COUNTS, MONTHS AND RATINGS ONLY — the profile's
 * email, its home, bonus and last-activity locations, and every Candidate ID,
 * comment, suggested location and duplicate link are never read. */
const WF_RATINGS = [
  ["Rating for Quality", "Overall quality"], ["Rating for Uniqueness", "Uniqueness"],
  ["Rating for Cultural", "Cultural value"], ["Rating for Safety", "Safe access"],
  ["Rating for Location", "Location accuracy"], ["Rating for Text", "Title & description"],
];
function parseWayfarer(text) {
  try {
    const j = JSON.parse(text);
    const root = Array.isArray(j) ? (j[0] || {}) : j;
    const profRaw = root.OprProfile;
    const prof = Array.isArray(profRaw) ? (profRaw[0] || null) : profRaw;
    const subs = root.OprSubmissionLog || [];
    const grabNum = (obj, keys) => { for (const k in obj) { if (keys.some((kk) => k.toLowerCase().includes(kk))) { const v = +obj[k]; if (!isNaN(v)) return v; } } return null; };
    const log = (k) => (Array.isArray(root[k]) ? root[k].filter((e) => e && typeof e === "object") : []);
    /* Wayfarer stamps its logs "2026-05-03 04:05:06 GMT". GMT is UTC, and
     * saying so up front sends it down parseTS's strict path rather than
     * leaving it to each browser's own idea of what Date() accepts. */
    const when = (e) => parseTS(typeof e.Time === "string" ? e.Time.trim().replace(/ GMT$/, " UTC") : "");
    const monthly = (list) => {
      const o = {};
      for (const e of list) { const ts = when(e); if (ts) o[monthKey(ts)] = (o[monthKey(ts)] || 0) + 1; }
      return o;
    };
    const reviewed = log("OprSubmissionLog"), assigned = log("OprAssignmentLog");
    const ratings = {};
    let oneStar = 0, duplicates = 0;
    for (const e of reviewed) {
      for (const [key, label] of WF_RATINGS) {
        const v = parseInt(e[key], 10);
        if (v >= 1 && v <= 5) { const r = ratings[label] || (ratings[label] = { n: 0, sum: 0 }); r.n++; r.sum += v; }
      }
      if (/^true$/i.test(String(e["One Star Submission"] ?? "").trim())) oneStar++;
      if (/^true$/i.test(String(e["Is Duplicate"] ?? "").trim())) duplicates++;
    }
    /* OprSubmissionLog is a LOG — a rolling record Niantic still holds, not a
     * lifetime count. It was labelled "Nominations submitted", which on the
     * reference profile claimed 4 against a lifetime "Total Analyzed" of 7: a
     * smaller number than the thing it supposedly contains. Name it for what it
     * is and let the profile totals carry the lifetime story. */
    STATE.wayfarer = {
      logged: Array.isArray(subs) ? subs.length : null,
      analyzed: prof ? grabNum(prof, ["analyzed"]) : null,
      created: prof ? grabNum(prof, ["created"]) : null,
      rejected: prof ? grabNum(prof, ["rejected"]) : null,
      assigned: assigned.length, skipped: log("OprSkippedLog").length, upgrades: log("OprUpgradeLog").length,
      assignedMonthly: monthly(assigned), reviewedMonthly: monthly(reviewed),
      ratings, oneStar, duplicates,
    };
    const W = STATE.wayfarer;
    if (W.logged || W.analyzed || W.created || W.rejected || W.assigned || W.skipped || W.upgrades) markLoaded("Wayfarer Contributions");
  } catch (e) { /* ignore malformed */ }
}

/* ── Campfire (<codename>_<yyyymmdd>_<hhmmss>.csv) ──
 * Campfire's data export is one CSV holding ten sections back to back — clubs,
 * channels, every message you sent, friends, meetups you hosted, RSVP'd to and
 * checked into, comments, posts, and your last IP address — each introduced by
 * a title line and its own header. Message bodies are quoted and span lines,
 * so this is the one file the line-based splitter cannot read; a small
 * RFC 4180 scanner walks it instead.
 *
 * COUNTS AND DATES ONLY. This file is mostly other people's words plus the
 * coordinates of every meetup you went to. Nothing below keeps a message, a
 * codename, a title, a URL, a coordinate or the IP: each row is reduced to a
 * month, a kind and a tally as it is read, and the text is dropped. */
function csvRecords(text) {
  const recs = [];
  let row = [], cell = "", q = false, i = 0;
  text = text.replace(/^﻿/, "");
  const n = text.length;
  while (i < n) {
    const ch = text[i];
    if (q) {
      if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += ch;
    } else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") {
      if (ch === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); recs.push(row); row = []; cell = "";
    } else cell += ch;
    i++;
  }
  if (cell.length || row.length) { row.push(cell); recs.push(row); }
  return recs;
}
/* The kind of meetup, from its title. Only the kind survives — never the title. */
const CF_KINDS = [
  [/raid hour/i, "Raid Hour"], [/raid day/i, "Raid Day"], [/community day/i, "Community Day"],
  [/spotlight/i, "Spotlight Hour"], [/max battle|dynamax|gigantamax|max monday/i, "Max Battle"],
  [/go fest/i, "GO Fest"], [/go tour/i, "GO Tour"], [/research day|hatch day/i, "Research & Hatch Days"],
  [/rocket|giovanni|shadow raid/i, "Team GO Rocket"], [/raid/i, "Other raids"],
];
/* "2024-07-04 00:51:20.541 +0000 UTC" → the shape parseTS already reads fast */
function cfTime(s) { return String(s || "").replace(/\s\+0000\s+UTC$/, " UTC"); }
/* A meetup counts for its listed length, up to this. The real export lists a
 * few that run for days (a weekend event is one listing of 60 hours), and
 * nobody stood at a meetup for 60 hours. */
const CF_MAX_HOURS = 12;
function parseCampfire(text) {
  const recs = csvRecords(text);
  const cf = {
    clubs: 0, channels: 0, posts: 0, comments: 0,
    messages: 0, msgMonthly: {}, msgHours: Array(24).fill(0), msgFirst: null, msgLast: null,
    msgSlotUTC: {},          // messages per quarter hour of the epoch — see slotKey and renderCampfire
    friends: 0, friendSources: {}, friendsYouAsked: 0, friendsTheyAsked: 0,
    hosted: 0, hostedRsvps: 0, hostedCheckins: 0, hostedMonthly: {}, hostedHours: 0,
    rsvps: 0, rsvpMonthly: {}, checkins: 0, checkinMonthly: {}, checkinDays: new Set(),
    kinds: {}, kindsRsvp: {}, first: null, last: null,
    // the meetups you checked into: hours out (each capped at CF_MAX_HOURS), each
    // one's listed length, and how many checked in / RSVP'd — numbers only
    hoursOut: 0, meetupHours: [], crowd: [], crowdRsvp: [],
  };
  const seen = { hosted: new Set(), rsvp: new Set(), checkin: new Set() };
  let section = null, header = null;
  const isTitle = (r) => r.length === 1 && /^User('s|-Created)?\s+[A-Z]/.test(r[0].trim());
  const touch = (ts) => { if (!cf.first || ts < cf.first) cf.first = ts; if (!cf.last || ts > cf.last) cf.last = ts; };
  const kindOf = (t) => { for (const [re, k] of CF_KINDS) if (re.test(t)) return k; return "Meetups & other"; };
  const bump = (o, k) => { o[k] = (o[k] || 0) + 1; };
  for (const r of recs) {
    if (!r.some((c) => c.trim())) continue;
    if (isTitle(r)) { section = r[0].trim().toLowerCase(); header = null; continue; }
    if (!section) continue;
    if (!header) { header = r.map((h) => h.trim()); continue; }
    const row = {};
    header.forEach((h, j) => (row[h] = (r[j] || "").trim()));
    if (section.includes("clubs")) { if (row.Name || r[0]) cf.clubs++; }
    else if (section.includes("channels")) { if (row.Name || r[0]) cf.channels++; }
    else if (section.includes("sent messages")) {
      const ts = parseTS(cfTime(row["Sent At"] || r[1]));
      if (!ts) continue;
      cf.messages++; touch(ts);
      bump(cf.msgMonthly, monthKey(ts));
      cf.msgHours[ts.getUTCHours()]++;
      bump(cf.msgSlotUTC, slotKey(ts));
      if (!cf.msgFirst || ts < cf.msgFirst) cf.msgFirst = ts;
      if (!cf.msgLast || ts > cf.msgLast) cf.msgLast = ts;
    }
    else if (section.includes("friends")) {
      const src = (row["Friendship source"] || r[1] || "").trim();
      if (!/^[A-Z_]+$/.test(src)) continue;   // not a friend row
      cf.friends++; bump(cf.friendSources, src);
      if (/^true$/i.test(row["Initiated by me"] || r[2] || "")) cf.friendsYouAsked++; else cf.friendsTheyAsked++;
    }
    else if (/meetups|rsvps|checkins/.test(section)) {
      const ts = parseTS(cfTime(row["Event Start Time"] || r[2]));
      if (!ts) continue;
      const id = row["Event Id"] || r[0] || String(ts.getTime());
      const mk = monthKey(ts), kind = kindOf(row["Event Title"] || "");
      const rs = +(row["RSVP count"] || 0) || 0, ci = +(row["Check-in count"] || 0) || 0;
      // the listed length, when the end is after the start — never negative, never guessed
      const te = parseTS(cfTime(row["Event End Time"] || r[3]));
      const hours = te && te > ts ? (te - ts) / 3600e3 : null;
      touch(ts);
      if (section.includes("meetups")) {
        if (seen.hosted.has(id)) continue; seen.hosted.add(id);
        cf.hosted++; cf.hostedRsvps += rs; cf.hostedCheckins += ci; bump(cf.hostedMonthly, mk);
        if (hours != null) cf.hostedHours += Math.min(hours, CF_MAX_HOURS);
      } else if (section.includes("rsvps")) {
        if (seen.rsvp.has(id)) continue; seen.rsvp.add(id);
        cf.rsvps++; bump(cf.rsvpMonthly, mk); bump(cf.kindsRsvp, kind);
      } else {
        if (seen.checkin.has(id)) continue; seen.checkin.add(id);
        cf.checkins++; bump(cf.checkinMonthly, mk); bump(cf.kinds, kind); cf.checkinDays.add(ts.toISOString().slice(0, 10));
        if (hours != null) { cf.hoursOut += Math.min(hours, CF_MAX_HOURS); cf.meetupHours.push(Math.round(hours * 100) / 100); }
        if (ci > 0) cf.crowd.push(ci);
        if (rs > 0) cf.crowdRsvp.push(rs);
      }
    }
    else if (section.includes("comments")) { if (parseTS(cfTime(row["Created At"] || r[3]))) cf.comments++; }
    else if (section.includes("posts")) { if ((row["Post Id"] || r[0] || "").trim()) cf.posts++; }
    // "user last recorded ip address" — deliberately never read
  }
  cf.checkinDays = cf.checkinDays.size;
  if (cf.messages || cf.rsvps || cf.checkins || cf.hosted || cf.friends || cf.clubs) {
    STATE.campfire = cf;
    markLoaded("Campfire export");
  }
}

/* ───────────────────────────── DOM helpers ───────────────────────────── */
/* `anchor` pins the chapter's #id when the heading can't be trusted to stay
   the same — the trainer card's title contains the player's name, so its slug
   would otherwise differ for every reader and no link to it could be shared. */
/* Each chapter keeps the emoji it was written with as its KEY, and that key
 * resolves to a line icon from nav.js's set plus a hue. The hue is the one
 * thing that tells seventeen otherwise identically-built panels apart at a
 * glance: it colours the eyebrow, the icon chip, the rail entry and a top
 * rule, and nothing else — charts keep the shared palette. */
const CHAPTER_META = {
  "🎮": ["user", "teal"],      "🗺️": ["log", "yellow"],     "🤝": ["users", "pink"],
  "🏅": ["award", "yellow"],   "🎒": ["bag", "purple"],     "⏱️": ["clock", "orange"],
  "🔍": ["search", "pink"],    "📸": ["camera", "purple"],  "📅": ["calendar", "magenta"],
  "🌍": ["globe", "blue"],     "📍": ["pin", "blue"],       "💳": ["card", "green"],
  "🏃": ["activity", "orange"], "🎟️": ["ticket", "magenta"], "📱": ["phone", "blue"],
  "🧭": ["compass", "teal"],   "🔥": ["flame", "orange"],
};
function chapterMeta(icon, anchor) {
  if (anchor === "versus-friend") return ["zap", "green"];
  return CHAPTER_META[icon] || ["sparkles", "teal"];
}
function chapterIcon(icon, anchor) {
  const m = chapterMeta(icon, anchor);
  return window.ICON ? window.ICON(m[0]) : icon;
}
function moduleHTML(icon, title, sub, inner, anchor) {
  const hue = chapterMeta(icon, anchor)[1];
  return `<div class="module" data-hue="${hue}"${anchor ? ` data-anchor="${anchor}"` : ""}>
    <div class="mod-head"><span class="mod-icon">${chapterIcon(icon, anchor)}</span><h3>${esc(title)}</h3></div>
    ${sub ? `<div class="mod-sub">${sub}</div>` : ""}
    ${inner}</div>`;
}
/* An inline sparkline — a tile can carry the shape of its number as well as
 * the number. Stroke scales with the box, the end-dot is a positioned element
 * so the stretched viewBox can't squash it into an ellipse. */
function sparkSVG(arr, cls) {
  if (!arr || arr.length < 2) return "";
  const max = Math.max(...arr) || 1, n = arr.length;
  const pts = arr.map((v, i) => [(i / (n - 1)) * 100, 26 - (v / max) * 22]);
  const d = pts.map((p, i) => (i ? "L" : "M") + p[0].toFixed(1) + " " + p[1].toFixed(1)).join(" ");
  const last = pts[n - 1];
  return `<span class="spark-wrap ${cls || ""}"><svg class="spark" viewBox="0 0 100 28" preserveAspectRatio="none" aria-hidden="true"><path class="sp-fill" d="${d} L100 28 L0 28 Z"/><path class="sp-line" d="${d}"/></svg><i class="sp-end" style="left:calc(${last[0].toFixed(1)}% - 3px);top:calc(${((last[1] / 28) * 100).toFixed(1)}% - 3px)"></i></span>`;
}
function alpha(col, a) {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(String(col || "").trim());
  if (!m) return col;
  let h = m[1]; if (h.length === 3) h = h.split("").map((c) => c + c).join("");
  return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
}
function statGrid(items) {
  return `<div class="stat-grid">${items.map(([v, l, s, spark]) =>
    `<div class="stat-card${spark ? " has-spark" : ""}"><div class="v">${v}</div><div class="l">${esc(l)}</div>${s ? `<div class="s">${esc(s)}</div>` : ""}${spark ? sparkSVG(spark) : ""}</div>`).join("")}</div>`;
}
function calloutRow(items) {
  return `<div class="callout-row">${items.map(([v, l]) => `<div class="callout"><b>${v}</b> ${esc(l)}</div>`).join("")}</div>`;
}
function rankList(items, fmtVal = (v) => fmt(v)) {
  const max = items.reduce((m, [, v]) => Math.max(m, v), 0) || 1;
  // fmtVal also gets the whole item, so a row can carry more than its name and number
  return `<div class="rank-list">${items.map((item, i) => { const [name, v] = item; return `
    <div class="rank-row"><span class="rk">${i + 1}</span><span class="rn">${esc(name)}</span><span class="rv">${fmtVal(v, name, item)}</span></div>
    <div class="rank-bar"><i style="width:${((v / max) * 100).toFixed(1)}%"></i></div>`; }).join("")}</div>`;
}
function chartWrap(id, cls = "") { return `<div class="chart-wrap ${cls}"><canvas id="${id}"></canvas></div>`; }
/* Chart.js is lazy-loaded, so its defaults can only be themed once the library
 * is actually present — doing it at DOMContentLoaded silently did nothing and
 * left every chart with Chart.js's own low-contrast #666 text, the wrong font,
 * and animations running for reduced-motion users. */
let CHART_THEMED = false;
const NARROW_VIEW = () => window.matchMedia && window.matchMedia("(max-width: 560px)").matches;
function themeCharts() {
  if (CHART_THEMED || !window.Chart) return;
  CHART_THEMED = true;
  const narrow = NARROW_VIEW();
  Chart.defaults.color = C.dim;
  Chart.defaults.font.family = "'Outfit', system-ui, sans-serif";
  Chart.defaults.borderColor = C.grid;
  Chart.defaults.plugins.legend.labels.boxWidth = narrow ? 8 : 12;
  Chart.defaults.plugins.legend.labels.boxHeight = narrow ? 8 : 12;
  if (narrow) {
    /* At phone width the legend was eating up to half of every canvas
     * (measured: a 142px legend over a 110px doughnut). Chrome shrinks first. */
    Chart.defaults.plugins.legend.labels.font = { size: 10 };
    Chart.defaults.plugins.legend.labels.padding = 6;
  }
  // one mark language for every chart: softly rounded bars, smoothed lines
  // with no point clutter, a whisper of grid and no axis spine
  Chart.defaults.elements.bar.borderRadius = 4;
  Chart.defaults.elements.line.tension = 0.35;
  Chart.defaults.elements.line.borderWidth = 2;
  Chart.defaults.elements.point.radius = 0;
  Chart.defaults.elements.point.hoverRadius = 5;
  Chart.defaults.elements.point.hitRadius = 12;
  Chart.defaults.scale.grid.color = "rgba(255,255,255,.055)";
  if (Chart.defaults.scale.border) Chart.defaults.scale.border.display = false;
  Chart.defaults.scale.ticks.padding = 6;
  Chart.overrides.doughnut = Chart.overrides.doughnut || {};
  Chart.overrides.doughnut.cutout = "66%";
  Chart.overrides.doughnut.borderWidth = 2;
  Chart.overrides.doughnut.borderColor = C.panel2 || "#171c47";
  Chart.overrides.doughnut.hoverOffset = 6;

  /* House tooltip: the same surface, border and mono value line as the heat
   * grids' .hw-tip, so the report has ONE tooltip design instead of Chart.js's
   * stock black box beside a styled bespoke one. */
  const tt = Chart.defaults.plugins.tooltip;
  tt.backgroundColor = C.panel2;
  tt.borderColor = C.line;
  tt.borderWidth = 1;
  tt.cornerRadius = 9;
  tt.padding = 10;
  tt.titleColor = "#fff";
  tt.bodyColor = C.teal;
  tt.bodyFont = { family: "'JetBrains Mono', monospace", size: 12 };
  tt.footerColor = "#fff";
  tt.footerFont = { family: "'JetBrains Mono', monospace", size: 12, weight: 700 };
  /* Index-mode tooltips list up to nine series and leave the reader to sum
   * them by eye: drop zero rows, sort biggest first, and print the total.
   * Math.abs keeps the diverging friends chart honest — its "Unfriended"
   * series is stored negative. */
  const rawN = (i) => {
    const v = typeof i.raw === "number" ? i.raw : i.parsed && typeof i.parsed.y === "number" ? i.parsed.y : Number(i.raw);
    return isFinite(v) ? v : 0;
  };
  tt.filter = (item, idx, items) => items.length <= 1 || rawN(item) !== 0;
  tt.itemSort = (a, b) => Math.abs(rawN(b)) - Math.abs(rawN(a));
  tt.callbacks.footer = (items) => (items.length > 1 ? "Total: " + fmt(items.reduce((a, i) => a + Math.abs(rawN(i)), 0)) : "");

  /* Part-of-whole charts must state the share — wedge angles are not a number.
   * Applies to every doughnut through the type override. */
  Chart.overrides.doughnut = Chart.overrides.doughnut || {};
  Chart.overrides.doughnut.plugins = Chart.overrides.doughnut.plugins || {};
  Chart.overrides.doughnut.plugins.tooltip = {
    callbacks: {
      label: (c) => {
        const total = c.dataset.data.reduce((a, b) => a + (+b || 0), 0);
        return `${c.label}: ${fmt(c.raw)} (${total ? ((c.raw / total) * 100).toFixed(1) : 0}%)`;
      },
      footer: () => "",
    },
  };
  /* …and the empty cutout is where the total belongs. Opt in per chart with
   * options.plugins.centerText = { unit: "actions" }. */
  Chart.register({
    id: "centerText",
    afterDraw(chart) {
      const o = chart.options.plugins && chart.options.plugins.centerText;
      if (!o || chart.config.type !== "doughnut") return;
      const meta = chart.getDatasetMeta(0);
      if (!meta || !meta.data || !meta.data[0]) return;
      const { x, y } = meta.data[0];
      const total = chart.data.datasets[0].data.reduce((a, b) => a + (+b || 0), 0);
      const ctx = chart.ctx;
      ctx.save();
      ctx.textAlign = "center";
      ctx.fillStyle = "#fff";
      ctx.font = `700 ${narrow ? 17 : 21}px 'JetBrains Mono', monospace`;
      ctx.fillText(fmt(total), x, y - 2);
      ctx.fillStyle = C.dim;
      ctx.font = `${narrow ? 10 : 12}px 'Outfit', system-ui, sans-serif`;
      ctx.fillText(o.unit || "total", x, y + (narrow ? 14 : 17));
      ctx.restore();
    },
  });
  if (REDUCED_MOTION) Chart.defaults.animation = false;
}

/* ── making a canvas chart mean something without sight ──
 * A canvas is a wall of silent pixels. This used to set role="img" with the
 * chart's title as the name, then write every value into the canvas's fallback
 * content — but role="img" makes an element's subtree PRESENTATIONAL, so that
 * fallback was never exposed to anything. Thirteen charts, all of them mute.
 *
 * Two things do work, and this does both:
 *   1. put the TAKEAWAY in the accessible name, so landing on the chart tells
 *      you what it says rather than only what it is called, and
 *   2. put the VALUES in a real table beside it, which a screen-reader user can
 *      navigate cell by cell — a flattened aria-description could not be read
 *      that way. */
const A11Y_MAX_ROWS = 120;
const cellNum = (v) => (typeof v === "number" ? v : v && typeof v.y === "number" ? v.y : Number(v));

/* A screen-reader-only data table. Used by the canvas charts and by the two
 * heat grids, which are otherwise hundreds of coloured divs carrying their
 * values in data-* attributes — and data-* is not exposed to assistive tech,
 * so every one of those numbers was unreachable.
 *
 * The .sr-only goes on a WRAPPER, never on the table. That class hides things
 * with width:1px;height:1px;overflow:hidden, which a display:table box simply
 * ignores — it sizes to its content regardless. Putting the class on the table
 * gave 281x386 boxes and 1,091px of horizontal page overflow. A block wrapper
 * collapses and clips properly, and leaves the table's semantics (and its role
 * in the accessibility tree) untouched. */
function srTable(caption, cols, rows) {
  return `<div class="sr-only"><table class="chart-data"><caption>${esc(caption)}</caption>
    <thead><tr>${cols.map((c) => `<th scope="col">${esc(String(c))}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((r) => `<tr><th scope="row">${esc(String(r[0]))}</th>${
      r.slice(1).map((c) => `<td>${esc(String(c))}</td>`).join("")}</tr>`).join("")}</tbody></table></div>`;
}

function chartA11y(cv, data, options, fallback) {
  const title = (options && options.plugins && options.plugins.title && options.plugins.title.text) || fallback;
  const labels = (data && data.labels) || [];
  const sets = ((data && data.datasets) || []).filter((d) => d && Array.isArray(d.data));

  // 1 — accessible name: title, then per-series total and peak
  const bits = [];
  for (const ds of sets) {
    const nums = ds.data.map(cellNum).filter((n) => isFinite(n));
    if (!nums.length) continue;
    // Diverging charts (friends gained vs lost) store one series negative.
    const total = nums.reduce((a, b) => a + Math.abs(b), 0);
    let hi = -Infinity, at = -1;
    nums.forEach((v, i) => { if (Math.abs(v) > hi) { hi = Math.abs(v); at = i; } });
    const when = labels[at] != null && labels[at] !== "" ? `, highest ${fmt(Math.round(hi))} at ${labels[at]}` : "";
    bits.push(`${sets.length > 1 && ds.label ? ds.label + " " : ""}${fmt(Math.round(total))} total${when}`);
  }
  cv.setAttribute("role", "img");
  cv.setAttribute("aria-label", bits.length
    ? `${title}. ${bits.join(". ")}. Full values follow in a table.`
    : String(title));

  // 2 — the navigable table, replaced wholesale on every refresh
  const host = cv.parentElement;
  if (!host) return;
  const old = host.querySelector("table.chart-data");
  if (old) (old.closest(".sr-only") || old).remove();   // drop the wrapper too, not just the table
  if (!labels.length || !sets.length) return;
  const xTitle = (options && options.scales && options.scales.x && options.scales.x.title && options.scales.x.title.text) || "Category";
  const shown = labels.slice(0, A11Y_MAX_ROWS);
  const note = labels.length > shown.length ? ` First ${shown.length} of ${labels.length} rows.` : "";
  const cols = [xTitle, ...sets.map((d, i) => d.label || "Series " + (i + 1))];
  const rows = shown.map((l, i) => [l, ...sets.map((d) => fmt(Math.round(Math.abs(cellNum(d.data[i])) || 0)))]);
  host.insertAdjacentHTML("beforeend", srTable(`${title} — data table.${note}`, cols, rows));
}

function newChart(id, cfg) {
  const cv = $(id);
  if (!cv) return;
  themeCharts();
  cfg.options = cfg.options || {};
  cfg.options.maintainAspectRatio = false;
  /* A ~260px phone canvas can't spend pixels on 14-16 rotated tick labels or a
   * y-axis title — derive the tick budget from the real width so labels stay
   * horizontal and the plot keeps the pixels. Desktop budgets are unchanged. */
  const xs = cfg.options.scales && cfg.options.scales.x;
  if (xs && cfg.options.indexAxis !== "y") {
    const w = (cv.parentElement && cv.parentElement.clientWidth) || cv.clientWidth || 600;
    xs.ticks = xs.ticks || {};
    xs.ticks.maxTicksLimit = Math.min(xs.ticks.maxTicksLimit || 14, Math.max(5, Math.floor(w / 56)));
    if (w && w < 340 && cfg.options.scales.y && cfg.options.scales.y.title) cfg.options.scales.y.title.display = false;
  }
  const fallback = (cfg.data && cfg.data.datasets && cfg.data.datasets[0] && cfg.data.datasets[0].label) || "Data chart";
  /* Line charts get an area fill fading out of their own stroke colour and an
   * emphasised final point — unless the chart already decided its own. */
  if (cfg.type === "line" && cfg.data && cfg.data.datasets) {
    cfg.data.datasets.forEach((ds) => {
      const col = typeof ds.borderColor === "string" ? ds.borderColor : null;
      if (!col) return;
      if (ds.fill === undefined) {
        ds.fill = true;
        ds.backgroundColor = (c) => {
          const area = c.chart.chartArea;
          if (!area) return "transparent";
          const g = c.chart.ctx.createLinearGradient(0, area.top, 0, area.bottom);
          g.addColorStop(0, alpha(col, .26)); g.addColorStop(1, alpha(col, 0));
          return g;
        };
      }
      if (ds.pointRadius === undefined)
        ds.pointRadius = (c) => (c.dataIndex === c.dataset.data.length - 1 ? 3.5 : 0);
      if (ds.pointBackgroundColor === undefined) ds.pointBackgroundColor = col;
    });
  }
  const ch = new Chart(cv, cfg);
  try { chartA11y(cv, ch.data, ch.options, fallback); } catch (e) { console.warn("chart a11y", e); }
  /* Charts that change in place — the year-over-year metric switcher — would
   * otherwise keep describing whichever metric happened to load first. */
  const update = ch.update.bind(ch);
  ch.update = (...a) => {
    const r = update(...a);
    try { chartA11y(cv, ch.data, ch.options, fallback); } catch (e) { console.warn("chart a11y", e); }
    return r;
  };
  CHARTS.push(ch);
  return ch;
}

/* ───────────────────────────── render ───────────────────────────── */
/* Destroy everything the last build created — charts, map, globe, and any
 * window-level listeners/observers the globe registered. Shared by rebuilds,
 * "Start over", and "Clear". Without this the WebGL render loop keeps
 * spinning at 60fps against a detached canvas. */
function teardown() {
  CHARTS.forEach((c) => { try { c.destroy(); } catch (e) {} });
  CHARTS = [];
  if (MAP) { try { MAP.remove(); } catch (e) {} MAP = null; }
  if (GLOBE) { try { GLOBE._destructor(); } catch (e) {} GLOBE = null; }
  GLOBE_CLEANUP.forEach((fn) => { try { fn(); } catch (e) {} });
  GLOBE_CLEANUP = [];
  if (COUNT_IO) { COUNT_IO.disconnect(); COUNT_IO = null; }
  if (SHELL_AC) { SHELL_AC.abort(); SHELL_AC = null; }
  /* Release the parsed export too. Clear and "Start over" used to tear down the
   * charts while leaving every aggregate — trail points, timestamps, fort and
   * gym maps, friend rows — alive in STATE, so the memory a user was trying to
   * clear stayed put until they happened to build again. build() calls this
   * first, so it gets its fresh state from here. */
  STATE = freshState();
}

/* Everything in RAW into STATE, one file at a time, its copies merged first
 * (see mergeCopies). The order comes from the files themselves — "1" journey
 * files before their "2" twins, since a twin's window has to be known first,
 * then by name — so the same files build the same report whatever order they
 * arrived in. Returns { unreadable: copies that could not be re-read }, or
 * null once `stale` says the user cleared part-way. */
async function parseRaw(onFile, stale = () => false) {
  const files = logicalFiles().filter((g) => g.copies.some((r) => !r.oversize && !r.container));
  files.sort((a, b) => pjOrder(a.name) - pjOrder(b.name) || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  const clocks = groupClocks(), unreadable = [];
  for (let i = 0; i < files.length; i++) {
    const g = files[i];
    if (onFile) await onFile(g, i, files.length);
    if (stale()) return null;
    const got = [];
    for (const r of g.copies) {
      if (r.oversize || r.container) continue;   // too large to read — already flagged in the list
      // On a rebuild the text was released after the last build; read it again
      // from the File handle the browser still holds.
      let text = r.text;
      if (text == null && r.file) { try { text = await r.file.text(); } catch (e) { unreadable.push(r.orig || r.name); continue; } }
      if (text != null) got.push({ r, text });
    }
    if (stale()) return null;   // cleared during the read
    if (!got.length) continue;
    const full = got.filter((c) => !EMPTY_FILE.test(c.text));
    const text = full.length > 1 ? await mergeCopies(g.name, rankCopies(full, clocks).map((c) => c.text)) : (full[0] || got[0]).text;
    if (stale()) return null;   // cleared while the copies were being merged
    await routeFile(g.name, text);
    if (stale()) return null;   // cleared while this file was being parsed
    // Release: the parsed aggregates in STATE are all we need, and holding
    // every file's text is the single largest retention in the app.
    for (const c of got) if (c.r.file) c.r.text = null;
  }
  return { unreadable };
}

async function build() {
  if (!RAW.length) return;
  // Files that arrive while a build runs wait for it and get one more build
  // after it. They used to be skipped outright, under a heading that already
  // counted them as added and their chapters as unlocked.
  if (BUILDING) { BUILD_AGAIN = true; return; }
  BUILDING = true;
  BUILD_AGAIN = false;
  const gen = DATA_GEN;
  const stale = () => gen !== DATA_GEN;
  // Abandoning a build must leave nothing behind: a file parsed in the moment
  // the user hit Clear would otherwise sit in the fresh STATE afterwards.
  const abort = () => { STATE = freshState(); };
  if (AUTO_BUILD_T) { clearTimeout(AUTO_BUILD_T); AUTO_BUILD_T = null; }
  if (PENDING_ZIP) PENDING_ZIP.buildHeld = false;   // everything in RAW is being built now
  const btn = $("build-btn");
  const btnLabel = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "Building…"; }
  const res = $("results");
  res.classList.remove("results-hidden");
  document.body.classList.remove("has-report");
  res.innerHTML = `<div class="empty-state"><div class="gl-spin" style="margin:0 auto 14px"></div>
    <p id="build-progress">${SAMPLE_DATA || window.DEMO_PAGE ? "Reading the sample export…" : "Reading your files…"}</p>
    <div class="build-bar" aria-hidden="true"><i id="build-bar-fill"></i></div></div>`;
  try {
    teardown(); // also resets STATE

    // Kick off the libraries this build will need while we parse. Each gets its
    // catch now: one that failed while the files were still parsing sat
    // unhandled until the Promise.all below reached it — a brief "Uncaught (in
    // promise)" in the console on every failed load.
    const libFail = (err) => { console.warn(err); };
    const libWaits = [ensureScript("vendor/chart-4.5.1.umd.min.js").catch(libFail)];

    // Yields between files; the big parsers additionally yield WITHIN a file
    // (see eachRow), which is what stops one 8.9MB CSV freezing the page.
    const prog = $("build-progress");
    const bar = $("build-bar-fill");
    const srcWord = SAMPLE_DATA || window.DEMO_PAGE ? "the sample export" : "your files";
    const parsed = await parseRaw(async (g, i, n) => {
      // determinate, not a bare spinner: "2 in or 12?" is the whole question
      const copies = g.copies.filter((r) => !r.oversize).length;
      if (prog) prog.textContent = `Reading ${g.name}${copies > 1 ? ` (${copies} copies)` : ""} (${i + 1} of ${n}, ${srcWord})…`;
      if (bar) bar.style.width = Math.round(((i + 1) / Math.max(1, n)) * 88) + "%";
      await nextTick(); // let the progress line paint without timer throttling
    }, stale);
    if (!parsed) return abort(); // the user cleared part-way through
    const unreadable = parsed.unreadable;
    if (unreadable.length) {
      showError("Couldn't re-read " + unreadable.map(esc).join(", ")
        + " — if the file moved or was deleted since you picked it, add it again.", true);
    }

    const needGeo = STATE.ev.geo.size > 0 || STATE.trail.length > 0;
    if (needGeo) {
      if (_webglOK()) libWaits.push(ensureScript("vendor/globe.gl-2.46.2.min.js").catch(libFail));
      else libWaits.push(ensureCSS("vendor/leaflet.css")
        .then(() => ensureScript("vendor/leaflet.js"))
        .then(() => ensureScript("vendor/leaflet-heat.js")).catch(libFail));
    }
    if (prog) prog.textContent = "Drawing your story…";
    if (bar) bar.style.width = "96%";
    await Promise.all(libWaits);
    if (stale()) return abort(); // cleared while libraries loaded — draw nothing

    res.innerHTML = "";

    if (!STATE.loaded.length) {
      // Blaming the user's files for what is actually a stale file handle is the
      // wrong story: if nothing could be re-read, say exactly that.
      res.innerHTML = unreadable.length
        ? `<div class="empty-state"><div class="es-icon">${window.ICON ? window.ICON("folder") : "📂"}</div>
          <h3 style="margin:10px 0 6px">Couldn't re-read your files</h3>
          <p>The export folder may have moved, been deleted, or been renamed since you picked it.
          Add ${unreadable.length === 1 ? esc(unreadable[0]) : "the files"} again to rebuild.</p></div>`
        : `<div class="empty-state"><div class="es-icon">${window.ICON ? window.ICON("search") : "🤔"}</div>
          <h3 style="margin:10px 0 6px">Nothing to visualize yet</h3>
          <p>None of those files had a story we can tell. Try adding files like <code>Gameplay.txt</code>,
          <code>FriendList.tsv</code>, or your <code>Player_Journey</code> folder.</p></div>`;
      res.scrollIntoView({ behavior: scrollBehavior() });
      return;
    }

    res.insertAdjacentHTML("beforeend", resHero());
    // lead with the trainer card → adventure log → year-over-year → world → social → money → body → tech
    // The globe is the most striking thing here, so it goes straight after the
    // trainer card rather than six chapters down where people never reach it.
    safe(renderTrainer);
    safe(renderWorld);
    safe(renderBag);
    safe(renderActivity);
    safe(renderRhythm);
    safe(renderRecentLog);
    safe(renderRecords);
    safe(renderYearOverYear);
    safe(renderCompare);
    safe(renderSocial);
    safe(renderCampfire);
    safe(renderSpending);
    safe(renderFitness);
    safe(renderPhotos);
    safe(renderLiveEvents);
    safe(renderSessions);
    safe(renderWayfarer);

    // chapter navigation — a rail beside the report on wide screens, a sticky
    // strip under the nav on narrow ones. Either way it tracks the chapter in
    // view, so the reader always knows where they are in a seventeen-panel report.
    const mods = [...res.querySelectorAll(".module")];
    if (mods.length >= 3) {
      const chips = mods.map((m, i) => {
        const h = m.querySelector(".mod-head h3");
        const icon = m.querySelector(".mod-icon");
        const t = h ? h.textContent.trim() : "Chapter";
        // Slug from the heading, EXCEPT where the heading carries the trainer's
        // name — "AshDemo at a glance" would mint a different anchor for every
        // player, and these ids are meant to be linkable.
        m.id = "ch-" + (m.dataset.anchor
          || t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
        return `<a class="ch-chip" href="#${m.id}" data-hue="${m.dataset.hue || "teal"}" style="--i:${i}">${icon ? icon.innerHTML : ""}<span class="ch-t">${esc(t)}</span><span class="ch-n">${String(i + 1).padStart(2, "0")}</span></a>`;
      }).join("");
      const playLabel = window.DEMO_PAGE ? "Play the example story" : "Play my story";
      res.querySelector(".res-hero").insertAdjacentHTML("afterend",
        `<nav class="chapter-nav chapter-rail" aria-label="Chapters">
           <div class="rail-head">${mods.length} chapters</div>
           <button class="rail-mode" type="button" aria-pressed="false" title="Read one chapter at a time">${window.ICON ? window.ICON("square") : ""}<span class="ch-t">One at a time</span></button>
           ${chips}
           <button class="btn btn-primary rail-play" type="button">${window.ICON ? window.ICON("play") : "▶"} ${playLabel}</button>
         </nav>`);
      /* Chapter grammar: the landing numbers its sections and the Trainer Model
       * eyebrows its chapters, but the actual product's chapters had neither.
       * Numbered here, after assembly, so the count is right whatever subset of
       * files was uploaded. */
      mods.forEach((m, i) => {
        const head = m.querySelector(".mod-head");
        if (head && !m.querySelector(".mod-eyebrow"))
          head.insertAdjacentHTML("beforebegin", `<div class="mod-eyebrow">Chapter ${String(i + 1).padStart(2, "0")}</div>`);
      });
    }

    res.insertAdjacentHTML("beforeend", outro());
    shellReport(res, mods);

    // wire up post-render bits (charts/maps were referenced by id)
    POST.forEach((fn) => { try { fn(); } catch (e) { console.warn(e); } });
    POST = [];

    wireToolbar();
    wireCountUps(res);
    // The demo page's hero CTA can only work once STATE is populated — enabling
    // it here avoids opening a one-slide story over an empty build.
    /* December is Wrapped season — surface the year story while it's the moment */
    const seasonNow = new Date();
    if (seasonNow.getMonth() === 11) {
      const y = String(seasonNow.getFullYear());
      if (Object.keys(STATE.ev.byMonth).some((m) => m.startsWith(y))) {
        const heroEl = res.querySelector(".res-hero");
        if (heroEl) {
          heroEl.insertAdjacentHTML("beforeend",
            `<div class="season-banner"><span aria-hidden="true">🎁</span> Your ${y}, wrapped —
             <button class="linkish" id="season-play" type="button">play ${y}'s story</button></div>`);
          const sp = $("season-play");
          if (sp) sp.onclick = () => storyMode(y);
        }
      }
    }
    fetchCohortRank();
    const demoCta = $("demo-story-cta");
    if (demoCta) {
      demoCta.disabled = false; demoCta.onclick = () => storyMode();
      announce(`Example ready: ${res.querySelectorAll(".module").length} chapters.`);
    }
    /* The tab strip should say which tab holds the journey — this app asks
     * people to keep the tab open, since a report can't be deep-linked. */
    if (!window.DEMO_PAGE) {
      const who = STATE.profile && STATE.profile.username;
      // a tab title is plain text, not HTML — escaping it would print "&amp;"
      document.title = `${who ? who + "'s" : "Your"} journey — POGO Metrics`;
    }
    /* Move focus and scroll to the freshly built story — but ONLY when the user
     * asked for a build. On metrics.html they pressed a button and expect to be
     * taken to the result. The live-example page builds itself on load, so the
     * same two lines fired ~3s after arrival and yanked the page out from under
     * someone mid-sentence, stealing focus from anyone already tabbing. That is
     * a change the user never requested, which is the WCAG distinction.
     * The heading still gets tabindex so it remains a focus target. */
    const hero = res.querySelector(".res-hero h2");
    if (hero) hero.setAttribute("tabindex", "-1");
    if (!window.DEMO_PAGE) {
      if (hero) { try { hero.focus({ preventScroll: true }); } catch (e) {} }
      res.scrollIntoView({ behavior: scrollBehavior() });
    }
    gotoChapterFromHash();
    // Live Example only — see the note in js/nav.js on why metrics.html
    // deliberately gets no copy-link affordance.
    if (window.DEMO_PAGE && window.linkifyHeadings) window.linkifyHeadings("#results .module > .mod-head h3");
  } finally {
    BUILDING = false;
    POST = [];
    if (btn) { btn.disabled = false; btn.textContent = btnLabel; }
    if (BUILD_AGAIN) {
      BUILD_AGAIN = false;
      // a password panel that came up meanwhile holds it, like any auto-build
      if (PENDING_ZIP) PENDING_ZIP.buildHeld = true; else build();
    }
  }
}
/* Deep links into a chapter — e.g. /demo.html#ch-your-world-in-3d.
 *
 * The chapters don't exist when the browser resolves the fragment: this page
 * parses an export first and mints the ids at the end of build(). The browser
 * looks once, finds nothing, and never looks again — so every chapter anchor
 * was share-proof until this ran the lookup a second time, after the build.
 *
 * Deliberately narrow. It only fires for ids this function just created, so a
 * hash aimed at static markup (#request, #datasets) still resolves the ordinary
 * way and isn't scrolled twice. Focus moves with the scroll, or a keyboard user
 * lands at the chapter visually and at the top of the document in fact. */
function gotoChapterFromHash() {
  // A hand-edited or truncated link can carry a broken %-escape, and
  // decodeURIComponent throws on one — treat that as no chapter at all.
  let id = "";
  try { id = decodeURIComponent(location.hash.slice(1)); } catch (e) { return; }
  if (!/^ch-[a-z0-9-]+$/.test(id)) return;
  const el = document.getElementById(id);
  if (!el) return;
  el.setAttribute("tabindex", "-1");
  // rAF: the charts above it are still being laid out, and scrolling to a
  // position that is about to move puts the reader in the wrong place.
  requestAnimationFrame(() => {
    el.scrollIntoView({ behavior: scrollBehavior(), block: "start" });
    try { el.focus({ preventScroll: true }); } catch (e) {}
  });
}

let POST = [];
function later(fn) { POST.push(fn); }
function safe(fn) { try { const html = fn(); if (html) $("results").insertAdjacentHTML("beforeend", html); } catch (e) { console.warn(fn.name, e); } }

/* ── report shell ─────────────────────────────────────────────────────────
   Turns the flat run of panels into an application layout: the chapter rail
   sits beside the report and follows the scroll (a sticky strip on phones),
   panels fade up as they arrive, and a floating Play button follows phone
   readers once the masthead has scrolled away. All of it is additive — the
   panels themselves are untouched, so every chart, anchor and share card
   keeps working exactly as before. */
let SHELL_AC = null;
function shellReport(res, mods) {
  document.body.classList.add("has-report");
  const hero = res.querySelector(".res-hero");
  const rail = res.querySelector(".chapter-rail");
  // Everything that is not the masthead or the rail becomes the report body,
  // which is what lets the rail take its own grid column on wide screens.
  const body = document.createElement("div");
  body.className = "report-body";
  [...res.children].filter((c) => c !== hero && c !== rail).forEach((c) => body.appendChild(c));
  res.appendChild(body);

  if (SHELL_AC) SHELL_AC.abort();
  SHELL_AC = new AbortController();
  const sig = { signal: SHELL_AC.signal, passive: true };

  // rail play button — the toolbar's #story-btn is wired by wireToolbar
  const rp = rail && rail.querySelector(".rail-play");
  if (rp) rp.addEventListener("click", () => storyMode(), sig);

  // scroll-spy: the last chapter whose top has passed the nav is the current one
  if (rail && mods.length) {
    const links = mods.map((m) => rail.querySelector(`a[href="#${m.id}"]`));
    let cur = -1, tick = false;
    const mark = (i) => {
      if (cur >= 0 && links[cur]) { links[cur].classList.remove("cur"); links[cur].removeAttribute("aria-current"); }
      cur = i;
      const a = links[cur];
      if (!a) return;
      a.classList.add("cur"); a.setAttribute("aria-current", "true");
      if (rail.scrollWidth > rail.clientWidth + 6)
        rail.scrollTo({ left: a.offsetLeft - (rail.clientWidth - a.offsetWidth) / 2, behavior: scrollBehavior() });
      else if (rail.scrollHeight > rail.clientHeight + 6)
        rail.scrollTo({ top: a.offsetTop - rail.clientHeight / 2 + a.offsetHeight / 2, behavior: scrollBehavior() });
    };

    /* ── reader mode: one chapter at a time ──
       A phone reader faces ~28,000px of report. In reader mode only the
       current chapter is shown, with previous/next at its foot; the rail
       switches chapters instead of scrolling to them. Charts are re-measured
       on every switch because a canvas laid out while hidden has no size. */
    let READER = false, RCUR = 0;
    const navH = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue("--nav-h")) || 80;
    const readerNav = document.createElement("div");
    readerNav.className = "reader-nav";
    body.appendChild(readerNav);
    const remeasure = () => requestAnimationFrame(() => {
      CHARTS.forEach((c) => { try { c.resize(); } catch (e) {} });
      if (MAP) { try { MAP.invalidateSize(); } catch (e) {} }
      dispatchEvent(new Event("resize"));
    });
    const I = (n) => (window.ICON ? window.ICON(n) : "");
    const setChapter = (i, scroll) => {
      RCUR = Math.max(0, Math.min(mods.length - 1, i));
      mods.forEach((m, j) => m.classList.toggle("cur-ch", j === RCUR));
      mods[RCUR].classList.add("in");
      document.body.classList.toggle("last-ch", RCUR === mods.length - 1);
      const t = (m) => { const h = m.querySelector(".mod-head h3"); return h ? h.childNodes[0].textContent.trim() : "Chapter"; };
      readerNav.innerHTML = `
        <button class="btn btn-ghost rn-prev" type="button" ${RCUR === 0 ? "disabled" : ""}>${I("left")} <span>${RCUR > 0 ? esc(t(mods[RCUR - 1])) : "Start"}</span></button>
        <span class="rn-pos">${String(RCUR + 1).padStart(2, "0")} / ${String(mods.length).padStart(2, "0")}</span>
        <button class="btn btn-teal rn-next" type="button" ${RCUR === mods.length - 1 ? "disabled" : ""}><span>${RCUR < mods.length - 1 ? esc(t(mods[RCUR + 1])) : "The end"}</span> ${I("right")}</button>`;
      readerNav.querySelector(".rn-prev").onclick = () => setChapter(RCUR - 1, true);
      readerNav.querySelector(".rn-next").onclick = () => setChapter(RCUR + 1, true);
      mark(RCUR);
      try { history.replaceState(null, "", "#" + mods[RCUR].id); } catch (e) {}
      if (scroll) window.scrollTo({ top: body.getBoundingClientRect().top + scrollY - navH() - 10, behavior: scrollBehavior() });
      remeasure();
    };
    const setReader = (on) => {
      READER = !!on;
      document.body.classList.toggle("reader-mode", READER);
      const btn = rail.querySelector(".rail-mode");
      if (btn) {
        btn.setAttribute("aria-pressed", String(READER));
        btn.title = READER ? "Show every chapter" : "Read one chapter at a time";
        btn.innerHTML = `${I(READER ? "rows" : "square")}<span class="ch-t">${READER ? "Show all" : "One at a time"}</span>`;
      }
      if (READER) setChapter(cur >= 0 ? cur : 0, true);
      else {
        mods.forEach((m) => m.classList.remove("cur-ch"));
        document.body.classList.remove("last-ch");
        remeasure();
        const m = mods[RCUR];
        if (m) requestAnimationFrame(() => window.scrollTo({ top: m.getBoundingClientRect().top + scrollY - navH() - 10, behavior: "auto" }));
      }
      announce(READER ? "Reading one chapter at a time." : "Showing every chapter.");
    };
    const modeBtn = rail.querySelector(".rail-mode");
    if (modeBtn) modeBtn.addEventListener("click", () => setReader(!READER), sig);
    // Not `sig`: that one is passive, for scroll and resize, and a passive
    // listener can't preventDefault() — Chrome ignores the call and logs an error.
    links.forEach((a, i) => a && a.addEventListener("click", (e) => {
      if (!READER) return;
      e.preventDefault();
      setChapter(i, true);
    }, { signal: SHELL_AC.signal }));

    const spy = () => {
      tick = false;
      if (READER) return;
      const line = navH() + 140;
      let i = mods.findIndex((m) => m.getBoundingClientRect().top > line) - 1;
      if (i < -1) i = mods.length - 1;                  // past the last one
      if (i < 0 && mods[0].getBoundingClientRect().top <= innerHeight * .6) i = 0;
      if (i === cur) return;
      mark(i);
    };
    const onScroll = () => { if (!tick) { tick = true; requestAnimationFrame(spy); } };
    addEventListener("scroll", onScroll, sig);
    addEventListener("resize", onScroll, sig);
    requestAnimationFrame(spy);
  }

  // reveal: panels fade up as they enter, once — never for reduced motion.
  // A timer shows anything an observer never got to, so nothing can stay hidden.
  if (!REDUCED_MOTION && "IntersectionObserver" in window) {
    const io = new IntersectionObserver((ents) => {
      ents.forEach((en) => { if (en.isIntersecting) { en.target.classList.add("in"); io.unobserve(en.target); } });
    }, { rootMargin: "0px 0px -6% 0px", threshold: 0.02 });
    mods.forEach((m) => {
      // a panel already on screen at build time must not blink in
      if (m.getBoundingClientRect().top < innerHeight) return;
      m.classList.add("reveal"); io.observe(m);
    });
    const fallback = setTimeout(() => mods.forEach((m) => m.classList.add("in")), 2500);
    SHELL_AC.signal.addEventListener("abort", () => { io.disconnect(); clearTimeout(fallback); });
  }

  /* stat grids: pick the column count whose last row is fullest, so no row
     ends with one or two orphaned tiles. A small penalty for fewer columns
     keeps nine tiles at 5 + 4 rather than three rows of three. */
  const balance = () => {
    res.querySelectorAll(".stat-grid").forEach((g) => {
      const n = g.children.length;
      const w = g.clientWidth || 900;
      const maxCols = Math.min(5, Math.floor((w + 10) / 182));
      if (n < 4 || maxCols < 3) { g.classList.remove("balanced"); g.style.removeProperty("--cols"); return; }
      let best = maxCols, bestScore = -1;
      for (let c = maxCols; c >= 3; c--) {
        const r = n % c;
        const score = (r === 0 ? 1 : r / c) - (maxCols - c) * 0.12;
        if (score > bestScore + 1e-9) { bestScore = score; best = c; }
      }
      g.style.setProperty("--cols", best);
      g.classList.add("balanced");
    });
  };
  balance();
  addEventListener("resize", balance, sig);
  SHELL_AC.signal.addEventListener("abort", () => res.querySelectorAll(".stat-grid.balanced").forEach((g) => g.classList.remove("balanced")));

  mountUploadStrip();

  // floating Play for phones, shown once the masthead's own button is gone
  if (hero && "IntersectionObserver" in window) {
    const fab = document.createElement("button");
    fab.type = "button"; fab.className = "fab-play";
    fab.innerHTML = `${window.ICON ? window.ICON("play") : "▶"}<span>${window.DEMO_PAGE ? "Play the story" : "Play my story"}</span>`;
    fab.addEventListener("click", () => storyMode(), sig);
    res.appendChild(fab);
    const fio = new IntersectionObserver((ents) => {
      fab.classList.toggle("on", !ents[0].isIntersecting && ents[0].boundingClientRect.top < 0);
    }, { threshold: 0 });
    fio.observe(hero);
    SHELL_AC.signal.addEventListener("abort", () => fio.disconnect());
  }
}

/* ── upload page, once a report exists ──
   The dropzone, the console and their copy used to stay above the masthead
   for the life of the report. Now they fold into one strip — the counts, Add
   more, and a toggle that brings the full picker and console back. */
function mountUploadStrip() {
  const sec = $("upload-section");
  if (!sec) return;
  let strip = sec.querySelector(".up-strip");
  if (!strip) { strip = document.createElement("div"); strip.className = "up-strip"; sec.prepend(strip); }
  const chartable = (window.CATALOG || []).filter((c) => c.story);
  const unlocked = chartable.filter((c) => RAW.some((r) => c.match.test(r.name) && !r.oversize && !r.empty && !r.unreadable)).length;
  const I = (n) => (window.ICON ? window.ICON(n) : "");
  const open = sec.classList.contains("up-open");
  const shown = visibleFiles(), merged = mergeSummary();
  strip.innerHTML = `<div class="us-sum">${I("folder")}<span><b>${shown}</b> file${shown === 1 ? "" : "s"} added${merged ? ` · ${esc(merged)}` : ""} · <b>${unlocked} of ${chartable.length}</b> chapters unlocked</span></div>
    <div class="us-act">
      <button class="btn btn-teal" type="button" id="us-add">${I("plus")} Add more files</button>
      <button class="btn btn-ghost" type="button" id="us-more" aria-expanded="${open}">${I(open ? "rows" : "list")} ${open ? "Hide files & console" : "Files & console"}</button>
    </div>`;
  strip.querySelector("#us-add").addEventListener("click", () => { const b = $("browse-btn"); if (b) b.click(); });
  strip.querySelector("#us-more").addEventListener("click", (e) => {
    const on = sec.classList.toggle("up-open");
    e.currentTarget.setAttribute("aria-expanded", String(on));
    e.currentTarget.innerHTML = `${I(on ? "rows" : "list")} ${on ? "Hide files & console" : "Files & console"}`;
  });
}

function resHero() {
  const p = STATE.profile;
  const name = p && p.username ? esc(p.username) : "Your";
  const who = p && p.username ? `${name}’s` : "Your";
  const e = STATE.ev;
  let range = "";
  if (e.first && e.last) range = `${fmtDate(e.first)} → ${fmtDate(e.last)}`;
  else if (p && p.startYear) range = `Trainer since ${p.startYear}`;
  const chapters = STATE.loaded.length;
  const intro = window.DEMO_PAGE
    ? `This is a live example built from a fully anonymized sample export — the exact same charts your own files would produce.`
    : `${range ? esc(range) + " · " : ""}${chapters} chapter${chapters > 1 ? "s" : ""} built from your export. Screenshot any card to share it.`;
  // The live-example page keeps its header CTAs, so its toolbar carries only
  // the story button; the real app gets the full set. The label matches the
  // header button and the intro copy that points at it — the story isn't
  // "mine" on a page built from someone invented.
  const I = (n) => (window.ICON ? window.ICON(n) : "");
  const toolbar = window.DEMO_PAGE
    ? `<div class="res-toolbar">
       <button class="btn btn-primary" id="story-btn" type="button">${I("play")} Play the example story</button>
     </div>`
    : `<div class="res-toolbar">
       <button class="btn btn-primary" id="story-btn" type="button">${I("play")} Play my story</button>
       <button class="btn btn-teal" id="journey-btn" type="button">${I("download")} Journey card</button>
       <button class="btn btn-ghost" id="json-btn" type="button" aria-expanded="false" aria-controls="numbers-panel">${I("receipt")} My numbers</button>
       <button class="btn btn-ghost" id="poster-btn" type="button">${I("image")} Poster</button>
       <button class="btn btn-teal" id="addmore-btn" type="button">${I("plus")} Add more files</button>
       <button class="btn btn-ghost" id="restart-btn" type="button">${I("rotate")} Start over</button>
     </div>`;
  // masthead: a trainer identity block instead of a centred heading — the
  // report is about a person, and the page should open the way a profile does
  const initial = p && p.username ? esc(String(p.username).trim().charAt(0).toUpperCase()) : I("user");
  const meta = [];
  if (p && p.level) meta.push(`${I("award")} Level ${fmt(p.level)}`);
  if (p && p.startYear) meta.push(`${I("calendar")} Trainer since ${esc(p.startYear)}`);
  if (e.days && e.days.size) meta.push(`${I("activity")} ${fmt(e.days.size)} days played`);
  meta.push(`${I("list")} ${chapters} chapter${chapters > 1 ? "s" : ""}`);
  const mks = monthSpan(Object.keys(e.byMonth || {}));
  const series = mks.map((mk) => Object.values(e.byMonth[mk] || {}).reduce((a, b) => a + b, 0));
  const spark = series.length > 2
    ? `<div class="rh-spark">${sparkSVG(series, "rh")}<span class="rh-spark-l">Actions per month · ${fmtMonth(mks[0])} → ${fmtMonth(mks[mks.length - 1])}</span></div>`
    : "";
  return `<div class="res-hero">
    <div class="rh-id">
      <div class="rh-avatar" aria-hidden="true">${initial}</div>
      <div class="rh-text">
        <div class="eyebrow">${window.DEMO_PAGE ? "Live example · sample data" : "Your Pokémon GO metrics"}</div>
        <h2>${who} journey, visualized</h2>
        <p>${intro}</p>
        <div class="rh-meta">${meta.map((m) => `<span>${m}</span>`).join("")}</div>
        ${spark}
      </div>
    </div>
    ${toolbar}
    ${window.DEMO_PAGE ? "" : numbersPanel(I)}
  </div>`;
}
/* "My numbers" opens this instead of saving straight away: the file for a
 * friend and the file for yourself carry very different things, and each
 * says what it holds before anything is saved. */
function numbersPanel(I) {
  return `<div class="numbers-panel" id="numbers-panel" hidden>
      <div class="np-card">
        <h4>${I("share")} Compare file — for a friend</h4>
        <p>Holds your trainer name, your action totals, your actions per month and per day, and your friend count.
          Nothing else: no locations, no spending, no devices, no steps. Your friend adds it next to their own
          export and gets a side-by-side chapter.</p>
        <button class="btn btn-teal" id="compare-btn" type="button">${I("share")} Send my compare file</button>
      </div>
      <div class="np-card personal">
        <h4>${I("lock")} Full stats — just for you</h4>
        <p>Everything the report counted except locations: your profile, real-money spending, devices,
          daily steps, your hour-by-hour play pattern and more. It's personal — keep it, don't share it.</p>
        <button class="btn btn-ghost" id="stats-btn" type="button">${I("download")} Download my full stats</button>
      </div>
    </div>`;
}
function wireToolbar() {
  const a = $("addmore-btn"), r = $("restart-btn");
  const st = $("story-btn"), jc = $("journey-btn"), js = $("json-btn");
  if (st) st.onclick = () => storyMode();
  if (jc) {
    if (Object.keys(STATE.ev.dayCounts).length) jc.onclick = () => downloadJourneyCard(jc);
    else jc.style.display = "none"; // needs Player_Journey data to mean anything
  }
  const panel = $("numbers-panel");
  if (js && panel) {
    js.onclick = () => {
      panel.hidden = !panel.hidden;
      js.setAttribute("aria-expanded", String(!panel.hidden));
    };
    const cb = $("compare-btn"), sb = $("stats-btn");
    if (cb) cb.onclick = () => shareCompareFile();
    if (sb) sb.onclick = () => downloadStatsJSON();
  }
  const po = $("poster-btn");
  if (po) {
    if (Object.keys(STATE.ev.dayCounts).length) po.onclick = () => downloadPoster(po);
    else po.style.display = "none"; // the poster is built from the daily ledger
  }
  if (a) a.onclick = () => $("upload-section").scrollIntoView({ behavior: scrollBehavior() });
  if (r) r.onclick = () => {
    // two-tap confirm — a mis-tap here would throw away minutes of file-picking
    if (!r.dataset.armed) {
      r.dataset.armed = "1";
      r.textContent = "⚠ Really start over?";
      setTimeout(() => { if (r.isConnected) { delete r.dataset.armed; r.innerHTML = (window.ICON ? window.ICON("rotate") : "↺") + " Start over"; } }, 4000);
      return;
    }
    teardown();
    RAW = []; DATA_GEN++;
    hideUnlock();
    renderDetected();
    clearError();
    $("results").classList.add("results-hidden");
    $("results").innerHTML = "";
    document.body.classList.remove("has-report");
    $("upload-section").scrollIntoView({ behavior: scrollBehavior() });
  };
}
/* The handoff to the research layer. A reader who has just watched their own
   journey build is the best-qualified audience the Trainer Model will ever get,
   and two of the numbers its benchmark asks for are ones this page just worked
   out. Printed rather than passed in a URL: the rest of the site keeps personal
   figures out of links, and this is no exception. */
function modelHandoff() {
  const p = STATE.profile || {};
  // Only lifetime figures are quoted here. The catch and battle counts this
  // page derives come from the Player_Journey logs, which cover a recent window
  // — the Trainer Model compares lifetime totals, so putting the two side by
  // side would invite a comparison neither number supports.
  // When the numbers came from the sample export they belong to a made-up
  // trainer, so the second person is a lie: the page says "no real person's
  // information is shown here" two screens up, and must not then hand the
  // reader a sample level as their own to carry into the benchmark. The whole
  // sentence changes, not just the figures — the question is written to follow
  // them, and left alone it points at nothing.
  const bits = SAMPLE_DATA ? [] : [
    p.level ? `level ${fmt(p.level)}` : "",
    p.distanceWalkedKm ? `${fmt(Math.round(p.distanceWalkedKm))} km walked` : "",
  ].filter(Boolean);
  const opener = SAMPLE_DATA
    ? `<b>How would your own numbers compare?</b> `
    : `<b>How does that compare to everyone else?</b> ${bits.length
        ? `Your trainer card says <b>${bits.join(" · ")}</b>. ` : ""}`;
  return `<div class="notice" style="margin-top:12px">
    ${opener}The Trainer Model plots 493 real
    trainers against today's level cap — <a href="trainer-model.html#standing">see where you stand
    →</a> (it also wants your lifetime catches and battles, which are on your in-game profile
    rather than in the export).</div>`;
}

function outro() {
  if (window.DEMO_PAGE) {
    return `<div class="notice" style="margin-top:30px">
      <b>Like what you see?</b> This whole page was built from a sample export — yours would be built
      from your real journey. <a href="metrics.html">Build yours →</a> or
      <a href="index.html#request">request your data in-game first</a>.</div>` + modelHandoff();
  }
  // tell the player exactly which chapters their remaining files would unlock
  const locked = (window.CATALOG || []).filter((c) =>
    c.story && !RAW.some((r) => c.match.test(r.name))).slice(0, 3);
  const more = locked.length
    ? `<div style="margin-top:10px">${locked.map((c) =>
        `<span class="locked-chip">${c.icon} <code>${esc(c.id)}</code> unlocks <b>${esc(c.name)}</b></span>`).join("")}
      <div style="margin-top:8px"><a href="/#datasets">See what's in your export →</a></div></div>`
    : "";
  // The reminder is for a player's own export, never the invented sample trainer
  // that metrics.html?demo=1 builds on the real page (demo.html returns above).
  return `<div class="notice" style="margin-top:30px">
    <b>That's your story — for now.</b> Add more files above to unlock new chapters of your journey.${more}</div>`
    + (SAMPLE_DATA ? "" : exportAgain()) + modelHandoff();
}

/* ── export again: a 60-day reminder ──
 * The files that remember least roll off fastest — the GPS trail keeps about
 * two months, fitness about three weeks — and the earlier exports keep what
 * each newer one has since let go, so dropped in together they make the
 * longest history. So the report ends by offering a reminder to request the
 * next one: a plain .ics built on this device, exactly like the landing page's
 * 7-day reminder. No calendar service, no request. */
// the reminder's own words, as iCalendar text (its commas escaped)
const AGAIN_ICS = "The GPS trail in an export keeps about two months and fitness about three weeks. Request a fresh export in the game"
  + "\\, then drop it in with your earlier ones — they keep what each newer one has since let go\\, so together they make the longest history:"
  + " https://pogo-metrics.netlify.app/metrics.html";
function exportAgain() {
  later(() => {
    const b = $("again-ics");
    if (b) b.addEventListener("click", () => downloadICS("Request a fresh Pokémon GO data export",
      daysFromToday(60), "pogo-metrics-export-again.ics",
      AGAIN_ICS));
  });
  const I = (n) => (window.ICON ? window.ICON(n) : "");
  return `<div class="notice again" style="margin-top:12px">
    <p class="again-copy"><b>Export again in 60 days.</b> An export only remembers so much: its GPS trail keeps about two months
      and its fitness log about three weeks. Your earlier exports keep what each newer one has since let go, so drop them all
      in together for the longest history.</p>
    <button class="btn btn-ghost" id="again-ics" type="button">${I("calendar")} Get my 60-day reminder</button>
  </div>`;
}

/* ── story mode: a Wrapped-style, full-screen tappable recap built from STATE ── */
/* ── trainer archetype: the "listening personality" move. Pure arithmetic over
   aggregates already in STATE — each candidate's score is (their value /
   a rough "this defines you" bar), and the strongest identity wins. The bars
   are editorial, not statistics: they only have to rank ONE trainer's own
   tendencies against each other. ── */
function trainerArchetype() {
  const e = STATE.ev;
  const total = Object.values(e.totals).reduce((a, b) => a + b, 0);
  if (!total) return null;
  const share = (k) => (e.totals[k] || 0) / total;
  const local = e.hourweekLocal;   // each moment on the viewer's clock as it read then
  let night = 0, all = 0;
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) { all += local[d][h]; if (h >= 22 || h < 4) night += local[d][h]; }
  const km = Object.values(STATE.fitness.daily).reduce((a, d) => a + (d.meters || 0), 0) / 1000;
  const streak = longestStreak(Object.keys(e.dayCounts));
  const cands = [
    ["The Raid Boss", "⚔️", share("Raids") / 0.18, "raids first, questions later", [C.red, C.orange]],
    ["The Night Owl", "🦉", (all ? night / all : 0) / 0.22, "the map belongs to you after dark", [C.purple, C.blue]],
    ["The Globe-Trotter", "🌍", Math.max(e.geo.size / 900, (e.raidMaxKm || 0) / 14000), "your journey spans the actual globe", [C.blue, C.teal]],
    ["The Socialite", "🤝", STATE.friends.rows.length / 160, "the friends list IS the game", [C.pink, C.purple]],
    ["The Marathoner", "🏃", km / 3000, "kilometres are your real currency", [C.green, C.teal]],
    ["The Photographer", "📸", (STATE.photos.total || 0) / 450, "you stop to shoot what others run past", [C.yellow, C.pink]],
    ["The Ever-Present", "🔥", streak / 130, "day after day, without missing one", [C.orange, C.yellow]],
    ["The Patron", "💎", (STATE.spend.coinsBought || 0) / 350000, "you back the habit properly", [C.yellow, C.orange]],
    ["The Collector", "🎯", (catchesOf(e.totals) / total) / 0.45, "if it spawns, you find it", [C.teal, C.yellow]],
    ["The Spin Doctor", "🌀", share("Spins") / 0.35, "every stop on the map, spun", [C.blue, C.teal]],
  ];
  cands.sort((a, b) => b[2] - a[2]);
  const [name, emoji, score, line, grads] = cands[0];
  if (!(score > 0.5)) return { name: "The All-Rounder", emoji: "🧭", line: "a bit of everything, mastered patiently", grads: [C.teal, C.yellow] };
  return { name, emoji, line, grads };
}

/* Wrapped's signature stat, from data the site already ships: where this
 * trainer stands in the Trainer Model's real cohort. Lazy, cached, and
 * fire-and-forget — the chip and story slide appear when it lands. */
let COHORT_LEVELS = null;
async function fetchCohortRank() {
  const lv = STATE.profile && STATE.profile.level;
  if (!lv) return;
  try {
    if (!COHORT_LEVELS) {
      const r = await fetch("data/trainer-model/era2.json");
      if (!r.ok) return;
      const j = await r.json();
      COHORT_LEVELS = (j.trainers || []).map((t) => t.level).filter((n) => isFinite(n)).sort((a, b) => a - b);
    }
    if (!COHORT_LEVELS.length) return;
    const below = COHORT_LEVELS.filter((l) => l < lv).length;
    const pct = Math.round((below / COHORT_LEVELS.length) * 100);
    STATE.cohortPct = { pct, n: COHORT_LEVELS.length, level: lv };
    const sub = document.querySelector('.module[data-anchor="trainer-card"] .mod-sub, #ch-trainer-card .mod-sub');
    if (sub) sub.insertAdjacentHTML("beforeend",
      ` <b>Level ${lv} — ahead of ${pct}% of ${fmt(COHORT_LEVELS.length)} real trainers.</b> <a href="trainer-model.html#standing">See where you stand →</a>`);
  } catch (e) { /* the model link still covers this */ }
}

/* Slides for the full journey, or — given a year — that year alone. The
 * year-over-year cards each get a "Play <year>" button that reuses this whole
 * overlay: same gradients, count-ups and a11y, different data slice. */
function storySlides(year) {
  const e = STATE.ev, s = [];
  const yr = year ? String(year) : null;
  const inYear = (iso) => !yr || iso.startsWith(yr);
  const dayKeys = Object.keys(e.dayCounts).filter(inYear).sort();
  // lifetime uses the parser's totals; a year sums its own months
  const kinds = yr
    ? Object.keys(e.byMonth).filter((m) => m.startsWith(yr)).reduce((acc, m) => {
        for (const k of Object.keys(e.byMonth[m])) acc[k] = (acc[k] || 0) + e.byMonth[m][k];
        return acc;
      }, {})
    : e.totals;
  const total = Object.values(kinds).reduce((a, b) => a + b, 0);
  const sumMonthly = (obj) => !obj ? 0 : Object.keys(obj).filter(inYear).reduce((a, k) => a + obj[k], 0);
  const who = (STATE.profile && STATE.profile.username) || (window.DEMO_PAGE ? "AshDemo" : "Trainer");
  s.push(yr
    ? { kicker: `POGO METRICS · ${yr}`, big: esc(who), label: `this was your ${yr}`, grad: 0 }
    : { kicker: "POGO METRICS PRESENTS", big: esc(who), label: "this is your story", grad: 0 });
  if (dayKeys.length) {
    if (yr) s.push({ kicker: "THE YEAR IN DAYS", num: dayKeys.length, label: `days you played in ${yr}`, grad: 1 });
    else {
      const daysSince = Math.round((Date.now() - new Date(dayKeys[0] + "T00:00:00Z")) / 86400000);
      s.push({ kicker: "DAY ONE", big: fmtDate(parseTS(dayKeys[0])), label: `${fmt(daysSince)} days ago, your log begins`, grad: 1 });
    }
  }
  if (total) s.push({ kicker: yr ? `YOUR ${yr}` : "SINCE THEN", num: total, label: yr ? `actions logged in ${yr}` : "actions in the game's log — every spin, encounter, raid and battle the game wrote down", grad: 2 });
  // encounters, not catches — see catchesOf
  const met = catchesOf(kinds);
  if (met) s.push({ kicker: "WILD ENCOUNTERS", num: met, label: `Pokémon encountered${yr ? ` in ${yr}` : " in the logs — on the map, from incense and lures, and through GO Plus"}`, grad: 3 });
  let bigDay = null, bigN = 0;
  for (const d of dayKeys) if (e.dayCounts[d] > bigN) { bigN = e.dayCounts[d]; bigDay = d; }
  if (bigDay) s.push({ kicker: yr ? `${yr}'S BIGGEST DAY` : "YOUR BIGGEST DAY", num: bigN, label: `actions on ${fmtDate(parseTS(bigDay))}${eventFor(bigDay) ? " — " + eventFor(bigDay) : ""}`, grad: 4 });
  if (!yr) {
    // busiest slot in the VIEWER'S clock — "your hour" should feel like their life, not UTC —
    // each moment on its own local hour, so winter and summer agree across a clock change
    const local = e.hourweekLocal;
    let bd = 0, bh = 0, bn = 0;
    for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) if (local[d][h] > bn) { bn = local[d][h]; bd = d; bh = h; }
    if (bn) s.push({ kicker: "YOUR HOUR", big: `${DAY_FULL[bd]}s, ${hourLabel(bh)}`, label: "when you play the most, in your local time", grad: 5 });
    if (e.geo.size) s.push({ kicker: "YOUR WORLD", num: e.geo.size, label: "places you've played" + (e.raidMaxKm ? ` — raiding ${fmt(round(e.raidMaxKm))} km from home` : ""), grad: 6 });
  }
  const streak = longestStreak(dayKeys);
  if (streak > 1) s.push({ kicker: "DEDICATION", num: streak, label: `days in a row${yr ? ` in ${yr}` : ""}, without missing one`, grad: 7 });
  const friendsN = yr ? sumMonthly(STATE.friends.monthly) : STATE.friends.rows.length;
  if (friendsN) s.push({ kicker: "NOT ALONE", num: friendsN, label: yr ? `friends added in ${yr}` : "friends on the journey", grad: 8 });
  const coins = yr ? sumMonthly(STATE.spend.boughtMonthly) : STATE.spend.coinsBought;
  if (coins) s.push({ kicker: "THE WAR CHEST", num: coins, label: `PokéCoins bought${yr ? ` in ${yr}` : ""}`, grad: 9 });
  const km = Object.keys(STATE.fitness.daily).filter(inYear).reduce((a, k) => a + (STATE.fitness.daily[k].meters || 0), 0) / 1000;
  if (km > 1) s.push({ kicker: "ON FOOT", num: Math.round(km), label: `kilometres walked with the game open${yr ? ` in ${yr}` : ""}`, grad: 10 });
  const photosN = yr ? sumMonthly(STATE.photos.monthly) : STATE.photos.total;
  if (photosN) s.push({ kicker: "THROUGH THE LENS", num: photosN, label: `GO Snapshots you stopped to take${yr ? ` in ${yr}` : ""}`, grad: 3 });
  const cf = STATE.campfire;
  const meetN = cf ? (yr ? sumMonthly(cf.checkinMonthly) : cf.checkins) : 0;
  if (meetN) s.push({ kicker: "AROUND THE CAMPFIRE", num: meetN, label: `meetups you showed up for${yr ? ` in ${yr}` : ""}${!yr && cf.messages ? ` — and ${fmt(cf.messages)} messages to your clubs` : ""}`, grad: 6 });
  if (!yr) {
    const arch = trainerArchetype();
    if (arch) s.push({ kicker: "YOUR TRAINER TYPE", big: `${arch.emoji} ${esc(arch.name)}`, label: `${arch.line} — computed from your whole journey`, grad: 5, gradPair: arch.grads });
    if (STATE.cohortPct) s.push({ kicker: "AMONG TRAINERS", big: `top ${Math.max(1, 100 - STATE.cohortPct.pct)}%`,
      label: `Level ${STATE.cohortPct.level} — ahead of ${STATE.cohortPct.pct}% of ${fmt(STATE.cohortPct.n)} real trainers in the Trainer Model cohort`, grad: 4 });
  }
  const years = [...new Set(Object.keys(e.byMonth).map((m) => m.slice(0, 4)))];
  s.push(yr
    ? { kicker: "AND THAT WAS " + yr, big: `${yr}, wrapped`, label: "grab the year card below to keep it", grad: 11, finale: true }
    : {
      kicker: "AND COUNTING",
      big: years.length ? `${years.length} year${years.length > 1 ? "s" : ""} of adventure` : "Your adventure",
      label: window.DEMO_PAGE ? "this was the sample trainer — imagine yours" : "grab the card, flex the journey",
      grad: 11, finale: true,
    });
  return s;
}

/* a line icon for each story beat, keyed on the slide's kicker */
function storyIcon(k) {
  k = String(k || "").toUpperCase();
  if (/DAY ONE|YEAR IN DAYS/.test(k)) return "calendar";
  if (/CATCH|ENCOUNTER/.test(k)) return "sparkles";
  if (/BIGGEST DAY/.test(k)) return "award";
  if (/HOUR/.test(k)) return "clock";
  if (/WORLD/.test(k)) return "globe";
  if (/DEDICATION|ON FOOT/.test(k)) return "activity";
  if (/NOT ALONE/.test(k)) return "users";
  if (/WAR CHEST/.test(k)) return "card";
  if (/LENS/.test(k)) return "camera";
  if (/CAMPFIRE/.test(k)) return "flame";
  if (/TRAINER TYPE/.test(k)) return "user";
  if (/AMONG/.test(k)) return "trending";
  if (/SINCE THEN|^YOUR \d{4}/.test(k)) return "list";
  if (/AND (THAT WAS|COUNTING)/.test(k)) return "book";
  return "sparkles";
}
function storyMode(year) {
  const slides = storySlides(year);
  if (!slides.length) return;
  // The overlay covers the trigger, but a keyboard user's focus stays on it —
  // a second Enter would otherwise stack a second story on top of the first.
  if (document.querySelector(".story-ov")) return;
  const opener = document.activeElement;
  const GRADS = [[C.teal, C.yellow], [C.blue, C.teal], [C.yellow, C.orange], [C.red, C.pink],
    [C.purple, C.blue], [C.pink, C.purple], [C.green, C.teal], [C.orange, C.red],
    [C.teal, C.purple], [C.yellow, C.green], [C.blue, C.pink], [C.teal, C.yellow]];
  const SLIDE_MS = 6000;                 // auto-advance pace; the segment fill matches it
  const AUTOPLAY = !REDUCED_MOTION;      // reduced motion keeps the story tap-driven
  const ov = document.createElement("div");
  ov.className = "story-ov" + (AUTOPLAY ? " autoplay" : "");
  ov.style.setProperty("--slide-ms", SLIDE_MS + "ms");
  ov.setAttribute("role", "dialog");
  ov.setAttribute("aria-modal", "true");
  ov.setAttribute("aria-label", "Your story, chapter by chapter");
  ov.innerHTML = `
    <div class="story-bg" aria-hidden="true"></div>
    <div class="story-bg" aria-hidden="true"></div>
    <div class="story-prog" aria-hidden="true">${slides.map(() => "<i><b></b></i>").join("")}</div>
    <button class="story-x" type="button" aria-label="Close story">×</button>
    <div class="story-stage"></div>
    <div class="story-live sr-only" role="status" aria-live="polite"></div>
    <div class="story-hint">${window.matchMedia && window.matchMedia("(pointer: coarse)").matches
      ? "swipe, or tap the right side for next · hold to pause"
      : "tap right for next · left for back · Esc to close"}</div>`;
  document.body.appendChild(ov);
  document.body.style.overflow = "hidden";
  // A fixed opaque overlay isn't a modal on its own — without this, Tab walks
  // straight out to the nav and footer behind the story.
  const inerted = [...document.body.children].filter((el) => el !== ov && !el.inert);
  inerted.forEach((el) => (el.inert = true));
  const stage = ov.querySelector(".story-stage");
  const bgs = [...ov.querySelectorAll(".story-bg")];
  const segs = [...ov.querySelectorAll(".story-prog i")];
  let bgFront = 0;
  let idx = -1, closed = false, raf = null, timer = null, hinted = false;
  // On Android the hardware Back button must close the story, not navigate
  // away from metrics.html — that would silently discard a report built from
  // local files that can't be restored without re-reading them.
  let popped = false;
  const onPop = () => { popped = true; close(); };
  try { history.pushState({ story: 1 }, ""); window.addEventListener("popstate", onPop); } catch (e) {}
  const close = () => {
    if (closed) return;
    closed = true;
    if (raf) cancelAnimationFrame(raf);
    if (timer) clearTimeout(timer);
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKey);
    document.removeEventListener("visibilitychange", onVis);
    window.removeEventListener("popstate", onPop);
    inerted.forEach((el) => (el.inert = false));
    ov.remove();
    // Consume the history entry the story pushed — unless Back itself closed us.
    if (!popped) try { if (history.state && history.state.story) history.back(); } catch (e) {}
    if (opener && opener.isConnected) try { opener.focus(); } catch (e) {}
  };
  /* ── auto-advance. The current segment's CSS fill doubles as the timer
     display; hold-to-pause freezes both. No timer on the finale slide — it
     ends in CTAs, not an auto-close. ── */
  let held = false, remain = 0, startedAt = 0;
  const stopTimer = () => { if (timer) { clearTimeout(timer); timer = null; } };
  const armTimer = (ms) => {
    stopTimer();
    if (!AUTOPLAY || closed || idx >= slides.length - 1) return;
    startedAt = performance.now();
    remain = ms;
    timer = setTimeout(() => {
      timer = null;   // clear BEFORE the guards — a fired-but-skipped timer must not block re-arming
      if (!held && !document.hidden) render(idx + 1, 1);
    }, ms);
  };
  const pauseTimer = () => {
    if (!AUTOPLAY) return;
    ov.classList.add("paused");
    if (timer) { remain = Math.max(400, remain - (performance.now() - startedAt)); stopTimer(); }
  };
  const resumeTimer = () => {
    if (!AUTOPLAY || closed) return;
    ov.classList.remove("paused");
    if (idx < slides.length - 1 && !timer) armTimer(remain || SLIDE_MS);
  };
  const onVis = () => { document.hidden ? pauseTimer() : resumeTimer(); };
  document.addEventListener("visibilitychange", onVis);
  const render = (i, dir = 0) => {
    const next = Math.max(0, Math.min(slides.length - 1, i));
    if (next === idx) return;            // back on slide one: no replay, no re-announce
    if (raf) { cancelAnimationFrame(raf); raf = null; }   // stop a mid-count loop cold
    idx = next;
    const sl = slides[idx];
    const [g1, g2] = sl.gradPair || GRADS[sl.grad % GRADS.length];
    // background-image can't interpolate — crossfade two stacked layers instead
    const back = bgs[1 - bgFront];
    back.style.background = `radial-gradient(120% 90% at 18% 0%, ${g1}36, transparent 60%),` +
      `radial-gradient(120% 90% at 85% 100%, ${g2}30, transparent 60%)`;
    back.style.opacity = "1";
    bgs[bgFront].style.opacity = "0";
    bgFront = 1 - bgFront;
    const finale = !sl.finale ? "" : `<div class="story-cta">
      ${window.DEMO_PAGE
        ? `<a class="btn btn-primary" href="metrics.html">Build my own story</a>`
        : (Object.keys(STATE.ev.dayCounts).length ? `<button class="btn btn-primary" id="story-journey" type="button">${window.ICON ? window.ICON("download") : ""} My journey card</button>` : "")}
      <button class="btn btn-ghost" id="story-back" type="button">Back to my chapters</button></div>`;
    stage.innerHTML = `<div class="story-slide${dir > 0 ? " fwd" : dir < 0 ? " bwd" : ""}">
      <div class="story-ic" style="--hue:${g1}" aria-hidden="true">${window.ICON ? window.ICON(storyIcon(sl.kicker)) : ""}</div>
      <div class="story-kicker">${sl.kicker}</div>
      ${sl.num != null ? `<div class="story-big mono" data-n="${sl.num}">${REDUCED_MOTION ? fmt(sl.num) : "0"}</div>` : `<div class="story-big">${sl.big}</div>`}
      <div class="story-label">${sl.label}</div>
      ${!sl.finale && !SAMPLE_DATA && idx > 0 ? `<div class="story-share-row"><button class="btn btn-ghost story-share" type="button">${window.ICON ? window.ICON("share") : ""} Share this</button></div>` : ""}
      ${finale}</div>`;
    const bigEl = stage.querySelector("[data-n]");
    if (bigEl && !REDUCED_MOTION) {
      const n = +bigEl.dataset.n, t0 = performance.now(), dur = 900;
      const tick = (t) => {
        if (closed) return;
        const p = Math.min(1, (t - t0) / dur), ease = 1 - Math.pow(1 - p, 3);
        bigEl.textContent = fmt(Math.round(n * ease));
        if (p < 1) raf = requestAnimationFrame(tick);
      };
      raf = requestAnimationFrame(tick);
      setTimeout(() => { if (!closed && bigEl.isConnected) bigEl.textContent = fmt(n); }, dur + 250); // rAF doesn't fire in hidden tabs
    }
    segs.forEach((el, j) => (el.className = j < idx ? "done" : j === idx ? "cur" : ""));
    // restart the current segment's fill so its animation tracks this slide's clock
    if (AUTOPLAY && segs[idx]) {
      const fill = segs[idx].querySelector("b");
      if (fill) { fill.style.animation = "none"; void fill.offsetWidth; fill.style.animation = ""; }
    }
    // announce each slide — otherwise the whole story is silent to screen readers
    const live = ov.querySelector(".story-live");
    if (live) live.textContent = `Slide ${idx + 1} of ${slides.length}. ${sl.kicker}. ${sl.num != null ? fmt(sl.num) : sl.big}. ${sl.label}`;
    const jb = stage.querySelector("#story-journey");
    if (jb) jb.onclick = () => downloadJourneyCard(jb);
    const bb = stage.querySelector("#story-back");
    if (bb) bb.onclick = close;
    const sh = stage.querySelector(".story-share");
    if (sh) sh.onclick = () => {
      pauseTimer();   // don't auto-advance out from under the share sheet
      sh.disabled = true;
      renderStatCard(sl, sl.gradPair || GRADS[sl.grad % GRADS.length], () => { sh.disabled = false; resumeTimer(); });
    };
    // the finale earns a celebratory beat — skipped under reduced motion
    if (sl.finale) confettiBurst(ov, [g1, g2, C.teal, C.yellow]);
    // the hint has done its job once the reader advances on their own
    if (idx > 0 && !hinted) { hinted = true; const h = ov.querySelector(".story-hint"); if (h) h.classList.add("off"); }
    armTimer(SLIDE_MS);
  };
  /* ── input: tap zones + hold-to-pause + swipe. A hold pauses the clock and
     must not count as a tap; a horizontal swipe navigates; a downward swipe
     dismisses — the grammar every story UI trains. `swallow` keeps the click
     that follows a hold or swipe from also firing the tap zones. ── */
  let downX = 0, downY = 0, downT = 0, swallow = false;
  ov.addEventListener("pointerdown", (e) => {
    if (e.target.closest("button, a")) return;
    held = true;
    downX = e.clientX; downY = e.clientY; downT = performance.now();
    pauseTimer();
  });
  ov.addEventListener("pointerup", (e) => {
    if (!held) return;
    held = false;
    const dx = e.clientX - downX, dy = e.clientY - downY, dt = performance.now() - downT;
    swallow = false;
    if (Math.abs(dx) > 40 && Math.abs(dx) > Math.abs(dy)) {
      swallow = true;
      dx < 0 ? (idx >= slides.length - 1 ? close() : render(idx + 1, 1)) : render(idx - 1, -1);
      return;                            // a swipe navigated; render() re-armed the clock
    }
    if (dy > 60 && Math.abs(dy) > Math.abs(dx)) { swallow = true; close(); return; }
    if (dt > 300) swallow = true;        // a hold is a pause, not a tap
    resumeTimer();
  });
  ov.addEventListener("pointercancel", () => { held = false; swallow = false; resumeTimer(); });
  ov.addEventListener("click", (ev2) => {
    if (ev2.target.closest(".story-x")) return close();
    if (ev2.target.closest("button, a")) return;
    if (swallow) { swallow = false; return; }
    if (ev2.clientX < window.innerWidth * 0.3) render(idx - 1, -1);
    else if (idx >= slides.length - 1) close();
    else render(idx + 1, 1);
  });
  const onKey = (ev2) => {
    if (ev2.key === "Escape") { close(); return; }
    if (ev2.key === "ArrowLeft") { render(idx - 1, -1); return; }
    // Space belongs to whichever control has focus. Focus opens on the close
    // button and the finale slide adds two more, so swallowing Space here meant
    // a keyboard user pressing it on "⬇ My journey card" advanced the story
    // instead of downloading the card. Same guard the Trainer Model's overlay
    // uses. Arrow keys stay unconditional — no control claims those.
    const onControl = document.activeElement !== ov && ov.contains(document.activeElement);
    if (ev2.key === "ArrowRight" || (ev2.key === " " && !onControl)) {
      ev2.preventDefault();
      idx >= slides.length - 1 ? close() : render(idx + 1, 1);
    }
  };
  document.addEventListener("keydown", onKey);
  render(0);
  // pull focus into the dialog so keyboard users are inside the story, not behind it
  try { ov.querySelector(".story-x").focus(); } catch (e) {}
}

/* The calendar day `days` after today on this device's clock, and a Date as an
 * iCalendar all-day value (YYYYMMDD) read on that same clock. The reminders
 * used the UTC date, which is already tomorrow on an evening west of Greenwich
 * and still yesterday just after midnight east of it, so they landed a day out. */
function daysFromToday(days, now = new Date()) {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  d.setDate(d.getDate() + days);
  return d;
}
const icsDay = (d) => String(d.getFullYear()) + String(d.getMonth() + 1).padStart(2, "0") + String(d.getDate()).padStart(2, "0");

/* A tiny on-device .ics download — no calendar service, no request. Same
 * pattern as the landing page's export reminder. `description` is iCalendar
 * text: a comma in it is written "\\,". `date` is read as a day on this
 * device's calendar, the one the page shows it on. */
function downloadICS(summary, date, filename, description) {
  const ymd = icsDay(date);
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//POGO Metrics//EN",
    "BEGIN:VEVENT", "UID:" + stamp + "@pogo-metrics",
    "DTSTAMP:" + stamp, "DTSTART;VALUE=DATE:" + ymd,
    "SUMMARY:" + summary,
    "DESCRIPTION:" + (description || "Projected from your recent pace by POGO Metrics. Request a fresh export and rebuild to see how close you are: https://pogo-metrics.netlify.app/"),
    "URL:https://pogo-metrics.netlify.app/", "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ── shared file delivery: native share sheet where the browser can share the
   file, download anchor everywhere else. AbortError means the user closed the
   sheet on purpose — don't then shove a download at them. The share cards and
   the compare file both go out through here. ── */
async function deliverFile(blob, filename, title, after) {
  const finish = () => { if (after) after(); };
  if (navigator.canShare) {
    try {
      const file = new File([blob], filename, { type: blob.type });
      if (navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title });
        finish();
        return;
      }
    } catch (err) {
      if (err && err.name === "AbortError") { finish(); return; }
    }
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  finish();
}
function deliverCanvas(cv, filename, title, after) {
  cv.toBlob((blob) => {
    if (!blob) { alert("Could not generate image on this browser."); if (after) after(); return; }
    deliverFile(blob, filename, title, after);
  }, "image/png");
}

/* ── one slide, one image: a 1080x1920 (9:16, phone-story aspect) card of a
   single stat — the unit people actually post. Reuses the slide object as the
   card spec: kicker, number/big, label, gradient pair. ── */
function renderStatCard(sl, pair, after) {
  const W = 1080, H = 1920, S = 2;
  const cv = document.createElement("canvas");
  cv.width = W * S; cv.height = H * S;
  const ctx = cv.getContext("2d");
  ctx.scale(S, S);
  const [g1, g2] = pair;
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  let g = ctx.createRadialGradient(180, 260, 0, 180, 260, 900);
  g.addColorStop(0, g1 + "59"); g.addColorStop(1, C.bg + "00");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  g = ctx.createRadialGradient(W - 160, H - 300, 0, W - 160, H - 300, 950);
  g.addColorStop(0, g2 + "47"); g.addColorStop(1, C.bg + "00");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(255,255,255,.10)"; ctx.lineWidth = 2;
  roundRectPath(ctx, 14, 14, W - 28, H - 28, 34); ctx.stroke();
  ctx.textAlign = "center";
  // kicker
  ctx.fillStyle = g1; ctx.font = "600 30px 'JetBrains Mono', monospace";
  ctx.letterSpacing = "9px";
  ctx.fillText(sl.kicker.toUpperCase(), W / 2, 660);
  ctx.letterSpacing = "0px";
  // Slide text is HTML — escaped names, the odd <b> — but fillText prints
  // characters: drop the tags and turn the entities back into what they stand
  // for, or a name with "&" or an apostrophe reads "&amp;" / "&#39;" here.
  const plain = (h) => String(h == null ? "" : h).replace(/<[^>]*>/g, "")
    .replace(/&(lt|gt|quot|#39|amp);/g, (m, k) => ({ lt: "<", gt: ">", quot: '"', "#39": "'", amp: "&" }[k]));
  // the big thing — number or phrase, shrunk until it fits
  const bigText = sl.num != null ? fmt(sl.num) : plain(sl.big);
  let size = sl.num != null ? 190 : 120;
  do {
    ctx.font = `800 ${size}px ${sl.num != null ? "'JetBrains Mono', monospace" : "'Outfit', sans-serif"}`;
    size -= 6;
  } while (ctx.measureText(bigText).width > W - 140 && size > 40);
  const grad = ctx.createLinearGradient(W / 2 - 300, 0, W / 2 + 300, 0);
  grad.addColorStop(0, g1); grad.addColorStop(1, g2);
  ctx.fillStyle = grad;
  ctx.fillText(bigText, W / 2, 900);
  // label, wrapped
  ctx.fillStyle = C.dim; ctx.font = "500 34px 'Outfit', sans-serif";
  const words = plain(sl.label).split(/\s+/);
  let line = "", y = 990;
  for (const w of words) {
    const trial = line ? line + " " + w : w;
    if (ctx.measureText(trial).width > W - 220 && line) { ctx.fillText(line, W / 2, y); y += 48; line = w; }
    else line = trial;
  }
  if (line) ctx.fillText(line, W / 2, y);
  // footer wordmark
  ctx.fillStyle = C.faint; ctx.font = "600 22px 'JetBrains Mono', monospace";
  ctx.letterSpacing = "5px";
  ctx.fillText("POGO METRICS", W / 2, H - 96);
  ctx.font = "500 17px 'JetBrains Mono', monospace"; ctx.letterSpacing = "2px";
  ctx.fillText("POGO-METRICS.NETLIFY.APP", W / 2, H - 60);
  ctx.letterSpacing = "0px";
  deliverCanvas(cv, `pogo-metrics-${sl.kicker.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")}.png`,
    "My Pokémon GO journey", after);
}

/* ── a tiny celebration: one canvas, ~90 particles, 1.4s, gone. Fired on the
   story finale and the record book's first reveal. ── */
function confettiBurst(host, colors) {
  if (REDUCED_MOTION || host.querySelector(":scope > .confetti")) return;
  const cvs = document.createElement("canvas");
  cvs.className = "confetti";
  const r = host.getBoundingClientRect();
  if (!r.width || !r.height) return;
  cvs.width = r.width; cvs.height = Math.min(r.height, 900);
  cvs.style.cssText = "position:absolute;left:0;top:0;width:100%;pointer-events:none;z-index:5;";
  host.appendChild(cvs);
  const ctx = cvs.getContext("2d");
  const parts = Array.from({ length: 90 }, () => ({
    x: cvs.width / 2 + (Math.random() - 0.5) * cvs.width * 0.4,
    y: cvs.height * 0.3,
    vx: (Math.random() - 0.5) * 9,
    vy: -(4 + Math.random() * 7),
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    w: 5 + Math.random() * 6,
    h: 8 + Math.random() * 8,
    c: colors[(Math.random() * colors.length) | 0],
  }));
  const t0 = performance.now();
  const tick = (t) => {
    const age = t - t0;
    ctx.clearRect(0, 0, cvs.width, cvs.height);
    for (const p of parts) {
      p.vy += 0.25; p.x += p.vx; p.y += p.vy; p.rot += p.vr;
      ctx.save();
      ctx.translate(p.x, p.y);
      ctx.rotate(p.rot);
      ctx.globalAlpha = Math.max(0, 1 - age / 1400);
      ctx.fillStyle = p.c;
      ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h);
      ctx.restore();
    }
    if (age < 1400 && cvs.isConnected) requestAnimationFrame(tick);
    else cvs.remove();
  };
  requestAnimationFrame(tick);
}

/* ── poster mode: the GitHub-Skyline "put my year on the wall" artifact — a
   print-ready 2480x3508 (A-series @300dpi) PNG: name, lifetime numbers, and
   one calendar heat strip per year. Same offline-canvas philosophy as the
   cards; renderCalendar's per-day math at print scale. ── */
async function downloadPoster(btn) {
  const e = STATE.ev;
  const dayKeys = Object.keys(e.dayCounts);
  if (!dayKeys.length) return;
  const W = 2480, H = 3508;
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = H;
  const ctx = cv.getContext("2d");
  const orig = btn && btn.textContent;
  if (btn) { btn.textContent = "Rendering…"; btn.disabled = true; }
  try { await document.fonts.ready; } catch (err) {}

  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  let g = ctx.createRadialGradient(400, 500, 0, 400, 500, 1900);
  g.addColorStop(0, C.teal + "26"); g.addColorStop(1, C.bg + "00");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  g = ctx.createRadialGradient(W - 380, H - 600, 0, W - 380, H - 600, 2000);
  g.addColorStop(0, C.yellow + "1f"); g.addColorStop(1, C.bg + "00");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(255,255,255,.12)"; ctx.lineWidth = 4;
  roundRectPath(ctx, 40, 40, W - 80, H - 80, 56); ctx.stroke();

  ctx.textAlign = "center";
  ctx.fillStyle = C.dim; ctx.font = "600 46px 'JetBrains Mono', monospace";
  ctx.letterSpacing = "16px";
  ctx.fillText("POKÉMON GO · A JOURNEY IN DATA", W / 2, 220);
  ctx.letterSpacing = "0px";
  const who = (STATE.profile && STATE.profile.username) || "Trainer";
  ctx.font = "800 200px 'Outfit', sans-serif";
  const ng = ctx.createLinearGradient(W / 2 - 500, 0, W / 2 + 500, 0);
  ng.addColorStop(0, C.teal); ng.addColorStop(1, C.yellow);
  ctx.fillStyle = ng;
  ctx.fillText(who, W / 2, 430);
  const range = e.first && e.last ? `${fmtDate(e.first)} — ${fmtDate(e.last)}` : "";
  const arch = trainerArchetype();
  ctx.fillStyle = C.dim; ctx.font = "500 52px 'Outfit', sans-serif";
  ctx.fillText([range, arch && `${arch.emoji} ${arch.name}`].filter(Boolean).join("   ·   "), W / 2, 530);

  // headline numbers, two rows of three
  const total = Object.values(e.totals).reduce((a, b) => a + b, 0);
  const km = Object.values(STATE.fitness.daily).reduce((a, d) => a + (d.meters || 0), 0) / 1000;
  const tiles = [
    [fmt(total), "logged actions"], [fmt(catchesOf(e.totals)), "Pokémon encountered"],
    [fmt(e.totals["Spins"] || 0), "PokéStop spins"], [fmt(e.days.size), "days played"],
    [fmt(longestStreak(dayKeys)), "longest streak"],
    km > 1 ? [fmt(Math.round(km)) + " km", "on foot"] : [fmt(e.totals["Raids"] || 0), "raid lobbies"],
  ];
  tiles.forEach(([v, l], i) => {
    const col = i % 3, row = (i / 3) | 0;
    const x = W / 2 + (col - 1) * 720, y = 700 + row * 240;
    ctx.fillStyle = "#fff"; ctx.font = "700 96px 'JetBrains Mono', monospace";
    ctx.fillText(v, x, y);
    ctx.fillStyle = C.faint; ctx.font = "500 40px 'Outfit', sans-serif";
    ctx.fillText(l, x, y + 58);
  });

  // one heat strip per year — every day of the journey, on the wall
  const years = [...new Set(dayKeys.map((d) => d.slice(0, 4)))].sort().slice(-6);
  const left = 220, right = W - 220;
  const cell = Math.floor((right - left) / 53);
  let y0 = 1260;
  ctx.textAlign = "left";
  for (const yr of years) {
    const yearMax = Math.max(1, ...dayKeys.filter((d) => d.startsWith(yr)).map((d) => e.dayCounts[d]));
    ctx.fillStyle = C.dim; ctx.font = "700 54px 'JetBrains Mono', monospace";
    ctx.fillText(yr, left, y0);
    const first = new Date(Date.UTC(+yr, 0, 1));
    const startDow = (first.getUTCDay() + 6) % 7;
    const d = new Date(first);
    let doy = 0;
    while (d.getUTCFullYear() === +yr) {
      const iso = d.toISOString().slice(0, 10);
      const n = e.dayCounts[iso] || 0;
      const col = Math.floor((startDow + doy) / 7), row = (startDow + doy) % 7;
      ctx.fillStyle = n === 0 ? "rgba(255,255,255,.05)" : `rgba(65,216,198,${heatAlpha(n, yearMax, 0.2, 0.8).toFixed(2)})`;
      const cx = left + col * cell, cy = y0 + 30 + row * cell;
      roundRectPath(ctx, cx, cy, cell - 5, cell - 5, 5);
      ctx.fill();
      d.setUTCDate(d.getUTCDate() + 1);
      doy++;
    }
    y0 += 30 + 7 * cell + 64;
  }

  ctx.textAlign = "center";
  ctx.fillStyle = C.dim; ctx.font = "600 44px 'JetBrains Mono', monospace";
  ctx.letterSpacing = "10px";
  ctx.fillText("POGO METRICS", W / 2, H - 150);
  ctx.fillStyle = C.faint; ctx.font = "500 32px 'JetBrains Mono', monospace";
  ctx.letterSpacing = "4px";
  ctx.fillText("POGO-METRICS.NETLIFY.APP", W / 2, H - 96);
  ctx.letterSpacing = "0px";

  deliverCanvas(cv, "pogo-metrics-poster.png", "My Pokémon GO journey — poster", () => {
    if (btn) { btn.textContent = orig; btn.disabled = false; }
  });
}

/* ── lifetime journey card: the year-card renderer fed with all-time data ── */
function downloadJourneyCard(btn) {
  const e = STATE.ev;
  const dayKeys = Object.keys(e.dayCounts);
  if (!dayKeys.length) return;
  const total = Object.values(e.totals).reduce((a, b) => a + b, 0);
  const months = monthSpan(Object.keys(e.byMonth));
  const series = Object.keys(SERIES_COLORS).filter((k) => e.totals[k]);
  const years = [...new Set(months.map((m) => m.slice(0, 4)))].sort();
  const streak = longestStreak(dayKeys);
  const evDays = dayKeys.filter((d) => eventFor(d)).length;
  const monthTotals = Object.entries(e.byMonth).map(([m, kinds]) => [m, Object.values(kinds).reduce((a, b) => a + b, 0)]).sort((a, b) => b[1] - a[1]);
  const badges = [];
  const arch = trainerArchetype();
  if (arch) badges.push(`${arch.emoji} ${arch.name}`);
  if (years.length > 1) badges.push(`🎮 ${years.length} years of adventure`);
  if (e.raidMaxKm) badges.push(`🌍 raided ${fmt(round(e.raidMaxKm))} km away`);
  if (evDays) badges.push(`🎪 ${evDays} GO Fest day${evDays > 1 ? "s" : ""}`);
  if (streak > 6) badges.push(`🔥 ${fmt(streak)}-day streak`);
  downloadYearCard({
    year: years.length > 1 ? `${years[0]} – ${years[years.length - 1]}` : years[0],
    titleFont: years.length > 1 ? "800 96px 'Outfit', sans-serif" : null,
    file: "pogo-metrics-journey.png",
    partial: false, c1: C.teal, c2: C.yellow,
    events: fmt(total), badges, there: festBadges(),
    peakLabel: monthTotals[0] ? `${fmtMonth(monthTotals[0][0])} was the biggest month of all` : "",
    stats: [
      [fmt(catchesOf(e.totals)), "Pokémon encountered"], [fmt(e.totals["Spins"] || 0), "PokéStop spins"],
      [fmt(e.totals["Raids"] || 0), "raid lobbies"], [fmt(e.raidRemote), "remote raids"],
      [fmt(e.days.size), "days played"], [fmt(streak), "longest streak"],
      ...(STATE.friends.rows.length ? [[fmt(STATE.friends.rows.length), "friends made"]] : []),
      ...(STATE.spend.coinsBought ? [[fmt(STATE.spend.coinsBought), "PokéCoins bought"]] : []),
    ].slice(0, 8),
    monthLabels: months.map((mk) => (mk.endsWith("-01") ? "’" + mk.slice(2, 4) : "")),
    monthlyStacks: months.map((mk) => series.map((lab) => [SERIES_COLORS[lab], (e.byMonth[mk] || {})[lab] || 0])),
    series: series.map((lab) => [lab, SERIES_COLORS[lab]]),
  }, btn);
}

/* ── the two numbers files ──
 * The COMPARE file is the one the report offers to send a friend: the trainer
 * name, action totals, actions per month and per day, and the friend count —
 * exactly what parseCompare reads, and nothing more. It keeps the shape the
 * full file always had (profile.username, friends.total), so a friend on an
 * older build of this site can still read it.
 * The FULL stats file is the player's own record: profile, real-money
 * spending, devices, daily steps and the hour-of-week grid. Location data is
 * left out of both. The full file is named pogo-metrics-personal-stats.json,
 * which the file router does not take for a compare file. */
function compareFileData() {
  const e = STATE.ev;
  return {
    generated: new Date().toISOString(),
    source: "POGO Metrics — a compare file, made in the browser from a Pokémon GO export",
    note: "For comparing with a friend. It holds a trainer name, action totals, actions per month and per day, and a friend count. Nothing else: no locations, no spending, no devices, no steps, no profile.",
    profile: { username: (STATE.profile && STATE.profile.username) || "" },
    totalsByAction: e.totals,
    monthly: e.byMonth,
    dayCounts: e.dayCounts,
    friends: { total: STATE.friends.rows.length },
  };
}
/* The compare file goes out through the share sheet where the browser can
 * share a file, and downloads everywhere else. The name has to start with
 * pogo-metrics-stats: that is how the friend's copy of this site knows it. */
function shareCompareFile() {
  const who = String((STATE.profile && STATE.profile.username) || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 24);
  const blob = new Blob([JSON.stringify(compareFileData(), null, 2)], { type: "application/json" });
  deliverFile(blob, `pogo-metrics-stats-${who || "compare"}.json`, "My POGO Metrics compare file");
}
function downloadStatsJSON() {
  const url = URL.createObjectURL(new Blob([JSON.stringify(statsFileData(), null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url; a.download = "pogo-metrics-personal-stats.json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function statsFileData() {
  const e = STATE.ev, H = installHistory();
  return {
    generated: new Date().toISOString(),
    source: "POGO Metrics — parsed locally in your browser from your official Pokémon GO export",
    note: "Your personal stats file — for your own records, not for sharing: it includes your profile, real-money spending, devices and daily steps. To compare with a friend, send the compare file instead. Location data is deliberately NOT included: no GPS trail, no activity or stop coordinates, and no city or travel history. Those stay in the browser.",
    profile: STATE.profile,
    totalsByAction: e.totals,
    monthly: e.byMonth,
    dayCounts: e.dayCounts,
    hourOfWeekUTC: e.hourweek,
    raids: { total: e.raidTotal, remote: e.raidRemote, farthestKm: Math.round(e.raidMaxKm) },
    friends: { total: STATE.friends.rows.length, monthly: STATE.friends.monthly, sources: STATE.friends.sources, unfriended: STATE.friends.unfriended },
    spending: STATE.spend,
    fitnessDaily: STATE.fitness.daily,
    photos: { total: STATE.photos.total, monthly: STATE.photos.monthly },
    // cities/places/countries are location history — excluded to keep the note above true
    sessions: { total: STATE.sessions.total, monthly: STATE.sessions.monthly, devices: STATE.sessions.devices },
    // the history both install files add up to, not the per-install table behind it —
    // and the first install either file names, as the report shows it: App_Installs.csv
    // alone can start a year or more late
    installs: { count: STATE.installs.count, first: (H && H.first) || STATE.installs.first, devices: STATE.installs.devices, history: H },
    referrals: STATE.referrals,
    supportTickets: STATE.support.tickets,
    liveEvents: STATE.liveEvents.length,
    wayfarer: STATE.wayfarer,
    // counts and months only — the Campfire parser keeps no text, names or coordinates.
    // Its quarter-hour message tally only feeds the chattiest-hour line, so it stays here.
    campfire: STATE.campfire && { ...STATE.campfire, msgSlotUTC: undefined },
  };
}

/* ── trainer card (Gameplay.txt) ── */
function renderTrainer() {
  const p = STATE.profile, col = STATE.collection;
  if (!p) return;
  const km = p.distanceWalkedKm || 0;
  const evT = STATE.ev.totals;
  const met = catchesOf(evT);   // encounters — see catchesOf
  const stats = [
    [esc(String(p.level || "—")), "Trainer level"],
    [fmt(p.totalXp || 0), "Total XP"],
    [fmt(round(km)) + " km", "Distance walked", "≈ " + (km / 40075 * 100).toFixed(0) + "% around Earth"],
    ...(met ? [[fmt(met), "Pokémon encountered", "map · incense · lure · GO Plus logs"]] : []),
    ...(evT["Spins"] ? [[fmt(evT["Spins"]), "PokéStop spins"]] : []),
    [fmt(p.stardust || 0), "Stardust"],
    [fmt(p.eggsHatched || 0), "Eggs hatched"],
    [fmt(p.pokecoin || 0), "PokéCoins on hand"],
    /* Niantic's own "You have N items" counts event-pass points and crafting
     * resources as items — on the bundled sample, 327,752 against an actual bag
     * of 17,022. The bag chapter has split those out since it landed,
     * but this card went on printing the raw figure, so the same page showed
     * two "items in bag" numbers more than ten times apart. Prefer the real one;
     * fall back only when there is no parseable item list to count (parseBag
     * bails on some profiles, so STATE.bag genuinely can be absent). */
    STATE.bag
      ? [fmt(STATE.bag.bagTotal), "Items in bag", fmt(STATE.bag.distinct) + " different kinds"]
      : [fmt(p.totalItems || 0), "Items in bag", "as counted by the game"],
    [fmt(p.medalCount || STATE.medals.length || 0), "Medals earned"],
    // Referral Connections: how many joined with your code — counted, never named
    ...(STATE.referrals ? [[fmt(STATE.referrals.total), "Trainers you referred",
      STATE.referrals.friends ? `${fmt(STATE.referrals.friends)} still on your friend list` : "joined the game with your code"]] : []),
  ];
  let inner = statGrid(stats);

  if (col && Object.keys(col.genCounts).length) {
    inner += `<div class="split" style="margin-top:18px">
      <div><h4 class="mod-h4">Storage by region of origin</h4><div class="gen-bars">${
        Object.entries(col.genCounts).map(([region, g]) => `
          <div class="gen-row"><span class="gname">${esc(region)}</span>
          <div class="gen-bar-track"><div class="gen-bar-fill" style="width:${Math.min(100, g.unique / g.dexSize * 100).toFixed(0)}%"></div></div>
          <span class="gval">${g.unique}/${g.dexSize} · ${fmt(g.total)}</span></div>`).join("")
      }</div></div>
      <div><h4 class="mod-h4">Most-hoarded species</h4>${rankList(col.topSpecies)}</div>
    </div>`;
  }

  if (STATE.medals.length) {
    const tiers = { 4: 0, 3: 0, 2: 0, 1: 0 };
    STATE.medals.forEach((m) => { if (m.tier) tiers[m.tier]++; });
    const events = STATE.medals.filter((m) => m.event).length;
    const untiered = STATE.medals.filter((m) => !m.tier && !m.event).length;
    const cards = [
      [4, "Platinum"], [3, "Gold"], [2, "Silver"], [1, "Bronze"],
    ].map(([t, label]) =>
      `<div class="medal-card t${t}"><div class="mc-v">${fmt(tiers[t])}</div><div class="mc-l">${label}</div></div>`).join("");
    // The tiers must visibly reconcile with the "Medals earned" card above.
    const tiered = tiers[4] + tiers[3] + tiers[2] + tiers[1];
    const reconcile = `${fmt(tiered)} medal${tiered === 1 ? "" : "s"} at a tier` +
      (events ? ` · ${fmt(events)} event badge${events === 1 ? "" : "s"} (GO Fest, GO Tour and friends — collected, not tiered)` : "") +
      (untiered ? ` · ${fmt(untiered)} tracked by progress` : "") +
      ` — ${fmt(tiered + events + untiered)} in total.`;
    inner += `<h4 class="mod-h4">Medal cabinet</h4>
      <div class="mod-sub">${reconcile}</div>
      <div class="medal-cards">${cards}</div>`;
    if (tiers[4] >= 50) {
      inner += `<div class="hw-caption">🏆 <b>${fmt(tiers[4])} Platinum</b> — level 80 requires 50 Platinum medals, so you've cleared that bar.</div>`;
    }
  }

  /* This card mixes two clocks. Level, XP, distance, stardust, eggs and medals
   * are lifetime figures straight from Gameplay.txt; encounters and spins are
   * counted from Player_Journey, which the export only keeps about three years of.
   * Both are right for their source, and calling the whole card "lifetime" made
   * the second pair look wrong. Name the split instead of hiding it. */
  const windowed = (met ? 1 : 0) + (evT["Spins"] ? 1 : 0);
  const subtitle = `Your trainer card${p.startYear ? `, playing since ${p.startYear}` : ""}${p.buddy ? ` · buddy ${esc(p.buddy)}` : ""}.`
    + (windowed ? ` Level, XP, distance and medals are lifetime totals; encounters and spins are counted from your event logs, which reach back about three years.` : "");
  // moduleHTML escapes the title — pass the name raw, or "&" shows as "&amp;"
  return moduleHTML("🎮", (p.username || "Your trainer") + " at a glance", subtitle, inner, "trainer-card");
}

/* ── activity (Player_Journey) ── */
function renderActivity() {
  const e = STATE.ev;
  const total = Object.values(e.totals).reduce((a, b) => a + b, 0);
  if (!total) return;
  const months = monthSpan(Object.keys(e.byMonth));
  const series = Object.keys(e.totals).filter((k) => e.totals[k] > 0).sort((a, b) => e.totals[b] - e.totals[a]);
  const busiestType = series[0];

  const dayKeys = Object.keys(e.dayCounts);
  const activeDays = e.days.size;
  const avgPerDay = activeDays ? Math.round(total / activeDays) : 0;
  let busiestDay = null, busiestN = 0;
  for (const d of dayKeys) { if (e.dayCounts[d] > busiestN) { busiestN = e.dayCounts[d]; busiestDay = d; } }
  const streak = longestStreak(dayKeys);

  // Aim for a tidy 8-card grid (2 rows of 4) to match the trainer card.
  const stats = [
    [fmt(total), "Logged actions", "spins, encounters, raids, berries, battles",
      months.map((mk) => Object.values(e.byMonth[mk] || {}).reduce((a, b) => a + b, 0))],
    [fmt(activeDays), "Active days", "days with at least one action",
      months.map((mk) => Object.keys(e.dayCounts).filter((d) => d.startsWith(mk)).length)],
    [busiestType ? fmt(e.totals[busiestType]) : "0", busiestType ? busiestType + " (top action)" : "—", "your most-repeated action"],
    [fmt(avgPerDay), "Avg / active day", "actions on a day you played"],
    [busiestDay ? fmt(busiestN) : "—", "Busiest day", busiestDay ? "actions on " + fmtDate(parseTS(busiestDay)) : ""],
    [fmt(streak), "Longest day streak", streak ? "days played in a row" : ""],
  ];
  if (e.raidTotal) {
    stats.push([fmt(e.raidRemote), "Remote raids", e.raidTotal ? (e.raidRemote / e.raidTotal * 100).toFixed(0) + "% of raids" : ""]);
    if (e.raidMaxKm) stats.push([fmt(round(e.raidMaxKm)) + " km", "Farthest raid reach", "between you and the gym"]);
  }
  if (stats.length < 8) stats.push([months.length ? fmtMonth(months[0]) + " – " + fmtMonth(months[months.length - 1]) : "—", "Event window", "the span your logs cover"]);
  if (stats.length < 8 && e.geo.size) stats.push([fmt(e.geo.size), "Map hotspots", "distinct places you played"]);
  const cards = stats.slice(0, 8);

  // Visualizations lead the chapter; the data cards sit below them, after a divider.
  const cMonthly = uid(), cDonut = uid(), cClock = uid();
  /* "Your time" puts each moment on the hour the viewer's clock showed at that
   * moment: every timestamp is bucketed by its own local hour, daylight saving
   * included. It used to shift the UTC grid by TODAY's offset, which set half
   * of every year an hour off in any zone that changes its clocks. */
  const localDiffers = e.hourweekLocal.some((row, d) => row.some((n, h) => n !== e.hourweek[d][h]));
  const zone = (() => { try { return (Intl.DateTimeFormat().resolvedOptions().timeZone || "").split("/").pop().replace(/_/g, " "); } catch (err) { return ""; } })();
  let inner = `<div>${chartWrap(cMonthly, "tall")}</div>`;
  inner += `<div class="split" style="margin-top:16px">
    <div>${chartWrap(cDonut)}</div>
    <div>${chartWrap(cClock)}</div>
  </div>`;
  /* The game files an encounter in one of four logs depending on how you met
   * the Pokémon, so the breakdown above splits them across four wedges and never
   * shows the total. Everything here adds them up (catchesOf) and says so — as
   * ENCOUNTERS: the map, incense and lure logs record that you met a Pokémon,
   * never whether you caught it. */
  const ENC_PARTS = { "GO Plus catches": "GO Plus catches", "Encounters": "map encounters", "Incense": "incense encounters", "Lures": "lure encounters" };
  const encParts = Object.keys(ENC_PARTS).filter((k) => e.totals[k]);
  if (encParts.length > 1) {
    inner += `<div class="hw-caption"><b>${fmt(catchesOf(e.totals))} Pokémon encountered in total.</b>
      The game files an encounter by how you found the Pokémon, so the breakdown above splits them across
      ${encParts.map((k) => `${esc(ENC_PARTS[k])} (${fmt(e.totals[k])})`).join(", ")}.
      The map, incense and lure logs say you met a Pokémon, not whether you caught it — so every chapter
      here counts encounters, not catches.</div>`;
  }
  inner += `<div style="margin-top:22px">
    <h4 class="mod-h4">When you play — hour of week</h4>
    ${localDiffers ? `<div class="yoy-metrics" style="margin:0 0 10px" id="tz-${cMonthly}">
      <button class="yoy-chip active" type="button" aria-pressed="true" data-grid="local">Your time${zone ? ` (${esc(zone)})` : ""}</button>
      <button class="yoy-chip" type="button" aria-pressed="false" data-grid="utc">Game time (UTC)</button>
    </div>` : ""}
    <div id="hw-${cMonthly}"></div>
  </div>`;
  inner += `<div style="margin-top:22px">
    <h4 class="mod-h4">Every day you played</h4>
    <div class="yoy-metrics" style="margin:0 0 10px" id="cy-${cMonthly}"></div>
    <div id="cal-${cMonthly}"></div>
  </div>`;
  inner += `<hr class="mod-divider">`;
  inner += statGrid(cards);

  later(() => {
    // monthly stacked timeline
    newChart(cMonthly, {
      type: "bar",
      data: {
        labels: months.map(fmtMonth),
        datasets: series.map((label) => ({
          label, backgroundColor: SERIES_COLORS[label] || C.dim, stack: "a",
          data: months.map((mk) => (e.byMonth[mk] || {})[label] || 0),
        })),
      },
      options: {
        interaction: { mode: "index", intersect: false },
        /* On phones the 9-series legend ate half the canvas — and the doughnut
         * beside it already names every series, so it can go entirely. */
        plugins: { legend: { display: !NARROW_VIEW() }, title: { display: true, text: "Your activity, month by month" } },
        scales: { x: { stacked: true, grid: { display: false }, ticks: { maxTicksLimit: 16 } }, y: { stacked: true, title: { display: true, text: "events" } } },
      },
    });
    // breakdown donut
    newChart(cDonut, {
      type: "doughnut",
      data: { labels: series, datasets: [{ data: series.map((s) => e.totals[s]), backgroundColor: series.map((s) => SERIES_COLORS[s] || C.dim), borderWidth: 0 }] },
      /* Legend under the chart, not beside it. Chart.js pins a right-hand
       * legend hard against the canvas edge (measured: zero right margin) and
       * shoves the doughnut off to the left, so the pair reads as two things
       * pushed apart rather than one centred chart. A bottom legend is centred
       * by Chart.js and keeps the doughnut in the middle of its box. */
      options: { cutout: "60%", plugins: { legend: { position: "bottom", align: "center" }, title: { display: true, text: "What you did most" }, centerText: { unit: "actions" } } },
    });

    // hour grid + 24h play clock, re-rendered together when the timezone chip flips
    let clockChart = null;
    const renderPlayTime = (local) => {
      const grid = local ? e.hourweekLocal : e.hourweek;
      renderHourWeek($("hw-" + cMonthly), grid);
      const byHour = Array.from({ length: 24 }, (_, h) => grid.reduce((a, day) => a + day[h], 0));
      if (clockChart) { const i = CHARTS.indexOf(clockChart); if (i >= 0) CHARTS.splice(i, 1); clockChart.destroy(); }
      clockChart = newChart(cClock, {
        type: "polarArea",
        data: {
          labels: byHour.map((_, h) => hourLabel(h)),
          /* sqrt, not linear: one 7 AM commute spike was flattening every other
           * hour to near the floor alpha */
          datasets: [{ data: byHour, backgroundColor: byHour.map((v) => `rgba(65,216,198,${(0.15 + 0.75 * Math.sqrt(v / Math.max(1, ...byHour))).toFixed(2)})`), borderWidth: 0 }],
        },
        options: {
          plugins: { legend: { display: false }, title: { display: true, text: "Your play clock — events by hour" } },
          /* a clock face needs anchors: label the compass hours, hide the rest */
          scales: { r: { ticks: { display: false }, grid: { color: C.grid },
            pointLabels: { display: true, centerPointLabels: true, color: C.dim,
              font: { size: 10, family: "'JetBrains Mono', monospace" },
              callback: (label, i) => (i % 6 === 0 ? label : "") } } },
        },
      });
    };
    renderPlayTime(true); // default to the viewer's clock — UTC is the expert option
    const tzHost = $("tz-" + cMonthly);
    if (tzHost) {
      const tzChips = [...tzHost.querySelectorAll(".yoy-chip")];
      tzChips.forEach((b) => b.addEventListener("click", () => {
        tzChips.forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-pressed", String(x === b)); });
        renderPlayTime(b.dataset.grid === "local");
      }));
    }

    // GitHub-style calendar, one selectable year at a time
    const calYears = [...new Set(dayKeys.map((d) => d.slice(0, 4)))].sort().reverse();
    const yearsHost = $("cy-" + cMonthly);
    if (calYears.length > 1) {
      yearsHost.innerHTML = calYears.map((y, i) =>
        `<button class="yoy-chip${i === 0 ? " active" : ""}" type="button" aria-pressed="${i === 0}" data-y="${y}">${y}</button>`).join("");
      [...yearsHost.querySelectorAll(".yoy-chip")].forEach((b) => b.addEventListener("click", () => {
        [...yearsHost.querySelectorAll(".yoy-chip")].forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-pressed", String(x === b)); });
        renderCalendar($("cal-" + cMonthly), b.dataset.y, e.dayCounts);
      }));
    }
    renderCalendar($("cal-" + cMonthly), calYears[0], e.dayCounts);
  });

  return moduleHTML("🗺️", "Your adventure log", `Every spin, encounter, raid and battle the game logged — ${fmt(total)} actions across ${fmt(e.days.size)} days.`, inner);
}

/* ── friend comparison: read a compare file (compareFileData) back in — or the
   full stats file older builds offered for the same job, which has the same
   fields and more. Only the trainer name, action totals, months, days and
   friend count are read, and each is cut down to what it should be: a short
   name, non-negative counts, and month and day keys that are real dates. A
   friend's file is somebody else's text. ── */
function parseCompare(text) {
  try {
    const j = JSON.parse(text);
    // only accept what this site itself wrote — the source line is the handshake
    if (!j || typeof j !== "object" || !/POGO Metrics/i.test(j.source || "") || !j.totalsByAction) return;
    const count = (v) => { const n = +v; return Number.isFinite(n) && n >= 0 ? n : null; };
    const counts = (o) => {
      const out = {};
      if (o && typeof o === "object") for (const k of Object.keys(o)) {
        const n = count(o[k]);
        if (n != null && k !== "__proto__") out[k] = n;
      }
      return out;
    };
    const MONTH = /^20\d\d-(0[1-9]|1[0-2])$/, DAY = /^20\d\d-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
    const monthly = {}, dayCounts = {};
    if (j.monthly && typeof j.monthly === "object") for (const m of Object.keys(j.monthly)) {
      if (MONTH.test(m) && j.monthly[m] && typeof j.monthly[m] === "object") monthly[m] = counts(j.monthly[m]);
    }
    if (j.dayCounts && typeof j.dayCounts === "object") for (const d of Object.keys(j.dayCounts)) {
      const n = count(j.dayCounts[d]);
      if (DAY.test(d) && n != null) dayCounts[d] = n;
    }
    const name = j.profile && typeof j.profile.username === "string" ? j.profile.username.trim().slice(0, 40) : "";
    const friends = j.friends && typeof j.friends === "object" ? count(j.friends.total) : null;
    STATE.compare = {
      who: name || "Your friend",
      totals: counts(j.totalsByAction),
      monthly,
      dayCounts,
      friends: friends == null ? undefined : friends,
      generated: typeof j.generated === "string" ? j.generated.slice(0, 40) : undefined,
    };
    STATE.loaded.push("compare");
  } catch (e) { /* not our JSON — ignore */ }
}

function renderCompare() {
  const cmp = STATE.compare;
  if (!cmp) return;
  const mine = STATE.ev.totals;
  const mineTotal = Object.values(mine).reduce((a, b) => a + b, 0);
  const theirsTotal = Object.values(cmp.totals).reduce((a, b) => a + b, 0);
  if (!mineTotal && !theirsTotal) return;
  // Both names stay raw here: statGrid and moduleHTML escape labels and titles
  // themselves, and escaping first as well turned "&" into "&amp;" on the page.
  const me = (STATE.profile && STATE.profile.username) || "You";
  const them = cmp.who;
  const myDays = Object.keys(STATE.ev.dayCounts).length;
  const theirDays = Object.keys(cmp.dayCounts).length;
  const myStreak = longestStreak(Object.keys(STATE.ev.dayCounts));
  const theirStreak = longestStreak(Object.keys(cmp.dayCounts));

  const stats = [
    [fmt(mineTotal), `${me} — logged actions`, ""],
    [fmt(theirsTotal), `${them} — logged actions`, ""],
    [`${fmt(myDays)} vs ${fmt(theirDays)}`, "Days played", "you vs them"],
    [`${fmt(myStreak)} vs ${fmt(theirStreak)}`, "Longest streak", "you vs them"],
  ];

  const kinds = [...new Set([...Object.keys(mine), ...Object.keys(cmp.totals)])]
    .filter((k) => (mine[k] || 0) + (cmp.totals[k] || 0) > 0)
    .sort((a, b) => ((mine[b] || 0) + (cmp.totals[b] || 0)) - ((mine[a] || 0) + (cmp.totals[a] || 0)));
  const cBar = uid(), cLine = uid();
  let inner = statGrid(stats);
  inner += `<div style="margin-top:16px">${chartWrap(cBar)}</div>`;

  // who peaked when — both journeys on one clock
  const allMonths = monthSpan([...new Set([...Object.keys(STATE.ev.byMonth), ...Object.keys(cmp.monthly)])]);
  const monthTotal = (bym, mk) => Object.values(bym[mk] || {}).reduce((a, b) => a + b, 0);
  if (allMonths.length > 1) inner += `<div style="margin-top:16px">${chartWrap(cLine)}</div>`;

  later(() => {
    newChart(cBar, {
      type: "bar",
      data: {
        labels: kinds,
        datasets: [
          { label: String(me), backgroundColor: C.teal, data: kinds.map((k) => mine[k] || 0) },
          { label: cmp.who, backgroundColor: C.purple, data: kinds.map((k) => cmp.totals[k] || 0) },
        ],
      },
      options: {
        indexAxis: "y",
        plugins: { title: { display: true, text: "Action by action" } },
        scales: { x: { grid: { color: C.grid } }, y: { grid: { display: false } } },
      },
    });
    if (allMonths.length > 1) newChart(cLine, {
      type: "line",
      data: {
        labels: allMonths.map(fmtMonth),
        datasets: [
          { label: String(me), borderColor: C.teal, backgroundColor: C.teal, pointRadius: 0, borderWidth: 2, tension: .3, data: allMonths.map((mk) => monthTotal(STATE.ev.byMonth, mk)) },
          { label: cmp.who, borderColor: C.purple, backgroundColor: C.purple, pointRadius: 0, borderWidth: 2, tension: .3, data: allMonths.map((mk) => monthTotal(cmp.monthly, mk)) },
        ],
      },
      options: {
        interaction: { mode: "index", intersect: false },
        plugins: { title: { display: true, text: "Who peaked when — actions per month" } },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 14 } }, y: { grid: { color: C.grid } } },
      },
    });
  });

  return moduleHTML("🤝", `${me} vs ${them}`,
    `Two journeys, side by side — built from a compare file made by this site (names, counts and dates only; nothing uploaded). `
    + `Want to send yours back? Open <b>${window.ICON ? window.ICON("receipt") : ""} My numbers</b> in the toolbar and send your compare file.`,
    inner, "versus-friend");
}

/* ── record book: lifetime superlatives, event days, and a playful benchmark ── */
function renderRecords() {
  const e = STATE.ev;
  const dayKeys = Object.keys(e.dayCounts);
  if (!dayKeys.length) return;
  const total = Object.values(e.totals).reduce((a, b) => a + b, 0);

  let bigDay = null, bigN = 0;
  for (const d of dayKeys) if (e.dayCounts[d] > bigN) { bigN = e.dayCounts[d]; bigDay = d; }
  const bigDayEvent = bigDay ? eventFor(bigDay) : null;

  const monthTotals = Object.entries(e.byMonth).map(([m, kinds]) => [m, Object.values(kinds).reduce((a, b) => a + b, 0)]);
  const bestMonth = monthTotals.sort((a, b) => b[1] - a[1])[0];

  const streak = longestStreakRange(dayKeys);
  const evDays = dayKeys.filter((d) => eventFor(d));
  const evEvents = evDays.reduce((a, d) => a + e.dayCounts[d], 0);
  const firstDay = dayKeys.slice().sort()[0];
  const daysSince = firstDay ? Math.round((Date.now() - new Date(firstDay + "T00:00:00Z")) / 86400000) : 0;

  let socialPeak = null;
  const fm = Object.entries(STATE.friends.monthly).sort((a, b) => b[1] - a[1])[0];
  if (fm) socialPeak = fm;

  // Every sub-line leads with the UNIT the big number counts — a bare "599"
  // under "Biggest day ever" doesn't say 599 of what.
  const stats = [
    [fmt(bigN), "Biggest day ever",
      `actions on ${bigDay ? fmtDate(parseTS(bigDay)) : "—"}${bigDayEvent ? " · " + bigDayEvent : ""}`],
    [bestMonth ? fmt(bestMonth[1]) : "—", "Best month",
      bestMonth ? `actions in ${fmtMonth(bestMonth[0])} — your busiest` : ""],
    [fmt(streak.len), "Longest streak",
      streak.start ? `days played in a row · ${fmtDate(parseTS(streak.start))} → ${fmtDate(parseTS(streak.end))}` : "days played in a row"],
    [fmt(daysSince), "Days since day one",
      firstDay ? `since your first logged action, ${fmtDate(parseTS(firstDay))}` : ""],
  ];
  if (e.raidMaxKm) stats.push([fmt(round(e.raidMaxKm)) + " km", "Farthest raid", "between you and the gym you raided"]);
  if (socialPeak) stats.push([fmt(socialPeak[1]), "Most friends in a month", `friends added in ${fmtMonth(socialPeak[0])}`]);
  if (evDays.length) stats.push([fmt(evDays.length), "GO Fest days attended", `${fmt(evEvents)} actions across those days`]);

  let inner = statGrid(stats.slice(0, 8));

  /* ── next milestones: the record book was purely retrospective — nothing
     looked forward. For each headline counter, find the next round number and
     project an arrival date from the last ~3 months' pace. Recent pace, not
     lifetime: the export reaches back years and people's play changes. ── */
  const monthKeys = Object.keys(e.byMonth).sort();
  const recent = monthKeys.slice(-3);
  const recentDays = Math.max(30, recent.length * 30);
  const rateOf = (fn) => recent.reduce((a, m) => a + fn(e.byMonth[m] || {}), 0) / recentDays;
  const LADDER = [1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000];
  const next = (n) => LADDER.find((l) => l > n);
  const mile = [];
  const addMile = (label, current, rate) => {
    const target = next(current);
    if (!target || !current) return;
    const toGo = target - current;
    const eta = rate > 0.05 ? new Date(Date.now() + (toGo / rate) * 86400000) : null;
    mile.push({ label, current, target, toGo, eta });
  };
  addMile("Pokémon encountered", catchesOf(e.totals), rateOf((k) => catchesOf(k)));
  addMile("PokéStop spins", e.totals["Spins"] || 0, rateOf((k) => k["Spins"] || 0));
  addMile("Raids", e.totals["Raids"] || 0, rateOf((k) => k["Raids"] || 0));
  addMile("Logged actions", total, rateOf((k) => Object.values(k).reduce((a, b) => a + b, 0)));
  if (mile.length) {
    inner += `<hr class="mod-divider"><h4 class="mod-h4">Next milestones</h4>
      <div class="mod-sub" style="margin-bottom:12px">At your pace from the last few months — a reason to come back with next year's export.</div>
      <div class="ms-list">${mile.slice(0, 4).map((m) => `
        <div class="ms-row">
          <div class="ms-top">
            <span class="ms-l">${esc(m.label)}</span>
            <span class="ms-v">${fmt(m.toGo)} to ${fmt(m.target)}${m.eta
              ? ` · ~${m.eta.toLocaleDateString(undefined, { month: "short", year: "numeric" })}
                 <button class="linkish ms-ics" type="button" data-label="${esc(m.label)}" data-target="${m.target}" data-eta="${m.eta.toISOString()}"
                   aria-label="Calendar reminder for ${esc(m.label)} reaching ${fmt(m.target)}">${window.ICON ? window.ICON("calendar") : "📅"}</button>`
              : " · on pause"}</span>
          </div>
          <div class="gen-bar-track"><div class="gen-bar-fill" style="width:${Math.min(100, m.current / m.target * 100).toFixed(1)}%"></div></div>
        </div>`).join("")}</div>`;
  }

  later(() => {
    document.querySelectorAll(".ms-ics").forEach((b) => b.addEventListener("click", () =>
      downloadICS(`Pokémon GO: ~${b.dataset.label} hits ${fmt(+b.dataset.target)}`, new Date(b.dataset.eta),
        "pogo-metrics-milestone.ics")));
  });

  /* first reveal of the personal-best grid earns the celebration beat */
  later(() => {
    const host = document.querySelector('.module[data-anchor="record-book"]');
    if (!host || REDUCED_MOTION || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((x) => x.isIntersecting)) {
        io.disconnect();
        confettiBurst(host, [C.teal, C.yellow, C.orange, C.pink]);
      }
    }, { threshold: 0.35 });
    io.observe(host);
  });

  return moduleHTML("🏅", "Your record book",
    `Your personal bests. An <b>action</b> is any single thing the game logged — a spin, an encounter, a raid, a berry, a gym battle — so ${fmt(total)} actions is the sum of everything you did.`,
    inner, "record-book");
}

/* ── play sessions: reconstruct bouts from the raw timestamps ──
 * Two logged actions more than GAP apart start a new bout. A bout of one
 * action has no measurable length, so it counts but adds no time. */
function buildBouts(stamps, gapMs = 20 * 60 * 1000) {
  if (!stamps || stamps.length < 2) return null;
  const s = Int32Array.from ? stamps.slice().sort((a, b) => a - b) : stamps.sort();
  const bouts = [];
  let start = s[0], prev = s[0], count = 1;
  for (let i = 1; i < s.length; i++) {
    if (s[i] - prev > gapMs) { bouts.push({ start, end: prev, count }); start = s[i]; count = 0; }
    prev = s[i]; count++;
  }
  bouts.push({ start, end: prev, count });
  const durations = bouts.map((b) => b.end - b.start);
  const totalMs = durations.reduce((a, b) => a + b, 0);
  // A one-action session has no measurable length. Including those zeros drags
  // the median to 0 whenever singletons are the majority (which is exactly what
  // happens on a downsampled export), so measure across real sessions only.
  const measurable = durations.filter((d) => d > 0).sort((a, b) => a - b);
  const median = measurable.length ? measurable[Math.floor(measurable.length / 2)] : 0;
  const singles = durations.length - measurable.length;
  let longest = bouts[0];
  for (const b of bouts) if (b.end - b.start > longest.end - longest.start) longest = b;
  return { bouts, count: bouts.length, totalMs, median, longest, singles };
}
function humanDur(ms) {
  const mins = Math.round(ms / 60000);
  if (mins < 60) return mins + " min";
  const h = Math.floor(mins / 60), m = mins % 60;
  if (h < 24) return h + "h" + (m ? " " + m + "m" : "");
  const d = Math.floor(h / 24);
  return d + " day" + (d === 1 ? "" : "s") + (h % 24 ? " " + (h % 24) + "h" : "");
}

/* ── what's in your bag ── */
function renderBag() {
  const b = STATE.bag;
  if (!b || !b.items.length) return;

  const stats = [
    [fmt(b.bagTotal), "Items in your bag", `${fmt(b.distinct)} different kinds`],
    [b.items[0] ? fmt(b.items[0].n) : "—", "Most-stocked item", b.items[0] ? b.items[0].name : ""],
  ];
  const balls = b.groups["Poké Balls"] || 0;
  const berries = b.groups["Berries"] || 0;
  if (balls) stats.push([fmt(balls), "Poké Balls ready", "across every ball type"]);
  if (berries) stats.push([fmt(berries), "Berries", "for catches and gym defenders"]);
  let inner = statGrid(stats);

  const groups = Object.entries(b.groups).sort((a, c) => c[1] - a[1]);
  const cId = uid();
  inner += `<div class="split" style="margin-top:16px">
    <div>${chartWrap(cId)}</div>
    <div><h4 class="mod-h4">Your ten deepest stacks</h4>
      ${rankList(b.items.slice(0, 10).map((i) => [i.name, i.n]))}</div>
  </div>`;
  later(() => newChart(cId, {
    type: "doughnut",
    data: {
      labels: groups.map((g) => g[0]),
      datasets: [{ data: groups.map((g) => g[1]),
        backgroundColor: groups.map((g) => (BAG_GROUPS.find((x) => x[0] === g[0]) || [, , C.dim])[2]), borderWidth: 0 }],
    },
    options: { cutout: "58%", plugins: { legend: { position: "bottom", align: "center" }, title: { display: true, text: "What your bag is made of" } } },
  }));

  /* Eggs live in their own section of Gameplay.txt rather than the item list,
   * so they never appeared in a bag chapter built from items alone. */
  const eg = STATE.eggs;
  if (eg && eg.held) {
    const tiers = Object.entries(eg.tiers).sort((a, c) => +a[0] - +c[0]);
    inner += `<hr class="mod-divider"><h4 class="mod-h4">Your egg bench</h4>
      <div class="mod-sub" style="margin-bottom:10px">
        <b>${fmt(eg.held)}</b> egg${eg.held === 1 ? "" : "s"} in your bag right now, ${
          eg.incubating ? `<b>${fmt(eg.incubating)}</b> of them walking in an incubator` : "none of them incubating"}${
          eg.idleIncubators ? ` — and <b>${fmt(eg.idleIncubators)}</b> incubator${eg.idleIncubators === 1 ? "" : "s"} sitting unused` : ""}.
        ${tiers.length ? "By distance: " + tiers.map(([km, n]) => `<b>${n}×</b> ${km} km`).join(" · ") + "." : ""}
      </div>`;
  }

  // Niantic's own item count is mostly not bag items at all — say so, because
  // that number is in the export and ours would otherwise look wrong.
  const asides = [];
  if (b.points) asides.push(`<b>${fmt(b.points)}</b> event pass points`);
  if (b.resources) asides.push(`<b>${fmt(b.resources)}</b> fusion and crafting resources`);
  if (asides.length) {
    inner += `<div class="hw-caption">The game counts ${fmt(b.declared)} “items” for you, but that total includes
      ${asides.join(" and ")} — progress currencies rather than things in your bag. The ${fmt(b.bagTotal)} above is
      what you are actually carrying.</div>`;
  }

  return moduleHTML("🎒", "What's in your bag", `${fmt(b.bagTotal)} items across ${fmt(b.distinct)} kinds, as of your last sync.`, inner);
}

/* ── "your rhythm": how you actually played, not just how much ── */
function renderRhythm() {
  const e = STATE.ev;
  const b = buildBouts(e.stamps);
  const topFort = [...e.forts.values()].sort((x, y) => y.n - x.n)[0];
  const topGym = [...e.gyms.values()].sort((x, y) => y.n - x.n)[0];
  // Every part can be absent (one tiny Player_Journey file yields no measurable
  // sessions, no repeat stop and no repeat gym) — don't emit a chapter heading
  // with no body.
  if (!b && !(topFort && topFort.n > 1) && !(topGym && topGym.n > 1)) return;

  let inner = "";
  if (b) {
    const totalActions = e.stamps.length;
    const perBout = b.count ? Math.round(totalActions / b.count) : 0;
    const stats = [
      [fmt(b.count), "Play sessions", "runs of activity, split after a 20-min gap"],
      [humanDur(b.totalMs), "Time in the game", "measured between first and last action of each session"],
      [b.median ? humanDur(b.median) : "—", "Typical session", b.median ? "median, across sessions with more than one action" : "not enough closely-spaced actions to measure"],
      [humanDur(b.longest.end - b.longest.start), "Longest session ever", fmtDate(new Date(b.longest.start)) + " · " + fmt(b.longest.count) + " actions"],
      [fmt(perBout), "Actions per session", "on an average outing"],
    ];
    inner += statGrid(stats);
    inner += `<div class="hw-caption">Sessions are reconstructed from the timestamps in your Player_Journey files, so they only cover
      logged actions — idle time with the app open isn't counted.${window.DEMO_PAGE
        ? " <b>Note:</b> this sample export is downsampled, so its sessions look shorter and more scattered than a real one would."
        : ""}</div>`;

    // session-length distribution
    const buckets = [[0, 5, "< 5 min"], [5, 15, "5–15"], [15, 30, "15–30"], [30, 60, "30–60"], [60, 120, "1–2 h"], [120, Infinity, "2 h+"]];
    const counts = buckets.map(([lo, hi]) => b.bouts.filter((x) => { const m = (x.end - x.start) / 60000; return m >= lo && m < hi; }).length);
    const cId = uid();
    inner += `<div style="margin-top:16px">${chartWrap(cId)}</div>`;
    later(() => newChart(cId, {
      type: "bar",
      data: { labels: buckets.map((x) => x[2]), datasets: [{ data: counts, label: "sessions", backgroundColor: C.teal }] },
      options: { plugins: { legend: { display: false }, title: { display: true, text: "How long you play, per session" } },
        scales: { y: { beginAtZero: true, title: { display: true, text: "sessions" } }, x: { grid: { display: false } } } },
    }));
  }

  // regular haunts — the stop you keep coming back to
  if (topFort && topFort.n > 1) {
    const forts = [...e.forts.values()].sort((x, y) => y.n - x.n);
    const totalSpins = forts.reduce((a, f) => a + f.n, 0);
    const top5 = forts.slice(0, 5).reduce((a, f) => a + f.n, 0);
    const years = (topFort.last - topFort.first) / 31557600000;
    inner += `<hr class="mod-divider"><h4 class="mod-h4">Your regular haunts</h4>
      <div class="mod-sub" style="margin-bottom:10px">
        You've visited <b>${fmt(forts.length)}</b> distinct PokéStops. Your number one accounts for
        <b>${fmt(topFort.n)}</b> visits${years >= 0.15 ? ` across <b>${years.toFixed(1)} years</b>` : ""} —
        first on ${fmtDate(topFort.first)}, most recently ${fmtDate(topFort.last)}.
        Your top five are <b>${Math.round(top5 / totalSpins * 100)}%</b> of the visits we can place on the map.
      </div>`;
    /* Deliberately NOT printing the coordinates. The site tells people to
     * screenshot and share these chapters, and a ~110 m fix on someone's
     * most-visited stop is their home address. Rank and counts carry the story;
     * the position stays on the globe, where the user already expects it. */
    inner += rankList(forts.slice(0, 8).map((f, i) => [
      "Stop #" + (i + 1) + (i === 0 ? " — your local" : ""),
      f.n,
    ]), (v) => fmt(v) + " visits");
    inner += `<div class="hw-caption">The export gives coordinates but no stop names, so your stops are ranked rather than named.${e.blurredRows
      ? " Only the precise 15-month “1” files rank here — the 3-year “2” files blur every position to a few kilometres in the export itself, so their older events feed the timeline, not this list." : ""}
      Coordinates are deliberately not printed here — this chapter is safe to screenshot.</div>`;
  }

  /* The raid-gym twin of the stop ranking above. Gym_Latitude/Longitude have
   * been parsed into e.gyms since the raid-distance work and read by nothing —
   * the same "one place I keep going back to" story, for raiders. */
  if (topGym && topGym.n > 1) {
    const gyms = [...e.gyms.values()].sort((x, y) => y.n - x.n);
    const totalLobbies = gyms.reduce((a, g) => a + g.n, 0);
    const top5 = gyms.slice(0, 5).reduce((a, g) => a + g.n, 0);
    const years = (topGym.last - topGym.first) / 31557600000;
    inner += `<hr class="mod-divider"><h4 class="mod-h4">The gyms you keep raiding</h4>
      <div class="mod-sub" style="margin-bottom:10px">
        You've raided at <b>${fmt(gyms.length)}</b> distinct gyms. Your number one accounts for
        <b>${fmt(topGym.n)}</b> lobbies${years >= 0.15 ? ` across <b>${years.toFixed(1)} years</b>` : ""} —
        first on ${fmtDate(topGym.first)}, most recently ${fmtDate(topGym.last)}.
        Your top five are <b>${Math.round(top5 / totalLobbies * 100)}%</b> of every lobby you joined.
      </div>`;
    inner += rankList(gyms.slice(0, 8).map((g, i) => [
      "Gym #" + (i + 1) + (i === 0 ? " — your home gym" : ""),
      g.n,
    ]), (v) => fmt(v) + " lobbies");
    inner += `<div class="hw-caption">Remote raids count here too, so a gym you've never stood next to can still top this list.
      As above, the coordinates stay off the page.</div>`;
  }

  return moduleHTML("⏱️", "Your rhythm", "How you actually play — in sessions, and in the places you keep returning to.", inner);
}

/* ── the last stretch Niantic wrote down (Gameplay.txt's rolling log) ──
 * Every other chapter is an aggregate over years. This one is a single session
 * in full detail — the only place in the whole export where individual Pokémon
 * are named and their CP recorded. Deliberately framed as one recent window,
 * because that is all Niantic keeps here. */
function renderRecentLog() {
  const R = STATE.recent;
  if (!R || !R.rows) return;
  const caught = R.caught.length, fled = R.fled.length, encounters = caught + fled;
  const spanMs = R.last && R.first ? R.last - R.first : 0;

  const stats = [];
  if (encounters) {
    stats.push([Math.round(caught / encounters * 100) + "%", "Catch rate",
      `${fmt(caught)} caught, ${fmt(fled)} got away`]);
  }
  if (R.items) {
    stats.push([fmt(R.items), "Items picked up",
      `${fmt(R.spins.PokeStop)} stop${R.spins.PokeStop === 1 ? "" : "s"} · ${fmt(R.spins.Gym)} gym${R.spins.Gym === 1 ? "" : "s"} spun`]);
  }
  if (R.spins.PokeStop + R.spins.Gym) {
    stats.push([(R.items / (R.spins.PokeStop + R.spins.Gym)).toFixed(1), "Items per spin", "what the stops actually gave you"]);
  }
  if (R.gifts) stats.push([fmt(R.gifts), "Gifts from friends", `${fmt(R.giftItems)} item${R.giftItems === 1 ? "" : "s"} inside`]);
  if (R.hatched.length) stats.push([fmt(R.hatched.length), "Eggs hatched", "in this window"]);
  if (R.research) stats.push([fmt(R.research), "Research tasks done"]);
  if (R.buddyCandy) stats.push([fmt(R.buddyCandy), "Buddy candy found"]);
  if (spanMs > 60000) stats.push([humanDur(spanMs), "Window length", "first to last entry in the log"]);
  let inner = statGrid(stats.slice(0, 8));

  const byCP = (a, b) => b.cp - a.cp;
  const best = R.caught.slice().sort(byCP)[0];
  const escapees = R.fled.slice().sort(byCP).slice(0, 6);
  if (best || escapees.length) {
    inner += `<div class="split" style="margin-top:18px">
      <div>${best ? `<h4 class="mod-h4">Your best catch of the day</h4>
        ${rankList(R.caught.slice().sort(byCP).slice(0, 6).map((p) => [p.name, p.cp]), (v) => "CP " + fmt(v))}` : ""}</div>
      <div>${escapees.length ? `<h4 class="mod-h4">The ones that got away</h4>
        ${rankList(escapees.map((p) => [p.name, p.cp]), (v) => "CP " + fmt(v))}` : ""}</div>
    </div>`;
  }

  inner += `<div class="hw-caption">This log is the short rolling window the export attaches to <code>Gameplay.txt</code> — usually the
    last few hours you played, not your whole history. It is also the only place in the entire export where individual
    Pokémon are named and their CP recorded${best ? `, which is how we know ${esc(best.name)} at CP ${fmt(best.cp)} was the best thing you caught that day` : ""}.${
    R.gifts ? ` Since August 2026 it also names the friend behind each gift you open; those lines are counted as gifts here, and the names are never kept.` : ""}</div>`;

  const when = R.first ? fmtDate(R.first) : "";
  return moduleHTML("🔍", "Your last day on the map",
    `A close-up of ${when ? "<b>" + esc(when) + "</b>" : "your most recent logged session"} — ${fmt(R.rows)} entries, moment by moment.`,
    inner);
}

/* ── GO Snapshot photos (ImageData.txt) ── */
function renderPhotos() {
  const P = STATE.photos;
  if (!P.total) return;
  const months = monthSpan(Object.keys(P.monthly));
  const best = Object.entries(P.monthly).sort((a, b) => b[1] - a[1])[0];
  const bestDay = Object.entries(P.days).sort((a, b) => b[1] - a[1])[0];
  const bestDayEvent = bestDay ? eventFor(bestDay[0]) : null;
  const activeMonths = Object.keys(P.monthly).length;

  const stats = [
    [fmt(P.total), "Snapshots taken", activeMonths ? `across ${fmt(activeMonths)} different months` : ""],
    [best ? fmt(best[1]) : "—", "Busiest month", best ? fmtMonth(best[0]) : ""],
    [bestDay ? fmt(bestDay[1]) : "—", "Most in one day",
      bestDay ? fmtDate(parseTS(bestDay[0])) + (bestDayEvent ? " · " + bestDayEvent : "") : ""],
    // photos don't roll off an export the way the GPS trail does, so this is no window's edge
    [P.first ? fmtDate(P.first) : "—", "Oldest photo on record"],
  ];
  let inner = statGrid(stats);

  const cId = uid();
  inner += `<div style="margin-top:16px">${chartWrap(cId)}</div>`;
  later(() => newChart(cId, {
    type: "bar",
    data: {
      labels: months.map(fmtMonth),
      /* single-series charts wear the neutral accent — pink is Lures' identity
       * in the flagship charts, and reusing it here taught the wrong mapping */
      datasets: [{ label: "Snapshots", backgroundColor: C.teal, data: months.map((m) => P.monthly[m] || 0) }],
    },
    options: {
      plugins: { legend: { display: false }, title: { display: true, text: "Snapshots you took, month by month" } },
      scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 14 } }, y: { beginAtZero: true, title: { display: true, text: "photos" } } },
    },
  }));

  inner += `<div class="hw-caption">Your export lists a reference and a date for every GO Snapshot — never the picture itself, and never
    where it was taken. That makes this the one file in the whole export that is all story and no exposure, which is why it gets a chapter.</div>`;

  return moduleHTML("📸", "Your photo album",
    `${fmt(P.total)} GO Snapshots${P.first && P.last ? `, between ${esc(fmtDate(P.first))} and ${esc(fmtDate(P.last))}` : ""}.`,
    inner);
}

/* ── Campfire: meetups, club chat, your Campfire circle ── */
function renderCampfire() {
  const cf = STATE.campfire;
  if (!cf) return;
  const pct = (a, b) => (b ? Math.round((a / b) * 100) : 0);
  const hoursLabel = (h) => (h === 1 ? "an hour" : `${+h.toFixed(1)} hours`);
  const stats = [];
  if (cf.checkins || cf.rsvps) stats.push([fmt(cf.checkins), "Meetups you showed up for", cf.rsvps ? `of ${fmt(cf.rsvps)} you RSVP'd to — a ${pct(cf.checkins, cf.rsvps)}% show-up rate` : ""]);
  // Event End Time: how long the meetups you checked into ran, and how many turned up
  if (cf.meetupHours && cf.meetupHours.length) stats.push([fmt(Math.round(cf.hoursOut)) + " h", "Hours at meetups", `a typical one ran ${hoursLabel(medianOf(cf.meetupHours))}`]);
  const rsvpd = cf.crowdRsvp && cf.crowdRsvp.length ? Math.round(medianOf(cf.crowdRsvp)) : 0;
  if (cf.crowd && cf.crowd.length) stats.push([fmt(Math.round(medianOf(cf.crowd))), "Typical turnout", `trainers checked in at a typical meetup you joined${rsvpd ? `, and ${fmt(rsvpd)} RSVP'd` : ""} · biggest ${fmt(Math.max(...cf.crowd))}`]);
  else if (rsvpd) stats.push([fmt(rsvpd), "Typical RSVPs", `trainers RSVP'd to a typical meetup you joined · biggest ${fmt(Math.max(...cf.crowdRsvp))}`]);
  if (cf.hosted) stats.push([fmt(cf.hosted), "Meetups you hosted", `drawing ${fmt(cf.hostedRsvps)} RSVPs and ${fmt(cf.hostedCheckins)} check-ins${cf.hostedHours ? ` over ${fmt(Math.round(cf.hostedHours))} hours` : ""}`]);
  if (cf.messages) stats.push([fmt(cf.messages), "Messages to your clubs", cf.msgFirst ? `since ${fmtDate(cf.msgFirst)}` : ""]);
  if (cf.friends) {
    const top = Object.entries(cf.friendSources).sort((a, b) => b[1] - a[1])[0];
    stats.push([fmt(cf.friends), "Campfire friends", top ? `${pct(top[1], cf.friends)}% via ${prettySource(top[0])}` : ""]);
  }
  let inner = statGrid(stats);

  const months = monthSpan([...Object.keys(cf.rsvpMonthly), ...Object.keys(cf.checkinMonthly), ...Object.keys(cf.hostedMonthly)]);
  const mMonths = monthSpan(Object.keys(cf.msgMonthly));
  if (months.length || mMonths.length) {
    const c1 = uid(), c2 = uid();
    inner += `<div class="split" style="margin-top:18px">${months.length ? chartWrap(c1) : ""}${mMonths.length ? chartWrap(c2) : ""}</div>`;
    if (months.length) later(() => newChart(c1, {
      type: "bar",
      data: {
        labels: months.map(fmtMonth),
        datasets: [
          { label: "Checked in", backgroundColor: C.orange, stack: "m", data: months.map((m) => cf.checkinMonthly[m] || 0) },
          { label: "RSVP'd, no check-in", backgroundColor: alpha(C.orange, 0.35), stack: "m", data: months.map((m) => Math.max(0, (cf.rsvpMonthly[m] || 0) - (cf.checkinMonthly[m] || 0))) },
          { label: "Hosted", backgroundColor: C.yellow, stack: "h", data: months.map((m) => cf.hostedMonthly[m] || 0) },
        ],
      },
      options: {
        interaction: { mode: "index", intersect: false },
        plugins: { title: { display: true, text: "Meetups, month by month" } },
        scales: { x: { stacked: true, grid: { display: false }, ticks: { maxTicksLimit: 12 } }, y: { stacked: true, beginAtZero: true, title: { display: true, text: "meetups" } } },
      },
    }));
    if (mMonths.length) later(() => newChart(c2, {
      type: "bar",
      data: { labels: mMonths.map(fmtMonth), datasets: [{ label: "Messages", backgroundColor: C.teal, data: mMonths.map((m) => cf.msgMonthly[m] || 0) }] },
      options: {
        plugins: { legend: { display: false }, title: { display: true, text: "Club chat, month by month" } },
        scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 12 } }, y: { beginAtZero: true, title: { display: true, text: "messages" } } },
      },
    }));
  }

  const kinds = Object.entries(cf.checkins ? cf.kinds : cf.kindsRsvp).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const bits = [];
  if (cf.clubs) bits.push([fmt(cf.clubs), cf.clubs === 1 ? "club" : "clubs"]);
  if (cf.channels) bits.push([fmt(cf.channels), cf.channels === 1 ? "channel you created" : "channels you created"]);
  if (cf.posts) bits.push([fmt(cf.posts), "map posts"]);
  if (cf.comments) bits.push([fmt(cf.comments), "comments"]);
  if (cf.checkinDays) bits.push([fmt(cf.checkinDays), "different days out at a meetup"]);
  /* Chattiest hour, in the viewer's clock. Each message lands in its OWN local
   * hour — the offset in force on the day it was sent — where this used to
   * shift every message by today's offset: under daylight saving, half a year
   * of evenings then sat an hour off. */
  let hourLine = "";
  if (cf.messages) {
    const local = Array(24).fill(0);
    for (const k in cf.msgSlotUTC) local[slotDate(k).getHours()] += cf.msgSlotUTC[k];
    let bh = 0, bn = -1;
    for (let h = 0; h < 24; h++) if (local[h] > bn) { bn = local[h]; bh = h; }
    hourLine = `Your chattiest hour is <b>${hourLabel(bh)}</b>, in your local time.`;
  }
  const asked = cf.friendsYouAsked + cf.friendsTheyAsked;
  const askLine = asked ? `On Campfire you sent the friend request <b>${pct(cf.friendsYouAsked, asked)}%</b> of the time. ` : "";
  inner += `<div class="split" style="margin-top:16px">
    <div>${kinds.length ? `<h4 class="mod-h4">What gets you out the door</h4>${rankList(kinds, (v) => fmt(v) + (cf.checkins ? " check-ins" : " RSVPs"))}` : ""}</div>
    <div>${bits.length ? `<h4 class="mod-h4">Around the fire</h4>${calloutRow(bits)}` : ""}
      ${askLine || hourLine ? `<div class="mod-sub" style="margin-top:12px">${askLine}${hourLine}</div>` : ""}
    </div>
  </div>`;
  inner += `<div class="hw-caption">Campfire's export is mostly words — every message, comment and post you wrote — plus the coordinates of every meetup you joined.
    This chapter keeps only counts and dates: message text, club and event names, meetup locations and the IP address in that file are dropped as it is read, and never shown.${
    cf.meetupHours && cf.meetupHours.length ? ` Meetup hours use each listing's start and end, up to ${CF_MAX_HOURS} hours apiece, so a weekend-long listing doesn't count as sixty.` : ""}</div>`;
  const sub = cf.checkins
    ? `${fmt(cf.checkins)} meetups attended${cf.hosted ? `, ${fmt(cf.hosted)} hosted` : ""}${cf.messages ? `, ${fmt(cf.messages)} messages to your clubs` : ""}.`
    : cf.messages ? `${fmt(cf.messages)} messages to your clubs${cf.friends ? ` and ${fmt(cf.friends)} Campfire friends` : ""}.`
    : "Your Campfire circle.";
  return moduleHTML("🔥", "Around the Campfire", sub, inner, "campfire");
}

function isoShift(iso, delta) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
function longestStreak(isoDays) {
  return longestStreakRange(isoDays).len;
}
/* like longestStreak, but keeps the dates so records can say WHEN */
function longestStreakRange(isoDays) {
  if (!isoDays.length) return { len: 0, start: null, end: null };
  const set = new Set(isoDays);
  let best = { len: 0, start: null, end: null };
  for (const d of set) {
    if (set.has(isoShift(d, -1))) continue; // only count from the start of a run
    let len = 1, cur = d;
    while (set.has(isoShift(cur, 1))) { cur = isoShift(cur, 1); len++; }
    if (len > best.len) best = { len, start: d, end: cur };
  }
  return best;
}
/* Count-up animation for stat values — the number is already in the DOM as
 * text; this just plays it in when it scrolls into view. Purely decorative,
 * so reduced-motion users simply see the final value. */
let COUNT_IO = null;
function wireCountUps(root) {
  if (REDUCED_MOTION || !("IntersectionObserver" in window)) return;
  if (COUNT_IO) COUNT_IO.disconnect();
  COUNT_IO = new IntersectionObserver((entries) => {
    entries.forEach((en) => {
      if (!en.isIntersecting) return;
      COUNT_IO.unobserve(en.target);
      const el = en.target, final = el.textContent;
      const n = parseInt(final.replace(/,/g, ""), 10);
      if (!n || n < 10) return;
      const t0 = performance.now(), dur = 650;
      const tick = (t) => {
        const p = Math.min(1, (t - t0) / dur), ease = 1 - Math.pow(1 - p, 3);
        el.textContent = fmt(Math.round(n * ease));
        if (p < 1) requestAnimationFrame(tick); else el.textContent = final;
      };
      requestAnimationFrame(tick);
      setTimeout(() => { el.textContent = final; }, dur + 250); // rAF doesn't fire in hidden tabs
    });
  }, { threshold: 0.4 });
  root.querySelectorAll(".stat-card .v, .wc-big").forEach((el) => {
    if (/^[\d,]+$/.test(el.textContent.trim())) COUNT_IO.observe(el);
  });
}
function hourLabel(h) {
  return h === 0 ? "12 AM" : h < 12 ? h + " AM" : h === 12 ? "12 PM" : (h - 12) + " PM";
}
/* Shared intensity ramp for the heat visuals. sqrt, not linear: play data is
 * heavy-tailed (one GO Fest day can log 50-100x a normal day), and a linear
 * ramp against that max flattened every ordinary day to the floor alpha —
 * exactly the most engaged players got the flattest-looking grids. */
const heatAlpha = (n, max, lo, span) => lo + span * Math.sqrt(max ? n / max : 0);
/* the swatch key states the encoding once per grid — GitHub's calendar ships
 * the same "less → more" strip for the same reason */
const heatKey = (lo, span) =>
  ` <span class="heat-key" aria-hidden="true">Less ${[0.08, 0.28, 0.55, 0.8, 1].map((t) =>
    `<i style="background:rgba(65,216,198,${heatAlpha(t, 1, lo, span).toFixed(2)})"></i>`).join("")} More</span>`;

function renderHourWeek(host, grid) {
  if (!host) return;
  const max = Math.max(1, ...grid.flat());
  let html = `<div class="hw-grid">`;
  for (let d = 0; d < 7; d++) {
    html += `<div class="hw-row"><span class="hw-lbl">${DAYS[d]}</span>`;
    for (let h = 0; h < 24; h++) {
      const n = grid[d][h];
      const bg = n === 0 ? "rgba(255,255,255,.04)" : `rgba(65,216,198,${heatAlpha(n, max, 0.14, 0.86).toFixed(2)})`;
      html += `<div class="hw-cell" style="background:${bg}" data-info="${DAYS[d]} · ${hourLabel(h)}" data-sub="${fmt(n)} event${n === 1 ? "" : "s"}"></div>`;
    }
    html += `</div>`;
  }
  html += `<div class="hw-axis"><span></span>`;
  for (let h = 0; h < 24; h++) html += `<span>${h % 6 === 0 ? (h === 0 ? "12a" : h < 12 ? h + "a" : h === 12 ? "12p" : (h - 12) + "p") : ""}</span>`;
  html += `</div></div>`;
  // name the peak in text — the hover tooltip is unreachable on touch and for AT
  let bd = 0, bh = 0, bn = 0;
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) if (grid[d][h] > bn) { bn = grid[d][h]; bd = d; bh = h; }
  if (bn) html += `<div class="hw-caption">Busiest: <b>${DAY_FULL[bd]} around ${hourLabel(bh)}</b> — ${fmt(bn)} events. Tap any cell for its count.${heatKey(0.14, 0.86)}</div>`;
  /* The grid itself is 168 background colours and nothing else. Ship the same
   * numbers as a table so they can be read rather than only looked at. */
  html += srTable(
    "Events by day of week and hour of day" + (bn ? `. Busiest ${DAY_FULL[bd]} at ${hourLabel(bh)} with ${fmt(bn)} events.` : "."),
    ["Day", ...Array.from({ length: 24 }, (_, h) => hourLabel(h))],
    DAY_FULL.map((day, d) => [day, ...grid[d].map((n) => fmt(n))]),
  );
  host.innerHTML = html;
  attachHourWeekTip(host);
}
/* Immediate, cursor-following tooltip for the hour-of-week grid so the hovered
 * day + time is always clear (the native title tooltip is slow and easy to miss). */
function attachHourWeekTip(host) {
  const gridEl = host.querySelector(".hw-grid, .cal-grid");
  if (!gridEl) return;
  let tip = document.querySelector(".hw-tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "hw-tip";
    document.body.appendChild(tip);
  }
  const place = (x, y) => {
    const pad = 14, r = tip.getBoundingClientRect();
    let px = x + pad, py = y + pad;
    if (px + r.width > window.innerWidth - 8) px = x - r.width - pad;
    if (py + r.height > window.innerHeight - 8) py = y - r.height - pad;
    tip.style.left = px + "px";
    tip.style.top = py + "px";
  };
  // dataset hands back DECODED text (the cell's attributes were escaped), so it
  // goes in as text — parsing it as HTML again would undo that escaping
  const fill = (cell) => {
    const b = document.createElement("b"), s = document.createElement("span");
    b.textContent = cell.dataset.info || "";
    s.textContent = cell.dataset.sub || "";
    tip.textContent = "";
    tip.append(b, s);
    tip.classList.add("on");
  };
  const show = (ev) => {
    const cell = ev.target.closest("[data-info]");
    if (!cell) { tip.classList.remove("on"); return; }
    fill(cell);
    place(ev.clientX, ev.clientY);
  };
  // keyboard variant: position from the CELL's rect — there is no cursor
  const showForCell = (cell) => {
    fill(cell);
    const r = cell.getBoundingClientRect();
    place(r.right, r.bottom);
  };
  gridEl.addEventListener("mousemove", show);
  gridEl.addEventListener("mouseleave", () => tip.classList.remove("on"));
  gridEl.addEventListener("click", show); // tap support on touch screens

  /* ── keyboard: the captions say "tap any cell", and touch targets were even
     widened — keyboard was the one modality left with no way to inspect a
     cell. One tab stop per grid; arrows move a selection ring; the shared tip
     shows the selected cell's numbers. sr-only tables remain the AT path —
     this is for sighted keyboard users. ── */
  const cells = [...gridEl.querySelectorAll("[data-info]")];
  if (!cells.length) return;
  const isCal = gridEl.classList.contains("cal-grid");
  // hw flows row-major (24 per row); the calendar flows column-major (7 per week)
  const stepH = isCal ? 7 : 1;
  const stepV = isCal ? 1 : 24;
  gridEl.tabIndex = 0;
  gridEl.setAttribute("role", "group");
  gridEl.setAttribute("aria-label", (isCal ? "Daily activity calendar" : "Hour-of-week activity grid")
    + ". Arrow keys move between cells; the selected cell's count is shown and announced.");
  let sel = -1;
  const select = (i) => {
    if (sel >= 0 && cells[sel]) cells[sel].classList.remove("kb-sel");
    sel = Math.max(0, Math.min(cells.length - 1, i));
    const cell = cells[sel];
    cell.classList.add("kb-sel");
    cell.scrollIntoView({ block: "nearest", inline: "nearest" });
    showForCell(cell);
    announce(`${cell.dataset.info}: ${cell.dataset.sub}`);
  };
  gridEl.addEventListener("keydown", (e) => {
    const step = { ArrowRight: stepH, ArrowLeft: -stepH, ArrowDown: stepV, ArrowUp: -stepV }[e.key];
    if (step != null) { e.preventDefault(); select(sel < 0 ? 0 : sel + step); return; }
    if (e.key === "Escape" && sel >= 0) { cells[sel].classList.remove("kb-sel"); sel = -1; tip.classList.remove("on"); }
  });
  gridEl.addEventListener("blur", () => {
    if (sel >= 0 && cells[sel]) cells[sel].classList.remove("kb-sel");
    sel = -1;
    tip.classList.remove("on");
  });

  if (!tip.dataset.wired) { // the tip element is shared across rebuilds — wire window once
    tip.dataset.wired = "1";
    window.addEventListener("scroll", () => tip.classList.remove("on"), { passive: true });
  }
}

/* GitHub-style contribution calendar for one year of dayCounts (UTC days) */
function renderCalendar(host, year, dayCounts) {
  if (!host || !year) return;
  const first = new Date(Date.UTC(+year, 0, 1));
  const startDow = (first.getUTCDay() + 6) % 7; // Monday = 0
  const yearMax = Math.max(1, ...Object.entries(dayCounts).filter(([d]) => d.startsWith(year)).map(([, n]) => n));
  let cells = "";
  // leading blanks so the first column starts on the right weekday
  for (let i = 0; i < startDow; i++) cells += `<div class="cal-cell blank"></div>`;
  const d = new Date(first);
  let dayOfYear = 0;
  while (d.getUTCFullYear() === +year) {
    const iso = d.toISOString().slice(0, 10);
    const n = dayCounts[iso] || 0;
    const ev = eventFor(iso);
    const bg = n === 0 ? "rgba(255,255,255,.045)" : `rgba(65,216,198,${heatAlpha(n, yearMax, 0.18, 0.82).toFixed(2)})`;
    cells += `<div class="cal-cell${ev && n ? " ev" : ""}" style="background:${bg}" data-info="${fmtDate(d)}${ev ? " · " + esc(ev) : ""}" data-sub="${n ? fmt(n) + " event" + (n > 1 ? "s" : "") : "no play logged"}"></div>`;
    d.setUTCDate(d.getUTCDate() + 1);
    dayOfYear++;
  }
  /* month axis — a bright cluster you can't date is not a memory. Each label
   * is grid-column-placed at the week column its month starts in, inside the
   * same scroller as the cells so they can't drift apart. */
  const monthLabels = MONTHS.map((m, i) => {
    const col = Math.floor((startDow + (Date.UTC(+year, i, 1) - Date.UTC(+year, 0, 1)) / 86400000) / 7);
    return `<span style="grid-column:${col + 1}">${m}</span>`;
  }).join("");
  const played = Object.keys(dayCounts).filter((k) => k.startsWith(year)).length;
  const evDays = Object.keys(dayCounts).filter((k) => k.startsWith(year) && eventFor(k)).length;
  /* Summarised BY MONTH rather than reproducing all 365 cells: a table with a
   * row per day would be technically complete and miserable to move through,
   * and most of its rows are zero. Twelve rows carry the same shape. */
  const byMonth = MONTHS.map((m, i) => {
    const pre = `${year}-${String(i + 1).padStart(2, "0")}`;
    const keys = Object.keys(dayCounts).filter((k) => k.startsWith(pre));
    return [m, fmt(keys.length), fmt(keys.reduce((a, k) => a + dayCounts[k], 0))];
  });
  host.innerHTML = `<div class="cal-scroll"><div class="cal-months" aria-hidden="true">${monthLabels}</div><div class="cal-grid">${cells}</div></div>
    <div class="hw-caption">${fmt(played)} days played in ${year}${evDays ? ` — including <b>${evDays} GO Fest day${evDays > 1 ? "s" : ""}</b> (gold ring)` : ""}. Tap a day for details.${heatKey(0.18, 0.82)}</div>
    ${srTable(`${year} by month: ${fmt(played)} days played in total.`, ["Month", "Days played", "Actions"], byMonth)}`;
  /* On phones the strip scrolls — open on the reader's recent months, not last
   * January. For the current year, put "now" at the right edge. */
  const sc = host.querySelector(".cal-scroll");
  if (sc && sc.scrollWidth > sc.clientWidth) {
    const now = new Date();
    if (String(now.getUTCFullYear()) === String(year)) {
      const col = Math.floor((startDow + (Date.now() - Date.UTC(+year, 0, 1)) / 86400000) / 7);
      const cellW = sc.scrollWidth / Math.ceil((startDow + dayOfYear) / 7);
      sc.scrollLeft = Math.max(0, (col + 2) * cellW - sc.clientWidth);
    } else {
      sc.scrollLeft = sc.scrollWidth;
    }
  }
  attachHourWeekTip(host);
}

/* ── year over year (multi-year journeys) ── */
const MON1 = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
/* Year-card gradient pairs. A deterministic cycle, not a literal table: the old
 * 2022-2027 lookup fell back to one identical pair for every year outside it,
 * so a 2020-2021 veteran got indistinguishable "unique" year cards — and the
 * scheme would have silently broken again in 2028. The offset keeps every year
 * of the old table on exactly the colors it had. */
const YEAR_PAIRS = [
  [C.green, C.teal], [C.red, C.yellow], [C.blue, C.teal],
  [C.purple, C.pink], [C.teal, C.green], [C.orange, C.yellow],
];
const yearColors = (y) => YEAR_PAIRS[(((+y - 2022) % YEAR_PAIRS.length) + YEAR_PAIRS.length) % YEAR_PAIRS.length];
/* Every Pokémon the event logs say you met: GO Plus catches plus map, incense
 * and lure encounters. The name predates a closer look — none of the three
 * encounter files records whether the Pokémon was caught — so every label on
 * this sum says "encountered", never "caught". */
const catchesOf = (k) => (k["GO Plus catches"] || 0) + (k["Encounters"] || 0) + (k["Incense"] || 0) + (k["Lures"] || 0);
/* A year card's tiles: one list for the page card and its PNG, so the two can't drift. */
function yearCardStats(w) {
  return [
    [fmt(catchesOf(w.kinds)), "Pokémon encountered"],
    [fmt(w.kinds["Spins"] || 0), "PokéStop spins"],
    [fmt(w.kinds["Raids"] || 0), "raid lobbies"],
    [fmt(w.remoteRaids), "remote raids"],
    [fmt(w.activeDays), "days played"],
    [fmt(w.streak), "longest streak"],
    ...(w.coinsBought ? [[fmt(w.coinsBought), "PokéCoins bought"]] : []),
    ...(w.friendsAdded ? [[fmt(w.friendsAdded), "friends made"]] : []),
  ];
}

function buildYearData() {
  const e = STATE.ev;
  const byMonth = e.byMonth;
  const months = Object.keys(byMonth);
  const years = [...new Set(months.map((m) => m.slice(0, 4)))].sort();
  if (!years.length) return { years: [], data: {} };

  const dayByYear = {};
  for (const [d, n] of Object.entries(e.dayCounts)) (dayByYear[d.slice(0, 4)] = dayByYear[d.slice(0, 4)] || {})[d] = n;
  const sumMonths = (map, y) => Object.entries(map || {}).reduce((a, [m, v]) => a + (m.slice(0, 4) === y ? v : 0), 0);

  const data = {};
  years.forEach((y) => {
    const yMonths = months.filter((m) => m.slice(0, 4) === y).sort();
    const kinds = {};
    let events = 0, peakMonth = null, peakMonthEvents = 0;
    yMonths.forEach((m) => {
      let monTotal = 0;
      for (const [lab, n] of Object.entries(byMonth[m])) { kinds[lab] = (kinds[lab] || 0) + n; events += n; monTotal += n; }
      if (monTotal > peakMonthEvents) { peakMonthEvents = monTotal; peakMonth = m; }
    });
    const days = dayByYear[y] || {};
    const dayKeys = Object.keys(days);
    let busiestDay = null, busiestDayEvents = 0;
    for (const d of dayKeys) if (days[d] > busiestDayEvents) { busiestDayEvents = days[d]; busiestDay = d; }
    const seriesKeys = Object.keys(SERIES_COLORS).filter((k) => kinds[k]);
    data[y] = {
      events, kinds, byKind: Object.entries(kinds).sort((a, b) => b[1] - a[1]),
      activeDays: dayKeys.length, streak: longestStreak(dayKeys),
      busiestDay, busiestDayEvents, peakMonth, peakMonthEvents,
      remoteRaids: e.remoteRaidsByYear[y] || 0,
      coinsBought: sumMonths(STATE.spend.boughtMonthly, y),
      friendsAdded: sumMonths(STATE.friends.monthly, y),
      sessions: sumMonths(STATE.sessions.monthly, y),
      photos: sumMonths(STATE.photos.monthly, y),
      monthLabels: yMonths.map((m) => MON1[+m.slice(5) - 1]),
      monthlyStacks: yMonths.map((m) => seriesKeys.map((lab) => [SERIES_COLORS[lab], byMonth[m][lab] || 0])),
      series: seriesKeys.map((lab) => [lab, SERIES_COLORS[lab]]),
    };
  });
  return { years, data };
}

function renderYearOverYear() {
  const { years, data } = buildYearData();
  if (!years.length) return;
  const multi = years.length > 1;

  // superlative badges — each award goes to the winning year (multi-year only;
  // with one year every award is a hollow win)
  const award = (label, emoji, valueOf) => {
    let best = null, bestV = 0;
    years.forEach((y) => { const v = valueOf(data[y]) || 0; if (v > bestV) { bestV = v; best = y; } });
    return best ? { year: best, text: `${emoji} ${label}` } : null;
  };
  const awards = !multi ? [] : [
    award("Biggest year", "🏆", (w) => w.events),
    award("Globe-trotter", "🌍", (w) => w.remoteRaids),
    award("Most social", "🤝", (w) => w.friendsAdded),
    award("Whale year", "🐳", (w) => w.coinsBought),
    award("Most consistent", "🔥", (w) => w.streak),
    award("Most encounters", "🎯", (w) => catchesOf(w.kinds)),
  ].filter(Boolean);
  const badgesFor = (y) => awards.filter((a) => a.year === y).map((a) => a.text);

  // versus chart + metric chips
  const METRICS = [
    ["Pokémon encountered", (w) => catchesOf(w.kinds)],
    ["Spins", (w) => w.kinds["Spins"] || 0],
    ["Raids", (w) => w.kinds["Raids"] || 0],
    ["Remote raids", (w) => w.remoteRaids],
    ["Gym battles", (w) => w.kinds["Gym battles"] || 0],
    ["Berries fed", (w) => w.kinds["Berries fed"] || 0],
    ["Active days", (w) => w.activeDays],
    ["Longest streak", (w) => w.streak],
    ["Friends added", (w) => w.friendsAdded],
    ["Coins bought", (w) => w.coinsBought],
    ["Snapshots", (w) => w.photos],
  ].filter(([, fn]) => years.some((y) => fn(data[y]) > 0));

  const cId = uid();
  const chipsId = uid();
  let inner = "";
  if (multi) {
    inner = `<div id="${chipsId}" class="yoy-metrics">${METRICS.map(([label], i) =>
      `<button class="yoy-chip${i === 0 ? " active" : ""}" type="button" aria-pressed="${i === 0}" data-i="${i}">${esc(label)}</button>`).join("")}</div>`;
    inner += `<div>${chartWrap(cId)}</div>`;
    inner += `<hr class="mod-divider">`;
  }

  // one shareable year card per year — single-year players get theirs too
  inner += `<h4 class="mod-h4">Your year card${multi ? "s" : ""}</h4>
    <div class="mod-sub" style="margin-bottom:0">A shareable recap${multi ? " for each year" : ""} — download ${multi ? "any" : "it"} as a PNG.</div>`;
  inner += `<div class="wrap-cards">`;
  const nowYear = String(new Date().getFullYear());
  // On the public demo, keep it tidy with just the three most recent years.
  let cardYears = years.slice().reverse();
  if (window.DEMO_PAGE) cardYears = cardYears.slice(0, 3);
  cardYears.forEach((y) => {
    const w = data[y];
    const [c1, c2] = yearColors(y);
    const partial = y === nowYear;
    const badges = badgesFor(y);
    const there = festBadges(y);
    const cells = yearCardStats(w);
    inner += `<div class="wrap-card" data-year="${y}" style="--wc1:${c1};--wc2:${c2}">
      <div class="wc-kicker">Pokémon GO · Metrics</div>
      <div class="wc-year">${y}${partial ? `<span class="wc-sofar">so far</span>` : ""}</div>
      ${badges.length || there.length ? `<div class="wc-badges">${there.map((b) => `<span class="wc-badge wc-there">${esc(b)}</span>`).join("")}${badges.map((b) => `<span class="wc-badge">${b}</span>`).join("")}</div>` : ""}
      <div class="wc-big">${fmt(w.events)}</div>
      <div class="wc-big-l">logged actions${w.peakMonth ? ` · peaked ${fmtMonth(w.peakMonth)}` : ""}</div>
      <div class="wc-grid">${cells.slice(0, 8).map(([v, l]) => `<div class="wc-cell"><div class="v">${v}</div><div class="l">${esc(l)}</div></div>`).join("")}</div>
      <button class="btn btn-teal wc-play" type="button"><span aria-hidden="true">▶</span> Play ${y}'s story</button>
      <button class="btn btn-teal wc-dl" type="button"><span aria-hidden="true">⬇</span> Download ${y} card (PNG)</button>
      <div class="wc-foot">POGO Metrics · ${y}</div>
    </div>`;
  });
  inner += `</div>`;

  later(() => {
    if (multi) {
      // versus bar chart, one bar per year, toggled by metric
      /* The x-axis already names the years, so hue would carry no information —
       * and the old per-year colors were the ACTIVITY hues, teaching that red
       * means both "2023" and "Raids" in the same module. One accent, with the
       * winning year solid, says exactly one thing: who won. */
      const ch = newChart(cId, {
        type: "bar",
        data: { labels: years, datasets: [{ data: [], label: METRICS[0][0], backgroundColor: [] }] },
        options: {
          plugins: { legend: { display: false }, title: { display: true, text: "Year vs year — " + METRICS[0][0] } },
          scales: { x: { grid: { display: false } }, y: { beginAtZero: true } },
        },
      });
      const renderVs = (i) => {
        const [label, fn] = METRICS[i];
        const vals = years.map((y) => fn(data[y]));
        const best = vals.indexOf(Math.max(...vals));
        ch.data.datasets[0].data = vals;
        ch.data.datasets[0].label = label;
        ch.data.datasets[0].backgroundColor = vals.map((_, j) => (j === best ? C.teal : "rgba(65,216,198,.42)"));
        ch.options.plugins.title.text = "Year vs year — " + label;
        ch.update();
      };
      const chips = [...$(chipsId).querySelectorAll(".yoy-chip")];
      chips.forEach((btn) => btn.addEventListener("click", () => {
        chips.forEach((b) => { b.classList.toggle("active", b === btn); b.setAttribute("aria-pressed", String(b === btn)); });
        renderVs(+btn.dataset.i);
      }));
      renderVs(0);
    }

    // wire each card's download button
    document.querySelectorAll(".wrap-card").forEach((cardEl) => {
      const y = cardEl.dataset.year;
      const w = data[y];
      const [c1, c2] = yearColors(y);
      const play = cardEl.querySelector(".wc-play");
      if (play) play.addEventListener("click", () => storyMode(y));
      const btn = cardEl.querySelector(".wc-dl");
      btn.addEventListener("click", () => downloadYearCard({
        year: y, partial: y === nowYear, c1, c2,
        events: fmt(w.events), badges: badgesFor(y), there: festBadges(y),
        peakLabel: w.peakMonth ? `${fmtMonth(w.peakMonth)} was the biggest month` : "",
        stats: yearCardStats(w),
        monthLabels: w.monthLabels, monthlyStacks: w.monthlyStacks, series: w.series,
      }, btn));
    });
  });

  if (multi) inner += renderThenVsNow(years, data);

  const sub = multi
    ? `${years.length} years side by side — ${years[0]} to ${years[years.length - 1]}. Tap a metric to compare, and download any year as a shareable card.`
    : `Your ${years[0]} in one shareable card — download it and flex.`;
  return moduleHTML("📅", multi ? "Year over year" : "Your year in one card", sub, inner);
}

/* ── then vs now ──
 * Absolute stacked timelines hide MIX shift: a quieter year just looks shorter,
 * so a spins-heavy player turning into a raid-heavy player is invisible. This
 * compares the first and last year as percentages of each year's own total. */
function renderThenVsNow(years, data) {
  const first = years[0], last = years[years.length - 1];
  const A = data[first], B = data[last];
  if (!A || !B || !A.events || !B.events) return "";

  const METRICS = [
    ["Logged actions", (w) => w.events],
    ["Pokémon encountered", (w) => catchesOf(w.kinds)],
    ["Spins", (w) => w.kinds["Spins"] || 0],
    ["Raids", (w) => w.kinds["Raids"] || 0],
    ["Active days", (w) => w.activeDays],
    ["Longest streak", (w) => w.streak],
  ].filter(([, fn]) => fn(A) || fn(B));

  const rows = METRICS.map(([label, fn]) => {
    const a = fn(A), b = fn(B);
    const pct = a ? Math.round((b - a) / a * 100) : null;
    const dir = b > a ? "up" : b < a ? "down" : "flat";
    const arrow = dir === "up" ? "▲" : dir === "down" ? "▼" : "＝";
    /* the % alone hides magnitude — +300% on 12→48 raids visually outranks
     * +40% on 100k→140k encounters; the paired bars restore the scale */
    const m = Math.max(a, b, 1);
    return `<div class="tvn-row">
      <span class="tvn-l">${esc(label)}</span>
      <span class="tvn-a mono">${fmt(a)}</span>
      <span class="tvn-arrow ${dir}">${arrow}</span>
      <span class="tvn-b mono">${fmt(b)}</span>
      <span class="tvn-d ${dir}">${pct === null ? "new" : (pct > 0 ? "+" : "") + pct + "%"}</span>
      <span class="tvn-bars" aria-hidden="true"><i class="a" style="width:${(a / m * 100).toFixed(1)}%"></i><i class="b" style="width:${(b / m * 100).toFixed(1)}%"></i></span>
    </div>`;
  }).join("");

  // mix shift — each year normalised to 100% of its own actions
  const kinds = [...new Set([...Object.keys(A.kinds), ...Object.keys(B.kinds)])]
    .filter((k) => SERIES_COLORS[k] && (A.kinds[k] || B.kinds[k]));
  const cId = uid();
  const share = (w, k) => (w.events ? (w.kinds[k] || 0) / w.events * 100 : 0);
  later(() => newChart(cId, {
    type: "bar",
    data: {
      labels: [first, last],
      datasets: kinds.map((k) => ({
        label: k, backgroundColor: SERIES_COLORS[k], stack: "mix",
        data: [share(A, k), share(B, k)],
      })),
    },
    options: {
      indexAxis: "y",
      plugins: {
        title: { display: true, text: "What your play is made of (share of each year)" },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.raw.toFixed(1)}%`, footer: () => "" } },
      },
      /* ticks carry their own unit — the axis title alone left bare 0-100 numbers */
      scales: { x: { stacked: true, max: 100, ticks: { callback: (v) => v + "%" }, title: { display: true, text: "% of that year's actions" } }, y: { stacked: true, grid: { display: false } } },
    },
  }));

  return `<hr class="mod-divider"><h4 class="mod-h4">Then vs now — ${first} against ${last}</h4>
    <div class="mod-sub" style="margin-bottom:10px">Your first logged year beside your most recent one.</div>
    <div class="tvn-head"><span class="tvn-l"></span><span class="tvn-a">${first}</span><span class="tvn-arrow"></span><span class="tvn-b">${last}</span><span class="tvn-d">change</span></div>
    ${rows}
    <div style="margin-top:16px">${chartWrap(cId, "short")}</div>
    <div class="hw-caption"><b>Read the percentages with care.</b> The export only reaches back a few years, so
      ${first} starts wherever your logs begin — if that is mid-year, it is a partial year and every "change" against it is
      inflated.${last === String(new Date().getUTCFullYear()) ? ` ${last} is still in progress, so it is partial too.` : ""}
      The mix chart below compares shares of each year's own total, so it stays fair either way.</div>`;
}

/* Shareable year-recap image — drawn to a canvas from the data so it
 * exports cleanly offline (no DOM screenshot, no external library). */
function roundRectPath(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}
async function downloadYearCard(o, btn) {
  const W = 1080, S = 2;
  const cv = document.createElement("canvas");
  const ctx = cv.getContext("2d");
  const orig = btn && btn.textContent;
  if (btn) { btn.textContent = "Rendering…"; btn.disabled = true; }
  try { await document.fonts.ready; } catch (e) { /* fonts may already be ready */ }

  /* Measure first, draw second. The badges and the legend are laid out before
   * the canvas is sized, so a card holding more than fits in 1080×1500 grows
   * taller instead of dropping anything. Most cards never need to; a lifetime
   * card with three festivals and five awards needs four rows of badges. */
  // badges (wrap, centered) — "I was there" first, in the accent
  const BADGE_FONT = "700 23px 'Outfit', sans-serif", PADX = 18, GAP = 12, BH = 46;
  const badgeList = [...(o.there || []).map((t) => ({ t, there: true })), ...(o.badges || []).map((t) => ({ t }))];
  const badgeRows = [];
  if (badgeList.length) {
    ctx.font = BADGE_FONT;
    const maxW = W - 120;
    let rw = 0;
    badgeRows.push([]);
    badgeList.forEach((b) => {
      const it = { ...b, w: ctx.measureText(b.t).width + PADX * 2 };
      if (rw + it.w + GAP > maxW && badgeRows[badgeRows.length - 1].length) { badgeRows.push([]); rw = 0; }
      badgeRows[badgeRows.length - 1].push(it); rw += it.w + GAP;
    });
  }

  /* Legend layout. The mini chart is a stacked bar per month in the series
   * colours, and it shipped with no key at all — nine colours and nothing to
   * say which was raids and which was berries. Wraps to as many rows as the
   * series need. */
  const LEG_SW = 15, LEG_GAP = 9, LEG_PAD = 28, LEG_LH = 31;
  const legendRows = [];
  if (o.series && o.series.length) {
    ctx.font = "500 19px 'Outfit', sans-serif";
    const maxW = W - 170;
    let row = [], rw = 0;
    o.series.forEach(([label, color]) => {
      const w = LEG_SW + LEG_GAP + ctx.measureText(label).width + LEG_PAD;
      if (rw + w > maxW && row.length) { legendRows.push(row); row = []; rw = 0; }
      row.push({ label, color, w }); rw += w;
    });
    if (row.length) legendRows.push(row);
  }
  const legendH = legendRows.length ? legendRows.length * LEG_LH + 10 : 0;

  // everything below the badges: the headline, chart, legend, then the tile grid
  const gRows = Math.ceil(o.stats.length / 2);
  const hy0 = Math.max(318 + badgeRows.length * (BH + 12) + 60, 470);
  const gridEnd0 = hy0 + 250 + 96 + legendH + gRows * 124 - 20;
  // 86: the footer's band. A card that has to grow also gets 24 px of air at each
  // end, as a card that fits does, so its headline doesn't touch the badges.
  const H = gridEnd0 + 86 <= 1500 ? 1500 : gridEnd0 + 86 + 48;
  cv.width = W * S; cv.height = H * S;       // sizing resets the context; everything below sets its own state
  ctx.scale(S, S);

  // background + colored glows
  ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
  let g = ctx.createRadialGradient(170, 150, 0, 170, 150, 720);
  g.addColorStop(0, o.c1 + "66"); g.addColorStop(1, C.bg + "00");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  g = ctx.createRadialGradient(W - 150, H - 180, 0, W - 150, H - 180, 780);
  g.addColorStop(0, o.c2 + "4d"); g.addColorStop(1, C.bg + "00");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(255,255,255,.10)"; ctx.lineWidth = 2;
  roundRectPath(ctx, 12, 12, W - 24, H - 24, 28); ctx.stroke();

  ctx.textAlign = "center";
  ctx.fillStyle = C.dim; ctx.font = "600 22px 'JetBrains Mono', monospace";
  ctx.letterSpacing = "6px";
  ctx.fillText("POKÉMON GO · METRICS", W / 2, 86);
  ctx.letterSpacing = "0px";
  ctx.font = o.titleFont || "800 150px 'Outfit', sans-serif";
  const yg = ctx.createLinearGradient(W / 2 - 220, 0, W / 2 + 220, 0);
  yg.addColorStop(0, o.c1); yg.addColorStop(1, o.c2);
  ctx.fillStyle = yg; ctx.fillText(o.year, W / 2, 232);
  if (o.partial) {
    ctx.fillStyle = C.dim; ctx.font = "500 26px 'Outfit', sans-serif";
    ctx.fillText("so far", W / 2, 272);
  }

  // badges — every one of them; the card was sized above to hold them all
  let by = 318;
  ctx.font = BADGE_FONT;
  badgeRows.forEach((row) => {
    const tot = row.reduce((a, it) => a + it.w, 0) + GAP * (row.length - 1);
    let x = (W - tot) / 2;
    row.forEach((it) => {
      ctx.fillStyle = it.there ? C.yellow + "1f" : "rgba(255,255,255,.07)";
      roundRectPath(ctx, x, by, it.w, BH, BH / 2); ctx.fill();
      ctx.strokeStyle = it.there ? C.yellow + "99" : "rgba(255,255,255,.18)"; ctx.lineWidth = 1.5;
      roundRectPath(ctx, x, by, it.w, BH, BH / 2); ctx.stroke();
      ctx.fillStyle = "#e8eaf6"; ctx.textBaseline = "middle";
      ctx.fillText(it.t, x + it.w / 2, by + BH / 2 + 1);
      ctx.textBaseline = "alphabetic";
      x += it.w + GAP;
    });
    by += BH + 12;
  });

  // headline number — centre the remaining content between the badges and the
  // footer so short cards (no badges, fewer stat tiles) don't leave a dead gap
  const off = Math.max(0, Math.floor((H - 86 - gridEnd0) / 2));
  const hy = hy0 + off;
  ctx.fillStyle = "#fff"; ctx.font = "700 92px 'JetBrains Mono', monospace";
  ctx.fillText(o.events, W / 2, hy);
  ctx.fillStyle = C.dim; ctx.font = "500 26px 'Outfit', sans-serif";
  ctx.fillText("logged actions", W / 2, hy + 40);

  // mini monthly stacked chart
  const cx0 = 90, cx1 = W - 90, cTop = hy + 80, cBot = hy + 250;
  const totals = o.monthlyStacks.map((segs) => segs.reduce((a, s) => a + s[1], 0));
  const maxTot = Math.max(1, ...totals);
  const slot = (cx1 - cx0) / Math.max(1, o.monthlyStacks.length);
  const barW = slot * 0.64;
  o.monthlyStacks.forEach((segs, i) => {
    const x = cx0 + slot * i + (slot - barW) / 2;
    let yb = cBot;
    segs.forEach(([color, val]) => {
      const h = (val / maxTot) * (cBot - cTop);
      if (h > 0.4) { ctx.fillStyle = color; ctx.fillRect(x, yb - h, barW, h); }
      yb -= h;
    });
    ctx.fillStyle = C.faint; ctx.font = "500 17px 'Outfit', sans-serif";
    ctx.fillText(o.monthLabels[i] || "", x + barW / 2, cBot + 24);
  });
  // legend — centre each wrapped row under the chart it explains
  let ly = cBot + 46;
  legendRows.forEach((row) => {
    const rowW = row.reduce((a, it) => a + it.w, 0) - LEG_PAD;
    let lx = (W - rowW) / 2;
    ctx.textAlign = "left";
    row.forEach((it) => {
      ctx.fillStyle = it.color;
      roundRectPath(ctx, lx, ly - LEG_SW + 2, LEG_SW, LEG_SW, 4); ctx.fill();
      ctx.fillStyle = C.dim; ctx.font = "500 19px 'Outfit', sans-serif";
      ctx.fillText(it.label, lx + LEG_SW + LEG_GAP, ly);
      lx += it.w;
    });
    ctx.textAlign = "center";
    ly += LEG_LH;
  });
  if (o.peakLabel) {
    ctx.fillStyle = C.dim; ctx.font = "500 20px 'Outfit', sans-serif";
    ctx.fillText("Month by month — " + o.peakLabel, W / 2, legendH ? ly + 2 : cBot + 56);
  }

  // stat grid, two columns
  const gy = cBot + 96 + legendH, gx = 90, gGap = 20;
  const tileW = (W - gx * 2 - gGap) / 2, tileH = 104;
  o.stats.forEach(([v, l], i) => {
    const col = i % 2, row = (i / 2) | 0;
    const x = gx + col * (tileW + gGap), y = gy + row * (tileH + gGap);
    ctx.fillStyle = "rgba(10,14,32,.6)"; roundRectPath(ctx, x, y, tileW, tileH, 14); ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,.08)"; ctx.lineWidth = 1.5;
    roundRectPath(ctx, x, y, tileW, tileH, 14); ctx.stroke();
    ctx.textAlign = "left";
    ctx.fillStyle = "#fff"; ctx.font = "700 40px 'JetBrains Mono', monospace";
    ctx.fillText(v, x + 22, y + 52);
    ctx.fillStyle = C.dim; ctx.font = "500 20px 'Outfit', sans-serif";
    ctx.fillText(l, x + 22, y + 84);
  });
  ctx.textAlign = "center";

  // footer — wordmark plus the site URL, so a card shared anywhere points home
  ctx.fillStyle = "#848ab0"; ctx.font = "600 18px 'JetBrains Mono', monospace";
  ctx.letterSpacing = "3px";
  ctx.fillText(("POGO METRICS · " + o.year).toUpperCase(), W / 2, H - 62);
  ctx.fillStyle = C.faint; ctx.font = "500 15px 'JetBrains Mono', monospace";
  ctx.letterSpacing = "2px";
  ctx.fillText("POGO-METRICS.NETLIFY.APP", W / 2, H - 34);
  ctx.letterSpacing = "0px";

  cv.toBlob(async (blob) => {
    // Prefer the native share sheet on phones — a download into Files is where
    // sharing goes to die. Keep the anchor for desktop and for any failure.
    if (blob && navigator.canShare) {
      try {
        const file = new File([blob], o.file || `pogo-metrics-${o.year}.png`, { type: "image/png" });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title: "My Pokémon GO journey" });
          if (btn) { btn.textContent = orig; btn.disabled = false; }
          return;
        }
      } catch (err) {
        // AbortError means the user closed the sheet on purpose — don't then
        // shove a download at them. Anything else falls through to the anchor.
        if (err && err.name === "AbortError") { if (btn) { btn.textContent = orig; btn.disabled = false; } return; }
      }
    }
    if (btn) { btn.textContent = orig; btn.disabled = false; }
    if (!blob) { alert("Could not generate image on this browser."); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = o.file || `pogo-metrics-${o.year}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}

/* ── world: prefer the 3D globe, fall back to a flat heatmap ── */
function renderWorld() {
  const e = STATE.ev;
  if (e.geo.size === 0 && STATE.trail.length === 0) return;
  if (window.Globe && _webglOK()) return renderGlobe();
  if (window.L) return renderFlatMap();
  return renderWorldUnavailable();
}

/* Every other chapter is built from parsed data alone. This one needs a
 * vendored library, and when that fetch fails — offline on a first visit, or a
 * blocked request — renderWorld used to return nothing at all, so the chapter
 * silently wasn't there. Someone who uploaded their location files and got no
 * map has no way to tell that apart from "my export didn't contain it". Say
 * what happened, keep the numbers we already computed, and offer a retry. */
function renderWorldUnavailable() {
  const e = STATE.ev;
  const stats = [];
  if (e.geo.size) stats.push([fmt(e.geo.size), "distinct spots", "ready to plot"]);
  if (e.raidRemote) stats.push([fmt(e.raidRemote), "remote raids", "ready to draw as arcs"]);
  if (STATE.trailCount) stats.push([fmt(STATE.trailCount), "GPS points", "in your location trail"]);
  const why = _webglOK()
    ? "The 3D globe's library didn't finish downloading — usually a dropped connection, and on a first visit it is the one part of the app that isn't cached yet."
    : "This browser has WebGL switched off, and the flat-map fallback didn't load either.";
  let inner = stats.length ? statGrid(stats) : "";
  inner += `<div class="empty-state" style="margin-top:14px">
    <div class="es-icon">${window.ICON ? window.ICON("globe") : "🌍"}</div>
    <h3 style="margin:10px 0 6px">Your map couldn't be drawn</h3>
    <p>${esc(why)} Your location data parsed perfectly — there is just nothing to draw it into yet.
    Retrying only re-fetches that library from this site; your files are still only in this tab.</p>
    <button class="btn btn-teal" id="world-retry" type="button" style="margin-top:14px"><span aria-hidden="true">↻</span> Try again</button>
  </div>`;
  later(wireWorldRetry);
  return moduleHTML("🌍", "Your world", "The map needs one more file from this site before it can draw.", inner);
}

function wireWorldRetry() {
  const btn = $("world-retry");
  if (!btn) return;
  btn.onclick = async () => {
    btn.disabled = true; btn.textContent = "Loading…";
    try {
      if (_webglOK()) await ensureScript("vendor/globe.gl-2.46.2.min.js");
      else await ensureCSS("vendor/leaflet.css").then(() => ensureScript("vendor/leaflet.js")).then(() => ensureScript("vendor/leaflet-heat.js"));
    } catch (err) { console.warn(err); }
    const mod = btn.closest(".module");
    if (!mod) return;
    // renderGlobe/renderFlatMap queue their init through later(); POST is only
    // drained by build(), which finished long ago — so drain what this call adds.
    const before = POST.length;
    const html = renderWorld();
    if (!html) { btn.disabled = false; btn.textContent = "↻ Try again"; return; }
    mod.outerHTML = html;
    POST.splice(before).forEach((fn) => { try { fn(); } catch (err) { console.warn(err); } });
  };
}
function _webglOK() {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl") || c.getContext("experimental-webgl")); }
  catch (e) { return false; }
}

/* ── flat map fallback (geo bins + GPS trail) ── */
function renderFlatMap() {
  const e = STATE.ev;
  const hasGeo = e.geo.size > 0;
  const hasTrail = STATE.trail.length > 0;
  if (!hasGeo && !hasTrail) return;
  const id = uid();
  // background stands in for the ocean now that there is no tile layer beneath
  const inner = `<div id="${id}" style="height:380px;border-radius:14px;overflow:hidden;border:1px solid var(--line);background:var(--card-chrome)"></div>`;

  later(() => {
    const map = L.map(id, { worldCopyJump: true, maxZoom: 18, scrollWheelZoom: false, attributionControl: false }).setView([20, 0], 2);
    MAP = map;
    // Deliberately NO tile layer. A remote basemap would send this user's IP plus
    // tile coordinates — centred on their own hotspots by the fitBounds below — to
    // a third party, which is exactly what this site promises never to do. The
    // vendored country outlines drawn next give a perfectly readable dark map and
    // keep every request same-origin.
    fetch("vendor/geo/countries.geo.json").then((r) => r.json()).then((geo) => {
      L.geoJSON(geo, { style: { color: "#3a4790", weight: .6, fillColor: "#141d3c", fillOpacity: .5 }, interactive: false }).addTo(map);
    }).catch(() => {});

    const bounds = [];
    if (hasGeo) {
      const pts = [...e.geo.entries()].map(([k, c]) => {
        const [la, lo] = k.split(",").map(Number);
        bounds.push([la, lo]);
        return [la, lo, Math.min(1, 0.25 + Math.log10(c + 1) / 3)];
      });
      if (L.heatLayer) L.heatLayer(pts, { radius: 14, blur: 18, minOpacity: .35, gradient: { 0.2: C.blue, 0.5: C.teal, 0.75: C.yellow, 1: C.red } }).addTo(map);
    }
    if (hasTrail) {
      const pts = [...STATE.trail].sort((a, b) => (a.ts || 0) - (b.ts || 0));
      const sample = pts.length > 6000 ? pts.filter((_, i) => i % Math.ceil(pts.length / 6000) === 0) : pts;
      // split into day segments to avoid long teleport lines
      let seg = [], lastDay = null;
      const flush = () => { if (seg.length > 1) L.polyline(seg, { color: C.pink, weight: 1.5, opacity: .55 }).addTo(map); seg = []; };
      sample.forEach((p) => {
        const day = p.ts ? p.ts.toISOString().slice(0, 10) : "x";
        if (day !== lastDay) { flush(); lastDay = day; }
        seg.push([p.lat, p.lon]); bounds.push([p.lat, p.lon]);
      });
      flush();
    }
    if (bounds.length) { try { map.fitBounds(bounds, { padding: [30, 30], maxZoom: 12 }); } catch (e) {} }
    setTimeout(() => map.invalidateSize(), 60);
  });

  const bits = [];
  if (hasGeo) bits.push(`${fmt(e.geo.size)} activity hotspots`);
  if (hasTrail) bits.push(`a ${fmt(STATE.trailCount)}-point GPS trail${STATE.trailStride > 1 ? " (drawn from an even sample)" : ""}`);
  return moduleHTML("📍", "Where you played", `Your world map, built from ${bits.join(" and ")}. Drawn entirely on your device — no map tiles are fetched from anyone else.${e.blurredRows
    ? " The 3-year journey files blur every position to a few kilometres in the export itself, so the map is drawn from the precise 15-month files." : ""}`, inner);
}

/* ── 3D globe: activity columns + remote-raid arcs + GPS trail ── */
function buildTrailPaths() {
  const rows = STATE.trail.filter((p) => p.ts).slice().sort((a, b) => a.ts - b.ts);
  const days = {}; let last = null;
  for (const p of rows) {
    const d = p.ts.toISOString().slice(0, 10); // same UTC day-key the flat map uses
    if (last && last.d === d && Math.abs(p.lat - last.la) < 2e-4 && Math.abs(p.lon - last.lo) < 2e-4) continue;
    (days[d] = days[d] || []).push([p.lat, p.lon, 0.002]);
    last = { d, la: p.lat, lo: p.lon };
  }
  let paths = Object.keys(days).sort().filter((d) => days[d].length >= 2).map((d) => ({ date: d, pts: days[d] }));
  // cap total vertices like points (4000) and arcs (600) are capped — a multi-year
  // trail can otherwise feed hundreds of thousands of animated line segments to the GPU
  const total = paths.reduce((a, p) => a + p.pts.length, 0);
  if (total > 15000) {
    const step = Math.ceil(total / 15000);
    paths = paths
      .map((p) => ({ date: p.date, pts: p.pts.filter((_, i) => i % step === 0 || i === p.pts.length - 1) }))
      .filter((p) => p.pts.length >= 2);
  }
  return paths;
}
function gToggle(id, color, label, checked) {
  return `<label class="gh-toggle"><input type="checkbox" id="${id}" ${checked ? "checked" : ""}><span class="gh-sw" style="--c:${color}"></span>${esc(label)}</label>`;
}

function renderGlobe() {
  const e = STATE.ev;
  const P = "glb-";
  // fewer unmerged point meshes on phones / low-RAM devices — each is a draw call
  const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  const pointCap = coarse || (navigator.deviceMemory && navigator.deviceMemory <= 4) ? 2000 : 4000;
  const points = [...e.geo.entries()].sort((a, b) => b[1] - a[1]).slice(0, pointCap).map(([key, count]) => {
    const [lat, lng] = key.split(",").map(Number);
    const kc = e.geoKind.get(key) || {};
    const kind = (Object.entries(kc).sort((a, b) => b[1] - a[1])[0] || ["Encounters"])[0];
    return { lat, lng, count, kind, m: e.geoFirst.get(key), months: e.geoMonths.get(key) || null };
  });
  if (!points.length && !STATE.trail.length) return renderFlatMap();
  const maxCount = Math.max(1, ...points.map((p) => p.count));
  const arcs = [...e.raidArcs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 600).map(([key, count]) => {
    const [slat, slng, elat, elng] = key.split(",").map(Number);
    // Clamped to the exact per-raid maximum: this key's endpoints were rounded
    // to 0.1° for de-duplication, and that rounding can push the longest arc
    // PAST the real farthest raid — which the same panel prints a few hundred
    // pixels away, from the unrounded figure. One distance, one number.
    const km = haversine(slat, slng, elat, elng);
    return { slat, slng, elat, elng, count, km: e.raidMaxKm ? Math.min(km, e.raidMaxKm) : km, m: e.arcFirst.get(key), months: e.arcMonths.get(key) || null };
  });
  let home = null, hc = -1;
  for (const [key, c] of e.geo) { if (c > hc) { hc = c; const [la, lo] = key.split(",").map(Number); home = { lat: la, lng: lo }; } }
  if (!home) home = { lat: points[0] ? points[0].lat : 20, lng: points[0] ? points[0].lng : 0 };
  const paths = buildTrailPaths();

  const subBits = [];
  if (points.length) subBits.push(`${fmt(points.length)} activity hotspots`);
  // arcs.length, not e.raidRemote: endpoints are rounded to 0.1° and de-duped
  // above, so repeat raids on the same gym share one stroke. Counting raids
  // here described a globe several times denser than the one drawn (686 vs
  // 216 on the sample export). The raid total has its own tile below.
  if (arcs.length) subBits.push(`${fmt(arcs.length)} remote-raid arcs`);
  if (paths.length) subBits.push(`a ${fmt(paths.length)}-day GPS trail`);

  const html = `<div class="module globe-module" data-hue="blue">
    <div class="mod-head"><span class="mod-icon">${chapterIcon("🌍")}</span><h3>Your world in 3D</h3></div>
    <div class="mod-sub">${subBits.join(" · ")}. Drag to spin, scroll to zoom — every arc is a remote raid from where you stood to a gym somewhere on Earth.</div>
    <div class="globe-wrap" id="${P}wrap">
    <div class="globe-stage">
      <div id="${P}canvas" class="globe-canvas"></div>
      <div id="${P}loading" class="globe-loading"><div class="gl-spin"></div>Spinning up the world…</div>
      <div id="${P}stats" class="globe-hud globe-hud-tl"></div>
      <details class="globe-hud globe-hud-tr" id="${P}layers" open>
        <summary class="gh-title">Layers</summary>
        ${gToggle(P + "ly-points", C.teal, "Activity columns", true)}
        ${gToggle(P + "ly-arcs", C.red, "Remote raid arcs", arcs.length > 0)}
        <div class="gh-slider" id="${P}arc-ctl"><input type="range" id="${P}arc-dist" min="0" max="100" value="100" aria-label="Maximum raid arc distance"><span class="mono" id="${P}arc-lbl">all distances</span></div>
        ${gToggle(P + "ly-trail", C.yellow, "GPS trail", paths.length > 0)}
        ${gToggle(P + "ly-borders", "#5a6db8", "Country lines", true)}
        ${gToggle(P + "ly-labels", "#dfe6ff", "Country names", true)}
        ${gToggle(P + "ly-rotate", C.blue, "Auto-rotate", !REDUCED_MOTION)}
        <button id="${P}shot" class="gh-btn" type="button" aria-describedby="${P}shot-note"><span aria-hidden="true">📷</span> Save image</button>
        <p class="gh-note" id="${P}shot-note">The image shows where you play — look it over before you share it.</p>
      </details>
      <div id="${P}legend" class="globe-hud globe-legend"></div>
      <div id="${P}country" class="globe-hud globe-country" hidden></div>
      <button id="${P}fs" class="gh-btn globe-fs" type="button" aria-label="View the globe full screen">⛶ Full screen</button>
    </div>
    <!-- the timeline: play the journey month by month, pause on any month, scrub back and forth.
         Inside the wrap so full-screen keeps it with the stage. -->
    <div class="globe-timeline" id="${P}tl" hidden>
      <button id="${P}tl-play" class="tl-btn tl-play" type="button" aria-label="Play the timeline"><span aria-hidden="true">▶</span></button>
      <button id="${P}tl-prev" class="tl-btn tl-step" type="button" aria-label="Previous month">‹</button>
      <input type="range" id="${P}tl-range" class="tl-range" min="0" max="0" value="0" aria-label="Month on the timeline">
      <button id="${P}tl-next" class="tl-btn tl-step" type="button" aria-label="Next month">›</button>
      <div class="tl-label"><b id="${P}tl-month">All time</b><span id="${P}tl-span" class="mono"></span></div>
      <div class="tl-mode" role="group" aria-label="What the globe shows">
        <button type="button" data-mode="cum" aria-pressed="true">Up to this month</button>
        <button type="button" data-mode="month" aria-pressed="false">This month only</button>
      </div>
      <label class="tl-follow"><input type="checkbox" id="${P}tl-follow"${REDUCED_MOTION ? "" : " checked"}> Follow the action</label>
      <button id="${P}tl-all" class="tl-btn tl-step" type="button" title="Show the whole journey again">All time</button>
    </div>
    <div class="tl-stats" id="${P}tl-stats" hidden></div>
    </div>
    <div id="${P}below" class="globe-below"></div>
  </div>`;

  later(() => {
    try { initGlobe({ P, points, maxCount, arcs, home, paths }); }
    catch (err) {
      console.warn("globe init failed", err);
      /* By now the module — loading overlay and all — is already on the page,
       * and initGlobe's own stall timeout is registered too late to help: it
       * sits below the Globe() constructor, so a throw there never reaches it.
       * Without this the overlay says "Spinning up the world…" forever. */
      globeFailed(P, "The globe couldn't start — this browser or device refused WebGL.");
    }
  });
  return html;
}

/* Turn the globe's loading overlay into an honest error state. */
function globeFailed(P, msg) {
  const l = $(P + "loading");
  if (!l || l.classList.contains("done")) return;
  l.textContent = msg;
  const rb = document.createElement("button");
  rb.className = "gh-btn"; rb.type = "button"; rb.style.marginTop = "10px";
  rb.textContent = "↻ Reload and try again";
  rb.onclick = () => location.reload();
  l.appendChild(rb);
}

function initGlobe({ P, points, maxCount, arcs, home, paths }) {
  // declared up here because the Globe() chain below reads it
  const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
  const e = STATE.ev;
  const el = $(P + "canvas");
  if (!el || !window.Globe) return;
  const KIND_COLORS = SERIES_COLORS;
  const maxArcKm = Math.max(1, ...arcs.map((a) => a.km));
  let arcMax = maxArcKm;
  const $$ = (id) => $(P + id);

  const world = Globe({ rendererConfig: { preserveDrawingBuffer: true, antialias: true } })(el)
    .width(el.clientWidth).height(el.clientHeight || 560)
    /* 2560x1280, down from 4096x2048 — 351 KB instead of 715 KB, and the
     * biggest single asset on the site. Chosen by rendering all three at the
     * same locked camera and comparing: at 2048 the city lights visibly thin
     * out (the speckle around the LA basin and Vegas goes soft), at 2560 nearly all
     * of it survives. Re-encoding at 4096 was a dead end — the source is
     * already near its quality floor, and anything above q45 came out LARGER.
     * Resolution is in the filename because /vendor/* ships immutable. */
    .globeImageUrl("vendor/img/earth-night-2560.jpg")
    /* JPEG, not PNG. This is an 8-bit grayscale heightfield that only perturbs
     * surface normals, so lossy encoding is invisible here and PNG was costing
     * 192 KB for nothing. The extension change gives it a fresh URL, which
     * matters because /vendor/* ships immutable — textures are never replaced
     * in place. */
    .bumpImageUrl("vendor/img/earth-topology.jpg")
    .backgroundImageUrl("vendor/img/night-sky.jpg")
    .atmosphereColor(C.teal).atmosphereAltitude(0.18)
    .pointsData(points).pointLat("lat").pointLng("lng")
    .pointAltitude((p) => 0.004 + Math.log10(p.count + 1) / Math.log10(maxCount + 1) * 0.13)
    .pointRadius((p) => (p.count > 1000 ? 0.045 : 0.026))
    .pointColor((p) => KIND_COLORS[p.kind] || C.teal)
    .pointLabel((p) => `<b>${fmt(p.count)}</b> ${p.kind.toLowerCase()}`)
    // Merging collapses thousands of point meshes into one draw call. Phones
    // need that far more than they need per-point hover labels (which touch
    // screens can't show anyway); desktops keep the labels.
    .pointsMerge(coarse)
    .arcsData(arcs).arcStartLat("slat").arcStartLng("slng").arcEndLat("elat").arcEndLng("elng")
    .arcColor((a) => { const t = Math.min(1, a.km / 9000); return ["rgba(65,216,198,.75)", t < 0.5 ? "rgba(255,203,5,.8)" : "rgba(255,83,80,.85)"]; })
    .arcStroke((a) => 0.18 + Math.log10(a.count + 1) * 0.28)
    .arcAltitudeAutoScale(0.42).arcDashLength(0.45).arcDashGap(0.6)
    .arcDashAnimateTime(REDUCED_MOTION ? 0 : (a) => 2200 + (a.km % 1500))
    .arcLabel((a) => `<b>${fmt(a.count)}</b> raid${a.count > 1 ? "s" : ""} · ${fmt(Math.round(a.km))} km away`)
    .pathsData(paths).pathPoints("pts").pathPointLat((p) => p[0]).pathPointLng((p) => p[1]).pathPointAlt((p) => p[2])
    .pathColor(() => ["rgba(255,203,5,.9)", "rgba(255,157,66,.9)"])
    .pathStroke(1.6).pathDashLength(0.18).pathDashGap(0.035).pathDashAnimateTime(REDUCED_MOTION ? 0 : 14000)
    // instant path updates — the default 1s enter-transition swallowed every
    // frame of the time-lapse (each step restarted it before it finished)
    .pathTransitionDuration(0)
    .pathLabel((p) => `GPS trail · ${p.date}`)
    // reduced-motion users asked the OS for stillness — no pulsing home ring
    .ringsData(REDUCED_MOTION ? [] : [{ lat: home.lat, lng: home.lng }])
    .ringColor(() => (t) => `rgba(65,216,198,${1 - t})`)
    .ringMaxRadius(2.6).ringPropagationSpeed(1.1).ringRepeatPeriod(1400)
    .onGlobeReady(() => { world.__ready = true; const l = $$("loading"); if (l) l.classList.add("done"); world.pointOfView({ lat: home.lat, lng: home.lng, altitude: 1.9 }, REDUCED_MOTION ? 0 : 1600); });
  GLOBE = world;

  // never leave an eternal "Spinning up the world…" — if WebGL or a texture
  // stalls, tell the user and offer a reload
  setTimeout(() => {
    if (GLOBE !== world || world.__ready) return;
    const l = $$("loading");
    if (l && !l.classList.contains("done")) {
      l.innerHTML = `The globe is stuck — a texture may have failed to load, or WebGL gave up.`;
      const rb = document.createElement("button");
      rb.className = "gh-btn"; rb.type = "button"; rb.style.marginTop = "10px";
      rb.textContent = "↻ Reload and try again";
      rb.onclick = () => location.reload();
      l.appendChild(rb);
    }
  }, 15000);
  if (!arcs.length) world.arcsData([]);
  if (!paths.length) world.pathsData([]);

  const controls = world.controls();
  controls.autoRotate = !REDUCED_MOTION; controls.autoRotateSpeed = 0.45;
  controls.minDistance = world.getGlobeRadius() * 1.18;
  const canvas = world.renderer().domElement;
  let gated = false; // true while the touch gate below keeps the globe's gestures off
  let held = false;  // a finger or button is down on the globe and has stopped the spin
  canvas.addEventListener("pointerdown", () => { if (!gated) { held = true; controls.autoRotate = false; } });
  // pointercancel too: a swipe the browser takes over to scroll the page never
  // sends a pointerup, and would have left the globe standing still
  const letGo = () => { if (held) { held = false; controls.autoRotate = $$("ly-rotate").checked; } };
  canvas.addEventListener("pointerup", letGo);
  canvas.addEventListener("pointercancel", letGo);

  // On touch screens the globe would otherwise swallow every swipe — a scroll
  // trap on a long results page. Gate interaction behind one explicit tap.
  const stage = el.closest(".globe-stage");
  let gate = null;
  if (coarse && stage) {
    const scrim = document.createElement("button");
    scrim.type = "button";
    scrim.className = "globe-scrim";
    scrim.textContent = "👆 Tap to explore the globe";
    stage.appendChild(scrim);
    // …and a way back out. Exploring, the globe keeps every touch that lands on
    // it, and a phone held sideways can show little else.
    const done = document.createElement("button");
    done.type = "button";
    done.className = "globe-scrim globe-done";
    done.textContent = "Done exploring";
    stage.appendChild(done);
    /* The gate switches off the gestures, not the controls. three-render-objects,
     * which runs globe.gl's render loop, only steps enabled controls since
     * 1.40.1, and only advances its frame clock when it does: with the controls
     * disabled the auto-rotate froze behind the gate, and the first frame after
     * the tap caught up on as much as a second of turning in one lurch. Left
     * enabled with every gesture off, the loop turns the globe at its steady
     * pace before the tap and after it. */
    const allowed = { enableRotate: controls.enableRotate, enableZoom: controls.enableZoom, enablePan: controls.enablePan };
    gate = (up) => {
      gated = up;
      for (const k in allowed) controls[k] = up ? false : allowed[k];
      /* OrbitControls sets touch-action:none on the canvas when it connects,
       * listening or not, so behind the gate a finger that happened to land on
       * the globe still couldn't scroll the page. The page keeps the swipe
       * until the player taps in, and gets it back when they leave. */
      canvas.style.touchAction = up ? "auto" : "none";
      scrim.hidden = !up;
      done.hidden = up || !!document.fullscreenElement; // full screen has its own way out
    };
    scrim.addEventListener("click", () => gate(false));
    done.addEventListener("click", () => gate(true));
    gate(true);
  }
  // collapse the Layers panel by default where there's no room for it
  const layersEl = $$("layers");
  if (layersEl && window.innerWidth <= 860) layersEl.open = false;

  // full-screen mode — the wrap keeps the time-lapse bar with the stage
  const wrap = $$("wrap"), fsBtn = $$("fs");
  if (fsBtn) {
    if (!wrap || !wrap.requestFullscreen) fsBtn.style.display = "none"; // e.g. iPhone Safari
    else {
      fsBtn.onclick = () => {
        if (document.fullscreenElement) document.exitFullscreen();
        else wrap.requestFullscreen().catch(() => {});
      };
      const onFs = () => {
        fsBtn.textContent = document.fullscreenElement ? "✕ Exit full screen" : "⛶ Full screen";
        // full screen has no page to scroll, so the globe takes the touches
        // while it lasts and hands them back to the page when it ends
        if (gate) gate(document.fullscreenElement !== wrap);
        // let the fullscreen layout settle, then resize the WebGL canvas to it
        setTimeout(() => { if (GLOBE === world && el.isConnected) { world.width(el.clientWidth).height(el.clientHeight || 560); relabelSoon(); } }, 80);
      };
      document.addEventListener("fullscreenchange", onFs);
      GLOBE_CLEANUP.push(() => document.removeEventListener("fullscreenchange", onFs));
    }
  }

  /* The render loop only moves its frame clock while it runs, so the first
   * frame after a pause was stepped by the whole pause (capped at a second):
   * auto-rotate turned the globe ~3° at once, and the controls' damping spread
   * that into a surge that took a second to die down, every time the globe
   * scrolled back into view. resumeAnimation() draws that first frame straight
   * away, so auto-rotate is held off for it: the stale step turns nothing and
   * the spin carries on at its steady pace. */
  const resume = () => {
    const spin = controls.autoRotate;
    controls.autoRotate = false;
    world.resumeAnimation();
    controls.autoRotate = spin;
  };
  let inView = true;
  // don't burn GPU on a globe nobody is looking at
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(([en]) => {
      if (GLOBE !== world) return;
      inView = en.isIntersecting;
      if (en.isIntersecting) {
        resume();
        if (labelStale) relabelSoon(); // the names were held while the stage had no size
      } else {
        world.pauseAnimation();
        if (gate) gate(true); // re-arm the tap gate, and give the page its swipe back
      }
    }, { threshold: 0.05 });
    io.observe(el);
    GLOBE_CLEANUP.push(() => io.disconnect());
  }
  // a hidden tab gets no frames either — restart the loop the same way on return
  const onVis = () => {
    if (document.hidden || GLOBE !== world || !inView) return;
    world.pauseAnimation();
    resume();
  };
  document.addEventListener("visibilitychange", onVis);
  GLOBE_CLEANUP.push(() => document.removeEventListener("visibilitychange", onVis));

  // stats
  const geoEvents = [...e.geo.values()].reduce((a, b) => a + b, 0);
  const stats = [[fmt(geoEvents), "geotagged events"], [fmt(e.geo.size), "distinct spots"]];
  // "raid reach", not distance travelled — nobody walked these kilometres.
  if (e.raidRemote) { stats.push([fmt(e.raidRemote), "remote raids"], [fmt(round(e.raidMaxKm)) + " km", "farthest raid"], [(e.raidKmSum / 40075).toFixed(1) + "×", "Earth's circumference in raid reach"]); }
  if (paths.length) stats.push([fmt(paths.length), "days of trail"]);
  $$("stats").innerHTML = stats.map(([v, l]) => `<div class="gh-stat"><div class="v">${v}</div><div class="l">${esc(l)}</div></div>`).join("");

  // legend
  $$("legend").innerHTML = `<div class="gh-title">Columns = where you played</div>` +
    Object.entries(KIND_COLORS).filter(([k]) => points.some((p) => p.kind === k))
      .map(([k, c]) => `<span class="gh-li"><span class="gh-d" style="background:${c}"></span>${esc(k)}</span>`).join("") +
    `<div style="margin-top:6px;opacity:.85">Arcs: <span style="color:${C.yellow}">near</span> → <span style="color:${C.red}">far</span> remote raids.</div>`;

  // borders + per-country raid tally
  let borderFeatures = [];
  let countryLabels = [];
  const countryRaids = {};

  /* ── country names, built only where they can be read ──
     three-globe 2.45 extrudes every label with a zero-size bevel (its fix for
     three r175), which quadrupled the vertices: the 180 names came to 2.2
     million, drawn every frame, and rebuilt in one main-thread task that took
     1.2 s on a phone-speed CPU. From orbit most of them are a pixel or two
     tall. So a name is only built once it is big enough to read — its height
     on screen follows from its size, the camera's altitude and the stage's
     height — and the set only steps at a few fixed altitudes, once a zoom
     settles. Below the last step all 180 are built, so zoomed in none is
     missing.
     Any change to labelsData rebuilds every name in it, not just the new
     ones, so a name once built is kept for the rest of the page view. One too
     small to read at the current zoom, or every one while the names are
     switched off, is hidden rather than torn down, and showing it again
     builds nothing: each step's names are paid for the first time the camera
     reaches it, and never again. Hidden, a name draws nothing and lets the
     pointer through to its country. */
  const LABEL_MIN_PX = 3;              // estimated text height worth drawing
  const LABEL_STEPS = [1.6, 1.1, 0.7]; // camera altitudes, in globe radii, where the set changes
  let labelStep = -1, labelTimer = null, labelAlt = 0;
  let labelStale = false; // the names were last looked at while the stage had no size
  const stepAt = (alt) => { const i = LABEL_STEPS.findIndex((a) => alt >= a); return i < 0 ? LABEL_STEPS.length : i; };
  // hold the current step until the camera is 6% past its edge, so a zoom that
  // stops on a boundary can't flip the set back and forth
  const wantStep = (alt) => (labelStep >= stepAt(alt * 1.06) && labelStep <= stepAt(alt / 1.06) ? labelStep : stepAt(alt));
  const cameraAlt = () => world.camera().position.length() / world.getGlobeRadius() - 1;
  // the names big enough to read at a step, on a stage h CSS px tall
  const readableAt = (step, h) => {
    if (step >= LABEL_STEPS.length) return countryLabels;
    // CSS px that one degree of label size spans, one globe radius from the camera
    const pxPerDeg = (Math.PI / 180) * h / (2 * Math.tan((world.camera().fov * Math.PI) / 360));
    return countryLabels.filter((d) => (d.size * pxPerDeg) / LABEL_STEPS[step] >= LABEL_MIN_PX);
  };
  // names shown again grow back into place over a second, the way new ones do
  const growing = new Map(); // label object → when it started to grow
  let growFrame = 0;
  const grow = (t) => {
    growFrame = 0;
    if (GLOBE !== world) return growing.clear();
    growing.forEach((t0, o) => {
      const k = Math.max(0, Math.min(1, (t - t0) / 1000));
      o.scale.setScalar(Math.max(1e-6, k < 0.5 ? 2 * k * k : 1 - 2 * (1 - k) * (1 - k))); // quadratic in-out, as three-globe eases them
      if (k === 1) growing.delete(o);
    });
    if (growing.size) growFrame = requestAnimationFrame(grow);
  };
  // a hidden name mustn't catch the hover or the click meant for the country under it
  world.pointerEventsFilter((obj) => obj.__globeObjType !== "label" || obj.visible);
  const relabel = () => {
    if (GLOBE !== world || !el.isConnected) return;
    // A stage with no height is hidden (reader mode on another chapter, say).
    // Nothing on it can be judged readable, so every name stays as it is until
    // it shows again, rather than all of them going and growing back each time.
    if (!el.clientHeight) { labelStale = true; return; }
    labelStale = false;
    labelStep = wantStep(cameraAlt());
    const want = new Set($$("ly-labels").checked ? readableAt(labelStep, el.clientHeight) : []);
    const have = new Set(world.labelsData());
    if (countryLabels.some((d) => want.has(d) && !have.has(d))) world.labelsData(countryLabels.filter((d) => want.has(d) || have.has(d)));
    // Show the readable names already built and hide the rest. A name shown
    // again grows in; one still growing in from its build carries on as it was.
    const t0 = performance.now();
    let built = 0;
    world.scene().traverse((o) => {
      if (o.__globeObjType !== "label" || !o.__data) return;
      built++;
      const show = want.has(o.__data);
      if (show === o.visible) return;
      o.visible = show;
      if (!show) { if (growing.delete(o)) o.scale.setScalar(1); }
      else if (!REDUCED_MOTION && o.scale.x >= 1) growing.set(o, t0);
    });
    if (growing.size && !growFrame) growFrame = requestAnimationFrame(grow);
    // new names are built on globe.gl's next update, shown: look again once
    // they're there, in case the set or the switch has changed since
    if (built < world.labelsData().length) relabelSoon();
  };
  const relabelSoon = () => { clearTimeout(labelTimer); labelTimer = setTimeout(() => { labelTimer = null; relabel(); }, 250); };
  // every camera move comes through here, auto-rotate's included, so it stays cheap
  controls.addEventListener("change", () => {
    if (GLOBE !== world || !countryLabels.length) return;
    const box = $$("ly-labels");
    if (!box || !box.checked) return;
    const alt = cameraAlt();
    const zooming = Math.abs(alt - labelAlt) > alt * 1e-3;
    labelAlt = alt;
    // while the zoom is still moving, keep pushing the rebuild back. A pending
    // one is never cancelled here: relabel() rebuilds only if the set really
    // changed, and a resize may have queued one that auto-rotate must not undo.
    if (wantStep(alt) !== labelStep && (zooming || !labelTimer)) relabelSoon();
  });
  GLOBE_CLEANUP.push(() => clearTimeout(labelTimer));

  Promise.all([
    fetch("vendor/geo/countries.geo.json").then((r) => r.json()),
    fetch("vendor/geo/us-states.geo.json").then((r) => r.json()).catch(() => ({ features: [] })),
  ]).then(([countries, states]) => {
    countries.features.forEach((f) => { f.properties._kind = "country"; f._centroid = featureCentroid(f); f._bbox = featureBBox(f); });
    states.features.forEach((f) => (f.properties._kind = "state"));
    borderFeatures = [...countries.features, ...states.features];
    // Attribute each remote raid to a country. If the endpoint isn't inside any
    // polygon (coarse coastlines leave gaps), snap to the nearest country so the
    // tally lands on the right place and reliably shows on hover.
    arcs.forEach((a) => {
      let f = countries.features.find((ft) => featureContains(ft, a.elng, a.elat));
      if (!f) f = nearestCountry(countries.features, a.elng, a.elat, 10);
      const nm = f ? f.properties.name : "Open water";
      const r = countryRaids[nm] || (countryRaids[nm] = { raids: 0, dests: new Set() });
      r.raids += a.count; r.dests.add(a.elat.toFixed(1) + "," + a.elng.toFixed(1));
      a._country = nm;
    });

    // Name the countries that matter to this journey: everywhere you raided,
    // your home country, and any country your activity columns sit inside.
    const active = new Set(Object.keys(countryRaids).filter((n) => n !== "Open water"));
    const homeC = countries.features.find((ft) => featureContains(ft, home.lng, home.lat)) || nearestCountry(countries.features, home.lng, home.lat, 6);
    if (homeC) active.add(homeC.properties.name);
    const sampled = points.slice(0, 600);
    countries.features.forEach((f) => {
      if (active.has(f.properties.name)) return;
      if (sampled.some((p) => featureContains(f, p.lng, p.lat))) active.add(f.properties.name);
    });
    // Label EVERY country, not just the ones you played in — the globe reads as a
    // real map that way. Each label is scaled to its country's own east-west extent
    // so the text fits inside the shape: Russia gets big type, Luxembourg gets tiny
    // type, and dense regions stop stacking into an unreadable pile. Countries that
    // are part of your journey are drawn brighter so they still stand out.
    countryLabels = countries.features
      .filter((f) => f._centroid)
      .map((f) => {
        const name = f.properties.name;
        const mine = active.has(name);
        const size = Math.max(0.16, Math.min(0.72,
          (0.5 * (f._centroid.widthDeg || 0)) / Math.max(name.length, 3)));
        return {
          lat: f._centroid.lat, lng: f._centroid.lng, name, mine, size,
          color: mine ? "rgba(236,240,255,.95)" : "rgba(155,161,197,.62)",
          raids: (countryRaids[name] || {}).raids || 0,
        };
      });

    world.polygonsData($$("ly-borders").checked ? borderFeatures : [])
      .polygonCapColor(() => "rgba(0,0,0,0)").polygonSideColor(() => "rgba(0,0,0,0)")
      .polygonStrokeColor((f) => (f.properties._kind === "country" ? "rgba(120,140,220,.55)" : "rgba(120,140,220,.25)"))
      .polygonAltitude(0.0028).polygonsTransitionDuration(0)
      .polygonLabel((f) => { if (f.properties._kind !== "country") return ""; const r = countryRaids[f.properties.name]; return `<b>${f.properties.name}</b>` + (r ? `<br>${fmt(r.raids)} remote raid${r.raids > 1 ? "s" : ""} into ${r.dests.size} spot${r.dests.size > 1 ? "s" : ""}` : `<br><span style="opacity:.7">no remote raids here</span>`); })
      .onPolygonClick((f) => { if (f.properties._kind === "country") showCountry(f.properties.name); });

    // always-on country name labels, centred on each country's centroid
    // (text geometry auto-centres with the default "bottom" dot orientation;
    // a low altitude keeps the label sitting on the country, not floating off it)
    world.labelLat("lat").labelLng("lng").labelText((d) => d.name)
      .labelSize((d) => d.size).labelDotRadius(0).labelIncludeDot(false)
      .labelColor((d) => d.color).labelAltitude(0.006)
      // one segment per glyph curve: at the sizes these names draw it can't be
      // told from two, and it is 40% fewer vertices to build and to draw
      .labelResolution(1)
      // names that come into reach as the camera closes in grow into place
      .labelsTransitionDuration(REDUCED_MOTION ? 0 : 1000);
    relabel();

    // below-globe: remote-raid empire + epic hauls
    const empire = Object.entries(countryRaids).filter(([n]) => n !== "Open water").sort((a, b) => b[1].raids - a[1].raids);
    const topArcs = [...arcs].sort((a, b) => b.km - a.km).slice(0, 4);
    const below = $$("below");
    if (below && (empire.length || topArcs.length)) {
      below.innerHTML = `<div class="split" style="margin-top:18px">
        ${empire.length ? `<div><h4 class="mod-h4">🌐 Your remote-raid empire</h4>${rankList(empire.slice(0, 10).map(([n, r]) => [n, r.raids]))}</div>` : "<div></div>"}
        ${topArcs.length ? `<div><h4 class="mod-h4">🚀 Longest hauls</h4>${calloutRow(topArcs.map((a) => [fmt(round(a.km)) + " km", a._country && a._country !== "Open water" ? "to " + a._country : "to a far-off gym"]))}</div>` : "<div></div>"}
      </div>`;
    }
  }).catch(() => {});

  function showCountry(name) {
    const r = countryRaids[name];
    const el2 = $$("country");
    el2.hidden = false;
    el2.innerHTML = `<button class="gc-x" title="Close">×</button><div class="gc-name">${esc(name)}</div>` +
      (r ? `<div class="gc-stat">${fmt(r.raids)} remote raid${r.raids > 1 ? "s" : ""} into ${r.dests.size} spot${r.dests.size > 1 ? "s" : ""}.</div>` : `<div class="gc-stat muted">No remote raids landed here.</div>`);
    el2.querySelector(".gc-x").onclick = () => { el2.hidden = true; };
  }

  /* ── one view function ──
     Everything that decides what the globe shows — the layer toggles, the arc
     distance slider and the timeline — funnels through refresh(), so a month
     picked on the slider and a layer switched off never fight over the data. */
  const tl = $$("tl");
  const months = monthSpan([...new Set([
    ...Object.keys(e.byMonth),
    ...points.flatMap((pt) => Object.keys(pt.months || {})),
    ...arcs.flatMap((ar) => Object.keys(ar.months || {})),
    ...paths.map((pa) => pa.date.slice(0, 7)),
  ])]);
  let cur = null;          // month key on the timeline; null = the whole journey
  let mode = "cum";        // "cum": everything up to the month · "month": that month alone
  const inMonth = (o, m) => !!(o.months && o.months[m]);
  const upTo = (o, m) => { if (!o.months) return o.count; let n = 0; for (const k in o.months) if (k <= m) n += o.months[k]; return n; };
  const refresh = () => {
    if (GLOBE !== world || !el.isConnected) return;
    let pts, arcsNow, pathsNow;
    if (cur === null) { pts = points; arcsNow = arcs; pathsNow = paths; }
    else if (mode === "month") {
      pts = points.filter((pt) => inMonth(pt, cur)).map((pt) => ({ ...pt, count: pt.months[cur] }));
      arcsNow = arcs.filter((ar) => inMonth(ar, cur)).map((ar) => ({ ...ar, count: ar.months[cur] }));
      pathsNow = paths.filter((pa) => pa.date.slice(0, 7) === cur);
    } else {
      pts = points.filter((pt) => !pt.m || pt.m <= cur).map((pt) => ({ ...pt, count: upTo(pt, cur) }));
      arcsNow = arcs.filter((ar) => !ar.m || ar.m <= cur).map((ar) => ({ ...ar, count: upTo(ar, cur) }));
      pathsNow = paths.filter((pa) => pa.date.slice(0, 7) <= cur);
    }
    world.pointsData($$("ly-points").checked ? pts : []);
    world.arcsData($$("ly-arcs").checked ? arcsNow.filter((ar) => ar.km <= arcMax + 0.5) : []);
    world.pathsData($$("ly-trail").checked ? pathsNow : []);
    return pts;
  };
  $$("ly-points").onchange = refresh;
  $$("ly-arcs").onchange = (ev) => { refresh(); $$("arc-ctl").classList.toggle("disabled", !ev.target.checked); };
  $$("ly-trail").onchange = refresh;
  $$("ly-borders").onchange = (ev) => world.polygonsData(ev.target.checked ? borderFeatures : []);
  $$("ly-labels").onchange = relabel;
  $$("ly-rotate").onchange = (ev) => { controls.autoRotate = ev.target.checked; };
  $$("shot").onclick = () => screenshotGlobe(world, $$("shot"));
  if (!arcs.length) $$("arc-ctl").classList.add("disabled");
  const arcDist = $$("arc-dist");
  arcDist.oninput = () => {
    arcMax = +arcDist.value / 100 * maxArcKm;
    $$("arc-lbl").textContent = +arcDist.value >= 100 ? "all distances" : "≤ " + fmt(Math.round(arcMax)) + " km";
    refresh();
  };

  /* ── the timeline ──
     Play the journey month by month, pause on any month, step, or scrub back
     and forth. "Up to this month" shows the journey the way it accumulated —
     columns grow as months pass; "This month only" shows just what happened
     then. Per-month tallies were kept at parse (geoMonths / arcMonths); the
     trail is day-keyed already. With "Follow the action" on, the camera
     flies to that month's centre of gravity when it moves a long way. */
  if (tl && months.length >= 2) {
    tl.hidden = false;
    const range = $$("tl-range"), playBtn = $$("tl-play"), monthEl = $$("tl-month"), spanEl = $$("tl-span"), statsEl = $$("tl-stats"), follow = $$("tl-follow");
    range.max = months.length - 1;
    range.value = months.length - 1;
    spanEl.textContent = `${fmtMonth(months[0])} → ${fmtMonth(months[months.length - 1])}`;
    let timer = null, ticker = null, playing = false, rotateWas = null;
    const dwell = Math.max(260, Math.min(700, 26000 / months.length));
    // every festival that month, global or attended in person — the same rule as eventFor
    const monthEvent = (m) => {
      const days = [...Object.keys(GO_EVENTS), ...Object.values(e.there).flatMap((s) => Object.keys(s.days))].filter((k) => k.startsWith(m)).sort();
      const names = [...new Set(days.map(eventFor).filter(Boolean).flatMap((n) => n.split(" · ")))];
      return names.length ? names.join(" · ") : null;
    };
    const setTicker = () => {
      if (cur === null) { if (ticker) { ticker.remove(); ticker = null; } return; }
      if (!ticker) { ticker = document.createElement("div"); ticker.className = "globe-ticker"; stage.appendChild(ticker); }
      ticker.textContent = fmtMonth(cur);
    };
    const renderStats = (pts) => {
      if (cur === null) { statsEl.hidden = true; statsEl.innerHTML = ""; return; }
      const chips = [];
      const bm = e.byMonth[cur] || {};
      const actions = Object.values(bm).reduce((x, y) => x + y, 0);
      const top = Object.entries(bm).sort((x, y) => y[1] - x[1])[0];
      chips.push([fmt(actions), "actions that month"]);
      if (top) chips.push([esc(top[0]), "busiest activity"]);
      const fresh = points.filter((pt) => pt.m === cur).length;
      const pl = (n, w) => (n === 1 ? w : w + "s");
      chips.push([fmt(pts.length), mode === "month" ? pl(pts.length, "spot") + " played that month" : pl(pts.length, "spot") + " so far"]);
      if (fresh) chips.push([fmt(fresh), "new " + pl(fresh, "spot")]);
      const remote = arcs.reduce((x, ar) => x + (mode === "month" ? (ar.months && ar.months[cur]) || 0 : upTo(ar, cur)), 0);
      if (remote) chips.push([fmt(remote), pl(remote, "remote raid") + (mode === "month" ? " that month" : " so far")]);
      const days = paths.filter((pa) => pa.date.slice(0, 7) === cur).length;
      if (days) chips.push([fmt(days), pl(days, "day") + " of GPS trail"]);
      const ev = monthEvent(cur);
      statsEl.hidden = false;
      statsEl.innerHTML = chips.map(([v, l]) => `<div class="gh-stat"><div class="v">${v}</div><div class="l">${esc(l)}</div></div>`).join("")
        + (ev ? `<div class="gh-stat ev"><div class="v">${esc(ev)}</div><div class="l">event that month</div></div>` : "");
    };
    const flyTo = (pts) => {
      if (cur === null || !follow.checked || REDUCED_MOTION || !pts.length) return;
      const focus = mode === "month" ? pts : pts.filter((pt) => inMonth(pt, cur));
      if (!focus.length) return;
      let la = 0, lo = 0, w = 0;
      for (const pt of focus) { const c = Math.log10(pt.count + 1) + 0.1; la += pt.lat * c; lo += pt.lng * c; w += c; }
      const target = { lat: la / w, lng: lo / w };
      const pov = world.pointOfView();
      if (haversine(pov.lat, pov.lng, target.lat, target.lng) > 600) world.pointOfView({ lat: target.lat, lng: target.lng, altitude: pov.altitude }, 700);
    };
    const show = (fly) => {
      const pts = refresh() || [];
      monthEl.textContent = cur === null ? "All time" : fmtMonth(cur);
      spanEl.textContent = cur === null
        ? `${fmtMonth(months[0])} → ${fmtMonth(months[months.length - 1])}`
        : `${months.indexOf(cur) + 1} of ${months.length}`;
      setTicker();
      renderStats(pts);
      if (fly) flyTo(pts);
    };
    const goTo = (i, fly = true) => { cur = months[Math.max(0, Math.min(months.length - 1, i))]; range.value = months.indexOf(cur); show(fly); };
    const stop = () => {
      if (!playing) return;
      playing = false; clearTimeout(timer); timer = null;
      playBtn.innerHTML = '<span aria-hidden="true">▶</span>'; playBtn.setAttribute("aria-label", "Play the timeline");
      if (rotateWas !== null) { controls.autoRotate = rotateWas && $$("ly-rotate").checked; rotateWas = null; }
    };
    const play = () => {
      if (playing) return stop();
      let i = cur === null ? -1 : months.indexOf(cur);
      if (i >= months.length - 1) i = -1;       // at the end: play again from the start
      playing = true; rotateWas = controls.autoRotate; controls.autoRotate = false;
      playBtn.innerHTML = '<span aria-hidden="true">❚❚</span>'; playBtn.setAttribute("aria-label", "Pause the timeline");
      const step = () => {
        if (GLOBE !== world || !el.isConnected) return stop();
        goTo(i + 1); i = months.indexOf(cur);
        if (i < months.length - 1) timer = setTimeout(step, dwell);
        else stop();
      };
      step();
    };
    playBtn.onclick = play;
    $$("tl-prev").onclick = () => { stop(); goTo((cur === null ? months.length : months.indexOf(cur)) - 1); };
    $$("tl-next").onclick = () => { stop(); goTo(cur === null ? 0 : months.indexOf(cur) + 1); };
    $$("tl-all").onclick = () => { stop(); cur = null; range.value = months.length - 1; show(false); };
    range.oninput = () => { goTo(+range.value); };   // scrubbing while playing keeps playing from there
    tl.querySelectorAll(".tl-mode button").forEach((b) => {
      b.onclick = () => {
        mode = b.dataset.mode;
        tl.querySelectorAll(".tl-mode button").forEach((x) => x.setAttribute("aria-pressed", String(x === b)));
        if (cur === null) goTo(months.length - 1, false); else show(true);
      };
    });
    GLOBE_CLEANUP.push(() => { clearTimeout(timer); if (ticker) ticker.remove(); });
  }

  // a taller stage draws every name bigger, so which ones can be read changes with it
  const onResize = () => { if (GLOBE === world && el.isConnected) { world.width(el.clientWidth).height(el.clientHeight || 560); relabelSoon(); } };
  window.addEventListener("resize", onResize);
  GLOBE_CLEANUP.push(() => window.removeEventListener("resize", onResize));
}

/* --- GeoJSON point-in-polygon (lng/lat order) --- */
function pointInRing(lng, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1], xj = ring[j][0], yj = ring[j][1];
    if (((yi > lat) !== (yj > lat)) && (lng < (xj - xi) * (lat - yi) / (yj - yi) + xi)) inside = !inside;
  }
  return inside;
}
function polygonContains(lng, lat, rings) {
  if (!rings.length || !pointInRing(lng, lat, rings[0])) return false;
  for (let h = 1; h < rings.length; h++) if (pointInRing(lng, lat, rings[h])) return false;
  return true;
}
function featureContains(f, lng, lat) {
  const g = f.geometry;
  if (!g) return false;
  // bbox early-reject: skips the full ray-cast for ~99% of countries per test
  const b = f._bbox;
  if (b && (lng < b[0] || lng > b[2] || lat < b[1] || lat > b[3])) return false;
  if (g.type === "Polygon") return polygonContains(lng, lat, g.coordinates);
  if (g.type === "MultiPolygon") return g.coordinates.some((p) => polygonContains(lng, lat, p));
  return false;
}
/* [minLng, minLat, maxLng, maxLat] over every ring of a feature */
function featureBBox(f) {
  const g = f.geometry;
  if (!g) return null;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  polys.forEach((rings) => rings.forEach((ring) => ring.forEach(([x, y]) => {
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
  })));
  return minX === Infinity ? null : [minX, minY, maxX, maxY];
}
/* area-weighted centroid of a ring (lng/lat order) */
function ringCentroid(ring) {
  let a = 0, cx = 0, cy = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const x0 = ring[j][0], y0 = ring[j][1], x1 = ring[i][0], y1 = ring[i][1];
    const f = x0 * y1 - x1 * y0;
    a += f; cx += (x0 + x1) * f; cy += (y0 + y1) * f;
  }
  a *= 0.5;
  if (Math.abs(a) < 1e-9) { // degenerate sliver — fall back to vertex average
    let sx = 0, sy = 0; ring.forEach(([x, y]) => { sx += x; sy += y; });
    return { lng: sx / ring.length, lat: sy / ring.length, area: 0 };
  }
  return { lng: cx / (6 * a), lat: cy / (6 * a), area: Math.abs(a) };
}
/* centroid of a feature's largest polygon — a good spot for a country label.
 * Also returns that polygon's east-west extent in lat-corrected degrees, which
 * is what lets each label be sized to the country it sits on (big type across
 * Canada, small type in the Caribbean) instead of one size for everything. */
function featureCentroid(f) {
  const g = f.geometry;
  if (!g) return null;
  const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
  let best = null, bestRing = null;
  polys.forEach((rings) => {
    if (!rings[0]) return;
    const c = ringCentroid(rings[0]);
    if (!best || c.area > best.area) { best = c; bestRing = rings[0]; }
  });
  if (!best) return null;
  let lons = bestRing.map((p) => p[0]);
  if (Math.max(...lons) - Math.min(...lons) > 180) lons = lons.map((l) => (l < 0 ? l + 360 : l)); // antimeridian
  const widthDeg = (Math.max(...lons) - Math.min(...lons)) * Math.cos((best.lat * Math.PI) / 180);
  return { lat: best.lat, lng: best.lng, widthDeg };
}
/* nearest country by distance to its border vertices, within maxDeg degrees —
 * used to snap raid endpoints that land just off a coarse coastline back onto
 * land. (Centroid distance is useless here: a point hugging the coast of a
 * large country can be 20°+ from its centroid, which read as "Open water".) */
function nearestCountry(features, lng, lat, maxDeg) {
  let best = null, bestD = Infinity;
  const kLng = Math.cos((lat * Math.PI) / 180);
  for (const f of features) {
    const g = f.geometry; if (!g) continue;
    // bbox distance lower-bound — skip countries that can't possibly win
    if (f._bbox) {
      const b = f._bbox;
      let dx = lng < b[0] ? b[0] - lng : lng > b[2] ? lng - b[2] : 0;
      if (dx > 180) dx = 360 - dx;
      const dy = lat < b[1] ? b[1] - lat : lat > b[3] ? lat - b[3] : 0;
      const lower = Math.hypot(dx * kLng, dy);
      if (lower > maxDeg || lower >= bestD) continue;
    }
    const polys = g.type === "Polygon" ? [g.coordinates] : g.type === "MultiPolygon" ? g.coordinates : [];
    for (const rings of polys) {
      const ring = rings[0]; if (!ring) continue;
      for (const pt of ring) {
        let dx = Math.abs(pt[0] - lng); if (dx > 180) dx = 360 - dx;
        const d = Math.hypot(dx * kLng, pt[1] - lat);
        if (d < bestD) { bestD = d; best = f; }
      }
    }
  }
  return bestD <= maxDeg ? best : null;
}
/* download the current globe frame as a PNG (canvas has preserveDrawingBuffer).
 * The pulsing ring marks home — the densest spot of play — so it is hidden for
 * the capture and shown again once the image is made. Hidden, not removed:
 * changing ringsData only takes effect on globe.gl's next update, so the ring
 * could still be in the frame; hiding its objects is immediate. (three-globe
 * tags each ring group __globeObjType "ring" — safe to lean on, because a
 * vendor file is never replaced in place.) The image still shows where the
 * player plays, which the note beside the button says. */
function screenshotGlobe(world, btn) {
  const r = world.renderer && world.renderer();
  if (!r) return;
  const rings = [];
  try {
    world.scene().traverse((o) => { if (o.__globeObjType === "ring" && o.visible) { o.visible = false; rings.push(o); } });
  } catch (e) { /* no scene to walk — capture as is */ }
  const showRings = () => rings.forEach((o) => { o.visible = true; });
  try { if (world.scene && world.camera) r.render(world.scene(), world.camera()); } catch (e) { /* keep retained buffer */ }
  const orig = btn && btn.textContent;
  if (btn) { btn.textContent = "Saving…"; btn.disabled = true; }
  r.domElement.toBlob((blob) => {
    showRings();
    if (btn) { btn.textContent = orig; btn.disabled = false; }
    if (!blob) { alert("Couldn't capture the globe on this browser."); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = "pogo-metrics-globe.png";
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}

/* ── social (friends) ── */
function renderSocial() {
  const F = STATE.friends;
  const hasFriends = F.rows.length > 0;
  const hasInvites = STATE.invites.sent + STATE.invites.accepted + STATE.invites.declined > 0;
  // F.unfriended, not STATE.unfriended — the latter has never existed, so an
  // unfriended-only upload used to fall through and render nothing.
  if (!hasFriends && !F.unfriended && !hasInvites && !(STATE.party.sent + STATE.party.received)) return;

  // One reference clock for every duration in this module, so the headline stat
  // and the tenure chart below can never disagree.
  const ASOF = STATE.ev.last || new Date();
  let inner = "", sub = "";
  if (hasFriends) {
    const dated = F.rows.filter((r) => r.ts).sort((a, b) => a.ts - b.ts);
    const now = ASOF;
    const oldest = dated.slice(0, 8).map((r) => [r.name, Math.round((now - r.ts) / 864e5)]);
    const longest = dated[0] ? ((now - dated[0].ts) / (365.25 * 864e5)).toFixed(1) : 0;
    const topSrc = Object.entries(F.sources).sort((a, b) => b[1] - a[1])[0];
    const removed = F.unfriended;
    /* "Net friends" used to be (friends added − unfriended), which is nonsense:
     * FriendList only lists people you are STILL friends with, so everyone in
     * `removed` was already excluded from it. Report the churn on its own. */
    const stats = [
      [fmt(F.rows.length), "Current friends", "everyone on your list today"],
      // statGrid escapes the label and sub-line itself; the VALUE is raw HTML
      [longest + " yr", "Longest friendship", dated[0] ? dated[0].name : ""],
      [topSrc ? esc(prettySource(topSrc[0])) : "—", "Top way you connect"],
    ];
    if (removed) stats.push([fmt(removed), "Friendships ended", "in the export's recent window — already excluded above"]);
    inner += statGrid(stats);

    // growth chart
    const cId = uid();
    inner += `<div style="margin-top:18px">${chartWrap(cId)}</div>`;
    const months = monthSpan([...Object.keys(F.monthly), ...Object.keys(F.unfriendedMonthly)]);
    later(() => newChart(cId, {
      type: "bar",
      data: {
        labels: months.map(fmtMonth),
        datasets: [
          { label: "Friends added", backgroundColor: C.teal, stack: "f", data: months.map((m) => F.monthly[m] || 0) },
          { label: "Unfriended", backgroundColor: C.red, stack: "f", data: months.map((m) => -(F.unfriendedMonthly[m] || 0)) },
        ],
      },
      options: {
        interaction: { mode: "index", intersect: false },
        plugins: { title: { display: true, text: "Friendships gained & lost" }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${fmt(Math.abs(c.raw))}` } } },
        scales: { x: { stacked: true, grid: { display: false }, ticks: { maxTicksLimit: 14 } }, y: { stacked: true, ticks: { callback: (v) => Math.abs(v) } } },
      },
    }));

    // oldest friends + sources + games
    const srcList = Object.entries(F.sources).sort((a, b) => b[1] - a[1]).map(([k, v]) => [prettySource(k), v]);
    const gameList = Object.entries(F.games).sort((a, b) => b[1] - a[1]).slice(0, 6);
    inner += `<div class="split" style="margin-top:16px">
      <div><h4 class="mod-h4">Your oldest friendships</h4>${rankList(oldest, (days) => (days / 365.25).toFixed(1) + " yr")}</div>
      <div><h4 class="mod-h4">How you connect</h4>${rankList(srcList.slice(0, 6))}
        ${gameList.length ? `<h4 class="mod-h4">Games you share</h4>${rankList(gameList)}` : ""}</div>
    </div>`;
    sub = `${fmt(F.rows.length)} friends in your roster, the oldest going back ${longest} years.`;
  }

  /* Friend-making moments. F.initiated has been parsed since day one and shown
   * nowhere, and friend bursts are almost always a real-world event. */
  if (hasFriends) {
    const byDay = {};
    F.rows.forEach((r) => { if (r.ts) { const d = r.ts.toISOString().slice(0, 10); (byDay[d] = byDay[d] || []).push(r); } });
    const bursts = Object.entries(byDay).filter(([, v]) => v.length >= 3)
      .sort((a, b) => b[1].length - a[1].length).slice(0, 6);
    const you = F.initiated["You"] || F.initiated["Me"] || 0;
    const them = Object.entries(F.initiated).filter(([k]) => !/^(you|me)$/i.test(k)).reduce((a, [, v]) => a + v, 0);
    if (bursts.length || you + them) {
      inner += `<hr class="mod-divider"><h4 class="mod-h4">How your circle grew</h4>`;
      if (you + them) {
        const pct = Math.round(you / (you + them) * 100);
        inner += `<div class="mod-sub" style="margin-bottom:10px">You sent the request
          <b>${pct}%</b> of the time (${fmt(you)} of ${fmt(you + them)} friendships where the export says who reached out).
          ${pct >= 60 ? "You're the one who reaches out." : pct <= 40 ? "People come to you." : "An even trade."}</div>`;
      }
      if (bursts.length) {
        inner += rankList(bursts.map(([d, v]) => {
          const ev = eventFor(d);
          return [fmtDate(parseTS(d)) + (ev ? " · " + ev : ""), v.length];
        }), (v) => fmt(v) + " friends");
        inner += `<div class="hw-caption">Your biggest friend-making days — community days, raid hours and GO Fests usually show up here.</div>`;
      }
    }
  }

  // friendship tenure — how long your bonds have lasted
  const dated = STATE.friends.rows.filter((r) => r.ts);
  if (dated.length) {
    const now = ASOF.getTime ? ASOF.getTime() : +ASOF;
    const yearsOf = (r) => (now - r.ts.getTime()) / 31557600000;
    const oldest = dated.slice().sort((a, b) => a.ts - b.ts)[0];
    const buckets = {};
    dated.forEach((r) => { const y = Math.floor(yearsOf(r)); buckets[y] = (buckets[y] || 0) + 1; });
    const bLabels = Object.keys(buckets).map(Number).sort((a, b) => a - b);
    const cTenure = uid();
    inner += `<hr class="mod-divider"><h4 class="mod-h4">Friendship tenure</h4>
      <div class="mod-sub" style="margin-bottom:10px">Your oldest friendship: <b>${esc(oldest.name)}</b>, going strong for
      <b>${yearsOf(oldest).toFixed(1)} years</b> (since ${fmtDate(oldest.ts)}).</div>
      <div>${chartWrap(cTenure)}</div>`;
    later(() => newChart(cTenure, {
      type: "bar",
      data: {
        labels: bLabels.map((y) => (y === 0 ? "< 1 yr" : y + "–" + (y + 1) + " yrs")),
        datasets: [{ data: bLabels.map((y) => buckets[y]), backgroundColor: C.teal, label: "friends" }],
      },
      options: { plugins: { legend: { display: false }, title: { display: true, text: "How long you've been friends" } }, scales: { y: { beginAtZero: true, title: { display: true, text: "friends" } }, x: { grid: { display: false } } } },
    }));
  }

  const funnel = [];
  if (STATE.invites.sent) funnel.push([fmt(STATE.invites.sent), "invites sent"]);
  if (STATE.invites.accepted) funnel.push([fmt(STATE.invites.accepted), "accepted"]);
  if (STATE.invites.declined) funnel.push([fmt(STATE.invites.declined), "declined"]);
  if (STATE.invites.failed) funnel.push([fmt(STATE.invites.failed), "didn't go through"]);
  if (STATE.party.sent + STATE.party.received) funnel.push([fmt(STATE.party.sent + STATE.party.received), "Party Play invites"]);
  if (funnel.length) inner += `<h4 class="mod-h4">Recent invite activity <span class="muted" style="font-weight:400">(the export keeps ~4 months)</span></h4>${calloutRow(funnel)}`;
  inner += inviteTiming();

  if (!sub) sub = "Your recent friend-request and Party Play activity.";
  return moduleHTML("🤝", "Your social world", sub, inner);
}
/* When the invites happen. RecentInviteActions stamps every friend invite you
 * sent, accepted or declined, and the Party Play files stamp every party
 * invitation. Both are tallied per quarter hour (see slotKey) and placed here
 * on YOUR weekday, with the offset in force at each moment. */
function inviteTiming() {
  const week = (slots) => { const d = Array(7).fill(0); for (const k in slots) d[(slotDate(k).getDay() + 6) % 7] += slots[k]; return d; };
  const f = week(STATE.invites.slots), p = week(STATE.party.slots);
  const both = f.map((v, i) => v + p[i]);
  if (both.reduce((a, b) => a + b, 0) < 2) return "";
  const best = both.indexOf(Math.max(...both));
  const months = {};
  for (const src of [STATE.invites.monthly, STATE.party.monthly]) for (const [m, n] of Object.entries(src)) months[m] = (months[m] || 0) + n;
  const top = Object.entries(months).sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? 1 : -1))[0];
  const sets = [];
  if (f.some(Boolean)) sets.push({ label: "Friend invites", backgroundColor: C.teal, stack: "w", data: f });
  if (p.some(Boolean)) sets.push({ label: "Party invitations", backgroundColor: C.purple, stack: "w", data: p });
  const cId = uid();
  later(() => newChart(cId, {
    type: "bar",
    data: { labels: DAYS, datasets: sets },
    options: {
      interaction: { mode: "index", intersect: false },
      plugins: { legend: { display: sets.length > 1 }, title: { display: true, text: "Invites by weekday, in your local time" } },
      scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: "invites" } } },
    },
  }));
  return `<h4 class="mod-h4">When your invites happen</h4>
    <div class="mod-sub" style="margin-bottom:10px">Most of them land on a <b>${DAY_FULL[best]}</b>${top ? `, and the busiest month in the window was <b>${fmtMonth(top[0])}</b>, with ${fmt(top[1])}` : ""}.
      Only the action, its time and its result are read — never the other trainer.</div>
    <div>${chartWrap(cId, "short")}</div>`;
}
function prettySource(s) {
  const map = { QR_CODE: "QR code", NEARBY: "Nearby", FRIEND_GRAPH: "Friend suggestion", FACEBOOK: "Facebook", CONTACT: "Contacts", UNKNOWN: "Unknown" };
  return map[s] || titleCase(s);
}

/* ── spending (InAppPurchases) ── */
function renderSpending() {
  const S = STATE.spend;
  if (!S.purchases && !S.spendEvents && !Object.keys(S.items).length) return;
  // Rank currencies by how often they were used (raw native totals aren't
  // comparable across currencies — e.g. millions of IDR is only a few dollars).
  let curEntries = Object.entries(S.cur).sort((a, b) => b[1].purchases - a[1].purchases);
  // On the public demo, keep the sample story simple: only show USD spending.
  if (window.DEMO_PAGE && curEntries.some(([c]) => c === "USD")) {
    curEntries = curEntries.filter(([c]) => c === "USD");
  }
  // Headline whichever currency this player actually used most; the rest
  // still appear in the "Spending by currency" breakdown.
  const primary = curEntries[0];
  // parsePurchases only ever stores a three-letter code or "UNKNOWN", but this
  // lands in raw HTML (a tile value and the subtitle), so escape it here too
  const sym = primary ? esc(CUR_SYM[primary[0]] || primary[0] + " ") : "";
  const curName = primary ? esc(primary[0]) : "";
  const stats = [
    [primary ? sym + fmt(round(primary[1].native)) : "—", primary ? "Spent (" + primary[0] + ")" : "Real money"],   // statGrid escapes the label
    [fmt(S.coinsBought), "PokéCoins bought", S.purchases + " purchases"],
    [fmt(S.coinsSpent), "PokéCoins spent", S.spendEvents + " checkouts"],
    [fmt(Object.values(S.items).reduce((a, b) => a + b, 0)), "Items bought in shop"],
  ];
  let inner = statGrid(stats);
  if (S.coinsSpent) {
    inner += `<div class="hw-caption" style="margin-top:6px">For scale: ${fmt(S.coinsSpent)} coins ≈
      <b>${fmt(Math.floor(S.coinsSpent / 100))}</b> premium battle passes, or
      <b>${fmt(Math.floor(S.coinsSpent / 200))}</b> super incubators (at classic shop prices).</div>`;
  }

  // coin flow
  const months = monthSpan([...Object.keys(S.boughtMonthly), ...Object.keys(S.spentMonthly)]);
  if (months.length) {
    const cId = uid();
    inner += `<div style="margin-top:18px">${chartWrap(cId)}</div>`;
    later(() => newChart(cId, {
      type: "line",
      data: {
        labels: months.map(fmtMonth),
        datasets: [
          /* inflow teal, outflow red — yellow is Encounters' identity hue */
          { label: "Coins bought", borderColor: C.teal, backgroundColor: C.teal, pointRadius: 0, borderWidth: 2, tension: .3, data: months.map((m) => S.boughtMonthly[m] || 0) },
          { label: "Coins spent", borderColor: C.red, backgroundColor: C.red, pointRadius: 0, borderWidth: 2, tension: .3, data: months.map((m) => S.spentMonthly[m] || 0) },
        ],
      },
      options: { interaction: { mode: "index", intersect: false }, plugins: { title: { display: true, text: "PokéCoin flow per month" } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 14 } }, y: { title: { display: true, text: "coins" } } } },
    }));
  }

  const items = Object.entries(S.items).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([n, v]) => [prettyItem(n), v]);
  if (items.length) inner += `<div class="split" style="margin-top:16px">
    <div><h4 class="mod-h4">Most-bought shop items</h4>${rankList(items)}</div>
    <div><h4 class="mod-h4">Spending by currency</h4>${rankList(curEntries.map(([c, d]) => [c, d.native]), (v, name) => (CUR_SYM[name] || "") + fmt(round(v)))}</div>
  </div>`;

  /* Where the coins were actually bought. Parsed since day one, shown nowhere —
   * and the web-store split is the part players care about, because it pays a
   * bonus the app stores don't. */
  const vendors = Object.entries(S.vendor).sort((a, b) => b[1].coins - a[1].coins);
  if (vendors.length > 1) {
    inner += `<hr class="mod-divider"><h4 class="mod-h4">Where you bought your coins</h4>
      <div class="mod-sub" style="margin-bottom:10px">Ranked by coins, not cash — your purchases may span several currencies.</div>`;
    const buys = {};
    vendors.forEach(([v, d]) => (buys[prettyVendor(v)] = d.purchases));
    inner += rankList(vendors.map(([v, d]) => [prettyVendor(v), d.coins]),
      (v, name) => fmt(v) + " coins · " + fmt(buys[name]) + "×");
    if (S.vendor.XSOLLA && S.coinsBought > 0) {
      inner += `<div class="hw-caption">Xsolla runs the official Pokémon GO web store, which sells coins at a bonus the App Store and Google Play don't match —
        ${Math.round(S.vendor.XSOLLA.coins / S.coinsBought * 100)}% of your coins came through it.</div>`;
    }
  }

  /* Two things the ledger records that no chapter ever mentioned: the free
   * daily box (thrown away with the rest of the LPSKU bundles) and the items
   * Niantic hands out as an apology. */
  const extras = [];
  if (S.freeBundles) extras.push([fmt(S.freeBundles), "free daily boxes claimed"]);
  if (S.paidBundles) extras.push([fmt(S.paidBundles), "paid shop bundles"]);
  if (S.granted) extras.push([fmt(S.granted), "gifts from support"]);
  if (extras.length) {
    inner += `<h4 class="mod-h4">Also in the ledger</h4>${calloutRow(extras)}`;
    const gifts = Object.entries(S.grantedItems).sort((a, b) => b[1] - a[1]).slice(0, 4);
    if (gifts.length) {
      inner += `<div class="hw-caption">"Granted by admin" is support making something right after an outage or a broken raid.
        Yours came to ${gifts.map(([n, q]) => `<b>${fmt(q)}×</b> ${esc(prettyItem(n))}`).join(", ")}.</div>`;
    } else if (S.freeBundles) {
      inner += `<div class="hw-caption">The free daily box counts as a purchase in the game's ledger, which is why it shows up here at all.</div>`;
    }
  }

  return moduleHTML("💳", "Your spending story", `Every coin bought and spent${primary ? ` — ${sym}${fmt(round(primary[1].native))} in ${curName} across ${fmt(primary[1].purchases)} purchase${primary[1].purchases === 1 ? "" : "s"}` : ""}.`, inner);
}
/* Niantic writes the payment processor's own name; players know the storefront. */
function prettyVendor(v) {
  const map = { APPLE: "App Store", GOOGLE: "Google Play", XSOLLA: "Web store (Xsolla)", SAMSUNG: "Galaxy Store", OTHER: "Other" };
  return map[String(v).toUpperCase()] || titleCase(v);
}
/* ── bag inventory (Gameplay.txt) ──
 * The item list sits under "You have N items:" as indented "Name: count" lines,
 * mixing friendly names ("Master balls") with raw codes ("ITEM_XL_RARE_CANDY").
 *
 * That headline N is badly misleading and the trainer card has been printing it
 * as "Items in bag": on the bundled sample it reads 327,752, but 276,450 of
 * those are event-pass POINTS and 34,280 are fusion/crafting resources. The
 * actual bag holds 17,022, and test-parsers.mjs holds the sample to all four.
 * Points and resources are counted, but kept out of the bag figure and
 * labelled for what they are. */
const BAG_GROUPS = [
  ["Poké Balls", /ball/i, C.red],
  ["Berries", /berry|razz|nanab|pinap/i, C.green],
  ["Potions & Revives", /potion|revive/i, "#ff6bb3"],
  ["Raid & battle passes", /raid pass|raid ticket|battle_pass|premium/i, C.orange],
  ["Evolution items", /evolution|stone|dragon scale|king's rock|metal coat|up-grade|sinnoh|unova/i, "#a06bff"],
  ["TMs & move items", /\bTM\b|move_reroll/i, "#3b6cff"],
  ["Candy", /candy/i, "#ffcb05"],
  ["Incubators", /incubator/i, "#41d8c6"],
  ["Lures & Incense", /lure|incense/i, "#c23e8c"],
  ["Boosters", /lucky egg|star piece|max_boost|beans|poffin|breakfast/i, "#ffc24b"],
  ["Link items", /enhanced_currency/i, "#2bb3a3"],
];
function bagGroupFor(name) {
  for (const [label, re] of BAG_GROUPS) if (re.test(name)) return label;
  return "Other gear";
}
function parseBag(text) {
  const lines = text.replace(/\r/g, "").split("\n");
  const start = lines.findIndex((l) => /^You have \d+ items:/.test(l));
  if (start < 0) return;
  const declared = +lines[start].match(/(\d+)/)[1];
  const items = [];
  let points = 0, resources = 0, bagTotal = 0;
  for (let i = start + 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;                      // blank line inside the block
    if (!/^\t[^\t]/.test(line)) break;               // the section ends at the first non-item line
    const m = line.match(/^\t(.+?):\s*(\d+)\s*$/);
    if (!m) continue;
    const raw = m[1].trim(), n = +m[2];
    if (/EVENT_PASS_POINT/i.test(raw)) { points += n; continue; }
    if (/^FUSION_RESOURCE|ITEM_RESOURCE|^ITEM_MP$/i.test(raw)) { resources += n; continue; }
    bagTotal += n;
    if (n > 0) items.push({ name: prettyItem(raw), n, group: bagGroupFor(raw + " " + prettyItem(raw)) });
  }
  if (!items.length) return;
  items.sort((a, b) => b.n - a.n);
  const groups = {};
  items.forEach((it) => (groups[it.group] = (groups[it.group] || 0) + it.n));
  STATE.bag = { items, groups, bagTotal, points, resources, declared, distinct: items.length };
}

/* Niantic's internal item codes don't always tidy up into the name players
 * actually see in the shop, so override those by hand. Add a line here whenever
 * a code prettifies into something no trainer would recognize.
 *
 * Only add a mapping you are SURE of. A wrong shop name is worse than a raw
 * code: the code at least looks like a code, so nobody trusts it. Some entries
 * in a real export are internal names with no public equivalent at all — those
 * are deliberately left to the fallback below. */
const ITEM_NAMES = {
  ITEM_LEADER_MAP: "Rocket Radar",
  ITEM_LEADER_MAP_FRAGMENT: "Mysterious Component",
  ITEM_GIOVANNI_MAP: "Super Rocket Radar",
  ITEM_TROY_DISK_MAGNETIC: "Magnetic Lure Module",
  ITEM_TROY_DISK_RAINY: "Rainy Lure Module",
  ITEM_TROY_DISK_MOSSY: "Mossy Lure Module",
  ITEM_TROY_DISK_GLACIAL: "Glacial Lure Module",
  ITEM_TROY_DISK_SPARKLY: "Sparkly Lure Module",
  ITEM_ENHANCED_CURRENCY: "Link Charges",
  ITEM_ENHANCED_CURRENCY_HOLDER: "Link Holder", // the container; its count is how many charges you hold
  ITEM_XL_RARE_CANDY: "Rare Candy XL",
  ITEM_GEN4_EVOLUTION_STONE: "Sinnoh Stone",
  ITEM_GEN5_EVOLUTION_STONE: "Unova Stone",
  ITEM_GOLDEN_PINAP_BERRY: "Silver Pinap Berry",
  ITEM_MOVE_REROLL_ELITE_FAST_ATTACK: "Elite Fast TM",
  ITEM_MOVE_REROLL_ELITE_SPECIAL_ATTACK: "Elite Charged TM",
  ITEM_REMOTE_RAID_TICKET: "Remote Raid Pass",
  ITEM_INCENSE_DAILY_ADVENTURE: "Daily Adventure Incense",
};
function prettyItem(n) {
  if (ITEM_NAMES[n]) return ITEM_NAMES[n];
  // Title-case both shapes so a coded name sits beside a friendly one without
  // looking like a different kind of thing ("Poke Balls" / "Shadow Gem").
  // OTHER_ is Niantic's bucket prefix, not part of any name a player has seen —
  // dropping it turns "Other Evolution Stone A" into "Evolution Stone A", which
  // is still an internal code but stops reading like a rendering bug.
  return titleCase(n.replace(/^ITEM_/, "").replace(/^OTHER_/, ""));
}

/* ── fitness (Adventure Sync) ── */
function renderFitness() {
  const D = STATE.fitness.daily;
  const days = Object.keys(D).sort();
  if (!days.length) return;
  const totalSteps = days.reduce((a, d) => a + D[d].steps, 0);
  const totalKm = days.reduce((a, d) => a + D[d].meters, 0) / 1000;
  const best = days.reduce((m, d) => Math.max(m, D[d].steps), 0);
  const bestDay = days.find((d) => D[d].steps === best);
  const stats = [
    [fmt(totalSteps), "Steps logged"],
    [totalKm.toFixed(1) + " km", "Distance"],
    [fmt(best), "Best day", bestDay ? fmtDate(parseTS(bestDay)) : ""],
    [fmt(round(totalSteps / days.length)), "Avg steps / day"],
  ];
  let inner = statGrid(stats);

  const equivs = [
    [fmt(round(totalKm / 42.195)), "marathons"],
    [(totalKm / 40075 * 100).toFixed(1) + "%", "of a lap around Earth"],
    [fmt(round(totalKm * 0.621371)) + " mi", "in miles"],
  ];
  inner += calloutRow(equivs.map(([v, l]) => [v, l]));

  const cId = uid();
  inner += `<div style="margin-top:16px">${chartWrap(cId)}</div>`;
  later(() => newChart(cId, {
    type: "bar",
    data: {
      // real date labels, not raw ISO tails ("Aug 14", not "08-14"), read straight off the
      // UTC day key — turning it back into a local date put every bar a day early west of UTC
      labels: days.map((d) => MONTHS[+d.slice(5, 7) - 1] + " " + +d.slice(8, 10)),
      datasets: [{ label: "Steps", backgroundColor: C.teal, data: days.map((d) => D[d].steps) }],
    },
    options: { plugins: { legend: { display: false }, title: { display: true, text: "Daily steps (Adventure Sync window)" } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 14 } }, y: { title: { display: true, text: "steps" } } } },
  }));

  return moduleHTML("🏃", "Your real-world movement", `Adventure Sync logged ${fmt(totalSteps)} steps over ${days.length} days — that's ${totalKm.toFixed(0)} km on foot.`, inner);
}

/* ── live events ── */
function renderLiveEvents() {
  if (!STATE.liveEvents.length) return;
  const evs = STATE.liveEvents.sort((a, b) => (b.date || 0) - (a.date || 0));
  const totalTickets = evs.reduce((a, e) => a + e.tickets, 0);
  const addOns = evs.filter((e) => e.addOn).length;   // a yes or no per order — see parseLiveEvents
  const byCur = {};
  evs.forEach((e) => { if (e.currency) byCur[e.currency] = (byCur[e.currency] || 0) + e.paid; });
  // a tile VALUE is raw HTML, and the code came from the file — escape it
  const spendStr = Object.entries(byCur).map(([c, v]) => esc(CUR_SYM[c] || c + " ") + fmt(round(v))).join(" · ");
  const tiles = [[fmt(evs.length), "Event orders"], [fmt(totalTickets), "Tickets bought"]];
  // add-ons on a line of their own, rather than passing for a ticket
  if (addOns) tiles.push([fmt(addOns), "Orders with an add-on", addOns === evs.length ? "every one of them" : `of ${fmt(evs.length)}`]);
  tiles.push([spendStr || "—", "Spent on events"]);
  let inner = statGrid(tiles);
  inner += `<h4 class="mod-h4">Events you bought into</h4>`;
  // the add-on sits in the value column, which never truncates on a phone
  inner += rankList(evs.slice(0, 12).map((e) => [e.name + (e.date ? " · " + e.date.getUTCFullYear() : ""), e.tickets, e.addOn]),
    (v, name, it) => (it[2] ? (v ? `${v} 🎟️ + add-on` : "add-on only") : v + " 🎟️"));
  if (addOns) inner += `<div class="hw-caption">An add-on is counted as a yes or a no for each order — what it was is never read.${
    evs.some((e) => e.addOn && !e.tickets) ? " An order for add-ons alone counts no tickets." : ""}</div>`;
  return moduleHTML("🎟️", "Your live events",
    `${fmt(evs.length)} order${evs.length === 1 ? "" : "s"} for real-world Pokémon GO events${totalTickets ? `, ${fmt(totalTickets)} ticket${totalTickets === 1 ? "" : "s"} between them` : ""}.`, inner);
}

/* ── sessions / devices ── */
function renderSessions() {
  const S = STATE.sessions, I = STATE.installs, T = STATE.support;
  // Support tickets ride in this chapter, so a support-only upload must still
  // open it rather than falling through to nothing.
  if (!S.total && !I.count && !T.tickets) return;
  const devices = Object.entries(S.devices).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const cities = Object.entries(S.cities).sort((a, b) => b[1] - a[1]).slice(0, 8);
  const countries = Object.entries(S.countries).sort((a, b) => b[1] - a[1]);
  const H = installHistory();
  let inner = "";
  if (S.total || I.count) {
    inner += statGrid([
      [fmt(S.total), "App sessions"],
      [fmt(Object.keys(S.devices).length || Object.keys(I.devices).length), "Devices used"],
      countries.length
        ? [fmt(countries.length), "Countries", countries.length === 1 ? countryName(countries[0][0]) : "you've opened the game in"]
        : [fmt(Object.keys(S.cities).length), "Cities seen"],
      /* The earliest install EITHER file names. App_Installs.csv alone put it a
       * year late on the reference account: it lists 11 installs from 2022 on,
       * while the session log's Install_time reaches back to 2021. */
      H ? [H.first.getUTCFullYear(), "First install", `${fmt(H.total)} install${H.total === 1 ? "" : "s"} on record`]
        : [I.count ? fmt(I.count) : "—", "Installs"],
    ]);
  }
  const months = monthSpan(Object.keys(S.monthly));
  if (months.length > 1) {
    const cId = uid();
    inner += `<div style="margin-top:16px">${chartWrap(cId, "short")}</div>`;
    later(() => newChart(cId, {
      type: "bar",
      data: { labels: months.map(fmtMonth), datasets: [{ label: "Sessions", backgroundColor: C.teal, data: months.map((m) => S.monthly[m] || 0) }] },
      options: { plugins: { legend: { display: false }, title: { display: true, text: "App opens per month" } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 16 } }, y: { title: { display: true, text: "sessions" } } } },
    }));
  }
  if (devices.length || cities.length) inner += `<div class="split" style="margin-top:16px">
    ${devices.length ? `<div><h4 class="mod-h4">Devices you played on</h4>${rankList(devices)}</div>` : "<div></div>"}
    ${cities.length ? `<div><h4 class="mod-h4">Where you logged in</h4>${rankList(cities)}</div>` : "<div></div>"}
  </div>`;
  inner += renderDeviceEras();
  inner += renderInstallHistory(H);
  /* Country is the one piece of geography that needs no GPS file at all, so
   * this survives even when someone uploads nothing but their session log. */
  if (countries.length > 1) {
    inner += `<hr class="mod-divider"><h4 class="mod-h4">Countries you've played in</h4>
      <div class="mod-sub" style="margin-bottom:10px">The game stamps each session with a country. No coordinates involved —
      this is the only map in the app that works without a single GPS file.</div>`;
    inner += rankList(countries.map(([cc, n]) => [countryName(cc), n]), (v) => fmt(v) + " sessions");
  }
  inner += renderTravelLog();
  inner += renderSupport();
  const sub = S.total
    ? `${fmt(S.total)} app sessions across your devices and cities. (We never read the IPs or ad-IDs in these files.)`
    : `What the game's technical records say about you. (We never read the IPs or ad-IDs in these files.)`;
  return moduleHTML("📱", "Behind the screen", sub, inner);
}

/* ── device eras ──
 * The device you played on most, month by month, with a new era each time that
 * changes. A month is the unit, so a phone borrowed for a weekend starts no era
 * and one that took over for a month does. Versions are public release numbers,
 * shown sparingly: how many, and the first and latest app build. */
function deviceEras() {
  const S = STATE.sessions, eras = [];
  for (const m of Object.keys(S.eraMonths).sort()) {
    const counts = Object.entries(S.eraMonths[m]);
    if (!counts.length) continue;
    const top = counts.reduce((a, b) => (b[1] > a[1] ? b : a));
    const n = counts.reduce((a, [, v]) => a + v, 0);
    const last = eras[eras.length - 1];
    if (last && last.dev === top[0]) { last.to = m; last.n += n; }
    else eras.push({ dev: top[0], from: m, to: m, n, ...(S.deviceKind[top[0]] || {}) });
  }
  return eras;
}
function renderDeviceEras() {
  const S = STATE.sessions;
  const eras = deviceEras();
  const apps = Object.keys(S.apps).sort(versionCmp), oses = Object.keys(S.oses);
  if (eras.length < 2 && apps.length < 2) return "";
  const crossings = eras.reduce((n, e, i) => n + (i && e.platform && eras[i - 1].platform && e.platform !== eras[i - 1].platform ? 1 : 0), 0);
  const bits = [];
  if (eras.length > 1) bits.push(`Your main device changed <b>${fmt(eras.length - 1)}</b> time${eras.length === 2 ? "" : "s"}${
    crossings ? `, crossing between platforms ${crossings === 1 ? "once" : `<b>${fmt(crossings)}</b> times`}` : ""}.`);
  if (apps.length > 1) bits.push(`You went through <b>${fmt(apps.length)}</b> versions of the app, from ${esc(apps[0])} to ${esc(apps[apps.length - 1])}${
    oses.length > 1 ? `, on <b>${fmt(oses.length)}</b> different OS versions` : ""}.`);
  const SHOW = 10;
  let out = `<hr class="mod-divider"><h4 class="mod-h4">Your device eras</h4>
    <div class="mod-sub" style="margin-bottom:10px">${bits.join(" ")}</div>`;
  if (eras.length > 1) {
    if (eras.length > SHOW) out += `<div class="hw-caption">The latest ${SHOW} of ${fmt(eras.length)} eras.</div>`;
    out += `<ol class="era-list">${eras.slice(-SHOW).map((e) => `<li>
      <span class="era-dev">${esc(e.dev)}${e.platform || e.kind ? `<small>${esc([e.platform, e.kind].filter(Boolean).join(" · "))}</small>` : ""}</span>
      <span class="era-when">${fmtMonth(e.from)}${e.to !== e.from ? " – " + fmtMonth(e.to) : ""}</span>
      <span class="era-n">${fmt(e.n)} session${e.n === 1 ? "" : "s"}</span></li>`).join("")}</ol>`;
  }
  out += `<div class="hw-caption">An era is a run of months in which one device carried most of your sessions. Device, platform and
    version come from the session log itself — none of its identifiers are read.</div>`;
  return out;
}

/* ── install history ──
 * Both files, one list: every install App_Installs.csv names plus every install
 * a session in App_Sessions.csv came from, each counted once. The first install
 * on a device model is a new device; another on a model already seen is a reinstall. */
function installHistory() {
  const t = STATE.installs.times;
  const list = Object.keys(t).map(Number).filter(Number.isFinite).sort((a, b) => a - b);
  if (!list.length) return null;
  const byYear = {}, models = new Set();
  let reinstalls = 0;
  for (const k of list) {
    const y = new Date(k).getUTCFullYear();
    byYear[y] = (byYear[y] || 0) + 1;
    const dev = t[k];
    if (!dev) continue;
    if (models.has(dev)) reinstalls++; else models.add(dev);
  }
  return { total: list.length, first: new Date(list[0]), last: new Date(list[list.length - 1]), byYear, reinstalls, newDevices: models.size };
}
function renderInstallHistory(H) {
  if (!H || H.total < 2) return "";
  const I = STATE.installs;
  const years = Object.keys(H.byYear).sort();
  const split = H.newDevices + H.reinstalls
    ? ` — the first on each of ${fmt(H.newDevices)} device model${H.newDevices === 1 ? "" : "s"}, and <b>${fmt(H.reinstalls)}</b> reinstall${H.reinstalls === 1 ? "" : "s"} on a model you'd installed on before` : "";
  const note = I.count && I.count < H.total
    ? `<code>App_Installs.csv</code> lists ${fmt(I.count)} of them${I.last ? `, the newest from ${fmtMonth(monthKey(I.last))}` : ""}.
      The session log names the rest: every session records the install it came from.` : "";
  return `<hr class="mod-divider"><h4 class="mod-h4">Your install history</h4>
    <div class="mod-sub" style="margin-bottom:10px">You've installed the game <b>${fmt(H.total)}</b> times since ${fmtMonth(monthKey(H.first))}${split}.</div>
    ${calloutRow(years.map((y) => [fmt(H.byYear[y]), `in ${y}`]))}
    ${note ? `<div class="hw-caption">${note}</div>` : ""}`;
}

/* ── support tickets ──
 * Date and subject only. The raw file also holds every word you have ever
 * written to Niantic support; that column is never read, and saying so is
 * worth as much as the stat itself. */
function renderSupport() {
  const T = STATE.support;
  if (!T.tickets) return "";
  const topics = Object.entries(T.topics).sort((a, b) => b[1] - a[1]);
  const span = T.first && T.last && T.last - T.first > 864e5
    ? ` between ${fmtDate(T.first)} and ${fmtDate(T.last)}` : T.first ? ` on ${fmtDate(T.first)}` : "";
  // The export contains the ticket that asked for the export.
  const meta = topics.find(([t]) => /request my data/i.test(t));
  const convo = T.messages > T.tickets
    ? ` across <b>${fmt(T.messages)}</b> message${T.messages === 1 ? "" : "s"}` : "";
  let out = `<hr class="mod-divider"><h4 class="mod-h4">Your support history</h4>
    <div class="mod-sub" style="margin-bottom:10px">
      <b>${fmt(T.tickets)}</b> ticket${T.tickets === 1 ? "" : "s"}${convo} with Pokémon GO support${span}.
      ${meta ? `${meta[1] === T.tickets ? "Every one of them was" : `<b>${fmt(meta[1])}</b> of them were`} a request for your data —
        including, somewhere in here, the one that produced the file you are reading this from.` : ""}
    </div>`;
  if (topics.length > 1) out += rankList(topics.slice(0, 6), (v) => fmt(v) + (v === 1 ? " ticket" : " tickets"));
  out += `<div class="hw-caption">Only the date and the subject line are read. The message bodies, custom fields and metadata in this
    file are never opened — not by this chapter, not anywhere.</div>`;
  return out;
}

/* ── travel log: the globe knows coordinates, this knows PLACE NAMES ──
 * Home is simply where you play most. Everywhere else, grouped into trips by
 * runs of consecutive days, is somewhere you took the game. Deliberately no
 * "furthest trip" — a city name carries no coordinates, so any distance
 * claim here would be invented. */
function renderTravelLog() {
  const places = STATE.sessions.places;
  const names = Object.keys(places);
  if (names.length < 2) return "";
  const ranked = names.map((p) => [p, places[p]]).sort((a, b) => b[1].n - a[1].n);
  const [homeName, home] = ranked[0];
  const away = ranked.slice(1);
  if (!away.length) return "";

  /* Deliberately reports only what the data actually says: which places, how
   * often, and when. NOT "trips" and NOT "days away from home" — Niantic logs
   * the login city, and an ordinary metro spans several of them (the real
   * export alternates between two neighbouring cities), so a commuter's normal week
   * would be rendered as months of travel. Anyone who moved house would get a
   * "longest stretch away" measured in years. Places and dates are facts;
   * turning them into a travel narrative is a guess that reads as a bug. */
  const states = new Set();
  [homeName, ...away.map(([n]) => n)].forEach((n) => { const r = places[n]; if (r && r.state) states.add(r.state); });

  const rows = away.slice(0, 8).map(([name, rec]) => [
    name + " · " + rec.days.size + " day" + (rec.days.size === 1 ? "" : "s"),
    rec.n,
  ]);
  const span = away.reduce((best, [name, rec]) => (rec.days.size > (best ? best[1].days.size : 0) ? [name, rec] : best), null);
  return `<hr class="mod-divider"><h4 class="mod-h4">Your travel log</h4>
    <div class="mod-sub" style="margin-bottom:10px">
      Home base is <b>${esc(homeName)}</b> — ${fmt(home.n)} of your sessions.
      You've also opened the game in <b>${fmt(away.length)}</b> other place${away.length === 1 ? "" : "s"}${
        states.size > 1 ? `, across <b>${fmt(states.size)}</b> states or regions in total` : ""}.${
        span ? ` The one you've played in most besides home is <b>${esc(span[0].split(",")[0])}</b>, on ${fmt(span[1].days.size)} separate day${span[1].days.size === 1 ? "" : "s"}.` : ""}
    </div>
    ${rankList(rows, (v) => fmt(v) + " sessions")}
    <div class="hw-caption">Places come from the login city the game records with each session — no coordinates are involved.
      Neighbouring towns in one metro area appear as separate places, so this is "where you opened the game", not a travel diary.</div>`;
}

/* ── wayfarer ── */
function renderWayfarer() {
  const W = STATE.wayfarer;
  if (!W) return;
  const stats = [];
  if (W.analyzed != null) stats.push([fmt(W.analyzed), "Nominations you reviewed", "candidates you voted on"]);
  if (W.created != null) stats.push([fmt(W.created), "Stops you helped create", "reviews that became real places"]);
  if (W.rejected != null) stats.push([fmt(W.rejected), "Candidates you rejected"]);
  // The logs go after the lifetime totals, named for what they are: records the
  // export still holds, not lifetime counts. The submission log is your reviews.
  if (W.assigned) stats.push([fmt(W.assigned), "Candidates shown to you", "in the log the export still holds"]);
  if (W.logged) stats.push([fmt(W.logged), "Reviews you sent in", "in the log the export still holds"]);
  if (W.skipped) stats.push([fmt(W.skipped), "Candidates you skipped"]);
  if (W.upgrades) stats.push([fmt(W.upgrades), "Review upgrades used"]);
  if (!stats.length) return;
  let inner = statGrid(stats);
  const rated = Object.entries(W.ratings || {}).filter(([, r]) => r && r.n > 0);
  if (rated.length) {
    const flags = [W.oneStar ? `${fmt(W.oneStar)} one-star` : "", W.duplicates ? `${fmt(W.duplicates)} marked as a duplicate` : ""].filter(Boolean);
    const scored = Math.max(...rated.map(([, r]) => r.n));   // a review can be sent in with no stars at all
    inner += `<h4 class="mod-h4">How you rate</h4>
      <div class="mod-sub" style="margin-bottom:10px">Your average stars in each category, across the ${fmt(scored)} review${scored === 1 ? "" : "s"} you scored${
        W.logged > scored ? ` (of ${fmt(W.logged)} sent in)` : ""}${flags.length ? ` — ${flags.join(", ")}` : ""}.</div>
      ${rankList(rated.map(([label, r]) => [label, r.sum / r.n]), (v) => v.toFixed(1) + " ★")}`;
  }
  const am = W.assignedMonthly || {}, rm = W.reviewedMonthly || {};
  const months = monthSpan([...Object.keys(am), ...Object.keys(rm)]);
  if (months.length > 1) {
    const cId = uid();
    inner += `<div style="margin-top:16px">${chartWrap(cId, "short")}</div>`;
    later(() => newChart(cId, {
      type: "bar",
      data: {
        labels: months.map(fmtMonth),
        datasets: [
          { label: "Shown to you", backgroundColor: alpha(C.teal, 0.35), data: months.map((m) => am[m] || 0) },
          { label: "Reviewed", backgroundColor: C.teal, data: months.map((m) => rm[m] || 0) },
        ],
      },
      options: {
        interaction: { mode: "index", intersect: false },
        plugins: { title: { display: true, text: "Your review activity, month by month" } },
        scales: { x: { grid: { display: false } }, y: { beginAtZero: true, ticks: { precision: 0 }, title: { display: true, text: "candidates" } } },
      },
    }));
  } else if (months.length === 1) {
    inner += `<div class="mod-sub" style="margin-top:12px">All of the review activity on record falls in <b>${fmtMonth(months[0])}</b>.</div>`;
  }
  if (W.assigned || rated.length) inner += `<div class="hw-caption">Read here: counts, dates and the stars you gave. Never read: the candidates themselves,
    your comments on them, any location, your email, or your home and bonus locations.</div>`;
  const hit = W.analyzed && W.created ? Math.round((W.created / W.analyzed) * 100) : null;
  return moduleHTML("🧭", "Your map-making",
    `How much you've given back to the map every trainer plays on.${
      hit != null ? ` <b>${hit}%</b> of the candidates you reviewed went on to become real PokéStops.` : ""}`,
    inner);
}

/* ───────────────────────────── wiring ───────────────────────────── */
document.addEventListener("DOMContentLoaded", () => {
  // The upload UI only exists on metrics.html; the live-example page is
  // results-only, so wire it all up behind a dropzone check.
  const dz = $("dropzone");
  if (dz) {
    const fileInput = $("file-input"), folderInput = $("folder-input");
    $("browse-btn").addEventListener("click", () => fileInput.click());
    $("folder-btn").addEventListener("click", () => folderInput.click());
    dz.addEventListener("click", (e) => { if (e.target.closest("button")) return; fileInput.click(); });
    /* Clear the input after reading it. A file input fires no change event when
     * you re-pick the SAME path, so without this "add it again" — the advice we
     * give when a file handle has gone stale — silently does nothing. */
    const takeFiles = async (input) => {
      const files = [...input.files];
      input.value = "";
      await ingest(files);
    };
    fileInput.addEventListener("change", () => takeFiles(fileInput));
    folderInput.addEventListener("change", () => takeFiles(folderInput));

    /* A drop that misses the dashed zone must never navigate the tab to the
     * raw file — that would wipe the queue and any built report. Swallow
     * drags at the document level and treat the whole page as the target:
     * the zone lights up as soon as a file drag enters the window, and a
     * drop anywhere routes through the same ingest as a direct hit. The
     * depth counter is needed because dragenter/dragleave fire for every
     * element the cursor crosses. */
    let dragDepth = 0;
    const dragHasFiles = (e) => e.dataTransfer && [...(e.dataTransfer.types || [])].includes("Files");
    // the whole page is the target, so say so: a veil the moment a file drag enters
    const veilEl = document.createElement("div");
    veilEl.className = "drop-veil"; veilEl.setAttribute("aria-hidden", "true");
    veilEl.innerHTML = `<div>${window.ICON ? window.ICON("upload") : ""}<b>Drop anywhere to add to your story</b><span>Read on this device only — nothing is uploaded</span></div>`;
    document.body.appendChild(veilEl);
    const veil = (on) => veilEl.classList.toggle("on", !!on);
    document.addEventListener("dragover", (e) => e.preventDefault());
    document.addEventListener("dragenter", (e) => {
      if (!dragHasFiles(e)) return;
      dragDepth++;
      dz.classList.add("drag"); veil(true);
    });
    document.addEventListener("dragleave", () => {
      if (--dragDepth <= 0) { dragDepth = 0; dz.classList.remove("drag"); veil(false); }
    });
    // An aborted drag (Esc mid-drag) fires neither dragleave nor drop
    window.addEventListener("dragend", () => { dragDepth = 0; dz.classList.remove("drag"); veil(false); });
    document.addEventListener("drop", async (e) => {
      e.preventDefault();
      dragDepth = 0;
      dz.classList.remove("drag"); veil(false);
      const items = e.dataTransfer.items;
      const files = items && items.length && items[0].webkitGetAsEntry ? await collectFiles(items) : [...e.dataTransfer.files];
      if (files.length) ingest(files);
    });
    // The report can't be deep-linked or restored without re-reading files —
    // warn before a tab wipe while real (non-sample) results are on screen.
    window.addEventListener("beforeunload", (e) => {
      if (RAW.length && !SAMPLE_DATA && !$("results").classList.contains("results-hidden")) e.preventDefault();
    });

    $("build-btn").addEventListener("click", build);
    renderUnlocks();
    // Clear means clear: the file queue AND anything already on screen. For a
    // privacy tool, leaving the built dashboard up after "Clear" is a betrayal.
    const title0 = document.title;
    $("clear-btn").addEventListener("click", () => {
      document.title = title0;
      RAW = []; DATA_GEN++; SAMPLE_DATA = false;
      hideUnlock();
      renderDetected();
      clearError();
      teardown();
      const res = $("results");
      res.innerHTML = "";
      res.classList.add("results-hidden");
      document.body.classList.remove("has-report");
    });
    // Neither iOS nor Android phones have a real folder picker (webkitdirectory
    // is ignored) — hide the button rather than let it degrade into a
    // confusing files-only dialog. Touch laptops keep it: their primary
    // pointer reports as fine.
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const coarse = window.matchMedia && window.matchMedia("(pointer: coarse)").matches;
    if (isIOS || (coarse && /Android/i.test(navigator.userAgent))) $("folder-btn").style.display = "none";
    // "Drop your files here" describes a gesture touch screens don't have —
    // swap the paragraph too, not just the heading.
    if (coarse) {
      const h = dz.querySelector("h2, h3");
      if (h) h.textContent = "Add your export files";
      const p = dz.querySelector("p");
      if (p) p.innerHTML = "Pick the ZIP from support, or files from the unzipped export — one like <code>FriendList.tsv</code>";
    }
    // The iPhone's Files app can't open the password-protected ZIP support
    // sends, but this page can — say so up front, in the dropzone. Where this
    // browser can't either, the way out is still a computer.
    if (isIOS) {
      const hint = dz.querySelector(".dz-hint");
      if (hint) hint.innerHTML = ZIP_AES_OK
        ? '.zip · .tsv · .csv · .txt · .json — read locally, never uploaded<br>'
          + 'Got the password-protected ZIP from support? Pick it here and type its password — no unzipping needed.'
        : '.tsv · .csv · .txt · .json — read locally, never uploaded<br>'
          + 'Heads up: the iPhone Files app can\'t open the password-protected ZIP support sends — '
          + '<a href="index.html#request">unzip it on a computer first →</a>';
    }
  }

  // Auto-load the sample export on the dedicated live-example page, or when
  // metrics.html is opened with ?demo=1. Called directly — a setTimeout here
  // gets clamped to a full minute if the page opens in a background tab.
  if (window.DEMO_PAGE || /[?&]demo=1\b/.test(location.search)) loadDemo();
});
