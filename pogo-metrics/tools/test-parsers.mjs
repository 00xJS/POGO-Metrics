/* test-parsers.mjs — a dependency-free regression check for the parsers.
 *
 *   node tools/test-parsers.mjs
 *
 * Runs the SHIPPED js/app.js inside a vm with minimal browser stubs, feeds it
 * every file in sample-export/manifest.json exactly as the app does, and asserts
 * the numbers the sample export is known to produce.
 *
 * Why this exists: every parser bug this project has shipped was silent — a
 * renamed column or a bad regex yields zero, not an error, so the page still
 * renders and the number is just wrong. Three real examples this would have
 * caught immediately:
 *   • hour-of-week rotated one weekday for every viewer west of UTC
 *   • five medals dropped, four of them Platinum, on a level-80 account
 *   • App_Installs timestamps read from a column that does not exist
 *
 * When a change legitimately moves a number, update GOLDEN in the same commit —
 * that diff is the point, it forces the change to be deliberate.
 */
/* Run in a deliberately non-UTC zone. Every bucket the app builds is supposed to
 * be UTC-derived, so these results must be identical on any machine — if a
 * getHours() creeps back in where getUTCHours() belongs, the busiest-cell
 * assertion below moves and this fails. */
process.env.TZ = "America/Phoenix";

import fs from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DEMO = path.join(ROOT, "sample-export");

/* ------- expected results, measured from the committed sample-export/ ------- */
const GOLDEN = {
  // 15 catalog chapters + the You-vs-friend compare + the Campfire export. (This
  // sat at 15 after the rival JSON joined the manifest — the one stale golden.)
  "chapters unlocked": 17,
  "logged actions": 13905,
  "active days": 831,
  "distinct months": 35,
  "medals parsed": 141,
  "medals declared by Niantic": 141,
  "platinum medals": 50,          // 50 is a hard requirement for level 80
  "gold medals": 11,
  "silver medals": 7,
  "bronze medals": 3,
  "event badges": 70,
  "friends": 412,
  "unfriended": 269,
  "distinct pokestops": 308,
  "trail points": 1220,
  "app sessions": 2308,
  "app installs": 11,
  "fitness days": 24,
  "pokecoins bought": 1052900,
  "live events": 2,
  // Coordinates are generated, not translated (see tools/scrub-demo.mjs), so
  // these two describe the SYNTHETIC world's shape, not anyone's real movement.
  "remote raids": 686,
  "geo hotspots": 1247,
  "player journey timestamps": 13905,
  // A raw total cannot see a shifted grid — only the shape can. This is the
  // assertion that catches a UTC-vs-local regression in the hour-of-week data.
  "busiest hour-of-week cell": "Thu 01:00",
  "busiest cell count": 599,
  "busiest day of week": "Sat",
  "bag items": 16807,
  "bag kinds": 56,
  "event pass points": 234182,
  "fusion resources": 36870,
  "eggs held": 9,
  "eggs incubating": 1,
  "idle incubators": 96,
  "distinct raid gyms": 624,
  "snapshots": 341,
  "snapshot months": 19,
  // Two conversations, 26 messages between them. Counting rows called that 26
  // tickets. The demo fixture renumbers ticket ids CONSISTENTLY so these two
  // numbers can differ — if they ever match again, the fixture has regressed
  // back to one-ticket-per-row and stopped testing the grouping.
  "support tickets": 2,
  "support messages": 26,
  "login countries": 2,
  "coin vendors": 3,
  "free daily boxes": 917,
  "paid bundles": 56,
  "admin grants": 6,
  // The rolling log at the end of Gameplay.txt. "other" must stay 0: any line
  // shape Niantic adds shows up there first, and silently unclassified rows are
  // exactly how this file went unread for so long.
  "recent log rows": 47,
  "recent log caught": 14,
  "recent log fled": 6,
  "recent log unclassified": 0,
  "recent log items": 78,
  "recent log best catch": "Growlithe CP 1139",
  // The Campfire file in the sample is SYNTHETIC (tools/campfire-sample.mjs),
  // so these describe the generator's seed, not anyone's meetups.
  "campfire meetups attended": 48,
  "campfire meetups rsvp'd": 70,
  "campfire meetups hosted": 24,
  "campfire messages": 1180,
  "campfire friends": 140,
  "campfire clubs": 5,
};

