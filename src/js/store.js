// Store: workspace, pohon berkas, vault, riwayat versi. Tanpa DOM; bisa diuji di Node (fake-indexeddb).
//
// Model data (runtime):  node = { id, ws, parent, type:'file'|'folder', name, kind, lang, content, blob, mime,
//                                 star, hist:[{t,c,m,a}], size, c(created), u(updated), d(dirty/sync) }
// Record tersimpan:      plain  -> kolom terbuka
//                        vault  -> { id, ws, parent, type, u, c, d, sealed:{iv,ct}, hs?, bs? } (nama, isi, riwayat, blob terenkripsi)

import * as DB from './db.js';
import { uid, toB64 } from './util.js';
import { kindOf, langOf, uniqueName, sanitizeName, pathOf, descendants, cmp, TEMPLATES } from './tree.js';
import { createVault, unlockVault, seal, open as openSealed, sealBytes, openBytes } from './vault.js';
import { makeZip, readZip, ZIP_LIMITS } from './zip.js';
import { scan } from './secrets.js';

const te = new TextEncoder();
const MAX_HIST = 30, SNAP_MS = 300000, TOMB_DAYS = 45, MAX_UPLOAD = 25 * 1024 * 1024;
const hsize = (h) => h.reduce((a, x) => a + x.c.length, 0);

export function decodeText(u8) {
  try {
    const s = new TextDecoder('utf-8', { fatal: true }).decode(u8);
    return s.includes('\u0000') ? null : s;
  } catch { return null; }
}

export class Store {
  constructor() {
    this.h = {};
    this.db = null; this.scope = null;
    this.wss = []; this.ws = null;
    this.nodes = new Map();
    this.keys = new Map();
    this.locked = false; this.partial = false;
    this.active = 'root'; this.tabs = []; this.expanded = new Set(['root']);
    this.settings = { blockSecrets: true };
    this._dirty = new Set();
  }

  on(e, f) { (this.h[e] ??= new Set()).add(f); return () => this.h[e].delete(f); }
  emit(e, d) { (this.h[e] || []).forEach((f) => { try { f(d); } catch (x) { console.error(x); } }); }

  /* ---------- inisialisasi ---------- */
  async init(scope) {
    await this.flush();
    if (this.db) this.db.close();
    this.scope = scope;
    this.db = await DB.open(scope);
    this.keys.clear();
    this.wss = await DB.all(this.db, 'ws');
    if (!this.wss.length) await this.createWs({ name: 'Personal', kind: 'personal', silent: true });
    await this.purgeTombs();
    const last = localStorage.getItem('mni.ws.' + scope);
    await this.openWs((this.wss.find((w) => w.id === last) || this.wss[0]).id);
  }

  wsOf(id) { return this.wss.find((w) => w.id === id); }
  get readonly() { return this.ws?.role === 'viewer'; }

  async purgeTombs() {
    const cut = Date.now() - TOMB_DAYS * 864e5;
    for (const w of this.wss) {
      if (w.remote) continue; // tombstone ws remote dibersihkan setelah sinkron stabil
      for (const r of await DB.nodesOf(this.db, w.id)) if (r.del && r.u < cut) await DB.del(this.db, 'nodes', r.id);
    }
  }

  /* ---------- workspace ---------- */
  async createWs({ name, kind = 'personal', pass = null, remote = false, id = uid(), role = 'owner', vault = null, cursor = 0, silent = false }) {
    const ws = { id, name: String(name || 'Workspace').trim().slice(0, 80) || 'Workspace', kind, remote, role, vault, cursor, created: Date.now() };
    if (pass) {
      const v = await createVault(pass);
      ws.vault = v.meta;
      this.keys.set(id, v.key);
    }
    await DB.put(this.db, 'ws', ws);
    this.wss.push(ws);
    if (!silent) this.emit('wss');
    return ws;
  }

  async saveWs(ws) { await DB.put(this.db, 'ws', ws); this.emit('wss'); }

  async openWs(id) {
    await this.flush();
    const ws = this.wsOf(id);
    if (!ws) return;
    this.ws = ws;
    localStorage.setItem('mni.ws.' + this.scope, id);
    this.nodes = new Map();
    this.active = 'root'; this.tabs = []; this.expanded = new Set(['root']);
    this.locked = !!ws.vault && !this.keys.has(id);
    this.partial = false;
    if (!this.locked) await this.hydrateAll();
    this.emit('ws');
  }

  async renameWs(ws, name) { ws.name = name.trim().slice(0, 80) || ws.name; await this.saveWs(ws); this.emit('ws'); }

