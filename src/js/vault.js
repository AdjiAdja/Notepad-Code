// Enkripsi vault: PBKDF2-SHA256 -> AES-256-GCM (WebCrypto). Semua operasi terjadi di browser.
// Setiap blob terikat ke konteksnya lewat AAD (mis. "<workspace>:<node>"), jadi ciphertext
// tidak bisa dipindahkan diam-diam ke node lain.

import { toB64, fromB64 } from './util.js';

const te = new TextEncoder();
const td = new TextDecoder();
export const ITER = 600000; // rekomendasi OWASP untuk PBKDF2-HMAC-SHA256

export async function deriveKey(pass, salt, iter = ITER) {
  const base = await crypto.subtle.importKey('raw', te.encode(pass), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' },
    base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

export async function sealBytes(key, bytes, aad = '') {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ct = await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: te.encode(aad) }, key, bytes);
  return { iv: toB64(iv), ct: toB64(ct) };
}

export async function openBytes(key, { iv, ct }, aad = '') {
  const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: fromB64(iv), additionalData: te.encode(aad) }, key, fromB64(ct));
  return new Uint8Array(pt);
}

export const seal = (key, obj, aad = '') => sealBytes(key, te.encode(JSON.stringify(obj)), aad);
export const open = async (key, s, aad = '') => JSON.parse(td.decode(await openBytes(key, s, aad)));

/** Buat vault baru: kembalikan kunci (non-extractable) dan metadata publik (salt, iterasi, check). */
export async function createVault(pass, iter = ITER) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const key = await deriveKey(pass, salt, iter);
  const check = await seal(key, { ok: 'malude' }, 'check');
  return { key, meta: { salt: toB64(salt), iter, check } };
}

/** Buka vault. Melempar error bila passphrase salah. */
export async function unlockVault(pass, meta) {
  const key = await deriveKey(pass, fromB64(meta.salt), meta.iter);
  const r = await open(key, meta.check, 'check');
  if (r.ok !== 'malude') throw new Error('Passphrase salah');
  return key;
}

/** Skor kekuatan passphrase 0-4 (heuristik sederhana, bukan pengganti zxcvbn). */
export function strength(p) {
  let s = 0;
  if (p.length >= 12) s++;
  if (p.length >= 16) s++;
  if (/[a-z]/.test(p) && /[A-Z]/.test(p)) s++;
  if (/\d/.test(p) && /[^A-Za-z0-9]/.test(p)) s++;
  if (/^(.)\1+$/.test(p) || /^(password|12345678|qwerty)/i.test(p)) s = 0;
  return Math.min(4, s);
}
