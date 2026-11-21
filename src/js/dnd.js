// Membaca drop berkas/folder dari OS -> [{ path, file }]
const entryFile = (e) => new Promise((res, rej) => e.file(res, rej));
const readAll = async (reader) => {
  const out = [];
  for (;;) { const b = await new Promise((res, rej) => reader.readEntries(res, rej)); if (!b.length) break; out.push(...b); }
  return out;
};
async function walk(entry, prefix, out, cap) {
  if (out.length > cap) return;
  if (entry.isFile) out.push({ path: prefix + entry.name, file: await entryFile(entry) });
  else if (entry.isDirectory) for (const c of await readAll(entry.createReader())) await walk(c, prefix + entry.name + '/', out, cap);
}
export async function readDrop(dt, cap = 3000) {
  const out = [];
  const items = [...(dt.items || [])].filter((i) => i.kind === 'file');
  const entries = items.map((i) => i.webkitGetAsEntry?.()).filter(Boolean);
  if (entries.length) for (const e of entries) await walk(e, '', out, cap);
  else for (const f of dt.files || []) out.push({ path: f.name, file: f });
  return out;
}
export const fromInput = (files) => [...files].map((f) => ({ path: f.webkitRelativePath || f.name, file: f }));
