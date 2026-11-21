// Klien HTTP tipis. Cookie sesi HttpOnly dikirim otomatis; header x-requested-with wajib (anti-CSRF).
export class ApiError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
let authLost = () => {};
export const onAuthLost = (f) => { authLost = f; };

export async function api(path, { method = 'GET', body } = {}) {
  let r;
  try {
    r = await fetch('/api' + path, {
      method, credentials: 'same-origin',
      headers: { 'content-type': 'application/json', 'x-requested-with': 'malude' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch { throw new ApiError(0, 'Tidak dapat terhubung ke server'); }
  let j = {};
  try { j = await r.json(); } catch { /* bukan JSON */ }
  if (!r.ok) {
    if (r.status === 401 && path !== '/login') authLost();
    throw new ApiError(r.status, j.error || 'Kesalahan ' + r.status);
  }
  return j;
}
