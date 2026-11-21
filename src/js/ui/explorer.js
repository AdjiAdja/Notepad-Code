// Penjelajah berkas: tumpukan kertas abu-abu dengan daftar tulisan tangan; baris terpilih biru.
import { h, $ } from '../util.js';
import { iconLabel } from '../tree.js';
import { ctxMenu } from './dom.js';
import { readDrop } from '../dnd.js';

export function mountExplorer(app) {
  const { store: s, act } = app;
  const root = $('#explorer'), pinned = $('#pinned');

  function row(n, depth) {
    const isF = n.type === 'folder', open = s.expanded.has(n.id);
    const el = h('div', {
      class: 'row' + (s.active === n.id ? ' sel' : '') + (isF ? ' dir' : ''), role: 'treeitem', tabindex: '0', draggable: !s.readonly,
      'aria-selected': String(s.active === n.id), 'aria-expanded': isF ? String(open) : null,
      dataset: { id: n.id }, style: { paddingLeft: 10 + depth * 16 + 'px' },
      onclick: (e) => {
        if (isF && (e.target.closest('.tw') || s.active === n.id)) { open ? s.expanded.delete(n.id) : s.expanded.add(n.id); }
        s.open(n.id); render();
      },
      ondblclick: () => { if (!s.readonly) act.rename(n.id); },
      oncontextmenu: (e) => { e.preventDefault(); menu(e.clientX, e.clientY, n); },
      onkeydown: (e) => {
        if (e.key === 'Enter') el.click();
        else if (e.key === 'F2' && !s.readonly) act.rename(n.id);
        else if (e.key === 'Delete' && !s.readonly) act.remove(n.id);
        else if (e.key === 'ArrowDown') (el.nextElementSibling || el)?.focus();
        else if (e.key === 'ArrowUp') (el.previousElementSibling || el)?.focus();
        else if (e.key === 'ArrowRight' && isF && !open) { s.expanded.add(n.id); render(); }
        else if (e.key === 'ArrowLeft' && isF && open) { s.expanded.delete(n.id); render(); }
      },
      ondragstart: (e) => { e.dataTransfer.setData('text/x-malude', n.id); e.dataTransfer.effectAllowed = 'move'; },
      ondragover: (e) => { if (isF || true) { e.preventDefault(); el.classList.add('over'); } },
      ondragleave: () => el.classList.remove('over'),
      ondrop: async (e) => {
        e.preventDefault(); e.stopPropagation(); el.classList.remove('over');
        const dest = isF ? n.id : n.parent;
        const mv = e.dataTransfer.getData('text/x-malude');
        if (mv) { try { await s.move(mv, dest); } catch (x) { app.toast(x.message, 'err'); } }
        else act.dropFiles(dest, await readDrop(e.dataTransfer));
      },
    },
      isF ? h('span', { class: 'tw' }, open ? '▾' : '▸') : h('span', { class: 'tag' }, iconLabel(n)),
      h('span', { class: 'nm' }, n.name),
      n.star ? h('span', { class: 'st', title: 'Berbintang' }, '★') : null,
      n.d ? h('span', { class: 'pend', title: 'Menunggu sinkron' }, '•') : null);
    return el;
  }

  function menu(x, y, n) {
    const ro = s.readonly, f = n.type === 'folder';
    ctxMenu(x, y, [
      f && !ro ? { label: 'Berkas baru di sini', run: () => act.newFile(n.id) } : null,
      f && !ro ? { label: 'Folder baru di sini', run: () => act.newFolder(n.id) } : null,
      f && !ro ? { label: 'Unggah ke sini…', run: () => act.upload(n.id) } : null,
      f ? '-' : null,
      !f ? { label: n.star ? 'Hapus bintang' : 'Beri bintang', run: () => act.star(n.id) } : null,
      !ro ? { label: 'Ganti nama (F2)', run: () => act.rename(n.id) } : null,
      !ro ? { label: 'Pindahkan…', run: () => act.move(n.id) } : null,
      !ro ? { label: 'Duplikat', run: () => act.duplicate(n.id) } : null,
      !f ? { label: 'Unduh', run: () => act.download(n.id) } : { label: 'Ekspor ZIP', run: () => act.exportZip(n.id) },
      !ro ? '-' : null,
      !ro ? { label: 'Hapus', danger: true, run: () => act.remove(n.id) } : null,
    ]);
  }

  function walk(parent, depth, out) {
    for (const n of s.children(parent)) {
      out.push(row(n, depth));
      if (n.type === 'folder' && s.expanded.has(n.id)) walk(n.id, depth + 1, out);
    }
  }

  function render() {
    const rows = [];
    walk('root', 0, rows);
    const head = h('div', { class: 'ex-head' }, [
      h('button', { type: 'button', class: 'rootbtn' + (s.active === 'root' ? ' sel' : ''), onclick: () => { s.open('root'); render(); } }, '/ ' + (s.ws?.name || '')),
      h('div', { class: 'ex-tools' }, s.readonly ? h('span', { class: 'ro' }, 'hanya baca') : [
        h('button', { type: 'button', title: 'Berkas baru (Ctrl+Alt+N)', 'aria-label': 'Berkas baru', onclick: () => act.newFile() }, '+'),
        h('button', { type: 'button', title: 'Folder baru', 'aria-label': 'Folder baru', onclick: () => act.newFolder() }, '▣'),
        h('button', { type: 'button', title: 'Unggah berkas / ZIP', 'aria-label': 'Unggah', onclick: () => act.upload() }, '↑'),
      ]),
    ]);
    root.replaceChildren(head, h('div', { class: 'list', role: 'tree', 'aria-label': 'Berkas' }, rows.length ? rows : h('p', { class: 'empty' }, s.locked ? 'Vault terkunci' : 'Belum ada berkas. Tulis sesuatu.')));

    const stars = [...s.nodes.values()].filter((n) => n.star).sort((a, b) => b.u - a.u).slice(0, 6);
    const recent = [...s.nodes.values()].filter((n) => n.type === 'file' && !n.star).sort((a, b) => b.u - a.u).slice(0, 4);
    pinned.replaceChildren(
      h('h3', {}, 'Disematkan'),
      ...(stars.length || recent.length ? [...stars, ...recent].map((n) => h('button', { type: 'button', class: 'pin' + (s.active === n.id ? ' sel' : ''), onclick: () => s.open(n.id) }, (n.star ? '★ ' : '· ') + n.name)) : [h('p', { class: 'empty' }, 'Beri bintang pada berkas penting.')]),
    );
  }

  const area = $('#left');
  area.addEventListener('dragover', (e) => { e.preventDefault(); });
  area.addEventListener('drop', async (e) => {
    e.preventDefault();
    if (s.readonly) return;
    const mv = e.dataTransfer.getData('text/x-malude');
    if (mv) { try { await s.move(mv, null); } catch (x) { app.toast(x.message, 'err'); } }
    else act.dropFiles(null, await readDrop(e.dataTransfer));
  });

  ['tree', 'active', 'ws', 'wss'].forEach((e) => s.on(e, render));
  render();
  return render;
}
