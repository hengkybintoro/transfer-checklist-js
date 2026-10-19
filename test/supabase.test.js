// Uji klien Supabase (js/supabase.js) dengan fetch palsu: bentuk permintaan, penanganan sesi, dan pemetaan galat.
// Tidak butuh jaringan atau proyek Supabase sungguhan.
import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';

const store = new Map();
globalThis.window = {
  localStorage: {
    getItem: (k) => (store.has(k) ? store.get(k) : null),
    setItem: (k, v) => { store.set(k, String(v)); },
    removeItem: (k) => { store.delete(k); },
  },
};

const { default: config } = await import('../js/settings.js');
const { supabaseApi, sbSession, verifySession, AuthExpired } = await import('../js/supabase.js');
const { UserError } = await import('../js/core.js');

const URL_BASE = 'https://abcdefgh.supabase.co';
const KEY = 'sb_publishable_abcdefghijklmnop';
const EV_ID = 'arisan';
const EID = 'a1b2c3d4e5f60718';

const eventRow = (over = {}) => ({
  id: EV_ID, name: 'Arisan', description: '', start_date: '2026-10-01', end_date: '2026-10-31',
  created_at: '2026-10-01T00:00:00+00:00', closed_at: null, closed_by: '',
  entries: [{ id: EID, name: 'Budi', amount: 1000, transfer_date: '2026-10-02', submitted_at: '2026-10-02T03:00:00+00:00', status: 'pending', admin_note: '', verified_at: null }],
  ...over,
});

let calls;
let handler;
function fakeFetch(url, init = {}) {
  const u = new URL(url);
  const req = { method: init.method ?? 'GET', url: u, path: u.pathname + u.search, headers: init.headers ?? {}, body: init.body ? JSON.parse(init.body) : undefined };
  calls.push(req);
  const out = handler(req);
  const [status, json] = out ?? [500, { message: 'tak ada handler' }];
  return Promise.resolve({ ok: status >= 200 && status < 300, status, text: async () => (json === undefined ? '' : JSON.stringify(json)) });
}
globalThis.fetch = fakeFetch;

const TOKEN = 'ab'.repeat(32);
const session = (over = {}) => ({
  token: TOKEN, username: 'irene', expires_at: Math.floor(Date.now() / 1000) + 3600, until: Date.now() + 3600_000, ...over,
});
const loginAs = (over) => store.set('tc.sb', JSON.stringify(session(over)));

beforeEach(() => {
  store.clear();
  calls = [];
  handler = null;
  config.timezone = 'Asia/Jakarta';
  config.session_hours = 12;
  config.supabase = { url: URL_BASE, anon_key: KEY };
});

const rejects = (p, re, cls = UserError) => assert.rejects(p, (e) => { assert.ok(e instanceof cls, `kelas galat: ${e?.constructor?.name}: ${e?.message}`); assert.match(e.message, re); return true; });

// ---------- konfigurasi ----------

test('config belum diisi: galat jelas tanpa memanggil jaringan', async () => {
  config.supabase = { url: 'https://PROJECT-REF.supabase.co', anon_key: 'ganti-dengan-anon-key' };
  await rejects(supabaseApi('GET', 'events'), /supabase\.url is not set/);
  assert.equal(calls.length, 0);
});

test('blok admin lama di config.js (username + hash) diabaikan: login tetap lewat database', async () => {
  config.admin = { username: 'irene', password_sha256: 'b6596e8c458b71dcb89236a9762dcde8a1ea99992cec62a12bd627d34d7d9e30' };
  handler = () => [200, { ok: false, error: 'Incorrect username or password.' }];
  await rejects(supabaseApi('POST', 'admin/login', { username: 'irene', password: 'password-lama' }), /Incorrect username or password/);
  assert.equal(calls.length, 1);
  assert.match(calls[0].path, /^\/rest\/v1\/rpc\/admin_login/); // diteruskan ke database, tidak dicocokkan lokal
  assert.equal(sbSession(), null);
  delete config.admin;
});

test('kunci rahasia ditolak', async () => {
  config.supabase = { url: URL_BASE, anon_key: 'sb_secret_abcdefghijklmnopqrstuv' };
  await rejects(supabaseApi('GET', 'events'), /Do NOT use a secret/);
  assert.equal(calls.length, 0);
});

// ---------- publik ----------

