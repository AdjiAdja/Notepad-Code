// Sinkron delta: dorong node kotor (maks. 40/permintaan), tarik perubahan sejak cursor. LWW per node.
// Lampiran biner (gambar/PDF/blob) dan riwayat versi TIDAK disinkronkan. Berkas yang terdeteksi berisi rahasia
// (workspace tanpa vault) ditahan lokal. Konflik: salinan lokal disimpan sebagai "(konflik ...)".
import * as DB from './db.js';
import { api, ApiError } from './api.js';
import { uid } from './util.js';

const MAX_DATA = 900000;
const wireData = (r) => JSON.stringify(r.sealed ? { s: r.sealed } : { name: r.name, kind: r.kind, lang: r.lang, content: r.content, star: r.star ? 1 : 0, mime: r.mime || '' });
const wire = (r) => ({ id: r.id, parent: r.parent ?? null, type: r.type, u: r.u, del: r.del ? 1 : 0, data: r.del ? null : wireData(r) });
const stamp = () => new Date().toISOString().slice(0, 16).replace('T', ' ');

export class Sync {
  constructor(store) { this.s = store; this.busy = false; this.state = 'idle'; this.err = ''; this.pending = 0; this.h = new Set(); this.t = 0; this.enabled = false; }
  on(f) { this.h.add(f); return () => this.h.delete(f); }
  set(state, err = '') { this.state = state; this.err = err; this.h.forEach((f) => f(this)); }
  schedule(ms = 1500) { if (!this.enabled) return; clearTimeout(this.t); this.t = setTimeout(() => this.run(), ms); }

  async run() {
    if (!this.enabled || this.busy || !navigator.onLine) return;
    this.busy = true; this.set('sync');
    let firstErr = '';
    try {
      await this.s.flush();
      for (const ws of this.s.wss.filter((w) => w.remote)) {
        try { await this.syncWs(ws); } catch (e) {
          if (e instanceof ApiError && e.status === 404) { await this.s.deleteWs(ws.id); continue; }
          firstErr ||= `${ws.name}: ${e.message}`;
        }
      }
      this.pending = await this.countPending();
      this.set(firstErr ? 'err' : 'ok', firstErr);
    } catch (e) { this.set('err', e.message); } finally { this.busy = false; }
  }

  async countPending() {
    let n = 0;
    for (const w of this.s.wss.filter((x) => x.remote)) n += (await DB.nodesOf(this.s.db, w.id)).filter((r) => r.d && !r.x).length;
    return n;
  }

  async pullWorkspaces() {
    const { workspaces } = await api('/ws');
    const s = this.s, ids = new Set(workspaces.map((w) => w.id));
    for (const w of workspaces) {
      const l = s.wsOf(w.id);
      if (!l) await s.createWs({ id: w.id, name: w.name, kind: w.kind, remote: true, role: w.role, vault: w.vault, silent: true });
      else { Object.assign(l, { name: w.name, role: w.role, kind: w.kind, remote: true }); await DB.put(s.db, 'ws', l); }
    }
    for (const l of [...s.wss]) if (l.remote && !ids.has(l.id)) await s.deleteWs(l.id);
    s.emit('wss');
  }

  async createRemote({ name, kind, pass, domain }) {
    const s = this.s, id = uid();
    let vault = null, key = null;
    if (pass) { const { createVault } = await import('./vault.js'); const v = await createVault(pass); vault = v.meta; key = v.key; }
    await api('/ws', { method: 'POST', body: { id, name, kind, vault, domain: domain || undefined } });
    const ws = await s.createWs({ id, name, kind, remote: true, role: 'owner', vault, silent: true });
    if (key) s.keys.set(id, key);
    s.emit('wss');
    return ws;
  }

