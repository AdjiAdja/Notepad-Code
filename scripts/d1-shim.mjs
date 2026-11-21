// Shim D1 di atas node:sqlite — hanya untuk dev lokal dan tes. Produksi memakai D1 asli.
import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';

export function makeD1(file = ':memory:', schemaPath = new URL('../schema.sql', import.meta.url)) {
  const db = new DatabaseSync(file);
  db.exec(readFileSync(schemaPath, 'utf8'));
  const norm = (r) => (r ? { ...r } : null);
  const stmt = (sql, args = []) => ({
    sql, args,
    bind: (...a) => stmt(sql, a),
    first: async () => norm(db.prepare(sql).get(...args)),
    all: async () => ({ results: db.prepare(sql).all(...args).map(norm) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
    _run() {
      const p = db.prepare(sql);
      if (/^\s*select/i.test(sql)) return { results: p.all(...args).map(norm), meta: { changes: 0 } };
      const r = p.run(...args);
      return { results: [], meta: { changes: Number(r.changes) } };
    },
  });
  return {
    raw: db,
    prepare: (sql) => stmt(sql),
    batch: async (list) => {
      db.exec('BEGIN');
      try { const out = list.map((s) => s._run()); db.exec('COMMIT'); return out; }
      catch (e) { db.exec('ROLLBACK'); throw e; }
    },
  };
}
