// Cloudflare Pages Function: login Google, workspace, peran, undangan, sinkron delta, audit.
// Binding/variabel: DB (D1), GOOGLE_CLIENT_ID, SESSION_SECRET, opsional ALLOWED_DOMAINS ("a.com,b.co.id").
//
// Prinsip keamanan:
//  - Token Google diverifikasi di server (aud, iss, exp, email_verified) lalu ditukar cookie sesi HttpOnly bertanda tangan HMAC.
//  - Setiap permintaan yang mengubah data wajib: Origin sama + header x-requested-with: malude (anti-CSRF).
//  - Peran (viewer < editor < admin < owner) ditegakkan di server, bukan hanya di UI.
//  - Workspace bervault: server hanya menyimpan ciphertext; passphrase tidak pernah meninggalkan browser.

const enc = new TextEncoder();
const dec = new TextDecoder();
const RANK = { viewer: 1, editor: 2, admin: 3, owner: 4 };
const ID = /^[a-z0-9]{8,40}$/;
const MAX_DATA = 900_000, MAX_BATCH = 40, PULL_LIMIT = 200, SESSION_DAYS = 30, INVITE_DAYS = 7;

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
const bad = (m = 'Permintaan tidak valid') => new HttpError(400, m);

const b64u = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64u = (s) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
const hmacKey = (env) => crypto.subtle.importKey('raw', enc.encode(env.SESSION_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']);

async function sign(env, payload) {
  const body = b64u(enc.encode(JSON.stringify(payload)));
  return body + '.' + b64u(await crypto.subtle.sign('HMAC', await hmacKey(env), enc.encode(body)));
}
async function verify(env, token) {
  if (!token) return null;
  const [body, sig] = token.split('.');
  if (!body || !sig) return null;
  try {
    if (!(await crypto.subtle.verify('HMAC', await hmacKey(env), unb64u(sig), enc.encode(body)))) return null;
    const p = JSON.parse(dec.decode(unb64u(body)));
    return p.exp > Date.now() / 1000 ? p : null;
  } catch { return null; }
}
const sha = async (s) => [...new Uint8Array(await crypto.subtle.digest('SHA-256', enc.encode(s)))].map((b) => b.toString(16).padStart(2, '0')).join('');

const isLocal = (url) => url.hostname === 'localhost' || url.hostname === '127.0.0.1';
const cookieName = (url) => (isLocal(url) ? 'sid' : '__Host-sid');
const cookie = (url, v, maxAge) => `${cookieName(url)}=${v}; HttpOnly; ${isLocal(url) ? '' : 'Secure; '}SameSite=Strict; Path=/; Max-Age=${maxAge}`;

const json = (obj, status = 200, headers = {}) => new Response(JSON.stringify(obj), {
  status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...headers },
});

async function readJson(request) {
  const t = await request.text();
  if (t.length > 4_000_000) throw new HttpError(413, 'Permintaan terlalu besar');
  try { return t ? JSON.parse(t) : {}; } catch { throw bad('JSON tidak valid'); }
}

const INV = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
function newCode() {
  const b = crypto.getRandomValues(new Uint8Array(20));
  return [...b].map((x) => INV[x % 32]).join('').replace(/(.{5})(?=.)/g, '$1-');
}
const normCode = (c) => String(c || '').toUpperCase().replace(/[^A-Z2-9]/g, '');

function validVault(v) {
  return v && typeof v.salt === 'string' && Number.isInteger(v.iter) && v.iter >= 100000 && v.iter <= 5_000_000 &&
    v.check && typeof v.check.iv === 'string' && typeof v.check.ct === 'string' && JSON.stringify(v).length < 2000;
}

export async function onRequest({ request, env, params }) {
  try {
    return await handle(request, env, params);
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message }, e.status);
    console.error(e);
    return json({ error: 'Kesalahan server' }, 500);
  }
}

