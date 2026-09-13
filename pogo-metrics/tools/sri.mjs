/* sri.mjs — keeps a subresource-integrity hash on every vendor file the site loads.
 *
 *   node tools/sri.mjs           list every vendor reference and whether its hash is current
 *   node tools/sri.mjs --write   fix every stale or missing value in place
 *
 * Why this exists: sw.js serves /vendor/ cache-first and netlify.toml marks it
 * immutable for a year, so a copy that went bad in either cache would keep
 * running for as long as it stayed there. With a sha384 on the tag, the
 * browser refuses any bytes but the ones committed here.
 *
 * What it covers:
 *   • every <script src="vendor/…"> and <link rel="stylesheet" href="vendor/…">
 *     in the site's pages. Font preloads are skipped: the fonts are fetched by
 *     fonts.css, and fonts.css itself is covered. og-card*.html are left out on
 *     purpose: they are render sources for the share images and may be opened
 *     straight from disk, where Chrome refuses every integrity check (a file://
 *     response is never CORS-eligible), so the card would lose its fonts.
 *   • VENDOR_SRI in js/app.js, the one map ensureScript and ensureCSS read for
 *     the libraries loaded on demand. --write rebuilds it from the vendor paths
 *     those two functions are called with, in the order they first appear.
 *
 * Run it after adding or upgrading anything in vendor/. tools/test-parsers.mjs
 * imports scan() and check() and fails when a value is missing or stale.
 * Without --write this exits 1 when anything needs fixing.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.resolve(HERE, "..");
const APP = "js/app.js";
// the map body sits between the opening brace and a "};" alone on its line
const MAP_RE = /(const VENDOR_SRI = \{)([\s\S]*?)(\n\};)/;
const LOAD_RE = /ensure(?:Script|CSS)\(\s*"(vendor\/[^"]+)"/g;
// render sources for the share images, which carry no hash (see the top)
const EXEMPT = /^og-card.*\.html$/;

/** sha384 of a file under the site root, in the form an integrity attribute takes. */
export function sri(rel) {
  return "sha384-" + crypto.createHash("sha384").update(fs.readFileSync(path.join(ROOT, rel))).digest("base64");
}