test('daftar publik: rpc get_published hanya dengan apikey (tanpa Authorization)', async () => {
  handler = () => [200, { today: '2026-10-18', events: [eventRow()] }];
  const d = await supabaseApi('GET', 'events');
  assert.equal(d.today, '2026-10-18');
  assert.equal(d.events.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, 'POST');
  assert.equal(calls[0].url.origin + calls[0].url.pathname, `${URL_BASE}/rest/v1/rpc/get_published`);
  assert.equal(calls[0].headers.apikey, KEY);
  assert.equal(calls[0].headers.Authorization, undefined);
});

test('daftar: token admin ditolak (PT401) -> sesi dibuang dan data publik ditampilkan', async () => {
  loginAs();
  handler = (r) => (r.path.endsWith('/admin_list')
    ? [401, { code: 'PT401', message: 'Your admin session is invalid or has expired. Please sign in again.' }]
    : [200, { today: '2026-10-18', events: [] }]);
  const d = await supabaseApi('GET', 'events');
  assert.deepEqual(d.events, []);
  assert.equal(sbSession(), null);
  assert.match(calls.at(-1).path, /get_published$/);
  assert.equal(calls.at(-1).headers.Authorization, undefined);
});

test('respons yang bukan hasil get_published ditolak dengan pesan setup', async () => {
  handler = () => [200, { foo: 1 }];
  await rejects(supabaseApi('GET', 'events'), /schema\.sql/);
});

test('fungsi belum dibuat (PGRST202) -> petunjuk menjalankan schema.sql', async () => {
  handler = () => [404, { code: 'PGRST202', message: 'Could not find the function public.get_published' }];
  await rejects(supabaseApi('GET', 'events'), /not set up yet.*schema\.sql/);
});

test('anon_key salah (401 tanpa token) -> pesan kunci ditolak', async () => {
  handler = () => [401, { message: 'Invalid API key' }];
  await rejects(supabaseApi('GET', 'events'), /anon_key.*rejected/);
});

test('galat jaringan -> pesan ramah', async () => {
  handler = () => { throw new TypeError('Failed to fetch'); };
  await rejects(supabaseApi('GET', 'events'), /Could not reach Supabase/);
});

test('submit: memvalidasi dulu di klien, mengirim parameter RPC, mengembalikan entri', async () => {
  await rejects(supabaseApi('POST', `events/${EV_ID}/entries`, { name: '', amount: '1000', transfer_date: '2026-10-02' }), /Name is required/);
  await rejects(supabaseApi('POST', `events/${EV_ID}/entries`, { name: 'A', amount: 'abc', transfer_date: '2026-10-02' }), /whole number/);
  await rejects(supabaseApi('POST', 'events/BAD ID/entries', { name: 'A', amount: '1', transfer_date: '2026-10-02' }), /not found/);
  assert.equal(calls.length, 0);

  handler = () => [200, { id: EID, name: 'Budi', amount: 1500000, transfer_date: '2026-10-02', submitted_at: '2026-10-18T05:00:00+00:00', status: 'pending', admin_note: '', verified_at: null }];
  const r = await supabaseApi('POST', `events/${EV_ID}/entries`, { name: '  Budi  ', amount: 'Rp 1.500.000', transfer_date: '2026-10-02' });
  assert.equal(r.entry.id, EID);
  assert.deepEqual(calls[0].body, { p_event_id: EV_ID, p_name: 'Budi', p_amount: 1500000, p_transfer_date: '2026-10-02' });
  assert.equal(calls[0].headers.Authorization, undefined);
});

test('submit: pesan RAISE EXCEPTION (P0001) ditampilkan apa adanya; galat lain digeneralisasi', async () => {
  handler = () => [400, { code: 'P0001', message: 'This event has been closed by an admin. New entries are no longer accepted.' }];
  await rejects(supabaseApi('POST', `events/${EV_ID}/entries`, { name: 'A', amount: '1000', transfer_date: '2026-10-02' }), /closed by an admin/);
  handler = () => [400, { code: '22003', message: 'bigint out of range' }];
  await rejects(supabaseApi('POST', `events/${EV_ID}/entries`, { name: 'A', amount: '1000', transfer_date: '2026-10-02' }), /does not meet the database rules/);
  handler = () => [429, { message: 'rate' }];
  await rejects(supabaseApi('POST', `events/${EV_ID}/entries`, { name: 'A', amount: '1000', transfer_date: '2026-10-02' }), /Too many/);
});

// ---------- login ----------


// ---------- login ----------

const okLogin = (over = {}) => ({ ok: true, token: TOKEN, username: 'irene', expires_at: Math.floor(Date.now() / 1000) + 12 * 3600, ...over });

