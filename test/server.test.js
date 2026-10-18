import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { buildConfig } from '../server/config.js';
import { Store } from '../server/store.js';
import { createApp } from '../server/app.js';
import { normalizeEvent } from '../js/core.js';

const parseEventJSON = (text) => normalizeEvent(JSON.parse(text));

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PW = 'rahasia-123';

async function boot({ raw = {}, env = {} } = {}) {
  const dir = await mkdtemp(path.join(tmpdir(), 'tc-test-'));
  const config = buildConfig({
    admin: { username: 'admin', password: PW }, session_secret: 's'.repeat(40), data_dir: dir, ...raw,
  }, env, dir);
  const clock = { t: Date.parse('2026-10-18T05:00:00Z') }; // 12:00 WIB, 18 Okt 2026
  const store = new Store(config.data_dir);
  await store.init();
  const server = http.createServer(createApp({ config, store, root, now: () => new Date(clock.t) }));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;

  async function call(method, p, body, { cookie, headers = {}, rawBody, ip } = {}) {
    const h = { ...headers };
    if (method !== 'GET' && method !== 'HEAD') { h['Content-Type'] ??= 'application/json'; h['X-TC-Request'] ??= '1'; }
    if (cookie) h.Cookie = cookie;
    if (ip) h['X-Forwarded-For'] = ip;
    const res = await fetch(base + p, { method, headers: h, body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)) });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* bukan JSON */ }
    const sc = res.headers.getSetCookie();
    return { status: res.status, json, text, headers: res.headers, setCookie: sc[0] ?? null, cookie: sc[0] ? sc[0].split(';')[0] : null };
  }
  async function login(password = PW) {
    const r = await call('POST', '/api/admin/login', { username: 'admin', password });
    return r;
  }
  return {
    dir, config, clock, store, base, call, login,
    advance: (ms) => { clock.t += ms; },
    close: async () => { server.closeAllConnections?.(); await new Promise((r) => server.close(r)); await rm(dir, { recursive: true, force: true }); },
  };
}

const EVENT = { name: 'Arisan Oktober', description: 'Rek 123', start_date: '2026-10-10', end_date: '2026-10-25' };
const ENTRY = { name: 'Budi', amount: '250.000', transfer_date: '2026-10-17' };

async function withEvent(t, opts) {
  const s = await boot(opts);
  t.after(() => s.close());
  const cookie = (await s.login()).cookie;
  const ev = (await s.call('POST', '/api/admin/events', EVENT, { cookie })).json.event;
  return { s, cookie, ev };
}

test('healthz, header keamanan, dan file statis', async (t) => {
  const s = await boot(); t.after(() => s.close());
  const h = await s.call('GET', '/healthz');
  assert.equal(h.status, 200);
  assert.equal(h.text.trim(), 'ok');
  assert.match(h.headers.get('content-security-policy'), /script-src 'self'/);
  assert.equal(h.headers.get('x-content-type-options'), 'nosniff');

  const idx = await s.call('GET', '/');
  assert.equal(idx.status, 200);
  assert.match(idx.headers.get('content-type'), /text\/html/);
  assert.match(idx.text, /Transfer Checklist/);
  assert.equal((await s.call('GET', '/js/core.js')).status, 200);
  assert.equal((await s.call('GET', '/css/style.css')).status, 200);

  const cfg = await s.call('GET', '/config.js');
  assert.equal(cfg.status, 200);
  assert.match(cfg.text, /"mode":"server"/);
  assert.ok(!/password|admin|secret/i.test(cfg.text), 'config.js klien tidak boleh memuat rahasia');

  for (const p of ['/config.json', '/server.js', '/package.json', '/data/index.json', '/server/config.js', '/test/core.test.js', '/README.md', '/.gitignore']) {
    assert.equal((await s.call('GET', p)).status, 404, p);
  }
});

