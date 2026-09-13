// Tiny static file server for previewing the built sites (Node — the system
// python3 is gated behind an unaccepted Xcode license on this machine).
//
//   node static-server.mjs <root> [port]
//
// It sends the same security headers netlify.toml sets on the live site, so a
// local preview runs under the real Content-Security-Policy — a CSP break shows
// up here first, not after a deploy. It answers only requests addressed to
// localhost or 127.0.0.1 on its own port (a DNS-rebinding page can't borrow it),
// and a malformed path is a 400, never a crash.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(process.argv[2] || '/tmp/pogo-site');
const PORT = +(process.argv[3] || 8753);
const MIME = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8', '.geojson': 'application/json; charset=utf-8',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8', '.xml': 'application/xml; charset=utf-8',
  '.tsv': 'text/tab-separated-values; charset=utf-8', '.csv': 'text/csv; charset=utf-8',
};

// Mirrors the /* block in netlify.toml — keep the two in step.
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; "
  + "font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";
const SECURITY = {
  'Content-Security-Policy': CSP,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), fullscreen=(self)',
  'Cross-Origin-Opener-Policy': 'same-origin',
};
// Cross-Origin-Resource-Policy, rule for rule as netlify.toml sets it: same-origin
// on the site's own asset folders, cross-origin on the share images, and none
// on anything else, so no path gets the header twice.
function corp(u) {
  if (/^\/(js|css|vendor|data|sample-export)\//.test(u)) return { 'Cross-Origin-Resource-Policy': 'same-origin' };
  if (/^\/og-image[^/]*\.png$/.test(u)) return { 'Cross-Origin-Resource-Policy': 'cross-origin' };
  return {};
}
const HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
if (PORT === 80) { HOSTS.add('localhost'); HOSTS.add('127.0.0.1'); }

function send(res, status, body, headers = {}) {
  res.writeHead(status, { ...SECURITY, 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'no-cache', ...headers });
  res.end(body);
}

http.createServer((req, res) => {
  if (!HOSTS.has(String(req.headers.host || '').toLowerCase())) return send(res, 403, 'forbidden');
  let u;
  try { u = decodeURIComponent(String(req.url || '/').split('?')[0]); } catch (e) { return send(res, 400, 'bad request'); }
  if (u.includes('\0')) return send(res, 400, 'bad request');
  if (u.endsWith('/')) u += 'index.html';
  const f = path.join(ROOT, path.normalize(u));
  if (f !== ROOT && !f.startsWith(ROOT + path.sep)) return send(res, 403, 'forbidden');
  fs.readFile(f, (e, d) => {
    if (e) return send(res, 404, '404 ' + u);
    const type = MIME[path.extname(f).toLowerCase()] || 'application/octet-stream';
    send(res, 200, d, { 'Content-Type': type, ...corp(u) });
  });
}).listen(PORT, '127.0.0.1', () => console.log(`serving ${ROOT} on http://127.0.0.1:${PORT}`));
