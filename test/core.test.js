import test from 'node:test';
import assert from 'node:assert/strict';
import * as c from '../js/core.js';

const TZ = 'Asia/Jakarta';
const mk = (over = {}) => ({
  id: 'arisan', name: 'Arisan', description: '', start_date: '2026-10-10', end_date: '2026-10-20',
  created_at: '2026-10-01T00:00:00.000Z', closed_at: null, closed_by: '', entries: [], ...over,
});
const entry = (over = {}) => c.newEntry({ name: 'Budi', amount: '100000', transfer_date: '2026-10-11', ...over }, '2026-10-12', new Date('2026-10-12T03:00:00Z'));

test('isDate: tanggal nyata saja', () => {
  assert.ok(c.isDate('2026-02-28'));
  assert.ok(!c.isDate('2026-02-30'));
  assert.ok(!c.isDate('2026-2-3'));
  assert.ok(!c.isDate('x'));
  assert.ok(!c.isDate(null));
});

test('todayIn memakai zona waktu', () => {
  const t = new Date('2026-10-17T20:00:00Z'); // 03:00 WIB tanggal 18
  assert.equal(c.todayIn('Asia/Jakarta', t), '2026-10-18');
  assert.equal(c.todayIn('UTC', t), '2026-10-17');
});

test('parseAmount', () => {
  assert.equal(c.parseAmount('1500000'), 1500000);
  assert.equal(c.parseAmount('Rp 1.500.000'), 1500000);
  assert.equal(c.parseAmount('rp. 1,500,000'), 1500000);
  assert.equal(c.parseAmount(' 50 000 '), 50000);
  for (const bad of ['', 'abc', '0', '-5', '1.5', '12.34', '1e9', '1.500.00', String(c.LIMITS.amountMax + 1)]) {
    assert.throws(() => c.parseAmount(bad), c.UserError, bad);
  }
});

test('cleanName', () => {
  assert.equal(c.cleanName('  Budi   Santoso '), 'Budi Santoso');
  assert.throws(() => c.cleanName('   '), c.UserError);
  assert.throws(() => c.cleanName('a'.repeat(81)), c.UserError);
  assert.equal(c.cleanName('<b>x</b>'), '<b>x</b>'); // disimpan apa adanya; UI memakai text node
});

test('slugify & uniqueId', () => {
  assert.equal(c.slugify('Arisan Oktober 2026!'), 'arisan-oktober-2026');
  assert.equal(c.slugify('Pésta Ünik'), 'pesta-unik');
  assert.equal(c.slugify('!!!'), 'event');
  assert.equal(c.uniqueId('a', ['a', 'a-2']), 'a-3');
  assert.equal(c.uniqueId('b', ['a']), 'b');
  assert.ok(c.validId('abc-1'));
  assert.ok(!c.validId('../x'));
  assert.ok(!c.validId('-a'));
  assert.ok(!c.validId('A'));
});

test('eventState: tanggal inklusif, tutup manual menang', () => {
  const ev = mk();
  assert.equal(c.eventState(ev, '2026-10-09'), 'upcoming');
  assert.equal(c.eventState(ev, '2026-10-10'), 'open');
  assert.equal(c.eventState(ev, '2026-10-20'), 'open');
  assert.equal(c.eventState(ev, '2026-10-21'), 'closed');
  const closed = c.closeEvent(ev, 'admin', new Date('2026-10-15T00:00:00Z'));
  assert.equal(c.eventState(closed, '2026-10-15'), 'closed');
  assert.ok(c.closedManually(closed));
  assert.ok(!c.isActive(closed, '2026-10-15'));
  const reopened = c.reopenEvent(closed);
  assert.equal(c.eventState(reopened, '2026-10-15'), 'open');
  assert.equal(reopened.start_date, ev.start_date);
  assert.equal(reopened.end_date, ev.end_date);
});

test('submitBlockReason', () => {
  const ev = mk();
  assert.equal(c.submitBlockReason(ev, '2026-10-15'), '');
  assert.match(c.submitBlockReason(ev, '2026-10-01'), /belum dibuka/);
  assert.match(c.submitBlockReason(ev, '2026-11-01'), /berakhir/);
  assert.match(c.submitBlockReason(c.closeEvent(ev, 'a'), '2026-10-15'), /ditutup oleh admin/);
});

test('validateEventInput', () => {
  const ok = { name: ' Arisan ', description: 'x', start_date: '2026-10-10', end_date: '2026-10-10' };
  assert.equal(c.validateEventInput(ok).name, 'Arisan');
  assert.throws(() => c.validateEventInput({ ...ok, name: '' }), c.UserError);
  assert.throws(() => c.validateEventInput({ ...ok, name: 'a\nb' }), c.UserError);
  assert.throws(() => c.validateEventInput({ ...ok, end_date: '2026-10-09' }), c.UserError);
  assert.throws(() => c.validateEventInput({ ...ok, start_date: '2026-13-01' }), c.UserError);
});