async function handle(request, env, params) {
  const url = new URL(request.url);
  const seg = [].concat(params.path || []);
  const m = request.method;
  if (!env.DB || !env.SESSION_SECRET || !env.GOOGLE_CLIENT_ID) throw new HttpError(500, 'Server belum dikonfigurasi (DB, SESSION_SECRET, GOOGLE_CLIENT_ID)');

  if (m !== 'GET' && m !== 'HEAD') {
    const origin = request.headers.get('origin');
    if (origin && origin !== url.origin) throw new HttpError(403, 'Origin ditolak');
    if (request.headers.get('x-requested-with') !== 'malude') throw new HttpError(403, 'Header keamanan tidak ada');
  }

  if (seg[0] === 'login' && m === 'POST') return login(request, env, url);
  if (seg[0] === 'logout' && m === 'POST') return json({ ok: true }, 200, { 'set-cookie': cookie(url, '', 0) });

  const cookies = request.headers.get('cookie') || '';
  const sid = cookies.match(new RegExp('(?:^|;\\s*)' + cookieName(url) + '=([^;]+)'))?.[1];
  const s = await verify(env, sid);
  if (!s) throw new HttpError(401, 'Belum login');
  const me = { sub: s.sub, name: s.name, email: s.email, pic: s.pic };

  if (seg[0] === 'me' && m === 'GET') return json({ user: me });
  if (seg[0] === 'join' && m === 'POST') return join(request, env, me);
  if (seg[0] !== 'ws') throw new HttpError(404, 'Tidak ditemukan');

  if (seg.length === 1) {
    if (m === 'GET') return listWs(env, me);
    if (m === 'POST') return createWs(request, env, me);
    throw new HttpError(405, 'Metode tidak diizinkan');
  }
  const wsId = seg[1];
  if (!ID.test(wsId)) throw bad('ID workspace tidak valid');
  const row = await env.DB.prepare('SELECT m.role AS role, w.* FROM members m JOIN workspaces w ON w.id = m.ws WHERE m.ws = ?1 AND m.sub = ?2').bind(wsId, me.sub).first();
  if (!row) throw new HttpError(404, 'Workspace tidak ditemukan');
  const need = (r) => { if (RANK[row.role] < RANK[r]) throw new HttpError(403, 'Peran Anda tidak cukup untuk aksi ini'); };

  const sub = seg[2];
  if (!sub) {
    if (m === 'PATCH') return patchWs(request, env, me, row, need);
    if (m === 'DELETE') { need('owner'); return deleteWs(env, row); }
  }
  if (sub === 'sync' && m === 'POST') return sync(request, env, me, row, need);
  if (sub === 'members') {
    if (!seg[3] && m === 'GET') return listMembers(env, row);
    if (seg[3] && m === 'PATCH') return setRole(request, env, me, row, seg[3], need);
    if (seg[3] && m === 'DELETE') return removeMember(env, me, row, seg[3]);
  }
  if (sub === 'invite' && m === 'POST') { need('admin'); return invite(request, env, me, row); }
  if (sub === 'audit' && m === 'GET') {
    need('admin');
    const lim = Math.min(200, Math.max(1, parseInt(url.searchParams.get('limit')) || 100));
    const { results } = await env.DB.prepare('SELECT id, sub, email, action, detail, t FROM audit WHERE ws = ?1 ORDER BY id DESC LIMIT ?2').bind(wsId, lim).all();
    return json({ audit: results });
  }
  throw new HttpError(404, 'Tidak ditemukan');
}

const audit = (env, ws, me, action, detail = '') =>
  env.DB.prepare('INSERT INTO audit (ws, sub, email, action, detail, t) VALUES (?1,?2,?3,?4,?5,?6)').bind(ws, me.sub, me.email || '', action, String(detail).slice(0, 300), Date.now());

/* ---------- login ---------- */
async function login(request, env, url) {
  const { credential } = await readJson(request);
  if (typeof credential !== 'string' || !credential) throw bad('credential kosong');
  let t;
  if (credential.startsWith('dev:') && env.DEV_LOGIN === '1' && isLocal(url)) {
    // Hanya untuk pengembangan lokal (host localhost + DEV_LOGIN=1). Tidak pernah aktif di produksi.
    const [, email, name] = credential.split(':');
    t = { sub: 'dev-' + (email || 'user').replace(/[^a-z0-9]/gi, '').toLowerCase(), email, name: name || email, email_verified: 'true', picture: '' };
  } else {
    let r;
    try { r = await fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(credential)); }
    catch { throw new HttpError(502, 'Tidak dapat menghubungi Google untuk verifikasi'); }
    if (!r.ok) throw new HttpError(401, 'Token Google tidak valid');
    t = await r.json();
    const issOk = t.iss === 'accounts.google.com' || t.iss === 'https://accounts.google.com';
    if (t.aud !== env.GOOGLE_CLIENT_ID || !issOk || !(Number(t.exp) > Date.now() / 1000) || !t.sub) throw new HttpError(401, 'Token Google tidak valid');
  }
  if (String(t.email_verified) !== 'true' || !t.email) throw new HttpError(403, 'Email Google belum terverifikasi');
  const allowed = String(env.ALLOWED_DOMAINS || '').toLowerCase().split(',').map((x) => x.trim()).filter(Boolean);
  const domain = String(t.email).toLowerCase().split('@')[1];
  if (allowed.length && !allowed.includes(domain)) throw new HttpError(403, 'Domain email tidak diizinkan di instalasi ini');
  const user = { sub: t.sub, name: t.name || t.email, email: t.email, pic: t.picture || '' };
  const exp = Math.floor(Date.now() / 1000) + SESSION_DAYS * 86400;
  const token = await sign(env, { ...user, exp, iat: Math.floor(Date.now() / 1000) });
  return json({ user }, 200, { 'set-cookie': cookie(url, token, SESSION_DAYS * 86400) });
}

