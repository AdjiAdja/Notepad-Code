// Renderer Markdown kecil dan aman: semua teks di-escape lebih dulu, hanya tag yang kita hasilkan yang lolos.
// Mendukung: judul, daftar + task list, tabel, kutipan, blok kode (highlight), tautan, [[wiki link]].
// Gambar remote sengaja tidak dirender (mencegah pelacakan).

import { highlight } from './highlight.js';

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const slug = (t) => t.toLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-') || 'x';

function inline(src, o) {
  const codes = [];
  let s = esc(src);
  s = s.replace(/`([^`]+)`/g, (m, c) => { codes.push(c); return '\u0000' + (codes.length - 1) + '\u0000'; });
  s = s.replace(/\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/g, (m, t, l) => {
    const name = t.trim();
    const ok = o.wiki ? o.wiki(name.replace(/&amp;/g, '&')) : true;
    return `<a class="wl${ok ? '' : ' miss'}" data-wiki="${name}">${l || name}</a>`;
  });
  s = s.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, t, u) => {
    const raw = u.replace(/&amp;/g, '&');
    if (/^(https?:\/\/|mailto:)/i.test(raw)) return `<a href="${u}" target="_blank" rel="noopener noreferrer">${t}</a>`;
    if (raw.startsWith('#')) return `<a href="${u}">${t}</a>`;
    return `<a class="wl" data-wiki="${u}">${t}</a>`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>')
    .replace(/~~([^~]+)~~/g, '<s>$1</s>');
  return s.replace(/\u0000(\d+)\u0000/g, (m, i) => `<code>${codes[i]}</code>`);
}

const LI = /^(\s*)([-*+]|\d+[.)])\s+(.*)$/;
const TBL_SEP = /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/;

/** -> { html, toc:[{level,text,id}], tasks:{done,total} } */
export function renderMd(src, o = {}) {
  const L = String(src).replace(/\r/g, '').split('\n');
  const out = [], toc = [], para = [];
  const tasks = { done: 0, total: 0 };
  let i = 0;
  const flush = () => {
    if (para.length) { out.push('<p>' + para.map((l) => inline(l, o)).join('<br>') + '</p>'); para.length = 0; }
  };
  while (i < L.length) {
    const line = L[i];
    let m;
    if ((m = line.match(/^```(\S*)/))) {
      flush();
      const buf = [];
      i++;
      while (i < L.length && !/^```/.test(L[i])) buf.push(L[i++]);
      i++;
      const lang = (m[1] || '').toLowerCase();
      out.push(`<div class="cb"><span class="cl">${esc(lang || 'teks')}</span><button type="button" class="cpb">Salin</button><pre><code>${highlight(buf.join('\n'), lang)}</code></pre></div>`);
      continue;
    }
    if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
      flush();
      const lv = m[1].length, t = m[2].trim(), id = slug(t);
      toc.push({ level: lv, text: t, id: 'h-' + id });
      out.push(`<h${lv} id="h-${id}">${inline(t, o)}</h${lv}>`);
      i++;
      continue;
    }
    if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(line)) { flush(); out.push('<hr>'); i++; continue; }
    if (/^\s*\|.*\|\s*$/.test(line) && i + 1 < L.length && TBL_SEP.test(L[i + 1])) {
      flush();
      const cells = (r) => r.trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
      const head = cells(line);
      i += 2;
      const rows = [];
      while (i < L.length && L[i].trim() && L[i].includes('|')) rows.push(cells(L[i++]));
      out.push('<div class="tbl"><table><thead><tr>' + head.map((c) => `<th>${inline(c, o)}</th>`).join('') + '</tr></thead><tbody>' +
        rows.map((r) => '<tr>' + r.map((c) => `<td>${inline(c, o)}</td>`).join('') + '</tr>').join('') + '</tbody></table></div>');
      continue;
    }
    if (/^>\s?/.test(line)) {
      flush();
      const buf = [];
      while (i < L.length && /^>\s?/.test(L[i])) buf.push(L[i++].replace(/^>\s?/, ''));
      out.push('<blockquote>' + buf.map((l) => inline(l, o)).join('<br>') + '</blockquote>');
      continue;
    }
    if ((m = line.match(LI))) {
      flush();
      const items = [];
      const ordered = /\d/.test(m[2]);
      while (i < L.length && (m = L[i].match(LI))) {
        let t = m[3], cls = '', chk = '';
        const tk = t.match(/^\[( |x|X)\]\s+(.*)$/);
        if (tk) {
          tasks.total++;
          const done = tk[1] !== ' ';
          if (done) tasks.done++;
          chk = `<input type="checkbox" data-line="${i}"${done ? ' checked' : ''}> `;
          t = tk[2];
          cls = done ? ' class="done"' : '';
        }
        items.push(`<li${cls} data-d="${Math.min(4, Math.floor(m[1].length / 2))}">${chk}${inline(t, o)}</li>`);
        i++;
      }
      out.push(`<${ordered ? 'ol' : 'ul'}>${items.join('')}</${ordered ? 'ol' : 'ul'}>`);
      continue;
    }
    if (!line.trim()) { flush(); i++; continue; }
    para.push(line);
    i++;
  }
  flush();
  return { html: out.join(''), toc, tasks };
}

/** Balik status checkbox pada baris sumber ke-n (0-based). Mengembalikan teks baru. */
export function toggleTask(src, lineNo) {
  const L = src.split('\n');
  L[lineNo] = L[lineNo].replace(/^(\s*[-*+]\s+)\[( |x|X)\]/, (m, a, b) => a + (b === ' ' ? '[x]' : '[ ]'));
  return L.join('\n');
}
