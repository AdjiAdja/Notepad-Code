// Login Google (Google Identity Services). Server memverifikasi token lalu menerbitkan cookie sesi HttpOnly.
import { api, ApiError } from './api.js';

const KEY = 'mni.user';
export const cachedUser = () => { try { return JSON.parse(localStorage.getItem(KEY)); } catch { return null; } };
const cache = (u) => { try { u ? localStorage.setItem(KEY, JSON.stringify(u)) : localStorage.removeItem(KEY); } catch { /* abaikan */ } };
export const scopeOf = (u) => (u ? 'u-' + String(u.sub).replace(/[^a-z0-9]/gi, '').slice(0, 40) : 'guest');

/** { user, offline } — offline=true bila server tak terjangkau tetapi ada pengguna tersimpan. */
export async function restore() {
  try { const { user } = await api('/me'); cache(user); return { user, offline: false }; }
  catch (e) {
    if (e instanceof ApiError && e.status === 0) { const u = cachedUser(); return { user: u, offline: !!u }; }
    cache(null); return { user: null, offline: false };
  }
}

export async function loginWithCredential(credential) {
  const { user } = await api('/login', { method: 'POST', body: { credential } });
  cache(user); return user;
}
export async function logout() { try { await api('/logout', { method: 'POST' }); } catch { /* abaikan */ } cache(null); }

const waitGsi = () => new Promise((res, rej) => {
  let n = 0;
  const t = setInterval(() => {
    if (window.google?.accounts?.id) { clearInterval(t); res(window.google.accounts.id); }
    else if (++n > 100) { clearInterval(t); rej(new Error('Google Identity Services tidak termuat')); }
  }, 100);
});

export async function renderGoogleButton(el, onCredential, onError) {
  const id = window.APP?.googleClientId;
  if (!id) { onError?.(new Error('googleClientId belum diisi di config.js')); return false; }
  try {
    const g = await waitGsi();
    g.initialize({ client_id: id, callback: (r) => onCredential(r.credential), ux_mode: 'popup' });
    g.renderButton(el, { theme: 'filled_black', size: 'large', shape: 'rectangular', text: 'continue_with', width: 240 });
    return true;
  } catch (e) { onError?.(e); return false; }
}

/** Hanya untuk dev lokal (server menolak di luar localhost). */
export const devLogin = (email, name) => loginWithCredential(`dev:${email}:${name}`);