test('login berhasil: memanggil admin_login dengan username+password, menyimpan token, tanpa header Authorization', async () => {
  handler = () => [200, okLogin()];
  const r = await supabaseApi('POST', 'admin/login', { username: '  Irene ', password: 'rahasia-panjang-1' });
  assert.deepEqual(r, { admin: { u: 'irene' } });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, '/rest/v1/rpc/admin_login');
  assert.deepEqual(calls[0].body, { p_username: 'Irene', p_password: 'rahasia-panjang-1' });
  assert.equal(calls[0].headers.Authorization, undefined);
  assert.equal(calls[0].headers.apikey, KEY);
  const s = sbSession();
  assert.equal(s.token, TOKEN); assert.equal(s.username, 'irene');
  assert.ok(s.until > Date.now() && s.until <= Date.now() + 12 * 3600_000 + 1000);
  const raw = JSON.parse(store.get('tc.sb'));
  assert.ok(!JSON.stringify(raw).includes('rahasia'), 'password tidak disimpan');
});

test('login: umur lokal mengikuti session_hours, tidak melebihi umur sesi di server', async () => {
  config.session_hours = 1;
  handler = () => [200, okLogin()];
  await supabaseApi('POST', 'admin/login', { username: 'irene', password: 'x' });
  assert.ok(sbSession().until <= Date.now() + 3600_000 + 1000);
  store.clear(); config.session_hours = 48;
  handler = () => [200, okLogin({ expires_at: Math.floor(Date.now() / 1000) + 600 })];
  await supabaseApi('POST', 'admin/login', { username: 'irene', password: 'x' });
  assert.ok(sbSession().until <= Date.now() + 601_000);
});

test('login: kolom kosong ditolak di klien; password salah / diblokir memakai pesan dari database', async () => {
  await rejects(supabaseApi('POST', 'admin/login', { username: '', password: 'x' }), /Username and password are required/);
  await rejects(supabaseApi('POST', 'admin/login', { username: 'irene', password: '' }), /Username and password are required/);
  assert.equal(calls.length, 0);
  handler = () => [200, { ok: false, error: 'Incorrect username or password.' }];
  await rejects(supabaseApi('POST', 'admin/login', { username: 'irene', password: 'salah' }), /Incorrect username or password/);
  handler = () => [200, { ok: false, error: 'Too many failed attempts. Please try again in a few minutes.' }];
  await rejects(supabaseApi('POST', 'admin/login', { username: 'irene', password: 'salah' }), /Too many failed attempts/);
  assert.equal(sbSession(), null);
});

test('login: respons tak dikenal (token bukan 64 hex / bukan objek) ditolak; fungsi belum ada -> petunjuk schema.sql', async () => {
  handler = () => [200, okLogin({ token: 'pendek' })];
  await rejects(supabaseApi('POST', 'admin/login', { username: 'irene', password: 'x' }), /Unexpected/);
  handler = () => [200, null];
  await rejects(supabaseApi('POST', 'admin/login', { username: 'irene', password: 'x' }), /schema\.sql/);
  handler = () => [404, { code: 'PGRST202', message: 'Could not find the function public.admin_login' }];
  await rejects(supabaseApi('POST', 'admin/login', { username: 'irene', password: 'x' }), /not set up yet.*schema\.sql/);
  assert.equal(sbSession(), null);
});

test('logout menghapus sesi lokal dan mencabut token di database; tetap berhasil walau server gagal', async () => {
  loginAs();
  handler = () => [200, true];
  assert.deepEqual(await supabaseApi('POST', 'admin/logout'), { ok: true });
  assert.equal(sbSession(), null);
  assert.equal(calls[0].url.pathname, '/rest/v1/rpc/admin_logout');
  assert.deepEqual(calls[0].body, { p_token: TOKEN });
  loginAs();
  handler = () => { throw new TypeError('offline'); };
  assert.deepEqual(await supabaseApi('POST', 'admin/logout'), { ok: true });
  assert.equal(sbSession(), null);
});

test('sesi melewati batas umur lokal, atau bentuknya salah (mis. sesi lama berbasis email), dianggap tidak ada', async () => {
  loginAs({ until: Date.now() - 1 });
  assert.equal(sbSession(), null);
  assert.equal(store.has('tc.sb'), false);
  store.set('tc.sb', JSON.stringify({ access_token: 'a', refresh_token: 'b', email: 'x@y.z', until: Date.now() + 1e6 }));
  assert.equal(sbSession(), null);
  assert.deepEqual(await supabaseApi('GET', 'session'), { admin: null });
});

