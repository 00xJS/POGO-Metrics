/* scrub-demo.mjs — turn a REAL Pokémon GO export into a fully anonymized,
 * downsampled demo dataset that the site can load to showcase every
 * visualization without exposing any identifying personal data.
 *
 * Usage:  node scrub-demo.mjs <path-to-export-dir> [out-dir] [--also <older-export-dir>]...
 *   <export-dir>  a folder containing Gameplay.txt, plus the journey logs either
 *                 unzipped (Player_Journey/) or the way the Scopely-era export
 *                 ships them (Player_Journey.zip — read in memory, never
 *                 extracted to disk)
 *   [out-dir]     defaults to ../sample-export (relative to this script)
 *   --also        an older export of the same account. Every real value and
 *                 place in it is chased too; nothing is written from it.
 *
 * What it scrubs:
 *   • No coordinate is derived from a real one: a synthetic world is built and
 *     each real place is given a spot in it by how often it appears, nothing else.
 *     None is written within 120 m of a real place (NEAR_M), measured.
 *   • Trainer name, buddy name, every friend / unfriended / invite / referral /
 *     gift-sender codename and friend nickname → fake.
 *   • The custom labels you typed on your Pokémon → removed (species kept).
 *   • Emails, order numbers, IPs, ad-IDs, postal codes, phone carrier → dropped.
 *   • Cities in session data → remapped to fake cities; live-event ticket names
 *     → synthetic text; a real city inside an event badge's key → a
 *     Pokémon-world town.
 *   • Every in-person event medal → a neutral key (BADGE_EVENT_IN_PERSON_n)
 *     that keeps its count and names no event, place, year, day or session.
 *   • Live-event add-ons → a yes or no (one fixed word), never the add-on.
 *   • Wayfarer → counts, dates and the star ratings given; the session logs keep
 *     install times, app / OS versions, platform, and device model and category;
 *     support tickets keep their date and topic under a new ticket number.
 *   • Event logs are downsampled (uniform stride) to keep the demo light.
 *   • Account counters — start date, total XP, PokéCoins, Stardust, distance
 *     walked, eggs hatched, the bag's quantities and total, badge progress,
 *     egg progress → perturbed: a believable figure, never the real one, and
 *     every medal in its tier. A trainer profile shows several of them to
 *     every friend, so copied exactly they would recognise the account.
 * Level, medal tiers, spend amounts, species, and the journey's dates and
 * timing are preserved so the story still feels real.
 *
 * It fails closed. Every real value it can find is registered BEFORE a single
 * file is written, and the last thing it does is sweep every output file for
 * all of them and for a set of identifier patterns. The output is built in a
 * temporary folder and swapped into place only when that sweep is clean, so a
 * failed run leaves the previous sample exactly as it was. */
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";
import { campfireSample } from "./campfire-sample.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ARGS = process.argv.slice(2), POS = [], ALSO = [];
for (let i = 0; i < ARGS.length; i++) {
  if (ARGS[i] === "--also") ALSO.push(ARGS[++i]);
  else if (ARGS[i].startsWith("--also=")) ALSO.push(ARGS[i].slice("--also=".length));
  else POS.push(ARGS[i]);
}
const SRC = POS[0];
// sample-export/, not demo/ — a data folder must never share its name with a
// page, or Netlify's extensionless URLs put both at the same path (see netlify.toml).
const OUT = path.resolve(POS[1] || path.join(__dirname, "..", "sample-export"));
const isExport = (dir) => !!dir && fs.existsSync(path.join(dir, "Gameplay.txt"));
if (!isExport(SRC) || !ALSO.every(isExport) || POS.length > 2) {
  console.error("Usage: node scrub-demo.mjs <export-dir-with-Gameplay.txt> [out-dir] [--also <older-export-dir>]...");
  process.exit(1);
}
/* The rival trainer's stats file is fictional and nothing here can rebuild it,
 * so it is carried over: from the folder being replaced, or else from the
 * sample committed beside this script. With neither, stop now rather than
 * publish a sample that has quietly lost its You-vs-friend chapter. */
const RIVAL = "pogo-metrics-stats-rival.json";
const RIVAL_FROM = [OUT, path.join(__dirname, "..", "sample-export")].map((dir) => path.join(dir, RIVAL)).find((p) => fs.existsSync(p));
if (!RIVAL_FROM) {
  console.error(`✗ ${RIVAL} is in neither ${OUT} nor the committed sample, and nothing can regenerate it. Restore it from git, then run this again.`);
  process.exit(1);
}
const RIVAL_TEXT = fs.readFileSync(RIVAL_FROM, "utf8");
/* Built beside OUT (same disk, so the final swap is a rename) and moved into
 * place only once the leak check passes. Any other exit — a failed check, a
 * throw halfway through — deletes it and leaves OUT alone. */
const TMP = `${OUT}.tmp-${process.pid}`;
let SWAPPED = false;
process.on("exit", () => { if (!SWAPPED) fs.rmSync(TMP, { recursive: true, force: true }); });
/* A signal ends the process without an "exit" event, which used to strand the
 * unchecked TMP inside the publish folder. So the usual ones become ordinary
 * exits. The work is synchronous, so a handler only gets to run at the
 * checkpoints between phases, and the last of those sits just before the swap:
 * an interrupted run never publishes. SIGKILL can't be caught at all, which is
 * what the .gitignore rules for sample-export.tmp-* / .old-* are for. */
for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) process.on(sig, () => {
  console.error(`\n✗ ${sig}: stopped before publishing. The previous sample is untouched.`);
  process.exit(128 + os.constants.signals[sig]);
});
const checkpoint = () => new Promise((resolve) => setImmediate(resolve));
fs.rmSync(TMP, { recursive: true, force: true });
fs.mkdirSync(path.join(TMP, "Player_Journey"), { recursive: true });

/* ---------- Player_Journey: the folder, or the zip the export ships ----------
 * Niantic-era exports were usually unzipped whole. The Scopely-era download
 * keeps the journey logs in Player_Journey.zip, and reading only the folder
 * silently dropped every one of them. The zip is opened here: the central
 * directory is parsed (it, not the local headers, carries the sizes when the
 * archive streams its data descriptors, as this one does), each entry is
 * inflated with zlib and checked against its declared size and CRC. */
function crc32(buf) {
  if (zlib.crc32) return zlib.crc32(buf);
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) { c ^= buf[i]; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; }
  return (c ^ 0xffffffff) >>> 0;
}
function openZip(fp) {
  const buf = fs.readFileSync(fp);
  const tag = path.basename(fp);
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 22 - 0xffff); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error(`${tag}: not a zip archive`);
  const count = buf.readUInt16LE(eocd + 10), cdOff = buf.readUInt32LE(eocd + 16);
  if (count === 0xffff || cdOff === 0xffffffff) throw new Error(`${tag}: ZIP64 archives are not supported`);
  const entries = new Map();
  for (let p = cdOff, n = 0; n < count; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) throw new Error(`${tag}: corrupt central directory`);
    const flags = buf.readUInt16LE(p + 8), method = buf.readUInt16LE(p + 10);
    const crc = buf.readUInt32LE(p + 16), csize = buf.readUInt32LE(p + 20), usize = buf.readUInt32LE(p + 24);
    const nlen = buf.readUInt16LE(p + 28), xlen = buf.readUInt16LE(p + 30), klen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = path.posix.basename(buf.toString(flags & 0x800 ? "utf8" : "latin1", p + 46, p + 46 + nlen));
    const dir = buf[p + 46 + nlen - 1] === 0x2f;
    p += 46 + nlen + xlen + klen;
    if (dir) continue;
    // Refuse rather than guess: an encrypted entry can't be read without a
    // password, and a real export has never shipped one.
    if (flags & 0x1) throw new Error(`${tag}: ${name} is encrypted — refusing to read it`);
    if (method !== 0 && method !== 8) throw new Error(`${tag}: ${name} uses compression method ${method}`);
    if (usize > 512 * 1024 * 1024) throw new Error(`${tag}: ${name} claims ${usize} bytes — refusing`);
    entries.set(name, { method, crc, csize, usize, local });
  }
  console.log(`  reading ${tag} in memory (${entries.size} entries)`);
  return (name) => {
    const e = entries.get(name);
    if (!e) return null;
    if (buf.readUInt32LE(e.local) !== 0x04034b50) throw new Error(`${tag}: corrupt local header for ${name}`);
    const start = e.local + 30 + buf.readUInt16LE(e.local + 26) + buf.readUInt16LE(e.local + 28);
    const raw = buf.subarray(start, start + e.csize);
    const data = e.method === 0 ? raw : zlib.inflateRawSync(raw, { maxOutputLength: Math.max(1, e.usize) });
    if (data.length !== e.usize || crc32(data) !== e.crc) throw new Error(`${tag}: ${name} failed its size/CRC check`);
    return data.toString("utf8");
  };
}
/* One reader per export: the folder when it is there, the zip otherwise. */
function pjReader(root) {
  const dir = path.join(root, "Player_Journey"), zip = path.join(root, "Player_Journey.zip");
  const fromZip = !fs.existsSync(dir) && fs.existsSync(zip) ? openZip(zip) : null;
  const cache = new Map();
  return (name) => {
    if (!cache.has(name)) {
      const fp = path.join(dir, name);
      const t = fromZip ? fromZip(name) : fs.existsSync(fp) ? fs.readFileSync(fp, "utf8") : null;
      cache.set(name, t == null ? null : t.replace(/\r/g, "").split("\n"));
    }
    return cache.get(name);
  };
}
const readPJLines = pjReader(SRC);

/* ---------- helpers ---------- */
const readText = (fp) => (fs.existsSync(fp) ? fs.readFileSync(fp, "utf8") : null);
const readLines = (fp) => { const t = readText(fp); return t == null ? null : t.replace(/\r/g, "").split("\n"); };
/* A CSV line split that respects quotes. The session logs have never quoted a
 * field, but a quoted comma would shift every column after it — and a shifted
 * column here means registering (and then hunting for) the wrong values. */
function splitCSV(line) {
  if (!line.includes('"')) return line.split(",");
  const out = []; let cur = "", q = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (q) { if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += ch; }
    else if (ch === '"') q = true;
    else if (ch === ",") { out.push(cur); cur = ""; }
    else cur += ch;
  }
  out.push(cur);
  return out;
}
/* Tab-separated rows the way a spreadsheet reads them: a field that opens with
 * a quote runs to its closing quote, tabs and newlines included. */
function tsvRecords(text) {
  const rows = []; let row = [""], q = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (q) { if (ch === '"') { if (text[i + 1] === '"') { row[row.length - 1] += '"'; i++; } else q = false; } else row[row.length - 1] += ch; }
    else if (ch === '"' && row[row.length - 1] === "") q = true;
    else if (ch === "\t") row.push("");
    else if (ch === "\n") { rows.push(row); row = [""]; }
    else if (ch !== "\r") row[row.length - 1] += ch;
  }
  if (row.length > 1 || row[0]) rows.push(row);
  return rows;
}
const written = [];
function write(rel, content) { fs.writeFileSync(path.join(TMP, rel), content); written.push(rel); console.log("  wrote", rel); }
function strideSample(rows, cap) {
  if (rows.length <= cap) return rows;
  const step = Math.ceil(rows.length / cap);
  return rows.filter((_, i) => i % step === 0);
}