// "/vendor/x", "vendor/x" and "vendor/x?v=1" all name the same file
function vendorPath(url) {
  const p = String(url || "").replace(/^\.?\//, "").split(/[?#]/)[0];
  return p.startsWith("vendor/") ? p : null;
}
function attr(tag, name) {
  const m = new RegExp(`\\s${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)')`, "i").exec(tag);
  return m ? (m[1] ?? m[2]) : null;
}
const lineAt = (text, i) => text.slice(0, i).split("\n").length;

/** Every vendor script and stylesheet reference, with the integrity it carries now. */
export function scan() {
  const refs = [];
  for (const page of fs.readdirSync(ROOT).filter((f) => f.endsWith(".html") && !EXEMPT.test(f)).sort()) {
    const text = fs.readFileSync(path.join(ROOT, page), "utf8");
    for (const m of text.matchAll(/<(script|link)\b[^>]*>/gi)) {
      const tag = m[0], script = m[1].toLowerCase() === "script";
      if (!script && !/(^|\s)stylesheet(\s|$)/i.test(attr(tag, "rel") || "")) continue;
      const p = vendorPath(attr(tag, script ? "src" : "href"));
      if (!p) continue;
      refs.push({ file: page, line: lineAt(text, m.index), kind: script ? "script" : "stylesheet",
        path: p, integrity: attr(tag, "integrity"), at: m.index, tag });
    }
  }
  const app = fs.readFileSync(path.join(ROOT, APP), "utf8");
  const block = MAP_RE.exec(app);
  const map = {};
  if (block) for (const m of block[2].matchAll(/"(vendor\/[^"]+)"\s*:\s*"([^"]*)"/g)) map[m[1]] = m[2];
  const loads = [];
  for (const m of app.matchAll(LOAD_RE)) {
    if (loads.includes(m[1])) continue;
    loads.push(m[1]);
    refs.push({ file: APP, line: lineAt(app, m.index), kind: "on demand", path: m[1], integrity: map[m[1]] ?? null });
  }
  return { refs, map, loads, hasMap: !!block };
}

/** What is wrong, one line per problem. Empty when every hash is current. */
export function check({ refs, map, loads, hasMap }) {
  const out = [];
  if (!hasMap) out.push(`${APP}: no VENDOR_SRI map found`);
  for (const r of refs) {
    const where = `${r.file}:${r.line} ${r.path}`;
    if (!fs.existsSync(path.join(ROOT, r.path))) out.push(`${where}: the file does not exist`);
    else if (!r.integrity) out.push(`${where}: no integrity value`);
    else if (r.integrity !== sri(r.path)) out.push(`${where}: the integrity value does not match the file`);
  }
  for (const p of Object.keys(map)) if (!loads.includes(p)) out.push(`${APP}: VENDOR_SRI lists ${p}, which nothing loads`);
  return out;
}

/** Bring every value in line with the files on disk. Returns what changed. */
function write({ refs, loads }) {
  const changed = [];
  const pages = {};
  for (const r of refs) if (r.file !== APP) (pages[r.file] = pages[r.file] || []).push(r);
  for (const [file, list] of Object.entries(pages)) {
    const full = path.join(ROOT, file);
    const before = fs.readFileSync(full, "utf8");
    let text = before;
    // last tag first, so the offsets of the ones above it still hold
    for (const r of list.sort((a, b) => b.at - a.at)) {
      if (!fs.existsSync(path.join(ROOT, r.path))) continue;
      const want = sri(r.path);
      if (r.integrity === want) continue;
      const tag = r.integrity != null
        ? r.tag.replace(/(\sintegrity\s*=\s*)(?:"[^"]*"|'[^']*')/i, `$1"${want}"`)
        : r.tag.replace(new RegExp(`(\\s${r.kind === "script" ? "src" : "href"}\\s*=\\s*(?:"[^"]*"|'[^']*'))`, "i"), `$1 integrity="${want}"`);
      text = text.slice(0, r.at) + tag + text.slice(r.at + r.tag.length);
      changed.push(`${file}:${r.line} ${r.path}`);
    }
    if (text !== before) fs.writeFileSync(full, text);
  }
  const appFile = path.join(ROOT, APP);
  const app = fs.readFileSync(appFile, "utf8");
  if (!MAP_RE.test(app)) throw new Error(`${APP} has no VENDOR_SRI map to fill — add "const VENDOR_SRI = {\\n};" above ensureScript first`);
  const body = loads.filter((p) => fs.existsSync(path.join(ROOT, p))).map((p) => `\n  "${p}": "${sri(p)}",`).join("");
  const next = app.replace(MAP_RE, (_, open, _old, close) => open + body + close);
  if (next !== app) { fs.writeFileSync(appFile, next); changed.push(`${APP} VENDOR_SRI`); }
  return changed;
}

function main() {
  let state = scan();
  if (process.argv.includes("--write")) {
    const changed = write(state);
    console.log(changed.length ? `\n  updated ${changed.length}:\n${changed.map((c) => "    " + c).join("\n")}` : "\n  nothing to update");
    state = scan();
  }
  const byPath = {};
  for (const r of state.refs) (byPath[r.path] = byPath[r.path] || []).push(r);
  console.log("");
  for (const [p, list] of Object.entries(byPath).sort()) {
    const exists = fs.existsSync(path.join(ROOT, p));
    const want = exists ? sri(p) : null;
    console.log(`  ${p}\n    ${want || "(file not found)"}`);
    for (const r of list) {
      const status = !exists ? "no file" : !r.integrity ? "missing" : r.integrity === want ? "ok" : "stale";
      console.log(`    ${status.padEnd(8)}${(r.file + ":" + r.line).padEnd(26)}${r.kind}`);
    }
  }
  const problems = check(state);
  console.log(problems.length
    ? `\n  ${problems.length} to fix:\n${problems.map((x) => "    " + x).join("\n")}\n\n  run: node tools/sri.mjs --write\n`
    : `\n  every vendor reference carries a current sha384\n`);
  process.exit(problems.length ? 1 : 0);
}

const self = fs.realpathSync(fileURLToPath(import.meta.url));
if (process.argv[1] && fs.existsSync(process.argv[1]) && fs.realpathSync(process.argv[1]) === self) main();
