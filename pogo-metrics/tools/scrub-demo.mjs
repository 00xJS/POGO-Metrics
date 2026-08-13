/* scrub-demo.mjs — turn a REAL Niantic Pokémon GO export into a fully
 * anonymized, downsampled demo dataset that the site can load to showcase
 * every visualization without exposing any real personal data.
 *
 * Usage:  node scrub-demo.mjs <path-to-export-dir> [out-dir]
 *   <export-dir>  a folder containing Gameplay.txt + Player_Journey/ etc.
 *   [out-dir]     defaults to ../sample-export (relative to this script)
 *
 * What it scrubs:
 *   • All GPS coordinates are translated to a fake city + jittered, so the
 *     shape of the heatmap/trail survives but the real location is gone.
 *   • Trainer name, buddy name, friend codenames/nicknames → fake.
 *   • Emails, order numbers, IPs, ad-IDs, postal codes, phone carrier → dropped.
 *   • Cities in session data → remapped to fake cities.
 *   • Event logs are downsampled (uniform stride) to keep the demo light.
 * Numeric gameplay stats, spend amounts, medals, species, dates and timing
 * are preserved so the story still feels real. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.argv[2];
// sample-export/, not demo/ — a data folder must never share its name with a
// page, or Netlify's extensionless URLs put both at the same path (see netlify.toml).
const OUT = process.argv[3] || path.join(__dirname, "..", "sample-export");
if (!SRC || !fs.existsSync(path.join(SRC, "Gameplay.txt"))) {
  console.error("Usage: node scrub-demo.mjs <export-dir-with-Gameplay.txt> [out-dir]");
  process.exit(1);
}
const PJ_SRC = path.join(SRC, "Player_Journey");
fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(path.join(OUT, "Player_Journey"), { recursive: true });

/* ---------- seeded RNG (reproducible) ---------- */
let seed = 1337;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

/* ---------- fake name pools ---------- */
const ADJ = ["Swift", "Brave", "Mighty", "Lucky", "Cosmic", "Solar", "Shadow", "Crystal", "Turbo", "Electric", "Mystic", "Golden", "Crimson", "Frost", "Thunder", "Ember", "Lunar", "Radiant", "Iron", "Wild"];
const NOUN = ["Charizard", "Trainer", "Pikachu", "Raptor", "Falcon", "Voyager", "Ranger", "Hunter", "Comet", "Phoenix", "Tracker", "Maverick", "Nomad", "Pioneer", "Scout", "Dragon", "Striker", "Wanderer", "Sage", "Ace"];
const FIRST = ["Alex", "Sam", "Jordan", "Casey", "Riley", "Taylor", "Morgan", "Jamie", "Avery", "Quinn", "Robin", "Drew", "Skyler", "Reese", "Charlie", "Frankie", "Sage", "River", "Dakota", "Emerson"];
const CITIES = [["Rivertown", "Oregon"], ["Lakeside", "Colorado"], ["Brightport", "Washington"], ["Maplefield", "Vermont"], ["Stonehaven", "Maine"], ["Fairview", "Idaho"], ["Westbrook", "Montana"], ["Greendale", "Iowa"]];
const fakeCodename = () => pick(ADJ) + pick(NOUN) + Math.floor(rnd() * 900 + 100);
const fakeNick = () => pick(FIRST);
const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const fakeId = (len) => Array.from({ length: Math.max(6, len) }, () => ID_CHARS[Math.floor(rnd() * ID_CHARS.length)]).join("");

/* ---------- redaction ledger ----------
 * Every real identifier we find gets recorded here with the fake that replaces
 * it, and the LAST thing this script does is scan every written file for these
 * strings. Rewriting the one line an identifier is declared on is not enough:
 * Gameplay.txt quotes the buddy's nickname again inside the VS Seeker log, so
 * a line-scoped rewrite left it in the published demo. Register, replace
 * globally, then verify. */
const SECRETS = new Map(); // real value → the fake that replaces it
/* Register a real identifier and get its fake back. The mapping is stable, so
 * the same trainer gets the same fake codename everywhere they appear. */
