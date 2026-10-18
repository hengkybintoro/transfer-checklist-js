// Halaman admin: login, dashboard, form event, dan halaman verifikasi.
// Semua perubahan langsung ke backend (Supabase atau server Node.js) lewat liveApi.
import {
  supabaseProblem, UserError, eventState, closedManually, summary, duplicates, sortEntries, toCSV,
  rupiah, dateID, dateTimeID, STATUSES, statusLabel,
} from './core.js';
import { h, download } from './dom.js';
import { datePicker } from './datepicker.js';
import {
  config, tz, today, loadPublished, flash, go, stateChip, statusChip, periodText, statsStrip, field, notFound, errorBox,
} from './ui.js';
import { isSupabase, liveApi } from './mode.js';
import { liveLogin } from './session.js';

/** Menjalankan aksi; UserError diubah menjadi pesan flash lalu halaman digambar ulang. */
async function act(rerender, fn) {
  try { await fn(); } catch (e) {
    if (!(e instanceof UserError)) throw e;
    flash('err', e.message);
  }
  rerender();
}

const entryUrl = (ev, id) => `admin/events/${ev.id}/entries${id ? `/${id}` : ''}`;
const doSetStatus = (ev, entryId, status, note) => liveApi('POST', `${entryUrl(ev, entryId)}/status`, { status, note });
const doDeleteEntry = (ev, entryId) => liveApi('DELETE', entryUrl(ev, entryId));
const doAddEntry = (ev, input) => liveApi('POST', entryUrl(ev), input);

// ---------- login ----------

let afterLogin = '#/admin';
export const setAfterLogin = (hash) => { afterLogin = typeof hash === 'string' && hash.startsWith('#/admin') && !hash.startsWith('#/admin/login') ? hash : '#/admin'; };

export function renderLogin() {
  const problem = isSupabase ? supabaseProblem(config) : '';
  const err = h('div', { class: 'flash err', role: 'alert', hidden: true });
  const user = h('input', { type: 'text', id: 'l-user', name: 'username', autocomplete: 'username', autocapitalize: 'none', spellcheck: 'false', required: true });
  const pass = h('input', { type: 'password', id: 'l-pass', name: 'password', autocomplete: 'current-password', required: true });
  const submit = h('button', { class: 'btn primary block', type: 'submit', disabled: Boolean(problem) }, 'Masuk');
  const show = (m) => { err.textContent = m; err.hidden = false; };

  const form = h('form', { class: 'card', novalidate: true, style: 'max-width:420px;margin:0 auto' },
    h('h1', null, 'Login Admin'),
    problem ? errorBox(problem) : null,
    err,
    field('Username', user, null, 'l-user'),
    field('Password', pass, null, 'l-pass'),
    submit);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    if (problem) return;
    submit.disabled = true;
    try {
      await liveLogin(user.value.trim(), pass.value);
      flash('ok', 'Berhasil masuk.');
      const dest = afterLogin;
      afterLogin = '#/admin';
      go(dest);
    } catch (x) {
      if (!(x instanceof UserError)) throw x;
      show(x.message);
    } finally {
      submit.disabled = false;
      pass.value = '';
    }
  });
  return form;
}

// ---------- dashboard ----------

export async function renderDashboard({ rerender }) {
  const pub = await loadPublished();
  const evs = [...pub.events].sort((a, b) => (a.end_date < b.end_date ? 1 : a.end_date > b.end_date ? -1 : a.name.localeCompare(b.name)));

  return [
    h('div', { class: 'row between' }, h('h1', null, 'Dashboard Admin')),
    pub.errors.length ? h('div', { class: 'flash warn' }, `Event yang gagal dimuat: ${pub.errors.map((e) => `${e.id} (${e.message})`).join('; ')}.`) : null,
    h('div', { class: 'row', style: 'margin-bottom:16px' },
      h('a', { class: 'btn primary', href: '#/admin/new' }, 'Event baru'),
      h('button', { class: 'btn', type: 'button', onclick: () => rerender() }, 'Muat ulang')),
    evs.length ? evs.map((ev) => {
      const s = summary(ev);
      const manual = closedManually(ev);
      return h('div', { class: 'card' },
        h('div', { class: 'row between' },
          h('h2', { style: 'margin:0' }, ev.name),
          h('span', { class: 'row' }, stateChip(ev), manual ? h('span', { class: 'chip' }, 'Ditutup manual') : null)),
        h('p', { class: 'muted small', style: 'margin:8px 0' }, `${periodText(ev)} · ${s.total} entri (${s.pending} menunggu, ${s.valid} valid, ${s.invalid} tidak valid)`),
        h('div', { class: 'row' },
          h('a', { class: 'btn sm primary', href: `#/admin/e/${ev.id}` }, 'Kelola & verifikasi'),
          manual
            ? h('button', { class: 'btn sm', type: 'button', onclick: () => toggleClose(ev, rerender) }, 'Buka kembali')
            : h('button', { class: 'btn sm danger', type: 'button', onclick: () => toggleClose(ev, rerender) }, 'Tutup event')));
    }) : h('div', { class: 'card empty' }, 'Belum ada event. Klik "Event baru" untuk memulai.'),
  ];
}

