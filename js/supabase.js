// Klien Supabase tanpa dependensi (hanya fetch): memanggil fungsi database lewat REST (PostgREST /rpc).
// Menirukan kontrak API server Node.js (jalur & bentuk respons yang sama) sehingga halaman tidak perlu tahu backend-nya.
//
// Login admin = username + password di tabel `admins` (lihat supabase/schema.sql). Fungsi admin_login mengembalikan token
// sesi acak; setiap aksi admin mengirim token itu sebagai argumen fungsi (p_token) dan diperiksa lagi di database.
// Kunci anon/publishable di config.js memang publik: tabel tidak bisa diakses langsung, hanya fungsi yang diizinkan.
import config from './settings.js';
import {
  UserError, supabaseProblem, validId, validateEventInput, newEvent, validateEntryInput, STATUSES,
} from './core.js';
import { getSbSession, setSbSession, clearSbSession } from './storage.js';

/** Sesi admin berakhir / tidak sah. mode.js memakainya untuk membersihkan status login. */
export class AuthExpired extends UserError {}

const SETUP_HINT = 'The Supabase database is not set up yet or is out of date. Run the latest supabase/schema.sql in the Supabase SQL Editor (see SUPABASE.md).';
const EXPIRED = 'Your admin session has expired. Please sign in again.';

const base = () => String(config.supabase?.url ?? '').trim().replace(/\/+$/, '');
const key = () => String(config.supabase?.anon_key ?? '').trim();

// ---------- HTTP ----------

