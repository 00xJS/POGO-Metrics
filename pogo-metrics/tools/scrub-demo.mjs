/* scrub-demo.mjs — turn a REAL Niantic Pokémon GO export into a fully
 * anonymized, downsampled demo dataset that the site can load to showcase
 * every visualization without exposing any real personal data.
 *
 * Usage:  node scrub-demo.mjs <path-to-export-dir> [out-dir]
 *   <export-dir>  a folder containing Gameplay.txt + Player_Journey/ etc.
 *   [out-dir]     defaults to ../demo (relative to this script)
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
const OUT = process.argv[3] || path.join(__dirname, "..", "demo");
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

/* ---------- coordinate scrubbing ---------- */
const DEMO_ORIGIN = [34.0522, -118.2437]; // downtown Los Angeles — generic, street-rich
function num(x) { const n = parseFloat(x); return isNaN(n) ? null : n; }

// First pass: estimate the player's home centroid from a sample of points.
function estimateCentroid() {
  let sumLa = 0, sumLo = 0, n = 0;
  for (const fn of ["Pokestop_spin1.csv", "Sfida_capture1.csv"]) {
    const fp = path.join(PJ_SRC, fn);
    if (!fs.existsSync(fp)) continue;
    const lines = fs.readFileSync(fp, "utf8").split("\n");
    const head = lines[0].split(",");
    const li = head.indexOf("Player_Latitude"), oi = head.indexOf("Player_Longitude");
    for (let i = 1; i < lines.length && n < 8000; i++) {
      const c = lines[i].split(",");
      const la = num(c[li]), lo = num(c[oi]);
      if (la && lo && Math.abs(la) < 89) { sumLa += la; sumLo += lo; n++; }
    }
  }
  return n ? [sumLa / n, sumLo / n] : [0, 0];
}
const CENTROID = estimateCentroid();
const DLAT = DEMO_ORIGIN[0] - CENTROID[0];
const DLON = DEMO_ORIGIN[1] - CENTROID[1];
const jit = () => (rnd() - 0.5) * 0.0008; // ~±45 m
/* Jitter STABLY, per distinct real coordinate — not per row.
 * Jittering every row independently scattered repeat visits to one PokéStop
 * across hundreds of fake stops, which made the "regular haunts" chapter look
 * empty on the demo: the sample's busiest stop showed 19 visits where the real
 * export has 8,876. Remembering the offset per source coordinate preserves the
 * "I go to this one stop constantly" shape that makes the chapter worth having,
 * while still moving every point to the fake city. */
const coordJitter = new Map();
function mapCoord(la, lo) {
  const a = num(la), o = num(lo);
  if (a == null || o == null || (a === 0 && o === 0)) return [la, lo];
  const key = a.toFixed(5) + "," + o.toFixed(5);
  let j = coordJitter.get(key);
  if (!j) { j = [jit(), jit()]; coordJitter.set(key, j); }
  return [(a + DLAT + j[0]).toFixed(6), (o + DLON + j[1]).toFixed(6)];
}
console.log("Home centroid ~", CENTROID.map((x) => x.toFixed(3)).join(","), "→ translated to LA demo origin");

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
  const sampled = strideSample(body, cap).map((line) => {
    const c = line.split(",");
    if (latI >= 0 && lonI >= 0) { const [a, o] = mapCoord(c[latI], c[lonI]); c[latI] = a; c[lonI] = o; }
    if (gLatI >= 0 && gLonI >= 0) { const [a, o] = mapCoord(c[gLatI], c[gLonI]); c[gLatI] = a; c[gLonI] = o; }
    return c.join(",");
  });
  write(`Player_Journey/${type}1.csv`, [header, ...sampled].join("\n"));
}

/* ---------- GameplayLocationHistory.tsv (scrub coords, downsample) ---------- */
{
  const lines = readLines(path.join(SRC, "GameplayLocationHistory.tsv"));
  if (lines) {
    const header = lines[0];
    const body = lines.slice(1).filter((l) => l.trim());
    const out = strideSample(body, 1500).map((line) => {
      const c = line.split("\t");
      const [a, o] = mapCoord(c[1], c[2]); c[1] = a; c[2] = o;
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
    let n = 10000000;
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const c = lines[i].split("\t");
      const title = (c[si >= 0 ? si : 1] || "").replace(/^\s*Ticket\s+\d+\s*:/i, `Ticket ${++n}:`);
      out.push([(c[ti >= 0 ? ti : 0] || "").trim(), title.trim()].join("\t"));
    }
    write("SupportInteractions1.tsv", out.join("\n"));
  }
}

/* ---------- LiveEvent tickets → drop email/order#/names/carrier ---------- */
{
  const lines = readLines(path.join(SRC, "LiveEventRegistrationHistory_AsPurchaser.tsv"));
  if (lines && lines.length > 1) {
    const head = lines[0].split("\t");
    const blank = ["Order Number", "Email Used", "In-game names on Order", "Phone Carrier", "Ticket Info"];
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
  const leaks = [];
  for (const rel of written) {
    const text = fs.readFileSync(path.join(OUT, rel), "utf8");
    for (const [real] of chased) if (text.includes(real)) leaks.push(`${rel}: real identifier "${real}"`);
    for (const [re, what] of PATTERNS) { const m = text.match(re); if (m) leaks.push(`${rel}: ${what} (${m[0]})`); }
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

write("README.md", `# Demo dataset (synthetic)\n\nThis folder is generated by \`tools/scrub-demo.mjs\` from a real Niantic export.\nAll coordinates are translated + jittered to a fake city, all names/emails/account\nIDs/referral codes are faked or dropped, support message bodies are removed, and\nevent logs are downsampled. It exists only to preview the visualizations.\n**No real personal data is present** — the generator verifies this by re-reading\nevery file it writes and refusing to ship if any redacted identifier, email\naddress or IP address survived.\n\nRegenerate with:\n\n    node tools/scrub-demo.mjs "<path to your unzipped export>"\n`);

console.log(`\nDone. ${written.length} files → ${OUT}`);
