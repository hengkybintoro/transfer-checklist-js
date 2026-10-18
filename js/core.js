// Logika inti Transfer Checklist (versi JavaScript, tanpa DOM, tanpa dependensi).
// Dipakai oleh browser (js/app.js) dan oleh test Node (test/core.test.js).

export const STATUS = Object.freeze({ PENDING: 'pending', VALID: 'valid', INVALID: 'invalid' });
export const STATUSES = Object.freeze([STATUS.PENDING, STATUS.VALID, STATUS.INVALID]);

export const LIMITS = Object.freeze({
  name: 80,
  eventName: 100,
  description: 1000,
  adminNote: 200,
  amountMax: 1_000_000_000_000,
  entries: 5000,
  code: 2000,
});

/** Error yang pesannya aman ditampilkan ke pengguna. */
export class UserError extends Error {}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agu', 'Sep', 'Okt', 'Nov', 'Des'];

// ---------- tanggal ----------

/** true bila s berbentuk YYYY-MM-DD dan merupakan tanggal kalender yang nyata. */
export function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

/** Tanggal hari ini (YYYY-MM-DD) di zona waktu tz. */
export function todayIn(tz, now = new Date()) {
  return dateIn(tz, now);
}

/** Tanggal (YYYY-MM-DD) dari sebuah instan waktu, di zona waktu tz. */
export function dateIn(tz, when) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(when);
  const get = (t) => parts.find((p) => p.type === t).value;
  return `${get('year')}-${get('month')}-${get('day')}`;
}

export function dateID(s) {
  if (!isDate(s)) return s;
  const [y, m, d] = s.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

// ----- bantuan kalender (untuk pemilih tanggal) -----

export const MONTHS_LONG = Object.freeze(['Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni', 'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember']);
export const WEEKDAYS_SHORT = Object.freeze(['Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab', 'Min']); // pekan dimulai Senin

const pad2 = (n) => String(n).padStart(2, '0');
export const makeDate = (y, m, d) => `${String(y).padStart(4, '0')}-${pad2(m)}-${pad2(d)}`;
export const parseDateParts = (iso) => iso.split('-').map(Number); // [y, m, d]
export const daysInMonth = (y, m) => new Date(Date.UTC(y, m, 0)).getUTCDate();

/** Menggeser tanggal ISO sebanyak n hari (bisa negatif). */
export function addDays(iso, n) {
  const [y, m, d] = parseDateParts(iso);
  const t = new Date(Date.UTC(y, m - 1, d + n));
  return makeDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate());
}

/** Menggeser n bulan; hari dipangkas bila bulan tujuan lebih pendek (31 Jan + 1 bulan = 28/29 Feb). */
export function addMonths(iso, n) {
  const [y, m, d] = parseDateParts(iso);
  const total = y * 12 + (m - 1) + n;
  const ny = Math.floor(total / 12);
  const nm = (total % 12) + 1;
  return makeDate(ny, nm, Math.min(d, daysInMonth(ny, nm)));
}

