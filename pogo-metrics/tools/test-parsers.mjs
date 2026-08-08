/* test-parsers.mjs — a dependency-free regression check for the parsers.
 *
 *   node tools/test-parsers.mjs
 *
 * Runs the SHIPPED js/app.js inside a vm with minimal browser stubs, feeds it
 * every file in demo/manifest.json exactly as the app does, and asserts the
 * numbers the demo is known to produce.
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
const DEMO = path.join(ROOT, "demo");

/* ---------- expected results, measured from the committed demo/ ---------- */
const GOLDEN = {
  "chapters unlocked": 15,
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
  "support tickets": 26,
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
};

/* ---------- the smallest browser the parsers will accept ---------- */
function makeContext() {
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
    document: doc, console,
  };
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
  if (!fs.existsSync(full)) { console.error(`missing demo file: ${rel}`); process.exit(2); }
  const name = rel.split("/").pop();
  ctx.__name = name;
  ctx.__text = fs.readFileSync(full, "utf8");
  vm.runInContext("routeFile(__name, __text)", ctx);
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
];

/* ---------- report ---------- */
let failed = 0;
console.log(`\n  parsed ${routed} demo files\n`);
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
const total = Object.keys(GOLDEN).length + invariants.length;
console.log(`\n  ${total - failed}/${total} passed\n`);
process.exit(failed ? 1 : 0);
