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

/* ───────────────────────────── tiny helpers ───────────────────────────── */
const fmt = (n) => Number(n).toLocaleString("en-US");
const round = (n) => Math.round(n);
const esc = (s) => String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
const titleCase = (s) => s.replace(/_/g, " ").toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase());
const base = (p) => (p || "").split("/").pop();
let UID = 0;
const uid = () => "u" + ++UID;

function monthKey(d) { return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0"); }
function fmtMonth(k) { const [y, m] = k.split("-"); return MONTHS[+m - 1] + " ’" + y.slice(2); }
function fmtDate(d) { return MONTHS[d.getMonth()] + " " + d.getDate() + ", " + d.getFullYear(); }
function weekdayMon(d) { return (d.getDay() + 6) % 7; } // 0 = Monday

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
function parseRows(text, name) {
  const tab = /\.tsv$/i.test(name);
  const delim = tab ? "\t" : ",";
  const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n").filter((l) => l.length);
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
    row.__cells = cells;
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
      raidTotal: 0, raidRemote: 0, raidMaxKm: 0, raidKmSum: 0, raidWithDist: 0,
      raidArcs: new Map(), raidGymBins: new Map(), remoteRaidsByYear: {},
    },
    trail: [],
    friends: { rows: [], monthly: {}, sources: {}, initiated: {}, games: {}, unfriendedMonthly: {}, unfriended: 0 },
    invites: { sent: 0, accepted: 0, declined: 0 },
    party: { received: 0, sent: 0 },
    spend: { coinsBought: 0, coinsSpent: 0, purchases: 0, spendEvents: 0, items: {}, cur: {}, vendor: {}, boughtMonthly: {}, spentMonthly: {} },
    fitness: { daily: {} },
    sessions: { monthly: {}, devices: {}, cities: {}, total: 0 },
    installs: { count: 0, first: null, devices: {} },
    liveEvents: [],
    wayfarer: null,
  };
}
let STATE = freshState();
let RAW = [];               // [{ name, text, entry }]
let CHARTS = [];
let MAP = null;
let GLOBE = null;

/* ───────────────────────────── ingest ───────────────────────────── */
const $ = (id) => document.getElementById(id);

function showError(msg) {
  const el = $("upload-error");
  if (!el) { console.warn(msg); return; }
  el.style.display = "block";
  el.innerHTML = `<b>Heads up:</b> ${esc(msg)}`;
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
  const list = [...files].filter((f) => f && f.name && /\.(tsv|csv|txt|json)$/i.test(f.name));
  if (!list.length) { showError("No .tsv / .csv / .txt / .json files found in what you dropped."); return; }
  let added = 0;
  for (const f of list) {
    if (f.size > 80 * 1024 * 1024) continue; // skip absurdly large files
    let text;
    try { text = await f.text(); } catch (e) { continue; }
    const name = base(f.name);
    const entry = window.catalogFor(name);
    const existing = RAW.findIndex((r) => r.name.toLowerCase() === name.toLowerCase());
    const rec = { name, text, entry };
    if (existing >= 0) RAW[existing] = rec; else RAW.push(rec);
    added++;
  }
  if (!added) showError("Couldn't read those files. Try choosing them again, or pick the folder.");
  renderDetected();
}

/* Load the bundled, fully-scrubbed demo export so people can see the output
 * without uploading anything of their own. */