function hide(real, makeFake) {
  const s = String(real == null ? "" : real).trim();
  if (!s) return "";
  if (!SECRETS.has(s)) SECRETS.set(s, makeFake(s));
  return SECRETS.get(s);
}
const hideCodename = (real) => hide(real, fakeCodename) || fakeCodename();
/* Below 3 characters a "secret" is more likely to collide with ordinary text
 * (a species name, an item code) than to be an identifier worth chasing. */
const chaseable = ([real]) => real.length >= 3;
function applyRedactions(text) {
  // Longest first, so a nickname nested inside a longer captured string
  // ("Meowth (NICKNAME)" vs "NICKNAME") can't be half-replaced.
  const pairs = [...SECRETS.entries()].filter(chaseable).sort((a, b) => b[0].length - a[0].length);
  for (const [real, fake] of pairs) text = text.split(real).join(fake);
  return text;
}

/* ---------- coordinates: generated, not derived ----------
 * This used to translate every real coordinate by ONE global offset and add
 * ±45 m of jitter. That reads as anonymisation and is not: a rigid translation
 * preserves every distance, bearing and cluster shape exactly, so the published
 * demo was the owner's real movement geometry with a constant added. Anyone who
 * recognised a single cluster could solve for the offset and recover the lot,
 * home included. The output spanned 105° of latitude and 335° of longitude,
 * which is not the "fake city" the docs claimed either.
 *
 * So no demo coordinate is derived from a real one any more. Instead a
 * synthetic world is built up front, and each DISTINCT real coordinate is
 * assigned a place in it by how OFTEN it appears — never by where it is.
 * Frequency rank is the only thing that crosses over, and visit counts are
 * already on screen in the "regular haunts" chapter, so nothing new is exposed.
 *
 * What that buys, and why it is worth the trouble: the shape that makes the
 * demo worth looking at is not the real map, it is the DISTRIBUTION — one stop
 * you visit constantly, a tail of stops you don't, a home city, a handful of
 * places you travelled to, and some raids far enough away to be remote. All of
 * that is reproduced. None of it is his. */
function num(x) { const n = parseFloat(x); return isNaN(n) ? null : n; }

/* Real, public city centres. They belong to no one and reveal nothing. */
const HOME = { name: "Los Angeles", lat: 34.0522, lon: -118.2437, radiusKm: 20 };
const AWAY = [
  { name: "Seattle", lat: 47.6062, lon: -122.3321, radiusKm: 9 },
  { name: "Chicago", lat: 41.8781, lon: -87.6298, radiusKm: 9 },
  { name: "New York", lat: 40.7128, lon: -74.0060, radiusKm: 9 },
  { name: "London", lat: 51.5074, lon: -0.1278, radiusKm: 7 },
  { name: "Tokyo", lat: 35.6762, lon: 139.6503, radiusKm: 7 },
  { name: "Sydney", lat: -33.8688, lon: 151.2093, radiusKm: 7 },
  { name: "São Paulo", lat: -23.5505, lon: -46.6333, radiusKm: 7 },
];
const KM_PER_DEG = 111.32;
/* A point drawn uniformly inside a city's disc. sqrt() on the radius keeps the
 * density even instead of bunching everything around the centre. */
function within(city) {
  const r = Math.sqrt(rnd()) * city.radiusKm;
  const th = rnd() * Math.PI * 2;
  return [
    city.lat + (r * Math.cos(th)) / KM_PER_DEG,
    city.lon + (r * Math.sin(th)) / (KM_PER_DEG * Math.cos((city.lat * Math.PI) / 180)),
  ];
}
const fix6 = ([a, o]) => [a.toFixed(6), o.toFixed(6)];

/* Pre-pass: how many times does each distinct real coordinate appear? Only the
 * COUNT is kept — the coordinate itself is used as a dictionary key and then
 * thrown away. */
