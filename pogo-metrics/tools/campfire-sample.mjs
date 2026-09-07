/* campfire-sample.mjs — a FULLY SYNTHETIC Campfire export for the sample.
 *
 *   node tools/campfire-sample.mjs            writes sample-export/<codename>_20260812_120000.csv
 *                                             and adds it to sample-export/manifest.json
 *   import { campfireSample } from "./campfire-sample.mjs"   (scrub-demo.mjs does this)
 *
 * Unlike every other file in sample-export/, nothing here is derived from a real
 * export — not the counts, not the dates, not the names. The Campfire export is
 * mostly other people's words (club chat, comments, posts) plus the coordinates
 * of every meetup you attended, and no scrubber should be trusted with that.
 * So the sample is invented outright from a seeded generator: the same shape
 * as the real file (ten sections, same headers, same timestamp format, quoted
 * multi-line messages), a plausible story, and no one's data.
 *
 * The IP-address section is written with its header and no rows: a fake IP
 * would trip the scrubber's leak check, and the app never reads it anyway. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/* seeded, reproducible */
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

export function campfireSample(codename = "AshDemo", seed = 20260812) {
  const rnd = mulberry32(seed);
  const pick = (a) => a[Math.floor(rnd() * a.length)];
  const int = (lo, hi) => lo + Math.floor(rnd() * (hi - lo + 1));
  const pad = (n, w = 2) => String(n).padStart(w, "0");
  /* Campfire's own timestamp shape: 2024-07-04 00:51:20.541 +0000 UTC */
  const stamp = (d) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}:${pad(d.getUTCSeconds())}.${pad(d.getUTCMilliseconds(), 3)} +0000 UTC`;
  const T0 = Date.UTC(2024, 1, 22), T1 = Date.UTC(2026, 6, 13);
  /* evenings-heavy, with a busy winter — the shape a real club chat has */
  const when = () => {
    let t = T0 + rnd() * (T1 - T0);
    const d = new Date(t);
    if (rnd() < 0.10) d.setUTCMonth(10 + int(0, 2)), d.setUTCFullYear(2024);   // a busier winter
    d.setUTCHours(rnd() < 0.7 ? int(17, 23) : int(8, 16), int(0, 59), int(0, 59), int(0, 999));
    return d;
  };
  const q = (s) => `"${String(s).replace(/"/g, '""')}"`;
  const csv = (cells) => cells.map((c) => (/[",\n]/.test(String(c)) ? q(c) : String(c))).join(",");
  const id = () => String(950000000000000000n + BigInt(Math.floor(rnd() * 9e16)));
  const uuid = () => "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => { const r = (rnd() * 16) | 0; return (c === "x" ? r : (r & 3) | 8).toString(16); });

  const ADJ = ["Swift", "Brave", "Lucky", "Cosmic", "Solar", "Shadow", "Crystal", "Turbo", "Mystic", "Golden", "Frost", "Thunder", "Ember", "Lunar", "Radiant", "Iron", "Wild", "Nova", "Comet", "Pixel"];
  const NOUN = ["Raptor", "Falcon", "Voyager", "Ranger", "Hunter", "Phoenix", "Tracker", "Maverick", "Nomad", "Pioneer", "Scout", "Striker", "Wanderer", "Sage", "Ace", "Drifter", "Rook", "Sprout", "Glider", "Quill"];
  const fake = () => pick(ADJ) + pick(NOUN) + int(100, 999);
  const CLUBS = ["Rivertown Raiders", "Lakeside Trainers", "Brightport GO Club", "Maplefield Night Raids", "Stonehaven Community Day Crew"];
  const VENUES = ["Rivertown Park", "the Lakeside fountain", "Brightport Pier", "Maplefield Library", "Stonehaven Square", "the Harbor gym", "Union Plaza"];
  const KINDS = [
    ["Raid Hour", 0.34, ["Palkia", "Dialga", "Groudon", "Kyogre", "Rayquaza", "Zacian", "Genesect", "Deoxys", "Tapu Bulu", "Origin Dialga", "Shadow Kyogre"]],
    ["Community Day", 0.14, ["Bulbasaur", "Machop", "Larvitar", "Gible", "Rowlet", "Chikorita", "Ralts"]],
    ["Spotlight Hour", 0.12, ["Wooloo", "Dewpider", "Wobbuffet", "Machop", "Eevee"]],
    ["Raid Day", 0.1, ["Rayquaza", "Mega Latios", "Shadow Lugia"]],
    ["Max Battle Day", 0.08, ["Gigantamax Lapras", "Dynamax Beldum", "Gigantamax Toxtricity"]],
    ["GO Fest", 0.05, ["2024", "2025", "2026"]],
    ["GO Tour", 0.04, ["Unova", "Sinnoh"]],
    ["Research Day", 0.04, ["Fossil", "Water Festival"]],
    ["Team GO Rocket Takeover", 0.04, ["Giovanni", "Shadow Raids"]],
    ["Trainer meetup", 0.05, ["monthly", "welcome", "holiday"]],
  ];
  const kind = () => { let r = rnd(); for (const k of KINDS) { r -= k[1]; if (r <= 0) return k; } return KINDS[0]; };
  const title = (k) => `${pick(k[2])} ${k[0]} at ${pick(VENUES)}`.replace(/^(\d{4}) GO Fest/, "GO Fest $1 meetup");
  const LA = () => `${(34.0522 + (rnd() - 0.5) * 0.3).toFixed(6)},${(-118.2437 + (rnd() - 0.5) * 0.36).toFixed(6)}`;

  const WORDS = "raid lobby spot up we are at the gym starting in five bring your remotes gg thanks everyone great turnout who is coming tonight see you there code is in the pinned post parking is behind the library shiny check nice catch heading over now lucky trades after the hour anyone need a partner for the max battle weather boost is on wow that one fled".split(" ");
  const sentence = (n) => { const w = []; for (let i = 0; i < n; i++) w.push(pick(WORDS)); const s = w.join(" "); return s.charAt(0).toUpperCase() + s.slice(1) + pick([".", "!", "", " 👍", " 🔥"]); };
  const message = () => (rnd() < 0.03 ? sentence(int(6, 12)) + "\n" + sentence(int(4, 9)) : sentence(int(2, 12)));

  const out = [];
  const section = (t, header) => { if (out.length) out.push("", ""); out.push(t, header.join(",")); };

  section("User's Clubs", ["Name", "URL"]);
  for (const c of CLUBS) out.push(csv([c, `https://niantic-social-api.example/clubs/${uuid()}`]));

  section("User's Created Channels", ["Name", "URL"]);
  for (const n of ["#raid-alerts", "#trading-outpost", "#meetup-planning"]) out.push(csv([n, `https://niantic-social-api.example/channels/${uuid()}`]));

  section("User's Sent Messages", ["Chatv2 Message Id", "Sent At", "Message"]);
  const msgs = Array.from({ length: 1180 }, () => when()).sort((a, b) => a - b);
  for (const d of msgs) out.push(csv([rnd() < 0.02 ? "" : id(), stamp(d), message()]));

  section("User's Friends", ["Codename", "Friendship source", "Initiated by me"]);
  for (let i = 0; i < 140; i++) out.push(csv([fake(), rnd() < 0.8 ? "FRIEND_GRAPH" : "FRIEND_INVITE", rnd() < 0.4 ? "true" : "false"]));

  const EVH = ["Event Id", "Event Title", "Event Start Time", "Event End Time", "Event Description", "Event Latlng", "RSVP count", "Check-in count", "isCA/CL", "Admin URL"];
  const event = (hosted) => {
    const k = kind(); const s = when(); s.setUTCMinutes(0, 0, 0);
    const e = new Date(s.getTime() + (k[0] === "GO Fest" ? 8 : k[0] === "Community Day" ? 3 : 1) * 3600e3);
    const rsvp = hosted ? int(4, 42) : int(3, 60);
    return [uuid(), title(k), stamp(s), stamp(e), `${k[0]} — meet at ${pick(VENUES)}, ${pick(["bring remotes", "lobby at :05", "trade after", "all welcome"])}.`, LA(), rsvp, Math.min(rsvp, int(1, rsvp)), rnd() < 0.02 ? "true" : "false", `https://campfire.example/admin/${uuid()}`];
  };
  section("User-Created Meetups", EVH);
  for (let i = 0; i < 24; i++) out.push(csv(event(true)));
  section("User RSVPs", EVH);
  const rs = Array.from({ length: 70 }, () => event(false));
  for (const r of rs) out.push(csv(r));
  section("User Checkins", EVH);
  for (const r of rs.filter(() => rnd() < 0.76)) out.push(csv(r));

  section("User Comments", ["Comment Id", "Parent Id", "Parent Type", "Created At", "Updated At", "Comment Body"]);
  for (let i = 0; i < 15; i++) { const d = when(); out.push(csv([id(), uuid(), rnd() < 0.7 ? "event" : "comment", stamp(d), stamp(d), sentence(int(3, 10))])); }

  section("User Last Recorded Ip Address", ["Ip Address", "Time Last Recorded"]);   // deliberately no rows

  section("User Posts", ["Post Id", "Post Body", "URL"]);
  for (let i = 0; i < 30; i++) out.push(csv([id(), pick(["", "", "📍", "Raid here", "Spotlight spot", "Lure on"]), `/map?lat=34.05&lng=-118.24&mapObjId=${uuid()}&action=selectMapObject`]));

  return { name: `${codename}_20260812_120000.csv`, text: out.join("\n") + "\n" };
}

/* run directly: write into sample-export/ and register in its manifest */
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  const HERE = path.dirname(fileURLToPath(import.meta.url));
  const OUT = path.join(HERE, "..", "sample-export");
  const { name, text } = campfireSample(process.argv[2] || "AshDemo");
  fs.writeFileSync(path.join(OUT, name), text);
  const mp = path.join(OUT, "manifest.json");
  const man = JSON.parse(fs.readFileSync(mp, "utf8"));
  man.files = man.files.filter((f) => !/_\d{8}_\d{6}\.csv$/.test(f));
  man.files.push(name);
  fs.writeFileSync(mp, JSON.stringify(man, null, 2) + "\n");
  console.log(`wrote sample-export/${name} (${text.length} chars) and registered it in manifest.json`);
}