test('newEvent memberi id unik', () => {
  const e = c.newEvent({ name: 'Arisan', description: '', start_date: '2026-10-10', end_date: '2026-10-20' }, ['arisan']);
  assert.equal(e.id, 'arisan-2');
  assert.equal(e.closed_at, null);
  assert.deepEqual(e.entries, []);
});

test('newEntry: tanggal transfer tidak boleh di masa depan', () => {
  assert.throws(() => c.newEntry({ name: 'A', amount: '1000', transfer_date: '2026-10-13' }, '2026-10-12'), c.UserError);
  const e = entry();
  assert.equal(e.status, 'pending');
  assert.match(e.id, /^[a-f0-9]{16}$/);
});

test('setStatus, deleteEntry, summary', () => {
  let ev = mk({ entries: [entry({ name: 'A', amount: '1000' }), entry({ name: 'B', amount: '2000' }), entry({ name: 'C', amount: '4000' })] });
  const [a, b] = ev.entries;
  ev = c.setStatus(ev, a.id, 'valid', '');
  ev = c.setStatus(ev, b.id, 'invalid', 'tidak ada di mutasi');
  const s = c.summary(ev);
  assert.deepEqual([s.total, s.pending, s.valid, s.invalid, s.valid_amount, s.total_amount], [3, 1, 1, 1, 1000, 7000]);
  assert.ok(ev.entries[0].verified_at);
  ev = c.setStatus(ev, a.id, 'pending', '');
  assert.equal(ev.entries[0].verified_at, null);
  assert.throws(() => c.setStatus(ev, a.id, 'nope', ''), c.UserError);
  assert.throws(() => c.setStatus(ev, 'x', 'valid', ''), c.UserError);
  assert.throws(() => c.setStatus(ev, a.id, 'valid', 'x'.repeat(201)), c.UserError);
  ev = c.deleteEntry(ev, b.id);
  assert.equal(ev.entries.length, 2);
  assert.throws(() => c.deleteEntry(ev, b.id), c.UserError);
});

test('setStatus tidak mengubah objek asal', () => {
  const ev = mk({ entries: [entry()] });
  const before = JSON.stringify(ev);
  c.setStatus(ev, ev.entries[0].id, 'valid', 'ok');
  assert.equal(JSON.stringify(ev), before);
});

test('duplicates & outsidePeriod', () => {
  const ev = mk({ entries: [entry({ name: 'Budi' }), entry({ name: 'budi' }), entry({ name: 'Ani' })] });
  const d = c.duplicates(ev);
  assert.equal(d.size, 2);
  assert.ok(!d.has(ev.entries[2].id));
  const inside = entry();
  assert.ok(!c.outsidePeriod(mk(), inside, TZ));
  const late = { ...inside, submitted_at: '2026-11-01T00:00:00.000Z' };
  assert.ok(c.outsidePeriod(mk(), late, TZ));
});

test('sortEntries', () => {
  const a = { ...entry({ name: 'b', amount: '5000' }), id: 'a'.repeat(16) };
  const b = { ...entry({ name: 'a', amount: '9000' }), id: 'b'.repeat(16) };
  assert.deepEqual(c.sortEntries([a, b], 'name').map((e) => e.name), ['a', 'b']);
  assert.deepEqual(c.sortEntries([a, b], 'amount', 'desc').map((e) => e.amount), [9000, 5000]);
});

test('kode kirim: bolak-balik, termasuk karakter Unicode', () => {
  const e = entry({ name: 'Siti Nurhaliza 🌸' });
  const code = c.encodeEntryCode('arisan', e);
  assert.match(code, /^TC1\.[A-Za-z0-9_-]+$/);
  const d = c.decodeEntryCode(code);
  assert.equal(d.eventId, 'arisan');
  assert.equal(d.entry.id, e.id);
  assert.equal(d.entry.name, 'Siti Nurhaliza 🌸');
  assert.equal(d.entry.amount, 100000);
  assert.equal(d.entry.status, 'pending');
});

test('kode kirim: ditolak bila rusak / berbahaya', () => {
  const forge = (obj) => 'TC1.' + Buffer.from(JSON.stringify(obj)).toString('base64url');
  const good = { e: 'arisan', i: 'a'.repeat(16), n: 'Budi', a: 1000, d: '2026-10-11', t: '2026-10-12T00:00:00.000Z' };
  assert.ok(c.decodeEntryCode(forge(good)));
  for (const bad of [
    'abc', 'TC1.', 'TC1.@@@', forge({ ...good, e: '../x' }), forge({ ...good, i: 'zz' }), forge({ ...good, a: -1 }),
    forge({ ...good, a: 1.5 }), forge({ ...good, a: '1e3' }), forge({ ...good, n: '' }), forge({ ...good, d: '2026-02-30' }),
    forge({ ...good, t: 'bukan-tanggal' }), 'TC1.' + 'A'.repeat(c.LIMITS.code),
  ]) {
    assert.throws(() => c.decodeEntryCode(bad), c.UserError, bad.slice(0, 30));
  }
});

