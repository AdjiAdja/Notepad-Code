// Bar atas (merek, workspace, cari, kunci, sinkron, pengaturan) dan bar status.
import { h, $ } from '../util.js';
import { ctxMenu } from './dom.js';
import { BGS, applyBg } from '../bg.js';

export function mountTop(app) {
  const { store: s, sync } = app;
  const top = $('#top'), ftab = $('#ftab'), status = $('#status');
  let st = { pos: '', lines: '', size: '' };

  function render() {
    const ws = s.ws;
    const wsBtn = h('button', { type: 'button', class: 'pill', id: 'wsbtn', 'aria-haspopup': 'menu', onclick: (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      ctxMenu(r.left, r.bottom + 4, [
        ...s.wss.map((w) => ({ label: `${w.id === ws?.id ? '● ' : '○ '}${w.name}${w.vault ? ' 🔒' : ''}${w.kind === 'team' ? ' · tim' : w.remote ? ' · ☁' : ''}`, run: () => s.openWs(w.id) })),
        '-', { label: '+ Workspace baru…', run: () => app.dlg.newWs() }, { label: 'Gabung dengan kode undangan…', run: () => app.dlg.join() }, { label: 'Pengaturan workspace…', run: () => app.dlg.wsSettings() },
      ]);
    } }, h('span', { class: 'k' }, ws?.kind === 'team' ? 'TIM' : 'WS'), ' ' + (ws?.name || '…'), ' ▾');
    top.replaceChildren(
      h('a', { class: 'brand', href: './', 'aria-label': 'Malude Notepad Ideas' }, h('img', { src: 'assets/logo-mark.svg', alt: '', class: 'mk' }), h('span', { class: 'wm' }, h('b', {}, 'MALUDE'), h('small', {}, 'NOTEPAD IDEAS'))),
      wsBtn,
      h('button', { type: 'button', class: 'search', onclick: () => app.dlg.palette(), 'aria-label': 'Palet perintah' }, h('span', {}, 'Cari berkas atau perintah…'), h('kbd', {}, 'Ctrl K')),
      h('div', { class: 'tb-r' },
        h('button', { type: 'button', class: 'ic', title: 'Cari isi semua berkas (Ctrl+Shift+F)', 'aria-label': 'Cari isi', onclick: () => app.dlg.search() }, '⌕'),
        h('button', { type: 'button', class: 'ic', title: 'Ganti latar', 'aria-label': 'Ganti latar', onclick: () => { const i = (BGS.indexOf(app.prefs.bg) + 1) % BGS.length; app.setPref('bg', BGS[i]); applyBg(BGS[i]); app.toast('Latar: ' + BGS[i]); } }, '◐'),
        ws?.vault ? h('button', { type: 'button', class: 'ic', id: 'lockbtn', title: s.locked ? 'Vault terkunci' : 'Kunci vault (Ctrl+L)', 'aria-label': 'Kunci vault', onclick: () => (s.locked ? null : s.lock()) }, s.locked ? '🔒' : '🔓') : null,
        app.user ? h('span', { class: 'sync', title: sync.err || '' }, h('span', { class: 'dot ' + sync.state })) : null,
        h('button', { type: 'button', class: 'ic', title: 'Pengaturan', 'aria-label': 'Pengaturan', onclick: () => app.dlg.settings() }, '⚙')));
    ftab.replaceChildren(h('span', { class: 'ft-l' }, 'MALUDE'), h('span', { class: 'ft-r' }, ws ? ws.name : ''));
    renderStatus();
  }

  function renderStatus() {
    const n = s.nodes.get(s.active);
    status.replaceChildren(...[
      h('span', { class: 'sp' }, s.locked ? 'vault terkunci' : s.path(s.active)),
      n && n.type === 'file' ? h('span', {}, n.kind === 'code' ? n.lang : n.kind) : null,
      st.pos ? h('span', {}, st.pos) : null, st.lines ? h('span', {}, st.lines + ' baris') : null, st.size ? h('span', {}, st.size) : null,
      s.ws?.vault ? h('span', { class: 'ok' }, 'AES-256-GCM') : h('span', {}, 'tanpa vault'),
      h('span', {}, s.ws?.remote ? ({ idle: 'cloud', sync: 'menyinkronkan…', ok: sync.pending ? `${sync.pending} menunggu` : 'tersinkron', err: 'sinkron gagal' }[sync.state]) : 'lokal'),
      h('span', {}, 'v1.0')].filter(Boolean));
  }

  app.status = (p) => { st = { ...st, ...p }; renderStatus(); };
  ['ws', 'wss'].forEach((e) => s.on(e, render));
  s.on('active', renderStatus);
  sync.on(() => { top.querySelector('.sync .dot')?.setAttribute('class', 'dot ' + sync.state); renderStatus(); });
  render();
  return render;
}