/* ---------- the smallest browser the parsers will accept ---------- */
function makeContext(extra = {}) {
  const noop = () => {};
  const el = () => ({
    style: {}, dataset: {}, classList: { add: noop, remove: noop, toggle: noop, contains: () => false },
    appendChild: noop, removeChild: noop, remove: noop, addEventListener: noop, setAttribute: noop,
    getAttribute: () => null, querySelector: () => null, querySelectorAll: () => [], insertAdjacentHTML: noop,
    getContext: () => null, focus: noop, click: noop, scrollIntoView: noop, closest: () => null,
    children: [], innerHTML: "", textContent: "",
  });
  const doc = {
    addEventListener: noop, removeEventListener: noop, createElement: el, createTreeWalker: () => ({ nextNode: () => false }),
    getElementById: () => null, querySelector: () => null, querySelectorAll: () => [],
    body: el(), documentElement: el(), fonts: { ready: Promise.resolve() },
  };
  const win = {
    matchMedia: () => ({ matches: false, addEventListener: noop }),
    addEventListener: noop, removeEventListener: noop,
    requestAnimationFrame: noop, setTimeout, clearTimeout, setInterval, clearInterval,
    performance: { now: () => 0 }, navigator: { userAgent: "node", platform: "node", maxTouchPoints: 0 },
    location: { search: "", protocol: "https:", hostname: "test" },
    // The streaming parsers yield with this. A vm context gets V8's globals but
    // not Node's, so without it every chunk boundary would throw ReferenceError
    // — and the demo fixture is too small to cross one, so nothing would notice.
    MessageChannel,
    document: doc, console,
  };
  Object.assign(win, extra);
  win.window = win;
  win.self = win;
  win.globalThis = win;
  return vm.createContext(win);
}

function load(ctx, file) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), "utf8"), ctx, { filename: file });
}

/* ---------- run ---------- */
const ctx = makeContext();
try {
  load(ctx, "js/pokedex.js");   // parseGameplay maps species names through this
  load(ctx, "js/catalog.js");   // routeFile is independent of it, but app.js expects it present
  load(ctx, "js/app.js");
} catch (e) {
  console.error("Could not load the app into a stub browser — a new browser API is being used at module scope.");
  console.error(e.stack || e);
  process.exit(2);
}

const manifest = JSON.parse(fs.readFileSync(path.join(DEMO, "manifest.json"), "utf8"));
let routed = 0;
for (const rel of manifest.files) {
  const full = path.join(DEMO, rel);
  if (!fs.existsSync(full)) { console.error(`missing sample-export file: ${rel}`); process.exit(2); }
  const name = rel.split("/").pop();
  ctx.__name = name;
  ctx.__text = fs.readFileSync(full, "utf8");
  // routeFile is async now — the high-volume parsers yield mid-file so a real
  // export cannot freeze the page. Awaiting here keeps this harness honest:
  // without it the assertions would run against half-parsed state.
  await vm.runInContext("routeFile(__name, __text)", ctx);
  routed++;
}

