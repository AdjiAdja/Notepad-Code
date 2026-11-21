// Fungsi murni untuk struktur berkas (pohon seperti repositori), tanpa DOM.

const CODE = {
  js: 'javascript', mjs: 'javascript', cjs: 'javascript', jsx: 'javascript', ts: 'typescript', tsx: 'typescript',
  py: 'python', sh: 'bash', bash: 'bash', zsh: 'bash', makefile: 'bash', json: 'json', jsonc: 'json',
  yml: 'yaml', yaml: 'yaml', sql: 'sql', html: 'html', htm: 'html', vue: 'html', svelte: 'html', xml: 'xml',
  css: 'css', scss: 'css', go: 'go', rs: 'rust', java: 'java', kt: 'kotlin', swift: 'swift', c: 'c', h: 'c',
  cpp: 'cpp', ino: 'cpp', cs: 'csharp', php: 'php', rb: 'ruby', toml: 'toml', ini: 'ini', conf: 'ini', env: 'ini',
  rsc: 'routeros', tf: 'hcl', dockerfile: 'docker', lua: 'lua',
};
const MD = new Set(['md', 'markdown', 'mdx']);
const IMG = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico']);
const TXT = new Set(['txt', 'log', 'csv', 'tsv', 'gitignore', 'editorconfig', 'lock']);

export function extOf(name) {
  const n = name.toLowerCase();
  if (n === 'dockerfile' || n === 'makefile') return n;
  if (n.startsWith('.env')) return 'env';
  const i = n.lastIndexOf('.');
  if (i < 0) return '';
  if (i === 0) return n.slice(1);
  return n.slice(i + 1);
}

/** kind: md | code | text | image | pdf | bin | folder. */
export function kindOf(name, mime = '', textual = true) {
  const e = extOf(name);
  if (MD.has(e)) return 'md';
  if (IMG.has(e) || mime.startsWith('image/')) return 'image';
  if (e === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (CODE[e]) return 'code';
  if (TXT.has(e) || textual) return 'text';
  return 'bin';
}

export const langOf = (name) => CODE[extOf(name)] || 'plaintext';

export function iconLabel(node) {
  if (node.type === 'folder') return '';
  if (node.kind === 'md') return 'MD';
  if (node.kind === 'image') return 'IMG';
  if (node.kind === 'pdf') return 'PDF';
  if (node.kind === 'legacy') return 'KNC';
  const e = extOf(node.name);
  return (e || 'TXT').slice(0, 3).toUpperCase();
}

export const cmp = (a, b) =>
  (a.type === b.type ? 0 : a.type === 'folder' ? -1 : 1) ||
  a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });

export function sanitizeName(n) {
  let s = String(n ?? '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-').trim().slice(0, 120);
  if (!s || /^\.+$/.test(s)) s = 'tanpa-nama';
  return s;
}

export function uniqueName(names, name) {
  const lower = new Set([...names].map((s) => s.toLowerCase()));
  if (!lower.has(name.toLowerCase())) return name;
  const i = name.lastIndexOf('.');
  const base = i > 0 ? name.slice(0, i) : name;
  const ext = i > 0 ? name.slice(i) : '';
  for (let k = 2; k < 1000; k++) {
    const c = `${base} (${k})${ext}`;
    if (!lower.has(c.toLowerCase())) return c;
  }
  return name + '-' + Date.now();
}

export function pathOf(map, id) {
  const parts = [];
  let n = map.get(id), guard = 0;
  while (n && guard++ < 200) {
    parts.unshift(n.name);
    n = n.parent ? map.get(n.parent) : null;
  }
  return '/' + parts.join('/');
}

export function resolvePath(map, path) {
  const segs = String(path).split('/').filter(Boolean);
  let parent = null, cur = null;
  for (const s of segs) {
    cur = null;
    for (const n of map.values()) {
      if (!n.del && (n.parent ?? null) === parent && n.name.toLowerCase() === s.toLowerCase()) { cur = n; break; }
    }
    if (!cur) return null;
    parent = cur.id;
  }
  return cur;
}

/** Cari berkas dari tautan wiki: path penuh, nama persis, atau nama tanpa ekstensi .md. */
export function findByName(map, name) {
  const q = name.trim().toLowerCase();
  if (q.includes('/')) return resolvePath(map, q) || resolvePath(map, q + '.md');
  let hit = null;
  for (const n of map.values()) {
    if (n.del || n.type !== 'file') continue;
    const ln = n.name.toLowerCase();
    if (ln === q) return n;
    if (!hit && (ln === q + '.md' || ln.replace(/\.[^.]+$/, '') === q)) hit = n;
  }
  return hit;
}