  /** Jadikan workspace lokal tersinkron ke akun: daftarkan di server, tandai semua node kotor. */
  async enableSync(ws) {
    const s = this.s;
    await s.flush();
    await api('/ws', { method: 'POST', body: { id: ws.id, name: ws.name, kind: ws.kind, vault: ws.vault || null } });
    ws.remote = true; ws.role = 'owner'; ws.cursor = 0;
    await DB.put(s.db, 'ws', ws);
    for (const r of await DB.nodesOf(s.db, ws.id)) { if (!r.blob && !r.bs) { r.d = 1; await DB.put(s.db, 'nodes', r); } }
    s.emit('wss');
    this.schedule(100);
  }

  async pushVault(ws) { if (ws.remote) await api(`/ws/${ws.id}`, { method: 'PATCH', body: { vault: ws.vault } }); }

  async syncWs(ws) {
    const s = this.s, db = s.db, changed = new Set();
    let vaultChanged = false;
    for (let round = 0; round < 60; round++) {
      const raw = await DB.nodesOf(db, ws.id);
      const pend = [];
      for (const r of raw) {
        if (!r.d || r.x || r.blob || r.bs) continue;
        if (!r.del && wireData(r).length > MAX_DATA) { r.x = 1; await DB.put(db, 'nodes', r); continue; }
        if (pend.length < 40) pend.push(r);
      }
      const sent = new Map(pend.map((r) => [r.id, r.u]));
      const res = await api(`/ws/${ws.id}/sync`, { method: 'POST', body: { since: ws.cursor || 0, nodes: pend.map(wire) } });
      for (const r of pend) {
        const cur = await DB.get(db, 'nodes', r.id);
        if (cur && cur.u === r.u) { cur.d = 0; await DB.put(db, 'nodes', cur); }
      }
      for (const r of res.nodes) {
        if (await this.apply(ws, r, sent, changed)) changed.add(r.id);
      }
      ws.cursor = res.cursor; ws.role = res.role; ws.name = res.name;
      if (JSON.stringify(res.vault) !== JSON.stringify(ws.vault || null) && res.vault) { ws.vault = res.vault; vaultChanged = true; }
      await DB.put(db, 'ws', ws);
      if (!res.more && pend.length < 40) break;
    }
    if (s.ws?.id !== ws.id) return;
    if (vaultChanged) { s.keys.delete(ws.id); await s.openWs(ws.id); return; }
    if (changed.size) {
      for (const id of changed) await s.reloadNode(id);
      s.emit('tree'); s.emit('remote', [...changed]);
    }
    s.emit('wss');
  }

  /** Terapkan satu node dari server. Mengembalikan true bila data lokal berubah. */
  async apply(ws, r, sent, changed) {
    const s = this.s, db = s.db;
    const local = await DB.get(db, 'nodes', r.id);
    if (local && local.ws !== ws.id) return false;
    if (local && local.u >= r.u) return false;
    if (s._dirty.has(r.id) && s.ws?.id === ws.id) return false;
    if (r.del) {
      await DB.put(db, 'nodes', { id: r.id, ws: ws.id, parent: r.parent, type: r.type, u: r.u, c: local?.c || r.u, d: 0, del: 1 });
      return true;
    }
    let d; try { d = JSON.parse(r.data); } catch { return false; }
    if (local && !local.del && !local.blob && !local.bs && (local.d || sent.has(r.id)) && wireData(local) !== r.data) {
      const h = await s.hydrate(local);
      if (h) {
        const copy = { ...h, id: uid(), hist: [], blob: null, d: 1, u: Date.now(), c: Date.now(), name: h.name.replace(/(\.[^.]+)?$/, ` (konflik ${stamp()})$1`), _snap: 0 };
        await DB.put(db, 'nodes', await s.dehydrate(copy));
        changed.add(copy.id);
      }
    }
    const rec = d.s ? { sealed: d.s } : { name: d.name, kind: d.kind, lang: d.lang, content: d.content, star: d.star ? 1 : 0, mime: d.mime || '' };
    await DB.put(db, 'nodes', { id: r.id, ws: ws.id, parent: r.parent ?? null, type: r.type, u: r.u, c: local?.c || r.u, d: 0, del: 0, ...rec, hist: local?.hist, hs: local?.hs, blob: local?.blob, bs: local?.bs });
    return true;
  }
}