const S = vm.runInContext("STATE", ctx);
const tierCount = (t) => S.medals.filter((m) => m.tier === t).length;
const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
function peakCell(grid) {
  let best = { d: 0, h: 0, n: -1 };
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) if (grid[d][h] > best.n) best = { d, h, n: grid[d][h] };
  return best;
}
const actual = {
  "chapters unlocked": S.loaded.length,
  "logged actions": Object.values(S.ev.totals).reduce((a, b) => a + b, 0),
  "active days": S.ev.days.size,
  "distinct months": Object.keys(S.ev.byMonth).length,
  "medals parsed": S.medals.length,
  "medals declared by Niantic": S.profile ? S.profile.medalCount : 0,
  "platinum medals": tierCount(4),
  "gold medals": tierCount(3),
  "silver medals": tierCount(2),
  "bronze medals": tierCount(1),
  "event badges": S.medals.filter((m) => m.event).length,
  "friends": S.friends.rows.length,
  "unfriended": S.friends.unfriended,
  "distinct pokestops": S.ev.forts.size,
  "trail points": S.trailCount,
  "app sessions": S.sessions.total,
  "app installs": S.installs.count,
  "fitness days": Object.keys(S.fitness.daily).length,
  "pokecoins bought": S.spend.coinsBought,
  "live events": S.liveEvents.length,
  "remote raids": S.ev.raidRemote,
  "geo hotspots": S.ev.geo.size,
  "player journey timestamps": S.ev.stamps.length,
  "busiest hour-of-week cell": (() => { const p = peakCell(S.ev.hourweek); return `${DAYS[p.d]} ${String(p.h).padStart(2, "0")}:00`; })(),
  "busiest cell count": peakCell(S.ev.hourweek).n,
  "busiest day of week": DAYS[S.ev.hourweek
    .map((row, d) => [d, row.reduce((a, b) => a + b, 0)])
    .sort((a, b) => b[1] - a[1])[0][0]],
  "bag items": S.bag ? S.bag.bagTotal : 0,
  "bag kinds": S.bag ? S.bag.distinct : 0,
  "event pass points": S.bag ? S.bag.points : 0,
  "fusion resources": S.bag ? S.bag.resources : 0,
  "eggs held": S.eggs ? S.eggs.held : 0,
  "eggs incubating": S.eggs ? S.eggs.incubating : 0,
  "idle incubators": S.eggs ? S.eggs.idleIncubators : 0,
  "distinct raid gyms": S.ev.gyms.size,
  "snapshots": S.photos.total,
  "snapshot months": Object.keys(S.photos.monthly).length,
  "support tickets": S.support.tickets,
  "support messages": S.support.messages,
  "login countries": Object.keys(S.sessions.countries).length,
  "coin vendors": Object.keys(S.spend.vendor).length,
  "free daily boxes": S.spend.freeBundles,
  "paid bundles": S.spend.paidBundles,
  "admin grants": S.spend.granted,
  "recent log rows": S.recent ? S.recent.rows : 0,
  "recent log caught": S.recent ? S.recent.caught.length : 0,
  "recent log fled": S.recent ? S.recent.fled.length : 0,
  "recent log unclassified": S.recent ? S.recent.other : -1,
  "recent log items": S.recent ? S.recent.items : 0,
  "recent log best catch": (() => {
    const b = S.recent && S.recent.caught.slice().sort((a, c) => c.cp - a.cp)[0];
    return b ? `${b.name} CP ${b.cp}` : "—";
  })(),
  "campfire meetups attended": S.campfire ? S.campfire.checkins : 0,
  "campfire meetups rsvp'd": S.campfire ? S.campfire.rsvps : 0,
  "campfire meetups hosted": S.campfire ? S.campfire.hosted : 0,
  "campfire messages": S.campfire ? S.campfire.messages : 0,
  "campfire friends": S.campfire ? S.campfire.friends : 0,
  "campfire clubs": S.campfire ? S.campfire.clubs : 0,
};

/* Invariants that must hold for ANY export, not just this fixture. These catch
 * whole classes of bug that a fixed number cannot. */