test('GET session mengembalikan username', async () => {
  loginAs();
  assert.deepEqual(await supabaseApi('GET', 'session'), { admin: { u: 'irene' } });
});

test('verifySession: true bila token sah; false (sesi dibuang) bila PT401; true saat offline', async () => {
  assert.equal(await verifySession(), false);
  loginAs();
  handler = () => [200, { username: 'irene' }];
  assert.equal(await verifySession(), true);
  assert.deepEqual(calls[0].body, { p_token: TOKEN });
  handler = () => [401, { code: 'PT401', message: 'x' }];
  assert.equal(await verifySession(), false);
  assert.equal(sbSession(), null);
  loginAs();
  handler = () => { throw new TypeError('offline'); };
  assert.equal(await verifySession(), true);
  assert.ok(sbSession());
  handler = () => [404, { code: 'PGRST202', message: 'x' }]; // skema lama
  assert.equal(await verifySession(), false);
  assert.equal(sbSession(), null);
});

// ---------- admin ----------

test('daftar admin: admin_list dengan p_token', async () => {
  loginAs();
  handler = () => [200, { today: '2026-10-18', events: [eventRow()] }];
  const d = await supabaseApi('GET', 'events');
  assert.equal(d.today, '2026-10-18'); assert.equal(d.events.length, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url.pathname, '/rest/v1/rpc/admin_list');
  assert.deepEqual(calls[0].body, { p_token: TOKEN });
  assert.equal(calls[0].headers.Authorization, undefined); // tidak ada header kustom selain apikey/Content-Type
  assert.deepEqual(Object.keys(calls[0].headers).sort(), ['Accept', 'Content-Type', 'apikey']);
});

test('aksi admin tanpa sesi -> AuthExpired tanpa menghubungi jaringan', async () => {
  await rejects(supabaseApi('POST', `admin/events/${EV_ID}/close`, {}), /session has expired/, AuthExpired);
  assert.equal(calls.length, 0);
});

test('token ditolak saat aksi (PT401) -> AuthExpired dan sesi lokal dibuang', async () => {
  loginAs();
  handler = () => [401, { code: 'PT401', message: 'Your admin session is invalid or has expired. Please sign in again.' }];
  await rejects(supabaseApi('POST', `admin/events/${EV_ID}/close`, {}), /session has expired/, AuthExpired);
  assert.equal(sbSession(), null);
});

test('buat event: slug unik terhadap id yang ada, lalu admin_create_event', async () => {
  loginAs();
  handler = (r) => {
    if (r.url.pathname.endsWith('/admin_list')) return [200, { today: '2026-10-18', events: [eventRow({ id: 'arisan-oktober' })] }];
    return [200, eventRow({ id: r.body.p_id, name: r.body.p_name })];
  };
  const r = await supabaseApi('POST', 'admin/events', { name: ' Arisan Oktober ', description: ' Rek 1 ', start_date: '2026-10-01', end_date: '2026-10-31' });
  assert.equal(r.event.id, 'arisan-oktober-2');
  const c = calls.at(-1);
  assert.equal(c.url.pathname, '/rest/v1/rpc/admin_create_event');
  assert.deepEqual(c.body, { p_token: TOKEN, p_id: 'arisan-oktober-2', p_name: 'Arisan Oktober', p_description: 'Rek 1', p_start_date: '2026-10-01', p_end_date: '2026-10-31' });
});

test('buat event: input tidak valid ditolak sebelum menulis', async () => {
  loginAs();
  handler = () => [200, { today: '2026-10-18', events: [] }];
  await rejects(supabaseApi('POST', 'admin/events', { name: '', start_date: '2026-10-01', end_date: '2026-10-31' }), /Event name is required/);
  await rejects(supabaseApi('POST', 'admin/events', { name: 'X', start_date: '2026-10-31', end_date: '2026-10-01' }), /cannot be before/);
  assert.ok(calls.every((c) => c.url.pathname.endsWith('/admin_list')));
});

