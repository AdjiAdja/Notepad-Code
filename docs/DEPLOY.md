# Deploy ke Cloudflare Pages

1. **Google OAuth**: Google Cloud Console → Credentials → OAuth client ID (Web). Tambah *Authorized JavaScript origins*: `https://<proyek>.pages.dev` (dan domain kustom). Salin Client ID.
2. Isi `config.js`: `window.APP = { googleClientId: "<CLIENT_ID>", devLogin: false };`
3. **D1**: `npx wrangler d1 create malude` → salin `database_id` ke `wrangler.toml` → `npm run db:init:remote`.
4. **Pages**: hubungkan repo (build command kosong, output directory `/`) atau `npx wrangler pages deploy .`.
5. Pages → Settings → Variables and Secrets (Production):
   - `GOOGLE_CLIENT_ID` = Client ID yang sama
   - `SESSION_SECRET` = string acak ≥ 32 karakter (secret)
   - `ALLOWED_DOMAINS` (opsional) = `perusahaan.co.id,anak.co.id`
   - Binding D1: variable name `DB`.
   - **Jangan** set `DEV_LOGIN` di produksi.
6. Aktifkan rate limiting/WAF Cloudflare untuk `/api/login` dan `/api/join`.

Catatan: versi lama (berbasis KV) tidak kompatibel; data lama di browser belum dimigrasikan otomatis.