function tally(counts, la, lo) {
  const a = num(la), o = num(lo);
  if (a == null || o == null || (a === 0 && o === 0)) return;
  const key = a.toFixed(5) + "," + o.toFixed(5);
  counts.set(key, (counts.get(key) || 0) + 1);
}
function surveyCoords() {
  const place = new Map(), gym = new Map();
  for (const [type] of EVENT_TYPES) {
    for (const suffix of ["1", "2"]) {
      const lines = readLines(path.join(PJ_SRC, `${type}${suffix}.csv`));
      if (!lines || !lines.length) continue;
      const cols = lines[0].split(",");
      const latI = cols.findIndex((c) => /Player_Latitude/i.test(c));
      const lonI = cols.findIndex((c) => /Player_Longitude/i.test(c));
      const gLatI = cols.findIndex((c) => /(Gym|Fort)_Latitude/i.test(c));
      const gLonI = cols.findIndex((c) => /(Gym|Fort)_Longitude/i.test(c));
      const isGym = /Gym_Latitude/i.test(lines[0]);
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const c = lines[i].split(",");
        if (latI >= 0) tally(place, c[latI], c[lonI]);
        // Fort_* is a PokéStop and shares the "place" world with the player;
        // Gym_* is a raid target and gets its own, so raid distance is ours to set.
        if (gLatI >= 0) tally(isGym ? gym : place, c[gLatI], c[gLonI]);
      }
    }
  }
  return { place, gym };
}

/* Assign every distinct real coordinate a synthetic home, ranked by frequency.
 * The busiest handful are pinned to HOME so the "your local" story survives;
 * the rest fall to HOME or a travel city on a seeded coin-flip. Because rank is
 * the only input, two real stops that were metres apart routinely land on
 * different continents — which is the point. */
function buildAtlas(counts, { pinned, homeShare }) {
  const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1));
  const atlas = new Map();
  const cityOf = new Map();
  ranked.forEach(([key], i) => {
    const city = i < pinned || rnd() < homeShare ? HOME : pick(AWAY);
    atlas.set(key, within(city));
    cityOf.set(key, city);
  });
  return { atlas, cityOf, ranked };
}

/* ---------- helpers ---------- */
const readLines = (fp) => fs.existsSync(fp) ? fs.readFileSync(fp, "utf8").replace(/\r/g, "").split("\n") : null;
const written = [];
function write(rel, content) { fs.writeFileSync(path.join(OUT, rel), content); written.push(rel); console.log("  wrote", rel); }
function strideSample(rows, cap) {
  if (rows.length <= cap) return rows;
  const step = Math.ceil(rows.length / cap);
  return rows.filter((_, i) => i % step === 0);
}

/* ---------- Gameplay.txt (keep stats, strip every identifier) ----------
 * This file is mostly numbers, but it ends with an identity section that has
 * nothing to do with gameplay: two account IDs that tie the export to a real
 * Nintendo/Pokémon Home account, your referral code, and the codenames of
 * every trainer you referred — other people's data, in a file that ships in a
 * public repo. Collect them all into the redaction ledger, then rewrite the
 * whole file at once so nothing survives in a second place. */
{
  const raw = fs.readFileSync(path.join(SRC, "Gameplay.txt"), "utf8");
  const lines = raw.replace(/\r/g, "").split("\n");
  const single = [
    [/^Pokemon Home Trainer Name:\s*(.*)$/i, () => "AshDemo"],
    [/^Buddy nickname:\s*(.*)$/i, () => "Sparky"],
    [/^Nintendo Account ID:\s*(.*)$/i, (v) => fakeId(v.length)],
    [/^Pokemon Home Support ID:\s*(.*)$/i, (v) => fakeId(v.length)],
    [/^Referral code:\s*(.*)$/i, (v) => fakeId(v.length)],
  ];
  let inReferral = false;
  for (const line of lines) {
    let matched = false;
    for (const [re, fake] of single) {
      const m = line.match(re);
      if (m && m[1].trim()) { hide(m[1], fake); matched = true; break; }
    }
    if (matched) continue;
    if (/^Referral Connections:/i.test(line)) { inReferral = true; continue; }
    if (!inReferral) continue;
    if (!line.trim()) { inReferral = false; continue; }
    if (/^Player\b/i.test(line)) continue;      // the "Player\tAreFriends" header
    hideCodename(line.split("\t")[0]);          // a real trainer you referred
  }
  write("Gameplay.txt", applyRedactions(raw));
}