test('path traversal ditolak', async (t) => {
  const s = await boot(); t.after(() => s.close());
  const { port, hostname } = new URL(s.base);
  const raw = (p) => new Promise((resolve, reject) => {
    http.get({ host: hostname, port, path: p }, (res) => { res.resume(); res.on('end', () => resolve(res.statusCode)); }).on('error', reject);
  });
  for (const p of ['/js/..%2f..%2fserver.js', '/js/../server.js', '/js/%2e%2e/server.js', '/css/..%5cserver.js', '/js/%00.js']) {
    assert.ok([400, 404].includes(await raw(p)), p);
  }
});

test('alur publik: daftar kosong, kirim entri, validasi', async (t) => {
  const { s, ev } = await withEvent(t);
  const list = await s.call('GET', '/api/events');
  assert.equal(list.json.today, '2026-10-18');
  assert.equal(list.json.events.length, 1);

  const ok = await s.call('POST', `/api/events/${ev.id}/entries`, ENTRY);
  assert.equal(ok.status, 201);
  assert.equal(ok.json.entry.amount, 250000);
  assert.equal(ok.json.entry.status, 'pending');
  assert.equal((await s.call('GET', '/api/events')).json.events[0].entries.length, 1);

  for (const [body, frag] of [
    [{ ...ENTRY, name: '' }, /Nama wajib/],
    [{ ...ENTRY, amount: 'abc' }, /angka bulat/],
    [{ ...ENTRY, amount: -5 }, /angka bulat|lebih dari 0/],
    [{ ...ENTRY, transfer_date: '2026-10-19' }, /masa depan/],
    [{ ...ENTRY, transfer_date: 'kemarin' }, /tidak valid/],
  ]) {
    const r = await s.call('POST', `/api/events/${ev.id}/entries`, body);
    assert.equal(r.status, 400);
    assert.match(r.json.error, frag);
  }
  assert.equal((await s.call('POST', '/api/events/tidak-ada/entries', ENTRY)).status, 404);
  assert.equal((await s.call('POST', '/api/events/..%2fx/entries', ENTRY)).status, 404);
});

test('periode: sebelum mulai, setelah selesai, dan tutup manual ditolak di server', async (t) => {
  const { s, cookie, ev } = await withEvent(t);
  const url = `/api/events/${ev.id}/entries`;
  assert.equal((await s.call('POST', url, ENTRY)).status, 201);

  // setelah tanggal selesai (26 Okt)
  s.advance(8 * 24 * 3600 * 1000);
  const late = await s.call('POST', url, { ...ENTRY, transfer_date: '2026-10-20' });
  assert.equal(late.status, 400);
  assert.match(late.json.error, /berakhir/);
  s.advance(-8 * 24 * 3600 * 1000);

  // tutup manual
  assert.equal((await s.call('POST', `/api/admin/events/${ev.id}/close`, undefined, { cookie })).status, 200);
  const closed = await s.call('POST', url, ENTRY);
  assert.equal(closed.status, 400);
  assert.match(closed.json.error, /ditutup oleh admin/);
  // buka kembali
  const re = await s.call('POST', `/api/admin/events/${ev.id}/reopen`, undefined, { cookie });
  assert.equal(re.json.event.closed_at, null);
  assert.equal((await s.call('POST', url, ENTRY)).status, 201);

  // event yang belum dibuka
  const fut = (await s.call('POST', '/api/admin/events', { ...EVENT, name: 'Nanti', start_date: '2026-11-01', end_date: '2026-11-05' }, { cookie })).json.event;
  const early = await s.call('POST', `/api/events/${fut.id}/entries`, ENTRY);
  assert.equal(early.status, 400);
  assert.match(early.json.error, /belum dibuka/);
});

test('rate limit input publik: 10/menit/IP', async (t) => {
  const { s, ev } = await withEvent(t);
  const url = `/api/events/${ev.id}/entries`;
  for (let i = 0; i < 10; i++) assert.equal((await s.call('POST', url, { ...ENTRY, name: `Orang ${i}` })).status, 201);
  assert.equal((await s.call('POST', url, ENTRY)).status, 429);
  s.advance(61_000);
  assert.equal((await s.call('POST', url, ENTRY)).status, 201);
});

