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
function mapCoord(la, lo) {
  const a = num(la), o = num(lo);
  if (a == null || o == null || (a === 0 && o === 0)) return [la, lo];
  return [(a + DLAT + jit()).toFixed(6), (o + DLON + jit()).toFixed(6)];
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

/* ---------- Gameplay.txt (keep stats, fake names) ---------- */
{
  let t = fs.readFileSync(path.join(SRC, "Gameplay.txt"), "utf8");
  t = t.replace(/(Pokemon Home Trainer Name:).*/i, "$1 AshDemo");
  t = t.replace(/(Buddy nickname:).*/i, "$1 Sparky");
  write("Gameplay.txt", t);
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
      if (ci >= 0) c[ci] = fakeCodename();
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
      c[0] = fakeCodename();
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
      if (c.length >= 3) c[2] = fakeCodename();
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
for (const [src, cap] of [["App_Sessions.csv", 2500], ["App_Installs.csv", 50]]) {
  const lines = readLines(path.join(PJ_SRC, src));
  if (!lines) continue;
  const head = lines[0].split(",");
  const idx = (name) => head.indexOf(name);
  const ei = idx("Event_time"), di = idx("Device_model"), pi = idx("Platform"), cyi = idx("City"), sti = idx("State");
  const body = strideSample(lines.slice(1).filter((l) => l.trim()), cap);
  const out = ["Event_time,Device_model,Platform,City,State"];
  for (const line of body) {
    const c = line.split(",");
    const [city, state] = fakeCityFor((c[cyi] || "").trim());
    const dev = ((c[di] || "").split("::").pop() || "").replace(/,/g, " ").trim();
    out.push([c[ei] || "", dev, (c[pi] || "").trim(), city, state].join(","));
  }
  write("Player_Journey/" + src, out.join("\n"));
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

/* ---------- manifest + notice ---------- */
write("manifest.json", JSON.stringify({
  generated: new Date().toISOString().slice(0, 10),
  note: "Fully anonymized synthetic demo derived from a real export. No real names, locations, emails or identifiers.",
  files: written.filter((f) => f !== "manifest.json"),
}, null, 2));

write("README.md", `# Demo dataset (synthetic)\n\nThis folder is generated by \`tools/scrub-demo.mjs\` from a real Niantic export.\nAll coordinates are translated + jittered to a fake city, all names/emails/IDs are\nfaked or dropped, and event logs are downsampled. It exists only to preview the\nvisualizations. **No real personal data is present.**\n\nRegenerate with:\n\n    node tools/scrub-demo.mjs "<path to your unzipped export>"\n`);

console.log(`\nDone. ${written.length} files → ${OUT}`);