/* ---------- Player_Journey event files (merge 1+2, scrub coords, downsample) ---------- */
const EVENT_TYPES = [
  ["Pokestop_spin", 2600], ["Sfida_capture", 2600], ["Map_Pokemon_encounter", 1600],
  ["Join_Raid_lobby", 3000], ["Gym_battle", 1000], ["Feed_Pokemon", 1400],
  ["Deploy_Pokemon", 1200], ["Incense_encounter", 800], ["Lure_encounter", 800],
];
/* Build the synthetic world. Survey first (EVENT_TYPES has to exist), then hand
 * every distinct real coordinate a home in it.
 *   pinned    how many of the busiest get forced into HOME. 12 stops keeps the
 *             "your local" ranking intact; 6 gyms does the same for raids.
 *   homeShare the odds an unpinned coordinate stays in HOME. Real players are
 *             overwhelmingly local, and a demo that isn't looks wrong. */
const SURVEY = surveyCoords();
const PLACES = buildAtlas(SURVEY.place, { pinned: 12, homeShare: 0.80 });
const GYMS = buildAtlas(SURVEY.gym, { pinned: 6, homeShare: 0.72 });
/* Share of raid lobbies joined remotely. Remote raiding is common enough to be
 * worth a chapter and nowhere near universal — this is a plausible constant,
 * not a measurement of anyone. */
const REMOTE_SHARE = 0.34;
const keyOf = (la, lo) => {
  const a = num(la), o = num(lo);
  return a == null || o == null || (a === 0 && o === 0) ? null : a.toFixed(5) + "," + o.toFixed(5);
};
function mapPlace(la, lo) { const k = keyOf(la, lo); return k ? PLACES.atlas.get(k) || null : null; }
function placeGym(la, lo) {
  const k = keyOf(la, lo);
  if (!k || !GYMS.atlas.has(k)) return null;
  return { pos: GYMS.atlas.get(k), city: GYMS.cityOf.get(k) };
}
/* Where the player stood for a raid, decided ONCE per (real spot, real gym)
 * pair and reused. Generating this per row instead scattered every repeat raid
 * to a fresh position and blew the app's "distinct places you played" count
 * from ~500 to ~4,000 — a demo trainer who never stands in the same place
 * twice. The pair is the right key: raid the same gym from the same spot and
 * you get the same synthetic spot, which is what makes the map cluster. */
const raidSpots = new Map();
function raidSpot(pKey, gKey, g) {
  const k = pKey + "→" + gKey;
  let hit = raidSpots.get(k);
  if (!hit) {
    const remote = rnd() < REMOTE_SHARE;
    const elsewhere = AWAY.filter((x) => x !== g.city);
    hit = remote && elsewhere.length ? within(pick(elsewhere)) : nearby(g.pos, 12);
    raidSpots.set(k, hit);
  }
  return hit;
}
/* A point within `km` of another — used to stand the player next to a gym. */
function nearby([lat, lon], km) {
  const r = Math.sqrt(rnd()) * km;
  const th = rnd() * Math.PI * 2;
  return [
    lat + (r * Math.cos(th)) / KM_PER_DEG,
    lon + (r * Math.sin(th)) / (KM_PER_DEG * Math.cos((lat * Math.PI) / 180)),
  ];
}
console.log(`  synthetic world: ${PLACES.atlas.size} places, ${GYMS.atlas.size} gyms across ${1 + AWAY.length} cities`);