const invariants = [
  ["every medal is tiered or flagged", S.medals.every((m) => m.tier || m.event || m.progress)],
  ["tiers + events + progress == total", tierCount(1) + tierCount(2) + tierCount(3) + tierCount(4)
    + S.medals.filter((m) => m.event).length + S.medals.filter((m) => !m.tier && !m.event).length === S.medals.length],
  ["medal count matches Niantic's own", S.medals.length === (S.profile && S.profile.medalCount)],
  ["no NaN in action totals", Object.values(S.ev.totals).every(Number.isFinite)],
  ["every active day has a count", [...S.ev.days].every((d) => S.ev.dayCounts[d] > 0)],
  ["hour-of-week sums to the timestamp count", S.ev.hourweek.flat().reduce((a, b) => a + b, 0) === S.ev.stamps.length],
  ["day counts sum to the timestamp count", Object.values(S.ev.dayCounts).reduce((a, b) => a + b, 0) === S.ev.stamps.length],
  ["first log is before last", !S.ev.first || !S.ev.last || S.ev.first <= S.ev.last],
  ["trail retained is within the cap", S.trail.length <= 60000],
  ["retained trail never exceeds the true count", S.trail.length <= S.trailCount],
  ["remote raids do not exceed all raids", S.ev.raidRemote <= S.ev.raidTotal],
  ["every friend row has a name", S.friends.rows.every((r) => r.name)],
  ["no fort has zero visits", [...S.ev.forts.values()].every((f) => f.n > 0)],
  ["bag splits reconcile with Niantic's own item count",
    !S.bag || S.bag.bagTotal + S.bag.points + S.bag.resources === S.bag.declared],
  ["every bag item has a name, a positive count and a group",
    !S.bag || S.bag.items.every((i) => i.name && i.n > 0 && i.group)],
  ["bag groups sum to the bag total",
    !S.bag || Object.values(S.bag.groups).reduce((a, b) => a + b, 0) === S.bag.bagTotal],
  ["bag items are sorted biggest first",
    !S.bag || S.bag.items.every((it, i, a) => i === 0 || a[i - 1].n >= it.n)],
  ["eggs incubating never exceed eggs held", !S.eggs || S.eggs.incubating <= S.eggs.held],
  ["every raid gym has a positive lobby count", [...S.ev.gyms.values()].every((g) => g.n > 0)],
  ["raid gym lobbies sum to no more than all raids",
    [...S.ev.gyms.values()].reduce((a, g) => a + g.n, 0) <= S.ev.raidTotal],
  ["every gym's first sighting is before its last", [...S.ev.gyms.values()].every((g) => g.first <= g.last)],
  ["snapshot months sum to the snapshot total",
    Object.values(S.photos.monthly).reduce((a, b) => a + b, 0) === S.photos.total],
  ["snapshot days sum to the snapshot total",
    Object.values(S.photos.days).reduce((a, b) => a + b, 0) === S.photos.total],
  ["oldest snapshot is not newer than the newest",
    !S.photos.first || !S.photos.last || S.photos.first <= S.photos.last],
  ["support topics never outnumber support tickets",
    Object.values(S.support.topics).reduce((a, b) => a + b, 0) <= S.support.tickets],
  ["support tickets never outnumber support messages", S.support.tickets <= S.support.messages],
  /* The whole point of reading this file is that the message bodies are not
   * read. Nothing but a date, a subject and a count may reach STATE. */
  ["support state carries no message text",
    Object.keys(S.support.topics).every((t) => t.length < 120 && !/\n/.test(t))],
  ["vendor coins never exceed all coins bought",
    Object.values(S.spend.vendor).reduce((a, v) => a + v.coins, 0) <= S.spend.coinsBought],
  ["vendor purchases reconcile with the purchase count",
    Object.values(S.spend.vendor).reduce((a, v) => a + v.purchases, 0) === S.spend.purchases],
  ["no bundle leaked into the itemised shop list",
    Object.keys(S.spend.items).every((i) => !i.startsWith("LPSKU"))],
  ["every country code is two letters",
    Object.keys(S.sessions.countries).every((c) => /^[A-Z]{2}$/.test(c))],
  ["country sessions never exceed all sessions",
    Object.values(S.sessions.countries).reduce((a, b) => a + b, 0) <= S.sessions.total],
  ["every logged catch and flee has a name and a CP",
    !S.recent || [...S.recent.caught, ...S.recent.fled, ...S.recent.hatched].every((p) => p.name && p.cp > 0)],
  ["no raw species code survived into the recent log",
    !S.recent || [...S.recent.caught, ...S.recent.fled].every((p) => !/^V\d{4}_/.test(p.name))],
  ["the recent log's first entry is before its last",
    !S.recent || S.recent.first <= S.recent.last],
  /* The Campfire file is mostly other people's words plus meetup coordinates.
   * The parser's promise is counts and dates only — so no string may reach
   * STATE.campfire at all, not a title, not a name, not a coordinate. */
  ["campfire state carries no text", (() => {
    const strings = [];
    (function walk(o) { for (const k in o) { const v = o[k]; if (typeof v === "string") strings.push(k); else if (v && typeof v === "object" && !(v instanceof Date)) walk(v); } })(S.campfire || {});
    return strings.length === 0;
  })()],
  ["campfire kinds sum to the check-in count",
    !S.campfire || Object.values(S.campfire.kinds).reduce((a, b) => a + b, 0) === S.campfire.checkins],
  ["campfire monthly check-ins sum to the total",
    !S.campfire || Object.values(S.campfire.checkinMonthly).reduce((a, b) => a + b, 0) === S.campfire.checkins],
  ["campfire monthly messages sum to the total",
    !S.campfire || Object.values(S.campfire.msgMonthly).reduce((a, b) => a + b, 0) === S.campfire.messages],
  ["campfire friend sources sum to the friend count",
    !S.campfire || Object.values(S.campfire.friendSources).reduce((a, b) => a + b, 0) === S.campfire.friends],
  ["campfire first is not after last", !S.campfire || !S.campfire.first || S.campfire.first <= S.campfire.last],
  /* The globe timeline's "this month only" view is built from per-spot and
   * per-arc month tallies kept at parse. They must add up to the same totals
   * the all-time view draws from, or the two views would disagree. */
  ["every spot's month tallies sum to its count",
    [...S.ev.geo.entries()].every(([k, n]) => Object.values(S.ev.geoMonths.get(k) || {}).reduce((a, b) => a + b, 0) === n)],
  ["every arc's month tallies sum to its count",
    [...S.ev.raidArcs.entries()].every(([k, n]) => Object.values(S.ev.arcMonths.get(k) || {}).reduce((a, b) => a + b, 0) === n)],
  ["a spot's first-seen month is its earliest tallied month",
    [...S.ev.geoFirst.entries()].every(([k, m]) => Object.keys(S.ev.geoMonths.get(k) || {}).sort()[0] === m)],
];