/* ---------- seeded RNG (reproducible) ---------- */
let seed = 1337;
const rnd = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
const pick = (a) => a[Math.floor(rnd() * a.length)];

/* ---------- the redaction ledger ----------
 * Every real value this script can find is registered here BEFORE anything is
 * written, and the last thing it does is sweep every output file for all of
 * them. Rewriting the one line a value is declared on is not enough, and this
 * file's history proves it: Gameplay.txt quotes the buddy's nickname again in
 * the VS Seeker log; the live-event ticket named a real city that the session
 * scrub relocated everywhere else; a collection label was the phone carrier
 * the ticket scrub blanked in its own column; and the August log names ten
 * friends who sent gifts, in a file written before the friend list was read.
 * Register everything first, then write, then verify.
 *
 * Each value is chased the way it could plausibly surface:
 *   text    a raw substring — identifiers: codenames, account and device IDs,
 *           emails, IPs, order numbers, whole free-text fields
 *   word    a whole word — place names, a carrier, the labels and nicknames you
 *           typed: "Bell" the city must be caught, "Bellsprout" must not be
 *   key     a place the way the game spells it inside its own identifiers —
 *           upper case, words joined by "_", and "_" counts as a boundary:
 *           PALLET in BADGE_…_PALLET_DAY_1 must be caught, PALLETS must not be
 *   number  a whole number — a postal code standing alone, never the same five
 *           digits inside a coordinate, a timestamp or a hex ID
 *   decimal a whole decimal — a distance walked, never the same digits inside
 *           a longer number or a coordinate */
const REAL = new Map();   // real value → { kind, mode }
const FAKE = new Map();   // real value → the fake that replaces it, for values that are replaced
// Ordered by how much each mode catches: in an upper-case value, "key" finds
// everything "word" does, and more.
const STRENGTH = { number: 0, decimal: 0, word: 1, key: 2, text: 3 };
let MATCHER = null;
/* Places are chased in the game's own spelling as well. The event badges carry
 * their host city in the key (BADGE_…_<CITY>_…), where "_" is a word character
 * to every whole-word match, so a ticket's city walked straight past the check.
 * A multi-word place is kept both ways: PALLET_TOWN and PALLETTOWN. */
const KEYED = new Set(["session city", "session state", "live-event place word"]);
function keyForms(s) {
  const a = s.normalize("NFKD").replace(/\p{M}/gu, "");
  return [...new Set([a.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, ""), a.replace(/[^A-Za-z0-9]+/g, "")]
    .map((k) => k.toUpperCase()).filter(Boolean))];
}
function register(real, kind, mode = "text") {
  const s = String(real == null ? "" : real).trim();
  if (!s) return "";
  // Short all-digit values can only be told apart from real numbers by their
  // edges; as raw substrings they would hit every coordinate in the file.
  const m = /^\d{1,7}$/.test(s) ? "number" : mode;
  const had = REAL.get(s);
  if (!had) { REAL.set(s, { kind, mode: m }); MATCHER = null; }
  else if (STRENGTH[m] > STRENGTH[had.mode]) { had.mode = m; MATCHER = null; }
  if (m === "word" && KEYED.has(kind)) for (const k of keyForms(s)) register(k, kind, "key");
  return s;
}
/* Free text is chased in pieces as well as whole, but only pieces that hold a
 * letter: a lone "2024" out of a ticket's date line identifies no one, and as a
 * number it would match every date in the sample. */
const registerFree = (v, kind) => (/\p{L}/u.test(String(v == null ? "" : v)) ? register(v, kind) : "");
/* Below 3 characters a "secret" is more likely to collide with ordinary text
 * (a species name, an item code) than to be an identifier worth chasing. */
const chaseable = ([real]) => real.length >= 3;
const WORDCH = "\\p{L}\\p{N}_";
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const isWordCh = (c) => /[\p{L}\p{N}_]/u.test(c);
/* One scanner for the ledger, used both to vet every fake before it is used and
 * for the final sweep, so the two can never disagree. It returns the REAL
 * values it found; every caller reports only their kind, never the value. */
function matcher() {
  if (MATCHER) return MATCHER;
  const live = [...REAL.entries()].filter(chaseable);
  const of = (mode) => live.filter(([, v]) => v.mode === mode).map(([r]) => r).sort((a, b) => b.length - a.length);
  const text = of("text"), nums = new Set(of("number")), decs = new Set(of("decimal")), keys = of("key");
  /* A whole-word value that is a single token is found by splitting the text
   * into tokens and looking each one up; only values with spaces or symbols in
   * them need a regular expression. */
  const words = of("word");
  const oneTok = new Set(words.filter((w) => /^[\p{L}\p{N}_]+$/u.test(w)));
  const multi = words.filter((w) => !oneTok.has(w));
  const bounded = (r) => (isWordCh(r[0]) ? `(?<![${WORDCH}])` : "") + escRe(r) + (isWordCh(r[r.length - 1]) ? `(?![${WORDCH}])` : "");
  let multiRe = null;
  // A bad pattern's error message quotes the pattern, and this one is made of real values.
  try { multiRe = multi.length ? new RegExp(multi.map(bounded).join("|"), "gu") : null; }
  catch { throw new Error("could not build the whole-word matcher (pattern withheld: it is made of real values)"); }
  // Key forms hold nothing but A-Z, 0-9 and "_", so this one can't fail to build.
  const keyRe = keys.length ? new RegExp(`(?<![A-Za-z0-9])(?:${keys.map(escRe).join("|")})(?![A-Za-z0-9])`, "g") : null;
  MATCHER = (s) => {
    const hits = [];
    if (keyRe) for (const m of s.matchAll(keyRe)) hits.push(m[0]);
    for (const r of text) for (let i = s.indexOf(r); i >= 0; i = s.indexOf(r, i + r.length)) hits.push(r);
    if (oneTok.size) for (const t of s.split(/[^\p{L}\p{N}_]+/u)) if (oneTok.has(t)) hits.push(t);
    if (multiRe) for (const m of s.matchAll(multiRe)) hits.push(m[0]);
    if (nums.size) for (const m of s.matchAll(/(?<![\p{L}\p{N}_.])\d+(?![\p{L}\p{N}_]|\.\d)/gu)) if (nums.has(m[0])) hits.push(m[0]);
    if (decs.size) for (const m of s.matchAll(/(?<![\p{L}\p{N}_.])\d+\.\d+(?![\p{L}\p{N}_]|\.\d)/gu)) if (decs.has(m[0])) hits.push(m[0]);
    return hits;
  };
  return MATCHER;
}
const isClean = (s) => matcher()(s).length === 0;
const kindOf = (real) => (REAL.get(real) || {}).kind || "real value";

/* ---------- fake name pools ----------
 * Every fake is vetted against the ledger before it is used, and a pool word
 * that collides with a real value is withheld outright — the vocabulary gives
 * way, never the leak check. */
const ADJ0 = ["Swift", "Brave", "Mighty", "Lucky", "Cosmic", "Solar", "Shadow", "Crystal", "Turbo", "Electric", "Mystic", "Golden", "Crimson", "Frost", "Thunder", "Ember", "Lunar", "Radiant", "Iron", "Wild"];
const NOUN0 = ["Charizard", "Trainer", "Pikachu", "Raptor", "Falcon", "Voyager", "Ranger", "Hunter", "Comet", "Phoenix", "Tracker", "Maverick", "Nomad", "Pioneer", "Scout", "Dragon", "Striker", "Wanderer", "Sage", "Ace"];
const FIRST0 = ["Alex", "Sam", "Jordan", "Casey", "Riley", "Taylor", "Morgan", "Jamie", "Avery", "Quinn", "Robin", "Drew", "Skyler", "Reese", "Charlie", "Frankie", "Sage", "River", "Dakota", "Emerson"];
/* Session places are Pokémon-world towns: plainly fictional to anyone reading
 * the demo, and never a word from a real session log. An invented name that
 * sounds like a real town usually is one somewhere. */
const CITIES0 = [["Pallet Town", "Kanto"], ["Viridian City", "Kanto"], ["Cerulean City", "Kanto"], ["Celadon City", "Kanto"],
  ["New Bark Town", "Johto"], ["Goldenrod City", "Johto"], ["Ecruteak City", "Johto"], ["Olivine City", "Johto"]];
let ADJ, NOUN, FIRST, CITIES;
const USED = new Set();
function vetted(make, kind) {
  for (let i = 0; i < 5000; i++) {
    const f = make();
    if (!USED.has(f) && isClean(f)) { USED.add(f); return f; }
  }
  throw new Error(`no clean fake left for a ${kind} — the fixed fake collides with a real value; change it`);
}
function hide(real, kind, makeFake) {
  const s = register(real, kind);
  if (!s) return "";
  if (!FAKE.has(s)) FAKE.set(s, vetted(() => makeFake(s), kind));
  return FAKE.get(s);
}
const fakeCodename = () => pick(ADJ) + pick(NOUN) + Math.floor(rnd() * 900 + 100);
const hideCodename = (real, kind = "trainer codename") => hide(real, kind, fakeCodename) || vetted(fakeCodename, kind);
const fakeNick = () => pick(FIRST);   // repeats are fine — FIRST is already vetted word by word
const ID_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
const fakeId = (len) => Array.from({ length: Math.max(6, len) }, () => ID_CHARS[Math.floor(rnd() * ID_CHARS.length)]).join("");
/* A real place inside an identifier ("key" above) becomes one of these, one
 * town per place, handed out in order rather than drawn from rnd() so nothing
 * written after Gameplay.txt shifts. */
const KEY_TOWNS = ["SAFFRON", "FUCHSIA", "CINNABAR", "LAVENDER", "VERMILION", "PEWTER", "CELADON", "VIRIDIAN", "CERULEAN", "PALLET"];
let keyTownAt = 0;
const nextKeyTown = () => KEY_TOWNS[keyTownAt++ % KEY_TOWNS.length];

/* ═══════════ phase 1: find every real value, before writing anything ═══════════ */
const EVENT_TYPES = [
  ["Pokestop_spin", 2600], ["Sfida_capture", 2600], ["Map_Pokemon_encounter", 1600],
  ["Join_Raid_lobby", 3000], ["Gym_battle", 1000], ["Feed_Pokemon", 1400],
  ["Deploy_Pokemon", 1200], ["Incense_encounter", 800], ["Lure_encounter", 800],
];

/* Gameplay.txt is mostly numbers, but it also carries two account IDs that tie
 * the export to a real Nintendo / Pokémon HOME account, your referral code, the
 * codenames of every trainer you referred and — since August — of every friend
 * who sent you a gift, plus the labels you typed on your Pokémon. */
