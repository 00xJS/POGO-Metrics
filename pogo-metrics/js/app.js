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

/* Marquee event dates (UTC), used to turn anonymous activity spikes into
 * memories ("your #1 day was GO Fest 2024"). Starter set: global GO Fests.
 * Extend freely — one line per date. */
const GO_EVENTS = {
  "2017-07-22": "GO Fest 2017 (Chicago)",
  "2018-07-14": "GO Fest 2018 (Chicago)", "2018-07-15": "GO Fest 2018 (Chicago)",
  "2019-06-13": "GO Fest 2019 (Chicago)", "2019-06-14": "GO Fest 2019 (Chicago)",
  "2019-06-15": "GO Fest 2019 (Chicago)", "2019-06-16": "GO Fest 2019 (Chicago)",
  "2020-07-25": "GO Fest 2020 (Global)", "2020-07-26": "GO Fest 2020 (Global)",
  "2021-07-17": "GO Fest 2021 (Global)", "2021-07-18": "GO Fest 2021 (Global)",
  "2022-06-04": "GO Fest 2022 (Global)", "2022-06-05": "GO Fest 2022 (Global)",
  "2022-08-27": "GO Fest 2022 Finale", "2022-08-28": "GO Fest 2022 Finale",
  "2023-08-26": "GO Fest 2023 (Global)", "2023-08-27": "GO Fest 2023 (Global)",
  "2024-07-13": "GO Fest 2024 (Global)", "2024-07-14": "GO Fest 2024 (Global)",
  "2025-06-28": "GO Fest 2025 (Global)", "2025-06-29": "GO Fest 2025 (Global)",
  "2026-07-11": "GO Fest 2026 (Global)", "2026-07-12": "GO Fest 2026 (Global)",
};
const eventFor = (iso) => GO_EVENTS[iso] || null;

/* Gameplay.txt mixes real tiered medals with event/collection badges under the
 * same "BADGE_NAME: n" syntax. These families are participation badges whose
 * number is a count, not a Bronze-to-Platinum tier. */
const EVENT_BADGE = /^BADGE_(EVENT|GOFEST|GOTOUR|GO_TOUR|GOWA|SMORES|MINI_COLLECTION|COMMUNITY|SAFARI|CITY|WILD_AREA)/;

/* ───────────────────────────── tiny helpers ───────────────────────────── */
/* grouping follows the reader's locale — trainer-model.js already did; the
 * report was hard-locked to en-US, so the two pages disagreed on 1,234 vs 1.234 */
const fmt = (n) => Number(n).toLocaleString();
const round = (n) => Math.round(n);
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const titleCase = (s) => s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const base = (p) => (p || "").split("/").pop();
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
      days: new Set(), dayCounts: {}, geo: new Map(), geoKind: new Map(), first: null, last: null,
      stamps: [], forts: new Map(), gyms: new Map(),
      raidTotal: 0, raidRemote: 0, raidMaxKm: 0, raidKmSum: 0, raidWithDist: 0,
      raidArcs: new Map(), raidGymBins: new Map(), remoteRaidsByYear: {},
      geoFirst: new Map(), arcFirst: new Map(),   // first-seen month per spot/arc — feeds the globe replay
    },
    trail: [], trailCount: 0, trailStride: 1,
    bag: null,
    friends: { rows: [], monthly: {}, sources: {}, initiated: {}, games: {}, unfriendedMonthly: {}, unfriended: 0 },
    invites: { sent: 0, accepted: 0, declined: 0 },
    party: { received: 0, sent: 0 },
    spend: {
      coinsBought: 0, coinsSpent: 0, purchases: 0, spendEvents: 0, items: {}, cur: {}, vendor: {},
      boughtMonthly: {}, spentMonthly: {}, freeBundles: 0, paidBundles: 0, granted: 0, grantedItems: {},
    },
    fitness: { daily: {} },
    photos: { monthly: {}, days: {}, total: 0, first: null, last: null },
    support: { tickets: 0, messages: 0, topics: {}, first: null, last: null },
    sessions: { monthly: {}, devices: {}, cities: {}, countries: {}, places: {}, total: 0 },
    installs: { count: 0, first: null, devices: {} },
    liveEvents: [],
    wayfarer: null,
  };
}
let STATE = freshState();
let RAW = [];               // [{ name, text, entry, oversize, file }]
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

/* Heavy vendor libraries load on demand, not at page open — the upload UI
 * must be interactive the moment the page paints, and most visits never need
 * the 1.4MB globe bundle at all. */
const _libLoads = {};
function ensureScript(src) {
  if (_libLoads[src]) return _libLoads[src];
  return (_libLoads[src] = new Promise((res, rej) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = res;
    s.onerror = () => { delete _libLoads[src]; rej(new Error("failed to load " + src)); };
    document.head.appendChild(s);
  }));
}
function ensureCSS(href) {
  if (_libLoads[href]) return _libLoads[href];
  return (_libLoads[href] = new Promise((res) => {
    const l = document.createElement("link");
    l.rel = "stylesheet"; l.href = href;
    l.onload = res; l.onerror = res;
    document.head.appendChild(l);
  }));
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
   * every message, not just the first. */
  el.scrollIntoView({ behavior: scrollBehavior(), block: "center" });
}
function clearError() { const el = $("upload-error"); if (el) el.style.display = "none"; }

