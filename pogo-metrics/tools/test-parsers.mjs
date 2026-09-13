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
 * assertion below moves and this fails. At the end the whole suite runs five
 * more times in child processes: America/New_York and Europe/London (which
 * change their clocks), UTC, and Asia/Kolkata and Asia/Kathmandu (half and
 * three-quarter hours off UTC); a child keeps the zone it was started in. */
if (!process.env.POGO_TEST_CHILD) process.env.TZ = "Etc/GMT+7";   // UTC-7 all year, no clock changes (Etc/ signs are inverted)

import fs from "node:fs";
import { spawnSync } from "node:child_process";
import path from "node:path";
import vm from "node:vm";
import crypto from "node:crypto";
import { createCipheriv, pbkdf2Sync, randomBytes } from "node:crypto";
import { fileURLToPath } from "node:url";
import { scan as scanVendor, check as checkVendor, sri } from "./sri.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");
const DEMO = path.join(ROOT, "sample-export");

/* ------- expected results, measured from the committed sample-export/ ------- */
const GOLDEN = {
  // 15 catalog chapters + the You-vs-friend compare + the Campfire export. (This
  // sat at 15 after the rival JSON joined the manifest — the one stale golden.)
  "chapters unlocked": 17,
  // 14175, not 14176: Join_Raid_lobby2.csv repeats one row byte for byte, and a
  // row repeated inside one file now counts once. No "2" row in the sample sits
  // inside its "1" window without a precise twin, so nothing is added back.
  // The three journey figures below can be recounted without the app — rule
  // for rule, per event: the "1" file's distinct rows, plus the "2" file's
  // distinct rows less those inside the "1" window that match a "1" instant.
  "logged actions": 14175,
  "active days": 875,
  "distinct months": 35,
  "medals parsed": 147,
  "medals declared by Niantic": 147,
  "platinum medals": 51,          // 50 is a hard requirement for level 80
  "gold medals": 11,
  "silver medals": 6,
  "bronze medals": 3,
  "event badges": 76,
  "friends": 489,
  "unfriended": 144,
  "distinct pokestops": 310,
  "trail points": 1298,
  "app sessions": 2368,
  "app installs": 11,
  "fitness days": 22,
  "pokecoins bought": 1096400,
  "live events": 2,
  // Coordinates are generated, not translated (see tools/scrub-demo.mjs), so
  // these two describe the SYNTHETIC world's shape, not anyone's real movement.
  "remote raids": 750,            // the repeated raid row above was a remote raid
  "geo hotspots": 1020,
  "player journey timestamps": 14175,
  // A raw total cannot see a shifted grid — only the shape can. This is the
  // assertion that catches a UTC-vs-local regression in the hour-of-week data.
  "busiest hour-of-week cell": "Sat 22:00",
  "busiest cell count": 553,
  "busiest day of week": "Sat",
  "bag items": 17022,
  "bag kinds": 59,
  "event pass points": 276450,
  "fusion resources": 34280,
  "eggs held": 9,
  "eggs incubating": 3,
  "idle incubators": 21,
  "distinct raid gyms": 416,
  "snapshots": 409,
  "snapshot months": 21,
  // Four conversations, 52 messages between them. Counting rows would call that
  // 52 tickets. The demo fixture renumbers ticket ids CONSISTENTLY so these two
  // numbers can differ — if they ever match again, the fixture has regressed
  // back to one-ticket-per-row and stopped testing the grouping.
  "support tickets": 4,
  "support messages": 52,
  "login countries": 2,
  "coin vendors": 3,
  "free daily boxes": 945,
  "paid bundles": 56,
  "admin grants": 6,
  // The rolling log at the end of Gameplay.txt. "other" is where any line shape
  // the export adds shows up first, and silently unclassified rows are exactly
  // how this file went unread for so long. It sat at 10 while the Scopely-era
  // gift rows ("Received 3 items from <friend>.") went unclassified; they are
  // counted as gifts now — never by name — so a new shape shows up here as 1.
  "recent log rows": 38,
  "recent log caught": 16,
  "recent log fled": 5,
  "recent log unclassified": 0,
  "recent log gifts": 10,
  "recent log gift items": 51,
  "recent log items": 7,
  "recent log best catch": "Latias CP 1965",
  // Gameplay.txt's Referral Connections: eight trainers, counted and never named.
  "referred trainers": 8,
  // App_Installs.csv lists 11 installs from 2022 on; the session log's
  // Install_time names older ones, so the first install is 2021, not 2022. The
  // sample strides the session log 1-in-9, so 19 of the real log's 42 installs
  // survive it; with the 5 App_Installs rows that aren't among them, 24. Of
  // those, 16 are on a device model already installed on.
  "installs on record": 24,
  "first install year": 2021,
  "reinstalls": 16,
  // Device eras: the month-by-month main device, and the public release numbers.
  // The real log has 8 eras and 37 OS versions; the stride folds one short era
  // away and drops two versions.
  "device eras": 7,
  "app versions": 145,
  "os versions": 35,
  // An add-on-only order ships "0" tickets and used to count as one. Both sample
  // orders carry an add-on, written as a yes/no by the scrubber.
  "live-event tickets": 1,
  "live-event orders with an add-on": 2,
  // Wayfarer's logs, counts and months only: 11 candidates shown, 4 reviews
  // sent in, 3 of them with star ratings — all of it inside one month.
  "wayfarer candidates assigned": 11,
  "wayfarer reviews sent in": 4,
  "wayfarer quality ratings": 3,
  "wayfarer active months": 1,
  // Campfire (synthetic): hours at the meetups checked into — its listings run
  // 1, 3 or 8 hours — and how many checked in. The chattiest hour is each
  // message's own local hour, so it moves with the zone: it is read in UTC-7
  // time (2 PM) wherever the suite runs, and the time-zone checks near the end
  // hold it against a count of their own in each run's zone.
  "campfire hours at meetups": 67,
  "campfire typical meetup hours": 1,
  "campfire typical turnout": 13,
  "campfire chattiest local hour": "2 PM",
  // RecentInviteActions: its time field, read at last (the other trainer never
  // is), plus the Party Play files' own times. The weekday is read in UTC-7
  // time here, and checked in each run's own zone near the end.
  "invites with a time": 244,
  "party invites with a time": 24,
  "invite busiest weekday": "Saturday",
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
/* Route the files the way build() does. RAW lists every file, because the
 * Player_Journey "1"/"2" pairing asks it whether a file's twin is present; and
 * "1" files go before their "2" twins, so the window the "2" skips is known.
 * Routing in manifest order with RAW empty would take a code path the browser
 * never does — every "2" parsed as if it were alone. */
ctx.__raw = manifest.files.map((rel) => ({ name: rel.split("/").pop() }));
vm.runInContext("RAW = __raw", ctx);
const pjOrder = vm.runInContext("pjOrder", ctx);
let routed = 0;
for (const rel of [...manifest.files].sort((a, b) => pjOrder(a.split("/").pop()) - pjOrder(b.split("/").pop()))) {
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
/* Some answers move with the zone: the chattiest local hour, the busiest local
 * weekday. Their goldens are measured in UTC-7 time whatever zone the run is
 * in (the child runs keep theirs for everything else). */
function inZone(tz, f) {
  const was = process.env.TZ;
  process.env.TZ = tz;
  try { return f(); } finally { if (was === undefined) delete process.env.TZ; else process.env.TZ = was; }
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
  "recent log gifts": S.recent ? S.recent.gifts : 0,
  "recent log gift items": S.recent ? S.recent.giftItems : 0,
  "referred trainers": S.referrals ? S.referrals.total : 0,
  "installs on record": vm.runInContext("(installHistory() || { total: 0 }).total", ctx),
  "first install year": vm.runInContext("(installHistory() || { first: new Date(NaN) }).first.getUTCFullYear()", ctx),
  "reinstalls": vm.runInContext("(installHistory() || { reinstalls: 0 }).reinstalls", ctx),
  "device eras": vm.runInContext("deviceEras().length", ctx),
  "app versions": Object.keys(S.sessions.apps).length,
  "os versions": Object.keys(S.sessions.oses).length,
  "live-event tickets": S.liveEvents.reduce((a, e) => a + e.tickets, 0),
  "live-event orders with an add-on": S.liveEvents.filter((e) => e.addOn).length,
  "wayfarer candidates assigned": S.wayfarer ? S.wayfarer.assigned : 0,
  "wayfarer reviews sent in": S.wayfarer ? S.wayfarer.logged : 0,
  "wayfarer quality ratings": S.wayfarer && S.wayfarer.ratings["Overall quality"] ? S.wayfarer.ratings["Overall quality"].n : 0,
  "wayfarer active months": S.wayfarer ? Object.keys({ ...S.wayfarer.assignedMonthly, ...S.wayfarer.reviewedMonthly }).length : 0,
  "campfire hours at meetups": S.campfire ? Math.round(S.campfire.hoursOut) : 0,
  "campfire typical meetup hours": S.campfire ? vm.runInContext("medianOf(STATE.campfire.meetupHours)", ctx) : 0,
  "campfire typical turnout": S.campfire ? Math.round(vm.runInContext("medianOf(STATE.campfire.crowd)", ctx)) : 0,
  "campfire chattiest local hour": (String(inZone("Etc/GMT+7", () => vm.runInContext("POST = []; renderCampfire() || ''", ctx))).match(/chattiest hour is <b>([^<]+)<\/b>/) || [])[1] || "—",
  "invites with a time": Object.values(S.invites.slots).reduce((a, b) => a + b, 0),
  "party invites with a time": Object.values(S.party.slots).reduce((a, b) => a + b, 0),
  "invite busiest weekday": (String(inZone("Etc/GMT+7", () => vm.runInContext("POST = []; renderSocial() || ''", ctx))).match(/land on a <b>(\w+)<\/b>/) || [])[1] || "—",
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
  /* The data the report never showed. Install history is the union of both
   * files, so it can only hold MORE installs than App_Installs.csv, and start
   * no later than it does. */
  ...(() => {
    const h = vm.runInContext("installHistory()", ctx);
    const sum = (o) => Object.values(o).reduce((a, b) => a + b, 0);
    const way = S.wayfarer || {};
    const strings = (o) => { const out = []; (function walk(v) { for (const k in v) { const x = v[k]; if (typeof x === "string") out.push(k); else if (x && typeof x === "object" && !(x instanceof Date)) walk(x); } })(o || {}); return out; };
    return [
      ["the install history holds every App_Installs row", !!h && h.total >= S.installs.count],
      ["the first install is no later than App_Installs' own first", !!h && (!S.installs.first || h.first <= S.installs.first)],
      ["new devices and reinstalls never outnumber installs", !!h && h.newDevices + h.reinstalls <= h.total && sum(h.byYear) === h.total],
      ["device-era months never hold more sessions than the log", sum(Object.fromEntries(Object.entries(S.sessions.eraMonths).map(([m, o]) => [m, sum(o)]))) <= S.sessions.total],
      ["platforms and device kinds come from the enumerations only",
        Object.values(S.sessions.deviceKind).every((k) => ["", "iOS", "Android", "Other"].includes(k.platform) && ["", "phone", "tablet"].includes(k.kind))],
      ["every app and OS version is digits and dots", [...Object.keys(S.sessions.apps), ...Object.keys(S.sessions.oses)].every((v) => /^\d+(\.\d+)*$/.test(v))],
      ["gifts never outnumber the log's rows", !S.recent || S.recent.gifts <= S.recent.rows],
      ["wayfarer state carries no text", strings(way).length === 0],
      ["wayfarer ratings are 1 to 5 stars", Object.values(way.ratings || {}).every((r) => r.n > 0 && r.sum >= r.n && r.sum <= 5 * r.n)],
      ["every live-event add-on is a yes or a no", S.liveEvents.every((e) => typeof e.addOn === "boolean" && e.tickets >= 0)],
      ["campfire meetup hours are positive, and capped in the total",
        !S.campfire || (S.campfire.meetupHours.every((x) => x > 0) && S.campfire.hoursOut <= S.campfire.meetupHours.length * vm.runInContext("CF_MAX_HOURS", ctx))],
      ["campfire quarter-hour message tallies sum to the message count", !S.campfire || sum(S.campfire.msgSlotUTC) === S.campfire.messages],
      ["invite quarter-hour tallies match the month tallies", sum(S.invites.slots) === sum(S.invites.monthly) && sum(S.party.slots) === sum(S.party.monthly)],
      ["referrals on the friend list never exceed referrals", !S.referrals || S.referrals.friends <= S.referrals.total],
    ];
  })(),
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
 * positions kept off the map and out of the stop rankings. The sample carries
 * both halves, so the goldens above run through this rule — but only as one
 * fixed case. So it also gets a fresh context, with a "2" built from the "1":
 * every row again four years earlier (outside the window) with its
 * coordinates nudged, the way a blurred cell sits beside the real stop. */
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

/* ---------- untrusted text never becomes markup ----------
 * Every string in an export is text somebody else's code wrote — a column, a
 * ZIP entry, a friend's compare file — and the report builds HTML from it.
 * This feeds a markup payload into every column of every sample file, one
 * column at a time so the rest of each row still parses, then into the header
 * rows on their own, plus the name-shaped lines of Gameplay.txt, and every
 * string and every key in the JSON files (a friend's action names are keys,
 * and they come back as chart labels). Each tainted file is parsed on its own,
 * every chapter build() renders is rendered, their deferred callbacks run —
 * charts included, so each chart's screen-reader table is scanned too — the
 * story slides are built, and every piece of HTML written anywhere is scanned.
 * The payload may only ever appear escaped — and escaped once: "&amp;lt;" is a
 * double escape, and a name with an "&" in it would read "&amp;" on the page. */
const securityTests = [];
const PAYLOAD = `<zq1>"zq2'&zq3;`;
const HTML_OUT = [];
function recordingElement(tag, parentless) {
  const rec = { html: "", text: "", style: {}, dataset: {}, children: [], attrs: {} };
  return new Proxy(function () {}, {
    get(t, k) {
      if (k === Symbol.iterator) return function* () {};
      if (k === Symbol.toPrimitive) return () => 0;
      if (typeof k === "symbol" || k === "then") return undefined;
      if (k === "innerHTML" || k === "outerHTML") return rec.html;
      if (k === "textContent" || k === "innerText") return rec.text;
      if (k === "style" || k === "dataset" || k === "children") return rec[k];
      // chartA11y writes each chart's data table into the canvas's parent; one level is enough
      if (k === "parentElement") return parentless ? null : recordingElement("div", true);
      if (k === "classList") return { add() {}, remove() {}, toggle() {}, contains: () => false };
      if (k === "insertAdjacentHTML") return (pos, h) => { HTML_OUT.push(String(h)); };
      if (k === "setAttribute") return (a, v) => { rec.attrs[a] = String(v); };
      if (k === "getAttribute") return (a) => rec.attrs[a] ?? null;
      if (k === "querySelectorAll" || k === "getElementsByTagName") return () => [];
      if (k === "querySelector" || k === "closest" || k === "getContext") return () => null;
      if (k === "getBoundingClientRect") return () => ({ top: 0, left: 0, right: 0, bottom: 0, width: 0, height: 0 });
      if (k in rec) return rec[k];
      return () => undefined;   // any other method is a no-op
    },
    set(t, k, v) {
      if (k === "innerHTML" || k === "outerHTML") { rec.html = String(v); HTML_OUT.push(rec.html); }
      else if (k === "textContent" || k === "innerText") rec.text = String(v);
      else rec[k] = v;
      return true;
    },
  });
}
function makeRecordingContext() {
  const noop = () => {};
  const rctx = makeContext({
    document: {
      addEventListener: noop, removeEventListener: noop, createElement: recordingElement,
      createTreeWalker: () => ({ nextNode: () => false }), getElementById: recordingElement,
      querySelector: () => null, querySelectorAll: () => [],
      body: recordingElement(), documentElement: recordingElement(), head: recordingElement(), fonts: { ready: Promise.resolve() },
    },
    console: { ...console, warn: noop, log: noop, info: noop },
    location: { search: "", hash: "", protocol: "https:", hostname: "test" },
    history: { replaceState: noop, pushState: noop },
    cancelAnimationFrame: noop, dispatchEvent: noop, innerWidth: 1200, innerHeight: 800, scrollY: 0,
    getComputedStyle: () => ({ getPropertyValue: () => "" }), TextEncoder, TextDecoder, URL, Blob, File,
    DecompressionStream, Response,   // so a dropped ZIP opens here too, and its name reaches the file list
    crypto: globalThis.crypto,       // copies are told apart by the SHA-256 of their bytes
  });
  load(rctx, "js/pokedex.js");
  load(rctx, "js/catalog.js");
  load(rctx, "js/app.js");
  // The stub keeps the data it was given: chartA11y reads the labels back off
  // the chart to build its screen-reader table, and those labels are export text.
  vm.runInContext(`window.Chart = function (cv, cfg) { this.data = cfg && cfg.data; this.options = cfg && cfg.options; this.destroy = this.resize = this.update = function () {}; };
    Chart.defaults = { plugins: { tooltip: {}, legend: { labels: {} }, title: {} }, font: {}, elements: { line: {}, point: {}, bar: {}, arc: {} }, scale: { grid: {}, ticks: {} } };
    Chart.overrides = { doughnut: { plugins: {} } };`, rctx);
  return rctx;
}
// the chapter list is read from build() itself, so a new chapter is covered the day it lands
const CHAPTERS = [...fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8").matchAll(/^\s*safe\((render\w+)\);/gm)].map((m) => m[1]);
function renderEverything(rctx) {
  HTML_OUT.length = 0;
  const run = (c) => vm.runInContext(c, rctx);
  run("POST = []");
  const threw = [];
  for (const fn of ["resHero", ...CHAPTERS, "outro"]) {
    try { const h = run(`${fn}()`); if (h) HTML_OUT.push(String(h)); } catch (e) { threw.push(fn); }
  }
  for (const cb of run("POST")) { try { cb(); } catch (e) { /* a chart or map the stub DOM can't host */ } }
  run("POST = []");
  // storyMode() writes each slide's kicker, big line and label straight into innerHTML
  try { for (const s of run("storySlides()")) HTML_OUT.push(`${s.kicker}\n${s.big || ""}\n${s.label}`); } catch (e) { threw.push("storySlides"); }
  return { html: HTML_OUT.join("\n"), threw };
}
/* A CSV record can span lines: Campfire's message bodies are quoted and hold
 * line breaks. Split into records the way the app's csvRecords() does, never
 * into lines — re-quoting half a message shifts every record after it, and the
 * sections that follow are then read as something else, or not at all. */
function csvRows(text) {
  const recs = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); recs.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  if (cell.length || row.length) { row.push(cell); recs.push(row); }
  return recs;
}
const csvCell = (v) => (/[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v);
const isDelimited = (name) => !/\.json$/i.test(name) && !/^Gameplay\.txt$/i.test(name);
const rowsOf = (name, text) => (/\.(tsv|txt)$/i.test(name)
  ? text.replace(/\r?\n$/, "").split(/\r?\n/).map((l) => l.split("\t"))
  : csvRows(text));
// how many records a delimited file holds, and how many cells each one has
const shapeOf = (name, text) => rowsOf(name, text).map((r) => r.length).join(",");
function taintedVariants(name, text) {
  if (/^Gameplay\.txt$/i.test(name)) return [
    ["every line", text.split("\n").map((l) => (l.trim() ? l + PAYLOAD : l)).join("\n")],
    // the payload INSIDE each name the parsers pull out: medals, species, bag items, the recent log
    ["every name", text.split("\n").map((l) => {
      if (/^\s*Badge: /.test(l)) return l.replace(/^(\s*Badge: )/, "$1" + PAYLOAD);
      if (/^\t[A-Za-z]/.test(l)) return "\t" + PAYLOAD + l.slice(1);
      if (/^\d[^\t]*\t/.test(l)) return l.replace(/^(\d[^\t]*\t)/, "$1" + PAYLOAD);
      return l;
    }).join("\n")],
  ];
  if (/\.json$/i.test(name)) {
    const j = JSON.parse(text);
    (function walk(o) { for (const k in o) { if (typeof o[k] === "string") o[k] += PAYLOAD; else if (o[k] && typeof o[k] === "object") walk(o[k]); } })(j);
    const out = [["every string", JSON.stringify(j)]];
    // …and every key, one depth at a time: a friend's action names are keys,
    // and parseCompare hands them to a chart as labels. The top level stays as
    // it is, or the file would not be recognised at all; arrays keep their indices.
    for (let depth = 1; ; depth++) {
      let renamed = 0;
      const rename = (o, d) => {
        if (!o || typeof o !== "object") return o;
        if (Array.isArray(o)) return o.map((v) => rename(v, d + 1));
        const r = {};
        for (const k of Object.keys(o)) r[d === depth ? (renamed++, k + PAYLOAD) : k] = rename(o[k], d + 1);
        return r;
      };
      const v = rename(JSON.parse(text), 0);
      if (!renamed) break;
      out.push([`every key ${depth} level${depth === 1 ? "" : "s"} down`, JSON.stringify(v)]);
    }
    return out;
  }
  const tsv = /\.(tsv|txt)$/i.test(name);
  const rows = rowsOf(name, text);
  const write = (rs) => rs.map((r) => (tsv ? r.join("\t") : r.map(csvCell).join(","))).join("\n") + (/\n$/.test(text) ? "\n" : "");
  // measured over the whole file: Campfire's sections run from 2 to 10 columns, and the wide ones come last
  const ncol = Math.max(...rows.map((r) => r.length));
  // A header row is left alone while its columns are tainted, so every tainted
  // cell is still read under its own column name. That is the first row — or,
  // in a file of titled sections like Campfire's, the row after each title.
  let expectHeader = true;
  const role = rows.map((r) => {
    if (!r.some((c) => c.trim())) return "blank";
    if (r.length === 1 && ncol > 1) { expectHeader = true; return "title"; }
    if (expectHeader) { expectHeader = false; return "header"; }
    return "data";
  });
  const out = [];
  for (let c = 0; c < ncol; c++) {
    out.push(["column " + (c + 1), write(rows.map((r, i) => (role[i] === "data" && c < r.length ? r.map((v, j) => (j === c ? v + PAYLOAD : v)) : r)))]);
  }
  // …then the header rows and section titles themselves, which the parsers read as well
  out.push(["headers", write(rows.map((r, i) => (role[i] === "header" || role[i] === "title" ? r.map((v) => v + PAYLOAD) : r)))]);
  return out;
}
{
  const rctx = makeRecordingContext();
  securityTests.push([`the taint test sees every chapter build() renders (${CHAPTERS.length})`, CHAPTERS.length >= 17]);
  const reached = new Set(), reachedBy = new Set(), ran = new Set();
  for (const rel of manifest.files) {
    const name = rel.split("/").pop();
    const original = fs.readFileSync(path.join(DEMO, rel), "utf8");
    const vars = taintedVariants(name, original);
    const shape = isDelimited(name) && shapeOf(name, original);
    const bad = [];
    for (const [label, text] of vars) {
      ran.add(name + ": " + label);
      // a payload that moved a cell or swallowed a record would be testing the wrong field
      if (shape && shapeOf(name, text) !== shape) bad.push(label + ": rows shifted");
      vm.runInContext("STATE = freshState(); POST = []", rctx);
      rctx.__n = name; rctx.__t = text;
      vm.runInContext("RAW = [{ name: __n }]", rctx);
      await vm.runInContext("routeFile(__n, __t)", rctx);
      const { html, threw } = renderEverything(rctx);
      if (/<zq1/i.test(html)) bad.push(label + ": raw markup");
      if (/"zq2'/i.test(html)) bad.push(label + ": unescaped quotes");
      if (/&amp;(?:lt;zq1|quot;zq2|amp;zq3)/i.test(html)) bad.push(label + ": escaped twice");
      if (threw.length) bad.push(label + ": " + threw.join(", ") + " threw");
      if (/&lt;zq1/i.test(html)) { reached.add(name); reachedBy.add(name + ": " + label); }
    }
    securityTests.push([`taint: ${name} — ${vars.length} variant${vars.length === 1 ? "" : "s"}, all rendered as text${bad.length ? "  [" + bad.slice(0, 3).join("; ") + "]" : ""}`, !bad.length]);
  }
  // a control: the payload has to actually REACH the page for the scan above to mean anything
  const mustReach = ["Gameplay.txt", "FriendList.tsv", "InAppPurchases.tsv", "App_Sessions.csv", "pogo-metrics-stats-rival.json"];
  securityTests.push([`the payload does reach the page, escaped (${reached.size} files)`, mustReach.every((n) => reached.has(n))]);
  // …and by the path a friend's action NAMES take: keys, drawn as chart labels and written into the chart's data table
  securityTests.push(["a friend's action names reach the chart's data table, escaped", reachedBy.has("pogo-metrics-stats-rival.json: every key 1 level down")]);
  /* Every field the device-era, install, Campfire-hours, invite-timing, add-on
   * and Wayfarer panels read has to be IN the sample, or the loop above never
   * taints it. Columns are found by header; RecentInviteActions has none, so
   * its time and result are columns 2 and 4 (column 3, the other trainer, is
   * tainted too, and must simply never show up). */
  const colOf = (rel, field) => {
    const name = rel.split("/").pop();
    for (const r of rowsOf(name, fs.readFileSync(path.join(DEMO, rel), "utf8"))) { const i = r.indexOf(field); if (i >= 0) return i + 1; }
    return 0;
  };
  const cfRel = manifest.files.find((f) => /_\d{8}_\d{6}\.csv$/.test(f));
  const NEW_FIELDS = [
    ["Player_Journey/App_Sessions.csv", ["Install_time", "App_version", "OS_version", "Platform", "Device_category"]],
    ["Player_Journey/App_Installs.csv", ["Install_time"]],
    ["LiveEventRegistrationHistory_AsPurchaser.tsv", ["Number of Tickets on Order", "AddOn Info"]],
    [cfRel, ["Event End Time", "RSVP count", "Check-in count", "Sent At"]],
    ["ActivityInvitesReceived.tsv", ["Date and time of invite (UTC)"]],
  ];
  const untainted = NEW_FIELDS.flatMap(([rel, fields]) => fields.filter((f) => { const c = colOf(rel, f); return !c || !ran.has(`${rel.split("/").pop()}: column ${c}`); }));
  for (const need of ["RecentInviteActions.tsv: column 2", "RecentInviteActions.tsv: column 4", "Gameplay.txt: every line",
    "wayfarer_player_data.json: every string", "wayfarer_player_data.json: every key 1 level down", "wayfarer_player_data.json: every key 2 levels down"]) if (!ran.has(need)) untainted.push(need);
  securityTests.push([`the taint test feeds every field the new panels read${untainted.length ? "  [missing: " + untainted.join(", ") + "]" : ""}`, !untainted.length]);
}

/* ---------- currency codes ----------
 * The Currency columns reach a headline tile and a subtitle as raw HTML. Only
 * a three-letter code survives parsing; anything else is "UNKNOWN". */
{
  const cctx = makeContext();
  load(cctx, "js/pokedex.js");
  load(cctx, "js/catalog.js");
  load(cctx, "js/app.js");
  const codes = ["USD", "eur", " GBP ", "<img src=x onerror=alert(1)>", "US$", "", "USDT", "12€"];
  cctx.__p = "Date and time\tType of activity\tItem purchased\tNumber of items\tChange in pokecoins\tMoney spent on purchase\tVendor\tCurrency\n"
    + codes.map((c) => `2025-01-02 10:00:00 UTC\tPokecoin bought\t\t1\t100\t0.99\tAPPLE\t${c}`).join("\n") + "\n";
  cctx.__l = "Event Details\tNumber of Tickets on Order\tTotal Paid\tCurrency Paid\tDate of Order Placed\n"
    + "Event A, City\t1\t30\tUSD\t2025-01-02 10:00:00 UTC\nEvent B, City\t2\t60\t<svg onload=alert(1)>\t2025-02-02 10:00:00 UTC\nEvent C, City\t1\t0\t\t2025-03-02 10:00:00 UTC\n";
  await vm.runInContext('routeFile("InAppPurchases.tsv", __p)', cctx);
  await vm.runInContext('routeFile("LiveEventRegistrationHistory_AsPurchaser.tsv", __l)', cctx);
  const S3 = vm.runInContext("STATE", cctx);
  securityTests.push(["only three-letter currency codes survive a purchase row",
    Object.keys(S3.spend.cur).sort().join(",") === "EUR,GBP,UNKNOWN,USD"]);
  securityTests.push(["live-event currencies are a code, UNKNOWN, or blank",
    S3.liveEvents.map((e) => e.currency).join(",") === "USD,UNKNOWN,"]);
  const spendHTML = vm.runInContext("renderSpending()", cctx) + vm.runInContext("renderLiveEvents()", cctx);
  securityTests.push(["a markup currency renders as UNKNOWN, never as markup",
    /Spent \(UNKNOWN\)/.test(spendHTML) && !/<img|<svg/i.test(spendHTML)]);
}

/* ---------- one esc(), four copies ----------
 * app.js, landing.js, catalog-ui.js and trainer-model.js each carry their own.
 * All four must encode both quote kinds, or an escaped value can still close
 * the attribute it sits in. Pulled out of the shipped source and run as-is. */
for (const f of ["js/app.js", "js/landing.js", "js/catalog-ui.js", "js/trainer-model.js"]) {
  const m = fs.readFileSync(path.join(ROOT, f), "utf8").match(/const esc = (\(s\) =>[\s\S]*?\));\n/);
  let out = null;
  try { out = m && vm.runInNewContext(`(${m[1]})`)(`<a href="x" title='y'>&`); } catch (e) { out = String(e); }
  securityTests.push([`esc() in ${f} encodes < > & " and '`, out === "&lt;a href=&quot;x&quot; title=&#39;y&#39;&gt;&amp;"]);
}

/* ---------- the compare file ----------
 * What the report offers to send a friend. It may carry the trainer name, the
 * action totals, actions per month and per day, and the friend count — and
 * nothing else. parseCompare must read it, the full stats file older builds
 * offered for the same job, and the committed rival sample alike. */
{
  // key order may differ between a parsed file and STATE, so compare by content
  const deepEq = (a, b) => {
    if (a === b) return true;
    if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
    const ka = Object.keys(a), kb = Object.keys(b);
    return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && deepEq(a[k], b[k]));
  };
  const readCompare = async (name, text) => {
    const c = makeContext();
    load(c, "js/pokedex.js");
    load(c, "js/catalog.js");
    load(c, "js/app.js");
    c.__n = name; c.__t = text;
    await vm.runInContext("routeFile(__n, __t)", c);
    return vm.runInContext("STATE.compare", c);
  };
  const cmpFile = vm.runInContext("compareFileData()", ctx);
  const fullFile = vm.runInContext("statsFileData()", ctx);
  securityTests.push(["the compare file holds only name, totals, months, days and friend count",
    Object.keys(cmpFile).sort().join(",") === "dayCounts,friends,generated,monthly,note,profile,source,totalsByAction"
    && Object.keys(cmpFile.profile).join(",") === "username" && Object.keys(cmpFile.friends).join(",") === "total"]);
  const mine = { who: S.profile.username, totals: S.ev.totals, monthly: S.ev.byMonth, dayCounts: S.ev.dayCounts, friends: S.friends.rows.length };
  const matches = (got, want) => !!got && got.who === want.who && deepEq(got.totals, want.totals)
    && deepEq(got.monthly, want.monthly) && deepEq(got.dayCounts, want.dayCounts) && got.friends === want.friends;
  securityTests.push(["a compare file round-trips: name, totals, months, days, friends",
    matches(await readCompare("pogo-metrics-stats-AshDemo.json", JSON.stringify(cmpFile)), mine)]);
  securityTests.push(["an old full stats file still reads as a compare file",
    matches(await readCompare("pogo-metrics-stats.json", JSON.stringify(fullFile)), mine)]);
  const rivalText = fs.readFileSync(path.join(DEMO, "pogo-metrics-stats-rival.json"), "utf8");
  const rival = JSON.parse(rivalText);
  securityTests.push(["the committed rival sample still reads",
    matches(await readCompare("pogo-metrics-stats-rival.json", rivalText),
      { who: rival.profile.username, totals: rival.totalsByAction, monthly: rival.monthly, dayCounts: rival.dayCounts, friends: rival.friends.total })]);
  const hostile = await readCompare("pogo-metrics-stats-x.json", JSON.stringify({
    source: "POGO Metrics", profile: { username: "x".repeat(200) },
    totalsByAction: { Spins: "12", Raids: -3, Catches: "lots" },
    monthly: { "2025-01": { Spins: 2 }, "9999-99-99": { Spins: 9 }, "2025-02": "nope" },
    dayCounts: { "2025-01-02": 4, "../x": 7, "2025-01-03": "5" },
  }));
  securityTests.push(["a hostile compare file is cut down to plain counts and dates",
    !!hostile && hostile.who.length <= 40 && deepEq(hostile.totals, { Spins: 12 })
    && deepEq(hostile.monthly, { "2025-01": { Spins: 2 } }) && deepEq(hostile.dayCounts, { "2025-01-02": 4, "2025-01-03": 5 })]);
}

/* ---------- a broken #fragment ----------
 * decodeURIComponent throws on a malformed %-escape. A shared link with one
 * must not be able to throw out of the report's deep-link handling. */
{
  const hctx = makeContext({ location: { search: "", hash: "#%E0%A4%A", protocol: "https:", hostname: "test" } });
  load(hctx, "js/pokedex.js");
  load(hctx, "js/catalog.js");
  load(hctx, "js/app.js");
  let ok = true;
  for (const h of ["#%E0%A4%A", "#ch-%", "#ch-your-world%ZZ"]) {
    hctx.location.hash = h;
    try { vm.runInContext("gotoChapterFromHash()", hctx); } catch (e) { ok = false; }
  }
  securityTests.push(["a malformed chapter link is ignored, not thrown", ok]);
}

/* ---------- subresource integrity ----------
 * Every vendor script and stylesheet carries a sha384 of its committed bytes.
 * sw.js serves /vendor/ cache-first and Netlify marks it immutable for a year,
 * so without that a copy gone bad in either cache would keep running. The flip
 * side is that a value which drifts from its file makes the browser refuse the
 * library outright — the charts or the globe just don't draw — so a drift has
 * to fail here first. `node tools/sri.mjs --write` brings every value back in
 * line. The map is read from the shipped app, not re-parsed, so this checks
 * the hashes the browser will actually be handed. */
const vendor = scanVendor();
const tags = vendor.refs.filter((r) => r.kind !== "on demand");
const sriCtx = makeContext();
load(sriCtx, "js/pokedex.js");
load(sriCtx, "js/catalog.js");
load(sriCtx, "js/app.js");
const liveSri = vm.runInContext("VENDOR_SRI", sriCtx);
// catch the elements ensureScript / ensureCSS put in <head>
const appended = [];
sriCtx.document.head = { appendChild: (n) => appended.push(n) };
sriCtx.__js = Object.keys(liveSri).find((p) => p.endsWith(".js"));
sriCtx.__css = Object.keys(liveSri).find((p) => p.endsWith(".css"));
vm.runInContext("ensureScript(__js); ensureCSS(__css)", sriCtx);
// Refuse both first tries: each must go once more at a fresh address with the
// same hash. Refuse the script's second try as well, and its slot must free up
// so "Try again" starts over. (This context has no `caches`, so nothing to drop.)
const tagsFor = (p) => appended.filter((n) => String(n.src || n.href || "").split("?")[0] === p);
let scriptRejected = false;
vm.runInContext("_libLoads[__js]", sriCtx).catch(() => { scriptRejected = true; });
tagsFor(sriCtx.__js)[0].onerror();
tagsFor(sriCtx.__css)[0].onerror();
await new Promise((r) => setTimeout(r, 0));
const [, scriptRetry] = tagsFor(sriCtx.__js), [, cssRetry] = tagsFor(sriCtx.__css);
scriptRetry?.onerror();
await new Promise((r) => setTimeout(r, 0));
vm.runInContext("ensureScript(__js)", sriCtx);
const scriptAgain = tagsFor(sriCtx.__js)[2];
// The og-card pages are render sources for the share images and may be opened
// straight from disk. Chrome refuses an integrity check on a file:// response,
// so a hash there would silently drop their fonts.
const ogCards = fs.readdirSync(ROOT).filter((f) => /^og-card.*\.html$/.test(f));
// one flipped bit in a vendor file must fail the check, or the check proves nothing
const flipped = (() => {
  const r = tags[0];
  if (!r) return false;
  const bytes = fs.readFileSync(path.join(ROOT, r.path));
  bytes[bytes.length - 1] ^= 1;
  const bad = "sha384-" + crypto.createHash("sha384").update(bytes).digest("base64");
  return checkVendor({ ...vendor, refs: [{ ...r, integrity: bad }] }).length === 1;
})();
// addAll() is atomic: one missing file in CORE fails the whole install, and the
// app is left with no offline cache at all. A renamed vendor file makes that easy.
const swCore = (() => {
  const m = /const CORE = \[([\s\S]*?)\];/.exec(fs.readFileSync(path.join(ROOT, "sw.js"), "utf8"));
  return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1].split("?")[0].replace(/^\//, "") || "index.html") : [];
})();
const sriTests = [
  [`vendor tags are found in the pages (${tags.length})`, tags.some((r) => r.kind === "script") && tags.some((r) => r.kind === "stylesheet")],
  ["every vendor script and stylesheet tag carries a current sha384",
    tags.every((r) => r.integrity && fs.existsSync(path.join(ROOT, r.path)) && r.integrity === sri(r.path))],
  ["every library app.js loads on demand has a VENDOR_SRI entry", vendor.loads.length > 0 && vendor.loads.every((p) => liveSri[p])],
  ["every VENDOR_SRI value matches its file's bytes",
    Object.entries(liveSri).every(([p, h]) => fs.existsSync(path.join(ROOT, p)) && h === sri(p))],
  ["VENDOR_SRI lists nothing that isn't loaded", Object.keys(liveSri).every((p) => vendor.loads.includes(p))],
  ["tools/sri.mjs reads the same map the app runs with",
    JSON.stringify(Object.entries(vendor.map).sort()) === JSON.stringify(Object.entries(liveSri).sort())],
  ["ensureScript puts the hash on the script tag", appended[0]?.src === sriCtx.__js && appended[0]?.integrity === liveSri[sriCtx.__js]],
  ["ensureCSS puts the hash on the stylesheet link", appended[1]?.href === sriCtx.__css && appended[1]?.integrity === liveSri[sriCtx.__css]],
  ["a refused library is tried once more at a fresh address, with the same hash",
    !!scriptRetry && /\?retry=\w+$/.test(scriptRetry.src) && scriptRetry.integrity === liveSri[sriCtx.__js]],
  ["so is a refused stylesheet", !!cssRetry && /\?retry=\w+$/.test(cssRetry.href) && cssRetry.integrity === liveSri[sriCtx.__css]],
  ["a second failure frees the load, so Try again starts over", scriptRejected && scriptAgain?.src === sriCtx.__js],
  [`the og-card render sources load fonts.css with no integrity (${ogCards.length})`,
    ogCards.length > 0 && !vendor.refs.some((r) => ogCards.includes(r.file)) && ogCards.every((f) => {
      const t = fs.readFileSync(path.join(ROOT, f), "utf8");
      return t.includes("vendor/fonts/fonts.css") && !/\sintegrity\s*=/i.test(t);
    })],
  ["one flipped bit in a vendor file fails the check", flipped],
  ["every file sw.js precaches is on disk", swCore.length > 0 && swCore.every((p) => fs.existsSync(path.join(ROOT, p)))],
  // What a page opened offline straight after a first visit asks for: the
  // manifest every page links, and the fonts, which a first visit fetches
  // before the worker controls it. Missing either was an error on every page.
  ["sw.js precaches the web manifest every page links, and every face fonts.css names",
    swCore.includes("site.webmanifest") && (() => {
      const faces = [...fs.readFileSync(path.join(ROOT, "vendor/fonts/fonts.css"), "utf8").matchAll(/url\(([^)]+)\)/g)].map((m) => "vendor/fonts/" + m[1].replace(/["']/g, ""));
      return faces.length > 0 && faces.every((f) => swCore.includes(f));
    })()],
  // …and the Live Example's sample, from the manifest loadDemo() reads. It is
  // best-effort, outside CORE, so it can never fail the install.
  ["…and the Live Example's sample, from the same manifest loadDemo() reads, outside CORE",
    (() => {
      const sw = fs.readFileSync(path.join(ROOT, "sw.js"), "utf8"), app = fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8");
      const m = /const SAMPLE = "([^"]+)"/.exec(sw);
      return !!m && app.includes(`fetch("${m[1]}")`) && fs.existsSync(path.join(ROOT, m[1]))
        && !swCore.some((p) => p.startsWith("sample-export/")) && /precacheSample\(c\)/.test(sw);
    })()],
];


/* ---------- encounters, not catches ----------
 * catchesOf() adds GO Plus catches to map, incense and lure ENCOUNTERS, and none
 * of those three files records whether the Pokémon was caught. Every label on
 * that sum says "encountered" — the story, the page and PNG year cards, the
 * milestones, the records, then-vs-now and the stats. Rendered from the sample,
 * in the context the goldens above were measured in. */
const labelTests = [];
{
  const render = (fn) => { try { return String(vm.runInContext(`${fn}() || ""`, ctx)); } catch (e) { return "THREW " + e.message; } };
  const CAUGHT = /Pokémon caught|Most caught|>Catches</;
  for (const fn of ["renderTrainer", "renderActivity", "renderRecords", "renderYearOverYear"]) {
    const html = render(fn);
    labelTests.push([`${fn} calls the sum encounters, never catches`,
      html.length > 0 && !html.startsWith("THREW") && /Pokémon encountered/.test(html) && !CAUGHT.test(html)]);
  }
  const slides = vm.runInContext("JSON.stringify([storySlides(), ...[...new Set(Object.keys(STATE.ev.byMonth).map((m) => m.slice(0, 4)))].map((y) => storySlides(y))])", ctx);
  labelTests.push(["every story, lifetime and per year, says encountered", /Pokémon encountered/.test(slides) && !CAUGHT.test(slides)]);
  const cards = JSON.parse(vm.runInContext("JSON.stringify((() => { const { years, data } = buildYearData(); return years.map((y) => yearCardStats(data[y])); })())", ctx));
  labelTests.push(["the year card and its PNG share one tile list, led by encounters",
    cards.length > 0 && cards.every((tiles) => tiles[0][1] === "Pokémon encountered")]);
}

/* ---------- GO Fest dates and the "I was there" badge ----------
 * An in-person festival counts only when a PRECISE position — from a "1" file —
 * puts the trainer inside its city box during the event's own local dates.
 * Every trip here is synthetic: one row at Grant Park (GO Fest 2026: Chicago,
 * June 5–7, UTC-5) or somewhere deliberately wrong, each in a fresh context. */
const festTests = [];
{
  const HDR = "Player_Latitude,Player_Longitude,Fort_Latitude,Fort_Longitude,Timestamp\n";
  const at = (lat, lon, when) => `${lat},${lon},${lat},${lon},${when}`;
  const grant = (when) => at(41.8757, -87.6189, when);
  const fresh = () => { const c = makeContext(); load(c, "js/pokedex.js"); load(c, "js/catalog.js"); load(c, "js/app.js"); return c; };
  const trip = async (files) => {
    const c = fresh();
    c.__names = files.map(([name]) => name);
    vm.runInContext("RAW = __names.map((name) => ({ name }))", c);
    for (const [name, rows] of files) {
      c.__n = name; c.__t = HDR + rows.join("\n") + "\n";
      await vm.runInContext("routeFile(__n, __t)", c);
    }
    return {
      badges: JSON.parse(vm.runInContext("JSON.stringify(festBadges())", c)),
      label: (iso) => { c.__iso = iso; return vm.runInContext("eventFor(__iso)", c); },
      run: (code) => vm.runInContext(code, c),
    };
  };
  const there = await trip([["Pokestop_spin1.csv", [grant("2026-06-06 18:00:00.000 UTC")]]]);
  festTests.push(["a precise position in the city during the event earns the badge",
    there.badges.length === 1 && there.badges[0] === "🎪 I was there · GO Fest Chicago 2026"]);
  festTests.push(["the badge names a city and a year, nothing finer",
    there.badges.every((b) => /^🎪 I was there · GO Fest [A-Z][A-Za-z ]+ \d{4}$/.test(b))]);
  festTests.push(["festival state keeps counts and days, never a position",
    !/41\.87|87\.61/.test(there.run("JSON.stringify(STATE.ev.there)"))]);
  festTests.push(["the day is labelled with the festival, and only that day",
    /GO Fest 2026 \(Chicago\)/.test(there.label("2026-06-06") || "") && there.label("2026-06-05") === null]);
  const lastEvening = await trip([["Pokestop_spin1.csv", [grant("2026-06-08 03:00:00.000 UTC")]]]);  // 22:00 on Jun 7 in Chicago
  festTests.push(["the last evening earns the badge in local time, but its UTC day is no festival day",
    lastEvening.badges.length === 1 && lastEvening.label("2026-06-08") === null]);
  /* Tokyo runs nine hours ahead of UTC, so its first morning is still May 28 in
   * the app's UTC days. The badge follows local time; a day label only ever
   * lands on one of the festival's own dates. */
  const tokyoMorning = await trip([["Pokestop_spin1.csv", [at(35.6298, 139.7745, "2026-05-28 22:00:00.000 UTC")]]]); // 07:00 on May 29 in Tokyo
  festTests.push(["a Tokyo breakfast on day one earns the badge without labelling May 28",
    tokyoMorning.badges.length === 1 && /Tokyo 2026$/.test(tokyoMorning.badges[0])
    && tokyoMorning.label("2026-05-28") === null && tokyoMorning.label("2026-05-29") === null]);
  const tokyoNoon = await trip([["Pokestop_spin1.csv", [at(35.6298, 139.7745, "2026-05-29 03:00:00.000 UTC")]]]);    // 12:00 on May 29 in Tokyo
  festTests.push(["a Tokyo lunchtime labels May 29, the festival's first day",
    /GO Fest 2026 \(Tokyo\)/.test(tokyoNoon.label("2026-05-29") || "")]);
  festTests.push(["every in-person day label falls on one of that festival's own dates",
    [there, lastEvening, tokyoMorning, tokyoNoon].every((t) => t.run(
      "FEST_VENUES.every((v) => !STATE.ev.there[v.id] || Object.keys(STATE.ev.there[v.id].days).every((d) => d >= v.from && d <= v.to))"))]);
  const nextMorning = await trip([["Pokestop_spin1.csv", [grant("2026-06-08 06:00:00.000 UTC")]]]); // 01:00 on Jun 8 in Chicago
  festTests.push(["the morning after does not", nextMorning.badges.length === 0]);
  const blurredOnly = await trip([["Pokestop_spin2.csv", [grant("2026-06-06 18:00:00.000 UTC")]]]);
  festTests.push(["a blurred \"2\" position never qualifies on its own",
    blurredOnly.badges.length === 0 && blurredOnly.label("2026-06-06") === null && blurredOnly.run("STATE.ev.totals.Spins") === 1]);
  const blurredTwin = await trip([
    ["Pokestop_spin1.csv", [grant("2026-07-20 18:00:00.000 UTC")]],
    ["Pokestop_spin2.csv", [grant("2026-06-06 18:00:00.000 UTC"), grant("2026-07-20 18:00:00.000 UTC")]],
  ]);
  festTests.push(["nor beside a precise twin, outside that twin's window",
    blurredTwin.badges.length === 0 && blurredTwin.run("STATE.ev.totals.Spins") === 2]);
  const wrongDate = await trip([["Pokestop_spin1.csv", [grant("2026-06-20 18:00:00.000 UTC")]]]);
  festTests.push(["the right city on the wrong dates earns nothing", wrongDate.badges.length === 0]);
  const wrongCity = await trip([["Pokestop_spin1.csv", [at(55.7006, 12.5717, "2026-06-06 18:00:00.000 UTC")]]]);
  festTests.push(["the right dates in the wrong city earn nothing",
    wrongCity.badges.length === 0 && wrongCity.label("2026-06-06") === null]);
  const nobody = await trip([]);
  festTests.push(["global festivals label anyone's day",
    /2026 \(Global\)/.test(nobody.label("2026-07-11") || "") && /Mega Finale/.test(nobody.label("2026-09-06") || "")]);
  festTests.push(["an in-person date is no festival day for a trainer who wasn't there",
    nobody.label("2026-06-06") === null && nobody.label("2025-06-14") === null]);
  festTests.push(["no two festivals overwrite each other's days",
    nobody.run("GO_FESTS.filter((f) => !f.box).every((f) => festDays(f).every((d) => GO_EVENTS[d].split(' · ').includes(f.name)))")]);
  festTests.push(["every in-person festival's park sits inside its city box",
    nobody.run("FEST_VENUES.every((v) => v.venue[0] >= v.box[0] && v.venue[0] <= v.box[2] && v.venue[1] >= v.box[1] && v.venue[1] <= v.box[3])")]);
  festTests.push(["the 2022 Finale was one day, August 27",
    /2022 Finale/.test(nobody.label("2022-08-27") || "") && nobody.label("2022-08-28") === null]);

  /* The PNG: a stub canvas records what downloadYearCard draws, measuring text
   * at a flat 12 px a character, near the card's 23 px badge font. A crowded
   * card (three festivals, five awards, eight tiles, nine series) needs four
   * rows of badges; it used to keep two and drop the rest without a word. */
  const drawCard = async (o) => {
    const c = fresh();
    const drawn = [], cv = { width: 300, height: 150 };
    const ctx2d = new Proxy({}, {
      get: (s, k) => (k in s ? s[k]
        : k === "measureText" ? (t) => ({ width: String(t).length * 12 })
        : k === "fillText" ? (t, x, y) => { drawn.push({ t: String(t), y }); }
        : typeof k === "string" && /^create\w*Gradient$/.test(k) ? () => ({ addColorStop() {} })
        : () => {}),
      set: (s, k, v) => { s[k] = v; return true; },
    });
    cv.getContext = () => ctx2d;
    cv.toBlob = () => { cv.done = [cv.width, cv.height]; };
    c.document.createElement = () => cv;
    c.__o = o;
    await vm.runInContext("downloadYearCard(__o, null)", c);
    const footY = drawn.find((d) => d.t.startsWith("POGO METRICS")).y;
    const tileY = Math.max(...drawn.filter((d) => o.stats.some(([, l]) => l === d.t)).map((d) => d.y));
    const pillY = Math.max(...drawn.filter((d) => [...o.there, ...o.badges].includes(d.t)).map((d) => d.y));
    const headY = drawn.find((d) => d.t === o.events).y;
    // A tile's label sits 84 px into a 104 px tile, and the footer wants 24 px of
    // air above its baseline. The 92 px headline rises about 67 px and a pill
    // ends 22 px below its text's middle, so 105 px leaves 16 px between them.
    return { size: cv.done, has: (t) => drawn.some((d) => d.t === t), clear: tileY + 20 <= footY - 24 && headY - pillY >= 105 };
  };
  const crowded = {
    year: "2026", partial: false, c1: "#41d8c6", c2: "#ffcb05", events: "12,345",
    there: ["🎪 I was there · GO Fest Tokyo 2026", "🎪 I was there · GO Fest Chicago 2026", "🎪 I was there · GO Fest Paris 2025"],
    badges: ["🧭 The Patron", "🎮 4 years of adventure", "🌍 raided 8,765 km away", "🎪 12 GO Fest days", "🔥 123-day streak"],
    peakLabel: "Jun ’26 was the biggest month",
    stats: Array.from({ length: 8 }, (_, i) => [String(i * 111), "tile " + (i + 1)]),
    monthLabels: Array(12).fill(""), monthlyStacks: Array.from({ length: 12 }, () => [["#ffffff", 5]]),
    series: Array.from({ length: 9 }, (_, i) => ["series " + (i + 1), "#ffffff"]),
  };
  const full = await drawCard(crowded);
  festTests.push(["a crowded PNG card draws every badge, festivals included",
    [...crowded.there, ...crowded.badges].every(full.has)]);
  festTests.push(["it grows taller to fit them, headline clear of the badges and tiles clear of the footer",
    full.size[0] === 2160 && full.size[1] > 3000 && full.clear]);
  const plain = await drawCard({ ...crowded, there: [], badges: crowded.badges.slice(0, 2) });
  festTests.push(["an ordinary card keeps its 1080×1500 size",
    plain.size[0] === 2160 && plain.size[1] === 3000 && plain.clear && crowded.badges.slice(0, 2).every(plain.has)]);
}

/* ---------- the password-protected download ----------
 * The download support sends is a WinZip-AES ZIP. The fixtures in
 * tools/fixtures/ were written by bsdtar (libarchive) — an encoder that shares
 * no code with the app's reader — from the invented files in fixtures/src/,
 * with the synthetic password below; fixtures/make-fixtures.sh rebuilds them.
 * aes256.zip has the export's shape: a plain Player_Journey.zip inside a
 * locked archive. The ZIP limits are tested on archives crafted in memory. */
const FIXTURE_PASSWORD = "pogo-metrics-fixture";   // invented, and public on purpose
const FIX = path.join(HERE, "fixtures");
const warned = [];
const aesCtx = makeContext({
  DecompressionStream, Blob, File, Response, TextDecoder, TextEncoder, crypto: globalThis.crypto,
  // with no page to show it on, showError() falls back to console.warn — catch it
  console: { ...console, warn: (...a) => warned.push(a.map(String).join(" ")) },
});
load(aesCtx, "js/pokedex.js");
load(aesCtx, "js/catalog.js");
load(aesCtx, "js/app.js");
const aesTests = [];
{
  const run = (code) => vm.runInContext(code, aesCtx);
  const kindOf = async (p) => { try { await p; return "ok"; } catch (e) { return (e && e.kind) || String(e && e.message); } };
  const fixture = (name, bytes) => new File([bytes || fs.readFileSync(path.join(FIX, name))], name);
  const fitness = fs.readFileSync(path.join(FIX, "src/FitnessData.tsv"), "utf8");
  const spins = fs.readFileSync(path.join(FIX, "src/Player_Journey/Pokestop_spin1.csv"), "utf8");
  const enc = new TextEncoder();
  const u16 = (n) => [n & 255, (n >>> 8) & 255], u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return (b) => { let c = 0xffffffff; for (let i = 0; i < b.length; i++) c = t[(c ^ b[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }; })();
  const deflate = async (bytes) => new Uint8Array(await new Response(new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"))).arrayBuffer());
  /* A hand-made archive. Each spec: { name, bytes, method, usize? (a declared
   * size that may lie), lho? (a local-header offset that may lie), shareWith?
   * (no bytes of its own — point at spec N's) }; `count` overrides the entry
   * count the end record claims. */
  async function craft(specs, { count } = {}) {
    const parts = [], central = [], recs = [];
    let off = 0;
    for (const s of specs) {
      const name = enc.encode(s.name);
      let rec;
      if (s.shareWith != null) rec = { ...recs[s.shareWith] };
      else {
        const data = s.method === 8 ? await deflate(s.bytes) : s.bytes;
        rec = { lho: off, crc: CRC(s.bytes), csize: data.length, usize: s.usize ?? s.bytes.length, method: s.method };
        const hdr = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(s.method), ...u16(0), ...u16(0), ...u32(rec.crc), ...u32(rec.csize), ...u32(rec.usize), ...u16(name.length), ...u16(0)]);
        parts.push(hdr, name, data);
        off += hdr.length + name.length + data.length;
      }
      if (s.lho != null) rec.lho = s.lho;
      recs.push(rec);
      central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(rec.method), ...u16(0), ...u16(0), ...u32(rec.crc), ...u32(rec.csize), ...u32(rec.usize), ...u16(name.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(rec.lho)]), name);
    }
    const cdSize = central.reduce((a, c) => a + c.length, 0), n = count ?? specs.length;
    const eocd = new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(n), ...u16(n), ...u32(cdSize), ...u32(off), ...u16(0)]);
    return new File([new Blob([...parts, ...central, eocd])], "crafted.zip");
  }
  // the central-directory record for `want`, and its 0x9901 (WinZip AES) field
  const cdRecord = (buf, want) => {
    let off = buf.readUInt32LE(buf.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06])) + 16);
    for (;;) {
      const n = buf.readUInt16LE(off + 28), x = buf.readUInt16LE(off + 30), c = buf.readUInt16LE(off + 32);
      if (buf.toString("utf8", off + 46, off + 46 + n) === want) {
        let aes = -1;
        for (let p = off + 46 + n; p + 4 <= off + 46 + n + x; p += 4 + buf.readUInt16LE(p + 2)) if (buf.readUInt16LE(p) === 0x9901) aes = p;
        return { off, aes };
      }
      off += 46 + n + x + c;
    }
  };

  // The AES core against OpenSSL: node:crypto's AES-ECB over WinZip's counter
  // blocks (block n as a little-endian 64-bit integer from 1, then 8 zero bytes).
  const coreOk = [];
  for (const kl of [16, 24, 32]) {
    const key = randomBytes(kl), data = randomBytes(16 * 70 + 9);
    const ctrs = Buffer.alloc(Math.ceil(data.length / 16) * 16);
    for (let i = 0; i < ctrs.length / 16; i++) ctrs.writeBigUInt64LE(BigInt(i + 1), i * 16);
    const c = createCipheriv(`aes-${kl * 8}-ecb`, key, null);
    c.setAutoPadding(false);
    const ks = Buffer.concat([c.update(ctrs), c.final()]);
    aesCtx.__k = new Uint8Array(key); aesCtx.__d = new Uint8Array(data);
    await run("aesCtrWinZip(__k, __d)");
    coreOk.push(Buffer.from(aesCtx.__d).equals(Buffer.from(data.map((b, i) => b ^ ks[i]))));
  }
  aesTests.push(["the AES core matches OpenSSL for 128-, 192- and 256-bit keys", coreOk.length === 3 && coreOk.every(Boolean)]);

  // aes256.zip — the right password in, the files out
  const a256 = fs.readFileSync(path.join(FIX, "aes256.zip"));
  aesCtx.__f = fixture("aes256.zip", a256);
  aesCtx.__pw = FIXTURE_PASSWORD;
  const z = await run("(async () => (__z = await unzipFile(__f)))()");
  aesTests.push(["a bsdtar AES-256 archive is recognised as one this page can open",
    run("zipLock(__z)") === "aes" && z.entries.length === 2 && z.entries.every((e) => e.encrypted && e.aes && e.aes.strength === 3)]);
  aesTests.push(["the right password passes the verifier", (await run("zipFindPassword(__z, __pw)")) === FIXTURE_PASSWORD]);
  aesTests.push(["a pasted trailing space is forgiven", (await run("zipFindPassword(__z, __pw + ' ')")) === FIXTURE_PASSWORD]);
  aesTests.push(["a wrong password fails the verifier", (await kindOf(run("zipFindPassword(__z, 'not-the-password')"))) === "password"]);
  // A 2-byte verifier lets about one wrong password in 65,536 through. Patch the
  // first entry's stored verifier to match a chosen wrong password (the state a
  // lucky guess is in): it gets past that entry, and must still be refused.
  {
    const e0 = z.entries[0], dk = pbkdf2Sync("lucky-guess", a256.subarray(e0.start, e0.start + 16), 1000, 66, "sha1");
    const lucky = Buffer.from(a256);
    lucky[e0.start + 16] = dk[64]; lucky[e0.start + 17] = dk[65];
    aesCtx.__f = fixture("aes256.zip", lucky);
    await run("(async () => (__zlk = await unzipFile(__f)))()");
    aesTests.push(["a wrong password that slips past one entry's 2-byte check is still refused",
      (await kindOf(run("zipEntryFile(__zlk, __zlk.entries[0], 'lucky-guess')"))) === "damaged"
      && (await kindOf(run("zipFindPassword(__zlk, 'lucky-guess')"))) === "password"]);
  }
  const damagedSays = run("zipUnlockMessage({ kind: 'damaged' })");
  aesTests.push(["a failed checksum is never told the password was right",
    !/password is right/i.test(damagedSays) && /damaged/.test(damagedSays) && /password isn't quite right/.test(damagedSays)]);
  aesTests.push(["an entry won't decrypt under a wrong password",
    (await kindOf(run("zipEntryFile(__z, __z.entries.find((e) => e.name === 'FitnessData.tsv'), 'not-the-password')"))) === "password"]);
  const got = await run("zipExtract(__z, { password: __pw })");
  const byName = Object.fromEntries(got.files.map((f) => [f.name, f]));
  aesTests.push(["the right password yields the files, byte for byte",
    Object.keys(byName).sort().join(",") === "FitnessData.tsv,Player_Journey.zip" && (await byName["FitnessData.tsv"].text()) === fitness]);
  // …and the plain Player_Journey.zip inside opens one level down, on the same budget
  aesCtx.__inner = byName["Player_Journey.zip"];
  const zi = await run("(async () => (__zi = await unzipFile(__inner, __z.budget)))()");
  const inner = await run("zipExtract(__zi, { nested: true })");
  aesTests.push(["the Player_Journey.zip inside opens, unencrypted",
    zi.entries.every((e) => !e.encrypted) && inner.files.length === 1 && inner.files[0].name === "Pokestop_spin1.csv" && (await inner.files[0].text()) === spins]);
  aesTests.push(["…drawing on the same byte budget as the archive around it",
    run("__zi.budget === __z.budget") && run("__z.budget.left") === run("ZIP_LIMITS.total") - (Buffer.byteLength(fitness) + byName["Player_Journey.zip"].size + Buffer.byteLength(spins))]);
  // a ZIP inside a nested ZIP is never opened
  aesCtx.__deep = await craft([{ name: "deeper.zip", bytes: new Uint8Array(await byName["Player_Journey.zip"].arrayBuffer()), method: 0 }, { name: "a.csv", bytes: enc.encode("x\n1\n"), method: 0 }]);
  const deep = await run("(async () => zipExtract(await unzipFile(__deep), { nested: true }))()");
  aesTests.push(["nothing is opened two levels down", deep.files.length === 1 && deep.files[0].name === "a.csv" && deep.deeper.join() === "deeper.zip"]);
  // …and what's left shut is named, not dropped silently: a plain archive whose
  // Player_Journey.zip holds a third ZIP, through ingest() as a drop would go
  warned.length = 0;
  const pjDeep = await craft([{ name: "deeper.zip", bytes: enc.encode("never opened"), method: 0 }, { name: "a.csv", bytes: enc.encode("x\n1\n"), method: 0 }]);
  aesCtx.__f = await craft([{ name: "Player_Journey.zip", bytes: new Uint8Array(await pjDeep.arrayBuffer()), method: 0 }]);
  await run("ingest([__f])");
  aesTests.push(["…and a ZIP left shut two levels down is named, not dropped silently",
    warned.some((w) => /deeper\.zip/.test(w) && /Player_Journey\.zip/.test(w) && /one level down/.test(w)) && run("RAW.some((r) => r.name === 'a.csv')")]);
  run("RAW = []; DATA_GEN++");

  // one flipped ciphertext byte: the verifier still passes, the HMAC must not
  const fe = z.entries.find((e) => e.name === "FitnessData.tsv");
  const flipped = Buffer.from(a256);
  flipped[fe.start + 16 + 2 + 5] ^= 0x01;
  aesCtx.__f = fixture("aes256.zip", flipped);
  await run("(async () => (__zf = await unzipFile(__f)))()");
  aesTests.push(["a flipped ciphertext byte fails the authentication code, not the password check",
    (await run("zipFindPassword(__zf, __pw)")) === FIXTURE_PASSWORD
    && (await kindOf(run("zipEntryFile(__zf, __zf.entries.find((e) => e.name === 'FitnessData.tsv'), __pw)"))) === "damaged"]);

  // bsdtar writes AE-1 here, which keeps a CRC: a wrong one must be caught…
  const fr = cdRecord(a256, "FitnessData.tsv");
  const badCrc = Buffer.from(a256);
  badCrc.writeUInt32LE((badCrc.readUInt32LE(fr.off + 16) ^ 0x10) >>> 0, fr.off + 16);
  aesCtx.__f = fixture("aes256.zip", badCrc);
  await run("(async () => (__zc = await unzipFile(__f)))()");
  aesTests.push(["an AE-1 entry is checked against its CRC", a256.readUInt16LE(fr.aes + 4) === 1
    && (await kindOf(run("zipEntryFile(__zc, __zc.entries.find((e) => e.name === 'FitnessData.tsv'), __pw)"))) === "damaged"]);
  // …and the real downloads are AE-2, which zeroes the CRC and relies on the HMAC
  const ae2 = Buffer.from(a256);
  ae2.writeUInt16LE(2, fr.aes + 4);
  ae2.writeUInt32LE(0, fr.off + 16);
  aesCtx.__f = fixture("aes256.zip", ae2);
  await run("(async () => (__z2 = await unzipFile(__f)))()");
  const ae2File = await run("zipEntryFile(__z2, __z2.entries.find((e) => e.name === 'FitnessData.tsv'), __pw)");
  aesTests.push(["an AE-2 entry (no CRC, as in the real download) opens on its HMAC alone", (await ae2File.text()) === fitness]);

  // AES-128 over a stored entry
  const a128 = fs.readFileSync(path.join(FIX, "aes128-stored.zip"));
  aesCtx.__f = fixture("aes128-stored.zip", a128);
  const z128 = await run("(async () => (__z128 = await unzipFile(__f)))()");
  const got128 = await run("zipExtract(__z128, { password: __pw })");
  aesTests.push(["AES-128 over a stored entry opens too",
    z128.entries[0].aes.strength === 1 && z128.entries[0].aes.method === 0 && (await got128.files[0].text()) === fitness]);

  // a mixed archive — locked entries beside a plain one, as one real download has
  {
    const eocdAt = a128.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    const cdOff = a128.readUInt32LE(eocdAt + 16), cdLen = a128.readUInt32LE(eocdAt + 12);
    const nm = enc.encode("Notes.txt"), body = enc.encode("invented\n");
    const local = Buffer.from([...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(CRC(body)), ...u32(body.length), ...u32(body.length), ...u16(nm.length), ...u16(0)]);
    const cd = Buffer.from([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(CRC(body)), ...u32(body.length), ...u32(body.length), ...u16(nm.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(cdOff)]);
    const newCd = cdOff + local.length + nm.length + body.length, newLen = cdLen + cd.length + nm.length;
    const mixed = Buffer.concat([a128.subarray(0, cdOff), local, nm, body, a128.subarray(cdOff, cdOff + cdLen), cd, nm,
      Buffer.from([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(2), ...u16(2), ...u32(newLen), ...u32(newCd), ...u16(0)])]);
    aesCtx.__f = fixture("mixed.zip", mixed);
    const zm = await run("(async () => (__zm = await unzipFile(__f)))()");
    const gm = await run("zipExtract(__zm, { password: __pw })");
    const texts = Object.fromEntries(await Promise.all(gm.files.map(async (f) => [f.name, await f.text()])));
    aesTests.push(["a mixed archive — locked entries beside a plain one — opens whole",
      run("zipLock(__zm)") === "aes" && zm.entries.filter((e) => e.encrypted).length === 1 && texts["FitnessData.tsv"] === fitness && texts["Notes.txt"] === "invented\n"]);
  }

  // ZipCrypto: recognised, and explained plainly with a tool to use instead
  aesCtx.__f = fixture("zipcrypto.zip");
  const zc = await run("unzipFile(__f)");
  aesCtx.__zzc = zc;
  warned.length = 0;
  await run("ingest([__f])");
  aesTests.push(["a ZipCrypto archive is recognised as unsupported", run("zipLock(__zzc)") === "unsupported"]);
  aesTests.push(["…and the explainer names it and suggests a tool", warned.some((w) => /ZipCrypto/.test(w) && /7-Zip/.test(w) && /Keka/.test(w))]);
  // with no password panel to show, a locked download is explained rather than dropped
  warned.length = 0;
  aesCtx.__f = fixture("aes256.zip");
  await run("ingest([__f])");
  aesTests.push(["a locked download with nowhere to ask for its password is explained", warned.some((w) => /password-protected/.test(w) && /7-Zip/.test(w))]);

  // Files an operating system writes into a folder by itself pass in silence. A
  // Mac export folder carries a .DS_Store, and every drop of one got an assertive
  // "isn't a format this site reads" alert about a file nobody can see.
  run("RAW = []; DATA_GEN++");
  warned.length = 0;
  aesCtx.__drop = [new File(["\0\0\0Bud1"], ".DS_Store"), new File(["\0Mac OS X"], "._a.csv"),
    new File(["x"], "Thumbs.db"), new File(["x\n1\n"], "a.csv")];
  await run("ingest(__drop)");
  aesTests.push(["Finder's .DS_Store and ._ files, and Windows' Thumbs.db, pass without a word or a row",
    !warned.length && run("RAW.map((r) => r.name).join()") === "a.csv"]);
  run("RAW = []; DATA_GEN++");
  warned.length = 0;
  aesCtx.__drop = [new File(["%PDF-1.4"], "notes.pdf"), new File(["x\n1\n"], "a.csv")];
  await run("ingest(__drop)");
  aesTests.push(["…while a stray file of the reader's own still gets its heads-up",
    warned.some((w) => /notes\.pdf/.test(w) && /isn't a format this site reads/.test(w))]);
  aesCtx.__f = await craft([{ name: "a.csv", bytes: enc.encode("x\n1\n"), method: 0 },
    { name: "__MACOSX/._a.csv", bytes: enc.encode("\0Mac OS X"), method: 0 }, { name: ".DS_Store", bytes: enc.encode("Bud1"), method: 0 }]);
  const macZip = await run("(async () => zipExtract(await unzipFile(__f)))()");
  aesTests.push(["…and a Finder-made ZIP's __MACOSX twins and .DS_Store stay shut", macZip.files.map((f) => f.name).join() === "a.csv"]);
  run("RAW = []; DATA_GEN++");

  // ── the limits, on archives crafted to break them ──
  const row = enc.encode("a,b\n1,2\n");
  aesCtx.__f = await craft([{ name: "a.csv", bytes: row, method: 0 }], { count: 65535 });
  aesTests.push(["an archive claiming 65,535 entries is refused before any is read", (await kindOf(run("unzipFile(__f)"))) === "limit"]);
  aesCtx.__f = await craft(Array.from({ length: 200 }, (_, i) => ({ name: `f${i}.csv`, bytes: row, method: 0 })));
  aesCtx.__g = await craft(Array.from({ length: 201 }, (_, i) => ({ name: `f${i}.csv`, bytes: row, method: 0 })));
  aesTests.push(["200 entries still open; 201 do not", (await run("unzipFile(__f)")).entries.length === 200 && (await kindOf(run("unzipFile(__g)"))) === "limit"]);
  // …and the 200 are shared, like the bytes: one dropped archive and every archive
  // opened from inside it list 200 between them. A fresh 200 for each let one ZIP
  // of 200 ZIPs of 200 files put 40,000 rows in the list.
  {
    const innerZip = async (i, n) => new Uint8Array(await (await craft(Array.from({ length: n }, (_, j) => ({ name: `x${i}_${j}.csv`, bytes: row, method: 0 })))).arrayBuffer());
    aesCtx.__f = await craft(await Promise.all([0, 1, 2].map(async (i) => ({ name: `in${i}.zip`, bytes: await innerZip(i, 90), method: 0 }))), { name: "nest.zip" });
    run("RAW = []; DATA_GEN++");
    warned.length = 0;
    await run("ingest([__f])");
    const opened = run("RAW.filter((r) => /^x\\d_\\d+\\.csv$/.test(r.name)).length");
    aesTests.push(["one dropped archive and the archives inside it share the 200 entries (3 + 90 + 90 open; the third 90 does not)",
      opened === 180 && warned.some((w) => /in2\.zip/.test(w) && /200 entries/.test(w) && /Keka/.test(w)) && !warned.some((w) => /in[01]\.zip/.test(w))]);
    aesTests.push(["…and each archive dropped on its own still gets its own 200",
      run("(() => { const b = zipBudget(); return b.entries === ZIP_LIMITS.entries && b.left === ZIP_LIMITS.total; })()")]);
    run("RAW = []; DATA_GEN++");
  }
  aesCtx.__f = await craft([{ name: "a.csv", bytes: row, method: 0 }, { name: "b.csv", shareWith: 0 }]);
  aesTests.push(["two entries sharing one local-header offset are refused", (await kindOf(run("unzipFile(__f)"))) === "limit"]);
  aesCtx.__f = await craft([{ name: "a.csv", bytes: new Uint8Array(1024), method: 0 }, { name: "b.csv", bytes: row, method: 0, lho: 10 }]);
  aesTests.push(["entries whose bytes overlap are refused", (await kindOf(run("unzipFile(__f)"))) === "limit"]);
  const MB = 1024 * 1024;
  aesCtx.__f = await craft([
    { name: "Huge.csv", bytes: new Uint8Array(4096), method: 8, usize: 81 * MB },
    { name: "Huge.zip", bytes: row, method: 0, usize: 81 * MB },
    { name: "ok.csv", bytes: row, method: 0 },
  ]);
  const zh = await run("(async () => (__zh = await unzipFile(__f)))()");
  const gh = await run("zipExtract(__zh)");
  const huge = gh.files.find((f) => f.name === "Huge.csv");
  aesTests.push(["an entry declaring more than 80 MB is skipped, never inflated",
    huge && huge.standIn === true && huge.size === 81 * MB && gh.tooBig.join() === "Huge.zip"
    && run("__zh.budget.left") === run("ZIP_LIMITS.total") - row.length
    && (await kindOf(run("zipEntryFile(__zh, __zh.entries[0])"))) === "limit"]);
  aesCtx.__f = await craft([{ name: "liar.csv", bytes: new Uint8Array(MB), method: 8, usize: 1024 }]);
  await run("(async () => (__zl = await unzipFile(__f)))()");
  const liar = await kindOf(run("zipEntryFile(__zl, __zl.entries[0])"));
  aesTests.push(["an entry that inflates past its declared size is stopped mid-stream",
    liar === "limit" && run("ZIP_LIMITS.total - __zl.budget.left") < 256 * 1024]);
  // shrink the archive allowance so the test needn't inflate hundreds of MB
  run("ZIP_LIMITS.total = 2 * 1024 * 1024");
  aesCtx.__f = await craft([{ name: "big.csv", bytes: new Uint8Array(8 * MB), method: 8 }]);
  await run("(async () => (__zt = await unzipFile(__f)))()");
  const oneBig = await kindOf(run("zipExtract(__zt)"));
  aesTests.push(["the archive-wide byte cap aborts inflation while streaming",
    oneBig === "limit" && run("__zt.budget.left") > -256 * 1024]);
  aesCtx.__f = await craft([0, 1, 2].map((i) => ({ name: `part${i}.csv`, bytes: new Uint8Array(MB), method: 8 })));
  await run("(async () => (__zs = await unzipFile(__f)))()");
  aesTests.push(["…and counts across every entry in the archive", (await kindOf(run("zipExtract(__zs)"))) === "limit"]);
  run("ZIP_LIMITS.total = 256 * 1024 * 1024");

  // ── the password panel holds the auto-build ──
  // build() focuses the report and scrolls to it, which took the field from under
  // someone typing a password. With no page here, build() is swapped for a counter
  // and PENDING_ZIP stands in for a panel that is up.
  run("RAW = []; DATA_GEN++; PENDING_ZIP = null; __builds = 0; __build0 = build; build = () => { __builds++; }");
  aesCtx.__loose = new File([spins], "Pokestop_spin1.csv");
  await run("ingest([__loose])");
  const scheduled = run("AUTO_BUILD_T !== null");
  run("PENDING_ZIP = { busy: false }");   // a locked ZIP lands inside the 900 ms wait
  await new Promise((r) => setTimeout(r, 1100));
  aesTests.push(["a panel that comes up during the auto-build's wait holds the build",
    scheduled && run("__builds") === 0 && run("PENDING_ZIP.buildHeld") === true]);
  aesCtx.__loose = new File([fitness], "FitnessData.tsv");
  await run("ingest([__loose])");         // more files while the panel is up
  aesTests.push(["files added while the panel is up don't start a build either",
    run("AUTO_BUILD_T") === null && run("__builds") === 0 && run("PENDING_ZIP.buildHeld") === true]);
  run("cancelUnlock()");
  aesTests.push(["\"Not now\" runs the held build, once", run("__builds") === 1 && run("PENDING_ZIP") === null]);
  run("PENDING_ZIP = { busy: false }; cancelUnlock()");
  aesTests.push(["…and builds nothing when nothing was held", run("__builds") === 1]);
  run("build = __build0; RAW = []; DATA_GEN++");
}

/* ---------- the data the report never showed ----------
 * Every panel built from a field the report used to read past, fed a small
 * synthetic file in a fresh context: what it must count, and what it must never
 * keep. Sentinels stand in for other people's names and texts, and may reach
 * neither STATE nor the page. */
const unusedTests = [];
{
  const fresh = () => { const c = makeContext(); load(c, "js/pokedex.js"); load(c, "js/catalog.js"); load(c, "js/app.js"); return c; };
  const route = async (c, name, text) => { c.__n = name; c.__t = text; vm.runInContext("RAW.push({ name: __n })", c); await vm.runInContext("routeFile(__n, __t)", c); };
  const render = (c, fn) => { try { return String(vm.runInContext(`POST = []; ${fn}() || ""`, c)); } catch (e) { return "THREW " + e.message; } };
  const stateJSON = (c) => vm.runInContext("JSON.stringify(STATE, (k, v) => (v instanceof Set || v instanceof Map ? [...v] : v))", c);

  // Install history from BOTH files, and device eras, in either order of arrival
  {
    const c = fresh();
    const row = (e, i, d, p, k, a, o) => [e, i, d, p, k, a, o, "", "", "US"].join(",");
    const sessions = "Event_time,Install_time,Device_model,Platform,Device_category,App_version,OS_version,City,State,Country_code\n" + [
      row("2022-03-01 10:00:00 UTC", "2021-01-05 12:00:00 UTC", "Apple::iPhone 12", "ios", "mobile_phone", "0.201.0", "14.4"),
      row("2022-03-02 10:00:00 UTC", "2021-01-05 12:00:00 UTC", "Apple::iPhone 12", "ios", "mobile_phone", "0.201.1", "14.4"),
      row("2022-04-01 10:00:00 UTC", "2022-03-20 09:00:00 UTC", "Pixel 6", "android", "phone", "0.203.0", "12"),
      row("2022-04-02 10:00:00 UTC", "2022-03-20 09:00:00 UTC", "Pixel 6", "android", "phone", "0.203.0", "12"),
      row("2022-04-03 10:00:00 UTC", "2022-03-20 09:00:00 UTC", "Pixel 6", "android", "phone", "0.203.0", "12"),
      row("2022-05-01 10:00:00 UTC", "2022-04-28 09:00:00 UTC", "Apple::iPhone 12", "ios", "mobile_phone", "0.205.0", "15.0"),
      row("2022-05-02 10:00:00 UTC", "2022-04-28 09:00:00 UTC", "Galaxy Tab", "<zq1>", "<zq1>", "<zq1>0.9", "15.0<zq1>"),
    ].join("\n") + "\n";
    await route(c, "App_Installs.csv", "Install_time,Device_model,Platform\n2022-03-20 09:00:00 UTC,Pixel 6,android\n2022-06-01 08:00:00 UTC,Pixel 6,android\n");
    await route(c, "App_Sessions.csv", sessions);
    const h = vm.runInContext("installHistory()", c), S4 = vm.runInContext("STATE.sessions", c);
    const html = render(c, "renderSessions");
    unusedTests.push(["the first install is the earliest EITHER file names (2021, where App_Installs alone says 2022)",
      h.total === 4 && h.first.getUTCFullYear() === 2021 && vm.runInContext("STATE.installs.first.getUTCFullYear()", c) === 2022
      && /<div class="v">2021<\/div><div class="l">First install/.test(html)]);
    unusedTests.push(["…and the personal stats file says 2021 too, matching the report rather than App_Installs alone",
      vm.runInContext("statsFileData().installs.first.getUTCFullYear()", c) === 2021 && vm.runInContext("statsFileData().installs.history.first.getUTCFullYear()", c) === 2021]);
    unusedTests.push(["installs by year, new devices and reinstalls", h.newDevices === 2 && h.reinstalls === 2 && JSON.stringify(h.byYear) === '{"2021":1,"2022":3}'
      && /installed the game <b>4<\/b> times since Jan ’21/.test(html) && /<b>2<\/b> reinstalls/.test(html)]);
    unusedTests.push(["a new device era each time the main device changes", vm.runInContext("deviceEras().map((e) => e.dev + ' ' + e.from).join('|')", c) === "iPhone 12 2022-03|Pixel 6 2022-04|iPhone 12 2022-05"
      && /Your device eras/.test(html) && /crossing between platforms <b>2<\/b> times/.test(html) && /from 0\.201\.0 to 0\.205\.0/.test(html)]);
    unusedTests.push(["a markup version, platform or device type never reaches STATE",
      !/zq1/.test(JSON.stringify([S4.apps, S4.oses, S4.deviceKind])) && Object.keys(S4.apps).length === 4 && Object.keys(S4.oses).length === 3
      && S4.deviceKind["Galaxy Tab"].platform === "Other" && S4.deviceKind["Galaxy Tab"].kind === ""]);
  }

  // Campfire: hours at meetups, turnout, and the chattiest hour under daylight saving
  {
    const c = fresh();
    const msg = (id, t) => `${id},${t}.000 +0000 UTC,hello`;
    const ev = (id, s, e, rs, ci) => `${id},Raid Hour,${s}.000 +0000 UTC,${e}.000 +0000 UTC,desc,"0.0,0.0",${rs},${ci},false,x`;
    await route(c, "Tester_20260101_120000.csv", ["User's Sent Messages", "Chatv2 Message Id,Sent At,Message",
      // 5 PM in New York: two winter evenings (22:10 UTC) and two summer ones (21:10 UTC)…
      msg(1, "2026-01-10 22:10:00"), msg(2, "2026-01-11 22:10:00"), msg(3, "2026-07-10 21:10:00"), msg(4, "2026-07-11 21:10:00"),
      // …and three winter 10 PMs, all at 03:10 UTC — the busiest UTC hour, which today's offset would have crowned
      msg(5, "2026-01-12 03:10:00"), msg(6, "2026-01-13 03:10:00"), msg(7, "2026-01-14 03:10:00"),
      "", "", "User Checkins", "Event Id,Event Title,Event Start Time,Event End Time,Event Description,Event Latlng,RSVP count,Check-in count,isCA/CL,Admin URL",
      ev("e1", "2026-02-01 18:00:00", "2026-02-01 19:00:00", 20, 10),
      ev("e2", "2026-03-01 14:00:00", "2026-03-01 17:00:00", 30, 14),
      ev("e3", "2026-06-05 14:00:00", "2026-06-08 02:00:00", 90, 60),   // a 60-hour listing
    ].join("\n") + "\n");
    const C2 = vm.runInContext("STATE.campfire", c);
    unusedTests.push(["Campfire meetup hours: each listing's own length, capped at 12 in the total", !!C2 && C2.hoursOut === 16 && C2.meetupHours.join(",") === "1,3,60"]);
    const tz0 = process.env.TZ;
    process.env.TZ = "America/New_York";
    const html = render(c, "renderCampfire");
    process.env.TZ = tz0;
    unusedTests.push(["…shown as hours out, a typical length and the turnout of meetups you joined",
      /16 h</.test(html) && /a typical one ran 3 hours/.test(html) && /<div class="v">14<\/div><div class="l">Typical turnout/.test(html) && /biggest 60/.test(html)]);
    unusedTests.push(["…with the RSVPs of the meetups you joined beside the check-ins (20, 30 and 90: typically 30)",
      C2.crowdRsvp.join(",") === "20,30,90" && /a typical meetup you joined, and 30 RSVP/.test(html)]);
    unusedTests.push(["the chattiest hour puts each message in its own local hour — 5 PM, where today's offset said 10 or 11 PM",
      /chattiest hour is <b>5 PM<\/b>/.test(html)]);
  }

  // …and in zones a half or three-quarter hour off UTC, where a whole-hour key put
  // anything from the second half of a UTC hour one local hour early
  {
    const c = fresh();
    // 10:40–10:50 UTC is 4:10–4:20 PM in India, 4:25–4:35 PM in Nepal and 7:10–7:20 AM in
    // Newfoundland (January); 09:50–09:55 UTC is an hour earlier in each
    await route(c, "Tester_20260101_120000.csv", ["User's Sent Messages", "Chatv2 Message Id,Sent At,Message",
      ...["2026-01-10 10:40:00", "2026-01-11 10:45:00", "2026-01-12 10:50:00", "2026-01-13 09:50:00", "2026-01-14 09:55:00"]
        .map((t, i) => `${i},${t}.000 +0000 UTC,hello`)].join("\n") + "\n");
    // two invites late on a Saturday in UTC, which is just past midnight on Sunday in India and
    // Nepal, and one on Saturday morning; all three stay on Saturday in Newfoundland
    await route(c, "RecentInviteActions.tsv", [
      " Sent friend invitation\t08/22/2026 18:40:00 UTC\tZzOther\tSUCCESS",
      " Sent friend invitation\t08/22/2026 18:45:00 UTC\tZzOther\tSUCCESS",
      " Sent friend invitation\t08/22/2026 10:00:00 UTC\tZzOther\tSUCCESS",
    ].join("\n") + "\n");
    const tz0 = process.env.TZ, got = {};
    for (const tz of ["Asia/Kolkata", "Asia/Kathmandu", "America/St_Johns"]) {
      process.env.TZ = tz;
      got[tz] = [(render(c, "renderCampfire").match(/chattiest hour is <b>([^<]+)<\/b>/) || [])[1], (render(c, "renderSocial").match(/land on a <b>(\w+)<\/b>/) || [])[1]];
    }
    process.env.TZ = tz0;
    unusedTests.push(["half-hour zones: each message's own hour — 4 PM in India and Nepal, 7 AM in Newfoundland, where an hour key said 3 PM and 6 AM",
      got["Asia/Kolkata"][0] === "4 PM" && got["Asia/Kathmandu"][0] === "4 PM" && got["America/St_Johns"][0] === "7 AM"]);
    unusedTests.push(["…and invites just past midnight in India and Nepal land on Sunday, not the Saturday an hour key gave them",
      got["Asia/Kolkata"][1] === "Sunday" && got["Asia/Kathmandu"][1] === "Sunday" && got["America/St_Johns"][1] === "Saturday"]);
  }

  // Wayfarer: the four logs and the stars you gave; nothing else
  {
    const c = fresh();
    const SENT = "zzwayfarersentinel";
    await route(c, "wayfarer_player_data.json", JSON.stringify([{
      OprSubmissionLog: [
        { "Candidate ID": SENT, "Assigned Time": "2024-08-06 06:30:00 GMT", Comment: SENT, "Rating for Quality": "4", "Rating for Text": "2", "Is Duplicate": "false",
          "Suggested Location": SENT + " 33.1234,-112.1234", "One Star Submission": "true", Time: "2024-08-06 06:35:51 GMT", "What is it?": SENT + " > x", "Duplicate of Portal": SENT },
        { Time: "2024-09-01 00:00:00 GMT", "Rating for Quality": "5", "Rating for Text": "", "Is Duplicate": "true", "One Star Submission": "false" },
      ],
      OprAssignmentLog: [{ "Candidate ID": SENT, Time: "2024-08-06 06:30:00 GMT" }, { "Candidate ID": SENT, Time: "2024-10-01 00:00:00 GMT" }],
      OprSkippedLog: [{ "Candidate ID": SENT, Time: "2024-10-02 00:00:00 GMT" }],
      OprUpgradeLog: [],
      OprProfile: [{ "Email Address": SENT + "@example.com", "Total Analyzed": "9", "Portals Created": 3, "Portals Rejected": 1,
        "Hometown Location": { latE6: 33123400, lngE6: -112123400 }, "Last Activity Location": { latE6: 33123400, lngE6: -112123400 } }],
    }]));
    const W = vm.runInContext("STATE.wayfarer", c);
    const html = render(c, "renderWayfarer");
    unusedTests.push(["Wayfarer: candidates shown, reviews sent in and skipped, each from its own log",
      W.assigned === 2 && W.logged === 2 && W.skipped === 1 && W.upgrades === 0 && /Candidates shown to you/.test(html) && /Reviews you sent in/.test(html)]);
    unusedTests.push(["…the stars you gave, averaged per category, with one-star and duplicate flags counted",
      W.ratings["Overall quality"].n === 2 && W.ratings["Overall quality"].sum === 9 && W.ratings["Title & description"].n === 1
      && W.oneStar === 1 && W.duplicates === 1 && /4\.5 ★/.test(html)]);
    unusedTests.push(["…months read from Wayfarer's GMT stamps",
      JSON.stringify(W.reviewedMonthly) === '{"2024-08":1,"2024-09":1}' && JSON.stringify(W.assignedMonthly) === '{"2024-08":1,"2024-10":1}']);
    unusedTests.push(["…and no email, location, candidate, comment or category is kept or shown",
      !stateJSON(c).includes(SENT) && !html.includes(SENT) && !/33123400|33\.1234/.test(stateJSON(c))]);
  }

  // Invite timing: the action, the time and the result — never the other trainer
  {
    const c = fresh();
    const SENT = "ZzOtherTrainer";
    await route(c, "RecentInviteActions.tsv", [
      ` Sent friend invitation\t08/24/2026 05:39:49 UTC\t${SENT}\tSUCCESS`,        // Monday in UTC, Sunday evening in UTC-7
      ` Sent friend invitation\t08/24/2026 06:00:00 UTC\t${SENT}\tSUCCESS`,
      ` Accepted friend invitation\t08/25/2026 05:39:49 UTC\t${SENT}\tSUCCESS`,
      ` Declined friend invitation\t08/26/2026 05:39:49 UTC\t${SENT}<zq1>\tERROR`,
    ].join("\n") + "\n");
    await route(c, "ActivityInvitesReceived.tsv", "Activity type\tDate and time of invite (UTC)\tExpiration time (UTC)\nWEEKLY_CHALLENGE_PARTY\t2026-08-20T03:38:34.464Z\t2026-08-21T03:38:34.402Z\n");
    const I = vm.runInContext("STATE.invites", c), P = vm.runInContext("STATE.party", c);
    const html = render(c, "renderSocial");
    unusedTests.push(["invites: every action, leading space and all, with its time", I.sent === 2 && I.accepted === 1 && I.declined === 1 && I.monthly["2026-08"] === 4]);
    unusedTests.push(["…a result other than SUCCESS counts as not going through", I.failed === 1 && /go through/.test(html)]);
    unusedTests.push(["…placed on YOUR weekday: two Monday-UTC invites are a Sunday evening in UTC-7",
      /land on a <b>Sunday<\/b>/.test(inZone("Etc/GMT+7", () => render(c, "renderSocial")))]);
    unusedTests.push(["Party Play invitations join the weekday chart by their own time", P.received === 1 && Object.values(P.slots).reduce((a, b) => a + b, 0) === 1]);
    unusedTests.push(["the other trainer in the invite log reaches neither STATE nor the page", !stateJSON(c).includes(SENT) && !html.includes(SENT) && !/zq1/.test(html)]);
  }

  // Live-event add-ons: 0 tickets stays 0, and an add-on is a yes or a no
  {
    const c = fresh();
    const SENT = "zzaddonsentinel";
    await route(c, "LiveEventRegistrationHistory_AsPurchaser.tsv", "Event Details\tNumber of Tickets on Order\tAddOn Info\tTotal Paid\tCurrency Paid\tDate of Order Placed\n"
      + `Event A, City\t0\tBundle ${SENT}\t10\tUSD\t2025-01-02 10:00:00 UTC\nEvent B, City\t2\t\t60\tUSD\t2025-02-02 10:00:00 UTC\nEvent C, City\t\t\t30\tUSD\t2025-03-02 10:00:00 UTC\n`);
    const parsed = vm.runInContext("STATE.liveEvents.map((e) => e.tickets + ':' + e.addOn).join(',')", c);
    const html = render(c, "renderLiveEvents");
    unusedTests.push(["an add-on-only order keeps its 0 tickets; a blank count is still one", parsed === "0:true,2:false,1:false"]);
    unusedTests.push(["add-ons get a line of their own", /Orders with an add-on/.test(html) && /add-on only/.test(html) && /<div class="v">3<\/div><div class="l">Tickets bought/.test(html)]);
    unusedTests.push(["…and what the add-on was is never kept or shown", !stateJSON(c).includes(SENT) && !html.includes(SENT)]);
  }

  // Referral Connections and the gift rows of the recent log: counted, never named
  {
    const c = fresh();
    await route(c, "Gameplay.txt", "Referral info:\nReferral code: ABC123\n\nReferral Connections:\nPlayer\tAreFriends\nZzRefOne\t\ttrue\nZzRefTwo\t\tfalse\n\n"
      + "Date and time\tDescription\n08/24/2026 05:39:49 UTC\tReceived 3 items from ZzGiftOne.\n08/24/2026 05:40:49 UTC\tReceived 2 items from PokeStop.\n08/24/2026 05:41:49 UTC\tReceived 1 item from ZzGiftTwo\n\n");
    const R = vm.runInContext("STATE.recent", c), F = vm.runInContext("STATE.referrals", c);
    const html = render(c, "renderTrainer") + render(c, "renderRecentLog");
    unusedTests.push(["Referral Connections: how many you brought in, and how many are friends", !!F && F.total === 2 && F.friends === 1 && /Trainers you referred/.test(html)]);
    unusedTests.push(["gift rows are gifts, with their items, and none is left unclassified",
      R.gifts === 2 && R.giftItems === 4 && R.items === 2 && R.other === 0 && /Gifts from friends/.test(html)]);
    unusedTests.push(["no referred trainer or gift sender reaches STATE or the page", !/ZzRef|ZzGift/.test(stateJSON(c)) && !/ZzRef|ZzGift/.test(html)]);
  }

  // The sample: every in-person event medal generalised, and still an event badge
  {
    const keys = [...fs.readFileSync(path.join(DEMO, "Gameplay.txt"), "utf8").matchAll(/^[ \t]*(BADGE_\w+): \d+/gm)].map((m) => m[1]);
    const EVENT = vm.runInContext("EVENT_BADGE", ctx);
    const dayOrSession = /_(MONDAY|TUESDAY|WEDNESDAY|THURSDAY|FRIDAY|SATURDAY|SUNDAY|PARK|CITY|NIGHT|ADD_ON|DAY_\d|SESSION|ALL_DAY)(_|$)/;
    const town = /_(SAFFRON|FUCHSIA|CINNABAR|LAVENDER|VERMILION|PEWTER|CELADON|VIRIDIAN|CERULEAN|PALLET)(_|$)/;
    const neutral = keys.filter((k) => /^BADGE_EVENT_IN_PERSON_\d+$/.test(k));
    unusedTests.push([`no event medal in the sample names a day, a session or a town (${neutral.length} generalised)`,
      neutral.length > 0 && !keys.some((k) => EVENT.test(k) && (dayOrSession.test(k) || town.test(k)))]);
    unusedTests.push(["…the neutral keys still count as event badges", neutral.every((k) => EVENT.test(k))]);
    unusedTests.push(["tools/scrub-demo.mjs can still read EVENT_BADGE out of js/app.js",
      /^const EVENT_BADGE = \/(.+)\/([a-z]*);$/m.test(fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8"))]);
  }
}

/* ---------- copies: two exports, a Keep Both copy, a ZIP beside its folder ----------
 * RAW used to keep one copy per file name — whichever arrived last — so a June
 * and an August export dropped together built a different report nearly every
 * time. Copies are now merged by what kind of file they are (mergeCopies in
 * app.js). Two small invented exports, A (January 2026) and B (March 2026),
 * overlap the way real ones do: rolling logs that share a few rows, ledgers
 * where the newer holds everything the older did and more, snapshots that
 * changed, and journey logs whose windows overlap — with one blurred "2" row
 * that has no precise twin. Every arrival order must build the same STATE. */
const copyTests = [];
function storedZip(name, entries) {
  const enc = new TextEncoder();
  const u16 = (n) => [n & 255, (n >>> 8) & 255], u32 = (n) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255];
  const crc = (b) => { let c = 0xffffffff; for (const x of b) { c ^= x; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; } return (c ^ 0xffffffff) >>> 0; };
  const parts = [], central = [];
  let off = 0;
  for (const [n, text] of entries) {
    const raw = enc.encode(text), nm = enc.encode(n), c = crc(raw);
    const hdr = new Uint8Array([...u32(0x04034b50), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(c), ...u32(raw.length), ...u32(raw.length), ...u16(nm.length), ...u16(0)]);
    parts.push(hdr, nm, raw);
    central.push(new Uint8Array([...u32(0x02014b50), ...u16(20), ...u16(20), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(c), ...u32(raw.length), ...u32(raw.length), ...u16(nm.length), ...u16(0), ...u16(0), ...u16(0), ...u16(0), ...u32(0), ...u32(off)]), nm);
    off += hdr.length + nm.length + raw.length;
  }
  const size = central.reduce((a, x) => a + x.length, 0);
  return new File([...parts, ...central, new Uint8Array([...u32(0x06054b50), ...u16(0), ...u16(0), ...u16(entries.length), ...u16(entries.length), ...u32(size), ...u32(off), ...u16(0)])], name);
}
const copyCtx = () => {
  // Web Crypto too: a copy is known by the SHA-256 of its bytes
  const c = makeContext({ DecompressionStream, Blob, File, Response, TextDecoder, TextEncoder, crypto: globalThis.crypto, console: { ...console, warn: () => {} } });
  load(c, "js/pokedex.js");
  load(c, "js/catalog.js");
  load(c, "js/app.js");
  vm.runInContext("build = () => {}", c);   // ingest() schedules a build; these tests parse by hand
  return c;
};
// a drop: files with the paths they sat at, as a folder drag would hand them over
const dropInto = async (c, files) => {
  c.__drop = files.map((x) => [x.file || new File([x.text], x.path.split("/").pop()), x.path]);
  vm.runInContext("__drop.forEach(([f, p]) => FILE_PATH.set(f, p))", c);
  await vm.runInContext("ingest(__drop.map(([f]) => f))", c);
};
const stateOf = async (c) => {
  await vm.runInContext("(async () => { STATE = freshState(); await parseRaw(); })()", c);
  return vm.runInContext("JSON.stringify(STATE, (k, v) => v instanceof Map || v instanceof Set ? [...v] : ArrayBuffer.isView(v) ? Array.from(v) : v)", c);
};
const J1 = "Player_Latitude,Player_Longitude,Fort_Latitude,Fort_Longitude,Timestamp";
{
  // ── names ──
  const c0 = copyCtx();
  const canon = (n) => { c0.__n = n; return vm.runInContext("canonicalName(__n)", c0); };
  const names = [["Pokestop_spin1 2.csv", "Pokestop_spin1.csv"], ["Gameplay copy.txt", "Gameplay.txt"], ["FriendList (1).tsv", "FriendList.tsv"],
    ["FriendList - Copy.tsv", "FriendList.tsv"], ["Gameplay copy 2.txt", "Gameplay.txt"], ["Pokestop_spin1.csv", "Pokestop_spin1.csv"],
    ["SupportInteractions1.tsv", "SupportInteractions1.tsv"], ["AshDemo_20260812_120000.csv", "AshDemo_20260812_120000.csv"]];
  copyTests.push(["copy markers come off a file's name, and nothing else does", names.every(([a, b]) => canon(a) === b)]);
  copyTests.push(["a name that only contains an event's name is no event file", vm.runInContext("!PJ_FILE.test('old_Pokestop_spin1.csv') && PJ_FILE.test('Pokestop_spin1.csv')", c0)]);

  // ── the two exports ──
  const T = { t0: "2024-06-01 10:00:00", t1: "2025-11-01 10:00:00", t2: "2025-12-01 10:00:00", t3: "2026-01-01 10:00:00",
    t4: "2026-01-15 10:00:00", t5: "2026-02-15 10:00:00", t6: "2026-03-01 10:00:00", tb: "2026-02-01 10:00:00" };
  const precise = (i) => { const a = (1 + i / 1000).toFixed(6), o = (2 + i / 1000).toFixed(6); return `${a},${o},${a},${o},${T["t" + i]}.000 UTC`; };
  const blurred = (k) => `1.010000,2.010000,1.010000,2.010000,${T[k]}.000 UTC`;
  const tsv = (head, rows) => [head, ...rows].join("\n") + "\n";
  const FR = "Friend's codename\tDate of friendship start\tFriendship initiated by\tFriendship Source\tNickname\tGames they are Friends in";
  const friend = (n, d) => `friend${n}\t${d}T10:00:00.000Z\tYou\tQR\t\tPokemon GO`;
  const GPS = "Date and Time\tLatitude of location reported by game\tLongitude of location reported by game";
  const gps = (d, i) => `${d}T10:00:00.000Z\t${(1 + i / 1e6).toFixed(6)}\t${(2 + i / 1e6).toFixed(6)}`;
  const FIT = "Date and time of logging (UTC)\tSteps walked\tDistance travelled (meters)\tCalories burned";
  const fit = (d, k) => `${d}T12:00:00.000Z\t${k * 1000}\t${k * 800}\t${k * 40}`;
  const IAP = "Date and time\tType of activity\tVendor\tItem purchased\tNumber of items\tChange in pokecoins\tMoney spent on purchase\tCurrency";
  const coins = "1/3/2026 10:00:00\tPokecoin bought\tAPPLE\t\t1\t100\t0.99\tUSD", balls = "1/4/2026 10:00:00\tIn-game item bought\t\tITEM_POKE_BALL\t10\t0\t0\tUSD";
  const SUP = "Date and time\tTicket number and title\tMessage content";
  const IMG = "Image ID\tUpload Date";
  const way = (n) => JSON.stringify({ OprProfile: { "Total Analyzed": n, "Portals Created": 1, Rejected: 1 }, OprSubmissionLog: [{ date: "2024-08-01 10:00:00" }] });
  const gameplay = (level, log) => `Pokemon Home Trainer Name: Tester\nStart date: 1/2/2020\nLevel: ${level}\nTotal XP: 1000\n\nVS Seeker Status\nDate and time\tDescription\n${log.join("\n")}\n\nThat is all.\n`;
  const A = [
    ["Gameplay.txt", gameplay(40, ["1/10/2026 10:00:00 UTC\tReceived 3 items from PokeStop.", "1/10/2026 10:05:00 UTC\tPidgey was caught! CP 100"])],
    ["FriendList.tsv", tsv(FR, [friend(1, "2025-05-01"), friend(2, "2025-06-01"), friend(3, "2026-01-05")])],
    ["GameplayLocationHistory.tsv", tsv(GPS, [gps("2025-12-30", 1), gps("2026-01-10", 2), gps("2026-01-20", 3)])],
    ["FitnessData.tsv", tsv(FIT, [fit("2026-01-01", 1), fit("2026-01-02", 2), fit("2026-01-03", 3)])],
    // no header row, and every line indented in the older export
    ["RecentInviteActions.tsv", "   Friend invite sent\t1/5/2026 10:00:00\tsomeone\tpending\n   Friend invite accepted\t1/6/2026 10:00:00\tsomeone2\tdone\n"],
    ["InAppPurchases.tsv", tsv(IAP, [coins, balls, balls])],   // the export itself lists that purchase twice
    ["SupportInteractions1.tsv", tsv(SUP, ["2026-01-02T10:00:00.000Z\tTicket 1001: Data export\thello", "2026-01-03T10:00:00.000Z\tTicket 1001: Data export\treply"])],
    ["ImageData.txt", tsv(IMG, ["img-a\t2026-01-04T10:00:00.000Z", "img-b\t2026-01-05T10:00:00.000Z"])],
    ["wayfarer_player_data.json", way(5)],
    ["Player_Journey/Pokestop_spin1.csv", tsv(J1, [1, 2, 3, 4].map(precise))],
    ["Player_Journey/Pokestop_spin2.csv", tsv(J1, ["t0", "t1", "t2", "t3", "t4"].map(blurred))],
  ].map(([p, text]) => ({ path: "Export A/" + p, text }));
  const B = [
    ["Gameplay.txt", gameplay(41, ["1/10/2026 10:05:00 UTC\tPidgey was caught! CP 100", "3/5/2026 09:00:00 UTC\tRattata was caught! CP 50"])],
    ["FriendList.tsv", tsv(FR, [friend(1, "2025-05-01"), friend(3, "2026-01-05"), friend(4, "2026-02-20"), friend(5, "2026-03-01")])],
    ["GameplayLocationHistory.tsv", tsv(GPS, [gps("2026-01-20", 3), gps("2026-02-10", 4), gps("2026-03-01", 5), gps("2026-03-10", 6)])],
    ["FitnessData.tsv", tsv(FIT, [fit("2026-01-03", 3), fit("2026-03-01", 4), fit("2026-03-02", 5)])],
    ["RecentInviteActions.tsv", "Friend invite sent\t1/5/2026 10:00:00\tsomeone\tpending\nFriend invite declined\t3/1/2026 10:00:00\tsomeone3\tdone\n"],
    ["InAppPurchases.tsv", tsv(IAP, [coins, balls, "2/10/2026 10:00:00\tPokecoin bought\tGOOGLE\t\t1\t550\t4.99\tUSD"])],
    ["SupportInteractions1.tsv", tsv(SUP, ["2026-01-02T10:00:00.000Z\tTicket 1001: Data export\thello", "2026-01-03T10:00:00.000Z\tTicket 1001: Data export\treply", "2026-03-03T10:00:00.000Z\tTicket 1002: Another\tmsg"])],
    ["ImageData.txt", tsv(IMG, ["img-a\t2026-01-04T10:00:00.000Z", "img-b\t2026-01-05T10:00:00.000Z", "img-c\t2026-02-05T10:00:00.000Z"])],
    ["wayfarer_player_data.json", way(7)],   // its own dates tie with A's: the export's clock decides
    ["Player_Journey/Pokestop_spin1.csv", tsv(J1, [3, 4, 5, 6].map(precise))],
    // the same blur as A's for the same moment, plus one row the precise file has no twin for
    ["Player_Journey/Pokestop_spin2.csv", tsv(J1, ["t0", "t3", "t4", "t5", "t6", "tb"].map(blurred))],
  ].map(([p, text]) => ({ path: "Export B/" + p, text }));
  const textOf = (files, name) => files.find((x) => x.path.endsWith("/" + name)).text;

  // ── every arrival order ──
  const rng = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const shuffled = (arr, seed) => { const r = rng(seed), a = arr.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
  const orders = [["A, then B", [A, B]], ["B, then A", [B, A]], ["together, A first", [[...A, ...B]]], ["together, B first", [[...B, ...A]]]];
  for (let s = 1; s <= 6; s++) orders.push([`together, shuffled ${s}`, [shuffled([...A, ...B], s)]]);
  for (let s = 7; s <= 10; s++) orders.push([`two drops, each shuffled ${s}`, s % 2 ? [shuffled(A, s), shuffled(B, s + 20)] : [shuffled(B, s), shuffled(A, s + 20)]]);
  const prints = [];
  let merged = null;
  for (const [, drops] of orders) {
    const c = copyCtx();
    for (const d of drops) await dropInto(c, d);
    prints.push(await stateOf(c));
    merged = merged || c;
  }
  copyTests.push([`two exports build one STATE in every arrival order (${orders.length} orders)`, prints.every((p) => p === prints[0])]);
  const S4 = vm.runInContext("STATE", merged);
  copyTests.push(["journey logs: the union of distinct rows, a blurred row with no precise twin included", S4.ev.totals.Spins === 8 && S4.ev.forts.size === 6]);
  copyTests.push(["rolling logs: every row either export holds, the shared ones once",
    S4.trailCount === 6 && Object.keys(S4.fitness.daily).length === 5 && !!S4.recent && S4.recent.rows === 3]);
  copyTests.push(["invite lines are told apart by more than their leading spaces",
    S4.invites.sent === 1 && S4.invites.accepted === 1 && S4.invites.declined === 1]);
  copyTests.push(["ledgers: an overlap counts once, a row an export lists twice stays twice",
    S4.spend.coinsBought === 650 && S4.spend.purchases === 2 && S4.spend.items.ITEM_POKE_BALL === 20
    && S4.support.messages === 3 && S4.support.tickets === 2 && S4.photos.total === 3]);
  copyTests.push(["snapshots come from the newer export, told by its data",
    S4.profile.level === 41 && S4.friends.rows.length === 4 && S4.wayfarer.analyzed === 7]);
  copyTests.push(["the file list says what happened: 2 exports merged: Jan 2026 and Mar 2026",
    vm.runInContext("mergeSummary()", merged) === "2 exports merged: Jan 2026 and Mar 2026"]);

  // ── one export, with Finder copies and a ZIP beside its folder ──
  const alone = async (files) => { const c = copyCtx(); await dropInto(c, files); return [c, await stateOf(c)]; };
  const [bc, bOnly] = await alone(B);
  copyTests.push(["one export alone merges nothing, and says nothing about it", vm.runInContext("mergeSummary()", bc) === ""]);
  await dropInto(bc, B);
  copyTests.push(["the same folder added again replaces its copies instead of doubling them",
    vm.runInContext("RAW.length", bc) === B.length && vm.runInContext("mergeSummary()", bc) === "" && (await stateOf(bc)) === bOnly]);
  const [kc, kState] = await alone([...B,
    { path: "Export B/Player_Journey/Pokestop_spin1 2.csv", text: textOf(B, "Pokestop_spin1.csv") },
    { path: "Export B/FriendList (1).tsv", text: textOf(B, "FriendList.tsv") },
    { path: "Export B/Gameplay copy.txt", text: textOf(B, "Gameplay.txt") }]);
  copyTests.push(["Finder's Keep Both copies change nothing — no second precise spin log",
    kState === bOnly && vm.runInContext("mergeSummary()", kc) === "3 identical copies counted once"]);
  const pjZip = storedZip("Player_Journey.zip", B.filter((x) => x.path.includes("/Player_Journey/")).map((x) => [x.path.replace("Export B/", ""), x.text]));
  const [zc, zState] = await alone([...B, { path: "Export B/Player_Journey.zip", file: pjZip }]);
  copyTests.push(["a Player_Journey.zip beside its unzipped folder changes nothing",
    zState === bOnly && vm.runInContext("mergeSummary()", zc) === "2 identical copies counted once"]);
  copyTests.push([`the file count is what's in the folder — the ZIP once, not its contents again (${B.length + 1})`,
    vm.runInContext("visibleFiles()", zc) === B.length + 1 && vm.runInContext("RAW.length", zc) === B.length + 1 + 2]);

  // ── the same file picked twice is told by its content, never its place and size ──
  const [hc] = await alone(B);
  const friendsB = textOf(B, "FriendList.tsv");
  copyTests.push(["a copy is known by the SHA-256 of its bytes",
    vm.runInContext('RAW.find((r) => r.key === "friendlist.tsv").hash', hc) === crypto.createHash("sha256").update(friendsB).digest("hex")]);
  // the same place, the same size, other bytes: another copy, not the same file again
  await dropInto(hc, [{ path: "Export B/FriendList.tsv", text: friendsB.replace("friend5", "friend9") }]);
  copyTests.push(["a file at the same place and size with other bytes is kept beside the first",
    vm.runInContext('RAW.filter((r) => r.key === "friendlist.tsv").length', hc) === 2]);
  // Two exports' Player_Journey.zip picked one at a time: the same path and size,
  // other rows. The second pick used to replace the first.
  const spinRows = (days) => tsv(J1, days.map((d, i) => `1.00000${i},2.000000,1.00000${i},2.000000,2026-01-${d} 10:00:00.000 UTC`));
  const picks = [];
  for (const order of [[["01", "02", "09"], ["01", "03", "09"]], [["01", "03", "09"], ["01", "02", "09"]]]) {
    const c = copyCtx();
    for (const days of order) await dropInto(c, [{ path: "Player_Journey.zip", file: storedZip("Player_Journey.zip", [["Pokestop_spin1.csv", spinRows(days)]]) }]);
    picks.push([await stateOf(c), vm.runInContext("[STATE.ev.totals.Spins, RAW.filter((r) => !r.container).length, visibleFiles()].join()", c)]);
  }
  copyTests.push([`two ZIPs at the same path and size with other rows are both kept, in either order (${picks[0][1]})`,
    picks[0][0] === picks[1][0] && picks.every(([, n]) => n === "4,2,2")]);
  // ...while the very same ZIP picked again stays one copy
  const again = copyCtx();
  for (let k = 0; k < 2; k++) await dropInto(again, [{ path: "Player_Journey.zip", file: storedZip("Player_Journey.zip", [["Pokestop_spin1.csv", spinRows(["01", "02"])]]) }]);
  copyTests.push(["the same ZIP picked twice is one copy, its files too",
    vm.runInContext("RAW.length === 2 && visibleFiles() === 1", again)]);

  // ── what the list says: identical copies count once, copies with other rows were merged ──
  // a Keep Both copy that differs: a newer friend list copied in beside the old one
  const friendsPlus = { path: "Export B/FriendList 2.tsv", text: friendsB + friend(6, "2026-03-05") + "\n" };
  const [dc] = await alone([...B, friendsPlus]);
  copyTests.push(["a copy with other rows is merged, and never called a duplicate",
    vm.runInContext("mergeSummary()", dc) === "1 copy with different rows merged" && vm.runInContext("STATE.friends.rows.length", dc) === 5]);
  const bothKinds = [...B, friendsPlus, { path: "Export B/Gameplay copy.txt", text: textOf(B, "Gameplay.txt") }];
  const [bk] = await alone(bothKinds);
  copyTests.push(["merged copies and identical ones are each named for what they are",
    vm.runInContext("mergeSummary()", bk) === "1 copy with different rows merged · 1 identical copy counted once"]);
  const lc = makeRecordingContext();
  vm.runInContext("build = () => {}", lc);
  await dropInto(lc, bothKinds);
  HTML_OUT.length = 0;
  vm.runInContext("renderDetected()", lc);
  const listHtml = HTML_OUT.join("\n");
  copyTests.push(["each file's row says identical or merged too",
    listHtml.includes("Ready — 2 identical copies") && listHtml.includes("2 identical copies — counted once.")
    && listHtml.includes("Ready — newest of 2 copies") && listHtml.includes("1 copy with different rows merged · 1 identical copy counted once")]);

  // ── an identical copy is never another export ──
  // A second unzip of Player_Journey ("Player_Journey 2"), a copy of the whole
  // folder, or a file added again on its own is the same export once more.
  const pj2 = B.filter((x) => x.path.includes("/Player_Journey/")).map((x) => ({ ...x, path: x.path.replace("/Player_Journey/", "/Player_Journey 2/") }));
  const [p2c, p2State] = await alone([...B, ...pj2]);
  copyTests.push(["a second unzip of Player_Journey beside the first is no second export, and joins its folder",
    p2State === bOnly && vm.runInContext("mergeSummary()", p2c) === "2 identical copies counted once"
    && vm.runInContext("new Set(RAW.map((r) => r.group)).size", p2c) === 1]);
  const [fc, fState] = await alone([...B, ...B.map((x) => ({ ...x, path: x.path.replace("Export B/", "Export B copy/") }))]);
  copyTests.push([`a copy of the whole folder is no second export (${B.length} identical copies)`,
    fState === bOnly && vm.runInContext("mergeSummary()", fc) === `${B.length} identical copies counted once`]);
  const [rc] = await alone(B);
  await dropInto(rc, [{ path: "FriendList.tsv", text: friendsB }]);
  copyTests.push(["a file added again on its own is an identical copy, not a second export",
    (await stateOf(rc)) === bOnly && vm.runInContext("mergeSummary()", rc) === "1 identical copy counted once"]);
  const pc = copyCtx();
  for (const d of [A, B, [{ path: "FriendList.tsv", text: friendsB }]]) await dropInto(pc, d);
  await stateOf(pc);
  copyTests.push(["…and beside two exports it still reads as two exports, not three",
    vm.runInContext("mergeSummary()", pc) === "2 exports merged: Jan 2026 and Mar 2026 · 1 identical copy counted once"]);

  // ── the newest copy is the one holding the latest moment, wherever it sat ──
  // `pick` names what reached the parser for the file it cares about.
  const routed = async (drops, pick) => {
    const c = copyCtx();
    c.__pick = pick;
    vm.runInContext("__got = []; { const rf = routeFile; routeFile = async (n, t) => { const k = __pick(n, t); if (k) __got.push(k); return rf(n, t); }; }", c);
    for (const d of drops) await dropInto(c, d);
    await stateOf(c);
    return [vm.runInContext("__got.join()", c), vm.runInContext("mergeSummary()", c)];
  };
  // A Campfire export is dated by the moment in its name: an older one inside an
  // export folder used to beat a newer one dropped beside it.
  const cfText = (lines) => ["User's Clubs", "Club,Joined", "Club A,2025-01-01", ...lines].join("\n") + "\n";
  const cfOld = { path: "Export B/Tester_20260812_120000.csv", text: cfText(["older"]) };
  const cfNew = (dir) => ({ path: dir + "Tester_20261001_090000.csv", text: cfText(["Club B,2026-09-01", "newer"]) });
  const isCf = (n, t) => (/^\uFEFF?User'?s Clubs/.test(t.slice(0, 40)) ? (/newer/.test(t) ? "newer" : "older") : "");
  // …even inside an export whose other files run past both Campfire exports: a
  // Campfire export is a request of its own, as new as the moment in its name.
  const lateB = B.map((x) => ({ path: x.path.replace("Export B/", "Export D/"), text: x.path.endsWith("/FitnessData.tsv") ? x.text + fit("2026-12-01", 6) + "\n" : x.text }));
  const cfGot = [];
  for (const drops of [[[...B, cfOld], [cfNew("")]], [[cfNew("")], [...B, cfOld]], [[...B, cfOld], [cfNew("Campfire Oct/")]],
    [[{ ...cfOld, path: "Tester_20260812_120000.csv" }, cfNew("")]], [[...lateB, { ...cfOld, path: "Export D/Tester_20260812_120000.csv" }], [cfNew("")]]]) cfGot.push(await routed(drops, isCf));
  copyTests.push([`the newer Campfire export wins wherever the older one sat (${cfGot.map(([r]) => r).join(", ")})`,
    cfGot.every(([r]) => r === "newer")]);
  copyTests.push(["…and the list calls the two merged, never identical", cfGot.every(([, s]) => s === "1 copy with different rows merged")]);
  // A later export's friend list is the one used even when the friend added
  // last has been removed since and nobody was added after: every file of an
  // export is as new as the export. Ranked by the list's own latest friendship,
  // the earlier export's list won.
  const friendsIn = (n, t) => (/^friendlist\.tsv$/i.test(n) ? String(t.split("\n").filter((l) => l.trim()).length - 1) : "");
  const lostLast = B.map((x) => (x.path.endsWith("/FriendList.tsv") ? { ...x, text: tsv(FR, [friend(1, "2025-05-01"), friend(2, "2025-06-01")]) } : x));
  const frLater = [];
  for (const drops of [[A, lostLast], [lostLast, A], [[...A, ...lostLast]]]) frLater.push(await routed(drops, friendsIn));
  copyTests.push([`a later export's friend list wins though it has lost the earlier one's latest friend (${frLater.map(([n]) => n).join(", ")} friends)`,
    frLater.every(([n, s]) => n === "2" && s === "2 exports merged: Jan 2026 and Mar 2026")]);
  // A friend list dropped on its own is as new as its latest friendship. One
  // holding a friendship made after anything the export mentions is the newer
  // list, before or after the folder. One whose extra friendship falls inside
  // the export's span is the older list: had that friend still been there when
  // the export was made, the export would list them.
  const looseAfter = { path: "FriendList.tsv", text: friendsB + friend(6, "2026-03-20") + "\n" };
  const looseInside = { path: "FriendList.tsv", text: friendsB + friend(6, "2026-03-05") + "\n" };
  const frLoose = [];
  for (const [loose, want] of [[looseAfter, "5"], [looseInside, "4"]]) {
    for (const drops of [[B, [loose]], [[loose], B]]) frLoose.push([(await routed(drops, friendsIn))[0], want]);
  }
  copyTests.push([`a friend list dropped on its own wins only with a friendship later than the export (${frLoose.map(([n]) => n).join(", ")} friends)`,
    frLoose.every(([n, want]) => n === want)]);

  // ── the export-again reminder: the earlier exports keep what each newer one lets go ──
  const remindCtx = copyCtx();
  const remindHtml = vm.runInContext("exportAgain()", remindCtx).replace(/\s+/g, " ");
  const remindIcs = vm.runInContext("AGAIN_ICS", remindCtx);
  copyTests.push(["the export-again line says the earlier exports keep what each newer one has since let go",
    remindHtml.includes("Your earlier exports keep what each newer one has since let go, so drop them all in together for the longest history.")
    && !/adds what the last/.test(remindHtml)]);
  copyTests.push(["…and so does the calendar reminder, its commas escaped",
    remindIcs.includes("earlier ones — they keep what each newer one has since let go\\, so together they make the longest history")
    && !/stack into one longer/.test(remindIcs) && !/[^\\],/.test(remindIcs) && !/;/.test(remindIcs)]);
  // …and it lands on the right day: 60 days on from today on the reader's own
  // calendar. The reminders took their day from the UTC date, which is already
  // tomorrow on an evening west of Greenwich and still yesterday just after
  // midnight east of it. Instants where the two dates differ in one zone or
  // another, and DST changes, checked against the local calendar in every zone
  // this suite runs in.
  {
    const want = (iso, n) => { const t = new Date(iso); return new Date(Date.UTC(t.getFullYear(), t.getMonth(), t.getDate() + n)).toISOString().slice(0, 10).replace(/-/g, ""); };
    const got = (iso, n) => vm.runInContext(`icsDay(daysFromToday(${n}, new Date(${JSON.stringify(iso)})))`, remindCtx);
    const at = ["2026-09-13T00:48:00Z", "2026-09-12T20:00:00Z", "2026-09-12T23:59:30Z", "2026-03-08T06:30:00Z", "2026-10-25T00:30:00Z", "2026-12-31T22:00:00Z"];
    copyTests.push([`the reminders' day is today's on the reader's own calendar, 60 and 7 days on (${process.env.TZ})`,
      at.every((iso) => got(iso, 60) === want(iso, 60) && got(iso, 7) === want(iso, 7))
      && (process.env.TZ !== "Etc/GMT+7" || got("2026-09-13T00:48:00Z", 60) === "20261111")]);
    const landingSrc = fs.readFileSync(path.join(ROOT, "js/landing.js"), "utf8");
    copyTests.push(["…and neither reminder takes its day from the UTC date",
      !/toISOString\(\)\.slice\(0, ?10\)/.test(landingSrc) && /setDate\(d\.getDate\(\) \+ 7\)/.test(landingSrc)
      && !/date\.toISOString\(\)\.slice\(0, ?10\)/.test(fs.readFileSync(path.join(ROOT, "js/app.js"), "utf8"))]);
  }
  // ...and it is for a player's own report: not the sample trainer that
  // metrics.html?demo=1 builds on the real page
  const outroOf = (sample) => vm.runInContext(`SAMPLE_DATA = ${sample}; outro()`, remindCtx);
  copyTests.push(["the 60-day reminder shows on a player's own report and not under the sample trainer",
    outroOf(false).includes('id="again-ics"') && !outroOf(true).includes("again-ics") && !outroOf(true).includes("Export again")]);

  // ── one journey file from two exports: rows keyed by exact instant ──
  // The same moment written in other bytes by each export (a blur, a rounding)
  // is one event, not two; two events one export logs at one instant stay two;
  // a row repeated byte for byte counts once; the same second at another
  // millisecond is another instant.
  const jr = (lat, when) => `${lat},2.000000,${lat},2.000000,${when} UTC`;
  const X = [{ path: "Export X/Player_Journey/Pokestop_spin1.csv", text: tsv(J1, [
    jr("1.100000", "2026-04-01 10:00:00.250"), jr("1.100000", "2026-04-01 10:00:00.250"),   // repeated byte for byte
    jr("1.200000", "2026-04-02 10:00:00.000"), jr("1.300000", "2026-04-02 10:00:00.000"),   // two events at one instant
    jr("1.400000", "2026-04-03 10:00:00.000")]) }];
  const Y = [{ path: "Export Y/Player_Journey/Pokestop_spin1.csv", text: tsv(J1, [
    jr("1.100001", "2026-04-01 10:00:00.250"),   // X's first moment, in other bytes
    jr("1.200000", "2026-04-02 10:00:00.000"),   // one of X's two events there
    jr("1.500000", "2026-04-01 10:00:00.750"),   // X's first second, another instant
    jr("1.600000", "2026-04-04 10:00:00.000")]) }];
  const byInstant = [];
  for (const drops of [[X, Y], [Y, X], [[...X, ...Y]]]) {
    const c = copyCtx();
    for (const d of drops) await dropInto(c, d);
    byInstant.push([await stateOf(c), vm.runInContext("STATE.ev.totals.Spins", c)]);
  }
  copyTests.push([`one journey file from two exports counts each instant once, as often as one copy holds it (${byInstant.map(([, n]) => n).join(", ")} of 6)`,
    byInstant.every(([s, n]) => n === 6 && s === byInstant[0][0])]);

  // ── counting inside one pair ──
  const cc = copyCtx();
  const p = (lat, when) => `${lat},${lat},${lat},${lat},${when}.000 UTC`;
  cc.__one = tsv(J1, [p("1.100000", "2026-05-01 10:00:00"), p("1.200000", "2026-05-02 10:00:00"), p("1.200000", "2026-05-02 10:00:00"), p("1.300000", "2026-05-03 10:00:00")]);
  cc.__two = tsv(J1, [
    p("1.110000", "2025-01-01 10:00:00"), p("1.110000", "2025-01-01 10:00:00"),   // outside the window, byte-identical twice
    p("1.150000", "2026-05-01 10:00:00"), p("1.150000", "2026-05-02 10:00:00"), p("1.150000", "2026-05-03 10:00:00"),   // the precise rows again, blurred
    p("1.160000", "2026-05-02 10:00:00"),   // a second event at an instant the precise file holds only once
    p("1.150000", "2026-05-02 12:00:00"),   // inside the window, with no precise twin at all
  ]);
  vm.runInContext('RAW = [{ name: "Pokestop_spin1.csv" }, { name: "Pokestop_spin2.csv" }]', cc);
  await vm.runInContext('routeFile("Pokestop_spin1.csv", __one)', cc);
  const n1 = vm.runInContext("STATE.ev.totals.Spins", cc);
  await vm.runInContext('routeFile("Pokestop_spin2.csv", __two)', cc);
  const n2 = vm.runInContext("STATE.ev.totals.Spins", cc);
  copyTests.push([`a row repeated byte for byte inside one file counts once (${n1} of 4 rows)`, n1 === 3]);
  copyTests.push([`a "2" row is skipped only for a precise row at its instant, each used once (${n2 - n1} of 7 rows)`, n2 - n1 === 3]);
  copyTests.push(["the precise instants are let go once the twin is read", vm.runInContext("STATE.ev.win.Spins.at === null && STATE.ev.stamps.length === 6", cc)]);
}

/* ---------- your time, and fitness days, in any zone ----------
 * The hour-of-day grid shifted every moment by the viewer's CURRENT offset, so
 * in a zone that changes its clocks half of every year sat an hour out. Each
 * moment now lands on its own local hour — checked against Intl in this
 * process's zone, which differs in each of the six runs, two of them half and
 * three-quarter hours off UTC. */
const tzTests = [];
{
  const tz = process.env.TZ;
  const c = copyCtx();
  // noon on a New York clock in January (UTC-5) and July (UTC-4), both Wednesdays; the two clock-change nights; a New Year's Eve
  const when = ["2026-01-14 17:00:00", "2026-07-15 16:00:00", "2026-03-08 06:30:00", "2026-11-01 05:30:00", "2025-12-31 23:30:00", "2026-06-21 03:15:00"];
  c.__t = J1 + "\n" + when.map((w) => `0,0,0,0,${w}.000 UTC`).join("\n") + "\n";
  vm.runInContext('RAW = [{ name: "Pokestop_spin1.csv" }]', c);
  await vm.runInContext('routeFile("Pokestop_spin1.csv", __t)', c);
  const grid = JSON.parse(vm.runInContext("JSON.stringify(STATE.ev.hourweekLocal)", c));
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short", hour: "numeric", hourCycle: "h23" });
  const want = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const w of when) {
    const x = Object.fromEntries(parts.formatToParts(new Date(w.replace(" ", "T") + "Z")).map((q) => [q.type, q.value]));
    want[DAYS.indexOf(x.weekday)][+x.hour % 24]++;
  }
  tzTests.push([`the your-time grid puts each moment on its own local hour (${tz})`, JSON.stringify(grid) === JSON.stringify(want)]);
  if (tz === "America/New_York") tzTests.push(["noon in January and noon in July both land on Wednesday 12 in New York", grid[2][12] === 2]);
  const rc = makeRecordingContext();
  rc.__t = c.__t;
  vm.runInContext('RAW = [{ name: "Pokestop_spin1.csv" }]', rc);
  await vm.runInContext('routeFile("Pokestop_spin1.csv", __t)', rc);
  const chips = /data-grid="local"/.test(String(vm.runInContext("renderActivity()", rc)));
  tzTests.push([`the Your time / UTC switch shows only where the two differ (${tz})`, chips === (tz !== "UTC")]);
  // The story's "your hour" card reads the same local grid. Five moments inside
  // one local hour in India and in Nepal straddle two UTC hours there, so any
  // shift of whole UTC hours would split them: each moment is bucketed on its
  // own local hour and weekday.
  const hc = copyCtx();
  const cluster = ["2026-01-14 06:40:00", "2026-01-14 06:50:00", "2026-01-14 06:55:00", "2026-01-14 07:05:00", "2026-01-14 07:10:00", "2026-01-15 03:00:00"];
  hc.__t = J1 + "\n" + cluster.map((w) => `0,0,0,0,${w}.000 UTC`).join("\n") + "\n";
  vm.runInContext('RAW = [{ name: "Pokestop_spin1.csv" }]', hc);
  await vm.runInContext('routeFile("Pokestop_spin1.csv", __t)', hc);
  const cg = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const w of cluster) {
    const x = Object.fromEntries(parts.formatToParts(new Date(w.replace(" ", "T") + "Z")).map((q) => [q.type, q.value]));
    cg[DAYS.indexOf(x.weekday)][+x.hour % 24]++;
  }
  let bd = 0, bh = 0, bn = 0;
  for (let d = 0; d < 7; d++) for (let h = 0; h < 24; h++) if (cg[d][h] > bn) { bn = cg[d][h]; bd = d; bh = h; }
  const card = vm.runInContext("(storySlides().find((s) => s.kicker === 'YOUR HOUR') || {}).big || ''", hc);
  tzTests.push([`the "your hour" card is the busiest hour on the viewer's own clock (${tz}: ${card})`,
    vm.runInContext("JSON.stringify(STATE.ev.hourweekLocal)", hc) === JSON.stringify(cg)
    && card === vm.runInContext(`DAY_FULL[${bd}] + "s, " + hourLabel(${bh})`, hc)]);
  if (/Kolkata|Kathmandu/.test(tz)) tzTests.push([`five moments across two UTC hours share one local hour in ${tz}`, bn === 5]);
  vm.runInContext("__charts = []; newChart = (id, cfg) => { __charts.push(cfg); return null; }", rc);
  rc.__f = "Date and time of logging (UTC)\tSteps walked\tDistance travelled (meters)\tCalories burned\n2026-08-14T02:00:00.000Z\t1234\t900\t50\n";
  await vm.runInContext('routeFile("FitnessData.tsv", __f)', rc);
  vm.runInContext("POST = []; renderFitness(); POST.forEach((f) => f()); POST = []", rc);
  const labels = vm.runInContext("JSON.stringify(__charts[0] && __charts[0].data.labels)", rc);
  tzTests.push([`a fitness bar is labelled with its own UTC day, not the day before (${labels})`, labels === '["Aug 14"]']);
  // The sample's chattiest Campfire hour and busiest invite weekday, each moment
  // on its own local clock, against a count of our own made with Intl in this
  // run's zone (the goldens read both in UTC-7). A Campfire message's text can
  // hold commas, quotes and line breaks, so the export is read as quoted CSV.
  const csvRecords = (t) => {
    const out = [];
    let row = [], f = "", q = false;
    for (let i = 0; i < t.length; i++) {
      const ch = t[i];
      if (q) { if (ch !== '"') f += ch; else if (t[i + 1] === '"') { f += '"'; i++; } else q = false; }
      else if (ch === '"') q = true;
      else if (ch === ",") { row.push(f); f = ""; }
      else if (ch === "\n") { row.push(f); out.push(row); row = []; f = ""; }
      else if (ch !== "\r") f += ch;
    }
    if (f || row.length) { row.push(f); out.push(row); }
    return out;
  };
  const recs = csvRecords(fs.readFileSync(path.join(DEMO, fs.readdirSync(DEMO).find((n) => /_\d{8}_\d{6}\.csv$/.test(n))), "utf8"));
  const sentAt = [];
  for (let i = recs.findIndex((r) => r.length === 1 && /^\uFEFF?User'?s Sent Messages/i.test(r[0])) + 2; i > 1 && i < recs.length && recs[i].some((x) => x.trim()); i++) {
    const m = /^(\d{4}-\d\d-\d\d) (\d\d:\d\d:\d\d)/.exec(recs[i][1] || "");
    if (m) sentAt.push(new Date(`${m[1]}T${m[2]}Z`));
  }
  const byHour = Array(24).fill(0);
  const hourOf = new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", hourCycle: "h23" });
  for (const d of sentAt) byHour[+hourOf.format(d) % 24]++;
  const gotHour = (String(vm.runInContext("POST = []; renderCampfire() || ''", ctx)).match(/chattiest hour is <b>([^<]+)<\/b>/) || [])[1];
  tzTests.push([`the sample's chattiest Campfire hour is each message's own local hour (${tz}: ${gotHour}, ${sentAt.length} messages)`,
    sentAt.length === 1180 && gotHour === vm.runInContext(`hourLabel(${byHour.indexOf(Math.max(...byHour))})`, ctx)]);
  const WEEK = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
  const dayOf = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long" });
  const invitedAt = [];
  for (const l of fs.readFileSync(path.join(DEMO, "RecentInviteActions.tsv"), "utf8").split(/\r?\n/)) {
    const c = l.split("\t"), m = /(\d\d)\/(\d\d)\/(\d{4}) (\d\d:\d\d:\d\d)/.exec(c[1] || "");
    if (m && /accept|declin|sent|send/i.test(c[0] || "")) invitedAt.push(new Date(`${m[3]}-${m[1]}-${m[2]}T${m[4]}Z`));
  }
  for (const f of ["ActivityInvitesReceived.tsv", "ActivityInvitesSent.tsv"]) {
    for (const l of fs.readFileSync(path.join(DEMO, f), "utf8").split(/\r?\n/).slice(1)) {
      const t = (l.split("\t")[1] || "").trim();
      if (/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d/.test(t)) invitedAt.push(new Date(t));
    }
  }
  const byDay = Array(7).fill(0);
  for (const d of invitedAt) byDay[WEEK.indexOf(dayOf.format(d))]++;
  const gotDay = (String(vm.runInContext("POST = []; renderSocial() || ''", ctx)).match(/land on a <b>(\w+)<\/b>/) || [])[1];
  tzTests.push([`the sample's busiest invite weekday is each invite's own local weekday (${tz}: ${gotDay}, ${invitedAt.length} invites)`,
    invitedAt.length === 268 && gotDay === WEEK[byDay.indexOf(Math.max(...byDay))]]);
}

/* ---------- builds: files mid-build, and a library that fails ---------- */
const buildTests = [];
{
  const bc = makeRecordingContext();
  const run = (code) => vm.runInContext(code, bc);
  run(`__seen = []; parseRaw = async () => { __seen.push(RAW.length); await new Promise((r) => setTimeout(r, 30)); return null; };
    RAW = [{ name: "FitnessData.tsv", key: "fitnessdata.tsv" }];`);
  const firstBuild = run("build()");
  run('RAW.push({ name: "FriendList.tsv", key: "friendlist.tsv" }); build(); build();');   // files landing mid-build
  await firstBuild;
  for (let i = 0; i < 100 && run("BUILDING"); i++) await new Promise((r) => setTimeout(r, 10));
  buildTests.push(["files that arrive mid-build get exactly one more build, and it sees them",
    run("__seen.join()") === "1,2" && run("!BUILD_AGAIN && !BUILDING")]);
  // a library refused while the files are still parsing must be caught on the spot
  const unhandled = [];
  const onRejection = (reason) => unhandled.push(String(reason && reason.message));
  process.on("unhandledRejection", onRejection);
  run(`for (const k in _libLoads) delete _libLoads[k];
    loadVendor = () => Promise.reject(new Error("refused in a test"));
    parseRaw = async () => { await new Promise((r) => setTimeout(r, 30)); return null; };`);
  await run("build()");
  await new Promise((r) => setTimeout(r, 30));
  process.off("unhandledRejection", onRejection);
  buildTests.push(["a library that fails to load mid-parse is never an unhandled rejection", unhandled.length === 0]);
}

/* ---------- file names in the file list are text too ----------
 * A copy's own name, a folder's and an archive's all reach the detected-files
 * list and the upload strip now. */
{
  const tc = makeRecordingContext();
  vm.runInContext("build = () => {}", tc);
  const fitness = fs.readFileSync(path.join(DEMO, "FitnessData.tsv"), "utf8");
  tc.__drop = [
    [new File(["a\tb\n1\t2\n"], `${PAYLOAD}.tsv`), `Folder ${PAYLOAD}/${PAYLOAD}.tsv`],
    [new File(["a\tb\n1\t2\n3\t4\n"], `${PAYLOAD} 2.tsv`), `Folder ${PAYLOAD}/${PAYLOAD} 2.tsv`],
    [storedZip(`${PAYLOAD}.zip`, [["FitnessData.tsv", fitness]]), `Folder ${PAYLOAD}/${PAYLOAD}.zip`],
  ];
  vm.runInContext("__drop.forEach(([f, p]) => FILE_PATH.set(f, p))", tc);
  await vm.runInContext("ingest(__drop.map(([f]) => f))", tc);
  HTML_OUT.length = 0;
  vm.runInContext("renderDetected(); try { mountUploadStrip(); } catch (e) {}", tc);
  const html = HTML_OUT.join("\n");
  securityTests.push(["taint: copies' names and an archive's name render as text in the file list and the strip",
    /&lt;zq1&gt;&quot;zq2&#39;&amp;zq3; 2\.tsv/.test(html) && /&lt;zq1&gt;&quot;zq2&#39;&amp;zq3;\.zip/.test(html)
    && !/<zq1/i.test(html) && !/"zq2'/.test(html) && !/&amp;(?:lt;zq1|quot;zq2|amp;zq3)/.test(html)]);
}

/* ---------- the same suite in five more zones ---------- */
const zoneRuns = [];
if (!process.env.POGO_TEST_CHILD) {
  for (const tz of ["America/New_York", "Europe/London", "UTC", "Asia/Kolkata", "Asia/Kathmandu"]) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url)], { env: { ...process.env, TZ: tz, POGO_TEST_CHILD: "1" }, encoding: "utf8" });
    const tally = ((r.stdout || "").match(/(\d+\/\d+) passed/) || [])[1];
    zoneRuns.push([`the whole suite passes under TZ=${tz}${tally ? ` (${tally})` : ""}`, r.status === 0]);
    if (r.status !== 0) zoneRuns.push([`  ${tz}: ${(r.stdout || "").split("\n").filter((l) => /FAIL/.test(l)).slice(0, 4).join(" | ").trim() || (r.stderr || "").slice(0, 200)}`, false]);
  }
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
console.log("");
for (const [k, ok] of securityTests) {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${k}`);
}
console.log("");
for (const [k, ok] of sriTests) {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${k}`);
}
const drift = checkVendor(vendor);
if (drift.length) console.log(`\n  ${drift.join("\n  ")}\n  fix with: node tools/sri.mjs --write`);
console.log("");
for (const [k, ok] of [...labelTests, ...festTests]) {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${k}`);
}
console.log("");
for (const [k, ok] of aesTests) {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${k}`);
}
console.log("");
for (const [k, ok] of unusedTests) {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${k}`);
}
console.log("");
for (const [k, ok] of [...copyTests, ...tzTests, ...buildTests, ...zoneRuns]) {
  if (!ok) failed++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${k}`);
}
const total = Object.keys(GOLDEN).length + invariants.length + streamTests.length + pairTests.length + zipTests.length
  + securityTests.length + sriTests.length + labelTests.length + festTests.length + aesTests.length + unusedTests.length
  + copyTests.length + tzTests.length + buildTests.length + zoneRuns.length;
console.log(`\n  ${total - failed}/${total} passed\n`);
process.exit(failed ? 1 : 0);
