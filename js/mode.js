// Mode aplikasi. "server" bila disajikan oleh server Node.js (yang menghasilkan config.js dengan mode: 'server');
// selain itu mode statis untuk GitHub Pages (data dari file JSON + kode kirim).
import config from './settings.js';
import { UserError } from './core.js';

export const isServer = config.mode === 'server';

let unauthorizedHook = () => {};
export const setUnauthorizedHook = (fn) => { unauthorizedHook = fn; };

/** Memanggil API server. Galat jaringan/HTTP diubah menjadi UserError dengan pesan dari server. */
export async function serverApi(method, path, body) {
  let res;
  try {
    res = await fetch(`api/${path}`, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      headers: method === 'GET' ? {} : { 'Content-Type': 'application/json', 'X-TC-Request': '1' },
      body: method === 'GET' || body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new UserError('Tidak dapat menghubungi server. Periksa koneksi Anda lalu coba lagi.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* bukan JSON */ }
  if (!res.ok) {
    if (res.status === 401 && path.startsWith('admin/') && path !== 'admin/login') unauthorizedHook();
    throw new UserError(data?.error ?? `Server mengembalikan HTTP ${res.status}.`);
  }
  return data ?? {};
}
