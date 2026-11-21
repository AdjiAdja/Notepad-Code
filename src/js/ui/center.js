// Panel tengah: lembar biru berlubang (spiral). Tampilan folder, editor kode, pratinjau Markdown,
// riwayat + diff, gambar/PDF/biner, Run JS (Worker), buka vault.
import { h, $, fmtSize, rel, debounce } from '../util.js';
import { renderMd, toggleTask } from '../md.js';
import { highlight } from '../highlight.js';
import { diffLines, findByName, iconLabel, TEMPLATES } from '../tree.js';
import { scan } from '../secrets.js';
import { toast, askText, confirmBox } from './dom.js';
import { readDrop } from '../dnd.js';

const MODES = ['edit', 'split', 'view'];
const lsGet = (k, d) => { try { return localStorage.getItem(k) || d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, v); } catch { /* abaikan */ } };

export function mountCenter(app) {
  const { store: s, act } = app;
  const root = $('#center'), tabsEl = $('#tabs');
  let mode = lsGet('mni.mode', 'split'), showHist = false, urls = [], runOut = null;

  const cleanup = () => { urls.forEach(URL.revokeObjectURL); urls = []; };
  const objUrl = (b) => { const u = URL.createObjectURL(b); urls.push(u); return u; };

  /* ---------- tab ---------- */
  function renderTabs() {
    tabsEl.replaceChildren(...s.tabs.map((id) => {
      const n = s.nodes.get(id); if (!n) return null;
      return h('div', { class: 'tab' + (s.active === id ? ' on' : ''), role: 'tab', 'aria-selected': String(s.active === id) },
        h('button', { type: 'button', class: 'tn', onclick: () => s.open(id) }, n.name),
        h('button', { type: 'button', class: 'tx', 'aria-label': 'Tutup ' + n.name, onclick: () => s.close(id) }, '×'));
    }).filter(Boolean));
  }

  /* ---------- pratinjau markdown ---------- */
  function mdView(n, src, cls = '') {
    const r = renderMd(src, { wiki: (name) => !!findByName(s.nodes, name) });
    const box = h('div', { class: 'md ' + cls, html: r.html });
    box.addEventListener('click', async (e) => {
      const wl = e.target.closest('.wl');
      if (wl) {
        e.preventDefault();
        const name = wl.dataset.wiki, hit = findByName(s.nodes, name);
        if (hit) s.open(hit.id);
        else if (!s.readonly && await confirmBox({ title: 'Catatan belum ada', text: `Buat "${name}.md"?`, ok: 'Buat' })) await s.create({ parent: s.cwd, name: name + '.md', content: '# ' + name + '\n', open: true });
        return;
      }
      const cp = e.target.closest('.cpb');
      if (cp) { navigator.clipboard?.writeText(cp.parentElement.querySelector('code').textContent); cp.textContent = 'Tersalin'; setTimeout(() => (cp.textContent = 'Salin'), 1200); return; }
      const cb = e.target.closest('input[type=checkbox][data-line]');
      if (cb && n && !s.readonly) { n.content = toggleTask(n.content, +cb.dataset.line); s.touch(n); render(); }
    });
    return box;
  }

  /* ---------- editor ---------- */
  function editor(n) {
    const code = n.kind === 'code';
    const ta = h('textarea', { class: 'ta', spellcheck: 'false', autocapitalize: 'off', autocomplete: 'off', wrap: code ? 'off' : 'soft', 'aria-label': 'Editor ' + n.name, readOnly: s.readonly });
    ta.value = n.content;
    const pre = code ? h('pre', { class: 'hl', 'aria-hidden': 'true' }) : null;
    const gut = code ? h('div', { class: 'gut', 'aria-hidden': 'true' }) : null;
    let prevLines = 0;
    const paint = () => {
      if (!code) return;
      pre.innerHTML = highlight(ta.value, n.lang) + '\n';
      const c = ta.value.split('\n').length;
      if (c !== prevLines) { gut.textContent = Array.from({ length: c }, (_, i) => i + 1).join('\n'); prevLines = c; }
    };
    const paintSoon = debounce(paint, 40);
    const secretChip = h('span', { class: 'chip warn', hidden: true }, '⚠ rahasia terdeteksi: tidak disinkronkan');
    const checkSecrets = debounce(() => {
      const hit = s.ws.remote && !s.ws.vault && s.settings.blockSecrets && scan(ta.value);
      secretChip.hidden = !(hit && hit.length);
      if (hit?.length) secretChip.title = hit.slice(0, 4).map((x) => `baris ${x.line}: ${x.type}`).join('\n');
    }, 300);
    ta.addEventListener('input', () => { n.content = ta.value; s.touch(n); paintSoon(); checkSecrets(); stat(); });
    ta.addEventListener('scroll', () => { if (pre) { pre.scrollTop = ta.scrollTop; pre.scrollLeft = ta.scrollLeft; gut.scrollTop = ta.scrollTop; } });
    ta.addEventListener('click', stat); ta.addEventListener('keyup', stat);
    ta.addEventListener('keydown', (e) => {
      if (s.readonly) return;
      if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        const a = ta.selectionStart, b = ta.selectionEnd, v = ta.value;
        if (a === b && !e.shiftKey) { document.execCommand('insertText', false, '  '); return; }
        const ls = v.lastIndexOf('\n', a - 1) + 1, le = b;
        const block = v.slice(ls, le).split('\n');
        const out = block.map((l) => (e.shiftKey ? l.replace(/^ {1,2}/, '') : '  ' + l)).join('\n');
        ta.setSelectionRange(ls, le);
        document.execCommand('insertText', false, out);
        ta.setSelectionRange(ls, ls + out.length);
      } else if (e.key === 'Enter' && !e.ctrlKey && !e.shiftKey && code) {
        const a = ta.selectionStart, v = ta.value, ls = v.lastIndexOf('\n', a - 1) + 1;
        const ind = v.slice(ls, a).match(/^\s*/)[0], prev = v[a - 1];
        if (ind || /[{(\[:]/.test(prev)) { e.preventDefault(); document.execCommand('insertText', false, '\n' + ind + (/[{(\[:]/.test(prev) ? '  ' : '')); }
      }
    });
    function stat() {
      const upto = ta.value.slice(0, ta.selectionStart).split('\n');
      app.status({ pos: `Ln ${upto.length}, Kol ${upto[upto.length - 1].length + 1}`, lines: ta.value.split('\n').length, size: fmtSize(new Blob([ta.value]).size) });
    }
    paint(); checkSecrets(); setTimeout(stat, 0);
    const wrap = h('div', { class: 'edwrap' + (code ? ' code' : '') }, pre, ta);
    const el = h('div', { class: 'ed' }, gut, wrap);
    el._ta = ta; el._secret = secretChip; el._set = (v) => { ta.value = v; paint(); };
    return el;
  }

  /* ---------- riwayat + diff ---------- */
  function histPanel(n) {
    const list = h('div', { class: 'hlist' });
    const diffBox = h('div', { class: 'diff' }, h('p', { class: 'empty' }, 'Pilih versi untuk membandingkan dengan isi saat ini.'));
    const items = [...n.hist].reverse();
    const show = (v) => {
      const d = diffLines(v.c, n.content);
      const keep = new Set();
      d.forEach((x, i) => { if (x.t !== '=') for (let k = i - 2; k <= i + 2; k++) keep.add(k); });
      const rows = []; let gap = false;
      d.forEach((x, i) => {
        if (!keep.has(i)) { gap = true; return; }
        if (gap) { rows.push(h('div', { class: 'dl gap' }, '⋯')); gap = false; }
        rows.push(h('div', { class: 'dl ' + (x.t === '+' ? 'add' : x.t === '-' ? 'del' : 'eq') }, (x.t === '=' ? '  ' : x.t + ' ') + x.s));
      });
      diffBox.replaceChildren(h('div', { class: 'dhead' }, h('span', {}, `Versi ${new Date(v.t).toLocaleString('id-ID')} → sekarang`),
        s.readonly ? null : h('button', { type: 'button', class: 'btn sm', onclick: async () => { await s.snapshot(n, 'Sebelum pemulihan'); n.content = v.c; s.touch(n); await s.flush(); toast('Versi dipulihkan', 'ok'); render(); } }, 'Pulihkan versi ini')),
        ...(rows.length ? rows : [h('p', { class: 'empty' }, 'Tidak ada perbedaan.')]));
    };
    items.forEach((v) => list.append(h('button', { type: 'button', class: 'hv', onclick: (e) => { list.querySelectorAll('.hv').forEach((b) => b.classList.remove('sel')); e.currentTarget.classList.add('sel'); show(v); } },
      h('b', {}, rel(v.t)), h('small', {}, v.m + (v.a ? ' · otomatis' : '')))));
    if (!items.length) list.append(h('p', { class: 'empty' }, 'Belum ada versi. Tekan Ctrl+S untuk menyimpan versi.'));
    return h('aside', { class: 'hist' }, h('h3', {}, 'Riwayat versi'), s.readonly ? null : h('button', { type: 'button', class: 'btn sm', onclick: async () => { toast((await s.snapshot(n, 'Versi manual')) ? 'Versi disimpan' : 'Tidak ada perubahan sejak versi terakhir', 'ok'); render(); } }, 'Simpan versi sekarang'), list, diffBox);
  }

  /* ---------- Run JS (Worker dari blob; kode pengguna dimuat sebagai skrip, tanpa eval -> kompatibel dengan CSP) ---------- */
  function runJs(n, out) {
    const prelude = `const __o=[];const __f=(a)=>a.map(x=>{if(typeof x==='string')return x;try{return JSON.stringify(x,null,2)}catch{return String(x)}}).join(' ');
console.log=console.info=console.warn=console.error=(...a)=>__o.push(__f(a));
self.onerror=(m)=>{postMessage({o:__o,e:String(m)});return true};
self.onunhandledrejection=(ev)=>{postMessage({o:__o,e:'Unhandled: '+(ev.reason&&ev.reason.message||ev.reason)})};
(async()=>{try{\n`;
    const post = `\n}catch(e){__o.push('Error: '+(e&&e.message||e))}postMessage({o:__o})})();`;
    const url = URL.createObjectURL(new Blob([prelude + n.content + post], { type: 'text/javascript' }));
    out.replaceChildren(h('span', { class: 'dim' }, 'Menjalankan…'));
    let w;
    try { w = new Worker(url); } catch (e) { out.textContent = 'Tidak dapat membuat Worker: ' + e.message; URL.revokeObjectURL(url); return; }
    const t0 = performance.now();
    const kill = setTimeout(() => { w.terminate(); URL.revokeObjectURL(url); out.replaceChildren(h('span', { class: 'err' }, 'Dihentikan: melebihi batas 5 detik.')); }, 5000);
    w.onmessage = (e) => {
      clearTimeout(kill); w.terminate(); URL.revokeObjectURL(url);
      out.replaceChildren(h('pre', {}, (e.data.o.join('\n') || '(tidak ada output)') + (e.data.e ? '\n' + e.data.e : '')), h('small', { class: 'dim' }, `${Math.round(performance.now() - t0)} ms · berjalan terisolasi di Worker tanpa akses ke data Anda`));
    };
    w.onerror = (e) => { clearTimeout(kill); w.terminate(); URL.revokeObjectURL(url); out.replaceChildren(h('pre', { class: 'err' }, 'Error sintaks/runtime: ' + (e.message || 'tidak diketahui'))); };
  }

  /* ---------- tampilan berkas ---------- */
  function fileView(n) {
    const md = n.kind === 'md', text = n.kind === 'md' || n.kind === 'code' || n.kind === 'text';
    const body = h('div', { class: 'body' });
    let ed = null, pv = null;
    const tools = h('div', { class: 'tools' });
    const btn = (label, fn, cls = '', title = '') => h('button', { type: 'button', class: 'btn sm ' + cls, title, onclick: fn }, label);
    if (md) tools.append(h('div', { class: 'seg', role: 'group', 'aria-label': 'Mode' }, MODES.map((m) => h('button', { type: 'button', class: m === mode ? 'on' : '', 'aria-pressed': String(m === mode), onclick: () => { mode = m; lsSet('mni.mode', m); render(); } }, { edit: 'Tulis', split: 'Dua panel', view: 'Baca' }[m]))));
    if (text) {
      tools.append(btn(showHist ? 'Tutup riwayat' : 'Riwayat', () => { showHist = !showHist; render(); }, '', 'Riwayat versi + diff'));
      if (n.lang === 'json' && !s.readonly) tools.append(btn('Format JSON', () => { try { n.content = JSON.stringify(JSON.parse(n.content), null, 2) + '\n'; s.touch(n); render(); } catch (e) { toast('JSON tidak valid: ' + e.message, 'err'); } }));
      if (n.lang === 'javascript') tools.append(btn('▶ Jalankan', () => runJs(n, runOut)));
    }
    tools.append(btn(n.star ? '★' : '☆', () => act.star(n.id), '', 'Bintang'), btn('Salin', () => { navigator.clipboard?.writeText(n.content); toast('Disalin', 'ok', 1200); }), btn('Unduh', () => act.download(n.id)));

    if (n.kind === 'image') {
      body.append(h('div', { class: 'media' }, n.blob ? h('img', { src: objUrl(n.blob), alt: n.name }) : h('p', { class: 'empty' }, 'Gambar ini tidak tersedia di perangkat ini (lampiran tidak disinkronkan).')));
    } else if (n.kind === 'pdf' || !text) {
      body.append(h('div', { class: 'media' }, h('p', {}, `${iconLabel(n) || 'BIN'} · ${fmtSize(n.size)}`),
        n.blob ? h('div', { class: 'row-btns' }, n.kind === 'pdf' ? h('a', { class: 'btn', href: objUrl(n.blob), target: '_blank', rel: 'noopener' }, 'Buka PDF di tab baru') : null, btn('Unduh', () => act.download(n.id), 'primary'))
          : h('p', { class: 'empty' }, 'Lampiran tidak tersedia di perangkat ini.')));
    } else {
      ed = editor(n);
      if (md && mode !== 'edit') {
        pv = h('div', { class: 'pv' }, mdView(n, n.content));
        const upd = debounce(() => { pv.replaceChildren(mdView(n, ed._ta.value)); }, 150);
        ed._ta.addEventListener('input', upd);
      }
      const panes = h('div', { class: 'panes ' + (md ? mode : 'edit') });
      if (!md || mode !== 'view') panes.append(ed);
      if (md && mode !== 'edit') panes.append(pv);
      body.append(panes);
      if (n.lang === 'javascript') { runOut = h('div', { class: 'runout' }, h('span', { class: 'dim' }, 'Output ▶ Jalankan muncul di sini.')); body.append(runOut); }
      {
        const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const names = [...new Set([n.name, n.name.replace(/\.[^.]+$/, '')])].map(esc).join('|');
        const re = new RegExp('\\[\\[(' + names + ')(\\|[^\\]]*)?\\]\\]', 'i');
        const back = [...s.nodes.values()].filter((x) => x.id !== n.id && x.type === 'file' && x.kind === 'md' && re.test(x.content));
        if (back.length) body.append(h('div', { class: 'back' }, h('b', {}, 'Tautan balik: '), back.map((x) => h('button', { type: 'button', class: 'lnk', onclick: () => s.open(x.id) }, x.name))));
      }
    }
    const meta = h('div', { class: 'meta' }, [
      h('span', { class: 'chip' }, n.kind === 'code' ? n.lang : n.kind),
      h('span', { class: 'chip' }, fmtSize(n.size)),
      h('span', { class: 'chip' }, 'diubah ' + rel(n.u)),
      s.ws.vault ? h('span', { class: 'chip ok' }, '🔒 terenkripsi') : null,
      s.readonly ? h('span', { class: 'chip' }, 'hanya baca') : null,
      ed ? ed._secret : null,
    ]);
    return page(n.name, s.path(n.id), meta, tools, h('div', { class: 'split' + (showHist && text ? ' withhist' : '') }, body, showHist && text ? histPanel(n) : null));
  }

  /* ---------- tampilan folder ---------- */
  function folderView(id) {
    const isRoot = id === 'root', f = isRoot ? null : s.nodes.get(id);
    const kids = s.children(id);
    const readme = kids.find((k) => /^readme(\.md)?$/i.test(k.name) && k.type === 'file');
    const files = [...s.nodes.values()].filter((x) => x.type === 'file').length;
    const tools = h('div', { class: 'tools' }, s.readonly ? null : [
      h('button', { type: 'button', class: 'btn sm primary', onclick: () => act.newFile(isRoot ? null : id) }, '+ Berkas'),
      h('button', { type: 'button', class: 'btn sm', onclick: () => act.newFolder(isRoot ? null : id) }, '+ Folder'),
      h('button', { type: 'button', class: 'btn sm', onclick: () => act.template(isRoot ? null : id) }, 'Templat'),
      h('button', { type: 'button', class: 'btn sm', onclick: () => act.upload(isRoot ? null : id) }, 'Unggah'),
      h('button', { type: 'button', class: 'btn sm', onclick: () => act.upload(isRoot ? null : id, true) }, 'Unggah folder'),
    ], h('button', { type: 'button', class: 'btn sm', onclick: () => act.exportZip(id) }, 'Ekspor ZIP'));
    const grid = kids.length ? h('div', { class: 'cards' }, kids.map((k) => h('button', { type: 'button', class: 'card', onclick: () => s.open(k.id) },
      h('span', { class: 'ct' }, k.type === 'folder' ? '▸ DIR' : iconLabel(k)), h('b', {}, k.name),
      h('small', {}, k.type === 'folder' ? s.children(k.id).length + ' item' : fmtSize(k.size) + ' · ' + rel(k.u))))) :
      h('div', { class: 'blank' }, h('p', {}, 'Folder kosong.'), h('p', { class: 'dim' }, 'Seret berkas atau folder dari komputer Anda ke sini, atau mulai dari templat ' + Object.values(TEMPLATES).slice(0, 3).map((t) => t.label).join(', ') + '.'));
    const meta = h('div', { class: 'meta' }, h('span', { class: 'chip' }, kids.length + ' item'), isRoot ? h('span', { class: 'chip' }, files + ' berkas'): null, s.ws.vault ? h('span', { class: 'chip ok' }, '🔒 vault') : null, s.ws.remote ? h('span', { class: 'chip' }, `${s.ws.kind === 'team' ? 'tim' : 'tersinkron'} · ${s.ws.role}`) : h('span', { class: 'chip' }, 'lokal di perangkat ini'));
    return page(isRoot ? s.ws.name : f.name, isRoot ? '/' : s.path(id), meta, tools, h('div', { class: 'body scroll' }, grid, readme ? h('div', { class: 'readme' }, h('h4', {}, readme.name), mdView(readme, readme.content)) : null));
  }

  /* ---------- vault terkunci ---------- */
  function lockedView() {
    const inp = h('input', { type: 'password', autocomplete: 'current-password', placeholder: 'Passphrase vault', autofocus: true, 'aria-label': 'Passphrase vault' });
    const err = h('p', { class: 'err', role: 'alert' });
    const go = async () => {
      err.textContent = ''; goBtn.disabled = true; goBtn.textContent = 'Menurunkan kunci…';
      try { await s.unlock(inp.value); } catch { err.textContent = 'Passphrase salah, atau data rusak.'; goBtn.disabled = false; goBtn.textContent = 'Buka'; inp.select(); }
    };
    const goBtn = h('button', { type: 'button', class: 'btn primary', onclick: go }, 'Buka');
    inp.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    return page('Vault terkunci', s.ws.name, null, null, h('div', { class: 'body lockbox' }, h('div', { class: 'lockicon', 'aria-hidden': 'true' }, '🔒'),
      h('p', {}, 'Nama berkas, isi, riwayat dan lampiran di workspace ini dienkripsi AES-256-GCM. Kunci diturunkan dari passphrase Anda (PBKDF2 600.000 putaran) dan tidak pernah meninggalkan browser.'), inp, goBtn, err,
      h('p', { class: 'dim' }, 'Passphrase yang hilang tidak dapat dipulihkan oleh siapa pun, termasuk Malude.')));
  }

  function page(title, kicker, meta, tools, body) {
    const t = h('h1', { class: 'title', title: 'Klik dua kali untuk ganti nama', ondblclick: () => { if (s.active !== 'root' && !s.readonly) act.rename(s.active); } }, title);
    return h('div', { class: 'sheet' }, h('div', { class: 'holes', 'aria-hidden': 'true' }), h('div', { class: 'page' },
      h('div', { class: 'kicker' }, kicker), t, meta, tools, body));
  }

  function render() {
    cleanup(); runOut = null;
    renderTabs();
    let el;
    if (s.locked) el = lockedView();
    else if (s.active === 'root' || s.nodes.get(s.active)?.type === 'folder') el = folderView(s.active);
    else if (s.nodes.get(s.active)) el = fileView(s.nodes.get(s.active));
    else el = folderView('root');
    root.replaceChildren(el);
    if (s.active === 'root' || s.nodes.get(s.active)?.type === 'folder') app.status({ pos: '', lines: '', size: '' });
  }

  root.addEventListener('dragover', (e) => e.preventDefault());
  root.addEventListener('drop', async (e) => { e.preventDefault(); if (!s.readonly && !s.locked) act.dropFiles(s.cwd, await readDrop(e.dataTransfer)); });

  let lastActive = null;
  s.on('active', () => { showHist = false; lastActive = s.active; render(); });
  s.on('ws', render);
  s.on('tree', () => {
    const ta = document.activeElement;
    if (ta && ta.classList?.contains('ta') && s.nodes.has(s.active)) renderTabs(); // jangan ganggu pengetikan
    else render();
  });
  s.on('remote', (ids) => { if (ids.includes(s.active) && !s._dirty.has(s.active)) render(); });
  render();
  return { render, focus: () => root.querySelector('textarea')?.focus(), toggleHist: () => { showHist = !showHist; render(); } };
}
