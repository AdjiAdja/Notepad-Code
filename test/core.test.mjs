import test from 'node:test';
import assert from 'node:assert/strict';
import { diffLines, uniqueName, sanitizeName, kindOf, extOf, langOf, pathOf, resolvePath, findByName } from '../src/js/tree.js';
import { createVault, unlockVault, seal, open, sealBytes, openBytes, strength } from '../src/js/vault.js';
import { makeZip, readZip, crc32, safeZipPath } from '../src/js/zip.js';
import { renderMd, toggleTask } from '../src/js/md.js';
import { highlight } from '../src/js/highlight.js';
import { scan } from '../src/js/secrets.js';

test('tree: nama unik dan sanitasi', () => {
  assert.equal(uniqueName(new Set(['a.md']), 'a.md'), 'a (2).md');
  assert.equal(uniqueName(new Set(['A.md', 'a (2).md']), 'a.md'), 'a (3).md');
  assert.equal(uniqueName(new Set(), 'x'), 'x');
  assert.equal(sanitizeName('a/b:c*.md'), 'a-b-c-.md');
  assert.equal(sanitizeName('..'), 'tanpa-nama');
  assert.equal(sanitizeName('  '), 'tanpa-nama');
  assert.equal(sanitizeName('.env'), '.env');
});

test('tree: jenis berkas dan bahasa', () => {
  assert.equal(kindOf('README.md'), 'md');
  assert.equal(kindOf('app.ts'), 'code');
  assert.equal(langOf('app.ts'), 'typescript');
  assert.equal(kindOf('logo.png'), 'image');
  assert.equal(kindOf('x.pdf'), 'pdf');
  assert.equal(kindOf('data.bin', '', false), 'bin');
  assert.equal(extOf('.env.local'), 'env');
  assert.equal(langOf('Dockerfile'), 'docker');
});

test('tree: path dan resolusi', () => {
  const m = new Map();
  m.set('a', { id: 'a', parent: null, name: 'docs', type: 'folder' });
  m.set('b', { id: 'b', parent: 'a', name: 'Guide.md', type: 'file' });
  assert.equal(pathOf(m, 'b'), '/docs/Guide.md');
  assert.equal(resolvePath(m, '/DOCS/guide.md').id, 'b');
  assert.equal(resolvePath(m, '/nope'), null);
  assert.equal(findByName(m, 'guide').id, 'b');
  assert.equal(findByName(m, 'docs/Guide.md').id, 'b');
});

test('diffLines', () => {
  const d = diffLines('a\nb\nc', 'a\nx\nc\nd');
  assert.deepEqual(d.map((x) => x.t + x.s), ['=a', '-b', '+x', '=c', '+d']);
  assert.deepEqual(diffLines('same', 'same'), [{ t: '=', s: 'same' }]);
});

test('vault: enkripsi, passphrase salah, AAD', async () => {
  const { key, meta } = await createVault('kata-sandi-panjang', 1000);
  const k2 = await unlockVault('kata-sandi-panjang', meta);
  const s = await seal(key, { x: 1 }, 'ws:1');
  assert.deepEqual(await open(k2, s, 'ws:1'), { x: 1 });
  await assert.rejects(unlockVault('salah', meta));
  await assert.rejects(open(key, s, 'ws:2'), 'AAD berbeda harus gagal');
  const b = await sealBytes(key, new Uint8Array([1, 2, 3]), 'b');
  assert.deepEqual([...(await openBytes(key, b, 'b'))], [1, 2, 3]);
  assert.ok(strength('abc') < strength('Contoh-Kata-Sandi-Yang-Panjang-123!'));
});

test('zip: roundtrip dan keamanan', async () => {
  const te = new TextEncoder();
  const z = makeZip([
    { path: 'a/', data: new Uint8Array(0) },
    { path: 'a/hello.txt', data: te.encode('halo dunia') },
    { path: 'b.md', data: te.encode('# judul') },
  ]);
  const files = await readZip(z);
  assert.deepEqual(files.map((f) => f.path).sort(), ['a/hello.txt', 'b.md']);
  assert.equal(new TextDecoder().decode(files.find((f) => f.path === 'b.md').data), '# judul');
  assert.equal(crc32(te.encode('123456789')), 0xcbf43926);
  assert.equal(safeZipPath('../x'), null);
  assert.equal(safeZipPath('/abs/y.txt'), 'abs/y.txt');
  const bad = makeZip([{ path: '../evil.txt', data: te.encode('x') }]);
  await assert.rejects(readZip(bad));
  await assert.rejects(readZip(z, { bytes: 3, files: 10 }));
});

test('zip: membaca arsip deflate buatan sistem', async () => {
  const { execFileSync } = await import('node:child_process');
  const { mkdtempSync, writeFileSync, readFileSync } = await import('node:fs');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const d = mkdtempSync(join(tmpdir(), 'zt-'));
  writeFileSync(join(d, 'f.txt'), 'x'.repeat(5000) + ' isi');
  try { execFileSync('zip', ['-q', '-j', join(d, 'o.zip'), join(d, 'f.txt')]); } catch { return; }
  const files = await readZip(readFileSync(join(d, 'o.zip')));
  assert.equal(files[0].path, 'f.txt');
  assert.ok(new TextDecoder().decode(files[0].data).endsWith(' isi'));
});

test('markdown: aman dari XSS dan fitur dasar', () => {
  const r = renderMd('# Judul\n\n<script>alert(1)</script> **tebal** `kode<b>`\n\n- [ ] satu\n- [x] dua\n\n[x](javascript:alert(1)) [ok](https://a.com)\n\n[[Catatan]]\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```js\nconst a = 1;\n```');
  assert.ok(!r.html.includes('<script>'));
  assert.ok(r.html.includes('&lt;script&gt;'));
  assert.ok(!/href="javascript:/i.test(r.html));
  assert.ok(r.html.includes('href="https://a.com"'));
  assert.ok(r.html.includes('data-wiki="Catatan"'));
  assert.ok(r.html.includes('<table>'));
  assert.ok(r.html.includes('tk-k'));
  assert.deepEqual(r.tasks, { done: 1, total: 2 });
  assert.equal(r.toc[0].text, 'Judul');
  assert.equal(toggleTask('- [ ] a\n- [x] b', 0), '- [x] a\n- [x] b');
  assert.equal(toggleTask('- [ ] a\n- [x] b', 1), '- [ ] a\n- [ ] b');
});

test('highlight: escape dan token', () => {
  const h = highlight('const s = "<b>"; // hai', 'javascript');
  assert.ok(h.includes('<span class="tk-k">const</span>'));
  assert.ok(h.includes('&lt;b&gt;'));
  assert.ok(h.includes('tk-c'));
  assert.equal(highlight('<x>', 'plaintext'), '&lt;x&gt;');
  assert.ok(highlight('{"a": 1}', 'json').includes('tk-a'));
  assert.ok(highlight('<div class="a">x</div>', 'html').includes('tk-t'));
});

test('secrets: deteksi pola umum', () => {
  assert.equal(scan('halo\nAWS=AKIAABCDEFGHIJKLMNOP').length, 1);
  assert.equal(scan('-----BEGIN RSA PRIVATE KEY-----')[0].type, 'Kunci privat');
  assert.equal(scan('password = "supersecret123"').length, 1);
  assert.equal(scan('tidak ada apa-apa di sini').length, 0);
});