function toggleClose(ev, rerender) {
  const manual = closedManually(ev);
  if (!manual && !confirm(`Tutup event "${ev.name}"? Event hilang dari beranda dan tidak menerima entri baru.`)) return;
  act(rerender, async () => {
    const next = (await liveApi('POST', `admin/events/${ev.id}/${manual ? 'reopen' : 'close'}`, {})).event;
    if (!manual) flash('ok', `Event "${ev.name}" ditutup.`);
    else if (eventState(next, today()) === 'closed') flash('warn', `Event dibuka kembali, tetapi tanggal selesai (${dateID(next.end_date)}) sudah lewat sehingga tetap ditutup. Ubah tanggal lewat "Edit info".`);
    else flash('ok', `Event "${ev.name}" dibuka kembali.`);
  });
}

// ---------- form event ----------

export async function renderEventForm(id) {
  const pub = await loadPublished();
  const editing = id ? pub.byId.get(id) ?? null : null;
  if (id && !editing) return notFound('Event tidak ditemukan.');

  const err = h('div', { class: 'flash err', role: 'alert', hidden: true });
  const name = h('input', { type: 'text', id: 'e-name', maxlength: '100', required: true, value: editing?.name ?? '' });
  // Tanggal dipilih lewat kalender. Tanggal selesai tidak boleh sebelum tanggal mulai, dan ikut maju bila mulai digeser melewatinya.
  const start = datePicker({
    id: 'e-start', value: editing?.start_date ?? today(), today,
    onchange: (v) => { if (end.value && end.value < v) end.value = v; },
  });
  const end = datePicker({ id: 'e-end', value: editing?.end_date ?? '', today, min: () => start.value, range: () => start.value || null });
  const desc = h('textarea', { id: 'e-desc', maxlength: '1000' });
  desc.value = editing?.description ?? '';

  const form = h('form', { class: 'card', novalidate: true },
    h('h1', null, editing ? 'Edit event' : 'Event baru'),
    err,
    field('Nama event', name, null, 'e-name'),
    h('div', { class: 'fields-2' },
      field('Tanggal mulai input', start.el, 'Klik untuk memilih dari kalender. Inklusif.', 'e-start'),
      field('Tanggal selesai input', end.el, 'Klik untuk memilih dari kalender. Inklusif; setelah tanggal ini event otomatis tertutup.', 'e-end')),
    field('Deskripsi / info rekening', desc, 'Ditampilkan di halaman event (publik).', 'e-desc'),
    h('div', { class: 'row' },
      h('button', { class: 'btn primary', type: 'submit' }, 'Simpan'),
      h('a', { class: 'btn', href: editing ? `#/admin/e/${editing.id}` : '#/admin' }, 'Batal')));

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    try {
      const input = { name: name.value, description: desc.value, start_date: start.value, end_date: end.value };
      const saved = (await liveApi(editing ? 'PUT' : 'POST', editing ? `admin/events/${editing.id}` : 'admin/events', input)).event;
      flash('ok', editing ? 'Info event disimpan.' : 'Event dibuat.');
      go(`#/admin/e/${saved.id}`);
    } catch (x) {
      if (!(x instanceof UserError)) throw x;
      err.textContent = x.message;
      err.hidden = false;
    }
  });
  return form;
}

// ---------- verifikasi event ----------

const view = { status: 'all', sort: 'transfer', dir: 'asc' };

function select(id, label, value, options, onchange) {
  const el = h('select', { id, onchange: (e) => onchange(e.target.value) },
    options.map(([v, t]) => h('option', { value: v, selected: v === value }, t)));
  return h('div', null, h('label', { for: id, class: 'small' }, label), el);
}

function entryRow(ev, e, dups, rerender) {
  const note = h('input', { type: 'text', maxlength: '200', value: e.admin_note, placeholder: 'Catatan (tampil publik bila tidak valid)', 'aria-label': `Catatan untuk ${e.name}` });
  const setTo = (status) => act(rerender, () => doSetStatus(ev, e.id, status, note.value));
  const btn = (status, text, cls) => h('button', { class: `btn sm ${cls}`, type: 'button', onclick: () => setTo(status) }, text);
  return h('tr', null,
    h('td', { 'data-label': 'Nama' }, h('strong', null, e.name),
      dups.has(e.id) ? h('span', { class: 'chip warn', style: 'margin-left:6px' }, 'mungkin ganda') : null),
    h('td', { class: 'num', 'data-label': 'Nominal' }, rupiah(e.amount)),
    h('td', { class: 'nowrap', 'data-label': 'Tgl transfer' }, dateID(e.transfer_date)),
    h('td', { class: 'nowrap', 'data-label': 'Diinput' }, dateTimeID(e.submitted_at, tz)),
    h('td', { 'data-label': 'Status' }, statusChip(e.status)),
    h('td', null, h('div', { class: 'verify-controls' }, note,
      h('div', { class: 'btns' },
        btn('valid', '✓ Valid', 'ok'),
        btn('invalid', '✗ Tidak valid', 'danger'),
        btn('pending', 'Menunggu', ''),
        h('button', {
          class: 'btn sm danger', type: 'button', 'aria-label': `Hapus entri ${e.name}`,
          onclick: () => { if (confirm(`Hapus entri ${e.name} (${rupiah(e.amount)})? Tindakan ini tidak bisa dibatalkan.`)) act(rerender, () => doDeleteEntry(ev, e.id)); },
        }, 'Hapus')))));
}