/** Kisi bulan: array pekan (Senin–Minggu); tiap sel berupa tanggal ISO atau null untuk sel kosong. */
export function monthGrid(year, month) {
  const lead = (new Date(Date.UTC(year, month - 1, 1)).getUTCDay() + 6) % 7;
  const cells = Array(lead).fill(null);
  for (let d = 1; d <= daysInMonth(year, month); d++) cells.push(makeDate(year, month, d));
  while (cells.length % 7) cells.push(null);
  const weeks = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** Contoh: "18 Oktober 2026" (dipakai sebagai label aksesibilitas). */
export function dateLong(iso) {
  if (!isDate(iso)) return iso;
  const [y, m, d] = parseDateParts(iso);
  return `${d} ${MONTHS_LONG[m - 1]} ${y}`;
}

export function dateTimeID(iso, tz) {
  const t = new Date(iso);
  if (Number.isNaN(t.getTime())) return iso;
  const day = dateIn(tz, t);
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(t);
  return `${dateID(day)} ${time}`;
}

export function rupiah(n) {
  const s = String(Math.trunc(Number(n) || 0));
  return 'Rp ' + s.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

// ---------- nominal & teks ----------

/** "Rp 1.500.000" / "1500000" / "1,500,000" -> 1500000. Hanya bilangan bulat rupiah. */
export function parseAmount(input) {
  let s = String(input ?? '').trim().replace(/^rp\.?\s*/i, '').replace(/\s+/g, '');
  if (s === '') throw new UserError('Nominal wajib diisi.');
  if (/^\d{1,3}([.,]\d{3})+$/.test(s)) s = s.replace(/[.,]/g, '');
  else if (!/^\d+$/.test(s)) throw new UserError('Nominal harus berupa angka bulat rupiah, contoh 1500000 atau 1.500.000.');
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n <= 0) throw new UserError('Nominal harus lebih dari 0.');
  if (n > LIMITS.amountMax) throw new UserError('Nominal terlalu besar.');
  return n;
}

// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

export function cleanName(input) {
  const s = String(input ?? '').replace(/\s+/g, ' ').trim();
  if (s === '') throw new UserError('Nama wajib diisi.');
  if ([...s].length > LIMITS.name) throw new UserError(`Nama maksimal ${LIMITS.name} karakter.`);
  if (CONTROL.test(s)) throw new UserError('Nama mengandung karakter yang tidak diizinkan.');
  return s;
}

function cleanText(input, max, label) {
  const s = String(input ?? '').replace(/\r\n/g, '\n').trim();
  if ([...s].length > max) throw new UserError(`${label} maksimal ${max} karakter.`);
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(s)) throw new UserError(`${label} mengandung karakter yang tidak diizinkan.`);
  return s;
}

function isIso(s) {
  return typeof s === 'string' && s.length <= 40 && !Number.isNaN(new Date(s).getTime());
}

// ---------- id ----------