export function descendants(map, id) {
  const out = [];
  const stack = [id];
  while (stack.length) {
    const p = stack.pop();
    for (const n of map.values()) if ((n.parent ?? null) === p && !n.del) { out.push(n.id); stack.push(n.id); }
  }
  return out;
}

/** Diff baris (LCS) dengan pemangkasan awalan/akhiran yang sama. -> [{t:'='|'+'|'-', s}] */
export function diffLines(a, b) {
  const A = a.split('\n'), B = b.split('\n');
  let s = 0;
  while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let e = 0;
  while (e < A.length - s && e < B.length - s && A[A.length - 1 - e] === B[B.length - 1 - e]) e++;
  const a2 = A.slice(s, A.length - e), b2 = B.slice(s, B.length - e);
  const out = A.slice(0, s).map((x) => ({ t: '=', s: x }));
  const n = a2.length, m = b2.length;
  if (n * m > 4e6) {
    a2.forEach((x) => out.push({ t: '-', s: x }));
    b2.forEach((x) => out.push({ t: '+', s: x }));
  } else {
    const L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--)
      for (let j = m - 1; j >= 0; j--)
        L[i][j] = a2[i] === b2[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    let i = 0, j = 0;
    while (i < n && j < m) {
      if (a2[i] === b2[j]) { out.push({ t: '=', s: a2[i] }); i++; j++; }
      else if (L[i + 1][j] >= L[i][j + 1]) out.push({ t: '-', s: a2[i++] });
      else out.push({ t: '+', s: b2[j++] });
    }
    while (i < n) out.push({ t: '-', s: a2[i++] });
    while (j < m) out.push({ t: '+', s: b2[j++] });
  }
  A.slice(A.length - e).forEach((x) => out.push({ t: '=', s: x }));
  return out;
}

export const TEMPLATES = {
  readme: { label: 'README.md', name: 'README.md', body: (n) => `# ${n}\n\nDeskripsi singkat proyek.\n\n## Struktur\n\n- \`src/\` kode sumber\n- \`docs/\` dokumentasi\n\n## Memulai\n\n\`\`\`bash\nnpm install\nnpm run dev\n\`\`\`\n\n## Catatan\n\n- [ ] Tugas pertama\n` },
  adr: { label: 'ADR (keputusan arsitektur)', name: 'adr-001-judul.md', body: () => `# ADR-001: Judul keputusan\n\n- Status: diusulkan\n- Tanggal: ${new Date().toISOString().slice(0, 10)}\n\n## Konteks\n\nMasalah dan batasan yang melatarbelakangi.\n\n## Keputusan\n\nYang dipilih dan alasannya.\n\n## Konsekuensi\n\n- Positif:\n- Negatif:\n` },
  runbook: { label: 'Runbook', name: 'runbook.md', body: () => `# Runbook: nama layanan\n\n## Gejala\n\n- \n\n## Diagnosis\n\n1. Cek status layanan\n2. Cek log terbaru\n\n\`\`\`bash\nsystemctl status layanan\njournalctl -u layanan -n 100\n\`\`\`\n\n## Mitigasi\n\n- [ ] Langkah 1\n\n## Eskalasi\n\n- Kontak on-call:\n` },
  incident: { label: 'Postmortem insiden', name: 'postmortem.md', body: () => `# Postmortem: ringkasan insiden\n\n| Waktu | Kejadian |\n| --- | --- |\n| 00:00 | Deteksi |\n\n## Dampak\n\n## Akar masalah\n\n## Yang berjalan baik\n\n## Tindak lanjut\n\n- [ ] \n` },
  api: { label: 'Spesifikasi API', name: 'api.md', body: () => `# API: nama\n\n## GET /resource\n\nParameter:\n\n| Nama | Tipe | Wajib | Keterangan |\n| --- | --- | --- | --- |\n| id | string | ya | ID resource |\n\nRespons:\n\n\`\`\`json\n{ "id": "abc", "ok": true }\n\`\`\`\n` },
  env: { label: '.env.example', name: '.env.example', body: () => `# Salin menjadi .env, jangan commit nilai rahasia\nDATABASE_URL=\nAPI_BASE_URL=http://localhost:8788\nLOG_LEVEL=info\n` },
  meeting: { label: 'Catatan rapat', name: 'rapat.md', body: () => `# Rapat ${new Date().toISOString().slice(0, 10)}\n\nPeserta:\n\n## Agenda\n\n1. \n\n## Keputusan\n\n## Tugas\n\n- [ ] \n` },
  bug: { label: 'Laporan bug', name: 'bug.md', body: () => `# Bug: judul singkat\n\n## Langkah mereproduksi\n\n1. \n\n## Hasil yang diharapkan\n\n## Hasil sebenarnya\n\n## Lingkungan\n\n- OS:\n- Versi:\n` },
};