async function collectFiles(items) {
  /* recurse DataTransferItem entries so dropping a folder works */
  const out = [];
  const walk = (entry) =>
    new Promise((res) => {
      if (!entry) return res();
      if (entry.isFile) entry.file((f) => { out.push(f); res(); }, () => res());
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

async function ingest(files) {
  clearError();
  /* Reading files is a long await chain — one disk round-trip per file, and a
   * full export is 41 of them. build() has always been able to abandon a stale
   * run; ingest() could not, so hitting Clear part-way through a folder pick
   * silently refilled RAW after the wipe. For a tool whose promise is "close
   * the tab and it's gone", a Clear that half-undoes itself is the wrong kind
   * of surprise. */
  const gen = DATA_GEN;
  const stale = () => gen !== DATA_GEN;
  const all = [...files].filter((f) => f && f.name);
  const list = all.filter((f) => /\.(tsv|csv|txt|json)$/i.test(f.name));
  if (!list.length) {
    // The single most common first attempt: dropping the ZIP Niantic sent, unopened.
    if (all.some((f) => /\.zip$/i.test(f.name)))
      showError('That looks like the ZIP file Niantic sent you — it needs unzipping first, with the password from their message. '
        + (/iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1)
          ? 'Heads up: the iPhone Files app <b>cannot</b> open a password-protected ZIP — email or AirDrop it to a computer, unzip it there, then come back. '
          : 'Double-click it, type the password, then drop the unzipped folder here. ')
        + '<a href="index.html#request">Full instructions →</a>', true);
    else showError("No .tsv / .csv / .txt / .json files found in what you dropped.");
    return;
  }
  /* Reading a whole folder is seconds of silent awaits — put the dropzone into
   * a visible reading state so the drop never looks ignored. Restored in the
   * finally, including on a mid-read Clear. */
  const dzEl = $("dropzone");
  const dzHead = dzEl && dzEl.querySelector("h2, h3");
  const dzHead0 = dzHead ? dzHead.textContent : "";
  let added = 0, readN = 0;
  try {
    for (const f of list) {
      const name = base(f.name);
      const entry = window.catalogFor(name)
        // the app's own stats export is not a Niantic file, but it has a chapter
        || (/^pogo-metrics-stats.*\.json$/i.test(name)
          ? { name: "Friend's stats (from this site)", icon: "🤝", story: true, sensitivity: "low",
              summary: "A stats JSON exported by POGO Metrics — unlocks the You vs. friend chapter." }
          : null);
      const existing = RAW.findIndex((r) => r.name.toLowerCase() === name.toLowerCase());
      readN++;
      if (dzHead && list.length > 2) dzHead.textContent = `Reading your files… (${readN} of ${list.length})`;
      // Too large to read in a browser tab — keep it visible in the list instead
      // of silently vanishing, so the user knows why that chapter is missing.
      if (f.size > 80 * 1024 * 1024) {
        const rec = { name, text: null, entry, oversize: Math.round(f.size / 1024 / 1024) };
        if (existing >= 0) RAW[existing] = rec; else RAW.push(rec);
        added++;
        continue;
      }
      let text;
      // A file whose read throws must not vanish without a trace — keep it in
      // the list with its own honest status instead.
      try { text = await f.text(); } catch (e) {
        const rec = { name, text: null, entry, unreadable: true };
        if (existing >= 0) RAW[existing] = rec; else RAW.push(rec);
        continue;
      }
      if (stale()) return;   // cleared while this file was being read
      // Keep the File handle alongside the text. build() drops the text once it
      // has parsed it and re-reads from the handle on a rebuild, so a 40 MB
      // export stops costing ~72 MB of retained UTF-16 for the tab's lifetime.
      // Several files (sweepstakes, leaderboards, refunds) arrive containing
      // nothing but "No data found." — that isn't a file we failed to read, it's
      // Niantic saying there's nothing on record, and the list should say so.
      const rec = { name, text, entry, file: f, empty: /^\s*No data found\.?\s*$/i.test(text) };
      if (existing >= 0) RAW[existing] = rec; else RAW.push(rec);
      added++;
    }
  } finally {
    if (dzHead) dzHead.textContent = dzHead0;
  }
  if (stale()) return;   // cleared on the last file — leave the wipe alone
  if (!added && !RAW.length) showError("Couldn't read those files. Try choosing them again, or pick the folder.");
  // A mixed drop keeps its valid files — but the ones filtered out by
  // extension used to vanish silently, hiding a mis-drop.
  const skippedExt = all.filter((f) => !/\.(tsv|csv|txt|json)$/i.test(f.name));
  if (list.length && skippedExt.length) {
    const names = skippedExt.slice(0, 4).map((f) => esc(f.name)).join(", ");
    showError(`${skippedExt.length} file${skippedExt.length > 1 ? "s" : ""} in that drop ${skippedExt.length > 1 ? "aren't formats" : "isn't a format"} this site reads (${names}${skippedExt.length > 4 ? ", …" : ""})`
      + (skippedExt.some((f) => /\.zip$/i.test(f.name))
        ? " — the ZIP needs unzipping first; the files inside it are what you want to add."
        : " — only .tsv / .csv / .txt / .json carry chapters."), true);
  }
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
    if (AUTO_BUILD_T) clearTimeout(AUTO_BUILD_T);
    const genAt = DATA_GEN;
    AUTO_BUILD_T = setTimeout(() => { AUTO_BUILD_T = null; if (genAt === DATA_GEN) build(); }, 900);
    const bb = $("build-btn");
    if (bb) bb.innerHTML = 'Rebuild my story';
    if ($("build-row")) $("build-row").scrollIntoView({ behavior: scrollBehavior(), block: "center" });
  } else if (RAW.length && $("build-row")) {
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
      res.innerHTML = `<div class="empty-state"><div class="es-emoji">📡</div>
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

function renderDetected() {
  const el = $("detected");
  if (!el) return; // results-only pages (e.g. the live-example page) skip the picker
  const buildRow = $("build-row");
  if (!RAW.length) { el.innerHTML = ""; if (buildRow) buildRow.style.display = "none"; return; }
  const tally = { ready: 0, privacy: 0, noChapter: 0, empty: 0, oversize: 0, unknown: 0 };
  const rows = RAW.map((r) => {
    let cls = "unknown", status = "Not recognized", name = r.name, icon = "❓", note = "We don't have a story for this file.", kind = "unknown";
    if (r.entry) {
      name = r.entry.name; icon = r.entry.icon; note = r.entry.summary;
      if (r.entry.story) { cls = "ok"; status = "Ready"; kind = "ready"; }
      // "skipped for privacy" and "we have no chapter for this yet" are very
      // different promises — don't tell someone we ignored a harmless file.
      else if (r.entry.sensitivity === "high") { cls = "skip"; status = "Skipped (privacy)"; kind = "privacy"; }
      else { cls = "skip"; status = "No chapter yet"; kind = "noChapter"; }
    }
    if (r.empty) { cls = "skip"; status = "Empty — nothing on record"; note = "Niantic sent this file with no rows in it."; kind = "empty"; }
    if (r.oversize) { cls = "skip"; status = `Too large (${r.oversize} MB) — skipped`; kind = "oversize"; }
    if (r.unreadable) { cls = "unknown"; status = "Couldn't read — add it again"; note = "The browser couldn't open this file. Pick or drop it once more."; kind = "unknown"; }
    tally[kind]++;
    return `<div class="file-chip ${cls}">
      <span class="fc-icon">${icon}</span>
      <div class="fc-main"><div class="fc-name">${esc(name)}</div><div class="fc-file">${esc(r.name)} · ${esc(note)}</div></div>
      <span class="fc-status">${esc(status)}</span>
    </div>`;
  }).join("");
  /* An honest summary, not a flat "N files ready": counting a mis-drop as
   * "ready" hid the problem behind a closed disclosure until after Build. */
  const bits = [`<b>${tally.ready}</b> chapter${tally.ready === 1 ? "" : "s"} ready`];
  if (tally.privacy) bits.push(`${tally.privacy} privacy-skipped`);
  if (tally.noChapter) bits.push(`${tally.noChapter} no chapter yet`);
  if (tally.empty) bits.push(`${tally.empty} empty`);
  if (tally.oversize) bits.push(`${tally.oversize} too large`);
  if (tally.unknown) bits.push(`${tally.unknown} not recognized`);
  // wrong or unreadable drops must be visible BEFORE the Build click
  const attention = tally.unknown + tally.oversize > 0;
  el.innerHTML = `
    <details class="det-files"${attention ? " open" : ""}>
      <summary class="det-head">
        <h2>${RAW.length} file${RAW.length > 1 ? "s" : ""} added · ${bits.join(" · ")}</h2>
        <span class="det-toggle">Review files</span>
      </summary>
      <div class="det-list">${rows}</div>
    </details>`;
  if (buildRow) buildRow.style.display = "block";
}

/* ───────────────────────────── routing ───────────────────────────── */
/* Async because the three high-volume parsers stream and yield. Everything
 * else stays synchronous — awaiting a value that isn't a promise is free, and
 * making a 400-row file pay for scheduling would be noise. */
async function routeFile(name, text) {
  const n = name.toLowerCase();
  try {
    if (/gameplay\.txt$/i.test(n)) return parseGameplay(text);
    if (PJ_EVENTS.some(([re]) => re.test(n)) || /^(pokestop_spin|sfida_capture|map_pokemon_encounter|join_raid_lobby|gym_battle|feed_pokemon|deploy_pokemon|incense_encounter|lure_encounter)\d*\.csv$/i.test(n)) {
      const hit = PJ_EVENTS.find(([re]) => re.test(n));
      // awaited, not just returned, so a rejection lands in the catch below
      if (hit) return await parsePlayerJourney(hit[1], text);
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
    if (/supportinteractions\d*\.tsv$/i.test(n)) return parseSupport(text);
  } catch (e) {
    console.warn("Failed to parse", name, e);
  }
}
function markLoaded(label) { if (!STATE.loaded.includes(label)) STATE.loaded.push(label); }

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
  markLoaded("Gameplay Summary");
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
 * files, and the reason a build used to lock the page. Streams and yields. */
async function parsePlayerJourney(label, text) {
  const e = STATE.ev;
  let n = 0;
  await eachRow(text, "x.csv", (row) => {
    const ts = parseTS(row.Timestamp);
    if (!ts) return;
    n++;
    if (!e.first || ts < e.first) e.first = ts;
    if (!e.last || ts > e.last) e.last = ts;
    const mk = monthKey(ts);
    (e.byMonth[mk] = e.byMonth[mk] || {})[label] = (e.byMonth[mk][label] || 0) + 1;
    e.hourweek[weekdayMon(ts)][ts.getUTCHours()]++;
    const iso = ts.toISOString().slice(0, 10);
    e.days.add(iso);
    e.dayCounts[iso] = (e.dayCounts[iso] || 0) + 1;
    e.stamps.push(ts.getTime()); // kept for session reconstruction (8 bytes/row)
    const lat = parseFloat(row.Player_Latitude), lon = parseFloat(row.Player_Longitude);
    let hasLoc = false;
    if (!isNaN(lat) && !isNaN(lon) && (lat || lon)) {
      hasLoc = true;
      const key = lat.toFixed(3) + "," + lon.toFixed(3);
      e.geo.set(key, (e.geo.get(key) || 0) + 1);
      if (!e.geoFirst.has(key)) e.geoFirst.set(key, mk);
      let kc = e.geoKind.get(key);
      if (!kc) { kc = {}; e.geoKind.set(key, kc); }
      kc[label] = (kc[label] || 0) + 1;
    }
    /* Fort_/Gym_ coordinates identify the actual PokéStop or gym — the export
     * has carried them all along and nothing ever read them. Binned to ~11 m so
     * GPS scatter around one real stop collapses to a single place. */
    const flat = parseFloat(row.Fort_Latitude), flon = parseFloat(row.Fort_Longitude);
    if (!isNaN(flat) && !isNaN(flon) && (flat || flon)) {
      const fk = flat.toFixed(4) + "," + flon.toFixed(4);
      const f = e.forts.get(fk);
      if (f) { f.n++; if (ts < f.first) f.first = ts; if (ts > f.last) f.last = ts; }
      else e.forts.set(fk, { n: 1, first: ts, last: ts, lat: flat, lon: flon });
    }
    if (label === "Raids") {
      e.raidTotal++;
      const glat = parseFloat(row.Gym_Latitude), glon = parseFloat(row.Gym_Longitude);
      if (!isNaN(glat) && !isNaN(glon) && (glat || glon)) {
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
          if (!e.arcFirst.has(ak)) e.arcFirst.set(ak, mk);
          const gk = `${glat.toFixed(1)},${glon.toFixed(1)}`;
          e.raidGymBins.set(gk, (e.raidGymBins.get(gk) || 0) + 1);
        }
      }
    }
  });
  e.totals[label] = (e.totals[label] || 0) + n;
  if (n) markLoaded("Player Journey events");
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

function parseInvites(text) {
  // This file ships without a header row, so parse lines directly.
  const I = STATE.invites;
  for (const line of text.replace(/\r/g, "").split("\n")) {
    if (!line.trim()) continue;
    const action = (line.split("\t")[0] || "").toLowerCase();
    if (action.includes("accept")) I.accepted++;
    else if (action.includes("declin")) I.declined++;
    else if (action.includes("sent") || action.includes("send")) I.sent++;
  }
  if (I.sent + I.accepted + I.declined) markLoaded("Recent Invite Actions");
}

function parseParty(text, sent) {
  const { rows } = parseRows(text, "x.tsv");
  if (rows.length) { STATE.party[sent ? "sent" : "received"] += rows.length; markLoaded("Party Play Invites"); }
}

function parsePurchases(text) {
  const { rows } = parseRows(text, "x.tsv");
  const S = STATE.spend;
  for (const row of rows) {
    const ts = parseTS(row["Date and time"]);
    const typ = (row["Type of activity"] || "").trim();
    if (typ === "Pokecoin bought") {
      const cur = (row.Currency || "UNKNOWN").trim() || "UNKNOWN";
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

/* 20,771 rows and 32 columns on a real export — big enough to be worth
 * streaming alongside Player_Journey. */
async function parseSessions(text) {
  const S = STATE.sessions;
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
    S.total++;
  }, true);
  if (S.total) markLoaded("App Sessions");
}

function parseInstalls(text) {
  const { rows } = parseRows(text, "x.csv", true);
  const I = STATE.installs;
  for (const row of rows) {
    /* Real exports carry Install_time; the scrubbed demo fixture is reshaped to
     * Event_time,Device_model,Platform,City,State and has no Install_time at
     * all, so read BOTH names before falling back to a position. Column 0
     * differs between the two files (Attributed_touch_time vs Event_time), so
     * the positional read is a genuine last resort, not the working path. */
    const ts = parseTS(row.Install_time || row.Event_time || row.__cells[0]);
    if (ts && (!I.first || ts < I.first)) I.first = ts;
    const dev = ((row.Device_model || "") + "").split("::").pop().trim();
    if (dev) I.devices[dev] = (I.devices[dev] || 0) + 1;
    I.count++;
  }
  if (I.count) markLoaded("App Installs");
}

function parseLiveEvents(text) {
  const { rows } = parseRows(text, "x.tsv");
  for (const row of rows) {
    const detail = (row["Event Details"] || "").trim();
    if (!detail) continue;
    STATE.liveEvents.push({
      name: detail.split(",")[0].trim(),
      tickets: parseInt(row["Number of Tickets on Order"] || 1, 10) || 1,
      paid: parseFloat(row["Total Paid"]) || 0,
      currency: (row["Currency Paid"] || "").trim(),
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
   * message, all sharing "Ticket 38788709: <subject>". Counting rows called a
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

function parseWayfarer(text) {
  try {
    const j = JSON.parse(text);
    const root = Array.isArray(j) ? (j[0] || {}) : j;
    const profRaw = root.OprProfile;
    const prof = Array.isArray(profRaw) ? (profRaw[0] || null) : profRaw;
    const subs = root.OprSubmissionLog || [];
    const grabNum = (obj, keys) => { for (const k in obj) { if (keys.some((kk) => k.toLowerCase().includes(kk))) { const v = +obj[k]; if (!isNaN(v)) return v; } } return null; };
    /* OprSubmissionLog is a LOG — a rolling record of submissions Niantic still
     * holds, not a lifetime nomination count. It was labelled "Nominations
     * submitted", which on the reference profile claimed 4 against a lifetime
     * "Total Analyzed" of 7: a smaller number than the thing it supposedly
     * contains. Name it for what it is and let the profile totals carry the
     * lifetime story. */
    STATE.wayfarer = {
      logged: Array.isArray(subs) ? subs.length : null,
      analyzed: prof ? grabNum(prof, ["analyzed"]) : null,
      created: prof ? grabNum(prof, ["created"]) : null,
      rejected: prof ? grabNum(prof, ["rejected"]) : null,
    };
    const W = STATE.wayfarer;
    if (W.logged || W.analyzed || W.created || W.rejected) markLoaded("Wayfarer Contributions");
  } catch (e) { /* ignore malformed */ }
}

/* ───────────────────────────── DOM helpers ───────────────────────────── */
/* `anchor` pins the chapter's #id when the heading can't be trusted to stay
   the same — the trainer card's title contains the player's name, so its slug
   would otherwise differ for every reader and no link to it could be shared. */
function moduleHTML(icon, title, sub, inner, anchor) {
  return `<div class="module"${anchor ? ` data-anchor="${anchor}"` : ""}>
    <div class="mod-head"><span class="mod-icon">${icon}</span><h3>${esc(title)}</h3></div>
    ${sub ? `<div class="mod-sub">${sub}</div>` : ""}
    ${inner}</div>`;
}
function statGrid(items) {
  return `<div class="stat-grid">${items.map(([v, l, s]) =>
    `<div class="stat-card"><div class="v">${v}</div><div class="l">${esc(l)}</div>${s ? `<div class="s">${esc(s)}</div>` : ""}</div>`).join("")}</div>`;
}
function calloutRow(items) {
  return `<div class="callout-row">${items.map(([v, l]) => `<div class="callout"><b>${v}</b> ${esc(l)}</div>`).join("")}</div>`;
}
function rankList(items, fmtVal = (v) => fmt(v)) {
  const max = items.reduce((m, [, v]) => Math.max(m, v), 0) || 1;
  return `<div class="rank-list">${items.map(([name, v], i) => `
    <div class="rank-row"><span class="rk">${i + 1}</span><span class="rn">${esc(name)}</span><span class="rv">${fmtVal(v, name)}</span></div>
    <div class="rank-bar"><i style="width:${((v / max) * 100).toFixed(1)}%"></i></div>`).join("")}</div>`;
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
  // one bar language for every chart — was 2/3/6 decided chart by chart
  Chart.defaults.elements.bar.borderRadius = 3;

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
  /* Release the parsed export too. Clear and "Start over" used to tear down the
   * charts while leaving every aggregate — trail points, timestamps, fort and
   * gym maps, friend rows — alive in STATE, so the memory a user was trying to
   * clear stayed put until they happened to build again. build() calls this
   * first, so it gets its fresh state from here. */
  STATE = freshState();
}

async function build() {
  if (!RAW.length || BUILDING) return;
  BUILDING = true;
  const gen = DATA_GEN;
  const stale = () => gen !== DATA_GEN;
  // Abandoning a build must leave nothing behind: a file parsed in the moment
  // the user hit Clear would otherwise sit in the fresh STATE afterwards.
  const abort = () => { STATE = freshState(); };
  if (AUTO_BUILD_T) { clearTimeout(AUTO_BUILD_T); AUTO_BUILD_T = null; }
  const btn = $("build-btn");
  const btnLabel = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "Building…"; }
  const res = $("results");
  res.classList.remove("results-hidden");
  res.innerHTML = `<div class="empty-state"><div class="gl-spin" style="margin:0 auto 14px"></div>
    <p id="build-progress">${SAMPLE_DATA || window.DEMO_PAGE ? "Reading the sample export…" : "Reading your files…"}</p>
    <div class="build-bar" aria-hidden="true"><i id="build-bar-fill"></i></div></div>`;
  try {
    teardown(); // also resets STATE

    // Kick off the libraries this build will need while we parse.
    const libWaits = [ensureScript("vendor/chart.umd.min.js")];

    // Yields between files; the big parsers additionally yield WITHIN a file
    // (see eachRow), which is what stops one 8.9MB CSV freezing the page.
    const prog = $("build-progress");
    const bar = $("build-bar-fill");
    const readable = RAW.filter((r) => !r.oversize).length;
    const srcWord = SAMPLE_DATA || window.DEMO_PAGE ? "the sample export" : "your files";
    let readN = 0;
    const unreadable = [];
    for (const r of RAW) {
      if (r.oversize) continue; // too large to read at all — already flagged in the list
      readN++;
      // determinate, not a bare spinner: "2 in or 12?" is the whole question
      if (prog) prog.textContent = `Reading ${r.name} (${readN} of ${readable}, ${srcWord})…`;
      if (bar) bar.style.width = Math.round((readN / Math.max(1, readable)) * 88) + "%";
      await nextTick(); // let the progress line paint without timer throttling
      // On a rebuild the text was released after the last build; read it again
      // from the File handle the browser still holds.
      if (stale()) return abort(); // the user cleared while we were reading
      let text = r.text;
      if (text == null && r.file) {
        try { text = await r.file.text(); } catch (e) { unreadable.push(r.name); continue; }
      }
      if (text == null) continue;
      if (stale()) return abort(); // cleared during the read
      await routeFile(r.name, text);
      if (stale()) return abort(); // cleared while this file was being parsed
      // Release immediately: the parsed aggregates in STATE are all we need,
      // and holding every file's text is the single largest retention in the app.
      if (r.file) r.text = null;
    }
    if (unreadable.length) {
      showError("Couldn't re-read " + unreadable.map(esc).join(", ")
        + " — if the file moved or was deleted since you picked it, add it again.", true);
    }

    const needGeo = STATE.ev.geo.size > 0 || STATE.trail.length > 0;
    if (needGeo) {
      if (_webglOK()) libWaits.push(ensureScript("vendor/globe.gl.min.js"));
      else libWaits.push(ensureCSS("vendor/leaflet.css")
        .then(() => ensureScript("vendor/leaflet.js"))
        .then(() => ensureScript("vendor/leaflet-heat.js")));
    }
    if (prog) prog.textContent = "Drawing your story…";
    if (bar) bar.style.width = "96%";
    await Promise.all(libWaits.map((p) => p.catch((e) => console.warn(e))));
    if (stale()) return abort(); // cleared while libraries loaded — draw nothing

    res.innerHTML = "";

    if (!STATE.loaded.length) {
      // Blaming the user's files for what is actually a stale file handle is the
      // wrong story: if nothing could be re-read, say exactly that.
      res.innerHTML = unreadable.length
        ? `<div class="empty-state"><div class="es-emoji">📂</div>
          <h3 style="margin:10px 0 6px">Couldn't re-read your files</h3>
          <p>The export folder may have moved, been deleted, or been renamed since you picked it.
          Add ${unreadable.length === 1 ? esc(unreadable[0]) : "the files"} again to rebuild.</p></div>`
        : `<div class="empty-state"><div class="es-emoji">🤔</div>
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
    safe(renderSpending);
    safe(renderFitness);
    safe(renderPhotos);
    safe(renderLiveEvents);
    safe(renderSessions);
    safe(renderWayfarer);

    // chapter navigation — anchors into each module, right under the hero
    const mods = [...res.querySelectorAll(".module")];
    if (mods.length >= 3) {
      const chips = mods.map((m) => {
        const h = m.querySelector(".mod-head h3");
        const icon = m.querySelector(".mod-icon");
        const t = h ? h.textContent.trim() : "Chapter";
        // Slug from the heading, EXCEPT where the heading carries the trainer's
        // name — "AshDemo at a glance" would mint a different anchor for every
        // player, and these ids are meant to be linkable.
        m.id = "ch-" + (m.dataset.anchor
          || t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, ""));
        return `<a class="ch-chip" href="#${m.id}">${icon ? icon.textContent + " " : ""}${esc(t)}</a>`;
      }).join("");
      res.querySelector(".res-hero").insertAdjacentHTML("afterend",
        `<nav class="chapter-nav" aria-label="Chapters">${chips}</nav>`);
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
      document.title = `${who ? esc(who) + "'s" : "Your"} journey — POGO Metrics`;
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
  const id = decodeURIComponent(location.hash.slice(1));
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
  const toolbar = window.DEMO_PAGE
    ? `<div class="res-toolbar">
       <button class="btn btn-primary" id="story-btn" type="button">▶ Play the example story</button>
     </div>`
    : `<div class="res-toolbar">
       <button class="btn btn-primary" id="story-btn" type="button"><span aria-hidden="true">▶</span> Play my story</button>
       <button class="btn btn-teal" id="journey-btn" type="button"><span aria-hidden="true">⬇</span> Journey card</button>
       <button class="btn btn-ghost" id="json-btn" type="button"><span aria-hidden="true">🧾</span> My numbers</button>
       <button class="btn btn-ghost" id="poster-btn" type="button"><span aria-hidden="true">🖼</span> Poster</button>
       <button class="btn btn-teal" id="addmore-btn" type="button"><span aria-hidden="true">＋</span> Add more files</button>
       <button class="btn btn-ghost" id="restart-btn" type="button"><span aria-hidden="true">↺</span> Start over</button>
     </div>`;
  return `<div class="res-hero">
    <div class="eyebrow">${window.DEMO_PAGE ? "Live example · sample data" : "Your Pokémon GO metrics"}</div>
    <h2>${who} journey, visualized</h2>
    <p>${intro}</p>
    ${toolbar}
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
  if (js) js.onclick = () => downloadStatsJSON();
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
      setTimeout(() => { if (r.isConnected) { delete r.dataset.armed; r.textContent = "↺ Start over"; } }, 4000);
      return;
    }
    teardown();
    RAW = []; DATA_GEN++;
    renderDetected();
    clearError();
    $("results").classList.add("results-hidden");
    $("results").innerHTML = "";
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
      <a href="index.html#request">request your data from Niantic first</a>.</div>` + modelHandoff();
  }
  // tell the player exactly which chapters their remaining files would unlock
  const locked = (window.CATALOG || []).filter((c) =>
    c.story && !RAW.some((r) => c.match.test(r.name))).slice(0, 3);
  const more = locked.length
    ? `<div style="margin-top:10px">${locked.map((c) =>
        `<span class="locked-chip">${c.icon} <code>${esc(c.id)}</code> unlocks <b>${esc(c.name)}</b></span>`).join("")}
      <div style="margin-top:8px"><a href="/#datasets">See what's in your export →</a></div></div>`
    : "";
  return `<div class="notice" style="margin-top:30px">
    <b>That's your story — for now.</b> Add more files above to unlock new chapters of your journey.${more}</div>`
    + modelHandoff();
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
  const local = gridShift(e.hourweek, -new Date().getTimezoneOffset() / 60);
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
    ["The Collector", "🎯", (catchesOf(e.totals) / total) / 0.45, "if it spawns, it's yours", [C.teal, C.yellow]],
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
  if (total) s.push({ kicker: yr ? `YOUR ${yr}` : "SINCE THEN", num: total, label: yr ? `actions logged in ${yr}` : "actions in the game's log — every spin, catch, raid and battle Niantic wrote down", grad: 2 });
  const catches = catchesOf(kinds);
  if (catches) s.push({ kicker: "GOTTA CATCH 'EM ALL", num: catches, label: `Pokémon caught${yr ? ` in ${yr}` : " in the logs — map, incense, lure and GO Plus catches combined"}`, grad: 3 });
  let bigDay = null, bigN = 0;
  for (const d of dayKeys) if (e.dayCounts[d] > bigN) { bigN = e.dayCounts[d]; bigDay = d; }
  if (bigDay) s.push({ kicker: yr ? `${yr}'S BIGGEST DAY` : "YOUR BIGGEST DAY", num: bigN, label: `actions on ${fmtDate(parseTS(bigDay))}${eventFor(bigDay) ? " — " + eventFor(bigDay) : ""}`, grad: 4 });
  if (!yr) {
    // busiest slot in the VIEWER'S clock — "your hour" should feel like their life, not UTC
    const local = gridShift(e.hourweek, -new Date().getTimezoneOffset() / 60);
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
        : (Object.keys(STATE.ev.dayCounts).length ? `<button class="btn btn-primary" id="story-journey" type="button"><span aria-hidden="true">⬇</span> My journey card</button>` : "")}
      <button class="btn btn-ghost" id="story-back" type="button">Back to my chapters</button></div>`;
    stage.innerHTML = `<div class="story-slide${dir > 0 ? " fwd" : dir < 0 ? " bwd" : ""}">
      <div class="story-kicker">${sl.kicker}</div>
      ${sl.num != null ? `<div class="story-big mono" data-n="${sl.num}">${REDUCED_MOTION ? fmt(sl.num) : "0"}</div>` : `<div class="story-big">${sl.big}</div>`}
      <div class="story-label">${sl.label}</div>
      ${!sl.finale && !SAMPLE_DATA && idx > 0 ? `<div class="story-share-row"><button class="btn btn-ghost story-share" type="button"><span aria-hidden="true">📤</span> Share this</button></div>` : ""}
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

/* A tiny on-device .ics download — no calendar service, no request. Same
 * pattern as the landing page's export reminder. */
function downloadICS(summary, date, filename) {
  const ymd = date.toISOString().slice(0, 10).replace(/-/g, "");
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const ics = [
    "BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//POGO Metrics//EN",
    "BEGIN:VEVENT", "UID:" + stamp + "@pogo-metrics",
    "DTSTAMP:" + stamp, "DTSTART;VALUE=DATE:" + ymd,
    "SUMMARY:" + summary,
    "DESCRIPTION:Projected from your recent pace by POGO Metrics. Re-export from Niantic and rebuild to see how close you are: https://pogo-metrics.netlify.app/",
    "URL:https://pogo-metrics.netlify.app/", "END:VEVENT", "END:VCALENDAR",
  ].join("\r\n");
  const url = URL.createObjectURL(new Blob([ics], { type: "text/calendar" }));
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ── shared canvas delivery: native share sheet on phones, download anchor
   everywhere else. AbortError means the user closed the sheet on purpose —
   don't then shove a download at them. ── */
function deliverCanvas(cv, filename, title, after) {
  cv.toBlob(async (blob) => {
    const finish = () => { if (after) after(); };
    if (blob && navigator.canShare) {
      try {
        const file = new File([blob], filename, { type: "image/png" });
        if (navigator.canShare({ files: [file] })) {
          await navigator.share({ files: [file], title });
          finish();
          return;
        }
      } catch (err) {
        if (err && err.name === "AbortError") { finish(); return; }
      }
    }
    if (!blob) { alert("Could not generate image on this browser."); finish(); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = filename;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    finish();
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
  // the big thing — number or phrase, shrunk until it fits
  const bigText = sl.num != null ? fmt(sl.num) : String(sl.big).replace(/<[^>]*>/g, "");
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
  const words = String(sl.label).replace(/<[^>]*>/g, "").split(/\s+/);
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
    [fmt(total), "logged actions"], [fmt(catchesOf(e.totals)), "Pokémon caught"],
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
    events: fmt(total), badges,
    peakLabel: monthTotals[0] ? `${fmtMonth(monthTotals[0][0])} was the biggest month of all` : "",
    stats: [
      [fmt(catchesOf(e.totals)), "Pokémon caught"], [fmt(e.totals["Spins"] || 0), "PokéStop spins"],
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

/* ── stats export: a curated JSON summary, with location data deliberately left out ── */
function downloadStatsJSON() {
  const e = STATE.ev;
  const out = {
    generated: new Date().toISOString(),
    source: "POGO Metrics — parsed locally in your browser from your official Niantic export",
    note: "Location data is deliberately NOT included in this export: no GPS trail, no activity or stop coordinates, and no city or travel history. Those stay in the browser.",
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
    installs: STATE.installs,
    supportTickets: STATE.support.tickets,
    liveEvents: STATE.liveEvents.length,
    wayfarer: STATE.wayfarer,
  };
  const url = URL.createObjectURL(new Blob([JSON.stringify(out, null, 2)], { type: "application/json" }));
  const a = document.createElement("a");
  a.href = url; a.download = "pogo-metrics-stats.json";
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

/* ── trainer card (Gameplay.txt) ── */
function renderTrainer() {
  const p = STATE.profile, col = STATE.collection;
  if (!p) return;
  const km = p.distanceWalkedKm || 0;
  const evT = STATE.ev.totals;
  const caught = catchesOf(evT);
  const stats = [
    [esc(String(p.level || "—")), "Trainer level"],
    [fmt(p.totalXp || 0), "Total XP"],
    [fmt(round(km)) + " km", "Distance walked", "≈ " + (km / 40075 * 100).toFixed(0) + "% around Earth"],
    ...(caught ? [[fmt(caught), "Pokémon caught", "map · incense · lure · GO Plus logs"]] : []),
    ...(evT["Spins"] ? [[fmt(evT["Spins"]), "PokéStop spins"]] : []),
    [fmt(p.stardust || 0), "Stardust"],
    [fmt(p.eggsHatched || 0), "Eggs hatched"],
    [fmt(p.pokecoin || 0), "PokéCoins on hand"],
    /* Niantic's own "You have N items" counts event-pass points and crafting
     * resources as items — 287,859 against a real bag of 16,807 on the
     * reference export. The bag chapter has split those out since it landed,
     * but this card went on printing the raw figure, so the same page showed
     * two "items in bag" numbers 17x apart. Prefer the real one; fall back only
     * when there is no parseable item list to count (parseBag bails on some
     * profiles, so STATE.bag genuinely can be absent). */
    STATE.bag
      ? [fmt(STATE.bag.bagTotal), "Items in bag", fmt(STATE.bag.distinct) + " different kinds"]
      : [fmt(p.totalItems || 0), "Items in bag", "as counted by Niantic"],
    [fmt(p.medalCount || STATE.medals.length || 0), "Medals earned"],
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
   * are lifetime figures straight from Gameplay.txt; catches and spins are
   * counted from Player_Journey, which Niantic only keeps about three years of.
   * Both are right for their source, and calling the whole card "lifetime" made
   * the second pair look wrong. Name the split instead of hiding it. */
  const windowed = (caught ? 1 : 0) + (evT["Spins"] ? 1 : 0);
  const subtitle = `Your trainer card${p.startYear ? `, playing since ${p.startYear}` : ""}${p.buddy ? ` · buddy ${esc(p.buddy)}` : ""}.`
    + (windowed ? ` Level, XP, distance and medals are lifetime totals; catches and spins are counted from your event logs, which reach back about three years.` : "");
  return moduleHTML("🎮", (p.username ? esc(p.username) : "Your trainer") + " at a glance", subtitle, inner, "trainer-card");
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
    [fmt(total), "Logged actions", "spins, catches, raids, berries, battles"],
    [fmt(activeDays), "Active days", "days with at least one action"],
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
  const tzOff = -new Date().getTimezoneOffset() / 60;
  const tzLbl = "UTC" + (tzOff >= 0 ? "+" : "") + (Math.round(tzOff * 10) / 10);
  let inner = `<div>${chartWrap(cMonthly, "tall")}</div>`;
  inner += `<div class="split" style="margin-top:16px">
    <div>${chartWrap(cDonut)}</div>
    <div>${chartWrap(cClock)}</div>
  </div>`;
  /* Niantic logs a catch in four separate files depending on how you met the
   * Pokémon, so the breakdown above splits your catches across four wedges and
   * never shows the one number a player actually wants. Everything here already
   * adds them up (catchesOf) — this just says so on the page instead of leaving
   * you to sum the chart by eye. */
  const catchParts = ["GO Plus catches", "Encounters", "Incense", "Lures"].filter((k) => e.totals[k]);
  if (catchParts.length > 1) {
    inner += `<div class="hw-caption"><b>${fmt(catchesOf(e.totals))} Pokémon caught in total.</b>
      Niantic files a catch by how you found it, so the breakdown above splits them across
      ${catchParts.map((k) => `${esc(k.toLowerCase())} (${fmt(e.totals[k])})`).join(", ")} —
      every chapter here counts the sum.</div>`;
  }
  inner += `<div style="margin-top:22px">
    <h4 class="mod-h4">When you play — hour of week</h4>
    ${tzOff !== 0 ? `<div class="yoy-metrics" style="margin:0 0 10px" id="tz-${cMonthly}">
      <button class="yoy-chip active" type="button" aria-pressed="true" data-off="${tzOff}">Your time (${tzLbl})</button>
      <button class="yoy-chip" type="button" aria-pressed="false" data-off="0">Game time (UTC)</button>
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
    const renderPlayTime = (off) => {
      const grid = gridShift(e.hourweek, off);
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
    renderPlayTime(tzOff); // default to the viewer's clock — UTC is the expert option
    const tzHost = $("tz-" + cMonthly);
    if (tzHost) {
      const tzChips = [...tzHost.querySelectorAll(".yoy-chip")];
      tzChips.forEach((b) => b.addEventListener("click", () => {
        tzChips.forEach((x) => { x.classList.toggle("active", x === b); x.setAttribute("aria-pressed", String(x === b)); });
        renderPlayTime(+b.dataset.off);
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

  return moduleHTML("🗺️", "Your adventure log", `Every spin, catch, raid and battle Niantic logged — ${fmt(total)} actions across ${fmt(e.days.size)} days.`, inner);
}

/* ── friend comparison: parse the app's OWN stats export (downloadStatsJSON)
   back in. The exchanged file is deliberately location-free — its note field
   documents the omission — so the comparison inherits the privacy story. ── */
function parseCompare(text) {
  try {
    const j = JSON.parse(text);
    // only accept what this site itself wrote — the source line is the handshake
    if (!j || !/POGO Metrics/i.test(j.source || "") || !j.totalsByAction) return;
    STATE.compare = {
      who: (j.profile && j.profile.username) || "Your friend",
      totals: j.totalsByAction || {},
      monthly: j.monthly || {},
      dayCounts: j.dayCounts || {},
      friends: j.friends && j.friends.total,
      generated: j.generated,
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
  const me = (STATE.profile && STATE.profile.username) || "You";
  const them = esc(cmp.who);
  const myDays = Object.keys(STATE.ev.dayCounts).length;
  const theirDays = Object.keys(cmp.dayCounts).length;
  const myStreak = longestStreak(Object.keys(STATE.ev.dayCounts));
  const theirStreak = longestStreak(Object.keys(cmp.dayCounts));

  const stats = [
    [fmt(mineTotal), `${esc(me)} — logged actions`, ""],
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

  return moduleHTML("🤝", `${esc(me)} vs ${them}`,
    `Two journeys, side by side — built from a stats file exported by this site (no locations inside, nothing uploaded). `
    + `Want your own to send back? Hit <b>🧾 My numbers</b> in the toolbar.`,
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
  addMile("Pokémon caught", catchesOf(e.totals), rateOf((k) => catchesOf(k)));
  addMile("PokéStop spins", e.totals["Spins"] || 0, rateOf((k) => k["Spins"] || 0));
  addMile("Raids", e.totals["Raids"] || 0, rateOf((k) => k["Raids"] || 0));
  addMile("Logged actions", total, rateOf((k) => Object.values(k).reduce((a, b) => a + b, 0)));
  if (mile.length) {
    inner += `<hr class="mod-divider"><h4 class="mod-h4">Next milestones</h4>
      <div class="mod-sub" style="margin-bottom:12px">At your pace from the last few months — a reason to come back with next year's export.</div>
      <div class="gen-bars">${mile.slice(0, 4).map((m) => `
        <div class="gen-row">
          <div class="gname">${esc(m.label)}</div>
          <div class="gen-bar-track"><div class="gen-bar-fill" style="width:${Math.min(100, m.current / m.target * 100).toFixed(1)}%"></div></div>
          <div class="gval">${fmt(m.toGo)} to ${fmt(m.target)}${m.eta
            ? ` · ~${m.eta.toLocaleDateString(undefined, { month: "short", year: "numeric" })}
               <button class="linkish ms-ics" type="button" data-label="${esc(m.label)}" data-target="${m.target}" data-eta="${m.eta.toISOString()}"
                 aria-label="Calendar reminder for ${esc(m.label)} reaching ${fmt(m.target)}"><span aria-hidden="true">📅</span></button>`
            : " · on pause"}</div>
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
    `Your personal bests. An <b>action</b> is any single thing Niantic logged — a spin, a catch, a raid, a berry, a gym battle — so ${fmt(total)} actions is the sum of everything you did.`,
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
    inner += `<div class="hw-caption">Niantic counts ${fmt(b.declared)} “items” for you, but that total includes
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
    inner += `<div class="hw-caption">Niantic's export gives coordinates but no stop names, so your stops are ranked rather than named.
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

  inner += `<div class="hw-caption">This log is the short rolling window Niantic attaches to <code>Gameplay.txt</code> — usually the
    last few hours you played, not your whole history. It is also the only place in the entire export where individual
    Pokémon are named and their CP recorded${best ? `, which is how we know ${esc(best.name)} at CP ${fmt(best.cp)} was the best thing you caught that day` : ""}.</div>`;

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
    [P.first ? fmtDate(P.first) : "—", "Oldest photo kept", "the start of Niantic's window"],
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
/* shift an hour-of-week grid by whole hours (UTC → viewer's clock).
 * The offset must stay SIGNED: normalising -7 to +17 gives the right hour but
 * the wrong weekday, because -7 moves an event back a day while +17 moves it
 * forward one. Keep the sign and let floor() decide the day. */
function gridShift(grid, offsetHours) {
  const off = Math.round(offsetHours) % 24;
  if (!off) return grid;
  const mod = (n, m) => ((n % m) + m) % m;
  const out = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) {
    const nh = h + off;
    out[mod(d + Math.floor(nh / 24), 7)][mod(nh, 24)] += grid[d][h];
  }
  return out;
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
  const fill = (cell) => { tip.innerHTML = `<b>${cell.dataset.info}</b><span>${cell.dataset.sub}</span>`; tip.classList.add("on"); };
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
const catchesOf = (k) => (k["GO Plus catches"] || 0) + (k["Encounters"] || 0) + (k["Incense"] || 0) + (k["Lures"] || 0);

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
    award("Most caught", "🎯", (w) => catchesOf(w.kinds)),
  ].filter(Boolean);
  const badgesFor = (y) => awards.filter((a) => a.year === y).map((a) => a.text);

  // versus chart + metric chips
  const METRICS = [
    ["Catches", (w) => catchesOf(w.kinds)],
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
    const k = w.kinds;
    const partial = y === nowYear;
    const badges = badgesFor(y);
    const cells = [
      [fmt(catchesOf(k)), "Pokémon caught"],
      [fmt(k["Spins"] || 0), "PokéStop spins"],
      [fmt(k["Raids"] || 0), "raid lobbies"],
      [fmt(w.remoteRaids), "remote raids"],
      [fmt(w.activeDays), "days played"],
      [fmt(w.streak), "longest streak"],
    ];
    if (w.coinsBought) cells.push([fmt(w.coinsBought), "PokéCoins bought"]);
    if (w.friendsAdded) cells.push([fmt(w.friendsAdded), "friends made"]);
    inner += `<div class="wrap-card" data-year="${y}" style="--wc1:${c1};--wc2:${c2}">
      <div class="wc-kicker">Pokémon GO · Metrics</div>
      <div class="wc-year">${y}${partial ? `<span class="wc-sofar">so far</span>` : ""}</div>
      ${badges.length ? `<div class="wc-badges">${badges.map((b) => `<span class="wc-badge">${b}</span>`).join("")}</div>` : ""}
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
        events: fmt(w.events), badges: badgesFor(y),
        peakLabel: w.peakMonth ? `${fmtMonth(w.peakMonth)} was the biggest month` : "",
        stats: [
          [fmt(catchesOf(w.kinds)), "Pokémon caught"], [fmt(w.kinds["Spins"] || 0), "PokéStop spins"],
          [fmt(w.kinds["Raids"] || 0), "raid lobbies"], [fmt(w.remoteRaids), "remote raids"],
          [fmt(w.activeDays), "days played"], [fmt(w.streak), "longest streak"],
          ...(w.coinsBought ? [[fmt(w.coinsBought), "PokéCoins bought"]] : []),
          ...(w.friendsAdded ? [[fmt(w.friendsAdded), "friends made"]] : []),
        ],
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
    ["Pokémon caught", (w) => catchesOf(w.kinds)],
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
     * +40% on 100k→140k catches; the paired bars restore the scale */
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
    <div class="hw-caption"><b>Read the percentages with care.</b> Niantic's export only reaches back a few years, so
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
  const W = 1080, H = 1500, S = 2;
  const cv = document.createElement("canvas");
  cv.width = W * S; cv.height = H * S;
  const ctx = cv.getContext("2d");
  ctx.scale(S, S);
  const orig = btn && btn.textContent;
  if (btn) { btn.textContent = "Rendering…"; btn.disabled = true; }
  try { await document.fonts.ready; } catch (e) { /* fonts may already be ready */ }

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

  // badges (wrap, centered)
  let by = 318;
  if (o.badges && o.badges.length) {
    ctx.font = "700 23px 'Outfit', sans-serif";
    const PADX = 18, GAP = 12, BH = 46, maxW = W - 120;
    const items = o.badges.map((t) => ({ t, w: ctx.measureText(t).width + PADX * 2 }));
    const rows = [[]]; let rw = 0;
    items.forEach((it) => {
      if (rw + it.w + GAP > maxW && rows[rows.length - 1].length) { rows.push([]); rw = 0; }
      rows[rows.length - 1].push(it); rw += it.w + GAP;
    });
    rows.forEach((row) => {
      const tot = row.reduce((a, it) => a + it.w, 0) + GAP * (row.length - 1);
      let x = (W - tot) / 2;
      row.forEach((it) => {
        ctx.fillStyle = "rgba(255,255,255,.07)";
        roundRectPath(ctx, x, by, it.w, BH, BH / 2); ctx.fill();
        ctx.strokeStyle = "rgba(255,255,255,.18)"; ctx.lineWidth = 1.5;
        roundRectPath(ctx, x, by, it.w, BH, BH / 2); ctx.stroke();
        ctx.fillStyle = "#e8eaf6"; ctx.textBaseline = "middle";
        ctx.fillText(it.t, x + it.w / 2, by + BH / 2 + 1);
        ctx.textBaseline = "alphabetic";
        x += it.w + GAP;
      });
      by += BH + 12;
    });
  }

  /* Legend layout, measured BEFORE the vertical centring below so the card can
   * make room for it. The mini chart is a stacked bar per month in the series
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

  // headline number — centre the remaining content between the badges and the
  // footer so short cards (no badges, fewer stat tiles) don't leave a dead gap
  const gRows = Math.ceil(o.stats.length / 2);
  const hy0 = Math.max(by + 60, 470);
  const gridEnd0 = hy0 + 250 + 96 + legendH + gRows * 124 - 20;
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
    <div class="es-emoji">🌍</div>
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
      if (_webglOK()) await ensureScript("vendor/globe.gl.min.js");
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
  return moduleHTML("📍", "Where you played", `Your world map, built from ${bits.join(" and ")}. Drawn entirely on your device — no map tiles are fetched from anyone else.`, inner);
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
    return { lat, lng, count, kind, m: e.geoFirst.get(key) };
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
    return { slat, slng, elat, elng, count, km: e.raidMaxKm ? Math.min(km, e.raidMaxKm) : km, m: e.arcFirst.get(key) };
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

  const html = `<div class="module globe-module">
    <div class="mod-head"><span class="mod-icon">🌍</span><h3>Your world in 3D</h3></div>
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
        <button id="${P}shot" class="gh-btn" type="button"><span aria-hidden="true">📷</span> Save image</button>
        ${REDUCED_MOTION ? "" : `<button id="${P}replay" class="gh-btn" type="button"><span aria-hidden="true">▶</span> Replay my journey</button>`}
      </details>
      <div id="${P}legend" class="globe-hud globe-legend"></div>
      <div id="${P}country" class="globe-hud globe-country" hidden></div>
      <button id="${P}fs" class="gh-btn globe-fs" type="button" aria-label="View the globe full screen">⛶ Full screen</button>
    </div>
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
     * out (the LA basin, Vegas, Phoenix speckle goes soft), at 2560 nearly all
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
  world.renderer().domElement.addEventListener("pointerdown", () => { controls.autoRotate = false; });
  world.renderer().domElement.addEventListener("pointerup", () => { controls.autoRotate = $$("ly-rotate").checked; });

  // On touch screens the globe would otherwise swallow every swipe — a scroll
  // trap on a long results page. Gate interaction behind one explicit tap.
  const stage = el.closest(".globe-stage");
  let scrim = null;
  if (coarse && stage) {
    controls.enabled = false;
    scrim = document.createElement("button");
    scrim.type = "button";
    scrim.className = "globe-scrim";
    scrim.textContent = "👆 Tap to explore the globe";
    stage.appendChild(scrim);
    scrim.addEventListener("click", () => { controls.enabled = true; scrim.hidden = true; });
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
        // let the fullscreen layout settle, then resize the WebGL canvas to it
        setTimeout(() => { if (GLOBE === world && el.isConnected) world.width(el.clientWidth).height(el.clientHeight || 560); }, 80);
      };
      document.addEventListener("fullscreenchange", onFs);
      GLOBE_CLEANUP.push(() => document.removeEventListener("fullscreenchange", onFs));
    }
  }


  // don't burn GPU on a globe nobody is looking at
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver(([en]) => {
      if (GLOBE !== world) return;
      if (en.isIntersecting) world.resumeAnimation();
      else {
        world.pauseAnimation();
        if (scrim) { controls.enabled = false; scrim.hidden = false; } // re-arm the tap gate
      }
    }, { threshold: 0.05 });
    io.observe(el);
    GLOBE_CLEANUP.push(() => io.disconnect());
  }

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
    world.labelsData($$("ly-labels").checked ? countryLabels : [])
      .labelLat("lat").labelLng("lng").labelText((d) => d.name)
      .labelSize((d) => d.size).labelDotRadius(0).labelIncludeDot(false)
      .labelColor((d) => d.color).labelResolution(2).labelAltitude(0.006);

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

  // toggles + arc slider
  $$("ly-points").onchange = (ev) => world.pointsData(ev.target.checked ? points : []);
  const updateArcs = () => world.arcsData($$("ly-arcs").checked ? arcs.filter((a) => a.km <= arcMax + 0.5) : []);
  $$("ly-arcs").onchange = (ev) => { updateArcs(); $$("arc-ctl").classList.toggle("disabled", !ev.target.checked); };
  $$("ly-trail").onchange = (ev) => world.pathsData(ev.target.checked ? paths : []);
  $$("ly-borders").onchange = (ev) => world.polygonsData(ev.target.checked ? borderFeatures : []);
  $$("ly-labels").onchange = (ev) => world.labelsData(ev.target.checked ? countryLabels : []);
  $$("ly-rotate").onchange = (ev) => { controls.autoRotate = ev.target.checked; };
  $$("shot").onclick = () => screenshotGlobe(world, $$("shot"));
  if (!arcs.length) $$("arc-ctl").classList.add("disabled");
  const arcDist = $$("arc-dist");
  arcDist.oninput = () => {
    arcMax = +arcDist.value / 100 * maxArcKm;
    $$("arc-lbl").textContent = +arcDist.value >= 100 ? "all distances" : "≤ " + fmt(Math.round(arcMax)) + " km";
    updateArcs();
  };

  /* ── chronological replay: months accumulate onto the globe under a date
     ticker — the "six years in thirty seconds" moment. Data was tagged with
     first-seen months at parse; the trail is already day-keyed. Restores the
     layer toggles' truth when done. Not offered under reduced motion. ── */
  const rp = $$("replay");
  if (rp) {
    const months = [...new Set([
      ...points.map((pt) => pt.m), ...arcs.map((a) => a.m),
      ...paths.map((pa) => pa.date.slice(0, 7)),
    ].filter(Boolean))].sort();
    if (months.length < 2) rp.style.display = "none";
    else rp.onclick = () => {
      if (rp.disabled) return;
      rp.disabled = true;
      const stage = el.closest(".globe-stage");
      const tick = document.createElement("div");
      tick.className = "globe-ticker";
      stage.appendChild(tick);
      const dwell = Math.max(220, Math.min(650, 26000 / months.length));
      let i = 0;
      const step = () => {
        if (GLOBE !== world || !el.isConnected) { tick.remove(); return; }   // torn down mid-replay
        const cur = months[i];
        tick.textContent = fmtMonth(cur);
        world.pointsData($$("ly-points").checked ? points.filter((pt) => !pt.m || pt.m <= cur) : []);
        world.arcsData($$("ly-arcs").checked ? arcs.filter((a) => (!a.m || a.m <= cur) && a.km <= arcMax + 0.5) : []);
        world.pathsData($$("ly-trail").checked ? paths.filter((pa) => pa.date.slice(0, 7) <= cur) : []);
        i++;
        if (i < months.length) setTimeout(step, dwell);
        else setTimeout(() => {
          tick.remove();
          world.pointsData($$("ly-points").checked ? points : []);
          updateArcs();
          world.pathsData($$("ly-trail").checked ? paths : []);
          rp.disabled = false;
        }, 1100);
      };
      step();
    };
  }

  const onResize = () => { if (GLOBE === world && el.isConnected) world.width(el.clientWidth).height(el.clientHeight || 560); };
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
/* download the current globe frame as a PNG (canvas has preserveDrawingBuffer) */
function screenshotGlobe(world, btn) {
  const r = world.renderer && world.renderer();
  if (!r) return;
  try { if (world.scene && world.camera) r.render(world.scene(), world.camera()); } catch (e) { /* keep retained buffer */ }
  const orig = btn && btn.textContent;
  if (btn) { btn.textContent = "Saving…"; btn.disabled = true; }
  r.domElement.toBlob((blob) => {
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
      [longest + " yr", "Longest friendship", dated[0] ? esc(dated[0].name) : ""],
      [topSrc ? prettySource(topSrc[0]) : "—", "Top way you connect"],
    ];
    if (removed) stats.push([fmt(removed), "Friendships ended", "in Niantic's recent window — already excluded above"]);
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
  if (STATE.party.sent + STATE.party.received) funnel.push([fmt(STATE.party.sent + STATE.party.received), "Party Play invites"]);
  if (funnel.length) inner += `<h4 class="mod-h4">Recent invite activity <span class="muted" style="font-weight:400">(Niantic keeps ~4 months)</span></h4>${calloutRow(funnel)}`;

  if (!sub) sub = "Your recent friend-request and Party Play activity.";
  return moduleHTML("🤝", "Your social world", sub, inner);
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
  const sym = primary ? (CUR_SYM[primary[0]] || primary[0] + " ") : "";
  const stats = [
    [primary ? sym + fmt(round(primary[1].native)) : "—", primary ? "Spent (" + primary[0] + ")" : "Real money"],
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
      inner += `<div class="hw-caption">Xsolla is Niantic's own web store, which sells coins at a bonus the App Store and Google Play don't match —
        ${Math.round(S.vendor.XSOLLA.coins / S.coinsBought * 100)}% of your coins came through it.</div>`;
    }
  }

  /* Two things the ledger records that no chapter ever mentioned: the free
   * daily box (thrown away with the rest of the LPSKU bundles) and the items
   * Niantic hands out as an apology. */
  const extras = [];
  if (S.freeBundles) extras.push([fmt(S.freeBundles), "free daily boxes claimed"]);
  if (S.paidBundles) extras.push([fmt(S.paidBundles), "paid shop bundles"]);
  if (S.granted) extras.push([fmt(S.granted), "gifts from Niantic support"]);
  if (extras.length) {
    inner += `<h4 class="mod-h4">Also in the ledger</h4>${calloutRow(extras)}`;
    const gifts = Object.entries(S.grantedItems).sort((a, b) => b[1] - a[1]).slice(0, 4);
    if (gifts.length) {
      inner += `<div class="hw-caption">"Granted by admin" is Niantic making something right after an outage or a broken raid.
        Yours came to ${gifts.map(([n, q]) => `<b>${fmt(q)}×</b> ${esc(prettyItem(n))}`).join(", ")}.</div>`;
    } else if (S.freeBundles) {
      inner += `<div class="hw-caption">The free daily box counts as a purchase in Niantic's ledger, which is why it shows up here at all.</div>`;
    }
  }

  return moduleHTML("💳", "Your spending story", `Every coin bought and spent${primary ? ` — ${sym}${fmt(round(primary[1].native))} in ${primary[0]} across ${fmt(primary[1].purchases)} purchase${primary[1].purchases === 1 ? "" : "s"}` : ""}.`, inner);
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
 * as "Items in bag": on the reference export it reads 287,859, but 234,182 of
 * those are event-pass POINTS and 36,870 are fusion/crafting resources. The
 * actual bag holds 16,807. Points and resources are counted, but kept out of
 * the bag figure and labelled for what they are. */
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
      // real date labels, not raw ISO tails ("Aug 14", not "08-14")
      labels: days.map((d) => { const t = parseTS(d); return t ? t.toLocaleDateString(undefined, { month: "short", day: "numeric" }) : d; }),
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
  const byCur = {};
  evs.forEach((e) => { if (e.currency) byCur[e.currency] = (byCur[e.currency] || 0) + e.paid; });
  const spendStr = Object.entries(byCur).map(([c, v]) => (CUR_SYM[c] || c + " ") + fmt(round(v))).join(" · ");
  let inner = statGrid([
    [fmt(evs.length), "Ticketed events"],
    [fmt(totalTickets), "Tickets bought"],
    [spendStr || "—", "Spent on tickets"],
  ]);
  inner += `<h4 class="mod-h4">Events you bought into</h4>`;
  inner += rankList(evs.slice(0, 12).map((e) => [e.name + (e.date ? " · " + e.date.getUTCFullYear() : ""), e.tickets]), (v) => v + " 🎟️");
  return moduleHTML("🎟️", "Your live events", `Tickets to ${evs.length} real-world Pokémon GO event${evs.length > 1 ? "s" : ""}.`, inner);
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
  let inner = "";
  if (S.total || I.count) {
    inner += statGrid([
      [fmt(S.total), "App sessions"],
      [fmt(Object.keys(S.devices).length || Object.keys(I.devices).length), "Devices used"],
      countries.length
        ? [fmt(countries.length), "Countries", countries.length === 1 ? countryName(countries[0][0]) : "you've opened the game in"]
        : [fmt(Object.keys(S.cities).length), "Cities seen"],
      [I.count ? (I.first ? I.first.getUTCFullYear() : fmt(I.count)) : "—", I.first ? "First install" : "Installs"],
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
  /* Country is the one piece of geography that needs no GPS file at all, so
   * this survives even when someone uploads nothing but their session log. */
  if (countries.length > 1) {
    inner += `<hr class="mod-divider"><h4 class="mod-h4">Countries you've played in</h4>
      <div class="mod-sub" style="margin-bottom:10px">Niantic stamps each session with a country. No coordinates involved —
      this is the only map in the app that works without a single GPS file.</div>`;
    inner += rankList(countries.map(([cc, n]) => [countryName(cc), n]), (v) => fmt(v) + " sessions");
  }
  inner += renderTravelLog();
  inner += renderSupport();
  const sub = S.total
    ? `${fmt(S.total)} app sessions across your devices and cities. (We never read the IPs or ad-IDs in these files.)`
    : `What Niantic's technical records say about you. (We never read the IPs or ad-IDs in these files.)`;
  return moduleHTML("📱", "Behind the screen", sub, inner);
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
      <b>${fmt(T.tickets)}</b> ticket${T.tickets === 1 ? "" : "s"}${convo} with Niantic${span}.
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
   * export alternates between Phoenix and Buckeye), so a commuter's normal week
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
    <div class="hw-caption">Places come from the login city Niantic records with each session — no coordinates are involved.
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
  // Deliberately last and named for what it is: a rolling log Niantic still
  // holds, not a lifetime nomination count.
  if (W.logged) stats.push([fmt(W.logged), "Submissions on record", "in Niantic's current window"]);
  if (!stats.length) return;
  const hit = W.analyzed && W.created ? Math.round((W.created / W.analyzed) * 100) : null;
  return moduleHTML("🧭", "Your map-making",
    `How much you've given back to the map every trainer plays on.${
      hit != null ? ` <b>${hit}%</b> of the candidates you reviewed went on to become real PokéStops.` : ""}`,
    statGrid(stats));
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
    document.addEventListener("dragover", (e) => e.preventDefault());
    document.addEventListener("dragenter", (e) => {
      if (!dragHasFiles(e)) return;
      dragDepth++;
      dz.classList.add("drag");
    });
    document.addEventListener("dragleave", () => {
      if (--dragDepth <= 0) { dragDepth = 0; dz.classList.remove("drag"); }
    });
    // An aborted drag (Esc mid-drag) fires neither dragleave nor drop
    window.addEventListener("dragend", () => { dragDepth = 0; dz.classList.remove("drag"); });
    document.addEventListener("drop", async (e) => {
      e.preventDefault();
      dragDepth = 0;
      dz.classList.remove("drag");
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
    // Clear means clear: the file queue AND anything already on screen. For a
    // privacy tool, leaving the built dashboard up after "Clear" is a betrayal.
    const title0 = document.title;
    $("clear-btn").addEventListener("click", () => {
      document.title = title0;
      RAW = []; DATA_GEN++; SAMPLE_DATA = false;
      renderDetected();
      clearError();
      teardown();
      const res = $("results");
      res.innerHTML = "";
      res.classList.add("results-hidden");
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
      if (p) p.innerHTML = "Pick files from the unzipped export — one like <code>FriendList.tsv</code>, or all of them";
    }
    // iPhones can't unzip Niantic's password-protected ZIP at all — say so up
    // front, in the dropzone, not only after a failed attempt.
    if (isIOS) {
      const hint = dz.querySelector(".dz-hint");
      if (hint) hint.innerHTML = '.tsv · .csv · .txt · .json — read locally, never uploaded<br>'
        + 'Heads up: the iPhone Files app can\'t open Niantic\'s password-protected ZIP — '
        + '<a href="index.html#request">unzip it on a computer first →</a>';
    }
  }

  // Auto-load the sample export on the dedicated live-example page, or when
  // metrics.html is opened with ?demo=1. Called directly — a setTimeout here
  // gets clamped to a full minute if the page opens in a background tab.
  if (window.DEMO_PAGE || /[?&]demo=1\b/.test(location.search)) loadDemo();
});
