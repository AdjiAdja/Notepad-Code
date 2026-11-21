import test from 'node:test';
import assert from 'node:assert/strict';
import { makeD1 } from '../scripts/d1-shim.mjs';
import { onRequest } from '../functions/api/[[path]].js';

const env = { DB: makeD1(), SESSION_SECRET: 'x'.repeat(40), GOOGLE_CLIENT_ID: 'cid', DEV_LOGIN: '1' };
const ORIGIN = 'http://localhost:8788';

async function call(method, path, { body, cookie, headers = {} } = {}) {
  const seg = path.replace(/^\/api\//, '').split('/').filter(Boolean);
  const req = new Request(ORIGIN + path, {
    method, body: body ? JSON.stringify(body) : undefined,
    headers: { origin: ORIGIN, 'x-requested-with': 'malude', ...(cookie ? { cookie } : {}), ...headers },
  });
  const res = await onRequest({ request: req, env, params: { path: seg } });
  const j = await res.json().catch(() => ({}));
  return { status: res.status, j, setCookie: res.headers.get('set-cookie') };
}
async function login(email, name = email) {
  const r = await call('POST', '/api/login', { body: { credential: `dev:${email}:${name}` } });
  assert.equal(r.status, 200);
  return r.setCookie.split(';')[0];
}
const node = (id, u, extra = {}) => ({ id, parent: null, type: 'file', u, data: JSON.stringify({ name: id }), ...extra });
const WS = 'wsteam0001', WP = 'wspers0001';

test('login, cookie HttpOnly, /me, tanpa cookie 401', async () => {
  const r = await call('POST', '/api/login', { body: { credential: 'dev:a@x.com:A' } });
  assert.match(r.setCookie, /HttpOnly/); assert.match(r.setCookie, /SameSite=Strict/);
  assert.equal((await call('GET', '/api/me', { cookie: r.setCookie.split(';')[0] })).j.user.email, 'a@x.com');
  assert.equal((await call('GET', '/api/me')).status, 401);
  assert.equal((await call('POST', '/api/login', { body: { credential: 'dev:a@x.com' }, headers: { 'x-requested-with': '' } })).status, 403);
  assert.equal((await call('POST', '/api/login', { body: { credential: 'dev:a@x.com' }, headers: { origin: 'https://evil.com' } })).status, 403);
  const realFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{"error":"invalid_token"}', { status: 400 });
  try { assert.equal((await call('POST', '/api/login', { body: { credential: 'palsu' } })).status, 401); } finally { globalThis.fetch = realFetch; }
  globalThis.fetch = async () => { throw new Error('offline'); };
  try { assert.equal((await call('POST', '/api/login', { body: { credential: 'palsu' } })).status, 502); } finally { globalThis.fetch = realFetch; }
});

test('cookie dirusak ditolak', async () => {
  const c = await login('a@x.com');
  assert.equal((await call('GET', '/api/me', { cookie: c.slice(0, -3) + 'abc' })).status, 401);
});

test('workspace tim: buat, sinkron LWW, tombstone, delta', async () => {
  const A = await login('a@x.com');
  assert.equal((await call('POST', '/api/ws', { cookie: A, body: { id: WS, name: 'Tim', kind: 'team' } })).status, 201);
  assert.equal((await call('POST', '/api/ws', { cookie: A, body: { id: WS, name: 'Dup', kind: 'team' } })).status, 409);
  let r = await call('POST', `/api/ws/${WS}/sync`, { cookie: A, body: { since: 0, nodes: [node('node00001', 100), node('node00002', 100)] } });
  assert.equal(r.j.accepted, 2); assert.equal(r.j.nodes.length, 2);
  // yang lebih lama kalah
  r = await call('POST', `/api/ws/${WS}/sync`, { cookie: A, body: { since: r.j.cursor, nodes: [node('node00001', 50, { data: '{"name":"lama"}' })] } });
  assert.equal(r.j.accepted, 0);
  // yang lebih baru menang & muncul di delta
  r = await call('POST', `/api/ws/${WS}/sync`, { cookie: A, body: { since: r.j.cursor, nodes: [node('node00001', 200, { data: '{"name":"baru"}' })] } });
  assert.equal(r.j.accepted, 1); assert.equal(r.j.nodes.length, 1);
  assert.equal(JSON.parse(r.j.nodes[0].data).name, 'baru');
  // tombstone
  r = await call('POST', `/api/ws/${WS}/sync`, { cookie: A, body: { since: r.j.cursor, nodes: [{ id: 'node00002', type: 'file', u: 300, del: 1 }] } });
  assert.equal(r.j.nodes[0].del, 1); assert.equal(r.j.nodes[0].data, null);
  // validasi
  assert.equal((await call('POST', `/api/ws/${WS}/sync`, { cookie: A, body: { nodes: [node('../x', 1)] } })).status, 400);
  assert.equal((await call('POST', `/api/ws/${WS}/sync`, { cookie: A, body: { nodes: [node('node00009', 1, { data: 'bukan json' })] } })).status, 400);
  assert.equal((await call('POST', `/api/ws/${WS}/sync`, { cookie: A, body: { nodes: Array.from({ length: 41 }, (_, i) => node('n' + String(i).padStart(8, '0'), 1)) } })).status, 400);
  assert.equal((await call('POST', `/api/ws/${WS}/sync`, { cookie: A, body: { nodes: [node('node00009', 1, { data: JSON.stringify({ c: 'x'.repeat(950000) }) })] } })).status, 413);
});

test('undangan, peran, isolasi antar workspace', async () => {
  const A = await login('a@x.com'), B = await login('b@x.com'), C = await login('c@x.com');
  const inv = await call('POST', `/api/ws/${WS}/invite`, { cookie: A, body: { role: 'viewer' } });
  assert.equal(inv.status, 200);
  assert.equal((await call('POST', '/api/join', { cookie: B, body: { code: 'SALAH-SALAH' } })).status, 404);
  assert.equal((await call('POST', '/api/join', { cookie: B, body: { code: inv.j.code.toLowerCase() } })).j.role, 'viewer');
  // kode sekali pakai
  assert.equal((await call('POST', '/api/join', { cookie: C, body: { code: inv.j.code } })).status, 404);
  // viewer: bisa tarik, tidak bisa dorong, tidak bisa undang/audit
  assert.equal((await call('POST', `/api/ws/${WS}/sync`, { cookie: B, body: { since: 0, nodes: [] } })).status, 200);
  assert.equal((await call('POST', `/api/ws/${WS}/sync`, { cookie: B, body: { nodes: [node('node00005', 5)] } })).status, 403);
  assert.equal((await call('POST', `/api/ws/${WS}/invite`, { cookie: B, body: {} })).status, 403);
  assert.equal((await call('GET', `/api/ws/${WS}/audit`, { cookie: B })).status, 403);
  // non-anggota tidak tahu workspace itu ada
  assert.equal((await call('POST', `/api/ws/${WS}/sync`, { cookie: C, body: { nodes: [] } })).status, 404);
  // owner naikkan peran B ke editor, lalu B bisa menulis; B tidak bisa menjadikan diri admin
  const members = (await call('GET', `/api/ws/${WS}/members`, { cookie: A })).j.members;
  const bsub = members.find((m) => m.email === 'b@x.com').sub;
  assert.equal((await call('PATCH', `/api/ws/${WS}/members/${bsub}`, { cookie: A, body: { role: 'editor' } })).status, 200);
  assert.equal((await call('POST', `/api/ws/${WS}/sync`, { cookie: B, body: { nodes: [node('node00005', 5)] } })).j.accepted, 1);
  assert.equal((await call('PATCH', `/api/ws/${WS}/members/${bsub}`, { cookie: B, body: { role: 'admin' } })).status, 403);
  // owner tak bisa dikeluarkan / dihapus workspace oleh non-owner
  const asub = members.find((m) => m.email === 'a@x.com').sub;
  assert.equal((await call('DELETE', `/api/ws/${WS}/members/${asub}`, { cookie: B })).status, 403);
  assert.equal((await call('DELETE', `/api/ws/${WS}`, { cookie: B })).status, 403);
  const au = (await call('GET', `/api/ws/${WS}/audit`, { cookie: A })).j.audit;
  assert.ok(au.some((x) => x.action === 'member.join') && au.some((x) => x.action === 'member.role'));
});

test('undangan terikat email dan domain', async () => {
  const A = await login('a@x.com');
  await call('PATCH', `/api/ws/${WS}`, { cookie: A, body: { domain: 'kantor.co.id' } });
  const inv = await call('POST', `/api/ws/${WS}/invite`, { cookie: A, body: { role: 'editor' } });
  assert.equal((await call('POST', '/api/join', { cookie: await login('d@gmail.com'), body: { code: inv.j.code } })).status, 403);
  const inv2 = await call('POST', `/api/ws/${WS}/invite`, { cookie: A, body: { role: 'editor', email: 'orang@kantor.co.id' } });
  assert.equal((await call('POST', '/api/join', { cookie: await login('lain@kantor.co.id'), body: { code: inv2.j.code } })).status, 403);
  assert.equal((await call('POST', '/api/join', { cookie: await login('orang@kantor.co.id'), body: { code: inv2.j.code } })).status, 200);
  // kode disimpan sebagai hash
  const rows = env.DB.raw.prepare('SELECT hash FROM invites').all();
  assert.ok(rows.every((r) => !inv.j.code.replace(/-/g, '').includes(r.hash) && r.hash.length === 64));
});

test('workspace pribadi dengan vault: server hanya simpan metadata', async () => {
  const A = await login('a@x.com');
  const vault = { salt: 'abc', iter: 600000, check: { iv: 'x', ct: 'y' } };
  assert.equal((await call('POST', '/api/ws', { cookie: A, body: { id: WP, name: 'P', kind: 'personal', vault } })).status, 201);
  assert.equal((await call('POST', '/api/ws', { cookie: A, body: { id: 'wsbadvault', name: 'P', kind: 'personal', vault: { salt: 's', iter: 1 } } })).status, 400);
  const list = (await call('GET', '/api/ws', { cookie: A })).j.workspaces;
  assert.deepEqual(list.find((w) => w.id === WP).vault, vault);
  assert.ok(!JSON.stringify(list).includes('passphrase'));
});

test('hapus workspace oleh owner membersihkan semuanya', async () => {
  const A = await login('a@x.com');
  assert.equal((await call('DELETE', `/api/ws/${WS}`, { cookie: A })).status, 200);
  for (const t of ['nodes', 'members', 'invites', 'audit']) assert.equal(env.DB.raw.prepare(`SELECT COUNT(*) c FROM ${t} WHERE ws='${WS}'`).get().c, 0);
});

test('DEV_LOGIN mati di luar localhost / tanpa flag', async () => {
  const req = new Request('https://app.example.com/api/login', { method: 'POST', body: JSON.stringify({ credential: 'dev:a@x.com:A' }), headers: { origin: 'https://app.example.com', 'x-requested-with': 'malude' } });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('{}', { status: 400 });
  try {
    const res = await onRequest({ request: req, env, params: { path: ['login'] } });
    assert.equal(res.status, 401);
  } finally { globalThis.fetch = originalFetch; }
});
