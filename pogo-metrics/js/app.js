/* app.js — POGO Metrics engine.
 *
 * Reads raw Niantic Pokémon GO data-export files entirely in the browser,
 * parses each recognised file, and renders a per-file "story" module. Nothing
 * is uploaded anywhere — every File is read with FileReader/.text() locally.
 *
 * Each uploaded file lights up its own chapter, so a single FriendList.tsv
 * produces just the social module, while a full export produces the lot. */

/* ───────────────────────────── constants ───────────────────────────── */
/* CSS can't reach canvas/WebGL animation, so motion driven from JS checks this too. */
const REDUCED_MOTION = window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const scrollBehavior = () => (REDUCED_MOTION ? "auto" : "smooth");
const C = {
  teal: "#41d8c6", yellow: "#ffcb05", red: "#ff5350", blue: "#3b6cff",
  purple: "#a06bff", pink: "#ff6bb3", orange: "#ff9d42", green: "#5ad469",
  dim: "#9ba1c5", grid: "rgba(255,255,255,.06)",
};
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
};
const eventFor = (iso) => GO_EVENTS[iso] || null;

/* Gameplay.txt mixes real tiered medals with event/collection badges under the
 * same "BADGE_NAME: n" syntax. These families are participation badges whose
 * number is a count, not a Bronze-to-Platinum tier. */
const EVENT_BADGE = /^BADGE_(EVENT|GOFEST|GOTOUR|GO_TOUR|GOWA|SMORES|MINI_COLLECTION|COMMUNITY|SAFARI|CITY|WILD_AREA)/;

/* ───────────────────────────── tiny helpers ───────────────────────────── */
const fmt = (n) => Number(n).toLocaleString("en-US");
const round = (n) => Math.round(n);
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const titleCase = (s) => s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const base = (p) => (p || "").split("/").pop();
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

