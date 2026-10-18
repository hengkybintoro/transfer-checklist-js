// Penyimpanan sesi admin Supabase di browser (localStorage), tahan error:
// bila diblokir (mode privat, dsb.) jatuh ke memori selama halaman terbuka.
const mem = new Map();

function safe() {
  try { return window.localStorage; } catch { return null; }
}

function read(key, fallback) {
  const store = safe();
  if (!store) return mem.has(key) ? mem.get(key) : fallback;
  try {
    const raw = store.getItem(key);
    return raw === null ? (mem.has(key) ? mem.get(key) : fallback) : JSON.parse(raw);
  } catch {
    return mem.has(key) ? mem.get(key) : fallback;
  }
}

function write(key, value) {
  try {
    safe().setItem(key, JSON.stringify(value));
    mem.delete(key);
  } catch {
    mem.set(key, value);
  }
}

// ----- sesi admin Supabase (token sesi dari admin_login) -----
// Disimpan di localStorage dan dibatasi umur lokal "until" (config.session_hours, maksimal umur sesi di server).

export function getSbSession() {
  const s = read('tc.sb', null);
  if (!s || typeof s.token !== 'string' || typeof s.username !== 'string') return null;
  if (typeof s.until === 'number' && s.until < Date.now()) { clearSbSession(); return null; }
  return s;
}
export const setSbSession = (s) => write('tc.sb', s);
export function clearSbSession() {
  mem.delete('tc.sb');
  try { safe()?.removeItem('tc.sb'); } catch { /* abaikan */ }
}