const GP_IDS = [   // declared once, replaced wherever they recur in the file
  [/^Pokemon Home Trainer Name:\s*(.*)$/i, "trainer name", () => "AshDemo"],
  [/^Buddy nickname:\s*(.*)$/i, "buddy nickname", () => "Pebble"],
  [/^Nintendo Account ID:\s*(.*)$/i, "Nintendo account ID", (v) => fakeId(v.length)],
  [/^Pokemon Home Support ID:\s*(.*)$/i, "Pokémon HOME ID", (v) => fakeId(v.length)],
  [/^Referral code:\s*(.*)$/i, "referral code", (v) => fakeId(v.length)],
];
/* The collection list: one Pokémon per line, and a custom label you typed on
 * it, in parentheses, after a tab. "Nidoran (female)" is different — that is
 * the species' own name, which pokedex.js matches — so a bracket after a space
 * is kept when it holds a gender and treated as a label otherwise. */
const GENDER = /^(♀|♂|female|male|f|m)$/i;
const TAB_LABEL = /\t\((.*)\)\s*$/;
const SPACE_LABEL = /^(\s+[^\t]*?\S) \(([^()\t]*)\)\s*$/;
function blockAfter(lines, headRe, bodyRe) {
  const h = lines.findIndex((l) => headRe.test(l));
  if (h < 0) return [0, 0];
  let e = h + 1;
  while (e < lines.length && bodyRe.test(lines[e])) e++;
  return [h + 1, e];
}
/* A label that is itself a species' name ("Pikachu" on a Raichu) is public
 * vocabulary — the same word sits on hundreds of lines of any collection — so
 * it is removed like every other label but not chased. The species listed by
 * name are exactly the ones pokedex.js knows, so it decides. */
const dex = { window: {} };
vm.runInNewContext(fs.readFileSync(path.join(__dirname, "..", "js", "pokedex.js"), "utf8"), dex);
const isSpeciesName = (s) => /^[A-Za-z][A-Za-z .'-]*$/.test(s) && !!dex.window.dexFromName(s);
/* The rolling log: "Received 3 items from <friend>." is a gift, and the name is
 * a real trainer's codename. Stops and gyms are the only senders that aren't. */
const GIFT = /^Received (\d+) (items?) from (.+?)(\.?)$/i;
const NOT_A_TRAINER = /^(PokeStop|Gym)$/i;
/* In-person event medals. Gameplay.txt keys an event badge by the event it came
 * from, and an in-person one spells out far more than a city:
 * BADGE_GO_TOUR_<year>_<CITY>_SATURDAY_CITY is a year, a host city, a day and a
 * ticketed session — with a public calendar, one park on one afternoon. So each
 * becomes a neutral key that keeps its count and says nothing else,
 * BADGE_EVENT_IN_PERSON_1, _2, … in file order. The app files those with the
 * other event badges (its own EVENT_BADGE test, read from app.js here so the two
 * can't drift), so every medal total is unchanged.
 * "In-person" is decided by denial: an event key is kept only when every word
 * in it is one that global and online-ticketed events use — GLOBAL, SECRET,
 * DELUXE, a version name, a number. Anything else — a place, a weekday, PARK,
 * CITY, NIGHT, ADD_ON — marks it in-person. */
const EVENT_BADGE = (() => {
  const m = /^const EVENT_BADGE = \/(.+)\/([a-z]*);$/m.exec(fs.readFileSync(path.join(__dirname, "..", "js", "app.js"), "utf8"));
  if (!m) throw new Error("could not read EVENT_BADGE from js/app.js — the in-person medal scrub needs it");
  return new RegExp(m[1], m[2]);
})();
const ONLINE_EVENT_WORDS = new Set(("EVENT GO GOFEST GOTOUR TOUR GOWA GLOBAL SECRET SPECIAL RESEARCH PASS DELUXE " +
  "VERSION RUBY SAPPHIRE DIAMOND PEARL BLACK WHITE X Y A B SMORES MINI COLLECTION").split(" "));
const isInPersonBadge = (key) => EVENT_BADGE.test(key)
  && key.replace(/^BADGE_/, "").split("_").some((w) => !/^\d+$/.test(w) && !ONLINE_EVENT_WORDS.has(w));
const BADGE_LINE = /^([ \t]*)(BADGE_\w+)(: \d+[ \t]*)$/;

/* Live-event tickets: the event name is free text, and it names a real place. */
const LIVE_BLANK = ["Order Number", "Email Used", "In-game names on Order", "Phone Carrier", "Ticket Info", "AddOn Info"];
/* One blanked column survives as a yes or no. The app shows add-on orders on a
 * line of their own — whether an order had one, never what it was — so a filled
 * AddOn Info becomes this fixed word and an empty one stays empty. The leak
 * check allows exactly this word in that column, and nothing else. */
const LIVE_MARK = { "AddOn Info": "add-on" };
/* Generic ticket words are not chased on their own (the whole name still is):
 * a word like "Pokémon" or "Saturday" identifies no one, and appears in data
 * that has nothing to do with the ticket. Everything else in the name — the
 * city above all — is. */
const EVENT_GENERIC = new Set(("pokémon pokemon go fest tour safari zone city wild area global event events live ticket tickets " +
  "pass weekend day days session sessions admission general add addon add-on the and for with from at in on of to " +
  "am pm local time slot morning afternoon evening night one two three first second " +
  "monday tuesday wednesday thursday friday saturday sunday mon tue tues wed thu thur thurs fri sat sun " +
  "january february march april may june july august september october november december " +
  "jan feb mar apr jun jul aug sep sept oct nov dec " +
  "utc gmt bst cet cest eet eest wet west pst pdt mst mdt cst cdt est edt akst akdt hst jst kst aest aedt acst awst nzst nzdt sgt hkt ist").split(" "));
const realEventWords = new Set();

/* The account files are never written to the sample, but the values in them
 * could surface in one that is, so they are chased all the same. */
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;

/* Support tickets: only the date and the ticket's subject are kept, but
 * everything you wrote is chased in case it surfaces anywhere else — whole, and
 * line by line for lines long enough to tell apart from ordinary text. Some
 * messages are nothing but the ticket's subject (the category path the support
 * form fills in, "… → …"), which the sample keeps on purpose, so text that
 * already sits inside a kept subject is not chased. */
const subjectOf = (title) => String(title || "").replace(/^\s*Ticket\s+\d+\s*:\s*/i, "").trim();

/* The session and attribution logs: where you were when you opened the game,
 * and every network and device identifier that went with it. */
const SESSION_COLS = {
  City: ["session city", "word"], State: ["session state", "word"], State_Province: ["session state", "word"],
  Postal_code: ["postal code", "number"], Postal_Code: ["postal code", "number"],
  IP: ["IP address"], Device_IP_Address: ["IP address"], Operator: ["mobile operator", "word"],
};
for (const id of ["Ad_ID", "Advertising_ID", "IDFA", "IDFV", "Android_ID", "OAID", "Amazon_Fire_ID", "Application_Device_ID",
  "Apple_Advertiser_ID", "Google_Play_Store_Advertising_ID", "Windows_Phone_Device_ID"]) SESSION_COLS[id] = ["device or ad ID"];

/* Coordinates need their own check, and it has to be a positive test rather
 * than a pattern: a real latitude looks exactly like a fake one. Every real
 * coordinate in the source goes into a set, and no demo file may contain any
 * of them. This is the check that was missing when a header-shaped bug sent
 * 2,575 rows of real positions straight through — an identifier sweep cannot
 * see that. It is also what makes "no coordinate is derived from a real one"
 * a claim the generator proves on every run. */
const realCoords = new Set();
const takeCoords = (cells) => { for (const cell of cells) { const v = String(cell).trim(); if (/^-?\d{1,3}\.\d{4,}$/.test(v)) realCoords.add(v); } };
/* ...and every real place at ~100 m — three decimals, the precision the app
 * itself bins the map to. No synthetic point may land in the same cell as a
 * real one, even by chance. A chance landing would reveal nothing (the world
 * is drawn without looking), but "no sample coordinate sits where the owner
 * has been" is the stronger claim, and this makes the generator prove it. That
 * takes EVERY real place the export holds, not just the journey logs: a
 * Campfire map link once put a synthetic trail point in a real cell. */
const REAL_CELLS = new Set();
const cellOf = (la, lo) => `${(+la).toFixed(3)},${(+lo).toFixed(3)}`;
/* A cell is not a distance, though. Two points either side of a cell's edge can
 * be a metre apart, and the sample once held 21 points 50-100 m from a real
 * place without sharing a single cell. So each real place is kept as well,
 * filed by cell, and no synthetic point may come within NEAR_M of one,
 * measured. That is what "nothing within about 100 m" needs, with room to spare. */
const NEAR_M = 120;
const REAL_PTS = new Map(), REAL_SEEN = new Set();   // "floor(lat·1000),floor(lng·1000)" → [[lat, lng]…]
function realPlace(la, lo) {
  const a = num(la), o = num(lo);
  if (a == null || o == null || !(a || o) || Math.abs(a) > 90 || Math.abs(o) > 180) return;
  REAL_CELLS.add(cellOf(a, o));
  if (REAL_SEEN.has(a + "," + o)) return;
  REAL_SEEN.add(a + "," + o);
  const k = Math.floor(a * 1000) + "," + Math.floor(o * 1000);
  if (REAL_PTS.has(k)) REAL_PTS.get(k).push([a, o]); else REAL_PTS.set(k, [[a, o]]);
}
/* The nearest real place less than NEAR_M from a point, as { d, at }, or null.
 * Equirectangular metres, which are exact enough at this range. */
const M_PER_DEG = 111320, RAD = Math.PI / 180;
function nearestReal(la, lo) {
  const a = +la, o = +lo;
  if (!Number.isFinite(a) || !Number.isFinite(o) || Math.abs(a) > 90) return null;
  const di = Math.ceil(NEAR_M / M_PER_DEG / 0.001);
  const dj = Math.min(Math.ceil(NEAR_M / (M_PER_DEG * Math.max(Math.cos(a * RAD), 0.01)) / 0.001), 60);
  const ca = Math.floor(a * 1000), co = Math.floor(o * 1000);
  let best = null;
  for (let i = -di; i <= di; i++) for (let j = -dj; j <= dj; j++) {
    const pts = REAL_PTS.get((ca + i) + "," + (co + j));
    if (pts) for (const at of pts) {
      const d = Math.hypot((o - at[1]) * M_PER_DEG * Math.cos(((a + at[0]) / 2) * RAD), (a - at[0]) * M_PER_DEG);
      if (d < NEAR_M && (!best || d < best.d)) best = { d, at };
    }
  }
  return best;
}
/* A "lat,lng" pair in free text needs three decimals or more on both sides, so
 * a pair of prices in a message can't pose as a place. A map link's is plain. */
const TEXT_PAIR = /(-?\d{1,3}\.\d{3,})\s*,\s*(-?\d{1,3}\.\d{3,})/g;
const LINK_PAIR = /[?&]lat=(-?\d{1,3}\.\d+)&lng=(-?\d{1,3}\.\d+)/g;

/* Account counters. Gameplay.txt's profile header copies the trainer card:
 * start date, level, total XP, PokéCoins, Stardust and distance walked. Further
 * down come the eggs hatched, each incubating egg's progress, the bag's
 * quantities and their total, and the progress count a few badges keep instead
 * of a tier. A trainer profile shows the start date, XP and distance to every
 * friend, and together the set is as good as a name — yet this file copied
 * them all verbatim until a review caught it. So phase 2 perturbs every one
 * (perturbCounters), and here each real figure long enough to tell apart from
 * an ordinary number is registered, so the leak check fails if one survives.
 * Level and medal tiers stay: they are coarse, shared by every trainer there.
 * A "Key: number" line with no rule here stops the run rather than slip
 * through untouched — the export has grown a counter, and it needs one. */
const COUNTER_LINES = [
  [/^(Start date:[ \t]*)(\d{1,2}\/\d{1,2}\/\d{4})([ \t]*)$/, "start date"],
  [/^(Total XP:[ \t]*)(\d+)([ \t]*)$/, "total XP"],
  [/^(Pokecoin:[ \t]*)(\d+)([ \t]*)$/, "PokéCoins"],
  [/^(Stardust:[ \t]*)(\d+)([ \t]*)$/, "Stardust"],
  [/^(Distance walked:[ \t]*)(\d+(?:\.\d+)?)( km[ \t]*)$/, "distance walked"],
  [/^(You have hatched )(\d+)( and currently have \d+ eggs?:[ \t]*)$/, "eggs hatched"],
  [/^(\tEgg \d+: in incubator - )(\d+(?:\.\d+)?)( \/ \d+(?:\.\d+)? km[ \t]*)$/, "egg progress"],
  [/^([ \t]*BADGE_\w+: )(\d+)([ \t]*)$/, "badge progress"],        // 1–4 is a tier; more is a count
  [/^([ \t]*Badge: .+: )(\d+)([ \t]*)$/, "badge progress"],
];
// Kept on purpose: the level is coarse, and these two count lines the file lists.
const COUNTER_KEPT = /^(Level:[ \t]*\d+|You have \d+ medals:|You have \d+ incubators? not in use)[ \t]*$/;
const BAG_HEAD = /^(You have )(\d+)( items:[ \t]*)$/, BAG_ITEM = /^(\t.+?:[ \t]*)(\d+)([ \t]*)$/;
function accountCounters(lines) {
  const found = [], bag = { head: -1, items: [] }, inBag = new Set();
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i];
    const rule = COUNTER_LINES.find(([re]) => re.test(l));
    if (rule) { const m = l.match(rule[0]); found.push({ i, kind: rule[1], pre: m[1], v: m[2], post: m[3] }); continue; }
    const b = l.match(BAG_HEAD);
    if (b) {
      Object.assign(bag, { head: i, pre: b[1], v: b[2], post: b[3] });
      // the block runs to the first line that is neither blank nor an item: parseBag's rule
      for (let k = i + 1; k < lines.length; k++) {
        if (!lines[k].trim()) continue;
        if (!/^\t[^\t]/.test(lines[k])) break;
        const q = lines[k].match(BAG_ITEM);
        if (q) { bag.items.push({ i: k, pre: q[1], v: q[2], post: q[3] }); inBag.add(k); }
      }
      continue;
    }
    if (COUNTER_KEPT.test(l) || GP_IDS.some(([re]) => re.test(l))) continue;
    // a figure after a label — at the top level, or indented anywhere but the bag — with no rule above
    if (/^[A-Z][^\t:]*:[ \t]*\d/.test(l) || /^You have \d/.test(l) || (/^\t[^\t]+?:[ \t]*\d+[ \t]*$/.test(l) && !inBag.has(i)))
      throw new Error(`Gameplay.txt line ${i + 1} holds a counter this scrub has no rule for — add one to COUNTER_LINES`);
  }
  return { found, bag };
}
/* Shorter figures are too common to chase — a CP, a year, a clutch of eggs —
 * and only a long exact figure recognises anyone. */