/* ---------- streaming across chunk boundaries ----------
 * The big parsers yield to the main thread every PARSE_CHUNK rows. The demo's
 * largest file is ~2,600 rows, so nothing in the fixture above ever reaches a
 * boundary — a bug in resuming after a yield would sail straight through this
 * suite. Feed a synthetic file big enough to cross several, in a FRESH context
 * so it cannot disturb the numbers already asserted, and check nothing is
 * dropped or double-counted at the seams. */
const ROWS = 47_000;   // crosses the 15k boundary three times, and not on it
const streamCtx = makeContext();
load(streamCtx, "js/pokedex.js");
load(streamCtx, "js/catalog.js");
load(streamCtx, "js/app.js");
const chunkSize = vm.runInContext("PARSE_CHUNK", streamCtx);
{
  let csv = "Player_Latitude,Player_Longitude,Fort_Latitude,Fort_Longitude,Timestamp\n";
  for (let i = 0; i < ROWS; i++) {
    // one distinct fort per 1000 rows, and a timestamp that walks forward
    const d = new Date(Date.UTC(2024, 0, 1, 0, 0, 0) + i * 60000).toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");
    // e.geo bins player positions to 3 decimals, so step by a whole 0.001 to
    // get 1000 genuinely distinct bins rather than ~100 that round together.
    const off = ((i % 1000) / 1000).toFixed(3);
    csv += `${(34 + +off).toFixed(6)},${(-118 - +off).toFixed(6)},34.05,-118.24,${d}\n`;
  }
  streamCtx.__name = "Pokestop_spin1.csv";
  streamCtx.__text = csv;
  await vm.runInContext("routeFile(__name, __text)", streamCtx);
}
const S2 = vm.runInContext("STATE", streamCtx);
const streamTests = [
  [`yield boundary is actually crossed (${ROWS.toLocaleString()} rows / chunk ${chunkSize})`, ROWS > chunkSize],
  ["every streamed row counted exactly once", S2.ev.totals["Spins"] === ROWS],
  ["no timestamps lost at a seam", S2.ev.stamps.length === ROWS],
  ["day counts still sum to the row count", Object.values(S2.ev.dayCounts).reduce((a, b) => a + b, 0) === ROWS],
  ["hour-of-week still sums to the row count", S2.ev.hourweek.flat().reduce((a, b) => a + b, 0) === ROWS],
  ["distinct forts survive streaming", S2.ev.forts.size === 1],
  ["distinct player positions survive streaming", S2.ev.geo.size === 1000],
];