test('trust_proxy: IP dibaca dari header hanya bila diaktifkan', async (t) => {
  const off = await withEvent(t);
  const u1 = `/api/events/${off.ev.id}/entries`;
  for (let i = 0; i < 10; i++) await off.s.call('POST', u1, ENTRY, { ip: `10.0.0.${i}` });
  assert.equal((await off.s.call('POST', u1, ENTRY, { ip: '10.9.9.9' })).status, 429, 'XFF diabaikan bila trust_proxy=false');

  const on = await withEvent(t, { raw: { trust_proxy: true } });
  const u2 = `/api/events/${on.ev.id}/entries`;
  for (let i = 0; i < 10; i++) await on.s.call('POST', u2, ENTRY, { ip: '10.0.0.1' });
  assert.equal((await on.s.call('POST', u2, ENTRY, { ip: '10.0.0.1' })).status, 429);
  assert.equal((await on.s.call('POST', u2, ENTRY, { ip: '10.0.0.2' })).status, 201, 'IP lain tidak terkena');
});

test('login: salah, benar, kunci setelah 5 gagal, cookie aman', async (t) => {
  const s = await boot(); t.after(() => s.close());
  const bad = await s.login('salah');
  assert.equal(bad.status, 401);
  assert.equal(bad.cookie, null);

  const ok = await s.login();
  assert.equal(ok.status, 200);
  assert.match(ok.setCookie, /HttpOnly/);
  assert.match(ok.setCookie, /SameSite=Lax/);
  assert.ok(!/Secure/.test(ok.setCookie), 'tanpa https: tanpa Secure');
  assert.equal((await s.call('GET', '/api/session', undefined, { cookie: ok.cookie })).json.admin.u, 'admin');
  assert.equal((await s.call('GET', '/api/session')).json.admin, null);

  for (let i = 0; i < 5; i++) assert.equal((await s.login('x')).status, 401); // login sukses mereset hitungan; 5 gagal memblokir
  const locked = await s.login(); // password benar pun ditolak
  assert.equal(locked.status, 429);
  assert.match(locked.json.error, /Terlalu banyak/);
  s.advance(16 * 60_000);
  assert.equal((await s.login()).status, 200);
});

test('cookie memakai Secure bila base_url https', async (t) => {
  const s = await boot({ raw: { base_url: 'https://transfer.contoh.com' } }); t.after(() => s.close());
  const r = await s.call('POST', '/api/admin/login', { username: 'admin', password: PW }, { headers: { Origin: s.base } });
  assert.equal(r.status, 200);
  assert.match(r.setCookie, /; Secure/);
  assert.match((await s.call('GET', '/healthz')).headers.get('strict-transport-security'), /max-age/);
});

test('endpoint admin butuh sesi; sesi kedaluwarsa & cookie palsu ditolak', async (t) => {
  const { s, cookie, ev } = await withEvent(t);
  const e = (await s.call('POST', `/api/events/${ev.id}/entries`, ENTRY)).json.entry;
  const targets = [
    ['POST', '/api/admin/events', EVENT],
    ['PUT', `/api/admin/events/${ev.id}`, EVENT],
    ['POST', `/api/admin/events/${ev.id}/close`],
    ['POST', `/api/admin/events/${ev.id}/reopen`],
    ['POST', `/api/admin/events/${ev.id}/entries`, ENTRY],
    ['POST', `/api/admin/events/${ev.id}/entries/${e.id}/status`, { status: 'valid' }],
    ['DELETE', `/api/admin/events/${ev.id}/entries/${e.id}`],
  ];
  for (const [m, p, b] of targets) {
    assert.equal((await s.call(m, p, b)).status, 401, `${m} ${p} tanpa cookie`);
    assert.equal((await s.call(m, p, b, { cookie: 'tc_session=abc.def' })).status, 401, `${m} ${p} cookie palsu`);
  }
  const tampered = cookie.replace(/.$/, (c) => (c === 'A' ? 'B' : 'A'));
  assert.equal((await s.call('POST', `/api/admin/events/${ev.id}/close`, undefined, { cookie: tampered })).status, 401);
  assert.equal((await s.call('POST', `/api/admin/events/${ev.id}/close`, undefined, { cookie })).status, 200);
  s.advance(13 * 3600 * 1000); // TTL 12 jam
  assert.equal((await s.call('POST', `/api/admin/events/${ev.id}/reopen`, undefined, { cookie })).status, 401);
});