const COUNTER_DIGITS = 5;
const sigDigits = (s) => String(s).replace(/\D/g, "").replace(/^0+/, "").length;
/* ...and every export's real figure for each counter line, whatever its length,
 * which no perturbed figure may land on. The leak check can't hold short ones —
 * a four-digit bag count is also a CP, a coin bundle, a timeout — but a line
 * can still refuse to show its own real figure from another export. */
const REAL_COUNT = new Map();   // counter line's label → the real figures (as String(+v); dates as ISO)
const countLabel = (c) => (c.kind === "badge progress" ? `badge ${c.pre.trim()}` : c.kind);
const isoOf = (v) => { const [mo, d, y] = v.split("/").map(Number); return `${y}-${String(mo).padStart(2, "0")}-${String(d).padStart(2, "0")}`; };
function noteCount(label, v) { if (!REAL_COUNT.has(label)) REAL_COUNT.set(label, new Set()); REAL_COUNT.get(label).add(v); }
const isRealCount = (label, v) => !!REAL_COUNT.get(label)?.has(String(+v));
function chaseCounters(lines) {
  const { found, bag } = accountCounters(lines);
  const chase = (v, mode) => { if (sigDigits(v) >= COUNTER_DIGITS) register(String(v), "account counter", mode); };
  const asWritten = (v) => chase(v, v.includes(".") ? "decimal" : "number");
  for (const c of found) if (c.kind !== "egg progress") noteCount(countLabel(c), c.kind === "start date" ? isoOf(c.v) : String(+c.v));
  if (bag.head >= 0) { noteCount("bag total", String(+bag.v)); for (const q of bag.items) noteCount(`bag ${q.pre.trim()}`, String(+q.v)); }
  for (const c of found) {
    if (c.kind === "start date") {
      // as written, padded, unpadded and ISO: every way a date is spelled in an export
      const [mo, d, y] = c.v.split("/").map(Number), p = (x) => String(x).padStart(2, "0");
      for (const f of new Set([c.v, `${p(mo)}/${p(d)}/${y}`, `${mo}/${d}/${y}`])) register(f, "account counter", "word");
      register(`${y}-${p(mo)}-${p(d)}`, "account counter");
    } else if (c.kind === "distance walked") {
      // as written, and as a trainer card or a medal rounds it
      const km = +c.v;
      asWritten(c.v);
      chase(km.toFixed(1), "decimal"); chase(km.toFixed(2), "decimal");
      chase(Math.round(km), "number"); chase(Math.floor(km), "number");
    } else asWritten(c.v);
  }
  if (bag.head >= 0) { asWritten(bag.v); for (const q of bag.items) asWritten(q.v); }
}

/* One pass over an export gathers all of the above. The export being scrubbed
 * goes first, and what the pass returns is what phase 2 writes from. An older
 * export of the same account (--also) takes the same pass for its values and
 * places only — a friend who has since left, a town from an earlier session
 * log, a stop from last year — and nothing is ever written from it. */
