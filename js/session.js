// Sesi admin.
//   supabase : token sesi dari admin_login di localStorage (diperiksa ulang oleh database di setiap aksi admin)
//   server   : cookie HttpOnly dari server Node.js
import { isSupabase, liveApi, setUnauthorizedHook } from './mode.js';
import { clearSbSession } from './storage.js';
import { verifySession } from './supabase.js';

let current = null;

setUnauthorizedHook(() => { current = null; });

export async function initSession() {
  try {
    if (isSupabase && !(await verifySession())) { current = null; return; }
    const d = await liveApi('GET', 'session');
    current = d.admin ? { u: d.admin.u } : null;
  } catch {
    current = null;
  }
}

export const currentSession = () => current;

export async function liveLogin(username, password) {
  const d = await liveApi('POST', 'admin/login', { username, password });
  current = { u: d.admin.u };
}

export async function logout() {
  try { await liveApi('POST', 'admin/logout', {}); } catch { /* tetap keluar di sisi klien */ }
  if (isSupabase) clearSbSession();
  current = null;
}