  async deleteWs(id) {
    await this.flush();
    await DB.delWs(this.db, id);
    this.wss = this.wss.filter((w) => w.id !== id);
    this.keys.delete(id);
    if (!this.wss.length) await this.createWs({ name: 'Personal', kind: 'personal', silent: true });
    if (this.ws?.id === id) await this.openWs(this.wss[0].id); else this.emit('wss');
  }

  /* ---------- (de)hidrasi ---------- */
  async hydrate(r) {
    const key = this.keys.get(r.ws);
    let core, hist = [], blob = null;
    if (r.sealed) {
      if (!key) return null;
      try {
        const aad = r.ws + ':' + r.id;
        core = await openSealed(key, r.sealed, aad);
        if (r.hs) hist = await openSealed(key, r.hs, aad + ':h');
        if (r.bs) blob = new Blob([await openBytes(key, r.bs, aad + ':b')], { type: core.mime || '' });
      } catch { this.partial = true; return null; }
    } else {
      core = { name: r.name, kind: r.kind, lang: r.lang, content: r.content, star: r.star, mime: r.mime };
      hist = r.hist || [];
      blob = r.blob || null;
    }
    const content = core.content || '';
    return {
      id: r.id, ws: r.ws, parent: r.parent ?? null, type: r.type, u: r.u, c: r.c || r.u, d: r.d || 0,
      name: core.name || 'tanpa-nama', kind: core.kind || (r.type === 'folder' ? 'folder' : 'text'),
      lang: core.lang || 'plaintext', content, star: !!core.star, mime: core.mime || '', hist, blob,
      size: blob ? blob.size : content.length,
    };
  }

  async hydrateAll() {
    const raw = await DB.nodesOf(this.db, this.ws.id);
    this.nodes = new Map();
    this.partial = false;
    for (const r of raw) {
      if (r.del) continue;
      const n = await this.hydrate(r);
      if (n) this.nodes.set(n.id, n);
    }
    for (const n of this.nodes.values()) if (n.parent && !this.nodes.has(n.parent)) n.parent = null; // yatim -> root
  }

  async dehydrate(n, deleted = false) {
    const base = { id: n.id, ws: n.ws, parent: n.parent, type: n.type, u: n.u, c: n.c, d: n.d, del: deleted ? 1 : 0 };
    if (deleted) return base;
    const ws = this.wsOf(n.ws);
    const core = { name: n.name, kind: n.kind, lang: n.lang, content: n.content, star: n.star ? 1 : 0, mime: n.mime };
    if (ws.vault) {
      const key = this.keys.get(n.ws);
      if (!key) throw new Error('Vault terkunci');
      const aad = n.ws + ':' + n.id;
      base.sealed = await seal(key, core, aad);
      if (n.hist.length) base.hs = await seal(key, n.hist, aad + ':h');
      if (n.blob) base.bs = await sealBytes(key, new Uint8Array(await n.blob.arrayBuffer()), aad + ':b');
      return base;
    }
    base.x = ws.remote && n.type === 'file' && n.kind !== 'image' && this.settings.blockSecrets && scan(n.content).length ? 1 : 0;
    return { ...base, ...core, hist: n.hist, blob: n.blob || undefined };
  }

  /* ---------- simpan ---------- */
  assertWritable() { if (this.readonly) throw new Error('Peran Anda di workspace ini: hanya baca'); }

  async save(n, deleted = false) {
    n.u = Math.max(Date.now(), (n.u || 0) + 1);
    const ws = this.wsOf(n.ws);
    if (ws.remote && !n.blob) n.d = 1;
    await DB.put(this.db, 'nodes', await this.dehydrate(n, deleted));
    this.emit('saved', n);
  }

  touch(n) {
    this.assertWritable();
    n.size = n.content.length;
    this._dirty.add(n.id);
    clearTimeout(this._t);
    this._t = setTimeout(() => this.flush(), 500);
    if (!n._snap) n._snap = setTimeout(() => { n._snap = 0; this.snapshot(n, 'Autosave', true); }, SNAP_MS);
    this.emit('edit', n);
  }

  async flush() {
    clearTimeout(this._t);
    const ids = [...this._dirty];
    this._dirty.clear();
    for (const id of ids) {
      const n = this.nodes.get(id);
      if (n) await this.save(n);
    }
  }