test('ubah info, tutup, buka kembali: fungsi dan argumen yang tepat', async () => {
  loginAs();
  handler = () => [200, eventRow()];
  await supabaseApi('PUT', `admin/events/${EV_ID}`, { name: ' Baru ', description: 'd', start_date: '2026-10-02', end_date: '2026-11-01' });
  assert.equal(calls.at(-1).url.pathname, '/rest/v1/rpc/admin_update_event');
  assert.deepEqual(calls.at(-1).body, { p_token: TOKEN, p_id: EV_ID, p_name: 'Baru', p_description: 'd', p_start_date: '2026-10-02', p_end_date: '2026-11-01' });
  await supabaseApi('POST', `admin/events/${EV_ID}/close`, {});
  assert.equal(calls.at(-1).url.pathname, '/rest/v1/rpc/admin_set_closed');
  assert.deepEqual(calls.at(-1).body, { p_token: TOKEN, p_id: EV_ID, p_closed: true });
  await supabaseApi('POST', `admin/events/${EV_ID}/reopen`, {});
  assert.deepEqual(calls.at(-1).body, { p_token: TOKEN, p_id: EV_ID, p_closed: false });
  await rejects(supabaseApi('PUT', 'admin/events/BAD ID', { name: 'x', start_date: '2026-10-01', end_date: '2026-10-02' }), /not found/);
});

test('event/entri tidak ada -> pesan dari database (P0001) diteruskan', async () => {
  loginAs();
  handler = () => [400, { code: 'P0001', message: 'Event not found.' }];
  await rejects(supabaseApi('POST', `admin/events/${EV_ID}/close`, {}), /Event not found/);
  handler = () => [400, { code: 'P0001', message: 'Entry not found.' }];
  await rejects(supabaseApi('DELETE', `admin/events/${EV_ID}/entries/${EID}`), /Entry not found/);
  assert.ok(sbSession()); // galat biasa tidak membuang sesi
});

test('status entri: catatan dikirim apa adanya (dirapikan database), status tak dikenal ditolak di klien', async () => {
  loginAs();
  handler = () => [200, eventRow()];
  await supabaseApi('POST', `admin/events/${EV_ID}/entries/${EID}/status`, { status: 'invalid', note: ' Nominal beda ' });
  assert.equal(calls.at(-1).url.pathname, '/rest/v1/rpc/admin_set_status');
  assert.deepEqual(calls.at(-1).body, { p_token: TOKEN, p_event_id: EV_ID, p_entry_id: EID, p_status: 'invalid', p_note: ' Nominal beda ' });
  const n = calls.length;
  await rejects(supabaseApi('POST', `admin/events/${EV_ID}/entries/${EID}/status`, { status: 'bogus' }), /Unknown status/);
  assert.equal(calls.length, n);
});

test('hapus entri', async () => {
  loginAs();
  handler = () => [200, eventRow({ entries: [] })];
  const r = await supabaseApi('DELETE', `admin/events/${EV_ID}/entries/${EID}`);
  assert.deepEqual(r.event.entries, []);
  assert.equal(calls.at(-1).url.pathname, '/rest/v1/rpc/admin_delete_entry');
  assert.deepEqual(calls.at(-1).body, { p_token: TOKEN, p_event_id: EV_ID, p_entry_id: EID });
});

test('tambah entri manual: validasi klien lalu admin_add_entry (tanggal masa depan diperiksa database)', async () => {
  loginAs();
  await rejects(supabaseApi('POST', `admin/events/${EV_ID}/entries`, { name: '', amount: '1', transfer_date: '2026-10-02' }), /Name is required/);
  assert.equal(calls.length, 0);
  handler = () => [200, eventRow()];
  await supabaseApi('POST', `admin/events/${EV_ID}/entries`, { name: ' Siti ', amount: 'Rp 50.000', transfer_date: '2026-10-02' });
  assert.deepEqual(calls.at(-1).body, { p_token: TOKEN, p_event_id: EV_ID, p_name: 'Siti', p_amount: 50000, p_transfer_date: '2026-10-02' });
  handler = () => [400, { code: 'P0001', message: 'Transfer date cannot be in the future.' }];
  await rejects(supabaseApi('POST', `admin/events/${EV_ID}/entries`, { name: 'Siti', amount: '1', transfer_date: '2099-01-01' }), /in the future/);
});

test('akses ditolak (42501) -> petunjuk menjalankan ulang schema.sql', async () => {
  loginAs();
  handler = () => [403, { code: '42501', message: 'permission denied for function admin_list' }];
  await rejects(supabaseApi('GET', 'events'), /schema\.sql/);
});

test('jalur tidak dikenal ditolak', async () => {
  await rejects(supabaseApi('GET', 'nope'), /Unknown request/);
  await rejects(supabaseApi('POST', 'admin/nope', {}), /Unknown request/);
});