export function slugify(name) {
  const s = String(name ?? '')
    .normalize('NFKD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 50).replace(/-+$/g, '');
  return s || 'event';
}

export function validId(id) {
  return typeof id === 'string' && /^[a-z0-9][a-z0-9-]{0,63}$/.test(id);
}

/** Slug unik terhadap kumpulan id yang sudah ada: nama, nama-2, nama-3, ... */
export function uniqueId(base, existing) {
  const taken = new Set(existing);
  if (!taken.has(base)) return base;
  for (let i = 2; ; i++) if (!taken.has(`${base}-${i}`)) return `${base}-${i}`;
}

export function newEntryId() {
  const b = new Uint8Array(8);
  globalThis.crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

function validEntryId(id) {
  return typeof id === 'string' && /^[a-f0-9]{16}$/.test(id);
}

// ---------- periode event ----------

/** 'upcoming' | 'open' | 'closed'. Tutup manual selalu menang atas tanggal. */
export function eventState(ev, today) {
  if (ev.closed_at) return 'closed';
  if (today < ev.start_date) return 'upcoming';
  if (today > ev.end_date) return 'closed';
  return 'open';
}

export function isActive(ev, today) {
  return eventState(ev, today) === 'open';
}

export function closedManually(ev) {
  return Boolean(ev.closed_at);
}

export const STATE_LABEL = Object.freeze({ upcoming: 'Belum dibuka', open: 'Dibuka', closed: 'Ditutup' });

export function closeEvent(ev, by, now = new Date()) {
  const out = structuredClone(ev);
  out.closed_at = now.toISOString();
  out.closed_by = by;
  return out;
}

export function reopenEvent(ev) {
  const out = structuredClone(ev);
  out.closed_at = null;
  out.closed_by = '';
  return out;
}

// ---------- event ----------

export function validateEventInput(input) {
  const name = cleanText(input.name, LIMITS.eventName, 'Nama event');
  if (name === '') throw new UserError('Nama event wajib diisi.');
  if (name.includes('\n')) throw new UserError('Nama event harus satu baris.');
  const description = cleanText(input.description, LIMITS.description, 'Deskripsi');
  if (!isDate(input.start_date)) throw new UserError('Tanggal mulai tidak valid.');
  if (!isDate(input.end_date)) throw new UserError('Tanggal selesai tidak valid.');
  if (input.end_date < input.start_date) throw new UserError('Tanggal selesai tidak boleh sebelum tanggal mulai.');
  return { name, description, start_date: input.start_date, end_date: input.end_date };
}

export function newEvent(input, existingIds, now = new Date()) {
  const v = validateEventInput(input);
  return {
    id: uniqueId(slugify(v.name), existingIds),
    name: v.name,
    description: v.description,
    start_date: v.start_date,
    end_date: v.end_date,
    created_at: now.toISOString(),
    closed_at: null,
    closed_by: '',
    entries: [],
  };
}

export function updateEventInfo(ev, input) {
  const v = validateEventInput(input);
  return { ...structuredClone(ev), ...v };
}

// ---------- entri ----------

export function validateEntryInput(input, today) {
  const name = cleanName(input.name);
  const amount = parseAmount(input.amount);
  const transfer_date = input.transfer_date;
  if (!isDate(transfer_date)) throw new UserError('Tanggal transfer tidak valid.');
  if (today && transfer_date > today) throw new UserError('Tanggal transfer tidak boleh di masa depan.');
  return { name, amount, transfer_date };
}

export function newEntry(input, today, now = new Date(), id = newEntryId()) {
  const v = validateEntryInput(input, today);
  return {
    id,
    name: v.name,
    amount: v.amount,
    transfer_date: v.transfer_date,
    submitted_at: now.toISOString(),
    status: STATUS.PENDING,
    admin_note: '',
    verified_at: null,
  };
}

/** Pesan alasan bila event tidak menerima input, atau '' bila menerima. */
export function submitBlockReason(ev, today) {
  switch (eventState(ev, today)) {
    case 'open': return '';
    case 'upcoming': return `Event ini belum dibuka. Input dimulai ${dateID(ev.start_date)}.`;
    default:
      return closedManually(ev)
        ? 'Event ini sudah ditutup oleh admin, input tidak bisa dikirim lagi.'
        : `Periode input event ini sudah berakhir (${dateID(ev.end_date)}).`;
  }
}

export function setStatus(ev, entryId, status, note, now = new Date()) {
  if (!STATUSES.includes(status)) throw new UserError('Status tidak dikenal.');
  const adminNote = cleanText(note, LIMITS.adminNote, 'Catatan');
  const out = structuredClone(ev);
  const e = out.entries.find((x) => x.id === entryId);
  if (!e) throw new UserError('Entri tidak ditemukan.');
  e.status = status;
  e.admin_note = adminNote;
  e.verified_at = status === STATUS.PENDING ? null : now.toISOString();
  return out;
}

export function deleteEntry(ev, entryId) {
  const out = structuredClone(ev);
  const n = out.entries.length;
  out.entries = out.entries.filter((x) => x.id !== entryId);
  if (out.entries.length === n) throw new UserError('Entri tidak ditemukan.');
  return out;
}

export function summary(ev) {
  const s = { total: ev.entries.length, pending: 0, valid: 0, invalid: 0, total_amount: 0, valid_amount: 0 };
  for (const e of ev.entries) {
    s[e.status] += 1;
    s.total_amount += e.amount;
    if (e.status === STATUS.VALID) s.valid_amount += e.amount;
  }
  return s;
}

/** Id entri yang punya "kembaran" (nama+nominal+tanggal transfer sama). */
export function duplicates(ev) {
  const groups = new Map();
  for (const e of ev.entries) {
    const k = `${e.name.toLowerCase()}|${e.amount}|${e.transfer_date}`;
    (groups.get(k) ?? groups.set(k, []).get(k)).push(e.id);
  }
  const out = new Set();
  for (const ids of groups.values()) if (ids.length > 1) ids.forEach((i) => out.add(i));
  return out;
}

/** true bila entri dikirim di luar rentang tanggal input event (zona waktu tz). */
export function outsidePeriod(ev, entry, tz) {
  const d = dateIn(tz, new Date(entry.submitted_at));
  return d < ev.start_date || d > ev.end_date;
}

export function sortEntries(entries, by = 'transfer', dir = 'asc') {
  const key = {
    transfer: (e) => `${e.transfer_date}|${e.submitted_at}`,
    submitted: (e) => e.submitted_at,
    name: (e) => e.name.toLowerCase(),
    amount: (e) => e.amount,
  }[by] ?? ((e) => e.submitted_at);
  const mul = dir === 'desc' ? -1 : 1;
  return [...entries].sort((a, b) => {
    const x = key(a), y = key(b);
    return (x < y ? -1 : x > y ? 1 : 0) * mul;
  });
}

// ---------- data event (file JSON) ----------

/**
 * Validasi ketat sebuah objek event dari sumber yang tidak dipercaya (file terbit, file impor,
 * localStorage). Mengembalikan objek baru dengan urutan field tetap; melempar UserError bila rusak.
 */
export function normalizeEvent(raw) {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) throw new UserError('Format event tidak valid.');
  if (!validId(raw.id)) throw new UserError('ID event tidak valid.');
  const v = validateEventInput(raw);
  if (!isIso(raw.created_at)) throw new UserError('created_at tidak valid.');
  const closedAt = raw.closed_at == null || raw.closed_at === '' ? null : raw.closed_at;
  if (closedAt !== null && !isIso(closedAt)) throw new UserError('closed_at tidak valid.');
  if (!Array.isArray(raw.entries)) throw new UserError('Daftar entri tidak valid.');
  if (raw.entries.length > LIMITS.entries) throw new UserError('Jumlah entri melebihi batas.');
  const seen = new Set();
  const entries = raw.entries.map((e) => {
    if (e === null || typeof e !== 'object') throw new UserError('Entri tidak valid.');
    if (!validEntryId(e.id)) throw new UserError('ID entri tidak valid.');
    if (seen.has(e.id)) throw new UserError('ID entri ganda.');
    seen.add(e.id);
    const base = validateEntryInput({ name: e.name, amount: String(e.amount), transfer_date: e.transfer_date });
    if (!isIso(e.submitted_at)) throw new UserError('submitted_at tidak valid.');
    if (!STATUSES.includes(e.status)) throw new UserError('Status entri tidak valid.');
    const verifiedAt = e.verified_at == null ? null : e.verified_at;
    if (verifiedAt !== null && !isIso(verifiedAt)) throw new UserError('verified_at tidak valid.');
    return {
      id: e.id,
      name: base.name,
      amount: base.amount,
      transfer_date: base.transfer_date,
      submitted_at: e.submitted_at,
      status: e.status,
      admin_note: cleanText(e.admin_note, LIMITS.adminNote, 'Catatan'),
      verified_at: verifiedAt,
    };
  });
  return {
    id: raw.id,
    name: v.name,
    description: v.description,
    start_date: v.start_date,
    end_date: v.end_date,
    created_at: raw.created_at,
    closed_at: closedAt,
    closed_by: closedAt ? cleanText(raw.closed_by, 60, 'closed_by') : '',
    entries,
  };
}

export function serializeEvent(ev) {
  return JSON.stringify(normalizeEvent(ev), null, 2) + '\n';
}

export function parseEventJSON(text) {
  let raw;
  try { raw = JSON.parse(text); } catch { throw new UserError('File bukan JSON yang valid.'); }
  return normalizeEvent(raw);
}

export function buildIndex(ids, now = new Date()) {
  const list = [...new Set(ids)].filter(validId).sort();
  return JSON.stringify({ updated_at: now.toISOString(), events: list }, null, 2) + '\n';
}

export function parseIndex(text) {
  let raw;
  try { raw = typeof text === 'string' ? JSON.parse(text) : text; } catch { throw new UserError('index.json bukan JSON yang valid.'); }
  if (!raw || !Array.isArray(raw.events)) throw new UserError('index.json tidak valid.');
  return [...new Set(raw.events.filter(validId))];
}

// ---------- kode kirim entri (peserta -> admin) ----------

const CODE_PREFIX = 'TC1.';

function b64urlEncode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (const b of bytes) bin += String.fromCharCode(b);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64urlDecode(s) {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
  return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
}

export function encodeEntryCode(eventId, entry) {
  const payload = { e: eventId, i: entry.id, n: entry.name, a: entry.amount, d: entry.transfer_date, t: entry.submitted_at };
  return CODE_PREFIX + b64urlEncode(JSON.stringify(payload));
}

/** Membaca satu kode kirim. Melempar UserError bila rusak/tidak valid. */
export function decodeEntryCode(code) {
  const c = String(code ?? '').trim();
  if (!c.startsWith(CODE_PREFIX) || c.length > LIMITS.code) throw new UserError('Kode kirim tidak valid.');
  let p;
  try { p = JSON.parse(b64urlDecode(c.slice(CODE_PREFIX.length))); } catch { throw new UserError('Kode kirim rusak.'); }
  if (!p || typeof p !== 'object' || !validId(p.e) || !validEntryId(p.i)) throw new UserError('Kode kirim tidak valid.');
  if (!isIso(p.t)) throw new UserError('Kode kirim tidak valid.');
  const v = validateEntryInput({ name: p.n, amount: String(p.a), transfer_date: p.d });
  return {
    eventId: p.e,
    entry: { id: p.i, ...v, submitted_at: new Date(p.t).toISOString(), status: STATUS.PENDING, admin_note: '', verified_at: null },
  };
}

/** Mengambil semua kode TC1.… dari teks bebas (mis. tempelan dari WhatsApp). */
export function extractCodes(text) {
  return String(text ?? '').match(/TC1\.[A-Za-z0-9_-]+/g) ?? [];
}

/**
 * Menggabungkan kode-kode ke sebuah event. Entri dengan id yang sudah ada dilewati.
 * Kode untuk event lain dihitung "salah event".
 */
export function importCodes(ev, text) {
  const out = structuredClone(ev);
  const have = new Set(out.entries.map((e) => e.id));
  const res = { event: out, added: 0, duplicate: 0, wrongEvent: 0, invalid: 0, full: 0 };
  for (const code of extractCodes(text)) {
    let d;
    try { d = decodeEntryCode(code); } catch { res.invalid++; continue; }
    if (d.eventId !== ev.id) { res.wrongEvent++; continue; }
    if (have.has(d.entry.id)) { res.duplicate++; continue; }
    if (out.entries.length >= LIMITS.entries) { res.full++; continue; }
    out.entries.push(d.entry);
    have.add(d.entry.id);
    res.added++;
  }
  return res;
}

// ---------- CSV ----------

function csvCell(v, isText) {
  let s = String(v);
  if (isText && /^[=+\-@\t\r]/.test(s)) s = "'" + s; // cegah formula injection di Excel/Sheets
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

const STATUS_LABEL = { pending: 'Menunggu', valid: 'Valid', invalid: 'Tidak valid' };
export const statusLabel = (s) => STATUS_LABEL[s] ?? s;

export function toCSV(ev, tz) {
  const rows = [['Nama', 'Nominal', 'Tanggal Transfer', 'Waktu Input', 'Status', 'Catatan Admin']];
  for (const e of sortEntries(ev.entries, 'transfer')) {
    rows.push([
      csvCell(e.name, true), String(e.amount), e.transfer_date, csvCell(dateTimeID(e.submitted_at, tz), true),
      statusLabel(e.status), csvCell(e.admin_note, true),
    ]);
  }
  return '﻿' + rows.map((r) => r.join(',')).join('\r\n') + '\r\n';
}

// ---------- login admin (gerbang UI) ----------

export async function sha256Hex(text) {
  const buf = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Perbandingan string tanpa early-exit. */
export function safeEqual(a, b) {
  const x = String(a), y = String(b);
  let diff = x.length ^ y.length;
  const n = Math.max(x.length, y.length);
  for (let i = 0; i < n; i++) diff |= (x.charCodeAt(i) || 0) ^ (y.charCodeAt(i) || 0);
  return diff === 0;
}

export function configProblem(cfg) {
  const a = cfg?.admin ?? {};
  if (!a.username || !/^[a-f0-9]{64}$/.test(a.password_sha256 ?? '')) {
    return 'Login admin belum diatur. Isi admin.username dan admin.password_sha256 di config.js (lihat README). Bila sudah diisi dan di-push, tunggu ±1–2 menit lalu muat ulang paksa halaman (Cmd/Ctrl+Shift+R).';
  }
  try { new Intl.DateTimeFormat('en-US', { timeZone: cfg.timezone }); } catch { return `Zona waktu "${cfg.timezone}" tidak dikenal.`; }
  return '';
}
