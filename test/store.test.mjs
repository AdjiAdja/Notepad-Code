import 'fake-indexeddb/auto';
import test from 'node:test';
import assert from 'node:assert/strict';

const mem = new Map();
globalThis.localStorage = { getItem: (k) => mem.get(k) ?? null, setItem: (k, v) => mem.set(k, String(v)), removeItem: (k) => mem.delete(k) };

const { Store } = await import('../src/js/store.js');
const { readZip } = await import('../src/js/zip.js');
const te = new TextEncoder();
let n = 0;
const fresh = async () => { const s = new Store(); await s.init('t' + ++n); return s; };

test('buat pohon, nama unik, pindah, duplikat, hapus', async () => {
  const s = await fresh();
  const f = await s.create({ type: 'folder', name: 'docs' });
  const a = await s.create({ parent: f.id, name: 'a.md', content: '# a' });
  const a2 = await s.create({ parent: f.id, name: 'a.md', content: 'dua' });
  assert.equal(a2.name, 'a (2).md');
  assert.equal(s.path(a.id), '/docs/a.md');
  const g = await s.create({ type: 'folder', name: 'src' });
  await s.move(a.id, g.id);
  assert.equal(s.path(a.id), '/src/a.md');
  await assert.rejects(s.move(g.id, g.id));
  const inner = await s.create({ parent: g.id, type: 'folder', name: 'in' });
  await assert.rejects(s.move(g.id, inner.id), /dirinya sendiri/);
  const dup = await s.duplicate(g.id);
  assert.equal(dup.name, 'src salinan');
  assert.equal(s.children(dup.id).length, 2);
  await s.remove(g.id);
  assert.ok(!s.nodes.has(a.id) && !s.nodes.has(inner.id));
  // persist & reload
  const s2 = new Store();
  s2.keys.clear();
  await s2.init('t' + n);
  assert.ok([...s2.nodes.values()].some((x) => x.name === 'docs'));
  assert.ok(![...s2.nodes.values()].some((x) => x.name === 'src'), 'tombstone tidak dimuat');
  assert.equal([...s2.nodes.values()].filter((x) => x.name === 'in').length, 1, 'hanya salinan yang tersisa');
});

test('riwayat versi, snapshot, dedupe, batas', async () => {
  const s = await fresh();
  const f = await s.create({ name: 'x.md', content: 'satu' });
  assert.equal(await s.snapshot(f, 'v1'), true);
  assert.equal(await s.snapshot(f, 'dup'), false);
  f.content = 'dua'; s.touch(f);
  assert.equal(await s.snapshot(f, 'v2'), true);
  assert.deepEqual(f.hist.map((h) => h.c), ['satu', 'dua']);
  for (let i = 0; i < 40; i++) { f.content = 'c' + i; await s.snapshot(f, 'm'); }
  assert.ok(f.hist.length <= 30);
  clearTimeout(f._snap);
});

test('vault: enkripsi at-rest, kunci, buka, salah passphrase, ganti passphrase', async () => {
  const s = await fresh();
  const ws = await s.createWs({ name: 'Rahasia', pass: 'passphrase-uji-1' });
  await s.openWs(ws.id);
  assert.equal(s.locked, false);
  const f = await s.create({ name: 'secret.env', content: 'TOKEN=abc123456789' });
  await s.flush();
  const { nodesOf } = await import('../src/js/db.js');
  const raw = (await nodesOf(s.db, ws.id))[0];
  assert.ok(raw.sealed && raw.content === undefined && raw.name === undefined, 'tidak ada plaintext');
  assert.ok(!JSON.stringify(raw).includes('abc123456789'));
  await s.lock();
  assert.equal(s.locked, true);
  assert.equal(s.nodes.size, 0);
  await assert.rejects(s.unlock('salah-passphrase'));
  await s.unlock('passphrase-uji-1');
  assert.equal([...s.nodes.values()][0].content, 'TOKEN=abc123456789');
  await s.changePass('passphrase-uji-1', 'passphrase-baru-22');
  await s.lock();
  await assert.rejects(s.unlock('passphrase-uji-1'));
  await s.unlock('passphrase-baru-22');
  assert.equal([...s.nodes.values()][0].name, 'secret.env');
  void f;
});

test('aktifkan vault pada workspace berisi data', async () => {
  const s = await fresh();
  await s.create({ name: 'a.txt', content: 'rahasia lama' });
  await s.enableVault('vault-dadakan-123');
  await s.lock();
  await s.unlock('vault-dadakan-123');
  assert.equal([...s.nodes.values()][0].content, 'rahasia lama');
  const { nodesOf } = await import('../src/js/db.js');
  const raw = (await nodesOf(s.db, s.ws.id))[0];
  assert.ok(raw.sealed && !raw.content);
});

test('pencarian grep dan regex', async () => {
  const s = await fresh();
  await s.create({ name: 'a.js', content: 'const x = 1;\nfunction hello(){}' });
  await s.create({ name: 'b.md', content: 'tidak relevan' });
  assert.equal(s.search('hello').length, 1);
  assert.equal(s.search('hello')[0].hits[0].line, 2);
  assert.equal(s.search('^const', { regex: true }).length, 1);
  assert.equal(s.search('HELLO', { cs: true }).length, 0);
  assert.throws(() => s.search('(', { regex: true }));
});

test('ZIP ekspor lalu impor mempertahankan struktur dan blob', async () => {
  const s = await fresh();
  const d = await s.create({ type: 'folder', name: 'proj' });
  const sub = await s.create({ parent: d.id, type: 'folder', name: 'lib' });
  await s.create({ parent: sub.id, name: 'm.js', content: 'export const a = 1;' });
  await s.create({ parent: d.id, name: 'p.png', blob: new Blob([new Uint8Array([137, 80, 78, 71, 0, 1, 2])], { type: 'image/png' }), mime: 'image/png', textual: false });
  const blob = await s.exportZip(d.id);
  const entries = await readZip(new Uint8Array(await blob.arrayBuffer()));
  assert.deepEqual(entries.map((e) => e.path).sort(), ['proj/lib/m.js', 'proj/p.png']);
  const s2 = await fresh();
  const c = await s2.importZip(null, new Uint8Array(await blob.arrayBuffer()));
  assert.equal(c, 2);
  const m = [...s2.nodes.values()].find((x) => x.name === 'm.js');
  assert.equal(s2.path(m.id), '/proj/lib/m.js');
  assert.equal(m.content, 'export const a = 1;');
  const p = [...s2.nodes.values()].find((x) => x.name === 'p.png');
  assert.equal(p.kind, 'image');
  assert.equal(p.size, 7);
});

test('peran viewer tidak bisa menulis', async () => {
  const s = await fresh();
  s.ws.role = 'viewer';
  await assert.rejects(s.create({ name: 'x.md' }), /hanya baca/);
});

test('cadangan mentah roundtrip (vault tetap terenkripsi)', async () => {
  const s = await fresh();
  const ws = await s.createWs({ name: 'B', pass: 'cadangan-passphrase-1' });
  await s.openWs(ws.id);
  await s.create({ name: 'n.md', content: 'isi penting' });
  const blob = await s.exportBackup();
  const txt = await blob.text();
  assert.ok(!txt.includes('isi penting'));
  await s.deleteWs(ws.id);
  const back = await s.importBackup(txt);
  await s.openWs(back.id);
  await s.unlock('cadangan-passphrase-1');
  assert.equal([...s.nodes.values()][0].content, 'isi penting');
});