async function loadDemo() {
  clearError();
  const btn = $("demo-btn");
  if (btn) { btn.disabled = true; btn.textContent = "Loading demo…"; }
  try {
    const man = await fetch("demo/manifest.json").then((r) => r.json());
    const files = [];
    for (const p of man.files) {
      const t = await fetch("demo/" + p).then((r) => r.text());
      files.push(new File([t], p.split("/").pop()));
    }
    RAW = [];
    await ingest(files);
    build();
  } catch (e) {
    console.warn(e);
    showError("Couldn't load the demo dataset. Try again, or upload your own files.");
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
      else { cls = "skip"; status = "Skipped (privacy)"; }
    }
    return `<div class="file-chip ${cls}">
      <span class="fc-icon">${icon}</span>
      <div class="fc-main"><div class="fc-name">${esc(name)}</div><div class="fc-file">${esc(r.name)} · ${esc(note)}</div></div>
      <span class="fc-status">${status}</span>
    </div>`;
  }).join("");
  el.innerHTML = `
    <details class="det-files">
      <summary class="det-head">
        <h3>${RAW.length} file${RAW.length > 1 ? "s" : ""} ready</h3>
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
    if (PJ_EVENTS.some(([re]) => re.test(n)) || /^(pokestop_spin|sfida_capture|map_pokemon_encounter|join_raid_lobby|gym_battle|feed_pokemon|deploy_pokemon|incense_encounter|lure_encounter)\d?\.csv$/i.test(n)) {
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

  // medals: "\tBadge: ... where X is : 4" OR "\tBADGE_NAME: 4"  (tier 1-4)
  const medals = [];
  const re = /^[ \t]*Badge: (.+?)\.? where X is : (\d+)\s*$|^[ \t]*(BADGE_\w+): (\d+)\s*$/gm;
  let m;
  while ((m = re.exec(text))) {
    const name = (m[1] || titleCase((m[3] || "").replace(/^BADGE_/, ""))).replace(/\bX\b/g, "…").trim();
    const tier = +(m[2] || m[4]);
    if (name && tier) medals.push({ name, tier });
  }
  STATE.medals = medals.sort((a, b) => b.tier - a.tier);

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
    e.hourweek[weekdayMon(ts)][ts.getHours()]++;
    const iso = ts.toISOString().slice(0, 10);
    e.days.add(iso);
    e.dayCounts[iso] = (e.dayCounts[iso] || 0) + 1;
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
    if (label === "Raids") {
      e.raidTotal++;
      const glat = parseFloat(row.Gym_Latitude), glon = parseFloat(row.Gym_Longitude);
      if (hasLoc && !isNaN(glat) && !isNaN(glon) && (glat || glon)) {
        const d = haversine(lat, lon, glat, glon);
        e.raidKmSum += d; e.raidWithDist++;
        if (d > e.raidMaxKm) e.raidMaxKm = d;
        if (d >= 50) {
          e.raidRemote++;
          e.remoteRaidsByYear[ts.getFullYear()] = (e.remoteRaidsByYear[ts.getFullYear()] || 0) + 1;
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

function parseLocation(text) {
  const { header, rows } = parseRows(text, "x.tsv");
  const latKey = header.find((h) => /lat/i.test(h)) || header[1];
  const lonKey = header.find((h) => /lon/i.test(h)) || header[2];
  const tsKey = header.find((h) => /date|time/i.test(h)) || header[0];
  for (const row of rows) {
    const lat = parseFloat(row[latKey]), lon = parseFloat(row[lonKey]);
    const ts = parseTS(row[tsKey]);
    if (!isNaN(lat) && !isNaN(lon) && (lat || lon)) STATE.trail.push({ lat, lon, ts });
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
  const { rows } = parseRows(text, "x.tsv");
  const F = STATE.friends;
  for (const row of rows) {
    const ts = parseTS(row["Date and time"] || row.__cells[1] || row.__cells[0]);
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

function parseFitness(text) {
  const lines = text.replace(/\r/g, "").split("\n").filter((l) => l.trim());
  const D = STATE.fitness.daily;
  let any = false;
  for (let i = 1; i < lines.length; i++) { // skip header
    const c = lines[i].split("\t");
    if (c.length < 4) continue;
    const ts = parseTS(c[0]);
    if (!ts) continue;
    const d = ts.toISOString().slice(0, 10);
    const rec = (D[d] = D[d] || { steps: 0, meters: 0, cal: 0 });
    rec.steps += parseInt(c[1] || 0, 10) || 0;
    rec.meters += parseFloat(c[2] || 0) || 0;
    rec.cal += parseInt(c[3] || 0, 10) || 0;
    any = true;
  }
  if (any) markLoaded("Adventure Sync Fitness");
}

function parseSessions(text) {
  const { rows } = parseRows(text, "x.csv");
  const S = STATE.sessions;
  for (const row of rows) {
    const ts = parseTS(row.Event_time || row.__cells[0]);
    if (ts) S.monthly[monthKey(ts)] = (S.monthly[monthKey(ts)] || 0) + 1;
    const dev = ((row.Device_model || "") + "").split("::").pop().trim();
    if (dev) S.devices[dev] = (S.devices[dev] || 0) + 1;
    const city = (row.City || "").trim();
    const state = (row.State || "").trim();
    const place = [city, state].filter(Boolean).join(", ");
    if (place) S.cities[place] = (S.cities[place] || 0) + 1;
    S.total++;
  }
  if (S.total) markLoaded("App Sessions");
}

function parseInstalls(text) {
  const { rows } = parseRows(text, "x.csv");
  const I = STATE.installs;
  for (const row of rows) {
    const ts = parseTS(row.Install_time || row.__cells[0]);
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
function newChart(id, cfg) {
  const ctx = $(id);
  if (!ctx) return;
  cfg.options = cfg.options || {};
  cfg.options.maintainAspectRatio = false;
  const ch = new Chart(ctx, cfg);
  CHARTS.push(ch);
  return ch;
}

/* ───────────────────────────── render ───────────────────────────── */
function build() {
  if (!RAW.length) return;
  STATE = freshState();
  CHARTS.forEach((c) => { try { c.destroy(); } catch (e) {} });
  CHARTS = [];
  if (MAP) { try { MAP.remove(); } catch (e) {} MAP = null; }
  if (GLOBE) { try { GLOBE._destructor(); } catch (e) {} GLOBE = null; }

  RAW.forEach((r) => routeFile(r.name, r.text));

  const res = $("results");
  res.classList.remove("results-hidden");
  res.innerHTML = "";

  if (!STATE.loaded.length) {
    res.innerHTML = `<div class="empty-state"><div class="es-emoji">🤔</div>
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
  safe(renderYearOverYear);
  safe(renderWorld);
  safe(renderSocial);
  safe(renderSpending);
  safe(renderFitness);
  safe(renderLiveEvents);
  safe(renderSessions);
  safe(renderWayfarer);
  res.insertAdjacentHTML("beforeend", outro());

  // wire up post-render bits (charts/maps were referenced by id)
  POST.forEach((fn) => { try { fn(); } catch (e) { console.warn(e); } });
  POST = [];

  wireToolbar();
  res.scrollIntoView({ behavior: scrollBehavior() });
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
  // On the dedicated live-example page the page header already carries the CTAs,
  // so the in-story hero stays clean — no toolbar.
  const toolbar = window.DEMO_PAGE
    ? ""
    : `<div class="res-toolbar">
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
  if (a) a.onclick = () => $("upload-section").scrollIntoView({ behavior: scrollBehavior() });
  if (r) r.onclick = () => { RAW = []; renderDetected(); $("results").classList.add("results-hidden"); $("results").innerHTML = ""; $("upload-section").scrollIntoView({ behavior: scrollBehavior() }); };
}
function outro() {
  return `<div class="notice" style="margin-top:30px">
    <b>That's your story — for now.</b> Add more files above to unlock new chapters of your journey.</div>`;
}

