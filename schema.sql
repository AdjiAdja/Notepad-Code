-- Skema Cloudflare D1 untuk Malude Notepad Ideas.
-- Jalankan:  npx wrangler d1 execute malude --remote --file=schema.sql

CREATE TABLE IF NOT EXISTS workspaces (
  id      TEXT PRIMARY KEY,
  name    TEXT NOT NULL,
  kind    TEXT NOT NULL CHECK (kind IN ('personal','team')),
  owner   TEXT NOT NULL,          -- sub akun Google pemilik
  vault   TEXT,                   -- JSON {salt,iter,check}; hanya metadata publik, passphrase tidak pernah dikirim
  domain  TEXT,                   -- opsional: hanya email dari domain ini yang boleh bergabung
  created INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS members (
  ws    TEXT NOT NULL,
  sub   TEXT NOT NULL,
  email TEXT,
  name  TEXT,
  role  TEXT NOT NULL CHECK (role IN ('viewer','editor','admin','owner')),
  added INTEGER NOT NULL,
  PRIMARY KEY (ws, sub)
);
CREATE INDEX IF NOT EXISTS members_sub ON members (sub);

-- Kode undangan disimpan sebagai hash SHA-256, bukan teks asli.
CREATE TABLE IF NOT EXISTS invites (
  hash  TEXT PRIMARY KEY,
  ws    TEXT NOT NULL,
  role  TEXT NOT NULL,
  email TEXT,
  exp   INTEGER NOT NULL,
  by    TEXT NOT NULL
);

-- data: JSON polos {name,kind,lang,content,star,mime} atau {s:{iv,ct}} bila workspace memakai vault.
CREATE TABLE IF NOT EXISTS nodes (
  ws     TEXT NOT NULL,
  id     TEXT NOT NULL,
  parent TEXT,
  type   TEXT NOT NULL CHECK (type IN ('file','folder')),
  u      INTEGER NOT NULL,        -- waktu ubah (last-write-wins)
  del    INTEGER NOT NULL DEFAULT 0,
  data   TEXT,
  seq    INTEGER NOT NULL,        -- urutan perubahan per workspace untuk sinkron delta
  PRIMARY KEY (ws, id)
);
CREATE INDEX IF NOT EXISTS nodes_seq ON nodes (ws, seq);

CREATE TABLE IF NOT EXISTS audit (
  id     INTEGER PRIMARY KEY AUTOINCREMENT,
  ws     TEXT NOT NULL,
  sub    TEXT,
  email  TEXT,
  action TEXT NOT NULL,
  detail TEXT,
  t      INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_ws ON audit (ws, id);