/* ---------- the Player_Journey pair ----------
 * Every event ships twice: Pokestop_spin1.csv (the trailing ~15 months,
 * precise positions) beside Pokestop_spin2.csv (the trailing ~3 years of the
 * SAME events, every position blurred to a few kilometres). The app reads the
 * "1" in full, then the "2" with the shared window skipped and its blurred
 * positions kept off the map and out of the stop rankings. The sample only
 * carries "1" files, so the goldens above can never see this — it gets a
 * fresh context, with a "2" built from the "1": every row again four years
 * earlier (outside the window) with its coordinates nudged, the way a
 * blurred cell sits beside the real stop. */
const pairCtx = makeContext();
load(pairCtx, "js/pokedex.js");
load(pairCtx, "js/catalog.js");
load(pairCtx, "js/app.js");
const gymText = fs.readFileSync(path.join(DEMO, "Player_Journey/Gym_battle1.csv"), "utf8");
const spinText = fs.readFileSync(path.join(DEMO, "Player_Journey/Pokestop_spin1.csv"), "utf8");
const spinRows = spinText.trim().split("\n").length - 1;
const olderRows = spinText.trim().split("\n").slice(1).map((l) => {
  const c = l.split(",");
  for (let i = 0; i < 4; i++) c[i] = (parseFloat(c[i]) + 0.02).toFixed(6);
  c[4] = String(+c[4].slice(0, 4) - 4) + c[4].slice(4);
  return c.join(",");
});
const twoText = spinText.trimEnd() + "\n" + olderRows.join("\n") + "\n";
const readEv = (k) => vm.runInContext(k, pairCtx);
pairCtx.__one = spinText; pairCtx.__two = twoText;
vm.runInContext('RAW = [{ name: "Pokestop_spin1.csv" }, { name: "Pokestop_spin2.csv" }]', pairCtx);
await vm.runInContext('routeFile("Pokestop_spin1.csv", __one)', pairCtx);
const afterOne = { n: readEv("STATE.ev.totals.Spins || 0"), forts: readEv("STATE.ev.forts.size"), geo: readEv("STATE.ev.geo.size"), win: readEv("!!STATE.ev.win.Spins") };
await vm.runInContext('routeFile("Pokestop_spin2.csv", __two)', pairCtx);
const afterTwo = { n: readEv("STATE.ev.totals.Spins || 0"), forts: readEv("STATE.ev.forts.size"), geo: readEv("STATE.ev.geo.size"), blurred: readEv("STATE.ev.blurredRows") };
vm.runInContext('STATE = freshState(); RAW = [{ name: "Pokestop_spin2.csv" }]', pairCtx);
await vm.runInContext('routeFile("Pokestop_spin2.csv", __two)', pairCtx);
const alone2 = { n: readEv("STATE.ev.totals.Spins || 0"), forts: readEv("STATE.ev.forts.size"), geo: readEv("STATE.ev.geo.size") };
vm.runInContext('STATE = freshState(); RAW = [{ name: "Pokestop_spin1.csv" }]', pairCtx);
await vm.runInContext('routeFile("Pokestop_spin1.csv", __one)', pairCtx);
const alone1 = { n: readEv("STATE.ev.totals.Spins || 0"), forts: readEv("STATE.ev.forts.size") };
const pairTests = [
  ["the precise file is counted in full and records its window", afterOne.n === spinRows && afterOne.win && afterOne.forts > 0],
  ["the 3-year twin adds only the rows outside that window", afterTwo.n === 2 * spinRows],
  ["blurred positions never rank as stops", afterTwo.forts === afterOne.forts],
  ["blurred positions stay off the map while the precise twin is present", afterTwo.geo === afterOne.geo && afterTwo.blurred > 0 && afterTwo.blurred <= spinRows],
  ["a 3-year file on its own still draws the map, but ranks no stops", alone2.n === 2 * spinRows && alone2.geo > 0 && alone2.forts === 0],
  ["a 15-month file on its own is unchanged", alone1.n === spinRows && alone1.forts === afterOne.forts],
];