for (const [type, cap] of EVENT_TYPES) {
  let header = null, body = [];
  for (const suffix of ["1", "2"]) {
    const lines = readLines(path.join(PJ_SRC, `${type}${suffix}.csv`));
    if (!lines) continue;
    if (!header) header = lines[0];
    for (let i = 1; i < lines.length; i++) if (lines[i].trim()) body.push(lines[i]);
  }
  if (!header) continue;
  const cols = header.split(",");
  const latI = cols.findIndex((c) => /Player_Latitude/i.test(c));
  const lonI = cols.findIndex((c) => /Player_Longitude/i.test(c));
  const gLatI = cols.findIndex((c) => /(Gym|Fort)_Latitude/i.test(c));
  const gLonI = cols.findIndex((c) => /(Gym|Fort)_Longitude/i.test(c));
  const isGym = /Gym_Latitude/i.test(header);
  const sampled = strideSample(body, cap).map((line) => {
    const c = line.split(",");
    /* Raids are the one event where the two coordinates must RELATE to each
     * other — the app calls a raid remote when the player is ≥50 km from the
     * gym, and that stat has its own chapter. Place the gym first, then put
     * the player either beside it or in a different city entirely, on a coin
     * flip weighted to match how people actually raid. The real distance is
     * never consulted, so no real reach is disclosed. */
    /* Sfida_capture carries Gym_* COLUMNS with empty VALUES, so "does the
     * header mention a gym" is not the same question as "is this row a raid".
     * Getting that wrong let 2,575 rows of real coordinates through untouched:
     * the gym lookup failed, and the branch returned before anything was
     * rewritten. Only take the raid path when a gym is actually there. */
    const g = isGym && latI >= 0 && gLatI >= 0 ? placeGym(c[gLatI], c[gLonI]) : null;
    if (g) {
      const pKey = keyOf(c[latI], c[lonI]), gKey = keyOf(c[gLatI], c[gLonI]);
      [c[gLatI], c[gLonI]] = fix6(g.pos);
      [c[latI], c[lonI]] = fix6(raidSpot(pKey, gKey, g));
      return c.join(",");
    }
    if (latI >= 0 && lonI >= 0) { const p = mapPlace(c[latI], c[lonI]); if (p) [c[latI], c[lonI]] = fix6(p); }
    if (gLatI >= 0 && gLonI >= 0) { const p = mapPlace(c[gLatI], c[gLonI]); if (p) [c[gLatI], c[gLonI]] = fix6(p); }
    return c.join(",");
  });
  write(`Player_Journey/${type}1.csv`, [header, ...sampled].join("\n"));
}

/* ---------- GameplayLocationHistory.tsv → a synthetic walk ----------
 * This one can't go through the atlas. The atlas maps each distinct coordinate
 * independently, which is right for stops you revisit but wrong for a GPS
 * trace: a walking route is a SEQUENCE, and scattering its points across the
 * atlas would draw the globe a cloud of confetti instead of a trail.
 * So the trail is generated rather than mapped — a random walk that starts a
 * fresh outing whenever the real log has a gap of more than an hour, which
 * keeps the timestamps (and therefore the app's day-segmenting) honest while
 * owing nothing to the real route. */
{
  const lines = readLines(path.join(SRC, "GameplayLocationHistory.tsv"));
  if (lines) {
    const header = lines[0];
    const body = strideSample(lines.slice(1).filter((l) => l.trim()), 1500);
    let prev = null, prevT = null;
    const out = body.map((line) => {
      const c = line.split("\t");
      const t = Date.parse(c[0]);
      const newOuting = !prev || !Number.isFinite(t) || !Number.isFinite(prevT) || t - prevT > 3600e3;
      // Most outings are from home; occasionally the trail picks up on a trip.
      if (newOuting) prev = within(rnd() < 0.85 ? HOME : pick(AWAY));
      else prev = nearby(prev, 0.4);   // ≤400 m between consecutive fixes
      prevT = t;
      [c[1], c[2]] = fix6(prev);
      return c.join("\t");
    });
    write("GameplayLocationHistory.tsv", [header, ...out].join("\n"));
  }
}

/* ---------- FriendList.tsv (fake codename + nickname) ---------- */
{
  const lines = readLines(path.join(SRC, "FriendList.tsv"));
  if (lines) {
    const header = lines[0].split("\t");
    const ci = header.indexOf("Friend's codename");
    const ni = header.indexOf("Nickname");
    const out = [lines[0]];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const c = lines[i].split("\t");
      if (ci >= 0) c[ci] = hideCodename(c[ci]);
      if (ni >= 0 && c[ni]) c[ni] = fakeNick();
      out.push(c.join("\t"));
    }
    write("FriendList.tsv", out.join("\n"));
  }
}

/* ---------- RecentlyUnfriended.tsv (fake name, keep date) ---------- */
{
  const lines = readLines(path.join(SRC, "RecentlyUnfriended.tsv"));
  if (lines) {
    const out = [lines[0]];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const c = lines[i].split("\t");
      c[0] = hideCodename(c[0]);
      out.push(c.join("\t"));
    }
    write("RecentlyUnfriended.tsv", out.join("\n"));
  }
}

