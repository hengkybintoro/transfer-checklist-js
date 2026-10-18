// Sesi admin. Mode statis: sessionStorage (gerbang tampilan). Mode server: cookie HttpOnly dari server.
import { isServer, serverApi, setUnauthorizedHook } from './mode.js';
import { getSession, clearSession } from './storage.js';

let current = null; // hanya dipakai di mode server

setUnauthorizedHook(() => { current = null; });

export async function initSession() {
  if (!isServer) return;
  try {
    const d = await serverApi('GET', 'session');
    current = d.admin ? { u: d.admin.u } : null;
  } catch {
    current = null;
  }
}

export const currentSession = () => (isServer ? current : getSession());

export async function serverLogin(username, password) {
  const d = await serverApi('POST', 'admin/login', { username, password });
  current = { u: d.admin.u };
}

export async function logout() {
  if (isServer) {
    try { await serverApi('POST', 'admin/logout', {}); } catch { /* tetap keluar di sisi klien */ }
    current = null;
  } else {
    clearSession();
  }
}
