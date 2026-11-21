# Malude Notepad Ideas

Notepad untuk developer, fullstack, dan tim: kode dengan syntax highlight, Markdown, dokumen engineering, gambar/PDF,
vault terenkripsi, riwayat versi, dan workspace tim dengan peran. Lokal-pertama (IndexedDB), sinkron opsional lewat
Cloudflare Pages Functions + D1. Tanpa build step, tanpa CDN untuk kode (hanya Google Fonts dan Google Sign-In).

## Struktur repo

```
malude-notepad-ideas/
├─ index.html              Kerangka halaman (tanpa script/style inline → CSP ketat)
├─ config.js               Konfigurasi publik: googleClientId
├─ sw.js, manifest.webmanifest   PWA (network-first, /api tidak di-cache)
├─ _headers                CSP, HSTS, nosniff, Permissions-Policy, COOP
├─ wrangler.toml, schema.sql     Binding D1 + skema (workspaces, members, invites, nodes, audit)
├─ assets/                 Logo (SVG vektor), ikon PWA, media latar
├─ src/
│  ├─ styles/              base · folder (kraft) · sheet (lembar biru) · side (badge, kertas sobek) · ui
│  └─ js/
│     ├─ main.js           Boot, pintasan, kunci otomatis, ?join=KODE
│     ├─ store.js          Model workspace/pohon berkas, vault, riwayat, impor/ekspor (tanpa DOM, diuji di Node)
│     ├─ vault.js          PBKDF2-SHA256 600k → AES-256-GCM, AAD terikat ws:id
│     ├─ sync.js, api.js, auth.js    Sinkron delta LWW, klien HTTP, login Google
│     ├─ db.js, tree.js, md.js, highlight.js, secrets.js, zip.js, util.js, dnd.js, bg.js, actions.js
│     └─ ui/               top · explorer · center (editor/preview/riwayat/Run JS) · side · dialogs · dom
├─ functions/api/[[path]].js   Backend: login, workspace, peran, undangan, sinkron, audit
├─ scripts/                dev-server.mjs (+ shim D1 di atas node:sqlite), d1-shim.mjs
├─ tests/                  core · store · server · sync (node --test)
└─ docs/                   ARCHITECTURE.md · SECURITY.md · DEPLOY.md
```

## Jalankan lokal

```bash
npm install
npm run dev        # http://localhost:8788 — DEV LOGIN aktif (hanya localhost)
npm test           # 30 tes
```

Deploy ke Cloudflare: lihat `docs/DEPLOY.md`.

## Fitur utama

- **Explorer seperti repo GitHub**: folder bersarang, drag-drop (juga dari OS, termasuk folder), impor/ekspor ZIP, README folder dirender otomatis.
- **Editor**: highlight 30+ bahasa, nomor baris, indentasi, format JSON, **Run JS** terisolasi di Worker (batas 5 dtk), Markdown dengan `[[wiki link]]`, tautan balik, task list.
- **Riwayat versi + diff** per berkas, pemulihan satu klik, templat engineering (README, ADR, runbook, incident, API, .env.example, rapat, bug).
- **Vault**: nama, isi, riwayat, lampiran dienkripsi di browser; server tim hanya melihat ciphertext.
- **Tim**: peran viewer/editor/admin/owner ditegakkan di server, undangan sekali pakai (hash), batas domain email, log audit.
- **Pemindai rahasia**: berkas berisi kunci/token tidak disinkron ke cloud kecuali workspace memakai vault.
- Palet perintah (Ctrl+K), cari isi (Ctrl+Shift+F), kunci panik (Ctrl+Shift+L), kunci otomatis.