/* ---------- RecentInviteActions.tsv (no header; fake codename in col 3) ---------- */
{
  const lines = readLines(path.join(SRC, "RecentInviteActions.tsv"));
  if (lines) {
    const out = [];
    for (const line of lines) {
      if (!line.trim()) continue;
      const c = line.split("\t");
      if (c.length >= 3) c[2] = hideCodename(c[2]);
      out.push(c.join("\t"));
    }
    write("RecentInviteActions.tsv", out.join("\n"));
  }
}

/* ---------- ActivityInvites{Received,Sent}.tsv (no PII; copy) ---------- */
for (const fn of ["ActivityInvitesReceived.tsv", "ActivityInvitesSent.tsv"]) {
  const lines = readLines(path.join(SRC, fn));
  if (lines) write(fn, lines.join("\n"));
}

/* ---------- InAppPurchases.tsv (no PII; copy verbatim) ---------- */
{
  const lines = readLines(path.join(SRC, "InAppPurchases.tsv"));
  if (lines) write("InAppPurchases.tsv", lines.join("\n"));
}

/* ---------- FitnessData.tsv (no PII; copy) ---------- */
{
  const lines = readLines(path.join(SRC, "FitnessData.tsv"));
  if (lines) write("FitnessData.tsv", lines.join("\n"));
}

/* ---------- App_Sessions.csv → slim + scrub cities, drop IP/ad-IDs ---------- */
const cityMap = {};
function fakeCityFor(real) {
  if (!real) return ["", ""];
  if (!cityMap[real]) cityMap[real] = pick(CITIES);
  return cityMap[real];
}
/* Country_code is coarser than City, but it is still real travel history, so it
 * gets the same treatment: distinct real countries map to distinct fakes. The
 * first country seen becomes US, which keeps the demo consistent with the fake
 * US cities above. Kept (rather than dropped) so the demo actually exercises
 * the login-geography chapter. */
const COUNTRY_POOL = ["US", "CA", "MX", "JP", "GB", "DE", "AU", "NZ"];
const countryMap = {};
function fakeCountryFor(real) {
  const k = (real || "").trim().toUpperCase();
  if (!k) return "";
  if (!countryMap[k]) countryMap[k] = COUNTRY_POOL[Object.keys(countryMap).length % COUNTRY_POOL.length];
  return countryMap[k];
}
for (const [src, cap] of [["App_Sessions.csv", 2500], ["App_Installs.csv", 50]]) {
  const lines = readLines(path.join(PJ_SRC, src));
  if (!lines) continue;
  const head = lines[0].split(",");
  const idx = (name) => head.indexOf(name);
  const ei = idx("Event_time"), di = idx("Device_model"), pi = idx("Platform"), cyi = idx("City"), sti = idx("State"), coi = idx("Country_code");
  const body = strideSample(lines.slice(1).filter((l) => l.trim()), cap);
  const out = ["Event_time,Device_model,Platform,City,State,Country_code"];
  for (const line of body) {
    const c = line.split(",");
    const [city, state] = fakeCityFor((c[cyi] || "").trim());
    const dev = ((c[di] || "").split("::").pop() || "").replace(/,/g, " ").trim();
    out.push([c[ei] || "", dev, (c[pi] || "").trim(), city, state, fakeCountryFor(c[coi])].join(","));
  }
  write("Player_Journey/" + src, out.join("\n"));
}

/* ---------- ImageData.txt → fake the image handles, keep the dates ----------
 * The dates ARE the story (a snapshot timeline). The IDs are opaque Niantic
 * handles to real photos, so they get replaced even though they carry no
 * personal content on their own. */
{
  const lines = readLines(path.join(SRC, "ImageData.txt"));
  if (lines && lines.length > 1) {
    const hex = () => Array.from({ length: 16 }, () => "0123456789abcdef"[Math.floor(rnd() * 16)]).join("");
    const out = [lines[0]];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const c = lines[i].split("\t");
      c[0] = hex();
      out.push(c.join("\t"));
    }
    write("ImageData.txt", out.join("\n"));
  }
}

