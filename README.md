# Voyager One — Fullstack Project Canvas

Visualisasi manajemen proyek bergaya **Fit · Build · Launch** dengan dukungan:
1. **Logo Studio** (`/api/settings`): Unggah logo PNG/JPG/SVG atau tempel URL logo kustom, atur ukuran & nama brand.
2. **Personalisasi Tema**: Pilih warna atmospheric glow (`periwinkle`, `coral`, `aurora`, `lavender`, `midnight`), mode permukaan (`light`, `paper`, `dark`), dan tipografi.
3. **CRUD Kartu & Proyek** (`/api/projects`, `/api/cards`, `/api/cards/[id]`): Tersimpan di SQLite via Prisma ORM.
4. **AI Idea Spark** (`/api/ai/brainstorm`): Generator ide kartu otomatis sesuai fase proyek.
5. **Time-Travel Snapshots** (`/api/snapshots`): Simpan dan pulihkan milestone proyek.

## Cara Menjalankan
```bash
cp .env.example .env
npm install
npx prisma db push
npm run dev
```
