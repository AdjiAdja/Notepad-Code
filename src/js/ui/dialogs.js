// Dialog: palet perintah, pencarian, pengaturan, workspace (buat/atur/anggota/audit), gabung.
import { h, rel } from '../util.js';
import { strength } from '../vault.js';
import { api } from '../api.js';
import { modal, toast, askText, confirmBox, closeAllModals } from './dom.js';

export function mountDialogs(app) {
  const { store: s, sync, act } = app;

  /* ---------- palet perintah ---------- */
  function palette(initial = '') {
    const inp = h('input', { type: 'text', placeholder: 'Ketik nama berkas, atau perintah…', 'aria-label': 'Palet perintah', autocomplete: 'off', spellcheck: 'false', value: initial, autofocus: true });
    const list = h('div', { class: 'pal', role: 'listbox' });
    const cmds = [
      ['Berkas baru', () => act.newFile()], ['Folder baru', () => act.newFolder()], ['Templat dokumen…', () => act.template()],
      ['Cari isi semua berkas', () => search()], ['Unggah berkas / ZIP', () => act.upload()], ['Ekspor workspace (ZIP)', () => act.exportZip('root')],
      ['Cadangkan workspace (JSON)', () => act.backup()], ['Pulihkan dari cadangan…', () => act.restore()],
      ['Kunci vault sekarang', () => s.lock()], ['Kunci panik (semua vault + keluar tampilan)', () => app.panic()],
      ['Pengaturan', () => settings()], ['Pengaturan workspace…', () => wsSettings()], ['Workspace baru…', () => newWs()],
      ['Gabung dengan kode undangan…', () => join()], ['Sinkronkan sekarang', () => sync.run()],
    ];
    let items = [], sel = 0;
    const fuzzy = (q, t) => { q = q.toLowerCase(); t = t.toLowerCase(); let i = 0, sc = 0; for (const c of q) { const j = t.indexOf(c, i); if (j < 0) return -1; sc += j - i; i = j + 1; } return 1000 - sc - t.length; };
    const draw = () => {
      const q = inp.value.trim();
      const files = [...s.nodes.values()].filter((n) => n.type === 'file').map((n) => ({ label: s.path(n.id).slice(1), kind: 'berkas', run: () => s.open(n.id), sc: q ? fuzzy(q, s.path(n.id)) : n.u })).filter((x) => x.sc >= 0 || !q);
      const cs = cmds.map(([label, run]) => ({ label, kind: 'perintah', run, sc: q ? fuzzy(q, label) : 0 })).filter((x) => x.sc >= 0);
      items = [...(q ? [...files, ...cs] : [...files.sort((a, b) => b.sc - a.sc).slice(0, 6), ...cs])].sort((a, b) => (q ? b.sc - a.sc : 0)).slice(0, 12);
      sel = Math.min(sel, Math.max(0, items.length - 1));
      list.replaceChildren(...items.map((it, i) => h('button', { type: 'button', class: 'pi' + (i === sel ? ' sel' : ''), role: 'option', onclick: () => { m.close(); it.run(); } }, h('span', {}, it.label), h('small', {}, it.kind))));
      if (!items.length) list.append(h('p', { class: 'empty' }, 'Tidak ada hasil'));
    };
    const m = modal({ title: 'Palet perintah', body: [inp, list], wide: false });
    inp.addEventListener('input', () => { sel = 0; draw(); });
    inp.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown') { sel = Math.min(sel + 1, items.length - 1); draw(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { sel = Math.max(sel - 1, 0); draw(); e.preventDefault(); }
      else if (e.key === 'Enter' && items[sel]) { m.close(); items[sel].run(); }
    });
    draw();
  }

  /* ---------- pencarian grep ---------- */
  function search() {
    const q = h('input', { type: 'text', placeholder: 'Cari teks di semua berkas…', 'aria-label': 'Cari', autofocus: true, spellcheck: 'false' });
    const rx = h('input', { type: 'checkbox' }), cs = h('input', { type: 'checkbox' });
    const out = h('div', { class: 'results' });
    const go = () => {
      try {
        const res = s.search(q.value, { regex: rx.checked, cs: cs.checked });
        out.replaceChildren(...(res.length ? res.map((r) => h('div', { class: 'res' }, h('button', { type: 'button', class: 'rp', onclick: () => { m.close(); s.open(r.id); } }, r.path), r.hits.map((x) => h('button', { type: 'button', class: 'rl', onclick: () => { m.close(); s.open(r.id); setTimeout(() => { const ta = document.querySelector('#center textarea'); if (ta) { const lines = ta.value.split('\n'); const pos = lines.slice(0, x.line - 1).join('\n').length + (x.line > 1 ? 1 : 0); ta.focus(); ta.setSelectionRange(pos, pos + lines[x.line - 1].length); } }, 60); } }, h('b', {}, x.line), ' ' + x.text)))) : [h('p', { class: 'empty' }, q.value ? 'Tidak ada hasil' : '')]));
      } catch (e) { out.replaceChildren(h('p', { class: 'err' }, e.message)); }
    };
    const m = modal({ title: 'Cari di semua berkas', wide: true, body: [q, h('div', { class: 'opts' }, h('label', {}, rx, ' regex'), h('label', {}, cs, ' sensitif huruf')), out] });
    [q, rx, cs].forEach((e) => e.addEventListener('input', go));
  }

  /* ---------- pengaturan ---------- */
  function settings() {
    const lockSel = h('select', { 'aria-label': 'Kunci otomatis' }, [0, 1, 5, 15, 30].map((v) => h('option', { value: v, selected: app.prefs.autolock === v }, v ? `${v} menit tidak aktif` : 'Mati')));
    lockSel.addEventListener('change', () => { app.setPref('autolock', +lockSel.value); toast('Disimpan', 'ok', 1000); });
    const sec = h('input', { type: 'checkbox', checked: s.settings.blockSecrets });
    sec.addEventListener('change', () => { s.settings.blockSecrets = sec.checked; app.setPref('blockSecrets', sec.checked); });
    const bgSel = h('select', { 'aria-label': 'Latar' }, ['hitam', 'langit', 'shenzhen'].map((v) => h('option', { value: v, selected: app.prefs.bg === v }, v)));
    bgSel.addEventListener('change', async () => { app.setPref('bg', bgSel.value); (await import('../bg.js')).applyBg(bgSel.value); });
    modal({ title: 'Pengaturan', wide: true, body: [
      h('section', {}, h('h3', {}, 'Tampilan'), h('label', { class: 'fld' }, h('span', {}, 'Latar'), bgSel)),
      h('section', {}, h('h3', {}, 'Keamanan'),
        h('label', { class: 'fld' }, h('span', {}, 'Kunci vault otomatis'), lockSel),
        h('label', { class: 'chk' }, sec, ' Tahan berkas berisi rahasia (kunci API, token, private key) agar tidak tersinkron ke cloud'),
        h('p', { class: 'hint' }, 'Vault mengenkripsi nama, isi, riwayat dan lampiran dengan AES-256-GCM di browser Anda. Kunci panik: Ctrl+Shift+L.')),
      h('section', {}, h('h3', {}, 'Data'), h('div', { class: 'row-btns' },
        h('button', { type: 'button', class: 'btn sm', onclick: () => act.backup() }, 'Cadangkan (JSON)'), h('button', { type: 'button', class: 'btn sm', onclick: () => act.restore() }, 'Pulihkan'), h('button', { type: 'button', class: 'btn sm', onclick: () => act.exportZip('root') }, 'Ekspor ZIP'))),
      h('section', {}, h('h3', {}, 'Pintasan'), h('p', { class: 'keys' }, 'Ctrl+K palet · Ctrl+Shift+F cari isi · Ctrl+S simpan versi · Ctrl+Alt+N berkas baru · Ctrl+L kunci vault · F2 ganti nama · Tab / Shift+Tab indentasi')),
      h('section', {}, h('h3', {}, 'Tentang'), h('p', {}, 'Malude Notepad Ideas — catatan, kode, dan dokumen engineering. Lokal-pertama; sinkron tim opsional lewat Cloudflare.')),
    ] });
  }

  /* ---------- workspace baru ---------- */
  function newWs() {
    const name = h('input', { type: 'text', value: '', placeholder: 'mis. Backend Platform', autofocus: true, maxlength: '80', 'aria-label': 'Nama workspace' });
    const kinds = [['local', 'Pribadi · lokal (hanya di browser ini)'], ...(app.user ? [['cloud', 'Pribadi · tersinkron ke akun saya'], ['team', 'Tim · bisa mengundang anggota dengan peran']] : [])];
    const kind = h('select', { 'aria-label': 'Jenis' }, kinds.map(([v, l]) => h('option', { value: v }, l)));
    const pass = h('input', { type: 'password', placeholder: 'Opsional — aktifkan vault terenkripsi', autocomplete: 'new-password', 'aria-label': 'Passphrase vault' });
    const meter = h('div', { class: 'meter' }, h('i', {}));
    pass.addEventListener('input', () => { const sc = pass.value ? strength(pass.value) : 0; meter.firstChild.style.width = sc * 25 + '%'; meter.dataset.s = sc; });
    const dom = h('input', { type: 'text', placeholder: 'Opsional: batasi anggota ke domain, mis. perusahaan.co.id', 'aria-label': 'Domain' });
    const domRow = h('label', { class: 'fld', hidden: true }, h('span', {}, 'Domain email yang diizinkan'), dom);
    kind.addEventListener('change', () => { domRow.hidden = kind.value !== 'team'; });
    modal({ title: 'Workspace baru', body: [h('label', { class: 'fld' }, h('span', {}, 'Nama'), name), h('label', { class: 'fld' }, h('span', {}, 'Jenis'), kind), domRow,
      h('label', { class: 'fld' }, h('span', {}, 'Vault'), pass, meter), h('p', { class: 'hint' }, 'Dengan vault, server hanya menyimpan data terenkripsi. Passphrase yang lupa tidak bisa dipulihkan.')],
    actions: [{ label: 'Batal' }, { label: 'Buat', primary: true, onClick: async () => {
      const nm = name.value.trim(); if (!nm) { toast('Nama wajib diisi', 'err'); return false; }
      if (pass.value && pass.value.length < 10) { toast('Passphrase minimal 10 karakter', 'err'); return false; }
      let ws;
      if (kind.value === 'local') ws = await s.createWs({ name: nm, pass: pass.value || null });
      else ws = await sync.createRemote({ name: nm, kind: kind.value === 'team' ? 'team' : 'personal', pass: pass.value || null, domain: dom.value });
      await s.openWs(ws.id);
    } }] });
  }

  /* ---------- gabung ---------- */
  function join() {
    if (!app.user) { toast('Masuk dengan Google dulu untuk bergabung ke workspace tim', 'err'); return; }
    askText({ title: 'Gabung ke workspace tim', label: 'Kode undangan', placeholder: 'XXXXX-XXXXX-XXXXX-XXXXX', ok: 'Gabung' }).then(async (code) => {
      if (!code) return;
      try { const r = await api('/join', { method: 'POST', body: { code } }); await sync.pullWorkspaces(); await s.openWs(r.id); sync.run(); toast('Berhasil bergabung sebagai ' + r.role, 'ok'); } catch (e) { toast(e.message, 'err'); }
    });
  }

  /* ---------- pengaturan workspace ---------- */
  async function wsSettings() {
    const ws = s.ws; if (!ws) return;
    const isOwner = ws.role === 'owner', isAdmin = ws.role === 'owner' || ws.role === 'admin';
    const body = h('div', {});
    const secs = [];
    const nm = h('input', { type: 'text', value: ws.name, maxlength: '80', 'aria-label': 'Nama workspace', disabled: ws.remote && !isAdmin });
    secs.push(h('section', {}, h('h3', {}, 'Umum'), h('label', { class: 'fld' }, h('span', {}, 'Nama'), nm), h('p', { class: 'hint' }, `Jenis: ${ws.kind === 'team' ? 'tim' : 'pribadi'} · ${ws.remote ? 'tersinkron · peran Anda: ' + ws.role : 'lokal di perangkat ini'}`)));
    // vault
    const vsec = h('section', {}, h('h3', {}, 'Vault terenkripsi'));
    if (!ws.vault) {
      if (!ws.remote || isOwner) {
        const p = h('input', { type: 'password', placeholder: 'Passphrase baru (min. 10 karakter)', autocomplete: 'new-password', 'aria-label': 'Passphrase baru' });
        vsec.append(h('p', { class: 'hint' }, 'Mengenkripsi semua berkas yang ada.'), p, h('button', { type: 'button', class: 'btn sm', onclick: async (e) => {
          if (p.value.length < 10) return toast('Minimal 10 karakter', 'err');
          e.currentTarget.disabled = true;
          try { await s.enableVault(p.value); await sync.pushVault(ws); toast('Vault aktif', 'ok'); closeAllModals(); sync.schedule(100); } catch (x) { toast(x.message, 'err'); }
        } }, 'Aktifkan vault'));
      } else vsec.append(h('p', { class: 'hint' }, 'Hanya pemilik yang dapat mengaktifkan vault.'));
    } else if (!s.locked && (!ws.remote || isOwner)) {
      const o = h('input', { type: 'password', placeholder: 'Passphrase lama', autocomplete: 'current-password', 'aria-label': 'Passphrase lama' }), n2 = h('input', { type: 'password', placeholder: 'Passphrase baru (min. 10)', autocomplete: 'new-password', 'aria-label': 'Passphrase baru' });
      vsec.append(o, n2, h('button', { type: 'button', class: 'btn sm', onclick: async (e) => {
        if (n2.value.length < 10) return toast('Minimal 10 karakter', 'err');
        e.currentTarget.disabled = true;
        try { await s.changePass(o.value, n2.value); await sync.pushVault(ws); toast('Passphrase diganti. Anggota lain perlu memasukkan passphrase baru.', 'ok'); closeAllModals(); sync.schedule(100); } catch (x) { toast(x.message.includes('Passphrase') || x.name === 'OperationError' ? 'Passphrase lama salah' : x.message, 'err'); e.currentTarget.disabled = false; }
      } }, 'Ganti passphrase'));
    } else vsec.append(h('p', { class: 'hint' }, ws.vault ? 'Vault aktif. Buka vault untuk mengubah.' : ''));
    secs.push(vsec);
    // sinkron
    if (app.user && !ws.remote) secs.push(h('section', {}, h('h3', {}, 'Sinkron'), h('p', { class: 'hint' }, 'Unggah workspace ini ke akun Anda (lampiran biner dan riwayat versi tetap lokal).'),
      h('button', { type: 'button', class: 'btn sm', onclick: async () => { try { await sync.enableSync(ws); toast('Sinkron aktif', 'ok'); closeAllModals(); } catch (x) { toast(x.message, 'err'); } } }, 'Sinkronkan ke akun')));
    // anggota
    if (ws.remote && ws.kind === 'team') {
      const msec = h('section', {}, h('h3', {}, 'Anggota'), h('p', { class: 'hint' }, 'Memuat…'));
      secs.push(msec);
      (async () => {
        try {
          const { members, domain } = await api(`/ws/${ws.id}/members`);
          const rows = members.map((m) => {
            const sel = h('select', { 'aria-label': 'Peran ' + m.email, disabled: m.role === 'owner' || !isAdmin || m.sub === app.user.sub }, ['viewer', 'editor', 'admin'].concat(m.role === 'owner' ? ['owner'] : []).map((r) => h('option', { value: r, selected: m.role === r }, r)));
            sel.addEventListener('change', async () => { try { await api(`/ws/${ws.id}/members/${m.sub}`, { method: 'PATCH', body: { role: sel.value } }); toast('Peran diubah', 'ok'); } catch (x) { toast(x.message, 'err'); sel.value = m.role; } });
            const rm = (m.role !== 'owner' && (isAdmin || m.sub === app.user.sub)) ? h('button', { type: 'button', class: 'btn sm danger', onclick: async () => { if (await confirmBox({ title: m.sub === app.user.sub ? 'Keluar dari workspace?' : 'Keluarkan anggota?', text: m.email, ok: 'Ya', danger: true })) { try { await api(`/ws/${ws.id}/members/${m.sub}`, { method: 'DELETE' }); if (m.sub === app.user.sub) { await sync.pullWorkspaces(); closeAllModals(); } else wsSettings(); } catch (x) { toast(x.message, 'err'); } } } }, m.sub === app.user.sub ? 'Keluar' : 'Keluarkan') : null;
            return h('div', { class: 'mem' }, h('span', { class: 'who' }, h('b', {}, m.name || m.email), h('small', {}, m.email)), sel, rm);
          });
          msec.replaceChildren(...[h('h3', {}, 'Anggota'), domain ? h('p', { class: 'hint' }, 'Hanya email @' + domain) : null, ...rows].filter(Boolean));
          if (isAdmin) {
            const role = h('select', { 'aria-label': 'Peran undangan' }, ['viewer', 'editor'].concat(isOwner ? ['admin'] : []).map((r) => h('option', { value: r, selected: r === 'editor' }, r)));
            const em = h('input', { type: 'email', placeholder: 'Email (opsional, kunci undangan ke email ini)', 'aria-label': 'Email undangan' });
            const outp = h('div', { class: 'invout' });
            msec.append(h('div', { class: 'inv' }, role, em, h('button', { type: 'button', class: 'btn sm primary', onclick: async () => {
              try { const r = await api(`/ws/${ws.id}/invite`, { method: 'POST', body: { role: role.value, email: em.value || undefined } }); outp.replaceChildren(h('code', {}, r.code), h('small', {}, `Berlaku 7 hari · sekali pakai · peran ${r.role}`), h('button', { type: 'button', class: 'btn sm', onclick: () => navigator.clipboard?.writeText(r.code) }, 'Salin kode'), h('button', { type: 'button', class: 'btn sm', onclick: () => navigator.clipboard?.writeText(location.origin + '/?join=' + r.code) }, 'Salin tautan')); } catch (x) { toast(x.message, 'err'); }
            } }, 'Buat undangan')), outp);
          }
          if (isAdmin) {
            const aud = h('div', { class: 'audit' });
            msec.append(h('button', { type: 'button', class: 'btn sm', onclick: async () => { try { const { audit } = await api(`/ws/${ws.id}/audit?limit=60`); aud.replaceChildren(...audit.map((a) => h('div', { class: 'al' }, h('small', {}, rel(a.t)), h('b', {}, a.action), h('span', {}, `${a.email} ${a.detail || ''}`)))); } catch (x) { toast(x.message, 'err'); } } }, 'Lihat log audit'), aud);
          }
        } catch (x) { msec.replaceChildren(h('h3', {}, 'Anggota'), h('p', { class: 'err' }, x.message)); }
      })();
    }
    // bahaya
    const dz = h('section', { class: 'danger-zone' }, h('h3', {}, 'Zona berbahaya'));
    if (!ws.remote || isOwner) dz.append(h('button', { type: 'button', class: 'btn sm danger', onclick: async () => {
      if (!(await confirmBox({ title: 'Hapus workspace?', text: `"${ws.name}"${ws.remote ? ' akan dihapus permanen untuk SEMUA anggota' : ' dihapus dari perangkat ini'}. Tidak bisa dibatalkan.`, ok: 'Hapus permanen', danger: true }))) return;
      try { if (ws.remote) await api(`/ws/${ws.id}`, { method: 'DELETE' }); await s.deleteWs(ws.id); closeAllModals(); } catch (x) { toast(x.message, 'err'); }
    } }, 'Hapus workspace'));
    else dz.append(h('p', { class: 'hint' }, 'Hanya pemilik yang dapat menghapus workspace.'));
    secs.push(dz);
    body.append(...secs);
    modal({ title: 'Pengaturan workspace', wide: true, body, actions: [{ label: 'Tutup' }, { label: 'Simpan nama', primary: true, onClick: async () => {
      const v = nm.value.trim(); if (!v || v === ws.name) return;
      if (ws.remote) { await api(`/ws/${ws.id}`, { method: 'PATCH', body: { name: v } }); }
      await s.renameWs(ws, v);
    } }] });
  }

  app.dlg = { palette, search, settings, newWs, join, wsSettings };
  return app.dlg;
}
