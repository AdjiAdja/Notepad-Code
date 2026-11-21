// Aksi tingkat aplikasi (dipakai explorer, tampilan folder, palette).
import { h } from './util.js';
import { download } from './util.js';
import { TEMPLATES } from './tree.js';
import { toast, askText, confirmBox, pickFolder, modal } from './ui/dom.js';
import { fromInput } from './dnd.js';

const guard = (fn) => async (...a) => { try { return await fn(...a); } catch (e) { toast(e.message || String(e), 'err'); } };

export function actions(app) {
  const s = app.store;
  const A = {
    newFile: guard(async (parent = s.cwd) => {
      const name = await askText({ title: 'Berkas baru', label: 'Nama berkas', value: 'catatan.md', ok: 'Buat', hint: 'Ekstensi menentukan highlight: .md .js .py .json .sql .yml …' });
      if (name) await s.create({ parent, name, open: true });
    }),
    newFolder: guard(async (parent = s.cwd) => {
      const name = await askText({ title: 'Folder baru', label: 'Nama folder', value: 'folder-baru', ok: 'Buat' });
      if (name) await s.create({ parent, type: 'folder', name, open: true });
    }),
    rename: guard(async (id) => {
      const n = s.nodes.get(id); if (!n) return;
      const name = await askText({ title: 'Ganti nama', label: 'Nama baru', value: n.name, ok: 'Simpan' });
      if (name && name !== n.name) await s.rename(id, name);
    }),
    remove: guard(async (id) => {
      const n = s.nodes.get(id); if (!n) return;
      const extra = n.type === 'folder' ? ' beserta seluruh isinya' : '';
      if (await confirmBox({ title: 'Hapus?', text: `"${n.name}"${extra} akan dihapus${s.ws.remote ? ' dari semua anggota workspace' : ''}.`, ok: 'Hapus', danger: true })) await s.remove(id);
    }),
    move: guard(async (id) => {
      const dest = await pickFolder(s, { title: 'Pindahkan ke…', exclude: id });
      if (dest !== null) await s.move(id, dest);
    }),
    duplicate: guard(async (id) => { await s.duplicate(id); }),
    star: guard(async (id) => { await s.toggleStar(id); }),
    exportZip: guard(async (id = 'root') => {
      const blob = await s.exportZip(id);
      const base = id === 'root' ? s.ws.name : s.nodes.get(id).name;
      download(blob, base.replace(/[^\w.-]+/g, '_') + '.zip');
    }),
    upload: (parent = s.cwd, dir = false) => {
      const inp = h('input', { type: 'file', multiple: true });
      if (dir) { inp.setAttribute('webkitdirectory', ''); }
      inp.addEventListener('change', guard(async () => {
        const list = fromInput(inp.files);
        if (list.length === 1 && /\.zip$/i.test(list[0].path)) return A.importZip(parent, list[0].file);
        const n = await s.importFiles(parent, list);
        toast(`${n} berkas diimpor`, 'ok');
      }));
      inp.click();
    },
    importZip: guard(async (parent, file) => {
      const n = await s.importZip(parent, new Uint8Array(await file.arrayBuffer()));
      toast(`${n} berkas dari ZIP diimpor`, 'ok');
    }),
    dropFiles: guard(async (parent, list) => {
      if (!list.length) return;
      if (list.length === 1 && /\.zip$/i.test(list[0].path)) {
        if (await confirmBox({ title: 'Ekstrak ZIP?', text: 'Isi ZIP akan diekstrak ke folder ini. Pilih "Batal" untuk menyimpannya sebagai berkas.', ok: 'Ekstrak' })) return A.importZip(parent, list[0].file);
      }
      const n = await s.importFiles(parent, list);
      toast(`${n} berkas diimpor`, 'ok');
    }),
    template: guard(async (parent = s.cwd) => {
      let pick;
      const m = modal({
        title: 'Templat dokumen engineering',
        body: h('div', { class: 'tpls' }, Object.entries(TEMPLATES).map(([k, t]) => h('button', { type: 'button', class: 'tpl', onclick: () => { pick = k; m.close(); } }, h('b', {}, t.label), h('small', {}, t.name)))),
        onClose: async () => { if (pick) await guard(() => s.fromTemplate(pick, parent))(); },
      });
    }),
    download: (id) => {
      const n = s.nodes.get(id); if (!n) return;
      download(n.blob || new Blob([n.content], { type: 'text/plain;charset=utf-8' }), n.name);
    },
    backup: guard(async () => {
      const blob = await s.exportBackup();
      download(blob, s.ws.name.replace(/[^\w.-]+/g, '_') + '.malude.json');
      toast(s.ws.vault ? 'Cadangan terenkripsi (vault) diunduh' : 'Cadangan diunduh. Berkas ini TIDAK terenkripsi', 'ok');
    }),
    restore: () => {
      const inp = h('input', { type: 'file', accept: '.json,application/json' });
      inp.addEventListener('change', guard(async () => {
        const ws = await s.importBackup(await inp.files[0].text());
        toast('Workspace dipulihkan: ' + ws.name, 'ok');
      }));
      inp.click();
    },
  };
  return A;
}