function parseTS(s) {
  if (!s) return null;
  s = String(s).trim();
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

/* delimited parser: quote-aware for CSV, plain split for TSV */
/* keepCells: attach the raw positional cells to each row. Only the four
 * small-file parsers that fall back to positions when a header is missing or
 * renamed need it. The two parsers that see real volume (Player_Journey at
 * ~446k rows, and the GPS history) never read it, and attaching it there cost
 * ~37 MB of pointer arrays on a real export for nothing. */
function parseRows(text, name, keepCells) {
  const tab = /\.tsv$/i.test(name);
  const delim = tab ? "\t" : ",";
  const lines = text.replace(/^﻿/, "").replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((l) => l.length);
  if (!lines.length) return { header: [], rows: [] };
  const splitLine = tab
    ? (l) => l.split("\t")
    : (l) => {
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
    profile: null, collection: null, medals: [], recentLog: null,
    ev: {
      totals: {}, byMonth: {}, hourweek: Array.from({ length: 7 }, () => Array(24).fill(0)),
      days: new Set(), dayCounts: {}, geo: new Map(), geoKind: new Map(), first: null, last: null,
      stamps: [], forts: new Map(), gyms: new Map(),
      raidTotal: 0, raidRemote: 0, raidMaxKm: 0, raidKmSum: 0, raidWithDist: 0,
      raidArcs: new Map(), raidGymBins: new Map(), remoteRaidsByYear: {},
    },
    trail: [], trailCount: 0, trailStride: 1,
    friends: { rows: [], monthly: {}, sources: {}, initiated: {}, games: {}, unfriendedMonthly: {}, unfriended: 0 },
    invites: { sent: 0, accepted: 0, declined: 0 },
    party: { received: 0, sent: 0 },
    spend: { coinsBought: 0, coinsSpent: 0, purchases: 0, spendEvents: 0, items: {}, cur: {}, vendor: {}, boughtMonthly: {}, spentMonthly: {} },
    fitness: { daily: {} },
    sessions: { monthly: {}, devices: {}, cities: {}, places: {}, total: 0 },
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
  let added = 0;
  for (const f of list) {
    const name = base(f.name);
    const entry = window.catalogFor(name);
    const existing = RAW.findIndex((r) => r.name.toLowerCase() === name.toLowerCase());
    // Too large to read in a browser tab — keep it visible in the list instead
    // of silently vanishing, so the user knows why that chapter is missing.
    if (f.size > 80 * 1024 * 1024) {
      const rec = { name, text: null, entry, oversize: Math.round(f.size / 1024 / 1024) };
      if (existing >= 0) RAW[existing] = rec; else RAW.push(rec);
      added++;
      continue;
    }
    let text;
    try { text = await f.text(); } catch (e) { continue; }
    // Keep the File handle alongside the text. build() drops the text once it
    // has parsed it and re-reads from the handle on a rebuild, so a 40 MB
    // export stops costing ~72 MB of retained UTF-16 for the tab's lifetime.
    const rec = { name, text, entry, file: f };
    if (existing >= 0) RAW[existing] = rec; else RAW.push(rec);
    added++;
  }
  if (!added) showError("Couldn't read those files. Try choosing them again, or pick the folder.");
  renderDetected();
  // On a phone the Build button lands below the fold, so picking files looked
  // like nothing happened. Bring the next step into view and focus it.
  if (RAW.length && $("build-row")) {
    $("build-row").scrollIntoView({ behavior: scrollBehavior(), block: "center" });
    try { $("build-btn").focus({ preventScroll: true }); } catch (e) {}
  }
}

/* Load the bundled, fully-scrubbed demo export so people can see the output
 * without uploading anything of their own. */
async function loadDemo() {
  clearError();
  const btn = $("demo-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Loading demo…"; }
  try {
    const man = await fetch("demo/manifest.json").then((r) => {
      if (!r.ok) throw new Error("manifest.json " + r.status);
      return r.json();
    });
    // All in parallel — HTTP/2 serves the whole sample export in one round trip.
    const files = await Promise.all(man.files.map(async (p) => {
      const r = await fetch("demo/" + p);
      if (!r.ok) throw new Error(p + " " + r.status);
      return new File([await r.text()], p.split("/").pop());
    }));
    RAW = []; DATA_GEN++;
    await ingest(files);
    build();
  } catch (e) {
    console.warn(e);
    showError("Couldn't load the demo dataset (" + (e && e.message ? e.message : "network error") + "). Check your connection and try again — or upload your own files.");
    // On the dedicated demo page there's no upload UI — give a real retry button
    // instead of stranding the visitor on a dead spinner.
    const res = window.DEMO_PAGE && $("results");
    if (res) {
      res.innerHTML = `<div class="empty-state"><div class="es-emoji">📡</div>
        <h3 style="margin:10px 0 6px">The example couldn't load</h3>
        <p>The sample export didn't come through — usually a connection blip.</p></div>`;
      const rb = document.createElement("button");
      rb.className = "btn btn-teal"; rb.type = "button"; rb.style.marginTop = "14px";
      rb.textContent = "↻ Try again";
      rb.onclick = () => { res.innerHTML = `<div class="empty-state"><div class="gl-spin" style="margin:0 auto 14px"></div><p>Building the example…</p></div>`; loadDemo(); };
      res.querySelector(".empty-state").appendChild(rb);
    }
  } finally {
    if (btn) { btn.disabled = false; btn.textContent = "See a live demo"; }
  }
}

function renderDetected() {
  const el = $("detected");
  if (!el) return; // results-only pages (e.g. the live-example page) skip the picker
  const buildRow = $("build-row");
  if (!RAW.length) { el.innerHTML = ""; if (buildRow) buildRow.style.display = "none"; return; }
  const rows = RAW.map((r) => {
    let cls = "unknown", status = "Not recognised", name = r.name, icon = "❓", note = "We don't have a story for this file.";
    if (r.entry) {
      name = r.entry.name; icon = r.entry.icon; note = r.entry.summary;
      if (r.entry.story) { cls = "ok"; status = "Ready"; }
      // "skipped for privacy" and "we have no chapter for this yet" are very
      // different promises — don't tell someone we ignored a harmless file.
      else if (r.entry.sensitivity === "high") { cls = "skip"; status = "Skipped (privacy)"; }
      else { cls = "skip"; status = "No chapter yet"; }
    }
    if (r.oversize) { cls = "skip"; status = `Too large (${r.oversize} MB) — skipped`; }
    return `<div class="file-chip ${cls}">
      <span class="fc-icon">${icon}</span>
      <div class="fc-main"><div class="fc-name">${esc(name)}</div><div class="fc-file">${esc(r.name)} · ${esc(note)}</div></div>
      <span class="fc-status">${esc(status)}</span>
    </div>`;
  }).join("");
  el.innerHTML = `
    <details class="det-files">
      <summary class="det-head">
        <h2>${RAW.length} file${RAW.length > 1 ? "s" : ""} ready</h2>
        <span class="det-toggle">Review files</span>
      </summary>
      <div class="det-list">${rows}</div>
    </details>`;
  if (buildRow) buildRow.style.display = "block";
}

/* ───────────────────────────── routing ───────────────────────────── */
function routeFile(name, text) {
  const n = name.toLowerCase();
  try {
    if (/gameplay\.txt$/i.test(n)) return parseGameplay(text);
    if (PJ_EVENTS.some(([re]) => re.test(n)) || /^(pokestop_spin|sfida_capture|map_pokemon_encounter|join_raid_lobby|gym_battle|feed_pokemon|deploy_pokemon|incense_encounter|lure_encounter)\d*\.csv$/i.test(n)) {
      const hit = PJ_EVENTS.find(([re]) => re.test(n));
      if (hit) return parsePlayerJourney(hit[1], text);
    }
    if (/gameplaylocationhistory\.tsv$/i.test(n)) return parseLocation(text);
    if (/friendlist\.tsv$/i.test(n)) return parseFriends(text);
    if (/recentlyunfriended\.tsv$/i.test(n)) return parseUnfriended(text);
    if (/recentinviteactions\.tsv$/i.test(n)) return parseInvites(text);
    if (/activityinvites(received|sent)\.tsv$/i.test(n)) return parseParty(text, /sent/i.test(n));
    if (/inapppurchases\.tsv$/i.test(n)) return parsePurchases(text);
    if (/fitnessdata\.tsv$/i.test(n)) return parseFitness(text);
    if (/app_sessions\.csv$/i.test(n)) return parseSessions(text);
    if (/app_installs\.csv$/i.test(n)) return parseInstalls(text);
    if (/liveeventregistrationhistory_aspurchaser\.tsv$/i.test(n)) return parseLiveEvents(text);
    if (/wayfarer_player_data\.json$/i.test(n)) return parseWayfarer(text);
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
  STATE.recentLog = { caught: (text.match(/was caught!/g) || []).length, fled: (text.match(/ran away!/g) || []).length };
  markLoaded("Gameplay Summary");
}

function parsePlayerJourney(label, text) {
  const { rows } = parseRows(text, "x.csv");
  const e = STATE.ev;
  let n = 0;
  for (const row of rows) {
    const ts = parseTS(row.Timestamp);
    if (!ts) continue;
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
          const gk = `${glat.toFixed(1)},${glon.toFixed(1)}`;
          e.raidGymBins.set(gk, (e.raidGymBins.get(gk) || 0) + 1);
        }
      }
    }
  }
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

function parseLocation(text) {
  const { header, rows } = parseRows(text, "x.tsv");
  const latKey = header.find((h) => /lat/i.test(h)) || header[1];
  const lonKey = header.find((h) => /lon/i.test(h)) || header[2];
  const tsKey = header.find((h) => /date|time/i.test(h)) || header[0];
  for (const row of rows) {
    const lat = parseFloat(row[latKey]), lon = parseFloat(row[lonKey]);
    const ts = parseTS(row[tsKey]);
    if (!isNaN(lat) && !isNaN(lon) && (lat || lon)) pushTrailPoint({ lat, lon, ts });
  }
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
      S.vendor[vendor] = (S.vendor[vendor] || 0) + amt;
    } else if (typ === "In-game item bought") {
      const item = (row["Item purchased"] || "").trim();
      if (item && !item.startsWith("LPSKU")) {
        const q = parseInt(parseFloat(row["Number of items"]) || 1, 10) || 1;
        S.items[item] = (S.items[item] || 0) + Math.max(q, 1);
      }
    } else if (typ === "Pokecoin spent for in-game item") {
      S.spendEvents++;
      const delta = parseInt(parseFloat(row["Change in pokecoins"]) || 0, 10);
      if (delta < 0) {
        S.coinsSpent += -delta;
        if (ts) S.spentMonthly[monthKey(ts)] = (S.spentMonthly[monthKey(ts)] || 0) + -delta;
      }
    }
  }
  if (S.purchases || S.spendEvents || Object.keys(S.items).length) markLoaded("In-App Purchases");
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