/* ── trainer card (Gameplay.txt) ── */
function renderTrainer() {
  const p = STATE.profile, col = STATE.collection;
  if (!p) return;
  const km = p.distanceWalkedKm || 0;
  const stats = [
    [esc(String(p.level || "—")), "Trainer level"],
    [fmt(p.totalXp || 0), "Total XP"],
    [fmt(round(km)) + " km", "Distance walked", "≈ " + (km / 40075 * 100).toFixed(0) + "% around Earth"],
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
    STATE.medals.forEach((m) => tiers[m.tier]++);
    const cards = [
      [4, "Platinum"], [3, "Gold"], [2, "Silver"], [1, "Bronze"],
    ].map(([t, label]) =>
      `<div class="medal-card t${t}"><div class="mc-v">${fmt(tiers[t])}</div><div class="mc-l">${label}</div></div>`).join("");
    inner += `<div style="margin-top:20px;font-weight:700">Medal cabinet</div>
      <div class="mod-sub">How your medals break down by tier.</div>
      <div class="medal-cards">${cards}</div>`;
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
    [fmt(total), "Logged actions"],
    [fmt(activeDays), "Active days"],
    [busiestType ? fmt(e.totals[busiestType]) : "0", busiestType ? busiestType + " (top action)" : "—"],
    [fmt(avgPerDay), "Avg / active day"],
    [busiestDay ? fmt(busiestN) : "—", "Busiest day", busiestDay ? fmtDate(parseTS(busiestDay)) : ""],
    [fmt(streak), "Longest day streak", streak ? "consecutive days" : ""],
  ];
  if (e.raidTotal) {
    stats.push([fmt(e.raidRemote), "Remote raids", e.raidTotal ? (e.raidRemote / e.raidTotal * 100).toFixed(0) + "% of raids" : ""]);
    if (e.raidMaxKm) stats.push([fmt(round(e.raidMaxKm)) + " km", "Farthest raid reach"]);
  }
  if (stats.length < 8) stats.push([months.length ? fmtMonth(months[0]) + " – " + fmtMonth(months[months.length - 1]) : "—", "Event window"]);
  if (stats.length < 8 && e.geo.size) stats.push([fmt(e.geo.size), "Map hotspots"]);
  const cards = stats.slice(0, 8);

  // Visualisations lead the chapter; the data cards sit below them, after a divider.
  const cMonthly = uid(), cDonut = uid();
  let inner = `<div>${chartWrap(cMonthly, "tall")}</div>`;
  inner += `<div class="split" style="margin-top:16px">
    <div>${chartWrap(cDonut)}</div>
    <div><div style="font-weight:700;margin-bottom:10px">When you play — hour of week</div><div id="hw-${cMonthly}"></div></div>
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
    // hour-of-week heat grid
    renderHourWeek($("hw-" + cMonthly), e.hourweek);
  });

  return moduleHTML("🗺️", "Your adventure log", `Every spin, catch, raid and battle Niantic logged — ${fmt(total)} actions across ${fmt(e.days.size)} days.`, inner);
}

function isoShift(iso, delta) {
  const d = new Date(iso + "T00:00:00Z");
  d.setUTCDate(d.getUTCDate() + delta);
  return d.toISOString().slice(0, 10);
}
function longestStreak(isoDays) {
  if (!isoDays.length) return 0;
  const set = new Set(isoDays);
  let best = 0;
  for (const d of set) {
    if (set.has(isoShift(d, -1))) continue; // only count from the start of a run
    let len = 1, cur = d;
    while (set.has(isoShift(cur, 1))) { cur = isoShift(cur, 1); len++; }
    if (len > best) best = len;
  }
  return best;
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
  host.innerHTML = html;
  attachHourWeekTip(host);
}
/* Immediate, cursor-following tooltip for the hour-of-week grid so the hovered
 * day + time is always clear (the native title tooltip is slow and easy to miss). */
function attachHourWeekTip(host) {
  const gridEl = host.querySelector(".hw-grid");
  if (!gridEl) return;
  let tip = document.querySelector(".hw-tip");
  if (!tip) {
    tip = document.createElement("div");
    tip.className = "hw-tip";
    document.body.appendChild(tip);
  }
  const show = (ev) => {
    const cell = ev.target.closest(".hw-cell");
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
  if (years.length < 2) return { years: [], data: {} };

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
  if (years.length < 2) return;

  // superlative badges — each award goes to the winning year
  const award = (label, emoji, valueOf) => {
    let best = null, bestV = 0;
    years.forEach((y) => { const v = valueOf(data[y]) || 0; if (v > bestV) { bestV = v; best = y; } });
    return best ? { year: best, text: `${emoji} ${label}` } : null;
  };
  const awards = [
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
  let inner = `<div id="${chipsId}" class="yoy-metrics">${METRICS.map(([label], i) =>
    `<button class="yoy-chip${i === 0 ? " active" : ""}" type="button" data-i="${i}">${esc(label)}</button>`).join("")}</div>`;
  inner += `<div>${chartWrap(cId)}</div>`;

  // one shareable year card per year
  inner += `<hr class="mod-divider"><div style="font-weight:700;margin-bottom:2px">Your year cards</div>
    <div class="mod-sub" style="margin-bottom:0">A shareable recap for each year — download any as a PNG.</div>`;
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
      chips.forEach((b) => b.classList.toggle("active", b === btn));
      renderVs(+btn.dataset.i);
    }));
    renderVs(0);

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

  const sub = `${years.length} years side by side — ${years[0]} to ${years[years.length - 1]}. Tap a metric to compare, and download any year as a shareable card.`;
  return moduleHTML("📅", "Year over year", sub, inner);
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
  ctx.font = "800 150px 'Outfit', sans-serif";
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

  cv.toBlob((blob) => {
    if (btn) { btn.textContent = orig; btn.disabled = false; }
    if (!blob) { alert("Could not generate image on this browser."); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `pogo-metrics-${o.year}.png`;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, "image/png");
}

/* ── world: prefer the 3D globe, fall back to a flat heatmap ── */
function renderWorld() {
  const e = STATE.ev;
  if (e.geo.size === 0 && STATE.trail.length === 0) return;
  if (window.Globe && _webglOK()) return renderGlobe();
  return renderFlatMap();
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
  const inner = `<div id="${id}" style="height:380px;border-radius:14px;overflow:hidden;border:1px solid var(--line)"></div>`;

  later(() => {
    const map = L.map(id, { worldCopyJump: true, maxZoom: 18, scrollWheelZoom: false }).setView([20, 0], 2);
    MAP = map;
    L.tileLayer("https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png", {
      subdomains: "abcd", maxZoom: 19, attribution: "© OpenStreetMap · © CARTO",
    }).addTo(map);
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
  if (hasTrail) bits.push(`a ${fmt(STATE.trail.length)}-point GPS trail`);
  return moduleHTML("📍", "Where you played", `Your world map, built from ${bits.join(" and ")}. Coordinates stay on your device.`, inner);
}

/* ── 3D globe: activity columns + remote-raid arcs + GPS trail ── */
function buildTrailPaths() {
  const rows = STATE.trail.filter((p) => p.ts).slice().sort((a, b) => a.ts - b.ts);
  const days = {}; let last = null;
  for (const p of rows) {
    const d = new Date(p.ts).toLocaleDateString("en-CA");
    if (last && last.d === d && Math.abs(p.lat - last.la) < 2e-4 && Math.abs(p.lon - last.lo) < 2e-4) continue;
    (days[d] = days[d] || []).push([p.lat, p.lon, 0.002]);
    last = { d, la: p.lat, lo: p.lon };
  }
  return Object.keys(days).sort().filter((d) => days[d].length >= 2).map((d) => ({ date: d, pts: days[d] }));
}
function gToggle(id, color, label, checked) {
  return `<label class="gh-toggle"><input type="checkbox" id="${id}" ${checked ? "checked" : ""}><span class="gh-sw" style="--c:${color}"></span>${esc(label)}</label>`;
}

function renderGlobe() {
  const e = STATE.ev;
  const P = "glb-";
  const points = [...e.geo.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4000).map(([key, count]) => {
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
    <div class="globe-stage">
      <div id="${P}canvas" class="globe-canvas"></div>
      <div id="${P}loading" class="globe-loading"><div class="gl-spin"></div>Spinning up the world…</div>
      <div id="${P}stats" class="globe-hud globe-hud-tl"></div>
      <div class="globe-hud globe-hud-tr">
        <div class="gh-title">Layers</div>
        ${gToggle(P + "ly-points", C.teal, "Activity columns", true)}
        ${gToggle(P + "ly-arcs", C.red, "Remote raid arcs", arcs.length > 0)}
        <div class="gh-slider" id="${P}arc-ctl"><input type="range" id="${P}arc-dist" min="0" max="100" value="100"><span class="mono" id="${P}arc-lbl">all distances</span></div>
        ${gToggle(P + "ly-trail", C.yellow, "GPS trail", paths.length > 0)}
        ${gToggle(P + "ly-borders", "#5a6db8", "Country lines", true)}
        ${gToggle(P + "ly-labels", "#dfe6ff", "Country names", true)}
        ${gToggle(P + "ly-rotate", C.blue, "Auto-rotate", !REDUCED_MOTION)}
        <button id="${P}shot" class="gh-btn" type="button">📷 Save image</button>
      </div>
      <div id="${P}legend" class="globe-hud globe-legend"></div>
      <div id="${P}country" class="globe-hud globe-country" hidden></div>
    </div>
    <div id="${P}below" class="globe-below"></div>
  </div>`;

  later(() => { try { initGlobe({ P, points, maxCount, arcs, home, paths }); } catch (err) { console.warn("globe init failed", err); } });
  return html;
}

