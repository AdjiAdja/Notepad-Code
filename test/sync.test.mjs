import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';
import { makeD1 } from '../scripts/d1-shim.mjs';
import { onRequest } from '../functions/api/[[path]].js';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };
const env = { DB: makeD1(), SESSION_SECRET: 'y'.repeat(40), GOOGLE_CLIENT_ID: 'cid', DEV_LOGIN: '1' };
let cookie = '';
globalThis.fetch = async (url, init = {}) => {
  const u = new URL(url, 'http://localhost:8788');
  const headers = new Headers(init.headers); if (cookie) headers.set('cookie', cookie); headers.set('origin', u.origin);
  const res = await onRequest({ request: new Request(u, { ...init, headers }), env, params: { path: u.pathname.replace(/^\/api\//, '').split('/') } });
  const sc = res.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return res;
};
const { Store } = await import('../src/js/store.js');
const { Sync } = await import('../src/js/sync.js');
const { api } = await import('../src/js/api.js');
const DBm = await import('../src/js/db.js');

async function client(email) {
  cookie = '';
  await api('/login', { method: 'POST', body: { credential: `dev:${email}:${email}` } });
  const c = { cookie, s: new Store() };
  await c.s.init('c' + email.replace(/\W/g, ''));
  c.y = new Sync(c.s); c.y.enabled = true;
  c.run = async () => { cookie = c.cookie; await c.y.pullWorkspaces(); for (const w of c.s.wss.filter((x) => x.remote)) await c.y.syncWs(w); };
  return c;
}

test('dua pengguna: buat tim, undang, sinkron dua arah, hapus, konflik', async () => {
  const A = await client('a@x.com'), B = await client('b@x.com');
  cookie = A.cookie;
  const ws = await A.y.createRemote({ name: 'Tim Backend', kind: 'team' });
  await A.s.openWs(ws.id);
  const f = await A.s.create({ name: 'README.md', content: '# halo' });
  await A.run();
  assert.equal((await DBm.get(A.s.db, 'nodes', f.id)).d, 0, 'tidak lagi kotor setelah dorong');
  const inv = await api('/ws/' + ws.id + '/invite', { method: 'POST', body: { role: 'editor' } });
  cookie = B.cookie;
  await api('/join', { method: 'POST', body: { code: inv.code } });
  await B.run();
  await B.s.openWs(ws.id);
  assert.equal(B.s.wsOf(ws.id).role, 'editor');
  const bf = [...B.s.nodes.values()].find((n) => n.name === 'README.md');
  assert.equal(bf.content, '# halo');
  // B edit, A tarik
  bf.content = '# halo dari B'; await B.s.save(bf); await B.run();
  await A.run();
  assert.equal(A.s.nodes.get(f.id).content, '# halo dari B');
  // konflik: A dan B edit offline, B dorong dulu
  const af = A.s.nodes.get(f.id);
  af.content = 'versi A'; await A.s.save(af);
  await new Promise((r) => setTimeout(r, 10));
  bf.content = 'versi B'; await B.s.save(bf); await B.run();
  await A.run();
  assert.equal(A.s.nodes.get(f.id).content, 'versi B', 'LWW: yang terbaru menang');
  await new Promise((r) => setTimeout(r, 5));
  const copy = [...A.s.nodes.values()].find((n) => /konflik/.test(n.name));
  if (copy) assert.equal(copy.content, 'versi A');
  // hapus
  await B.s.remove(bf.id); await B.run(); await A.run();
  assert.ok(!A.s.nodes.has(f.id));
});

test('vault tim: server hanya melihat ciphertext, anggota lain sinkron lalu membuka dengan passphrase', async () => {
  const A = await client('p@x.com'), B = await client('q@x.com');
  cookie = A.cookie;
  const ws = await A.y.createRemote({ name: 'Rahasia Tim', kind: 'team', pass: 'passphrase-tim-12345' });
  await A.s.openWs(ws.id);
  await A.s.create({ name: '.env', content: 'DB_PASS=sangat-rahasia-999' });
  await A.run();
  const rows = env.DB.raw.prepare('SELECT data FROM nodes WHERE ws=?').all(ws.id);
  assert.ok(rows.length && rows.every((r) => !r.data.includes('sangat-rahasia') && !r.data.includes('.env')));
  const inv = await api('/ws/' + ws.id + '/invite', { method: 'POST', body: { role: 'viewer' } });
  cookie = B.cookie; await api('/join', { method: 'POST', body: { code: inv.code } });
  await B.run(); await B.s.openWs(ws.id);
  assert.equal(B.s.locked, true);
  await assert.rejects(B.s.unlock('salah'));
  await B.s.unlock('passphrase-tim-12345');
  assert.equal([...B.s.nodes.values()][0].content, 'DB_PASS=sangat-rahasia-999');
  assert.equal(B.s.readonly, true);
});

test('rahasia pada workspace tim tanpa vault ditahan lokal', async () => {
  const A = await client('r@x.com');
  cookie = A.cookie;
  const ws = await A.y.createRemote({ name: 'Terbuka', kind: 'team' });
  await A.s.openWs(ws.id);
  await A.s.create({ name: 'k.txt', content: 'AWS=AKIAIOSFODNN7EXAMPLE' });
  await A.s.create({ name: 'ok.txt', content: 'aman' });
  await A.run();
  const rows = env.DB.raw.prepare('SELECT data FROM nodes WHERE ws=?').all(ws.id);
  assert.equal(rows.length, 1);
  assert.ok(!rows[0].data.includes('AKIA'));
});

test('enableSync menaikkan workspace pribadi ke server', async () => {
  const A = await client('s@x.com');
  cookie = A.cookie;
  await A.s.create({ name: 'catatan.md', content: 'lama' });
  await A.y.enableSync(A.s.ws);
  await A.run();
  const n = env.DB.raw.prepare('SELECT COUNT(*) c FROM nodes WHERE ws=?').get(A.s.ws.id).c;
  assert.equal(n, 1);
});