test('CSRF: header khusus, Origin, dan Content-Type diwajibkan', async (t) => {
  const { s, cookie, ev } = await withEvent(t);
  const url = `/api/admin/events/${ev.id}/close`;
  assert.equal((await s.call('POST', url, undefined, { cookie, headers: { 'X-TC-Request': '0' } })).status, 403);
  assert.equal((await s.call('POST', url, undefined, { cookie, headers: { Origin: 'https://jahat.example' } })).status, 403);
  assert.equal((await s.call('POST', `/api/events/${ev.id}/entries`, ENTRY, { headers: { Origin: 'https://jahat.example' } })).status, 403);
  assert.equal((await s.call('POST', `/api/events/${ev.id}/entries`, undefined, { headers: { 'Content-Type': 'text/plain' }, rawBody: 'x' })).status, 415);
  assert.equal((await s.call('POST', `/api/events/${ev.id}/entries`, undefined, { rawBody: '{bukan json' })).status, 400);
  assert.equal((await s.call('POST', `/api/events/${ev.id}/entries`, undefined, { rawBody: '[1,2]' })).status, 400);
  const sameOrigin = await s.call('POST', url, undefined, { cookie, headers: { Origin: s.base } });
  assert.equal(sameOrigin.status, 200);
});

test('body terlalu besar -> 413', async (t) => {
  const { s, ev } = await withEvent(t);
  const r = await s.call('POST', `/api/events/${ev.id}/entries`, { ...ENTRY, name: 'a'.repeat(20_000) });
  assert.equal(r.status, 413);
});

test('verifikasi admin, catatan hanya publik untuk Tidak valid', async (t) => {
  const { s, cookie, ev } = await withEvent(t);
  const mk = async (name) => (await s.call('POST', `/api/events/${ev.id}/entries`, { ...ENTRY, name }, { ip: undefined })).json.entry;
  const a = await mk('Andi');
  const b = await mk('Bayu');
  const c = await mk('Cici');
  const set = (id, status, note) => s.call('POST', `/api/admin/events/${ev.id}/entries/${id}/status`, { status, note }, { cookie });
  assert.equal((await set(a.id, 'valid', 'cocok mutasi 17/10')).status, 200);
  assert.equal((await set(b.id, 'invalid', 'tidak ada di mutasi')).status, 200);
  assert.equal((await set(c.id, 'bukan-status', '')).status, 400);
  assert.equal((await set('0123456789abcdef', 'valid', '')).status, 404);

  const pub = (await s.call('GET', '/api/events')).json.events[0].entries;
  const find = (arr, id) => arr.find((x) => x.id === id);
  assert.equal(find(pub, a.id).status, 'valid');
  assert.equal(find(pub, a.id).admin_note, '', 'catatan Valid tidak publik');
  assert.equal(find(pub, b.id).admin_note, 'tidak ada di mutasi', 'catatan Tidak valid publik');
  const adm = (await s.call('GET', '/api/events', undefined, { cookie })).json.events[0].entries;
  assert.equal(find(adm, a.id).admin_note, 'cocok mutasi 17/10', 'admin melihat semua catatan');

  const del = await s.call('DELETE', `/api/admin/events/${ev.id}/entries/${c.id}`, undefined, { cookie });
  assert.equal(del.status, 200);
  assert.equal(del.json.event.entries.length, 2);
  assert.equal((await s.call('DELETE', `/api/admin/events/${ev.id}/entries/${c.id}`, undefined, { cookie })).status, 404);
});