function parseSessions(text) {
  const { rows } = parseRows(text, "x.csv", true);
  const S = STATE.sessions;
  for (const row of rows) {
    const ts = parseTS(row.Event_time || row.__cells[0]);
    if (ts) S.monthly[monthKey(ts)] = (S.monthly[monthKey(ts)] || 0) + 1;
    const dev = ((row.Device_model || "") + "").split("::").pop().trim();
    if (dev) S.devices[dev] = (S.devices[dev] || 0) + 1;
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
  }
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

function parseWayfarer(text) {
  try {
    const j = JSON.parse(text);
    const root = Array.isArray(j) ? (j[0] || {}) : j;
    const profRaw = root.OprProfile;
    const prof = Array.isArray(profRaw) ? (profRaw[0] || null) : profRaw;
    const subs = root.OprSubmissionLog || [];
    const grabNum = (obj, keys) => { for (const k in obj) { if (keys.some((kk) => k.toLowerCase().includes(kk))) { const v = +obj[k]; if (!isNaN(v)) return v; } } return null; };
    STATE.wayfarer = {
      nominations: Array.isArray(subs) ? subs.length : null,
      analyzed: prof ? grabNum(prof, ["analyzed"]) : null,
      created: prof ? grabNum(prof, ["created"]) : null,
    };
    if (STATE.wayfarer.nominations || STATE.wayfarer.analyzed || STATE.wayfarer.created) markLoaded("Wayfarer Contributions");
  } catch (e) { /* ignore malformed */ }
}

/* ───────────────────────────── DOM helpers ───────────────────────────── */
function moduleHTML(icon, title, sub, inner) {
  return `<div class="module">
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
function themeCharts() {
  if (CHART_THEMED || !window.Chart) return;
  CHART_THEMED = true;
  Chart.defaults.color = C.dim;
  Chart.defaults.font.family = "'Outfit', system-ui, sans-serif";
  Chart.defaults.borderColor = C.grid;
  Chart.defaults.plugins.legend.labels.boxWidth = 12;
  Chart.defaults.plugins.legend.labels.boxHeight = 12;
  if (REDUCED_MOTION) Chart.defaults.animation = false;
}

function newChart(id, cfg) {
  const ctx = $(id);
  if (!ctx) return;
  themeCharts();
  cfg.options = cfg.options || {};
  cfg.options.maintainAspectRatio = false;
  // canvases are invisible to assistive tech without an explicit name
  const label = (cfg.options.plugins && cfg.options.plugins.title && cfg.options.plugins.title.text)
    || (cfg.data && cfg.data.datasets && cfg.data.datasets[0] && cfg.data.datasets[0].label) || "Data chart";
  ctx.setAttribute("role", "img");
  ctx.setAttribute("aria-label", label);
  /* The label names the chart but carries none of its data. Put the actual
   * numbers in the canvas fallback slot, which assistive tech reads and sighted
   * users never see — the chart stops being a wall of silent pixels. */
  try {
    const labels = cfg.data && cfg.data.labels;
    const sets = (cfg.data && cfg.data.datasets) || [];
    if (Array.isArray(labels) && labels.length && labels.length <= 60 && sets.length) {
      const lines = sets.map((ds) => {
        const pairs = labels.map((l, i) => `${l}: ${fmt(ds.data[i] ?? 0)}`).join(", ");
        return `${ds.label ? ds.label + " — " : ""}${pairs}`;
      }).join(". ");
      ctx.textContent = `${label}. ${lines}.`;
    }
  } catch (e) { /* a chart without simple labels just keeps its aria-label */ }
  const ch = new Chart(ctx, cfg);
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
  const btn = $("build-btn");
  const btnLabel = btn ? btn.textContent : "";
  if (btn) { btn.disabled = true; btn.textContent = "Building…"; }
  const res = $("results");
  res.classList.remove("results-hidden");
  res.innerHTML = `<div class="empty-state"><div class="gl-spin" style="margin:0 auto 14px"></div>
    <p id="build-progress">Reading your files…</p></div>`;
  try {
    teardown(); // also resets STATE

    // Kick off the libraries this build will need while we parse.
    const libWaits = [ensureScript("vendor/chart.umd.min.js")];

    // Yield between files via MessageChannel, NOT setTimeout — background tabs
    // clamp timers to as little as once per minute, which would turn a 22-file
    // build into a 20-minute crawl if the user switches tabs mid-build.
    const nextTick = () => new Promise((res) => { const mc = new MessageChannel(); mc.port1.onmessage = () => res(); mc.port2.postMessage(0); });
    const prog = $("build-progress");
    const unreadable = [];
    for (const r of RAW) {
      if (r.oversize) continue; // too large to read at all — already flagged in the list
      if (prog) prog.textContent = `Reading ${r.name}…`;
      await nextTick(); // let the progress line paint without timer throttling
      // On a rebuild the text was released after the last build; read it again
      // from the File handle the browser still holds.
      if (stale()) return; // the user cleared while we were reading
      let text = r.text;
      if (text == null && r.file) {
        try { text = await r.file.text(); } catch (e) { unreadable.push(r.name); continue; }
      }
      if (text == null) continue;
      routeFile(r.name, text);
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
    await Promise.all(libWaits.map((p) => p.catch((e) => console.warn(e))));
    if (stale()) return; // cleared while libraries were loading — draw nothing

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
          <h3 style="margin:10px 0 6px">Nothing to visualise yet</h3>
          <p>None of those files had a story we can tell. Try adding files like <code>Gameplay.txt</code>,
          <code>FriendList.tsv</code>, or your <code>Player_Journey</code> folder.</p></div>`;
      res.scrollIntoView({ behavior: scrollBehavior() });
      return;
    }

    res.insertAdjacentHTML("beforeend", resHero());
    // lead with the trainer card → adventure log → year-over-year → world → social → money → body → tech
    safe(renderTrainer);
    safe(renderActivity);
    safe(renderRhythm);
    safe(renderRecords);
    safe(renderYearOverYear);
    safe(renderWorld);
    safe(renderSocial);
    safe(renderSpending);
    safe(renderFitness);
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
        m.id = "ch-" + t.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
        return `<a class="ch-chip" href="#${m.id}">${icon ? icon.textContent + " " : ""}${esc(t)}</a>`;
      }).join("");
      res.querySelector(".res-hero").insertAdjacentHTML("afterend",
        `<nav class="chapter-nav" aria-label="Chapters">${chips}</nav>`);
    }

    res.insertAdjacentHTML("beforeend", outro());

    // wire up post-render bits (charts/maps were referenced by id)
    POST.forEach((fn) => { try { fn(); } catch (e) { console.warn(e); } });
    POST = [];

    wireToolbar();
    wireCountUps(res);
    // The demo page's hero CTA can only work once STATE is populated — enabling
    // it here avoids opening a one-slide story over an empty build.
    const demoCta = $("demo-story-cta");
    if (demoCta) { demoCta.disabled = false; demoCta.onclick = () => storyMode(); }
    // move focus to the story so keyboard/screen-reader users land where the action is
    const hero = res.querySelector(".res-hero h2");
    if (hero) { hero.setAttribute("tabindex", "-1"); try { hero.focus({ preventScroll: true }); } catch (e) {} }
    res.scrollIntoView({ behavior: scrollBehavior() });
  } finally {
    BUILDING = false;
    POST = [];
    if (btn) { btn.disabled = false; btn.textContent = btnLabel; }
  }
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
  // The demo page keeps its header CTAs, so its toolbar carries only the story
  // button; the real app gets the full set.
  const toolbar = window.DEMO_PAGE
    ? `<div class="res-toolbar">
       <button class="btn btn-primary" id="story-btn" type="button">▶ Play my story</button>
     </div>`
    : `<div class="res-toolbar">
       <button class="btn btn-primary" id="story-btn" type="button">▶ Play my story</button>
       <button class="btn btn-teal" id="journey-btn" type="button">⬇ Journey card</button>
       <button class="btn btn-ghost" id="json-btn" type="button">🧾 My numbers</button>
       <button class="btn btn-teal" id="addmore-btn" type="button">＋ Add more files</button>
       <button class="btn btn-ghost" id="restart-btn" type="button">↺ Start over</button>
     </div>`;
  return `<div class="res-hero">
    <div class="eyebrow">${window.DEMO_PAGE ? "Live example · sample data" : "Your Pokémon GO metrics"}</div>
    <h2>${who} journey, visualised</h2>
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
function outro() {
  if (window.DEMO_PAGE) {
    return `<div class="notice" style="margin-top:30px">
      <b>Like what you see?</b> This whole page was built from a sample export — yours would be built
      from your real journey. <a href="metrics.html">Build yours →</a> or
      <a href="index.html#request">request your data from Niantic first</a>.</div>`;
  }
  // tell the player exactly which chapters their remaining files would unlock
  const locked = (window.CATALOG || []).filter((c) =>
    c.story && !RAW.some((r) => c.match.test(r.name))).slice(0, 3);
  const more = locked.length
    ? `<div style="margin-top:10px">${locked.map((c) =>
        `<span class="locked-chip">${c.icon} <code>${esc(c.id)}</code> unlocks <b>${esc(c.name)}</b></span>`).join("")}
      <div style="margin-top:8px"><a href="index.html#datasets">See what every file unlocks →</a></div></div>`
    : "";
  return `<div class="notice" style="margin-top:30px">
    <b>That's your story — for now.</b> Add more files above to unlock new chapters of your journey.${more}</div>`;
}

