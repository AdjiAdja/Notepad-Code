// Server dev lokal: file statis (+ _headers, termasuk CSP) dan /api memakai skema D1 yang sama di atas node:sqlite.
// Login Google nyata tidak tersedia di sini; gunakan "DEV LOGIN" (hanya localhost, DEV_LOGIN=1).
// Jalankan:  node --experimental-sqlite scripts/dev-server.mjs   (PORT=8788 default)
import http from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { extname, join, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { makeD1 } from './d1-shim.mjs';
import { onRequest } from '../functions/api/[[path]].js';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const PORT = Number(process.env.PORT || 8788);
await mkdir(join(ROOT, '.dev'), { recursive: true });
const env = { DB: makeD1(process.env.DB_FILE || join(ROOT, '.dev/malude.sqlite')), SESSION_SECRET: 'dev-secret-only-for-localhost-0123456789', GOOGLE_CLIENT_ID: 'dev', DEV_LOGIN: '1' };

const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.mp4': 'video/mp4', '.webmanifest': 'application/manifest+json', '.txt': 'text/plain' };

// parser _headers sederhana: blok "/pola" diikuti baris "  Nama: nilai"
const rules = [];
{
  let cur = null;
  for (const line of (await readFile(join(ROOT, '_headers'), 'utf8')).split('\n')) {
    if (!line.trim()) continue;
    if (!/^\s/.test(line)) { cur = { pat: line.trim(), h: {} }; rules.push(cur); }
    else { const i = line.indexOf(':'); cur.h[line.slice(0, i).trim()] = line.slice(i + 1).trim(); }
  }
}
const matches = (pat, path) => pat === '/*' || (pat.endsWith('/*') ? path.startsWith(pat.slice(0, -1)) : pat === path);
const headersFor = (path) => Object.assign({}, ...rules.filter((r) => matches(r.pat, path)).map((r) => r.h));
// HSTS tidak berguna (dan merusak) di http://localhost
const applyHeaders = (path, extra = {}) => { const h = headersFor(path); delete h['Strict-Transport-Security']; return { ...h, ...extra }; };

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, `http://localhost:${PORT}`);
    if (url.pathname.startsWith('/api/')) {
      const chunks = []; for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const request = new Request(url, { method: req.method, headers: req.headers, body: ['GET', 'HEAD'].includes(req.method) ? undefined : body });
      const r = await onRequest({ request, env, params: { path: url.pathname.slice(5).split('/').filter(Boolean) } });
      const h = applyHeaders(url.pathname); r.headers.forEach((v, k) => (h[k] = v));
      const sc = r.headers.getSetCookie?.(); if (sc?.length) h['set-cookie'] = sc;
      res.writeHead(r.status, h); res.end(Buffer.from(await r.arrayBuffer())); return;
    }
    let p = decodeURIComponent(url.pathname); if (p === '/') p = '/index.html';
    if (p === '/config.js') { res.writeHead(200, applyHeaders(p, { 'content-type': TYPES['.js'], 'cache-control': 'no-store' })); res.end('window.APP={googleClientId:"",devLogin:true};'); return; }
    const file = normalize(join(ROOT, p));
    if (!file.startsWith(ROOT) || /(^|[\\/])(\.dev|node_modules|functions|scripts|tests|\.git)([\\/]|$)/.test(file.slice(ROOT.length)) || !existsSync(file)) { res.writeHead(404, { 'content-type': 'text/plain' }); res.end('Tidak ditemukan'); return; }
    res.writeHead(200, applyHeaders(p, { 'content-type': TYPES[extname(file)] || 'application/octet-stream' }));
    res.end(await readFile(file));
  } catch (e) { console.error(e); res.writeHead(500); res.end('Kesalahan server dev'); }
}).listen(PORT, () => console.log(`Malude dev: http://localhost:${PORT}  (DEV LOGIN aktif, DB: .dev/malude.sqlite)`));