/* ---------- workspace ---------- */
const vaultOf = (r) => { try { return r.vault ? JSON.parse(r.vault) : null; } catch { return null; } };

async function listWs(env, me) {
  const { results } = await env.DB.prepare(
    `SELECT w.id, w.name, w.kind, w.vault, w.domain, m.role,
            (SELECT COUNT(*) FROM members WHERE ws = w.id) AS members
     FROM members m JOIN workspaces w ON w.id = m.ws WHERE m.sub = ?1 ORDER BY w.created`).bind(me.sub).all();
  return json({ workspaces: results.map((r) => ({ ...r, vault: vaultOf(r) })) });
}

async function createWs(request, env, me) {
  const b = await readJson(request);
  if (!ID.test(b.id || '')) throw bad('ID tidak valid');
  const name = String(b.name || '').trim().slice(0, 80);
  if (!name) throw bad('Nama wajib diisi');
  if (!['personal', 'team'].includes(b.kind)) throw bad('Jenis tidak valid');
  if (b.vault != null && !validVault(b.vault)) throw bad('Metadata vault tidak valid');
  const domain = b.domain ? String(b.domain).toLowerCase().trim().slice(0, 100) : null;
  if (domain && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(domain)) throw bad('Domain tidak valid');
  const owned = await env.DB.prepare("SELECT COUNT(*) AS c FROM members WHERE sub = ?1 AND role = 'owner'").bind(me.sub).first();
  if (owned.c >= 20) throw new HttpError(429, 'Batas 20 workspace per pemilik tercapai');
  if (await env.DB.prepare('SELECT 1 AS x FROM workspaces WHERE id = ?1').bind(b.id).first()) throw new HttpError(409, 'ID sudah dipakai');
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT INTO workspaces (id, name, kind, owner, vault, domain, created) VALUES (?1,?2,?3,?4,?5,?6,?7)').bind(b.id, name, b.kind, me.sub, b.vault ? JSON.stringify(b.vault) : null, domain, now),
    env.DB.prepare("INSERT INTO members (ws, sub, email, name, role, added) VALUES (?1,?2,?3,?4,'owner',?5)").bind(b.id, me.sub, me.email, me.name, now),
    audit(env, b.id, me, 'workspace.create', name),
  ]);
  return json({ id: b.id, role: 'owner' }, 201);
}

async function patchWs(request, env, me, row, need) {
  const b = await readJson(request);
  const stmts = [], log = [];
  if (b.name != null) { need('admin'); const n = String(b.name).trim().slice(0, 80); if (!n) throw bad('Nama kosong'); stmts.push(env.DB.prepare('UPDATE workspaces SET name = ?1 WHERE id = ?2').bind(n, row.id)); log.push('nama'); }
  if (b.domain !== undefined) {
    need('owner');
    const d = b.domain ? String(b.domain).toLowerCase().trim() : null;
    if (d && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(d)) throw bad('Domain tidak valid');
    stmts.push(env.DB.prepare('UPDATE workspaces SET domain = ?1 WHERE id = ?2').bind(d, row.id)); log.push('domain');
  }
  if (b.vault !== undefined) {
    need('owner');
    if (!validVault(b.vault)) throw bad('Metadata vault tidak valid');
    stmts.push(env.DB.prepare('UPDATE workspaces SET vault = ?1 WHERE id = ?2').bind(JSON.stringify(b.vault), row.id)); log.push('vault');
  }
  if (!stmts.length) throw bad('Tidak ada perubahan');
  stmts.push(audit(env, row.id, me, 'workspace.update', log.join(', ')));
  await env.DB.batch(stmts);
  return json({ ok: true });
}