/* ---------- opening Player_Journey.zip in the browser ----------
 * The export's inner archive is plain deflate with no password; the app now
 * inflates it itself. Build a small archive here — one stored entry, one
 * deflated, one flagged encrypted — and read it back through the app's own
 * reader. Node has the same DecompressionStream / Blob / File / Response the
 * browser does, so the code under test is the shipped code, unchanged. */
const zipCtx = makeContext({ DecompressionStream, Blob, File, Response, TextDecoder });
load(zipCtx, "js/pokedex.js");
load(zipCtx, "js/catalog.js");
load(zipCtx, "js/app.js");
const zipTests = [];
{
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }; })();
  const enc = new TextEncoder();
  const deflate = async (bytes) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
  const u16 = (n) => [n & 255, (n >>> 8) & 255], u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  const friendsText = fs.readFileSync(path.join(DEMO, "FriendList.tsv"), "utf8");
  const files = [
    { name: "Player_Journey/Gym_battle1.csv", text: gymText, method: 8, flags: 0 },
    { name: "Player_Journey/FriendList.tsv", text: friendsText, method: 0, flags: 0 },
  ];
  const build = async (entries) => {
    const parts = [], central = [];
    let off = 0;
    for (const f of entries) {
      const raw = enc.encode(f.text), data = f.method === 8 ? await deflate(raw) : raw, name = enc.encode(f.name);
      const hdr = [...u32(0x04034b50), ...u16(20), ...u16(f.flags), ...u16(f.method), ...u16(0), ...u16(0), ...u32(CRC(raw)), ...u32(data.length), ...u32(raw.length), ...u16(name.length), ...u16(0)];
      parts.push(new Uint8Array(hdr), name, data);
      central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(f.flags), ...u16(f.method), ...u16(0), ...u16(0), ...u32(CRC(raw)), ...u32(data.length), ...u32(raw.length), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), name);
      off += hdr.length + name.length + data.length;
    }
    const cdSize = central.reduce((a, c) => a + c.length, 0);
    const eocd = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length), ...u32(cdSize), ...u32(off), ...u16(0)]);
    return new File([new Blob([...parts, ...central, eocd])], "Player_Journey.zip");
  };
  zipCtx.__zip = await build(files);
  const z = await vm.runInContext("unzipFile(__zip)", zipCtx);
  zipTests.push(["the reader sees every entry", z.entries.length === 2]);
  zipTests.push(["nothing is flagged encrypted", z.entries.every((e) => !e.encrypted)]);
  zipCtx.__z = z;
  const out = [];
  for (let i = 0; i < z.entries.length; i++) { zipCtx.__i = i; out.push(await vm.runInContext("zipEntryFile(__z, __z.entries[__i])", zipCtx)); }
  zipTests.push(["a deflated entry inflates back to its exact text", (await out[0].text()) === gymText]);
  zipTests.push(["a stored entry comes back byte for byte", (await out[1].text()) === friendsText]);
  zipTests.push(["entries are named by their basename", out.map((f) => f.name).join(",") === "Gym_battle1.csv,FriendList.tsv"]);
  zipCtx.__zip = await build([{ ...files[0], flags: 1 }]);
  const locked = await vm.runInContext("unzipFile(__zip)", zipCtx);
  zipTests.push(["a password-protected entry is recognised, not inflated", locked.entries.length === 1 && locked.entries[0].encrypted === true]);
  zipTests.push(["the shipped app reports ZIP support in this runtime", vm.runInContext("ZIP_OK", zipCtx) === true]);
}

/* ---------- report ---------- */
let failed = 0;
console.log(`\n  parsed ${routed} sample-export files\n`);
for (const [k, want] of Object.entries(GOLDEN)) {
  const got = actual[k];
  const ok = got === want;
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${k.padEnd(30)} ${String(got).padStart(9)}${ok ? "" : `   expected ${want}`}`);
}
console.log("");
for (const [k, ok] of invariants) {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${k}`);
}
console.log("");
for (const [k, ok] of streamTests) {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${k}`);
}
console.log("");
for (const [k, ok] of [...pairTests, ...zipTests]) {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${k}`);
}
const total = Object.keys(GOLDEN).length + invariants.length + streamTests.length + pairTests.length + zipTests.length;
console.log(`\n  ${total - failed}/${total} passed\n`);
process.exit(failed ? 1 : 0);