test('importCodes: tambah, duplikat, salah event, rusak', () => {
  const ev = mk();
  const e1 = entry({ name: 'A' });
  const e2 = entry({ name: 'B' });
  const text = `Halo admin, ini kode saya:\n${c.encodeEntryCode('arisan', e1)}\n\nlagi: ${c.encodeEntryCode('arisan', e2)} ${c.encodeEntryCode('lain', e1)} TC1.@@ ${c.encodeEntryCode('arisan', e1)}`;
  const r = c.importCodes(ev, text);
  assert.deepEqual([r.added, r.duplicate, r.wrongEvent, r.invalid], [2, 1, 1, 0].map((v, i) => (i === 3 ? 0 : v)));
  assert.equal(r.event.entries.length, 2);
  assert.equal(ev.entries.length, 0);
  const again = c.importCodes(r.event, text);
  assert.equal(again.added, 0);
  assert.equal(again.duplicate, 3);
});

test('toCSV: kutip & anti formula injection', () => {
  const ev = mk({ entries: [entry({ name: '=HYPERLINK("x")' }), entry({ name: 'Ani, "S"' })] });
  const csv = c.toCSV(ev, TZ);
  assert.ok(csv.startsWith('﻿Nama,Nominal'));
  assert.ok(csv.includes(`"'=HYPERLINK(""x"")"`));
  assert.ok(csv.includes('"Ani, ""S"""'));
  assert.ok(csv.includes('\r\n'));
});

test('normalizeEvent: bulat-balik stabil & menolak data rusak', () => {
  const ev = mk({ entries: [entry()] });
  const text = c.serializeEvent(ev);
  const back = c.parseEventJSON(text);
  assert.equal(c.serializeEvent(back), text);
  assert.throws(() => c.parseEventJSON('{'), c.UserError);
  assert.throws(() => c.parseEventJSON('[]'), c.UserError);
  assert.throws(() => c.normalizeEvent({ ...ev, id: '../etc' }), c.UserError);
  assert.throws(() => c.normalizeEvent({ ...ev, entries: 'x' }), c.UserError);
  const dup = { ...ev, entries: [ev.entries[0], ev.entries[0]] };
  assert.throws(() => c.normalizeEvent(dup), c.UserError);
  assert.throws(() => c.normalizeEvent({ ...ev, entries: [{ ...ev.entries[0], status: 'x' }] }), c.UserError);
  // field asing dibuang
  const extra = c.normalizeEvent({ ...ev, evil: 1 });
  assert.ok(!('evil' in extra));
});

test('index.json', () => {
  const text = c.buildIndex(['b', 'a', 'a', '../x']);
  assert.deepEqual(c.parseIndex(text), ['a', 'b']);
  assert.deepEqual(c.parseIndex('{"events":["a","../x",1]}'), ['a']);
  assert.throws(() => c.parseIndex('{}'), c.UserError);
});

test('format tampilan', () => {
  assert.equal(c.rupiah(1500000), 'Rp 1.500.000');
  assert.equal(c.rupiah(0), 'Rp 0');
  assert.equal(c.dateID('2026-10-05'), '5 Okt 2026');
  assert.equal(c.dateTimeID('2026-10-12T03:05:00Z', TZ), '12 Okt 2026 10:05');
});

test('sha256Hex & safeEqual & configProblem', async () => {
  assert.equal(await c.sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.ok(c.safeEqual('abc', 'abc'));
  assert.ok(!c.safeEqual('abc', 'abd'));
  assert.ok(!c.safeEqual('abc', 'abcd'));
  assert.match(c.configProblem({ admin: { username: 'a', password_sha256: 'x' }, timezone: TZ }), /belum diatur/);
  const h = 'a'.repeat(64);
  assert.equal(c.configProblem({ admin: { username: 'a', password_sha256: h }, timezone: TZ }), '');
  assert.match(c.configProblem({ admin: { username: 'a', password_sha256: h }, timezone: 'Mars/Olimpus' }), /Zona waktu/);
});

test('contoh event di examples/ valid dan stabil', async () => {
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(new URL('../examples/arisan-contoh.json', import.meta.url), 'utf8');
  const ev = c.parseEventJSON(text);
  assert.equal(c.serializeEvent(ev), text);
  assert.equal(c.summary(ev).total, 3);
});

test('data/index.json bawaan valid', async () => {
  const { readFile } = await import('node:fs/promises');
  const text = await readFile(new URL('../data/index.json', import.meta.url), 'utf8');
  assert.deepEqual(c.parseIndex(text), []);
});
