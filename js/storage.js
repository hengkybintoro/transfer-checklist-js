// Penyimpanan di browser (localStorage), tahan error: bila diblokir (mode privat, dsb.) jatuh ke memori.
import { normalizeEvent, UserError } from './core.js';

const mem = new Map();
let persistent = true;

function read(store, key, fallback) {
  try {
    const raw = store.getItem(key);
    return raw === null ? fallback : JSON.parse(raw);
  } catch {
    return mem.has(key) ? mem.get(key) : fallback;
  }
}

function write(store, key, value) {
  try {
    store.setItem(key, JSON.stringify(value));
    mem.delete(key);
  } catch {
    persistent = false;
    mem.set(key, value);
  }
}

function safe(getStore) {
  try { return getStore(); } catch { return { getItem: () => null, setItem: () => { throw new Error('blocked'); } }; }
}

const local = () => safe(() => window.localStorage);
const session = () => safe(() => window.sessionStorage);

export const isPersistent = () => persistent;

// ----- salinan kerja admin: { [eventId]: event } -----

export function adminEvents() {
  const raw = read(local(), 'tc.admin.events', {});
  const out = new Map();
  if (raw && typeof raw === 'object') {
    for (const v of Object.values(raw)) {
      try { const ev = normalizeEvent(v); out.set(ev.id, ev); } catch (e) { if (!(e instanceof UserError)) throw e; }
    }
  }
  return out;
}

export function saveAdminEvent(ev) {
  const raw = read(local(), 'tc.admin.events', {});
  raw[ev.id] = normalizeEvent(ev);
  write(local(), 'tc.admin.events', raw);
}

export function removeAdminEvent(id) {
  const raw = read(local(), 'tc.admin.events', {});
  delete raw[id];
  write(local(), 'tc.admin.events', raw);
}

// ----- entri milik peserta di perangkat ini -----

export function myEntries() {
  const raw = read(local(), 'tc.mine', []);
  return Array.isArray(raw) ? raw.filter((x) => x && typeof x.code === 'string' && typeof x.eventId === 'string') : [];
}

export function addMyEntry(item) {
  write(local(), 'tc.mine', [...myEntries(), item]);
}

export function removeMyEntry(entryId) {
  write(local(), 'tc.mine', myEntries().filter((x) => x.id !== entryId));
}

// ----- sesi admin & pembatasan percobaan login -----

export function getSession() {
  const s = read(session(), 'tc.session', null);
  if (!s || typeof s.u !== 'string' || typeof s.exp !== 'number' || s.exp < Date.now()) return null;
  return s;
}
export const setSession = (s) => write(session(), 'tc.session', s);
export function clearSession() {
  try { session().removeItem('tc.session'); } catch { /* abaikan */ }
}

export const getLock = () => read(local(), 'tc.lock', { fails: 0, until: 0 });
export const setLock = (l) => write(local(), 'tc.lock', l);