/* ---------- SupportInteractions → date + topic only ----------
 * The raw file carries the full text of everything you wrote to Niantic
 * support, plus custom fields and metadata. The site never reads those columns,
 * and the demo must not even contain them: emit two columns and drop the rest.
 * Ticket numbers are identifiers, so they are renumbered too. */
{
  const lines = readLines(path.join(SRC, "SupportInteractions1.tsv"));
  if (lines && lines.length > 1) {
    const head = lines[0].split("\t");
    const ti = head.findIndex((h) => /date|time/i.test(h));
    const si = head.findIndex((h) => /ticket/i.test(h));
    const out = ["Date and time\tTicket number and title"];
    /* Renumber ticket numbers CONSISTENTLY: one real ticket becomes one fake
     * ticket, however many messages it has. Numbering each row sequentially
     * (as this first did) fabricated a distinct ticket per message, which made
     * the demo useless as a regression case for the very grouping the app
     * does — the parser could count rows instead of tickets and the fixture
     * would still agree with it. */
    const ticketNo = new Map();
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const c = lines[i].split("\t");
      const title = (c[si >= 0 ? si : 1] || "").replace(/^\s*Ticket\s+(\d+)\s*:/i, (_, real) => {
        if (!ticketNo.has(real)) ticketNo.set(real, 10000000 + ticketNo.size);
        return `Ticket ${ticketNo.get(real)}:`;
      });
      out.push([(c[ti >= 0 ? ti : 0] || "").trim(), title.trim()].join("\t"));
    }
    write("SupportInteractions1.tsv", out.join("\n"));
  }
}

/* ---------- LiveEvent tickets → drop email/order#/names/carrier ----------
 * The rule for this file: blank every column the app does not read.
 * parseLiveEvents() reads only Event Details, Number of Tickets on Order,
 * Total Paid, Currency Paid and Date of Order Placed — everything else is
 * dead weight that can only leak. AddOn Info was the one exception, and it
 * shipped an opaque 16-hex token glued to a product name
 * ("… T-shirt-ae84fdbcbfc00862"). Almost certainly a merchandise SKU rather
 * than anything personal, but "almost certainly" is not the standard this
 * generator holds itself to elsewhere, and nothing reads the column. */
{
  const lines = readLines(path.join(SRC, "LiveEventRegistrationHistory_AsPurchaser.tsv"));
  if (lines && lines.length > 1) {
    const head = lines[0].split("\t");
    const blank = ["Order Number", "Email Used", "In-game names on Order", "Phone Carrier", "Ticket Info", "AddOn Info"];
    const out = [lines[0]];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const c = lines[i].split("\t");
      blank.forEach((b) => { const bi = head.indexOf(b); if (bi >= 0) c[bi] = ""; });
      out.push(c.join("\t"));
    }
    write("LiveEventRegistrationHistory_AsPurchaser.tsv", out.join("\n"));
  }
}

/* ---------- wayfarer_player_data.json → keep only aggregate counts ---------- */
{
  const fp = path.join(SRC, "wayfarer_player_data.json");
  if (fs.existsSync(fp)) {
    try {
      const j = JSON.parse(fs.readFileSync(fp, "utf8"));
      const root = Array.isArray(j) ? (j[0] || {}) : j;
      const prof = (Array.isArray(root.OprProfile) ? root.OprProfile[0] : root.OprProfile) || {};
      const subs = root.OprSubmissionLog || [];
      const slim = {
        OprProfile: {
          "Total Analyzed": +prof["Total Analyzed"] || +prof["TotalAnalyzed"] || 0,
          "Portals Created": +prof["Portals Created"] || +prof["PortalsCreated"] || 0,
        },
        OprSubmissionLog: new Array(Array.isArray(subs) ? subs.length : 0).fill({}),
      };
      write("wayfarer_player_data.json", JSON.stringify(slim));
    } catch (e) { console.warn("  wayfarer parse skipped:", e.message); }
  }
}