  async snapshot(n, msg = 'Versi manual', auto = false) {
    if (n._snap) { clearTimeout(n._snap); n._snap = 0; }
    if (n.type !== 'file' || n.blob || n.kind === 'image') return false;
    const last = n.hist[n.hist.length - 1];
    if (last && last.c === n.content) return false;
    n.hist.push({ t: Date.now(), c: n.content, m: msg, a: auto ? 1 : 0 });
    while (n.hist.length > MAX_HIST || hsize(n.hist) > 2e6) n.hist.shift();
    await this.save(n);
    this.emit('hist', n);
    return true;
  }

  /* ---------- pohon ---------- */
  children(parent) {
    const p = parent === 'root' ? null : parent;
    const out = [];
    for (const n of this.nodes.values()) if ((n.parent ?? null) === p) out.push(n);
    return out.sort(cmp);
  }

  siblings(parent, except) {
    return new Set(this.children(parent ?? 'root').filter((n) => n.id !== except).map((n) => n.name));
  }

  path(id) { return id === 'root' || !id ? '/' : pathOf(this.nodes, id); }

  /** Folder tujuan untuk berkas baru berdasarkan seleksi aktif (id folder atau null untuk root). */
  get cwd() {
    if (this.active === 'root') return null;
    const n = this.nodes.get(this.active);
    if (!n) return null;
    return n.type === 'folder' ? n.id : n.parent;
  }

  async create({ parent = null, type = 'file', name, content = '', blob = null, mime = '', textual = true, kind, open = false }) {
    this.assertWritable();
    if (parent === 'root') parent = null;
    const nm = uniqueName(this.siblings(parent), sanitizeName(name || (type === 'folder' ? 'folder-baru' : 'catatan.md')));
    const n = {
      id: uid(), ws: this.ws.id, parent, type, name: nm,
      kind: type === 'folder' ? 'folder' : kind || kindOf(nm, mime, textual),
      lang: langOf(nm), content, star: false, mime, hist: [], blob, size: blob ? blob.size : content.length,
      c: Date.now(), u: Date.now(), d: 0,
    };
    this.nodes.set(n.id, n);
    await this.save(n);
    if (parent) this.expanded.add(parent);
    this.emit('tree');
    if (open) this.open(n.id);
    return n;
  }

  async rename(id, name) {
    this.assertWritable();
    const n = this.nodes.get(id);
    if (!n) return;
    n.name = uniqueName(this.siblings(n.parent, id), sanitizeName(name));
    if (n.type === 'file' && n.kind !== 'legacy') { n.kind = kindOf(n.name, n.mime, !n.blob); n.lang = langOf(n.name); }
    await this.save(n);
    this.emit('tree');
  }

  async move(id, parent) {
    this.assertWritable();
    if (parent === 'root') parent = null;
    const n = this.nodes.get(id);
    if (!n || (n.parent ?? null) === parent) return false;
    if (parent && (parent === id || descendants(this.nodes, id).includes(parent))) throw new Error('Tidak bisa memindahkan folder ke dalam dirinya sendiri');
    n.parent = parent;
    n.name = uniqueName(this.siblings(parent, id), n.name);
    await this.save(n);
    if (parent) this.expanded.add(parent);
    this.emit('tree');
    return true;
  }

  async duplicate(id) {
    this.assertWritable();
    const copy = async (nid, parent, first) => {
      const s = this.nodes.get(nid);
      const n = {
        ...s, id: uid(), parent, hist: [], star: false, c: Date.now(), u: Date.now(), d: 0, _snap: 0,
        name: first ? uniqueName(this.siblings(parent), s.name.replace(/(\.[^.]+)?$/, ' salinan$1')) : s.name,
      };
      this.nodes.set(n.id, n);
      await this.save(n);
      if (s.type === 'folder') for (const c of this.children(nid)) await copy(c.id, n.id, false);
      return n;
    };
    const r = await copy(id, this.nodes.get(id).parent, true);
    this.emit('tree');
    return r;
  }

  async remove(id) {
    this.assertWritable();
    const ids = [id, ...descendants(this.nodes, id)];
    for (const x of ids) {
      const n = this.nodes.get(x);
      if (!n) continue;
      this.nodes.delete(x);
      this._dirty.delete(x);
      this.tabs = this.tabs.filter((t) => t !== x);
      await this.save(n, true);
    }
    if (!this.nodes.has(this.active)) this.active = this.tabs[this.tabs.length - 1] || 'root';
    this.emit('tree'); this.emit('active');
  }

  async toggleStar(id) {
    const n = this.nodes.get(id);
    if (!n || n.type !== 'file') return;
    n.star = !n.star;
    await this.save(n);
    this.emit('tree');
  }