function harvest(root, pjLines, keptSubjects) {
  const raw = readText(path.join(root, "Gameplay.txt")) || "";
  const gpLines = raw.split(/\r?\n/);
  const gpIds = [];         // [real, kind, makeFake]
  const referred = [];      // codenames of trainers you referred
  {
    let inReferral = false;
    for (const line of gpLines) {
      const hit = GP_IDS.find(([re]) => re.test(line));
      if (hit) { const v = line.match(hit[0])[1].trim(); if (v) { register(v, hit[1]); gpIds.push([v, hit[1], hit[2]]); } continue; }
      if (/^Referral Connections:/i.test(line)) { inReferral = true; continue; }
      if (!inReferral) continue;
      if (!line.trim()) { inReferral = false; continue; }
      if (/^Player\b/i.test(line)) continue;      // the "Player\tAreFriends" header
      const who = line.split("\t")[0].trim();
      if (who) { register(who, "referred trainer"); referred.push(who); }
    }
  }
  const collection = blockAfter(gpLines, /^Pokemon in your collection:/, /^[ \t]+\S/);
  for (let i = collection[0]; i < collection[1]; i++) {
    const t = gpLines[i].match(TAB_LABEL), s = gpLines[i].match(SPACE_LABEL);
    const label = t ? t[1] : s && !GENDER.test(s[2].trim()) ? s[2] : null;
    if (label && !isSpeciesName(label.trim())) register(label, "collection label", "word");
  }
  const recent = blockAfter(gpLines, /^Date and time\tDescription/i, /\t/);
  for (let i = recent[0]; i < recent[1]; i++) {
    const m = gpLines[i].slice(gpLines[i].indexOf("\t") + 1).trim().match(GIFT);
    if (m && !NOT_A_TRAINER.test(m[3])) register(m[3], "gift sender");
  }
  chaseCounters(gpLines);

  /* Every codename in the social files — registered now, so a gift sender or a
   * referral that also appears here gets ONE fake, and so the sweep knows them all. */
  const friends = readLines(path.join(root, "FriendList.tsv"));
  if (friends) {
    const head = friends[0].split("\t");
    const ci = head.indexOf("Friend's codename"), ni = head.indexOf("Nickname");
    for (const l of friends.slice(1)) {
      if (!l.trim()) continue;
      const c = l.split("\t");
      if (ci >= 0) register(c[ci], "friend codename");
      if (ni >= 0) register(c[ni], "friend nickname", "word");
    }
  }
  for (const l of (readLines(path.join(root, "RecentlyUnfriended.tsv")) || []).slice(1)) if (l.trim()) register(l.split("\t")[0], "unfriended codename");
  for (const l of readLines(path.join(root, "RecentInviteActions.tsv")) || []) { const c = l.split("\t"); if (c.length >= 3) register(c[2], "invite-log codename"); }
  /* The Campfire export is named after you — <codename>_<date>_<time>.csv. None
   * of it is ever written (the sample's Campfire file is invented by
   * campfire-sample.mjs), but the codename in its name is yours, and its meetups
   * and map links are real places, so their coordinates are taken further down. */
  const campfire = [];
  for (const f of fs.readdirSync(root)) {
    const m = f.match(/^(.+)_\d{8}_\d{6}\.csv$/);
    if (m) { register(m[1], "trainer codename"); campfire.push(readText(path.join(root, f)) || ""); }
  }

  const live = readLines(path.join(root, "LiveEventRegistrationHistory_AsPurchaser.tsv"));
  if (live && live.length > 1) {
    const head = live[0].split("\t");
    const di = head.indexOf("Event Details");
    for (const l of live.slice(1)) {
      if (!l.trim()) continue;
      const c = l.split("\t");
      const d = (c[di] || "").trim();
      if (d) {
        registerFree(d, "live-event name");
        for (const part of d.split(",")) registerFree(part, "live-event name");
        for (const w of d.match(/[\p{L}][\p{L}'-]*/gu) || []) {
          realEventWords.add(w.toLowerCase());
          if (!EVENT_GENERIC.has(w.toLowerCase())) register(w, "live-event place word", "word");
        }
      }
      for (const col of LIVE_BLANK) {
        const ci = head.indexOf(col), v = ci < 0 ? "" : (c[ci] || "").trim();
        if (!v) continue;
        if (col === "Phone Carrier") register(v, "phone carrier", "word");
        // the names on an order are trainer codenames, one per ticket
        else if (col === "In-game names on Order") for (const who of v.split(/[,;|]/)) register(who, "in-game name on an order");
        else {
          // the rest are order records: the whole value, and any identifier-shaped piece of it
          registerFree(v, "ticket order detail");
          for (const tok of v.match(/[A-Za-z0-9@._+-]{8,}/g) || []) if (/\d/.test(tok)) register(tok, "ticket order detail");
        }
      }
    }
  }

  const acct = readText(path.join(root, "AccountInformation.txt"));
  if (acct) {
    for (const e of acct.match(EMAIL) || []) register(e, "account email");
    const u = acct.match(/^User name:\s*(.+)$/im);
    if (u) register(u[1], "account user name");
  }
  const social = readText(path.join(root, "SocialProfile.txt"));
  const code = social && social.match(/^Your invite code for friends:\s*(.+)$/im);
  if (code) register(code[1], "friend invite code");
  const contacts = readText(path.join(root, "ContactsImport.txt"));
  const shown = contacts && contacts.match(/^Name shown on invites:\s*(.+)$/im);
  if (shown) register(shown[1], "name shown on invites", "word");
  const way = readText(path.join(root, "wayfarer_player_data.json"));
  for (const e of (way && way.match(EMAIL)) || []) register(e, "Wayfarer email");

  const support = (() => { const t = readText(path.join(root, "SupportInteractions1.tsv")); return t ? tsvRecords(t) : null; })();
  let subjects = [];
  if (support && support.length > 1) {
    const head = support[0];
    const si = head.findIndex((h) => /ticket/i.test(h));
    subjects = support.slice(1).map((r) => subjectOf(r[si >= 0 ? si : 1])).filter(Boolean);
    // the subjects that get published are the scrubbed export's, whichever export this is
    const kept = (v) => (keptSubjects || subjects).some((s) => s.includes(v));
    const cols = ["Message content", "Custom Fields", "Meta data"].map((h) => head.indexOf(h)).filter((i) => i >= 0);
    for (const r of support.slice(1)) for (const ci of cols) {
      const v = (r[ci] || "").trim();
      if (!v) continue;
      if (!kept(v)) registerFree(v, "support message");
      for (const ln of v.split(/\r?\n/)) if (ln.trim().length >= 16 && !kept(ln.trim())) registerFree(ln, "support message");
    }
  }

  for (const src of ["App_Sessions.csv", "App_Installs.csv", "User_Attribution_Sessions.csv"]) {
    const lines = pjLines(src);
    if (!lines) continue;
    const head = splitCSV(lines[0]);
    const want = head.map((h, i) => [i, SESSION_COLS[h.trim()]]).filter(([, k]) => k);
    for (const l of lines.slice(1)) {
      if (!l.trim()) continue;
      const c = splitCSV(l);
      for (const [i, [kind, mode]] of want) register(c[i], kind, mode);
    }
  }

  /* Real places: every journey event's positions, the location history, the
   * Campfire meetups and map links, and Wayfarer's hometown and last-activity
   * spots (latE6/lngE6: degrees × 10⁶) along with any location a submission has. */
  const PAIRS = [["Player_Latitude", "Player_Longitude"], ["Fort_Latitude", "Fort_Longitude"], ["Gym_Latitude", "Gym_Longitude"]];
  for (const [type] of EVENT_TYPES) for (const suffix of ["1", "2"]) {
    const lines = pjLines(`${type}${suffix}.csv`);
    if (!lines) continue;
    const h = lines[0].split(",");
    const idx = PAIRS.map(([a, b]) => [h.indexOf(a), h.indexOf(b)]).filter(([a, b]) => a >= 0 && b >= 0);
    for (const l of lines.slice(1)) {
      const c = l.split(",");
      takeCoords(c);
      for (const [a, b] of idx) realPlace(c[a], c[b]);
    }
  }
  for (const l of (readLines(path.join(root, "GameplayLocationHistory.tsv")) || []).slice(1)) {
    const c = l.split("\t");
    takeCoords(c);
    realPlace(c[1], c[2]);
  }
  for (const t of campfire) for (const re of [TEXT_PAIR, LINK_PAIR]) for (const m of t.matchAll(re)) { takeCoords([m[1], m[2]]); realPlace(m[1], m[2]); }
  let wj = null;
  try { wj = way ? JSON.parse(way) : null; } catch { /* unreadable: the writer skips it too */ }
  (function walk(o) {
    if (Array.isArray(o)) { o.forEach(walk); return; }
    if (typeof o === "string") { for (const re of [TEXT_PAIR, LINK_PAIR]) for (const m of o.matchAll(re)) realPlace(m[1], m[2]); return; }
    if (!o || typeof o !== "object") return;
    if (typeof o.latE6 === "number" && typeof o.lngE6 === "number") realPlace(o.latE6 / 1e6, o.lngE6 / 1e6);
    Object.values(o).forEach(walk);
  })(wj);

  return { raw, gpLines, gpIds, referred, collection, recent, friends, live, support, subjects };
}
const HARVEST = harvest(SRC, readPJLines, null);
const GP_EOL = HARVEST.raw.includes("\r\n") ? "\r\n" : "\n";
const { gpLines: GP_LINES, gpIds, referred, collection: COLLECTION, recent: RECENT, friends: FRIENDS, live: LIVE, support: SUPPORT } = HARVEST;
for (const dir of ALSO) harvest(dir, pjReader(dir), HARVEST.subjects);

/* Draw until the point is clear of every real cell — rarely more than once. */
function clear(draw) {
  for (let i = 0; i < 500; i++) { const p = draw(); if (!REAL_CELLS.has(cellOf(p[0].toFixed(6), p[1].toFixed(6)))) return p; }
  throw new Error("could not place a synthetic point clear of every real one");
}
/* ...and when it is written out (fix6 below), out of NEAR_M of every real place.
 * A point that came within NEAR_M moves straight away from the nearest real
 * place, to NEAR_M + 15 m, and again if that puts it near another place or in a
 * real cell (then away from that cell's centre, out of it). One caught between
 * places turns a little further on each round.
 *
 * Only the written copy moves. The drawn point stays as it was wherever the
 * generator builds on it (the next step of a walk, a raid spot beside a gym),
 * and the move is arithmetic, not a draw. So the seeded sequence is untouched:
 * every other value in the sample comes out byte for byte as before, and only
 * the coordinates that were too close change. */
function pushClear(p) {
  let [a, o] = p;
  for (let k = 0; k < 80; k++) {
    const hit = nearestReal(a, o);
    if (!hit && !REAL_CELLS.has(cellOf(a.toFixed(6), o.toFixed(6)))) return [a, o];
    const [fa, fo] = hit ? hit.at : [Math.round(a * 1000) / 1000, Math.round(o * 1000) / 1000];
    const go = hit ? NEAR_M + 15 : 90, cos = Math.cos(fa * RAD);
    let dx = (o - fo) * M_PER_DEG * cos, dy = (a - fa) * M_PER_DEG, len = Math.hypot(dx, dy);
    if (len < 1e-6) { dx = 0; dy = 1; len = 1; }
    const t = k < 6 ? 0 : k * 0.7;
    const ux = (dx * Math.cos(t) - dy * Math.sin(t)) / len, uy = (dx * Math.sin(t) + dy * Math.cos(t)) / len;
    a = fa + (uy * go) / M_PER_DEG;
    o = fo + (ux * go) / (M_PER_DEG * cos);
  }
  throw new Error("could not push a synthetic point clear of every real one");
}

/* The pools give way to the ledger before a single fake is drawn. Nicknames
 * and places stand alone in the output, so they must clear every kind of match.
 * Codename halves never do — "Swift" only ever appears inside "SwiftRaptor123",
 * where a whole-word match can't fire — so they need only be free of real
 * codenames; every composed fake is vetted in full as it is drawn anyway. */
const partClean = (w) => matcher()(w).every((r) => REAL.get(r).mode !== "text");
ADJ = ADJ0.filter(partClean); NOUN = NOUN0.filter(partClean); FIRST = FIRST0.filter(isClean);
CITIES = CITIES0.filter(([c, s]) => isClean(`${c},${s}`));
{
  const held = ADJ0.length + NOUN0.length + FIRST0.length + CITIES0.length - ADJ.length - NOUN.length - FIRST.length - CITIES.length;
  if (ADJ.length < 8 || NOUN.length < 8 || FIRST.length < 8 || CITIES.length < 4) throw new Error("too many fake-name words collide with real values — extend the pools");
  for (const [col, word] of Object.entries(LIVE_MARK)) if (!isClean(word)) throw new Error(`the fixed word written into ${col} collides with a real value — change it`);
  const byKind = {};
  for (const [real, v] of REAL) if (chaseable([real])) byKind[v.kind] = (byKind[v.kind] || 0) + 1;
  console.log(`  ledger: ${[...REAL.keys()].filter((r) => chaseable([r])).length} real values to chase, ${realCoords.size} real coordinate values, ` +
    `${REAL_CELLS.size} real ~100 m cells${ALSO.length ? `, from ${1 + ALSO.length} exports` : ""}`);
  console.log("   " + Object.entries(byKind).map(([k, n]) => `${n} ${k}`).join(", "));
  if (held) console.log(`  withheld ${held} fake-name pool entr${held === 1 ? "y" : "ies"} that would collide with a real value`);
}

await checkpoint();   // a signal that arrived during phase 1 stops the run here

/* ═══════════ phase 2: write the sample ═══════════ */

/* ---------- the account-counter stream ----------
 * A generator of its own, so every draw the rest of the sample makes comes out
 * exactly as before. Seeded from the export itself rather than a constant: with
 * a seed written in this file, anyone could run the arithmetic backwards to the
 * real figures, while this one can only be rebuilt by someone who already holds
 * the export. The same export still gives the same bytes. (mulberry32) */
const crnd = (() => {
  let a = crypto.createHash("sha256").update("account counters\0").update(HARVEST.raw).digest().readUInt32LE(0);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
})();
const cBetween = (lo, hi) => lo + crnd() * (hi - lo);
/* Jogger and Hatcher change tier at these figures, and the medal lines keep
 * their real tiers, so distance and eggs hatched stay inside theirs. */
const JOGGER_KM = [10, 100, 1000, 10000], HATCHER_EGGS = [10, 100, 1000, 2500];
/* A new figure for `orig`: moved by a fraction in [lo, hi] — up only, unless
 * `either` — inside orig's tier when `edges` are given, never below `min`, at
 * `dp` decimals, and never the real figure, any export's figure for the same
 * line (`label`), or any other real value. */
function moved(orig, { lo, hi, either = false, edges = null, min = 0, dp = 0, label = null }) {
  for (let k = 0; k < 200; k++) {
    let v = orig * (1 + cBetween(lo, hi) * (either && crnd() < 0.5 ? -1 : 1));
    if (edges) {
      const up = edges.find((e) => e > orig), floor = [...edges].reverse().find((e) => e <= orig);
      if (up != null && v >= up) v = orig + (up - orig) * cBetween(0.2, 0.8);
      if (floor != null && v < floor) v = floor + (orig - floor) * cBetween(0.2, 0.8);
    }
    const s = Math.max(min, v).toFixed(dp);
    if (+s !== orig && !(label && isRealCount(label, s)) && isClean(s) && isClean(String(Math.round(+s)))) return s;
  }
  throw new Error("could not move an account counter clear of every real value");
}
/* 15–45 days earlier, so it still comes before the first event — but never
 * before the game's launch day, which a start date can't precede. */
const LAUNCH_DAY = Date.UTC(2016, 6, 6);
function earlierStart(v) {
  const [mo, d, y] = v.split("/").map(Number), pad = /^\d\d\/\d\d\//.test(v);
  const t = Date.UTC(y, mo - 1, d), p = (x) => (pad ? String(x).padStart(2, "0") : String(x));
  for (let k = 0; k < 50; k++) {
    let n = t - (15 + Math.floor(crnd() * 31)) * 864e5;
    if (n < LAUNCH_DAY) n = t > LAUNCH_DAY ? LAUNCH_DAY : t + 864e5;
    const at = new Date(n), s = `${p(at.getUTCMonth() + 1)}/${p(at.getUTCDate())}/${at.getUTCFullYear()}`;
    if (n !== t && !REAL_COUNT.get("start date")?.has(at.toISOString().slice(0, 10)) && isClean(s)) return s;
  }
  throw new Error("could not move the start date clear of every real value");
}
/* Every account counter in the file (see accountCounters), rewritten in place.
 * XP, distance walked and eggs hatched only grow — an earlier start has had
 * more time — by 4–12 %. PokéCoins and Stardust move 8–25 % either way, badge
 * progress 5–15 %, bag quantities 5–20 %, and the bag's total becomes the new
 * sum, as the game writes it. An incubating egg's progress is redrawn inside
 * its egg. A figure below ten stays: it recognises no one. */
function perturbCounters(lines) {
  const { found, bag } = accountCounters(lines);
  const put = (c, v) => { lines[c.i] = c.pre + v + c.post; };
  const RULE = {
    "total XP": { lo: 0.04, hi: 0.12 },
    "distance walked": { lo: 0.04, hi: 0.12, edges: JOGGER_KM },
    "eggs hatched": { lo: 0.04, hi: 0.12, edges: HATCHER_EGGS },
    "PokéCoins": { lo: 0.08, hi: 0.25, either: true },
    "Stardust": { lo: 0.08, hi: 0.25, either: true },
    "badge progress": { lo: 0.05, hi: 0.15, either: true, min: 5 },
  };
  let n = 0;
  for (const c of found) {
    const v = +c.v, dp = (c.v.split(".")[1] || "").length;
    if (c.kind === "start date") { put(c, earlierStart(c.v)); n++; continue; }
    if (c.kind === "egg progress") {
      const total = +c.post.match(/\/ (\d+(?:\.\d+)?)/)[1];
      if (!(total > 0)) continue;
      let s = c.v;
      for (let k = 0; k < 50 && s === c.v; k++) s = (total * cBetween(0.05, 0.95)).toFixed(dp);
      put(c, s); n++;
      continue;
    }
    if (c.kind === "badge progress" && v <= 4) continue;   // a tier, 1–4: kept
    if (v < 10) continue;
    put(c, moved(v, { ...RULE[c.kind], dp, label: countLabel(c) })); n++;
  }
  if (bag.head >= 0) {
    const was = bag.items.map((q) => +q.v), label = (j) => `bag ${bag.items[j].pre.trim()}`;
    const now = was.map((v, j) => (v < 10 ? v : +moved(v, { lo: 0.05, hi: 0.2, either: true, min: 1, label: label(j) })));
    const sum = (a) => a.reduce((x, y) => x + y, 0);
    const gap = +bag.v - sum(was);   // the game's total is the sum of its lines; a gap it had is kept
    const big = was.map((v, j) => (v >= 10 ? j : -1)).filter((j) => j >= 0);
    // moves can cancel out and leave a real total: step one line until they don't
    for (let k = 0; big.length && (isRealCount("bag total", sum(now) + gap) || !isClean(String(sum(now) + gap))); k++) {
      if (k > 200) throw new Error("could not move the bag's total clear of every real value");
      const j = big[k % big.length];
      do now[j]++; while (now[j] === was[j] || isRealCount(label(j), now[j]) || !isClean(String(now[j])));
    }
    bag.items.forEach((q, j) => { if (now[j] !== was[j]) { lines[q.i] = q.pre + now[j] + q.post; n++; } });
    if (sum(now) + gap !== +bag.v) { lines[bag.head] = bag.pre + (sum(now) + gap) + bag.post; n++; }
  }
  return n;
}

/* ---------- Gameplay.txt (keep stats, strip every identifier) ---------- */
{
  const lines = GP_LINES.slice();
  // The labels you typed go; the species stay.
  for (let i = COLLECTION[0]; i < COLLECTION[1]; i++) {
    if (TAB_LABEL.test(lines[i])) lines[i] = lines[i].replace(TAB_LABEL, "");
    else { const s = lines[i].match(SPACE_LABEL); if (s && !GENDER.test(s[2].trim())) lines[i] = s[1]; }
  }
  // Gift senders become fakes — the same fake they get in FriendList.tsv.
  for (let i = RECENT[0]; i < RECENT[1]; i++) {
    const tab = lines[i].indexOf("\t");
    const m = lines[i].slice(tab + 1).trim().match(GIFT);
    if (m && !NOT_A_TRAINER.test(m[3])) lines[i] = `${lines[i].slice(0, tab)}\tReceived ${m[1]} ${m[2]} from ${hideCodename(m[3], "gift sender")}${m[4]}`;
  }
  // In-person event medals become neutral keys (see isInPersonBadge), before
  // any place in them is looked for — there is then no place left to rename.
  let inPerson = 0;
  for (let i = 0; i < lines.length; i++) {
    const b = lines[i].match(BADGE_LINE);
    if (b && isInPersonBadge(b[2])) lines[i] = `${b[1]}BADGE_EVENT_IN_PERSON_${++inPerson}${b[3]}`;
  }
  if (inPerson) console.log(`  generalized ${inPerson} in-person event medal key${inPerson === 1 ? "" : "s"}`);
  // Every account counter moves off its real figure (see perturbCounters).
  const perturbed = perturbCounters(lines);
  console.log(`  perturbed ${perturbed} account counter${perturbed === 1 ? "" : "s"}`);
  /* The identifiers declared in this file are replaced everywhere in it —
   * longest first, so a nickname nested inside a longer captured string
   * ("Meowth (NICKNAME)" vs "NICKNAME") can't be half-replaced. */
  const pairs = [
    ...gpIds.map(([real, kind, fake]) => [real, hide(real, kind, fake)]),
    ...referred.map((real) => [real, hideCodename(real, "referred trainer")]),
  ].filter(chaseable).sort((a, b) => b[0].length - a[0].length);
  let text = lines.join(GP_EOL);
  for (const [real, fake] of pairs) text = text.split(real).join(fake);
  /* Real places spelled inside the game's identifiers. The event badges name
   * their host city (BADGE_…_<CITY>_DAY_…), where no whole-word match can see
   * it; each place becomes a Pokémon-world town, one town per place. Badge
   * counts, tiers and families are untouched. */
  const keyed = [...REAL.entries()].filter(([real, v]) => v.mode === "key" && chaseable([real])).map(([real]) => real)
    .sort((a, b) => b.length - a.length);
  if (keyed.length) text = text.replace(new RegExp(`(?<![A-Za-z0-9])(?:${keyed.map(escRe).join("|")})(?![A-Za-z0-9])`, "g"), (real) => {
    if (!FAKE.has(real)) FAKE.set(real, vetted(nextKeyTown, "place inside a badge key"));
    return FAKE.get(real);
  });
  write("Gameplay.txt", text);
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
  return clear(() => {
    const r = Math.sqrt(rnd()) * city.radiusKm;
    const th = rnd() * Math.PI * 2;
    return [
      city.lat + (r * Math.cos(th)) / KM_PER_DEG,
      city.lon + (r * Math.sin(th)) / (KM_PER_DEG * Math.cos((city.lat * Math.PI) / 180)),
    ];
  });
}
// Every synthetic coordinate is written through here, pushed clear first (see pushClear).
const fix6 = (p) => { const [a, o] = pushClear(p); return [a.toFixed(6), o.toFixed(6)]; };

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
      const lines = readPJLines(`${type}${suffix}.csv`);
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

/* ---------- Player_Journey event files (pair 1+2, scrub coords, downsample) ---------- */
/* Build the synthetic world, then hand every distinct real coordinate a home in it.
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
  return clear(() => {
    const r = Math.sqrt(rnd()) * km;
    const th = rnd() * Math.PI * 2;
    return [
      lat + (r * Math.cos(th)) / KM_PER_DEG,
      lon + (r * Math.sin(th)) / (KM_PER_DEG * Math.cos((lat * Math.PI) / 180)),
    ];
  });
}
console.log(`  synthetic world: ${PLACES.atlas.size} places, ${GYMS.atlas.size} gyms across ${1 + AWAY.length} cities`);

let dataThrough = -Infinity;   // the newest journey event — dates the sample without dating the run
for (const [type, cap] of EVENT_TYPES) {
  /* The pair, as the export ships it: "1" is the trailing ~15 months with
   * precise positions, "2" the trailing ~3 years of the SAME events with every
   * position blurred to a few kilometres. Concatenating them (as this used to)
   * counted fifteen months twice and let a blurred cell top the stop rankings.
   * Take the "1" rows, add only the "2" rows older than the "1" window, and
   * remember which were precise so both files can be written back out the way
   * a real export has them — the demo then carries the same pair the app has
   * to reconcile. */
  let header = null;
  const body = [], precise = new Set();
  const one = readPJLines(`${type}1.csv`), two = readPJLines(`${type}2.csv`);
  const tsOf = (line) => Date.parse(line.slice(line.lastIndexOf(",") + 1).trim().replace(/\s+UTC$/, "Z").replace(" ", "T"));
  let w0 = Infinity, w1 = -Infinity;
  if (one) {
    header = one[0];
    for (let i = 1; i < one.length; i++) if (one[i].trim()) { body.push(one[i]); precise.add(one[i]); const t = tsOf(one[i]); if (t < w0) w0 = t; if (t > w1) w1 = t; }
  }
  if (two) {
    if (!header) header = two[0];
    for (let i = 1; i < two.length; i++) if (two[i].trim()) { const t = tsOf(two[i]); if (isNaN(t) || t < w0 || t > w1) body.push(two[i]); }
  }
  if (!header) continue;
  for (const l of body) { const t = tsOf(l); if (t > dataThrough) dataThrough = t; }
  const cols = header.split(",");
  const latI = cols.findIndex((c) => /Player_Latitude/i.test(c));
  const lonI = cols.findIndex((c) => /Player_Longitude/i.test(c));
  const gLatI = cols.findIndex((c) => /(Gym|Fort)_Latitude/i.test(c));
  const gLonI = cols.findIndex((c) => /(Gym|Fort)_Longitude/i.test(c));
  const isGym = /Gym_Latitude/i.test(header);
  const picked = strideSample(body, cap);
  const isPrecise = picked.map((l) => precise.has(l));
  const sampled = picked.map((line) => {
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
  /* "1": the precise rows only. "2": every row, positions snapped to a ~4 km
   * grid the way the export blurs them — a grid point that falls in a real
   * cell moves to the next one over. */
  const blur = (line) => {
    const c = line.split(",");
    for (const [a, b] of [[latI, lonI], [gLatI, gLonI]]) {
      if (a < 0 || b < 0 || !/^-?\d+\.\d+$/.test((c[a] || "").trim()) || !/^-?\d+\.\d+$/.test((c[b] || "").trim())) continue;
      const la = Math.round(parseFloat(c[a]) / 0.04) * 0.04, lo = Math.round(parseFloat(c[b]) / 0.04) * 0.04;
      const step = [[0, 0], [0, 0.04], [0, -0.04], [0.04, 0], [-0.04, 0], [0.04, 0.04], [-0.04, -0.04], [0.04, -0.04], [-0.04, 0.04]]
        .map(([da, db]) => [(la + da).toFixed(6), (lo + db).toFixed(6)]).find(([x, y]) => !REAL_CELLS.has(cellOf(x, y)) && !nearestReal(x, y));
      if (!step) throw new Error("could not blur a synthetic point clear of every real one");
      [c[a], c[b]] = step;
    }
    return c.join(",");
  };
  const preciseRows = sampled.filter((_, i) => isPrecise[i]);
  if (preciseRows.length) write(`Player_Journey/${type}1.csv`, [header, ...preciseRows].join("\n"));
  write(`Player_Journey/${type}2.csv`, [header, ...sampled.map(blur)].join("\n"));
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
if (FRIENDS) {
  const header = FRIENDS[0].split("\t");
  const ci = header.indexOf("Friend's codename");
  const ni = header.indexOf("Nickname");
  const out = [FRIENDS[0]];
  for (let i = 1; i < FRIENDS.length; i++) {
    if (!FRIENDS[i].trim()) continue;
    const c = FRIENDS[i].split("\t");
    if (ci >= 0) c[ci] = hideCodename(c[ci], "friend codename");
    if (ni >= 0 && c[ni]) c[ni] = fakeNick();
    out.push(c.join("\t"));
  }
  write("FriendList.tsv", out.join("\n"));
}

/* ---------- RecentlyUnfriended.tsv (fake name, keep date) ---------- */
{
  const lines = readLines(path.join(SRC, "RecentlyUnfriended.tsv"));
  if (lines) {
    const out = [lines[0]];
    for (let i = 1; i < lines.length; i++) {
      if (!lines[i].trim()) continue;
      const c = lines[i].split("\t");
      c[0] = hideCodename(c[0], "unfriended codename");
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
      if (c.length >= 3) c[2] = hideCodename(c[2], "invite-log codename");
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
 * first country seen becomes US, matching the synthetic world's home city. Kept
 * (rather than dropped) so the demo actually exercises the login-geography
 * chapter. */
const COUNTRY_POOL = ["US", "CA", "MX", "JP", "GB", "DE", "AU", "NZ"];
const countryMap = {};
function fakeCountryFor(real) {
  const k = (real || "").trim().toUpperCase();
  if (!k) return "";
  if (!countryMap[k]) countryMap[k] = COUNTRY_POOL[Object.keys(countryMap).length % COUNTRY_POOL.length];
  return countryMap[k];
}
for (const [src, cap] of [["App_Sessions.csv", 2500], ["App_Installs.csv", 50]]) {
  const lines = readPJLines(src);
  if (!lines) continue;
  const head = splitCSV(lines[0]);
  const idx = (name) => head.indexOf(name);
  const ei = idx("Event_time"), di = idx("Device_model"), pi = idx("Platform"), cyi = idx("City"), coi = idx("Country_code");
  /* Kept for the device-eras and install-history panels: when each install was
   * made, and the release and enumeration columns. None of them names anyone —
   * a version number is shared by everyone on it — and each is kept only in its
   * expected shape, so an odd value is blanked rather than carried over. */
  const KEEP = [["Install_time", /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?( UTC)?$/], ["App_version", /^\d{1,4}(\.\d{1,5}){0,3}$/],
    ["OS_version", /^\d{1,4}(\.\d{1,5}){0,3}$/], ["Device_category", /^[a-z_]{1,32}$/]].map(([h, re]) => [idx(h), re]);
  const body = strideSample(lines.slice(1).filter((l) => l.trim()), cap);
  const out = ["Event_time,Device_model,Platform,City,State,Country_code,Install_time,App_version,OS_version,Device_category"];
  for (const line of body) {
    const c = splitCSV(line);
    const [city, state] = fakeCityFor((c[cyi] || "").trim());
    const dev = ((c[di] || "").split("::").pop() || "").replace(/,/g, " ").trim();
    const kept = KEEP.map(([i, re]) => { const v = i < 0 ? "" : (c[i] || "").trim(); return re.test(v) ? v : ""; });
    out.push([c[ei] || "", dev, (c[pi] || "").trim(), city, state, fakeCountryFor(c[coi]), ...kept].join(","));
  }
  write("Player_Journey/" + src, out.join("\n"));
}

/* ---------- ImageData.txt → fake the image handles, keep the dates ----------
 * The dates ARE the story (a snapshot timeline). The IDs are opaque Niantic
 * handles to real photos, so they get replaced even though they carry no
 * personal content on their own. A fake handle that happens to hold a long run
 * of digits would look like an account number to the leak check, so those are
 * redrawn. */
{
  const lines = readLines(path.join(SRC, "ImageData.txt"));
  if (lines && lines.length > 1) {
    const hex = () => { let h; do h = Array.from({ length: 16 }, () => "0123456789abcdef"[Math.floor(rnd() * 16)]).join(""); while (/\d{12}/.test(h)); return h; };
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
 * The raw file carries the full text of everything you wrote to support, plus
 * custom fields and metadata. The site never reads those columns, and the demo
 * must not even contain them: emit two columns and drop the rest.
 * Ticket numbers are identifiers, so they are renumbered too. */
{
  if (SUPPORT && SUPPORT.length > 1) {
    const head = SUPPORT[0];
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
    // Rows come from the quote-aware reader: a message that runs over several
    // lines is still one row here, not several.
    for (const c of SUPPORT.slice(1)) {
      if (!c.some((x) => x.trim())) continue;
      const title = (c[si >= 0 ? si : 1] || "").replace(/^\s*Ticket\s+(\d+)\s*:/i, (_, real) => {
        if (!ticketNo.has(real)) ticketNo.set(real, 10000000 + ticketNo.size);
        return `Ticket ${ticketNo.get(real)}:`;
      });
      out.push([(c[ti >= 0 ? ti : 0] || "").trim(), title.trim()].join("\t"));
    }
    write("SupportInteractions1.tsv", out.join("\n"));
  }
}

/* ---------- LiveEvent tickets → synthetic names, drop everything else ----------
 * The rule for this file: blank every column the app does not read.
 * parseLiveEvents() reads only Event Details, Number of Tickets on Order,
 * Total Paid, Currency Paid and Date of Order Placed — everything else is
 * dead weight that can only leak. AddOn Info was the one exception, and it
 * shipped an opaque 16-hex token glued to a product name. Almost certainly a
 * merchandise SKU rather than anything personal, but "almost certainly" is not
 * the standard this generator holds itself to elsewhere. The app now reads
 * whether it is filled, never what it says — so a filled one becomes
 * LIVE_MARK's fixed word, and the text is gone as before.
 *
 * Event Details is read, and it is free text: the real one named the city the
 * event was in, which the session scrub relocates everywhere else. So it is not
 * scrubbed but replaced — a made-up name that shares not one word with the
 * original and holds no digits at all. The app lists it and nothing more. */
{
  if (LIVE && LIVE.length > 1) {
    const head = LIVE[0].split("\t");
    const di = head.indexOf("Event Details");
    const NAMES = ["Sample Summer Showcase", "Sample Winter Showcase", "Sample Spring Showcase", "Sample Autumn Showcase",
      "Demo Harbor Gathering", "Demo Valley Gathering", "Demo Garden Meetup", "Demo Lantern Meetup"]
      .filter((n) => n.split(" ").every((w) => !realEventWords.has(w.toLowerCase())) && isClean(n));
    const TAIL = ["general admission", "standard entry", "full visit"]
      .filter((n) => n.split(" ").every((w) => !realEventWords.has(w.toLowerCase())) && isClean(n));
    if (!NAMES.length || !TAIL.length) throw new Error("no synthetic live-event name is free of the real ones — extend the list");
    const out = [LIVE[0]];
    let n = 0;
    for (let i = 1; i < LIVE.length; i++) {
      if (!LIVE[i].trim()) continue;
      const c = LIVE[i].split("\t");
      LIVE_BLANK.forEach((b) => { const bi = head.indexOf(b); if (bi >= 0) c[bi] = LIVE_MARK[b] && (c[bi] || "").trim() ? LIVE_MARK[b] : ""; });
      if (di >= 0 && c[di].trim()) { c[di] = `${NAMES[n % NAMES.length]}, ${TAIL[n % TAIL.length]}`; n++; }
      out.push(c.join("\t"));
    }
    write("LiveEventRegistrationHistory_AsPurchaser.tsv", out.join("\n"));
  }
}

/* ---------- wayfarer_player_data.json → counts, dates and star ratings ----------
 * The profile keeps its two totals. The four logs keep one entry per real
 * entry, holding its date and — for your reviews — the stars you gave and the
 * two true/false flags. Every Candidate ID, comment, "What is it?", suggested
 * location and duplicate link goes, as does the profile's email and every
 * location in it; a date or a rating survives only in its expected shape. */
{
  const fp = path.join(SRC, "wayfarer_player_data.json");
  if (fs.existsSync(fp)) {
    try {
      const j = JSON.parse(fs.readFileSync(fp, "utf8"));
      const root = Array.isArray(j) ? (j[0] || {}) : j;
      const prof = (Array.isArray(root.OprProfile) ? root.OprProfile[0] : root.OprProfile) || {};
      const subs = root.OprSubmissionLog || [];
      const log = (k) => (Array.isArray(root[k]) ? root[k].filter((e) => e && typeof e === "object") : []);
      // Wayfarer writes its times as "2026-05-03 04:05:06 GMT" — kept in that shape
      const STAMP = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(\.\d+)?( UTC| GMT)?$/;
      const when = (e) => (STAMP.test(String(e.Time || "").trim()) ? { Time: String(e.Time).trim() } : {});
      const RATINGS = ["Rating for Quality", "Rating for Uniqueness", "Rating for Cultural", "Rating for Safety", "Rating for Location", "Rating for Text"];
      const review = (e) => {
        const o = when(e);
        for (const k of RATINGS) if (k in e) o[k] = /^[1-5]$/.test(String(e[k]).trim()) ? String(e[k]).trim() : "";
        for (const k of ["Is Duplicate", "One Star Submission"]) if (k in e) o[k] = /^true$/i.test(String(e[k]).trim()) ? "true" : "false";
        return o;
      };
      const slim = {
        OprProfile: {
          "Total Analyzed": +prof["Total Analyzed"] || +prof["TotalAnalyzed"] || 0,
          "Portals Created": +prof["Portals Created"] || +prof["PortalsCreated"] || 0,
        },
        OprSubmissionLog: (Array.isArray(subs) ? subs : []).map((e) => (e && typeof e === "object" ? review(e) : {})),
        OprAssignmentLog: log("OprAssignmentLog").map(when),
        OprSkippedLog: log("OprSkippedLog").map(when),
        OprUpgradeLog: log("OprUpgradeLog").map(when),
      };
      write("wayfarer_player_data.json", JSON.stringify(slim));
    } catch (e) { console.warn("  wayfarer parse skipped:", e.message); }
  }
}

/* ---------- the two files that owe nothing to the export ----------
 * The rival trainer (GaryDemo) is fictional and was generated outright, so it
 * is carried over (found at start-up) rather than rebuilt. The Campfire file is
 * invented by campfire-sample.mjs from a fixed seed. Nothing from the REAL
 * Campfire export is written — it is other people's words plus the location of
 * every meetup you attended, and no scrubber should be trusted with that.
 * Phase 1 takes its coordinates only, to keep every synthetic point clear. */
write(RIVAL, RIVAL_TEXT);
const CAMPFIRE = campfireSample("AshDemo");
write(CAMPFIRE.name, CAMPFIRE.text);

/* ---------- manifest + notice (written before the check, so it sweeps them too) ---------- */
write("manifest.json", JSON.stringify({
  // The newest event in the source, not today's date: rerunning on the same
  // export must produce the same bytes.
  dataThrough: Number.isFinite(dataThrough) ? new Date(dataThrough).toISOString().slice(0, 10) : null,
  note: "Fully anonymized synthetic demo derived from a real export. No real names, locations, emails or identifiers.",
  files: written.slice(),
}, null, 2) + "\n");

write("README.md", `# Sample export (synthetic)

Generated by \`tools/scrub-demo.mjs\` from a real Pokémon GO export, to preview
the visualizations. **No identifying personal data is present.** A few real
values are kept on purpose; "What is kept", at the end, lists them.

**Coordinates are generated, not anonymized.** No location in this folder is
derived from a real one. The generator builds a synthetic world — one home city
and seven travel cities — and assigns each distinct real coordinate a place in
it by HOW OFTEN it appears, never by where it is. Frequency rank is the only
thing that crosses over, and visit counts are already on screen in the app. Two
real stops that were metres apart routinely land on different continents.

An earlier version translated every coordinate by a single offset and called
that a fake city. It was not: a rigid translation preserves every distance and
bearing exactly, so the output was one subtraction away from the real map.

Names, codenames, friend nicknames, emails, account IDs, referral codes and
support message bodies are faked or dropped. The labels typed on Pokémon in the
collection list are removed, and live-event ticket names are replaced with
invented ones. Every in-person event medal becomes a neutral key
(\`BADGE_EVENT_IN_PERSON_1\`, \`_2\`, …) that keeps its count and names no event,
place, year, day or session, and a real city left in any other event key
becomes a Pokémon-world town. Event logs are downsampled.

The account's counters are perturbed, never copied. A trainer profile shows
several of them to every friend, so exact figures would recognise the account.
The start date moves a few weeks earlier. Total XP, PokéCoins, Stardust,
distance walked, eggs hatched, the bag's quantities and total, badge progress
and each incubating egg's progress move by a believable amount, and every medal
stays in its tier.

Two files owe nothing to the export: the Campfire file is invented outright by
\`tools/campfire-sample.mjs\`, and the rival trainer's stats file is fictional.

The generator checks its own work. Every real value it can find — codenames,
labels, place names, the carrier, device and network identifiers, account
counters, message text — is recorded before anything is written, and every output file is swept for all
of them, for email addresses, IP addresses, UUIDs, URLs and long digit runs, and
for any **real coordinate value** or any point within 120 m of a real place,
measured. One hit and nothing is published: the new files are discarded and the
previous sample is left as it was.

Regenerate with:

    node tools/scrub-demo.mjs "<path to your export folder>"

The folder can hold the journey logs unzipped (\`Player_Journey/\`) or as the
export ships them (\`Player_Journey.zip\`). Add \`--also "<an older export>"\`
to chase that export's values and places as well; nothing is written from it.

## What is kept

These come over from the real export as they were, because the report reads
them and none of them names the player:

- the trainer level, every medal's tier, the species, and the journey's dates
  and timing, so the story still feels real;
- the in-app purchase log as the export writes it: each purchase and coin
  spend, with its item, store, quantity, amount and time;
- the fitness log's daily steps, distance, calories and exercise time;
- each friendship's start dates, who started it, its source and its games,
  under an invented codename and nickname;
- when each activity invite came and when it expired, and the dates of
  snapshots and unfriendings;
- each live-event order's date, ticket count and total paid, under an invented
  event name, with an add-on only as the word "add-on", never what it was;
- from the session logs, the install time, app and OS version, platform, and
  the device model and category, each only in its expected shape (anything
  else is blanked);
- each support ticket's date and topic (the category path the support form
  fills in), under a new ticket number; what was written is dropped;
- each Wayfarer entry's date and the star ratings given.
`);

await checkpoint();   // …and one that arrived while writing, here

/* ═══════════ phase 3: the leak check ═══════════
 * "No identifying personal data is present" is a claim this repo publishes, so it is
 * verified rather than assumed, over EVERY file in the new folder — not just
 * the ones this script remembers writing. A hit is fatal: the new folder is
 * deleted and the old sample stays, because a half-scrubbed export is worse
 * than a stale one. Findings name the kind of value, the file and the line;
 * they never print the value itself. Add a pattern whenever the export grows
 * a field. */
{
  const PATTERNS = [
    [/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "an email address"],
    [/\b(?:\d{1,3}\.){3}\d{1,3}\b/g, "an IPv4 address"],
    // Full or "::"-compressed. A clock time has two colons and never a "::".
    [/(?<![\w:])(?:(?:[0-9a-f]{1,4}:){7}[0-9a-f]{1,4}|[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6}::(?:[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})?|::[0-9a-f]{1,4}(?::[0-9a-f]{1,4}){0,6})(?![\w:])/gi, "an IPv6 address"],
    [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "a UUID (a device or advertising ID)"],
    [/\d{12,}/g, "a run of 12+ digits (an account, device or invite number)"],
    [/\bhttps?:\/\/|\bwww\.[a-z0-9-]+\./gi, "a URL"],
  ];
  /* Columns that must be empty wherever they survive as a header: everything
   * the scrub blanks, and every network, device and postal column. City and
   * State survive on purpose, holding fake places. */
  const MUST_BE_EMPTY = new Set([...LIVE_BLANK, ...Object.keys(SESSION_COLS).filter((c) => !/^(City|State|State_Province)$/.test(c)),
    "Message content", "Custom Fields", "Meta data"]);
  const lineAt = (text, i) => { let n = 1; for (let k = text.indexOf("\n"); k >= 0 && k < i; k = text.indexOf("\n", k + 1)) n++; return n; };
  const files = [];
  (function walk(dir, rel) {
    for (const f of fs.readdirSync(dir).sort()) {
      const p = path.join(dir, f), r = rel ? `${rel}/${f}` : f;
      if (fs.statSync(p).isDirectory()) walk(p, r); else files.push(r);
    }
  })(TMP, "");
  const scan = matcher();
  const leaks = [];
  for (const rel of files) {
    const text = fs.readFileSync(path.join(TMP, rel), "utf8");
    /* The Campfire file is synthetic by construction — its UUIDs, URLs and
     * long message IDs are the generator's, on reserved .example domains. It
     * is held to a stricter rule instead: byte-for-byte what the generator
     * produces, which is what guarantees the real export never got in. */
    const synthetic = rel === CAMPFIRE.name;
    if (synthetic && text !== campfireSample("AshDemo").text) leaks.push(`${rel}: is not the synthetic Campfire file`);
    const byKind = {};
    for (const real of scan(text)) byKind[kindOf(real)] = (byKind[kindOf(real)] || 0) + 1;
    for (const [kind, n] of Object.entries(byKind)) leaks.push(`${rel}: ${n} × ${kind}`);
    if (!synthetic) for (const [re, what] of PATTERNS) {
      re.lastIndex = 0;
      const m = re.exec(text);
      if (m) leaks.push(`${rel}:${lineAt(text, m.index)}: ${what}`);
    }
    let hits = 0;
    for (const cell of text.split(/[,\t\n]/)) { const v = cell.trim(); if (v.length > 6 && realCoords.has(v)) hits++; }
    if (hits) leaks.push(`${rel}: ${hits} real coordinate value(s)`);
    let near = 0;   // "lat,lng" / "lat<TAB>lng" cells, and map links' lat=…&lng=…: in a real cell, or within NEAR_M of a real place
    for (const re of [/(-?\d{1,3}\.\d+)\s*[,\t]\s*(-?\d{1,3}\.\d+)/g, /[?&]lat=(-?\d{1,3}\.\d+)&lng=(-?\d{1,3}\.\d+)/g])
      for (const m of text.matchAll(re)) if (REAL_CELLS.has(cellOf(m[1], m[2])) || nearestReal(m[1], m[2])) near++;
    if (near) leaks.push(`${rel}: ${near} coordinate pair(s) within ${NEAR_M} m of a real place, or in its ~100 m cell`);
    if (/\.(tsv|csv)$/.test(rel) && !synthetic) {
      const rows = text.split("\n"), sep = rel.endsWith(".tsv") ? "\t" : ",";
      const head = rows[0].split(sep);
      head.forEach((h, i) => {
        if (!MUST_BE_EMPTY.has(h.trim())) return;
        // …where a yes/no column may also hold its one fixed word, and nothing else
        const mark = LIVE_MARK[h.trim()];
        const filled = rows.slice(1).filter((r) => { const v = (r.split(sep)[i] || "").trim(); return v && v !== mark; }).length;
        if (filled) leaks.push(`${rel}: ${filled} value(s) left in the "${h.trim()}" column`);
      });
    }
  }
  if (leaks.length) {
    console.error(`\n✗ LEAK CHECK FAILED — ${leaks.length} problem(s). Nothing was published; the previous sample is untouched.`);
    leaks.slice(0, 30).forEach((l) => console.error("   " + l));
    if (leaks.length > 30) console.error(`   …and ${leaks.length - 30} more`);
    process.exit(1);
  }
  console.log(`\n✓ Leak check passed — ${[...REAL.keys()].filter((r) => chaseable([r])).length} real values, ${realCoords.size} real coordinates and ${REAL_CELLS.size} real ~100 m cells chased across ${files.length} files, 0 found.`);
}

await checkpoint();   // the last point a signal can stop the run: nothing is published yet

/* ---------- publish: swap the checked folder into place ---------- */
{
  const OLD = `${OUT}.old-${process.pid}`;
  const had = fs.existsSync(OUT);
  if (had) fs.renameSync(OUT, OLD);
  try { fs.renameSync(TMP, OUT); SWAPPED = true; }
  catch (e) { if (had) fs.renameSync(OLD, OUT); throw e; }
  if (had) fs.rmSync(OLD, { recursive: true, force: true });
}
console.log(`\nDone. ${written.length} files → ${OUT}`);