function manualPanel(ev, rerender) {
  const name = h('input', { type: 'text', id: 'm-name', maxlength: '80' });
  const amount = h('input', { type: 'text', id: 'm-amount', inputmode: 'numeric' });
  const date = datePicker({ id: 'm-date', value: today(), today, max: () => today() });
  return h('details', { class: 'panel' },
    h('summary', null, 'Tambah entri manual (mis. dari mutasi rekening)'),
    h('div', { class: 'fields-2' }, field('Nama', name, null, 'm-name'), field('Nominal (Rp)', amount, null, 'm-amount')),
    field('Tanggal transfer', date.el, null, 'm-date'),
    h('button', { class: 'btn', type: 'button', onclick: () => act(rerender, async () => {
      await doAddEntry(ev, { name: name.value, amount: amount.value, transfer_date: date.value });
      flash('ok', 'Entri ditambahkan.');
    }) }, 'Tambah'));
}

export async function renderAdminEvent(id, { rerender }) {
  const pub = await loadPublished();
  const ev = pub.byId.get(id);
  if (!ev) return notFound('Event tidak ditemukan.');
  const manual = closedManually(ev);
  const s = summary(ev);
  const dups = duplicates(ev);
  let list = ev.entries;
  if (view.status !== 'all') list = list.filter((e) => e.status === view.status);
  list = sortEntries(list, view.sort, view.dir);
  const set = (k) => (v) => { view[k] = v; rerender(); };

  return [
    h('p', null, h('a', { href: '#/admin' }, '← Dashboard')),
    h('div', { class: 'row between' }, h('h1', null, ev.name), h('span', { class: 'row' }, stateChip(ev), manual ? h('span', { class: 'chip' }, 'Ditutup manual') : null)),
    h('p', { class: 'muted' }, `Periode input: ${periodText(ev)} · id: ${ev.id}`),
    ev.description ? h('div', { class: 'card pre' }, ev.description) : null,
    h('div', { class: 'row', style: 'margin-bottom:16px' },
      h('a', { class: 'btn sm', href: `#/admin/e/${ev.id}/edit` }, 'Edit info'),
      manual
        ? h('button', { class: 'btn sm', type: 'button', onclick: () => toggleClose(ev, rerender) }, 'Buka kembali')
        : h('button', { class: 'btn sm danger', type: 'button', onclick: () => toggleClose(ev, rerender) }, 'Tutup event'),
      h('button', { class: 'btn sm', type: 'button', onclick: () => download(`${ev.id}.csv`, toCSV(ev, tz), 'text/csv;charset=utf-8') }, 'Unduh CSV'),
      h('a', { class: 'btn sm', href: `#/e/${ev.id}` }, 'Lihat halaman publik')),
    statsStrip(s),
    manualPanel(ev, rerender),
    h('div', { class: 'card' },
      h('div', { class: 'row', style: 'margin-bottom:12px' },
        select('f-status', 'Status', view.status, [['all', 'Semua'], ...STATUSES.map((x) => [x, statusLabel(x)])], set('status')),
        select('f-sort', 'Urutkan', view.sort, [['transfer', 'Tgl transfer (sesuai mutasi)'], ['submitted', 'Waktu input'], ['name', 'Nama'], ['amount', 'Nominal']], set('sort')),
        select('f-dir', 'Arah', view.dir, [['asc', 'Naik'], ['desc', 'Turun']], set('dir'))),
      list.length
        ? h('div', { class: 'table-wrap' }, h('table', { class: 'stack' },
          h('thead', null, h('tr', null, ['Nama', 'Nominal', 'Tgl transfer', 'Diinput', 'Status', 'Verifikasi'].map((t) => h('th', { class: t === 'Nominal' ? 'num' : '' }, t)))),
          h('tbody', null, list.map((e) => entryRow(ev, e, dups, rerender)))))
        : h('div', { class: 'empty' }, ev.entries.length ? 'Tidak ada entri dengan filter ini.' : 'Belum ada entri. Entri yang dikirim peserta akan muncul di sini.')),
  ];
}
