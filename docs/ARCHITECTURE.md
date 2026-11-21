# Arsitektur

- **Lokal-pertama**: IndexedDB per scope (`malude-guest`, `malude-u-<sub>`). Store: `ws`, `nodes`, `kv`.
- **Node**: `{id, ws, parent, type, name, kind, lang, content, blob, star, hist, u, d}`; hapus = tombstone (`del`).
- **Vault**: record tersimpan `{sealed, hs?, bs?}`; metadata `{salt, iter, check}` di workspace.
- **Sinkron**: `POST /api/ws/:id/sync {since, nodes[≤40]}`; server upsert `WHERE excluded.u > nodes.u` dengan `seq` per workspace; tarik `seq > since` (200/halaman). Konflik: salinan lokal `(konflik …)`.
- **Backend**: satu Pages Function `functions/api/[[path]].js` + D1. Batas 40 node/permintaan menjaga di bawah 50 query per invokasi (free plan).
- **UI**: modul ES tanpa framework; `h()` membuat DOM dengan setAttribute (aman CSP).