  /* ---------- tab dan seleksi ---------- */
  open(id) {
    const n = this.nodes.get(id);
    if (id === 'root' || !n) this.active = 'root';
    else if (n.type === 'folder') { this.active = id; this.expanded.add(id); }
    else {
      if (!this.tabs.includes(id)) this.tabs.push(id);
      this.active = id;
      let p = n.parent;
      while (p) { this.expanded.add(p); p = this.nodes.get(p)?.parent; }
    }
    this.emit('active');
  }

  async close(id) {
    const n = this.nodes.get(id);
    if (n) { await this.flush(); await this.snapshot(n, 'Autosave', true); }
    this.tabs = this.tabs.filter((t) => t !== id);
    if (this.active === id) this.active = this.tabs[this.tabs.length - 1] || (n?.parent ?? 'root') || 'root';
    this.emit('active');
  }

  /* ---------- pencarian (grep) ---------- */
  search(q, { regex = false, cs = false, max = 300 } = {}) {
    if (!q) return [];
    let re;
    try { re = new RegExp(regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), cs ? '' : 'i'); } catch { throw new Error('Regex tidak valid'); }
    const out = [];
    let total = 0;
    for (const n of this.nodes.values()) {
      const nameHit = re.test(n.name);
      const hits = [];
      if (n.type === 'file' && !n.blob && n.kind !== 'legacy') {
        const lines = n.content.split('\n');
        for (let i = 0; i < lines.length && hits.length < 8; i++) if (re.test(lines[i])) hits.push({ line: i + 1, text: lines[i].slice(0, 200) });
      }
      if (nameHit || hits.length) {
        out.push({ id: n.id, path: this.path(n.id), hits, nameHit });
        total += hits.length + 1;
        if (total >= max) break;
      }
    }
    return out.sort((a, b) => a.path.localeCompare(b.path));
  }

  /* ---------- impor / ekspor ---------- */
  async exportZip(id) {
    const entries = [];
    const baseParent = id === 'root' ? null : this.nodes.get(id)?.parent ?? null;
    const prefix = baseParent ? this.path(baseParent).slice(1) + '/' : '';
    const ids = id === 'root' ? [...this.nodes.keys()] : [id, ...descendants(this.nodes, id)];
    for (const x of ids) {
      const n = this.nodes.get(x);
      if (!n) continue;
      const p = this.path(x).slice(1).slice(prefix.length);
      if (n.type === 'folder') entries.push({ path: p + '/', data: new Uint8Array(0) });
      else entries.push({ path: p, data: n.blob ? new Uint8Array(await n.blob.arrayBuffer()) : te.encode(n.content) });
    }
    return new Blob([makeZip(entries)], { type: 'application/zip' });
  }

  async ensureFolders(parent, segs, cache) {
    let p = parent;
    for (const s of segs) {
      const key = (p || '') + '/' + s.toLowerCase();
      if (!cache.has(key)) {
        const existing = this.children(p ?? 'root').find((n) => n.type === 'folder' && n.name.toLowerCase() === s.toLowerCase());
        cache.set(key, existing ? existing.id : (await this.create({ parent: p, type: 'folder', name: s })).id);
      }
      p = cache.get(key);
    }
    return p;
  }

  /** files: [{ path, data:Uint8Array, mime? }] -> jumlah berkas yang dibuat. */
  async importEntries(parent, files) {
    this.assertWritable();
    if (files.length > ZIP_LIMITS.files) throw new Error('Terlalu banyak berkas (maks. ' + ZIP_LIMITS.files + ')');
    const cache = new Map();
    let count = 0;
    for (const f of files) {
      const segs = f.path.split('/').filter(Boolean);
      const name = segs.pop();
      const dir = await this.ensureFolders(parent ?? null, segs, cache);
      const k = kindOf(name, f.mime || '', true);
      const text = k === 'image' || k === 'pdf' || f.data.length > 1.5e6 ? null : decodeText(f.data);
      if (text !== null) await this.create({ parent: dir, name, content: text, mime: f.mime || '' });
      else await this.create({ parent: dir, name, blob: new Blob([f.data], { type: f.mime || '' }), mime: f.mime || '', textual: false });
      count++;
    }
    return count;
  }

  /** files: [{ path, file:File }] dari input/drop. */
  async importFiles(parent, files) {
    let bytes = 0;
    const list = [];
    for (const { path, file } of files) {
      bytes += file.size;
      if (file.size > MAX_UPLOAD) throw new Error(`"${file.name}" melebihi batas ${MAX_UPLOAD / 1048576} MB`);
      if (bytes > ZIP_LIMITS.bytes) throw new Error('Total unggahan melebihi ' + ZIP_LIMITS.bytes / 1048576 + ' MB');
      list.push({ path, data: new Uint8Array(await file.arrayBuffer()), mime: file.type });
    }
    return this.importEntries(parent, list);
  }

  async importZip(parent, buf) { return this.importEntries(parent, await readZip(buf)); }

  async fromTemplate(key, parent) {
    const t = TEMPLATES[key];
    return this.create({ parent, name: t.name, content: t.body(this.ws.name), open: true });
  }

  /* ---------- vault ---------- */
  async unlock(pass) {
    const key = await unlockVault(pass, this.ws.vault);
    this.keys.set(this.ws.id, key);
    this.locked = false;
    await this.hydrateAll();
    this.emit('ws');
  }

  async lock() {
    if (!this.ws?.vault) return;
    await this.flush();
    for (const n of this.nodes.values()) if (n._snap) { clearTimeout(n._snap); n._snap = 0; }
    this.keys.delete(this.ws.id);
    this.nodes = new Map();
    this.locked = true; this.tabs = []; this.active = 'root';
    this.emit('ws');
  }

  async lockAll() {
    await this.flush();
    const hadCurrent = this.ws?.vault && this.keys.has(this.ws.id);
    this.keys.clear();
    if (hadCurrent) { this.nodes = new Map(); this.locked = true; this.tabs = []; this.active = 'root'; this.emit('ws'); }
    return hadCurrent;
  }

  async _resealAll(newKey, meta) {
    if (this.partial) throw new Error('Sebagian berkas gagal didekripsi; perubahan passphrase dibatalkan demi keamanan data');
    await this.flush();
    this.keys.set(this.ws.id, newKey);
    this.ws.vault = meta;
    await DB.put(this.db, 'ws', this.ws);
    for (const n of this.nodes.values()) await this.save(n);
    this.locked = false;
    this.emit('ws');
  }

  async enableVault(pass) {
    if (this.ws.vault) throw new Error('Vault sudah aktif');
    const v = await createVault(pass);
    await this._resealAll(v.key, v.meta);
  }

  async changePass(oldPass, newPass) {
    await unlockVault(oldPass, this.ws.vault);
    const v = await createVault(newPass);
    await this._resealAll(v.key, v.meta);
  }

  /* ---------- cadangan mentah (terenkripsi bila vault) ---------- */
  async exportBackup() {
    await this.flush();
    const raw = await DB.nodesOf(this.db, this.ws.id);
    const nodes = [];
    for (const r of raw) {
      if (r.del) continue;
      const c = { ...r };
      if (c.blob) { c.blob = { mime: c.blob.type, b64: toB64(new Uint8Array(await c.blob.arrayBuffer())) }; }
      nodes.push(c);
    }
    const ws = { ...this.ws, cursor: 0, remote: false };
    return new Blob([JSON.stringify({ malude: 1, ws, nodes })], { type: 'application/json' });
  }

  async importBackup(text) {
    const j = JSON.parse(text);
    if (j.malude !== 1 || !j.ws || !Array.isArray(j.nodes)) throw new Error('Berkas cadangan tidak dikenali');
    if (this.wsOf(j.ws.id)) throw new Error('Workspace ini sudah ada di perangkat. Hapus dulu bila ingin memulihkan.');
    const ws = { ...j.ws, remote: false, role: 'owner', cursor: 0 };
    await DB.put(this.db, 'ws', ws);
    this.wss.push(ws);
    for (const r of j.nodes) {
      if (r.blob?.b64) { const b = Uint8Array.from(atob(r.blob.b64), (c) => c.charCodeAt(0)); r.blob = new Blob([b], { type: r.blob.mime }); }
      r.ws = ws.id; r.d = 0;
      await DB.put(this.db, 'nodes', r);
    }
    this.emit('wss');
    return ws;
  }

  /* ---------- sinkron: dipanggil oleh sync.js ---------- */
  async reloadNode(id) {
    const r = await DB.get(this.db, 'nodes', id);
    const old = this.nodes.get(id);
    if (!r || r.del || r.ws !== this.ws.id) { this.nodes.delete(id); this.tabs = this.tabs.filter((t) => t !== id); return; }
    const n = await this.hydrate(r);
    if (n) { if (old?._snap) n._snap = old._snap; this.nodes.set(id, n); }
  }
}