function initGlobe({ P, points, maxCount, arcs, home, paths }) {
  const e = STATE.ev;
  const el = $(P + "canvas");
  if (!el || !window.Globe) return;
  const KIND_COLORS = SERIES_COLORS;
  const maxArcKm = Math.max(1, ...arcs.map((a) => a.km));
  let arcMax = maxArcKm;
  const $$ = (id) => $(P + id);

  const world = Globe({ rendererConfig: { preserveDrawingBuffer: true, antialias: true } })(el)
    .width(el.clientWidth).height(560)
    .globeImageUrl("vendor/img/earth-night.jpg")
    .bumpImageUrl("vendor/img/earth-topology.png")
    .backgroundImageUrl("vendor/img/night-sky.png")
    .atmosphereColor(C.teal).atmosphereAltitude(0.18)
    .pointsData(points).pointLat("lat").pointLng("lng")
    .pointAltitude((p) => 0.004 + Math.log10(p.count + 1) / Math.log10(maxCount + 1) * 0.13)
    .pointRadius((p) => (p.count > 1000 ? 0.045 : 0.026))
    .pointColor((p) => KIND_COLORS[p.kind] || C.teal)
    .pointLabel((p) => `<b>${fmt(p.count)}</b> ${p.kind.toLowerCase()}`)
    .pointsMerge(false)
    .arcsData(arcs).arcStartLat("slat").arcStartLng("slng").arcEndLat("elat").arcEndLng("elng")
    .arcColor((a) => { const t = Math.min(1, a.km / 9000); return ["rgba(65,216,198,.75)", t < 0.5 ? "rgba(255,203,5,.8)" : "rgba(255,83,80,.85)"]; })
    .arcStroke((a) => 0.18 + Math.log10(a.count + 1) * 0.28)
    .arcAltitudeAutoScale(0.42).arcDashLength(0.45).arcDashGap(0.6)
    .arcDashAnimateTime((a) => 2200 + (a.km % 1500))
    .arcLabel((a) => `<b>${fmt(a.count)}</b> raid${a.count > 1 ? "s" : ""} · ${fmt(Math.round(a.km))} km away`)
    .pathsData(paths).pathPoints("pts").pathPointLat((p) => p[0]).pathPointLng((p) => p[1]).pathPointAlt((p) => p[2])
    .pathColor(() => ["rgba(255,203,5,.9)", "rgba(255,157,66,.9)"])
    .pathStroke(1.6).pathDashLength(0.18).pathDashGap(0.035).pathDashAnimateTime(14000)
    .pathLabel((p) => `GPS trail · ${p.date}`)
    .ringsData([{ lat: home.lat, lng: home.lng }])
    .ringColor(() => (t) => `rgba(65,216,198,${1 - t})`)
    .ringMaxRadius(2.6).ringPropagationSpeed(1.1).ringRepeatPeriod(1400)
    .onGlobeReady(() => { const l = $$("loading"); if (l) l.classList.add("done"); world.pointOfView({ lat: home.lat, lng: home.lng, altitude: 1.9 }, 1600); });
  GLOBE = world;
  if (!arcs.length) world.arcsData([]);
  if (!paths.length) world.pathsData([]);

  const controls = world.controls();
  controls.autoRotate = !REDUCED_MOTION; controls.autoRotateSpeed = 0.45;
  controls.minDistance = world.getGlobeRadius() * 1.18;
  world.renderer().domElement.addEventListener("pointerdown", () => { controls.autoRotate = false; });
  world.renderer().domElement.addEventListener("pointerup", () => { controls.autoRotate = $$("ly-rotate").checked; });

  // stats
  const geoEvents = [...e.geo.values()].reduce((a, b) => a + b, 0);
  const stats = [[fmt(geoEvents), "geotagged events"], [fmt(e.geo.size), "distinct spots"]];
  if (e.raidRemote) { stats.push([fmt(e.raidRemote), "remote raids"], [fmt(round(e.raidMaxKm)) + " km", "farthest raid"], [(e.raidKmSum / 40075).toFixed(1) + "×", "around Earth raiding"]); }
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
    countries.features.forEach((f) => { f.properties._kind = "country"; f._centroid = featureCentroid(f); });
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

  const onResize = () => { if (GLOBE === world && el.isConnected) world.width(el.clientWidth); };
  window.addEventListener("resize", onResize);
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
  if (g.type === "Polygon") return polygonContains(lng, lat, g.coordinates);
  if (g.type === "MultiPolygon") return g.coordinates.some((p) => polygonContains(lng, lat, p));
  return false;
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
  if (!hasFriends && !STATE.unfriended && !hasInvites && !(STATE.party.sent + STATE.party.received)) return;

  let inner = "", sub = "";
  if (hasFriends) {
    const dated = F.rows.filter((r) => r.ts).sort((a, b) => a.ts - b.ts);
    const now = STATE.ev.last || new Date();
    const oldest = dated.slice(0, 8).map((r) => [r.name, Math.round((now - r.ts) / 864e5)]);
    const longest = dated[0] ? ((now - dated[0].ts) / (365.25 * 864e5)).toFixed(1) : 0;
    const topSrc = Object.entries(F.sources).sort((a, b) => b[1] - a[1])[0];
    const added = Object.values(F.monthly).reduce((a, b) => a + b, 0);
    const removed = F.unfriended;
    const stats = [
      [fmt(F.rows.length), "Current friends"],
      [longest + " yr", "Longest friendship", dated[0] ? esc(dated[0].name) : ""],
      [topSrc ? prettySource(topSrc[0]) : "—", "Top way you connect"],
      [(added - removed >= 0 ? "+" : "") + fmt(added - removed), "Net friends (in log window)"],
    ];
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
  // Headline the spend in USD for our US audience; any other currencies a user
  // actually spent in still appear in the "Spending by currency" breakdown.
  const primary = (S.cur.USD && S.cur.USD.purchases) ? ["USD", S.cur.USD] : curEntries[0];
  const sym = primary ? (CUR_SYM[primary[0]] || primary[0] + " ") : "";
  const stats = [
    [primary ? sym + fmt(round(primary[1].native)) : "—", primary ? "Spent (" + primary[0] + ")" : "Real money"],
    [fmt(S.coinsBought), "PokéCoins bought", S.purchases + " purchases"],
    [fmt(S.coinsSpent), "PokéCoins spent", S.spendEvents + " checkouts"],
    [fmt(Object.values(S.items).reduce((a, b) => a + b, 0)), "Items bought in shop"],
  ];
  let inner = statGrid(stats);

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
  inner += rankList(evs.slice(0, 12).map((e) => [e.name + (e.date ? " · " + e.date.getFullYear() : ""), e.tickets]), (v) => v + " 🎟️");
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
    [I.count ? (I.first ? I.first.getFullYear() : fmt(I.count)) : "—", I.first ? "First install" : "Installs"],
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
  return moduleHTML("📱", "Behind the screen", `${fmt(S.total)} app sessions across your devices and cities. (We never read the IPs or ad-IDs in these files.)`, inner);
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
  if (window.Chart) {
    Chart.defaults.color = C.dim;
    Chart.defaults.font.family = "'Outfit', system-ui, sans-serif";
    Chart.defaults.borderColor = C.grid;
    Chart.defaults.plugins.legend.labels.boxWidth = 12;
    Chart.defaults.plugins.legend.labels.boxHeight = 12;
    if (REDUCED_MOTION) Chart.defaults.animation = false;
  }
  // The upload UI only exists on metrics.html; the live-example page is
  // results-only, so wire it all up behind a dropzone check.
  const dz = $("dropzone");
  if (dz) {
    const fileInput = $("file-input"), folderInput = $("folder-input");
    $("browse-btn").addEventListener("click", () => fileInput.click());
    $("folder-btn").addEventListener("click", () => folderInput.click());
    dz.addEventListener("click", (e) => { if (e.target.closest("button")) return; fileInput.click(); });
    fileInput.addEventListener("change", (e) => ingest(e.target.files));
    folderInput.addEventListener("change", (e) => ingest(e.target.files));

    ["dragenter", "dragover"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add("drag"); }));
    ["dragleave", "drop"].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); if (ev === "drop" || e.target === dz) dz.classList.remove("drag"); }));
    dz.addEventListener("drop", async (e) => {
      e.preventDefault();
      const items = e.dataTransfer.items;
      const files = items && items.length && items[0].webkitGetAsEntry ? await collectFiles(items) : [...e.dataTransfer.files];
      ingest(files);
    });

    $("build-btn").addEventListener("click", build);
    $("clear-btn").addEventListener("click", () => { RAW = []; renderDetected(); clearError(); });
    const demoBtn = $("demo-btn");
    if (demoBtn) demoBtn.addEventListener("click", loadDemo);
  }

  // Auto-load the sample export on the dedicated live-example page, or when
  // metrics.html is opened with ?demo=1.
  if (window.DEMO_PAGE || /[?&]demo=1\b/.test(location.search)) setTimeout(loadDemo, 200);
});