async function deleteWs(env, row) {
  await env.DB.batch(['nodes', 'members', 'invites', 'audit'].map((t) => env.DB.prepare(`DELETE FROM ${t} WHERE ws = ?1`).bind(row.id))
    .concat(env.DB.prepare('DELETE FROM workspaces WHERE id = ?1').bind(row.id)));
  return json({ ok: true });
}

/* ---------- sinkron delta (last-write-wins per node) ---------- */
async function sync(request, env, me, row, need) {
  const b = await readJson(request);
  const since = Number.isInteger(b.since) && b.since >= 0 ? b.since : 0;
  const incoming = Array.isArray(b.nodes) ? b.nodes : [];
  if (incoming.length > MAX_BATCH) throw bad('Maksimal ' + MAX_BATCH + ' node per permintaan');
  const now = Date.now();
  const stmts = [];
  for (const n of incoming) {
    if (!n || !ID.test(n.id || '') || !['file', 'folder'].includes(n.type)) throw bad('Node tidak valid');
    if (n.parent != null && !ID.test(n.parent)) throw bad('Parent tidak valid');
    if (!Number.isFinite(n.u) || n.u <= 0) throw bad('Waktu tidak valid');
    const data = n.del ? null : n.data;
    if (!n.del && (typeof data !== 'string' || data.length > MAX_DATA)) throw new HttpError(413, 'Data node terlalu besar (maks. 900 KB)');
    if (data) { try { JSON.parse(data); } catch { throw bad('Data node bukan JSON'); } }
    stmts.push(env.DB.prepare(
      `INSERT INTO nodes (ws, id, parent, type, u, del, data, seq)
       VALUES (?1,?2,?3,?4,?5,?6,?7,(SELECT COALESCE(MAX(seq),0)+1 FROM nodes WHERE ws = ?1))
       ON CONFLICT (ws, id) DO UPDATE SET parent = excluded.parent, type = excluded.type, u = excluded.u, del = excluded.del, data = excluded.data, seq = excluded.seq
       WHERE excluded.u > nodes.u`).bind(row.id, n.id, n.parent ?? null, n.type, Math.min(Math.floor(n.u), now + 300000), n.del ? 1 : 0, data));
  }
  let accepted = 0, deleted = 0;
  if (stmts.length) {
    need('editor');
    const res = await env.DB.batch(stmts);
    res.forEach((r, i) => { if (r.meta?.changes) { accepted++; if (incoming[i].del) deleted++; } });
    if (accepted) await env.DB.batch([audit(env, row.id, me, 'sync.push', `${accepted} perubahan${deleted ? `, ${deleted} dihapus` : ''}`)]);
  }
  const { results } = await env.DB.prepare('SELECT id, parent, type, u, del, data, seq FROM nodes WHERE ws = ?1 AND seq > ?2 ORDER BY seq LIMIT ?3').bind(row.id, since, PULL_LIMIT).all();
  const cursor = results.length ? results[results.length - 1].seq : since;
  return json({ nodes: results, cursor, more: results.length === PULL_LIMIT, accepted, role: row.role, name: row.name, vault: vaultOf(row) });
}

/* ---------- anggota, undangan ---------- */
async function listMembers(env, row) {
  const { results } = await env.DB.prepare('SELECT sub, email, name, role, added FROM members WHERE ws = ?1 ORDER BY added').bind(row.id).all();
  return json({ members: results, domain: row.domain, kind: row.kind });
}

async function setRole(request, env, me, row, target, need) {
  need('admin');
  const { role } = await readJson(request);
  if (!['viewer', 'editor', 'admin'].includes(role)) throw bad('Peran tidak valid');
  const t = await env.DB.prepare('SELECT role, email FROM members WHERE ws = ?1 AND sub = ?2').bind(row.id, target).first();
  if (!t) throw new HttpError(404, 'Anggota tidak ditemukan');
  if (t.role === 'owner') throw new HttpError(403, 'Peran pemilik tidak dapat diubah');
  if (target === me.sub) throw new HttpError(403, 'Tidak bisa mengubah peran sendiri');
  if ((role === 'admin' || t.role === 'admin') && row.role !== 'owner') throw new HttpError(403, 'Hanya pemilik yang boleh mengatur admin');
  await env.DB.batch([
    env.DB.prepare('UPDATE members SET role = ?1 WHERE ws = ?2 AND sub = ?3').bind(role, row.id, target),
    audit(env, row.id, me, 'member.role', `${t.email}: ${t.role} -> ${role}`),
  ]);
  return json({ ok: true });
}