/* ── story mode: a Wrapped-style, full-screen tappable recap built from STATE ── */
function storySlides() {
  const e = STATE.ev, s = [];
  const total = Object.values(e.totals).reduce((a, b) => a + b, 0);
  const who = (STATE.profile && STATE.profile.username) || (window.DEMO_PAGE ? "AshDemo" : "Trainer");
  const dayKeys = Object.keys(e.dayCounts).sort();
  s.push({ kicker: "POGO METRICS PRESENTS", big: esc(who), label: "this is your story", grad: 0 });
  if (dayKeys.length) {
    const daysSince = Math.round((Date.now() - new Date(dayKeys[0] + "T00:00:00Z")) / 86400000);
    s.push({ kicker: "DAY ONE", big: fmtDate(parseTS(dayKeys[0])), label: `${fmt(daysSince)} days ago, your log begins`, grad: 1 });
  }
  if (total) s.push({ kicker: "SINCE THEN", num: total, label: "actions in the game's log — every spin, catch, raid and battle Niantic wrote down", grad: 2 });
  const catches = catchesOf(e.totals);
  if (catches) s.push({ kicker: "GOTTA CATCH 'EM ALL", num: catches, label: "Pokémon caught in the logs — map, incense, lure and GO Plus catches combined", grad: 3 });
  let bigDay = null, bigN = 0;
  for (const d of dayKeys) if (e.dayCounts[d] > bigN) { bigN = e.dayCounts[d]; bigDay = d; }
  if (bigDay) s.push({ kicker: "YOUR BIGGEST DAY", num: bigN, label: `actions on ${fmtDate(parseTS(bigDay))}${eventFor(bigDay) ? " — " + eventFor(bigDay) : ""}`, grad: 4 });
  // busiest slot in the VIEWER'S clock — "your hour" should feel like their life, not UTC
  const local = gridShift(e.hourweek, -new Date().getTimezoneOffset() / 60);
  let bd = 0, bh = 0, bn = 0;
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) if (local[d][h] > bn) { bn = local[d][h]; bd = d; bh = h; }
  if (bn) s.push({ kicker: "YOUR HOUR", big: `${DAY_FULL[bd]}s, ${hourLabel(bh)}`, label: "when you play the most, in your local time", grad: 5 });
  if (e.geo.size) s.push({ kicker: "YOUR WORLD", num: e.geo.size, label: "places you've played" + (e.raidMaxKm ? ` — raiding ${fmt(round(e.raidMaxKm))} km from home` : ""), grad: 6 });
  const streak = longestStreak(dayKeys);
  if (streak > 1) s.push({ kicker: "DEDICATION", num: streak, label: "days in a row, without missing one", grad: 7 });
  if (STATE.friends.rows.length) s.push({ kicker: "NOT ALONE", num: STATE.friends.rows.length, label: "friends on the journey", grad: 8 });
  if (STATE.spend.coinsBought) s.push({ kicker: "THE WAR CHEST", num: STATE.spend.coinsBought, label: "PokéCoins bought", grad: 9 });
  const km = Object.values(STATE.fitness.daily).reduce((a, d) => a + (d.meters || 0), 0) / 1000;
  if (km > 1) s.push({ kicker: "ON FOOT", num: Math.round(km), label: "kilometres walked with the game open", grad: 10 });
  const years = [...new Set(Object.keys(e.byMonth).map((m) => m.slice(0, 4)))];
  s.push({
    kicker: "AND COUNTING",
    big: years.length ? `${years.length} year${years.length > 1 ? "s" : ""} of adventure` : "Your adventure",
    label: window.DEMO_PAGE ? "this was the sample trainer — imagine yours" : "grab the card, flex the journey",
    grad: 11, finale: true,
  });
  return s;
}