async function http(method, path, { body } = {}) {
  const problem = supabaseProblem(config);
  if (problem) throw new UserError(problem);
  const headers = { apikey: key(), Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res;
  try {
    res = await fetch(base() + path, {
      method, headers, cache: 'no-store', credentials: 'omit', referrerPolicy: 'no-referrer',
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new UserError('Could not reach Supabase. Check your connection and try again.');
  }
  let data = null;
  try { const t = await res.text(); data = t ? JSON.parse(t) : null; } catch { /* bukan JSON */ }
  return { ok: res.ok, status: res.status, data };
}

/** Mengubah respons galat PostgREST menjadi UserError berbahasa Indonesia. */
function apiError(r) {
  const d = r.data ?? {};
  const code = String(d.code ?? '');
  const msg = String(d.message ?? '');
  if (code === 'P0001') return new UserError(msg || 'Request rejected.'); // RAISE EXCEPTION dari schema.sql: pesan aman ditampilkan
  if (code === 'PT401') return new AuthExpired(EXPIRED);
  if (['PGRST202', 'PGRST205', 'PGRST200', '42883', '42P01'].includes(code)) return new UserError(SETUP_HINT);
  if (r.status === 401) return new UserError('The Supabase key (anon_key) was rejected. Check supabase.anon_key in config.js.');
  if (r.status === 403 || code === '42501') return new UserError('Access denied by the database. Re-run the latest supabase/schema.sql (see SUPABASE.md).');
  if (code.startsWith('22') || code.startsWith('23')) return new UserError('The data does not meet the database rules.');
  if (r.status === 429) return new UserError('Too many requests. Please try again in a moment.');
  return new UserError(`Supabase returned HTTP ${r.status}.`);
}

/** Memanggil fungsi database (RPC) tanpa login. */
async function rpc(fn, args = {}) {
  const r = await http('POST', `/rest/v1/rpc/${fn}`, { body: args });
  if (!r.ok) throw apiError(r);
  return r.data;
}

/** Memanggil fungsi admin dengan token sesi. Token ditolak -> sesi lokal dibuang dan AuthExpired dilempar. */
async function adminRpc(fn, args = {}) {
  const s = getSbSession();
  if (!s) throw new AuthExpired(EXPIRED);
  const r = await http('POST', `/rest/v1/rpc/${fn}`, { body: { p_token: s.token, ...args } });
  if (!r.ok) {
    const e = apiError(r);
    if (e instanceof AuthExpired) clearSbSession();
    throw e;
  }
  return r.data;
}

// ---------- sesi ----------

/** Sesi admin yang tersimpan, atau null. */
export const sbSession = () => getSbSession();

async function login(body) {
  const username = String(body?.username ?? '').trim();
  const password = String(body?.password ?? '');
  if (!username || !password) throw new UserError('Username and password are required.');
  const d = await rpc('admin_login', { p_username: username, p_password: password });
  if (!d || typeof d !== 'object') throw new UserError('Unexpected response from Supabase. Make sure the latest supabase/schema.sql has been run.');
  if (d.ok !== true) throw new UserError(String(d.error || 'Incorrect username or password.'));
  if (typeof d.token !== 'string' || !/^[a-f0-9]{64}$/.test(d.token)) throw new UserError('Unexpected login response.');
  const hours = Number(config.session_hours) || 12;
  const serverUntil = Number.isFinite(d.expires_at) ? d.expires_at * 1000 : Infinity;
  setSbSession({
    token: d.token,
    username: String(d.username ?? username),
    expires_at: Number.isFinite(d.expires_at) ? d.expires_at : null,
    until: Math.min(Date.now() + hours * 3600 * 1000, serverUntil),
  });
  return { admin: { u: getSbSession()?.username ?? username } };
}

async function logout() {
  const s = getSbSession();
  clearSbSession();
  if (s) { try { await rpc('admin_logout', { p_token: s.token }); } catch { /* sudah keluar di sisi klien */ } }
  return { ok: true };
}

/**
 * Memeriksa sesi tersimpan saat halaman dimuat. true = admin sah; false = sesi dibuang;
 * galat jaringan tidak membuang sesi (dianggap true).
 */
export async function verifySession() {
  if (!getSbSession()) return false;
  try {
    await adminRpc('admin_session');
    return true;
  } catch (e) {
    if (e instanceof AuthExpired) return false;
    if (e instanceof UserError && /not set up yet|Access denied|anon_key/.test(e.message)) { clearSbSession(); return false; }
    return true;
  }
}

// ---------- data publik ----------

function asList(d) {
  if (!d || !Array.isArray(d.events)) throw new UserError('Unexpected response from Supabase. Make sure the latest supabase/schema.sql has been run.');
  return { today: d.today, events: d.events };
}

async function list() {
  if (getSbSession()) {
    try { return asList(await adminRpc('admin_list')); } catch (e) { if (!(e instanceof AuthExpired)) throw e; /* sesi habis: tampilkan data publik */ }
  }
  return asList(await rpc('get_published'));
}

async function submitEntry(eventId, body) {
  if (!validId(eventId)) throw new UserError('Event not found.');
  const v = validateEntryInput({ name: body?.name, amount: String(body?.amount ?? ''), transfer_date: body?.transfer_date });
  const entry = await rpc('submit_entry', { p_event_id: eventId, p_name: v.name, p_amount: v.amount, p_transfer_date: v.transfer_date });
  return { entry };
}

// ---------- admin ----------

const eventOf = (ev) => {
  if (!ev || typeof ev !== 'object') throw new UserError('Unexpected response from Supabase.');
  return { event: ev };
};

async function adminEvents(method, parts, body) {
  // parts: ['events'] | ['events', id] | ['events', id, 'close'|'reopen'|'entries'] | ['events', id, 'entries', eid, ('status')?]
  const [, id, sub, eid, leaf] = parts;
  if (parts.length === 1 && method === 'POST') {
    const ids = asList(await adminRpc('admin_list')).events.map((x) => x.id);
    const ev = newEvent(body, ids); // memvalidasi dan membuat slug unik
    return eventOf(await adminRpc('admin_create_event', {
      p_id: ev.id, p_name: ev.name, p_description: ev.description, p_start_date: ev.start_date, p_end_date: ev.end_date,
    }));
  }
  if (!validId(id)) throw new UserError('Event not found.');
  if (parts.length === 2 && method === 'PUT') {
    const v = validateEventInput(body);
    return eventOf(await adminRpc('admin_update_event', {
      p_id: id, p_name: v.name, p_description: v.description, p_start_date: v.start_date, p_end_date: v.end_date,
    }));
  }
  if (parts.length === 3 && (sub === 'close' || sub === 'reopen') && method === 'POST') {
    return eventOf(await adminRpc('admin_set_closed', { p_id: id, p_closed: sub === 'close' }));
  }
  if (sub === 'entries' && parts.length === 3 && method === 'POST') {
    const v = validateEntryInput({ name: body?.name, amount: String(body?.amount ?? ''), transfer_date: body?.transfer_date });
    return eventOf(await adminRpc('admin_add_entry', {
      p_event_id: id, p_name: v.name, p_amount: v.amount, p_transfer_date: v.transfer_date,
    }));
  }
  if (sub === 'entries' && /^[a-f0-9]{16}$/.test(eid ?? '')) {
    if (parts.length === 5 && leaf === 'status' && method === 'POST') {
      if (!STATUSES.includes(body?.status)) throw new UserError('Unknown status.');
      return eventOf(await adminRpc('admin_set_status', {
        p_event_id: id, p_entry_id: eid, p_status: body.status, p_note: String(body.note ?? ''),
      }));
    }
    if (parts.length === 4 && method === 'DELETE') {
      return eventOf(await adminRpc('admin_delete_entry', { p_event_id: id, p_entry_id: eid }));
    }
  }
  throw new UserError('Unknown request.');
}

// ---------- pintu masuk (jalur sama dengan API server Node.js) ----------

export async function supabaseApi(method, path, body) {
  const parts = String(path).split('/').filter(Boolean);
  const [a, b] = parts;
  if (method === 'GET' && path === 'session') {
    const s = getSbSession();
    return { admin: s ? { u: s.username } : null };
  }
  if (method === 'GET' && path === 'events') return list();
  if (a === 'events' && parts.length === 3 && parts[2] === 'entries' && method === 'POST') return submitEntry(b, body);
  if (a === 'admin') {
    if (b === 'login' && method === 'POST') return login(body);
    if (b === 'logout' && method === 'POST') return logout();
    if (b === 'events') return adminEvents(method, parts.slice(1), body ?? {});
  }
  throw new UserError('Unknown request.');
}
