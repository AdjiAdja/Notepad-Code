// Panel kanan: ID badge (plastik + lanyard biru) dan kertas sobek untuk catatan cepat.
import { h, $, hash32 } from '../util.js';
import { renderGoogleButton, loginWithCredential, devLogin } from '../auth.js';
import { toast } from './dom.js';

const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v); e.append(...kids); return e; };

function barcode(seed) {
  let x = hash32(seed), bars = '', pos = 0;
  const s = svg('svg', { viewBox: '0 0 120 34', class: 'barcode', role: 'img', 'aria-label': 'Barcode dekoratif' });
  while (pos < 118) {
    x = Math.imul(x ^ (x >>> 15), 2246822519) >>> 0;
    const w = 1 + (x % 3), gap = 1 + ((x >>> 5) % 2);
    s.append(svg('rect', { x: pos, y: 0, width: w, height: 34, fill: 'currentColor' }));
    pos += w + gap;
  }
  void bars; return s;
}
const signature = () => svg('svg', { viewBox: '0 0 120 36', class: 'sig', 'aria-hidden': 'true' },
  svg('path', { d: 'M4 26c10-24 16-22 14-8s-6 16 4 4 10-14 14-6-8 14 2 8 12-12 14-6 6 6 14-2 10-6 14-4 10 4 24-4', fill: 'none', stroke: 'currentColor', 'stroke-width': '2', 'stroke-linecap': 'round' }));
const clip = () => svg('svg', { viewBox: '0 0 40 90', class: 'clip', 'aria-hidden': 'true' },
  svg('path', { d: 'M12 70V22a8 8 0 0 1 16 0v52a14 14 0 0 1-28 0V30', transform: 'translate(6 2)', fill: 'none', stroke: 'currentColor', 'stroke-width': '3.4', 'stroke-linecap': 'round' }));

export function mountSide(app) {
  const { store: s, sync } = app;
  const root = $('#right');

  function badge() {
    const u = app.user;
    const id = u ? 'MNI-' + hash32(u.sub).toString(36).toUpperCase().padStart(6, '0').slice(0, 6) : 'MNI-TAMU00';
    const loginBox = h('div', { class: 'login' });
    const card = h('div', { class: 'badge-wrap' }, [
      h('div', { class: 'lanyard', 'aria-hidden': 'true' }, h('span', {}, 'MALUDE · MALUDE · MALUDE · MALUDE')),
      h('div', { class: 'ring', 'aria-hidden': 'true' }),
      h('div', { class: 'badge' }, [
        h('div', { class: 'slot', 'aria-hidden': 'true' }),
        h('div', { class: 'id-card' }, [
          h('div', { class: 'id-top' }, h('img', { src: 'assets/logo-mark.svg', alt: '' }), h('span', {}, 'MALUDE NOTEPAD IDEAS')),
          u?.pic ? h('img', { class: 'avatar', src: u.pic, alt: '', referrerpolicy: 'no-referrer' }) : h('div', { class: 'avatar mark' }, h('img', { src: 'assets/logo-mark.svg', alt: '' })),
          h('div', { class: 'id-name' }, (u ? u.name : 'Tamu').toUpperCase()),
          h('div', { class: 'id-pos' }, u ? (s.ws?.remote ? `${s.ws.role} · ${s.ws.name}` : 'Pengguna · ' + (s.ws?.name || '')) : 'Mode lokal · tanpa akun'),
          barcode(u?.sub || 'tamu'),
          h('div', { class: 'id-foot' }, h('span', {}, id), signature()),
        ]),
      ]),
    ]);
    const acct = h('div', { class: 'acct' });
    if (u) {
      acct.append(h('p', { class: 'em' }, u.email), h('div', { class: 'syncline' }, h('span', { class: 'dot ' + sync.state }), h('span', {}, syncText())), h('div', { class: 'row-btns' },
        h('button', { type: 'button', class: 'btn sm', onclick: () => sync.run() }, 'Sinkronkan'), h('button', { type: 'button', class: 'btn sm', onclick: () => app.logout() }, 'Keluar')));
      if (app.offline) acct.append(h('p', { class: 'hint' }, 'Offline: bekerja dari data lokal.'));
    } else {
      acct.append(h('p', { class: 'hint' }, 'Masuk dengan Google untuk workspace tim dan sinkron antar perangkat. Tanpa akun, semua data tetap hanya di browser ini.'), loginBox);
      renderGoogleButton(loginBox, async (cred) => { try { await app.signedIn(await loginWithCredential(cred)); } catch (e) { toast(e.message, 'err'); } }, (e) => { loginBox.append(h('p', { class: 'hint' }, 'Login Google belum aktif: ' + e.message)); });
      if (window.APP?.devLogin) {
        const em = h('input', { type: 'email', value: 'dev@malude.test', 'aria-label': 'Email dev' }), nm = h('input', { type: 'text', value: 'Dev User', 'aria-label': 'Nama dev' });
        acct.append(h('div', { class: 'dev' }, h('small', {}, 'DEV LOGIN (hanya localhost)'), em, nm, h('button', { type: 'button', id: 'devlogin', class: 'btn sm', onclick: async () => { try { await app.signedIn(await devLogin(em.value, nm.value)); } catch (e) { toast(e.message, 'err'); } } }, 'Masuk dev')));
      }
    }
    return h('section', { class: 'badge-area' }, card, acct);
  }
  const syncText = () => ({ idle: 'Siap', sync: 'Menyinkronkan…', ok: sync.pending ? `${sync.pending} menunggu` : 'Tersinkron', err: 'Gagal: ' + sync.err }[sync.state] || '');

  function note() {
    const ta = h('textarea', { id: 'quick', placeholder: 'Catatan cepat… (Ctrl+Enter simpan ke Inbox.md)', 'aria-label': 'Catatan cepat', rows: '5', readOnly: s.readonly || s.locked });
    const save = async () => {
      const t = ta.value.trim(); if (!t) return;
      try {
        let f = s.children('root').find((n) => n.name === 'Inbox.md');
        const stamp = new Date().toLocaleString('id-ID', { dateStyle: 'short', timeStyle: 'short' });
        if (!f) f = await s.create({ parent: null, name: 'Inbox.md', content: '# Inbox\n' });
        f.content += `\n- ${stamp} — ${t.replace(/\n+/g, ' ')}`;
        s.touch(f); await s.flush(); ta.value = ''; toast('Tersimpan di Inbox.md', 'ok', 1400);
        if (s.active === f.id) s.emit('active');
      } catch (e) { toast(e.message, 'err'); }
    };
    ta.addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); } });
    return h('section', { class: 'torn' }, clip(), h('div', { class: 'tp' }, h('h3', {}, 'Catatan cepat'), ta, h('button', { type: 'button', class: 'btn sm', onclick: save, disabled: s.readonly || s.locked }, 'Simpan ke Inbox')));
  }

  function render() { root.replaceChildren(badge(), note()); }
  ['ws', 'wss'].forEach((e) => s.on(e, render));
  sync.on(() => { const sl = root.querySelector('.syncline'); if (sl) sl.replaceChildren(h('span', { class: 'dot ' + sync.state }), h('span', {}, syncText())); });
  render();
  return render;
}