function storyMode() {
  const slides = storySlides();
  if (!slides.length) return;
  // The overlay covers the trigger, but a keyboard user's focus stays on it —
  // a second Enter would otherwise stack a second story on top of the first.
  if (document.querySelector(".story-ov")) return;
  const opener = document.activeElement;
  const GRADS = [[C.teal, C.yellow], [C.blue, C.teal], [C.yellow, C.orange], [C.red, C.pink],
    [C.purple, C.blue], [C.pink, C.purple], [C.green, C.teal], [C.orange, C.red],
    [C.teal, C.purple], [C.yellow, C.green], [C.blue, C.pink], [C.teal, C.yellow]];
  const ov = document.createElement("div");
  ov.className = "story-ov";
  ov.setAttribute("role", "dialog");
  ov.setAttribute("aria-modal", "true");
  ov.setAttribute("aria-label", "Your story, chapter by chapter");
  ov.innerHTML = `
    <div class="story-prog" aria-hidden="true">${slides.map(() => "<i></i>").join("")}</div>
    <button class="story-x" type="button" aria-label="Close story">×</button>
    <div class="story-stage"></div>
    <div class="story-live sr-only" role="status" aria-live="polite"></div>
    <div class="story-hint">${window.matchMedia && window.matchMedia("(pointer: coarse)").matches
      ? "tap the right side for next · left side to go back"
      : "tap right for next · left for back · Esc to close"}</div>`;
  document.body.appendChild(ov);
  document.body.style.overflow = "hidden";
  // A fixed opaque overlay isn't a modal on its own — without this, Tab walks
  // straight out to the nav and footer behind the story.
  const inerted = [...document.body.children].filter((el) => el !== ov && !el.inert);
  inerted.forEach((el) => (el.inert = true));
  const stage = ov.querySelector(".story-stage");
  let idx = -1, closed = false, raf = null;
  const close = () => {
    if (closed) return;
    closed = true;
    if (raf) cancelAnimationFrame(raf);
    document.body.style.overflow = "";
    document.removeEventListener("keydown", onKey);
    inerted.forEach((el) => (el.inert = false));
    ov.remove();
    if (opener && opener.isConnected) try { opener.focus(); } catch (e) {}
  };
  const render = (i) => {
    idx = Math.max(0, Math.min(slides.length - 1, i));
    const sl = slides[idx];
    const [g1, g2] = GRADS[sl.grad % GRADS.length];
    ov.style.background = `radial-gradient(120% 90% at 18% 0%, ${g1}36, transparent 60%),` +
      `radial-gradient(120% 90% at 85% 100%, ${g2}30, transparent 60%), #0a0d1c`;
    const finale = !sl.finale ? "" : `<div class="story-cta">
      ${window.DEMO_PAGE
        ? `<a class="btn btn-primary" href="metrics.html">Build my own story</a>`
        : (Object.keys(STATE.ev.dayCounts).length ? `<button class="btn btn-primary" id="story-journey" type="button">⬇ My journey card</button>` : "")}
      <button class="btn btn-ghost" id="story-back" type="button">Back to my dashboard</button></div>`;
    stage.innerHTML = `<div class="story-slide">
      <div class="story-kicker">${sl.kicker}</div>
      ${sl.num != null ? `<div class="story-big mono" data-n="${sl.num}">${REDUCED_MOTION ? fmt(sl.num) : "0"}</div>` : `<div class="story-big">${sl.big}</div>`}
      <div class="story-label">${sl.label}</div>
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
    [...ov.querySelectorAll(".story-prog i")].forEach((el, j) => (el.className = j < idx ? "done" : j === idx ? "cur" : ""));
    // announce each slide — otherwise the whole story is silent to screen readers
    const live = ov.querySelector(".story-live");
    if (live) live.textContent = `Slide ${idx + 1} of ${slides.length}. ${sl.kicker}. ${sl.num != null ? fmt(sl.num) : sl.big}. ${sl.label}`;
    const jb = stage.querySelector("#story-journey");
    if (jb) jb.onclick = () => downloadJourneyCard(jb);
    const bb = stage.querySelector("#story-back");
    if (bb) bb.onclick = close;
  };
  ov.addEventListener("click", (ev2) => {
    if (ev2.target.closest(".story-x")) return close();
    if (ev2.target.closest("button, a")) return;
    if (ev2.clientX < window.innerWidth * 0.3) render(idx - 1);
    else if (idx >= slides.length - 1) close();
    else render(idx + 1);
  });
  const onKey = (ev2) => {
    if (ev2.key === "Escape") close();
    else if (ev2.key === "ArrowLeft") render(idx - 1);
    else if (ev2.key === "ArrowRight" || ev2.key === " ") { ev2.preventDefault(); idx >= slides.length - 1 ? close() : render(idx + 1); }
  };
  document.addEventListener("keydown", onKey);
  render(0);
  // pull focus into the dialog so keyboard users are inside the story, not behind it
  try { ov.querySelector(".story-x").focus(); } catch (e) {}
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
    // cities/places are location history — excluded to keep the note above true
    sessions: { total: STATE.sessions.total, monthly: STATE.sessions.monthly, devices: STATE.sessions.devices },
    installs: STATE.installs,
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
    [fmt(p.totalItems || 0), "Items in bag"],
    [fmt(p.medalCount || STATE.medals.length || 0), "Medals earned"],
  ];
  let inner = statGrid(stats);

  if (col && Object.keys(col.genCounts).length) {
    inner += `<div class="split" style="margin-top:18px">
      <div><div style="font-weight:700;margin-bottom:10px">Storage by region of origin</div><div class="gen-bars">${
        Object.entries(col.genCounts).map(([region, g]) => `
          <div class="gen-row"><span class="gname">${esc(region)}</span>
          <div class="gen-bar-track"><div class="gen-bar-fill" style="width:${Math.min(100, g.unique / g.dexSize * 100).toFixed(0)}%"></div></div>
          <span class="gval">${g.unique}/${g.dexSize} · ${fmt(g.total)}</span></div>`).join("")
      }</div></div>
      <div><div style="font-weight:700;margin-bottom:10px">Most-hoarded species</div>${rankList(col.topSpecies)}</div>
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
    inner += `<div style="margin-top:20px;font-weight:700">Medal cabinet</div>
      <div class="mod-sub">${reconcile}</div>
      <div class="medal-cards">${cards}</div>`;
    if (tiers[4] >= 50) {
      inner += `<div class="hw-caption">🏆 <b>${fmt(tiers[4])} Platinum</b> — level 80 requires 50 Platinum medals, so you've cleared that bar.</div>`;
    }
  }

  const subtitle = `Your lifetime trainer card${p.startYear ? `, playing since ${p.startYear}` : ""}${p.buddy ? ` · buddy ${esc(p.buddy)}` : ""}.`;
  return moduleHTML("🎮", (p.username ? esc(p.username) : "Your trainer") + " at a glance", subtitle, inner);
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

  // Visualisations lead the chapter; the data cards sit below them, after a divider.
  const cMonthly = uid(), cDonut = uid(), cClock = uid();
  const tzOff = -new Date().getTimezoneOffset() / 60;
  const tzLbl = "UTC" + (tzOff >= 0 ? "+" : "") + (Math.round(tzOff * 10) / 10);
  let inner = `<div>${chartWrap(cMonthly, "tall")}</div>`;
  inner += `<div class="split" style="margin-top:16px">
    <div>${chartWrap(cDonut)}</div>
    <div>${chartWrap(cClock)}</div>
  </div>`;
  inner += `<div style="margin-top:22px">
    <div style="font-weight:700;margin-bottom:6px">When you play — hour of week</div>
    ${tzOff !== 0 ? `<div class="yoy-metrics" style="margin:0 0 10px" id="tz-${cMonthly}">
      <button class="yoy-chip active" type="button" aria-pressed="true" data-off="${tzOff}">Your time (${tzLbl})</button>
      <button class="yoy-chip" type="button" aria-pressed="false" data-off="0">Game time (UTC)</button>
    </div>` : ""}
    <div id="hw-${cMonthly}"></div>
  </div>`;
  inner += `<div style="margin-top:22px">
    <div style="font-weight:700;margin-bottom:10px">Every day you played</div>
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
          label, backgroundColor: SERIES_COLORS[label] || C.dim, stack: "a", borderRadius: 2,
          data: months.map((mk) => (e.byMonth[mk] || {})[label] || 0),
        })),
      },
      options: {
        interaction: { mode: "index", intersect: false },
        plugins: { title: { display: true, text: "Your activity, month by month" } },
        scales: { x: { stacked: true, grid: { display: false }, ticks: { maxTicksLimit: 16 } }, y: { stacked: true, title: { display: true, text: "events" } } },
      },
    });
    // breakdown donut
    newChart(cDonut, {
      type: "doughnut",
      data: { labels: series, datasets: [{ data: series.map((s) => e.totals[s]), backgroundColor: series.map((s) => SERIES_COLORS[s] || C.dim), borderWidth: 0 }] },
      options: { cutout: "60%", plugins: { legend: { position: "right" }, title: { display: true, text: "What you did most" } } },
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
          datasets: [{ data: byHour, backgroundColor: byHour.map((v) => `rgba(65,216,198,${(0.15 + 0.75 * v / Math.max(1, ...byHour)).toFixed(2)})`), borderWidth: 0 }],
        },
        options: {
          plugins: { legend: { display: false }, title: { display: true, text: "Your play clock — events by hour" } },
          scales: { r: { ticks: { display: false }, grid: { color: C.grid } } },
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

  const inner = statGrid(stats.slice(0, 8));
  return moduleHTML("🏅", "Your record book",
    `Your personal bests. An <b>action</b> is any single thing Niantic logged — a spin, a catch, a raid, a berry, a gym battle — so ${fmt(total)} actions is the sum of everything you did.`,
    inner);
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

/* ── "your rhythm": how you actually played, not just how much ── */
function renderRhythm() {
  const e = STATE.ev;
  const b = buildBouts(e.stamps);
  const topFort = [...e.forts.values()].sort((x, y) => y.n - x.n)[0];
  // Both halves can be absent (one tiny Player_Journey file yields no measurable
  // sessions and no repeat stop) — don't emit a chapter heading with no body.
  if (!b && !(topFort && topFort.n > 1)) return;

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
      data: { labels: buckets.map((x) => x[2]), datasets: [{ data: counts, label: "sessions", backgroundColor: C.teal, borderRadius: 6 }] },
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
    inner += `<hr class="mod-divider"><div style="font-weight:700;margin-bottom:2px">Your regular haunts</div>
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

  return moduleHTML("⏱️", "Your rhythm", "How you actually play — in sessions, and in the places you keep returning to.", inner);
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
function renderHourWeek(host, grid) {
  if (!host) return;
  const max = Math.max(1, ...grid.flat());
  let html = `<div class="hw-grid">`;
  for (let d = 0; d < 7; d++) {
    html += `<div class="hw-row"><span class="hw-lbl">${DAYS[d]}</span>`;
    for (let h = 0; h < 24; h++) {
      const n = grid[d][h];
      const t = n / max;
      const bg = n === 0 ? "rgba(255,255,255,.04)" : `rgba(65,216,198,${(0.14 + t * 0.86).toFixed(2)})`;
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
  if (bn) html += `<div class="hw-caption">Busiest: <b>${DAY_FULL[bd]} around ${hourLabel(bh)}</b> — ${fmt(bn)} events. Tap any cell for its count.</div>`;
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
  const show = (ev) => {
    const cell = ev.target.closest("[data-info]");
    if (!cell) { tip.classList.remove("on"); return; }
    tip.innerHTML = `<b>${cell.dataset.info}</b><span>${cell.dataset.sub}</span>`;
    tip.classList.add("on");
    const pad = 14, r = tip.getBoundingClientRect();
    let x = ev.clientX + pad, y = ev.clientY + pad;
    if (x + r.width > window.innerWidth - 8) x = ev.clientX - r.width - pad;
    if (y + r.height > window.innerHeight - 8) y = ev.clientY - r.height - pad;
    tip.style.left = x + "px";
    tip.style.top = y + "px";
  };
  gridEl.addEventListener("mousemove", show);
  gridEl.addEventListener("mouseleave", () => tip.classList.remove("on"));
  gridEl.addEventListener("click", show); // tap support on touch screens
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
  while (d.getUTCFullYear() === +year) {
    const iso = d.toISOString().slice(0, 10);
    const n = dayCounts[iso] || 0;
    const ev = eventFor(iso);
    const bg = n === 0 ? "rgba(255,255,255,.045)" : `rgba(65,216,198,${(0.18 + 0.82 * n / yearMax).toFixed(2)})`;
    cells += `<div class="cal-cell${ev && n ? " ev" : ""}" style="background:${bg}" data-info="${fmtDate(d)}${ev ? " · " + esc(ev) : ""}" data-sub="${n ? fmt(n) + " event" + (n > 1 ? "s" : "") : "no play logged"}"></div>`;
    d.setUTCDate(d.getUTCDate() + 1);
  }
  const played = Object.keys(dayCounts).filter((k) => k.startsWith(year)).length;
  const evDays = Object.keys(dayCounts).filter((k) => k.startsWith(year) && eventFor(k)).length;
  host.innerHTML = `<div class="cal-grid">${cells}</div>
    <div class="hw-caption">${fmt(played)} days played in ${year}${evDays ? ` — including <b>${evDays} GO Fest day${evDays > 1 ? "s" : ""}</b> (gold ring)` : ""}. Tap a day for details.</div>`;
  attachHourWeekTip(host);
}

/* ── year over year (multi-year journeys) ── */
const MON1 = ["J", "F", "M", "A", "M", "J", "J", "A", "S", "O", "N", "D"];
const YEAR_COLORS = {
  2022: [C.green, C.teal], 2023: [C.red, C.yellow], 2024: [C.blue, C.teal],
  2025: [C.purple, C.pink], 2026: [C.teal, C.green], 2027: [C.orange, C.yellow],
};
const yearColors = (y) => YEAR_COLORS[+y] || [C.teal, C.yellow];
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
      monthLabels: yMonths.map((m) => MON1[+m.slice(5) - 1]),
      monthlyStacks: yMonths.map((m) => seriesKeys.map((lab) => [SERIES_COLORS[lab], byMonth[m][lab] || 0])),
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
  inner += `<div style="font-weight:700;margin-bottom:2px">Your year card${multi ? "s" : ""}</div>
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
      <button class="btn btn-teal wc-dl" type="button">⬇ Download ${y} card (PNG)</button>
      <div class="wc-foot">POGO Metrics · ${y}</div>
    </div>`;
  });
  inner += `</div>`;

  later(() => {
    if (multi) {
      // versus bar chart, one bar per year, toggled by metric
      const ch = newChart(cId, {
        type: "bar",
        data: { labels: years, datasets: [{ data: [], label: METRICS[0][0], backgroundColor: years.map((y) => yearColors(y)[0]), borderRadius: 6 }] },
        options: {
          plugins: { legend: { display: false }, title: { display: true, text: "Year vs year — " + METRICS[0][0] } },
          scales: { x: { grid: { display: false }, ticks: { font: { size: 14, weight: 700 } } }, y: { beginAtZero: true } },
        },
      });
      const renderVs = (i) => {
        const [label, fn] = METRICS[i];
        ch.data.datasets[0].data = years.map((y) => fn(data[y]));
        ch.data.datasets[0].label = label;
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
        monthLabels: w.monthLabels, monthlyStacks: w.monthlyStacks,
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
    return `<div class="tvn-row">
      <span class="tvn-l">${esc(label)}</span>
      <span class="tvn-a mono">${fmt(a)}</span>
      <span class="tvn-arrow ${dir}">${arrow}</span>
      <span class="tvn-b mono">${fmt(b)}</span>
      <span class="tvn-d ${dir}">${pct === null ? "new" : (pct > 0 ? "+" : "") + pct + "%"}</span>
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
        label: k, backgroundColor: SERIES_COLORS[k], stack: "mix", borderRadius: 2,
        data: [share(A, k), share(B, k)],
      })),
    },
    options: {
      indexAxis: "y",
      plugins: {
        title: { display: true, text: "What your play is made of (share of each year)" },
        tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.raw.toFixed(1)}%` } },
      },
      scales: { x: { stacked: true, max: 100, title: { display: true, text: "% of that year's actions" } }, y: { stacked: true, grid: { display: false } } },
    },
  }));

  return `<hr class="mod-divider"><div style="font-weight:700;margin-bottom:2px">Then vs now — ${first} against ${last}</div>
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
  ctx.fillStyle = "#0a0d1c"; ctx.fillRect(0, 0, W, H);
  let g = ctx.createRadialGradient(170, 150, 0, 170, 150, 720);
  g.addColorStop(0, o.c1 + "66"); g.addColorStop(1, "#0a0d1c00");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  g = ctx.createRadialGradient(W - 150, H - 180, 0, W - 150, H - 180, 780);
  g.addColorStop(0, o.c2 + "4d"); g.addColorStop(1, "#0a0d1c00");
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);
  ctx.strokeStyle = "rgba(255,255,255,.10)"; ctx.lineWidth = 2;
  roundRectPath(ctx, 12, 12, W - 24, H - 24, 28); ctx.stroke();

  ctx.textAlign = "center";
  ctx.fillStyle = "#9ba1c5"; ctx.font = "600 22px 'JetBrains Mono', monospace";
  ctx.letterSpacing = "6px";
  ctx.fillText("POKÉMON GO · METRICS", W / 2, 86);
  ctx.letterSpacing = "0px";
  ctx.font = o.titleFont || "800 150px 'Outfit', sans-serif";
  const yg = ctx.createLinearGradient(W / 2 - 220, 0, W / 2 + 220, 0);
  yg.addColorStop(0, o.c1); yg.addColorStop(1, o.c2);
  ctx.fillStyle = yg; ctx.fillText(o.year, W / 2, 232);
  if (o.partial) {
    ctx.fillStyle = "#9ba1c5"; ctx.font = "500 26px 'Outfit', sans-serif";
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

  // headline number — centre the remaining content between the badges and the
  // footer so short cards (no badges, fewer stat tiles) don't leave a dead gap
  const gRows = Math.ceil(o.stats.length / 2);
  const hy0 = Math.max(by + 60, 470);
  const gridEnd0 = hy0 + 250 + 96 + gRows * 124 - 20;
  const off = Math.max(0, Math.floor((H - 86 - gridEnd0) / 2));
  const hy = hy0 + off;
  ctx.fillStyle = "#fff"; ctx.font = "700 92px 'JetBrains Mono', monospace";
  ctx.fillText(o.events, W / 2, hy);
  ctx.fillStyle = "#9ba1c5"; ctx.font = "500 26px 'Outfit', sans-serif";
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
    ctx.fillStyle = "#6b76a8"; ctx.font = "500 17px 'Outfit', sans-serif";
    ctx.fillText(o.monthLabels[i] || "", x + barW / 2, cBot + 24);
  });
  if (o.peakLabel) {
    ctx.fillStyle = "#9ba1c5"; ctx.font = "500 20px 'Outfit', sans-serif";
    ctx.fillText("Month by month — " + o.peakLabel, W / 2, cBot + 56);
  }

  // stat grid, two columns
  const gy = cBot + 96, gx = 90, gGap = 20;
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
    ctx.fillStyle = "#9ba1c5"; ctx.font = "500 20px 'Outfit', sans-serif";
    ctx.fillText(l, x + 22, y + 84);
  });
  ctx.textAlign = "center";

  // footer — wordmark plus the site URL, so a card shared anywhere points home
  ctx.fillStyle = "#848ab0"; ctx.font = "600 18px 'JetBrains Mono', monospace";
  ctx.letterSpacing = "3px";
  ctx.fillText(("POGO METRICS · " + o.year).toUpperCase(), W / 2, H - 62);
  ctx.fillStyle = "#6b76a8"; ctx.font = "500 15px 'JetBrains Mono', monospace";
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
  return; // map libraries failed to load (offline?) — skip rather than crash
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
    return { lat, lng, count, kind };
  });
  if (!points.length && !STATE.trail.length) return renderFlatMap();
  const maxCount = Math.max(1, ...points.map((p) => p.count));
  const arcs = [...e.raidArcs.entries()].sort((a, b) => b[1] - a[1]).slice(0, 600).map(([key, count]) => {
    const [slat, slng, elat, elng] = key.split(",").map(Number);
    return { slat, slng, elat, elng, count, km: haversine(slat, slng, elat, elng) };
  });
  let home = null, hc = -1;
  for (const [key, c] of e.geo) { if (c > hc) { hc = c; const [la, lo] = key.split(",").map(Number); home = { lat: la, lng: lo }; } }
  if (!home) home = { lat: points[0] ? points[0].lat : 20, lng: points[0] ? points[0].lng : 0 };
  const paths = buildTrailPaths();

  const subBits = [];
  if (points.length) subBits.push(`${fmt(points.length)} activity hotspots`);
  if (arcs.length) subBits.push(`${fmt(e.raidRemote)} remote-raid arcs`);
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
        <button id="${P}shot" class="gh-btn" type="button">📷 Save image</button>
      </details>
      <div id="${P}legend" class="globe-hud globe-legend"></div>
      <div id="${P}country" class="globe-hud globe-country" hidden></div>
      <button id="${P}fs" class="gh-btn globe-fs" type="button" aria-label="View the globe full screen">⛶ Full screen</button>
    </div>
    </div>
    <div id="${P}below" class="globe-below"></div>
  </div>`;

  later(() => { try { initGlobe({ P, points, maxCount, arcs, home, paths }); } catch (err) { console.warn("globe init failed", err); } });
  return html;
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
    .globeImageUrl("vendor/img/earth-night.jpg")
    .bumpImageUrl("vendor/img/earth-topology.png")
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
        ${empire.length ? `<div><div style="font-weight:700;margin-bottom:10px">🌐 Your remote-raid empire</div>${rankList(empire.slice(0, 10).map(([n, r]) => [n, r.raids]))}</div>` : "<div></div>"}
        ${topArcs.length ? `<div><div style="font-weight:700;margin-bottom:10px">🚀 Longest hauls</div>${calloutRow(topArcs.map((a) => [fmt(round(a.km)) + " km", a._country && a._country !== "Open water" ? "to " + a._country : "to a far-off gym"]))}</div>` : "<div></div>"}
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
          { label: "Friends added", backgroundColor: C.teal, stack: "f", borderRadius: 2, data: months.map((m) => F.monthly[m] || 0) },
          { label: "Unfriended", backgroundColor: C.red, stack: "f", borderRadius: 2, data: months.map((m) => -(F.unfriendedMonthly[m] || 0)) },
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
      <div><div style="font-weight:700;margin-bottom:10px">Your oldest friendships</div>${rankList(oldest, (days) => (days / 365.25).toFixed(1) + " yr")}</div>
      <div><div style="font-weight:700;margin-bottom:10px">How you connect</div>${rankList(srcList.slice(0, 6))}
        ${gameList.length ? `<div style="font-weight:700;margin:16px 0 10px">Games you share</div>${rankList(gameList)}` : ""}</div>
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
      inner += `<hr class="mod-divider"><div style="font-weight:700;margin-bottom:2px">How your circle grew</div>`;
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
    inner += `<hr class="mod-divider"><div style="font-weight:700;margin-bottom:2px">Friendship tenure</div>
      <div class="mod-sub" style="margin-bottom:10px">Your oldest friendship: <b>${esc(oldest.name)}</b>, going strong for
      <b>${yearsOf(oldest).toFixed(1)} years</b> (since ${fmtDate(oldest.ts)}).</div>
      <div>${chartWrap(cTenure)}</div>`;
    later(() => newChart(cTenure, {
      type: "bar",
      data: {
        labels: bLabels.map((y) => (y === 0 ? "< 1 yr" : y + "–" + (y + 1) + " yrs")),
        datasets: [{ data: bLabels.map((y) => buckets[y]), backgroundColor: C.teal, borderRadius: 6, label: "friends" }],
      },
      options: { plugins: { legend: { display: false }, title: { display: true, text: "How long you've been friends" } }, scales: { y: { beginAtZero: true, title: { display: true, text: "friends" } }, x: { grid: { display: false } } } },
    }));
  }

  const funnel = [];
  if (STATE.invites.sent) funnel.push([fmt(STATE.invites.sent), "invites sent"]);
  if (STATE.invites.accepted) funnel.push([fmt(STATE.invites.accepted), "accepted"]);
  if (STATE.invites.declined) funnel.push([fmt(STATE.invites.declined), "declined"]);
  if (STATE.party.sent + STATE.party.received) funnel.push([fmt(STATE.party.sent + STATE.party.received), "Party Play invites"]);
  if (funnel.length) inner += `<div style="margin-top:18px;font-weight:700">Recent invite activity <span class="muted" style="font-weight:400">(Niantic keeps ~4 months)</span></div>${calloutRow(funnel)}`;

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
          { label: "Coins bought", borderColor: C.yellow, backgroundColor: C.yellow, pointRadius: 0, borderWidth: 2, tension: .3, data: months.map((m) => S.boughtMonthly[m] || 0) },
          { label: "Coins spent", borderColor: C.red, backgroundColor: C.red, pointRadius: 0, borderWidth: 2, tension: .3, data: months.map((m) => S.spentMonthly[m] || 0) },
        ],
      },
      options: { interaction: { mode: "index", intersect: false }, plugins: { title: { display: true, text: "PokéCoin flow per month" } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 14 } }, y: { title: { display: true, text: "coins" } } } },
    }));
  }

  const items = Object.entries(S.items).sort((a, b) => b[1] - a[1]).slice(0, 10).map(([n, v]) => [prettyItem(n), v]);
  if (items.length) inner += `<div class="split" style="margin-top:16px">
    <div><div style="font-weight:700;margin-bottom:10px">Most-bought shop items</div>${rankList(items)}</div>
    <div><div style="font-weight:700;margin-bottom:10px">Spending by currency</div>${rankList(curEntries.map(([c, d]) => [c, d.native]), (v, name) => (CUR_SYM[name] || "") + fmt(round(v)))}</div>
  </div>`;

  return moduleHTML("💳", "Your spending story", `Every coin bought and spent${primary ? ` — ${sym}${fmt(round(primary[1].native))} in ${primary[0]} across ${fmt(primary[1].purchases)} purchase${primary[1].purchases === 1 ? "" : "s"}` : ""}.`, inner);
}
function prettyItem(n) {
  return n.startsWith("ITEM_") ? cap(n.replace(/^ITEM_/, "").replace(/_/g, " ")) : titleCase(n);
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
    data: { labels: days.map((d) => d.slice(5)), datasets: [{ label: "Steps", backgroundColor: C.green, borderRadius: 3, data: days.map((d) => D[d].steps) }] },
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
  inner += `<div style="font-weight:700;margin:18px 0 10px">Events you bought into</div>`;
  inner += rankList(evs.slice(0, 12).map((e) => [e.name + (e.date ? " · " + e.date.getUTCFullYear() : ""), e.tickets]), (v) => v + " 🎟️");
  return moduleHTML("🎟️", "Your live events", `Tickets to ${evs.length} real-world Pokémon GO event${evs.length > 1 ? "s" : ""}.`, inner);
}

