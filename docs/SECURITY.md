# Keamanan

| Area | Mekanisme |
|---|---|
| Sesi | Token Google diverifikasi server (aud, iss, exp, email_verified); cookie `__Host-sid` HttpOnly, Secure, SameSite=Strict, HMAC |
| CSRF | Cek Origin + header `x-requested-with: malude` pada semua non-GET |
| Otorisasi | Peran dicek di server pada setiap rute; viewer tidak bisa push |
| Undangan | Kode acak 20 karakter, disimpan sebagai SHA-256, sekali pakai, kedaluwarsa 7 hari, opsional terikat email/domain |
| Enkripsi | Vault: PBKDF2-SHA256 600k → AES-256-GCM, kunci non-extractable, AAD `ws:id`; passphrase tak pernah dikirim |
| CSP | script-src self + Google Sign-In saja, tanpa inline script, object-src none, frame-ancestors none |
| Konten | Markdown di-escape dulu, tanpa gambar remote, skema tautan di-whitelist; Run JS di Worker blob + timeout |
| ZIP | Anti zip-slip, batas 50 MB / 3000 berkas |
| Rahasia | Pemindai pola kunci/token menahan berkas dari sinkron (workspace tanpa vault) |

## Batas yang jujur
- Server melihat struktur (id, parent, tipe, waktu) dan peran; dengan vault, nama & isi tidak terlihat.
- Passphrase vault hilang = data tidak bisa dipulihkan. Mengganti passphrase tidak mencabut akses ke salinan data yang sudah pernah diunduh anggota.
- Lampiran biner dan riwayat versi tidak disinkron. Last-write-wins per berkas (konflik disimpan sebagai salinan).
- Tidak ada audit pihak ketiga; pertimbangkan sebelum dipakai untuk data sangat sensitif. Rate limiting diserahkan ke Cloudflare WAF.