async function removeMember(env, me, row, target) {
  const t = await env.DB.prepare('SELECT role, email FROM members WHERE ws = ?1 AND sub = ?2').bind(row.id, target).first();
  if (!t) throw new HttpError(404, 'Anggota tidak ditemukan');
  if (t.role === 'owner') throw new HttpError(403, 'Pemilik tidak dapat dikeluarkan');
  const self = target === me.sub;
  if (!self) {
    if (RANK[row.role] < RANK.admin) throw new HttpError(403, 'Peran Anda tidak cukup');
    if (t.role === 'admin' && row.role !== 'owner') throw new HttpError(403, 'Hanya pemilik yang boleh mengeluarkan admin');
  }
  await env.DB.batch([
    env.DB.prepare('DELETE FROM members WHERE ws = ?1 AND sub = ?2').bind(row.id, target),
    audit(env, row.id, me, self ? 'member.leave' : 'member.remove', t.email),
  ]);
  return json({ ok: true });
}

async function invite(request, env, me, row) {
  if (row.kind !== 'team') throw new HttpError(400, 'Undangan hanya untuk workspace tim');
  const { role = 'editor', email = null } = await readJson(request);
  if (!['viewer', 'editor', 'admin'].includes(role)) throw bad('Peran tidak valid');
  if (role === 'admin' && row.role !== 'owner') throw new HttpError(403, 'Hanya pemilik yang boleh mengundang admin');
  const em = email ? String(email).trim().toLowerCase() : null;
  if (em && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(em)) throw bad('Email tidak valid');
  const now = Date.now();
  const open = await env.DB.prepare('SELECT COUNT(*) AS c FROM invites WHERE ws = ?1 AND exp > ?2').bind(row.id, now).first();
  if (open.c >= 50) throw new HttpError(429, 'Terlalu banyak undangan aktif');
  const code = newCode();
  const exp = now + INVITE_DAYS * 86400000;
  await env.DB.batch([
    env.DB.prepare('DELETE FROM invites WHERE ws = ?1 AND exp < ?2').bind(row.id, now),
    env.DB.prepare('INSERT INTO invites (hash, ws, role, email, exp, by) VALUES (?1,?2,?3,?4,?5,?6)').bind(await sha(normCode(code)), row.id, role, em, exp, me.sub),
    audit(env, row.id, me, 'invite.create', `${role}${em ? ' untuk ' + em : ''}`),
  ]);
  return json({ code, exp, role });
}

async function join(request, env, me) {
  const { code } = await readJson(request);
  const hash = await sha(normCode(code));
  const inv = await env.DB.prepare('SELECT * FROM invites WHERE hash = ?1').bind(hash).first();
  if (!inv || inv.exp < Date.now()) throw new HttpError(404, 'Kode undangan tidak valid atau kedaluwarsa');
  if (inv.email && inv.email !== String(me.email).toLowerCase()) throw new HttpError(403, 'Undangan ini untuk email lain');
  const ws = await env.DB.prepare('SELECT * FROM workspaces WHERE id = ?1').bind(inv.ws).first();
  if (!ws) throw new HttpError(404, 'Workspace tidak ditemukan');
  if (ws.domain && String(me.email).toLowerCase().split('@')[1] !== ws.domain) throw new HttpError(403, 'Workspace ini hanya untuk email @' + ws.domain);
  const already = await env.DB.prepare('SELECT role FROM members WHERE ws = ?1 AND sub = ?2').bind(ws.id, me.sub).first();
  if (!already) {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO members (ws, sub, email, name, role, added) VALUES (?1,?2,?3,?4,?5,?6)').bind(ws.id, me.sub, me.email, me.name, inv.role, Date.now()),
      env.DB.prepare('DELETE FROM invites WHERE hash = ?1').bind(hash),
      audit(env, ws.id, me, 'member.join', `${me.email} sebagai ${inv.role}`),
    ]);
  }
  return json({ id: ws.id, role: already?.role || inv.role });
}
