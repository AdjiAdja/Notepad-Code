// Pembungkus IndexedDB. Satu database per "scope" (tamu atau akun): malude-guest, malude-u-<sub>.
// Store: ws (workspace), nodes (berkas/folder, index per ws), kv (cadangan).

export const open = (scope) =>
  new Promise((res, rej) => {
    const r = indexedDB.open('malude-' + scope, 1);
    r.onupgradeneeded = () => {
      const d = r.result;
      d.createObjectStore('ws', { keyPath: 'id' });
      d.createObjectStore('nodes', { keyPath: 'id' }).createIndex('ws', 'ws');
      d.createObjectStore('kv');
    };
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
    r.onblocked = () => rej(new Error('Database terblokir oleh tab lain'));
  });

export const rq = (r) =>
  new Promise((res, rej) => {
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  });

const st = (db, s, m = 'readonly') => db.transaction(s, m).objectStore(s);
export const all = (db, s) => rq(st(db, s).getAll());
export const get = (db, s, k) => rq(st(db, s).get(k));
export const put = (db, s, v, k) => rq(st(db, s, 'readwrite').put(v, k));
export const del = (db, s, k) => rq(st(db, s, 'readwrite').delete(k));
export const nodesOf = (db, ws) => rq(st(db, 'nodes').index('ws').getAll(ws));

export async function delWs(db, id) {
  const keys = await rq(st(db, 'nodes').index('ws').getAllKeys(id));
  const tx = db.transaction(['ws', 'nodes'], 'readwrite');
  tx.objectStore('ws').delete(id);
  const ns = tx.objectStore('nodes');
  keys.forEach((k) => ns.delete(k));
  return new Promise((res, rej) => { tx.oncomplete = res; tx.onerror = () => rej(tx.error); });
}