test('admin: buat, ubah, tambah entri manual, validasi', async (t) => {
  const { s, cookie, ev } = await withEvent(t);
  assert.equal(ev.id, 'arisan-oktober');
  const dup = await s.call('POST', '/api/admin/events', EVENT, { cookie });
  assert.equal(dup.json.event.id, 'arisan-oktober-2', 'slug unik');
  assert.equal((await s.call('POST', '/api/admin/events', { ...EVENT, end_date: '2026-10-01' }, { cookie })).status, 400);
  assert.equal((await s.call('POST', '/api/admin/events', { ...EVENT, name: '' }, { cookie })).status, 400);

  const upd = await s.call('PUT', `/api/admin/events/${ev.id}`, { ...EVENT, name: 'Nama Baru', end_date: '2026-10-30' }, { cookie });
  assert.equal(upd.status, 200);
  assert.equal(upd.json.event.name, 'Nama Baru');
  assert.equal(upd.json.event.id, 'arisan-oktober', 'id tidak berubah');
  assert.equal((await s.call('PUT', '/api/admin/events/tidak-ada', EVENT, { cookie })).status, 404);

  const man = await s.call('POST', `/api/admin/events/${ev.id}/entries`, { name: 'Manual', amount: 100000, transfer_date: '2026-10-16' }, { cookie });
  assert.equal(man.status, 201);
  assert.equal(man.json.event.entries[0].name, 'Manual');
});

test('data tersimpan sebagai file JSON valid + cadangan', async (t) => {
  const { s, cookie, ev } = await withEvent(t);
  await s.call('POST', `/api/events/${ev.id}/entries`, ENTRY);
  await s.call('POST', `/api/admin/events/${ev.id}/close`, undefined, { cookie });
  const file = path.join(s.dir, 'events', `${ev.id}.json`);
  const saved = parseEventJSON(await readFile(file, 'utf8'));
  assert.equal(saved.entries.length, 1);
  assert.ok(saved.closed_at);
  const files = await readdir(path.join(s.dir, 'events'));
  assert.ok(files.includes(`${ev.id}.json.bak`), 'ada cadangan');
  assert.ok(!files.some((f) => f.endsWith('.tmp')), 'tidak ada sisa .tmp');
});

test('input serentak tidak saling menimpa (mutex per event)', async (t) => {
  const { s, ev } = await withEvent(t, { raw: { trust_proxy: true } });
  const url = `/api/events/${ev.id}/entries`;
  const rs = await Promise.all(Array.from({ length: 30 }, (_, i) => s.call('POST', url, { ...ENTRY, name: `Orang ${i}` }, { ip: `10.1.0.${i}` })));
  assert.ok(rs.every((r) => r.status === 201));
  const got = (await s.call('GET', '/api/events')).json.events[0].entries;
  assert.equal(got.length, 30);
  assert.equal(new Set(got.map((e) => e.id)).size, 30);
});

test('file event rusak dilewati, tidak merobohkan daftar', async (t) => {
  const { s, ev } = await withEvent(t);
  const { writeFile } = await import('node:fs/promises');
  await writeFile(path.join(s.dir, 'events', 'rusak.json'), '{bukan json');
  await writeFile(path.join(s.dir, 'events', 'salah-id.json'), JSON.stringify({ ...ev, id: 'lain' }));
  const list = await s.call('GET', '/api/events');
  assert.equal(list.status, 200);
  assert.deepEqual(list.json.events.map((e) => e.id), [ev.id]);
});

test('metode & endpoint tidak dikenal', async (t) => {
  const s = await boot(); t.after(() => s.close());
  assert.equal((await s.call('GET', '/api/tidak-ada')).status, 404);
  assert.equal((await s.call('PUT', '/api/events')).status, 404);
  assert.equal((await s.call('POST', '/')).status, 405);
  assert.equal((await s.call('GET', '/api/admin/login')).status, 405);
});