/* ── sessions / devices ── */
function renderSessions() {
  const S = STATE.sessions, I = STATE.installs;
  if (!S.total && !I.count) return;
  const devices = Object.entries(S.devices).sort((a, b) => b[1] - a[1]).slice(0, 6);
  const cities = Object.entries(S.cities).sort((a, b) => b[1] - a[1]).slice(0, 8);
  let inner = statGrid([
    [fmt(S.total), "App sessions"],
    [fmt(Object.keys(S.devices).length || Object.keys(I.devices).length), "Devices used"],
    [fmt(Object.keys(S.cities).length), "Cities seen"],
    [I.count ? (I.first ? I.first.getUTCFullYear() : fmt(I.count)) : "—", I.first ? "First install" : "Installs"],
  ]);
  const months = monthSpan(Object.keys(S.monthly));
  if (months.length > 1) {
    const cId = uid();
    inner += `<div style="margin-top:16px">${chartWrap(cId, "short")}</div>`;
    later(() => newChart(cId, {
      type: "bar",
      data: { labels: months.map(fmtMonth), datasets: [{ label: "Sessions", backgroundColor: C.blue, borderRadius: 2, data: months.map((m) => S.monthly[m] || 0) }] },
      options: { plugins: { legend: { display: false }, title: { display: true, text: "App opens per month" } }, scales: { x: { grid: { display: false }, ticks: { maxTicksLimit: 16 } }, y: { title: { display: true, text: "sessions" } } } },
    }));
  }
  if (devices.length || cities.length) inner += `<div class="split" style="margin-top:16px">
    ${devices.length ? `<div><div style="font-weight:700;margin-bottom:10px">Devices you played on</div>${rankList(devices)}</div>` : "<div></div>"}
    ${cities.length ? `<div><div style="font-weight:700;margin-bottom:10px">Where you logged in</div>${rankList(cities)}</div>` : "<div></div>"}
  </div>`;
  inner += renderTravelLog();
  return moduleHTML("📱", "Behind the screen", `${fmt(S.total)} app sessions across your devices and cities. (We never read the IPs or ad-IDs in these files.)`, inner);
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
  return `<hr class="mod-divider"><div style="font-weight:700;margin-bottom:2px">Your travel log</div>
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
  if (W.nominations != null) stats.push([fmt(W.nominations), "Nominations submitted"]);
  if (W.created != null) stats.push([fmt(W.created), "Stops you helped create"]);
  if (W.analyzed != null) stats.push([fmt(W.analyzed), "Reviews completed"]);
  if (!stats.length) return;
  return moduleHTML("🧭", "Your map-making", "How much you've given back to the map every trainer plays on.", statGrid(stats));
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

    ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
    ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); if (ev === "drop" || e.target === dz) dz.classList.remove("drag"); }));
    dz.addEventListener("drop", async (e) => {
      e.preventDefault();
      const items = e.dataTransfer.items;
      const files = items && items.length && items[0].webkitGetAsEntry ? await collectFiles(items) : [...e.dataTransfer.files];
      ingest(files);
    });

    $("build-btn").addEventListener("click", build);
    // Clear means clear: the file queue AND anything already on screen. For a
    // privacy tool, leaving the built dashboard up after "Clear" is a betrayal.
    $("clear-btn").addEventListener("click", () => {
      RAW = []; DATA_GEN++;
      renderDetected();
      clearError();
      teardown();
      const res = $("results");
      res.innerHTML = "";
      res.classList.add("results-hidden");
    });
    const demoBtn = $("demo-btn");
    if (demoBtn) demoBtn.addEventListener("click", loadDemo);

    // iOS has no real folder picker (webkitdirectory is ignored) — hide the
    // button rather than let it degrade into a confusing files-only dialog.
    const isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent)
      || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    if (isIOS) $("folder-btn").style.display = "none";
    // "Drop your files here" describes a gesture touch screens don't have
    if (window.matchMedia && window.matchMedia("(pointer: coarse)").matches) {
      const h = dz.querySelector("h2, h3");
      if (h) h.textContent = "Add your export files";
    }
  }

  // Auto-load the sample export on the dedicated live-example page, or when
  // metrics.html is opened with ?demo=1. Called directly — a setTimeout here
  // gets clamped to a full minute if the page opens in a background tab.
  if (window.DEMO_PAGE || /[?&]demo=1\b/.test(location.search)) loadDemo();
});
