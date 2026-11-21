// Penulis dan pembaca ZIP minimal (tanpa dependensi) untuk "Unduh ZIP" dan "Impor ZIP" ala repositori.
// Penulis memakai metode "store" (tanpa kompresi). Pembaca mendukung store dan deflate (DecompressionStream).

const CRC_T = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
export function crc32(u8) {
  let c = ~0;
  for (let i = 0; i < u8.length; i++) c = CRC_T[(c ^ u8[i]) & 255] ^ (c >>> 8);
  return ~c >>> 0;
}

const te = new TextEncoder();
const td = new TextDecoder();

function dosDateTime(d = new Date()) {
  const time = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1);
  const date = ((Math.max(1980, d.getFullYear()) - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return [time, date];
}

/** entries: [{ path, data: Uint8Array }]; path berakhir '/' untuk folder kosong. -> Uint8Array */
export function makeZip(entries) {
  const [time, date] = dosDateTime();
  const parts = [], central = [];
  let offset = 0;
  for (const e of entries) {
    const name = te.encode(e.path);
    const data = e.path.endsWith('/') ? new Uint8Array(0) : e.data;
    const crc = crc32(data);
    const lh = new DataView(new ArrayBuffer(30));
    lh.setUint32(0, 0x04034b50, true); lh.setUint16(4, 20, true); lh.setUint16(6, 0x0800, true);
    lh.setUint16(8, 0, true); lh.setUint16(10, time, true); lh.setUint16(12, date, true);
    lh.setUint32(14, crc, true); lh.setUint32(18, data.length, true); lh.setUint32(22, data.length, true);
    lh.setUint16(26, name.length, true); lh.setUint16(28, 0, true);
    parts.push(new Uint8Array(lh.buffer), name, data);
    const ch = new DataView(new ArrayBuffer(46));
    ch.setUint32(0, 0x02014b50, true); ch.setUint16(4, 20, true); ch.setUint16(6, 20, true); ch.setUint16(8, 0x0800, true);
    ch.setUint16(10, 0, true); ch.setUint16(12, time, true); ch.setUint16(14, date, true);
    ch.setUint32(16, crc, true); ch.setUint32(20, data.length, true); ch.setUint32(24, data.length, true);
    ch.setUint16(28, name.length, true); ch.setUint32(42, offset, true);
    central.push(new Uint8Array(ch.buffer), name);
    offset += 30 + name.length + data.length;
  }
  const cdSize = central.reduce((a, b) => a + b.length, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, entries.length, true); end.setUint16(10, entries.length, true);
  end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  const all = [...parts, ...central, new Uint8Array(end.buffer)];
  const out = new Uint8Array(all.reduce((a, b) => a + b.length, 0));
  let o = 0;
  for (const p of all) { out.set(p, o); o += p.length; }
  return out;
}

async function inflate(u8, limit) {
  const ds = new DecompressionStream('deflate-raw');
  const w = ds.writable.getWriter();
  w.write(u8).catch(() => {});
  w.close().catch(() => {});
  const r = ds.readable.getReader();
  const chunks = [];
  let n = 0;
  for (;;) {
    const { done, value } = await r.read();
    if (done) break;
    n += value.length;
    if (n > limit) { r.cancel().catch(() => {}); throw new Error('Isi ZIP terlalu besar'); }
    chunks.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const c of chunks) { out.set(c, o); o += c.length; }
  return out;
}

export const ZIP_LIMITS = { bytes: 50 * 1024 * 1024, files: 3000 };

/** Bersihkan path entri ZIP (cegah zip-slip). Mengembalikan null bila tidak aman. */
export function safeZipPath(p) {
  const segs = p.replace(/\\/g, '/').split('/').filter((s) => s && s !== '.');
  if (!segs.length || segs.some((s) => s === '..')) return null;
  return segs.map((s) => s.replace(/[:*?"<>|\u0000-\u001f]/g, '-')).join('/');
}

/** -> [{ path, data }] (hanya berkas). Menolak arsip yang terlalu besar atau berisi path berbahaya. */
export async function readZip(buf, limits = ZIP_LIMITS) {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 65557); i--) {
    if (dv.getUint32(i, true) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('Bukan berkas ZIP yang valid');
  const count = dv.getUint16(eocd + 10, true);
  if (count > limits.files) throw new Error('Terlalu banyak berkas dalam ZIP');
  let p = dv.getUint32(eocd + 16, true);
  const out = [];
  let total = 0;
  for (let k = 0; k < count; k++) {
    if (dv.getUint32(p, true) !== 0x02014b50) throw new Error('ZIP rusak');
    const flags = dv.getUint16(p + 8, true), method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true), usize = dv.getUint32(p + 24, true);
    const nl = dv.getUint16(p + 28, true), el = dv.getUint16(p + 30, true), cl = dv.getUint16(p + 32, true);
    const lho = dv.getUint32(p + 42, true);
    const name = td.decode(u8.subarray(p + 46, p + 46 + nl));
    p += 46 + nl + el + cl;
    if (flags & 1) throw new Error('ZIP terenkripsi tidak didukung');
    if (name.endsWith('/')) continue;
    const path = safeZipPath(name);
    if (!path) throw new Error('Path berbahaya di ZIP: ' + name);
    total += usize;
    if (total > limits.bytes) throw new Error('Isi ZIP melebihi batas ' + Math.round(limits.bytes / 1048576) + ' MB');
    const lnl = dv.getUint16(lho + 26, true), lel = dv.getUint16(lho + 28, true);
    const start = lho + 30 + lnl + lel;
    const raw = u8.subarray(start, start + csize);
    let data;
    if (method === 0) data = raw.slice();
    else if (method === 8) data = await inflate(raw, limits.bytes);
    else throw new Error('Metode kompresi ZIP tidak didukung: ' + method);
    out.push({ path, data });
  }
  return out;
}
