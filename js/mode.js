// Backend aplikasi:
//   'supabase' (bawaan)  frontend statis (mis. GitHub Pages) + database Supabase (PostgreSQL) lewat REST (fungsi database).
//   'server'             disajikan server Node.js (menghasilkan config.js dengan mode: 'server'); data di file JSON server.
// Kedua backend memakai kontrak API yang sama (jalur & bentuk respons), sehingga halaman tidak perlu tahu backend-nya.
import config from './settings.js';
import { UserError } from './core.js';
import { supabaseApi, sbSession, AuthExpired } from './supabase.js';

export const isServer = config.mode === 'server';
export const isSupabase = !isServer;

let unauthorizedHook = () => {};
export const setUnauthorizedHook = (fn) => { unauthorizedHook = fn; };

/** Memanggil backend. Galat jaringan/HTTP diubah menjadi UserError dengan pesan yang aman ditampilkan. */
export async function liveApi(method, path, body) {
  if (isSupabase) {
    const hadSession = Boolean(sbSession());
    try {
      const out = await supabaseApi(method, path, body);
      // daftar event jatuh ke data publik bila token admin ditolak: beri tahu aplikasi bahwa sesi sudah hilang
      if (hadSession && !sbSession()) unauthorizedHook();
      return out;
    } catch (e) {
      if (e instanceof AuthExpired) unauthorizedHook();
      throw e;
    }
  }
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