/* ---------- leak check ----------
 * "No real personal data is present" is a claim this repo publishes, so it is
 * verified rather than assumed. Two passes over everything just written:
 * every identifier the scrub captured must be gone, and no email address or
 * IP address may appear in any output at all. A hit is fatal — the demo is
 * deleted rather than shipped, because a half-scrubbed export is worse than
 * none. Add a pattern here whenever Niantic adds a field. */
{
  const chased = [...SECRETS.entries()].filter(chaseable);
  const PATTERNS = [
    [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i, "an email address"],
    [/\b(?:\d{1,3}\.){3}\d{1,3}\b/, "an IP address"],
  ];
  /* Coordinates need their own check, and it has to be a positive test rather
   * than a pattern: a real latitude looks exactly like a fake one. Every real
   * coordinate in the source export goes into a set, and no demo file may
   * contain any of them. This is the check that was missing — a header-shaped
   * bug sent 2,575 rows of real positions straight through, and an identifier
   * sweep cannot see that. It is also what makes "no coordinate is derived
   * from a real one" a claim the generator proves on every run. */
  const realCoords = new Set();
  for (const [type] of EVENT_TYPES) {
    for (const suffix of ["1", "2"]) {
      const lines = readLines(path.join(PJ_SRC, `${type}${suffix}.csv`));
      if (!lines) continue;
      for (let i = 1; i < lines.length; i++) {
        for (const cell of lines[i].split(",")) {
          const v = cell.trim();
          if (/^-?\d{1,3}\.\d{4,}$/.test(v)) realCoords.add(v);
        }
      }
    }
  }
  for (const line of (readLines(path.join(SRC, "GameplayLocationHistory.tsv")) || []).slice(1)) {
    for (const cell of line.split("\t")) {
      const v = cell.trim();
      if (/^-?\d{1,3}\.\d{4,}$/.test(v)) realCoords.add(v);
    }
  }
  const leaks = [];
  for (const rel of written) {
    const text = fs.readFileSync(path.join(OUT, rel), "utf8");
    for (const [real] of chased) if (text.includes(real)) leaks.push(`${rel}: real identifier "${real}"`);
    for (const [re, what] of PATTERNS) { const m = text.match(re); if (m) leaks.push(`${rel}: ${what} (${m[0]})`); }
    let hits = 0, sample = "";
    for (const cell of text.split(/[,\t\n]/)) {
      const v = cell.trim();
      if (v.length > 6 && realCoords.has(v)) { hits++; if (!sample) sample = v; }
    }
    if (hits) leaks.push(`${rel}: ${hits} real coordinate value(s), e.g. ${sample}`);
  }
  if (leaks.length) {
    fs.rmSync(OUT, { recursive: true, force: true });
    console.error(`\n✗ LEAK CHECK FAILED — ${leaks.length} problem(s), demo NOT written:`);
    leaks.slice(0, 20).forEach((l) => console.error("   " + l));
    if (leaks.length > 20) console.error(`   …and ${leaks.length - 20} more`);
    process.exit(1);
  }
  console.log(`\n✓ Leak check passed — ${chased.length} identifiers redacted, 0 found in output.`);
}

/* ---------- manifest + notice ---------- */
write("manifest.json", JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  note: "Fully anonymized synthetic demo derived from a real export. No real names, locations, emails or identifiers.",
  files: written.filter((f) => f !== "manifest.json"),
}, null, 2));

write("README.md", `# Sample export (synthetic)

Generated by \`tools/scrub-demo.mjs\` from a real Niantic export, to preview the
visualizations. **No real personal data is present.**

**Coordinates are generated, not anonymized.** No location in this folder is
derived from a real one. The generator builds a synthetic world — one home city
and seven travel cities — and assigns each distinct real coordinate a place in
it by HOW OFTEN it appears, never by where it is. Frequency rank is the only
thing that crosses over, and visit counts are already on screen in the app. Two
real stops that were metres apart routinely land on different continents.

An earlier version translated every coordinate by a single offset and called
that a fake city. It was not: a rigid translation preserves every distance and
bearing exactly, so the output was one subtraction away from the real map.

Names, emails, account IDs, referral codes and support message bodies are faked
or dropped; event logs are downsampled. Numbers, dates, medals, species and
timing are preserved so the story still feels real.

The generator checks its own work: it re-reads every file it writes and refuses
to ship — deleting the output — if any redacted identifier, email address, IP
address, or **real coordinate value** survived.

Regenerate with:

    node tools/scrub-demo.mjs "<path to your unzipped export>"
`);

console.log(`\nDone. ${written.length} files → ${OUT}`);
