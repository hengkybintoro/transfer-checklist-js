// Halaman publik: beranda (event aktif) dan halaman event (form + daftar entri).
import {
  isActive, eventState, submitBlockReason, validateEntryInput, summary, sortEntries, rupiah, dateID, dateTimeID, UserError,
} from './core.js';
import { h } from './dom.js';
import { datePicker } from './datepicker.js';
import { tz, today, loadPublished, stateChip, statusChip, periodText, statsStrip, field, notFound, flash } from './ui.js';
import { liveApi } from './mode.js';

function pubWarnings(pub) {
  if (!pub.errors.length) return null;
  return h('div', { class: 'flash warn', role: 'status' },
    `Sebagian event gagal dimuat: ${pub.errors.map((e) => `${e.id} (${e.message})`).join('; ')}.`);
}

// ---------- beranda ----------

export async function renderHome() {
  const pub = await loadPublished();
  const t = today();
  const active = pub.events.filter((e) => isActive(e, t));

  const body = [h('h1', null, 'Event Aktif'), h('p', { class: 'muted' }, 'Pilih event untuk mencatat transfer Anda dan melihat status verifikasinya.')];
  body.push(pubWarnings(pub));
  if (!active.length) {
    body.push(h('div', { class: 'card empty' }, 'Belum ada event yang sedang dibuka. Silakan cek lagi nanti.'));
  } else {
    body.push(h('div', { class: 'grid' }, active.map((ev) => {
      const s = summary(ev);
      return h('a', { class: 'event-card', href: `#/e/${ev.id}` },
        h('strong', null, ev.name),
        h('div', { class: 'muted small' }, `Input sampai ${dateID(ev.end_date)}`),
        h('div', { class: 'row', style: 'margin-top:8px' }, stateChip(ev), h('span', { class: 'muted small' }, `${s.total} entri · ${s.valid} valid`)));
    })));
  }
  return body;
}

// ---------- halaman event ----------

function entryForm(ev, rerender) {
  const t = today();
  const err = h('div', { class: 'flash err', role: 'alert', hidden: true });
  const name = h('input', { type: 'text', id: 'f-name', name: 'name', maxlength: '80', required: true, autocomplete: 'name' });
  const amount = h('input', { type: 'text', id: 'f-amount', name: 'amount', inputmode: 'numeric', required: true, placeholder: 'mis. 1.500.000', autocomplete: 'off' });
  // Tanggal transfer dipilih dari kalender (sama seperti form event); tidak boleh melewati hari ini.
  const date = datePicker({ id: 'f-date', value: t, today, max: () => today() });
  const submit = h('button', { class: 'btn primary', type: 'submit' }, 'Simpan entri');
  const form = h('form', { novalidate: true, class: 'card' },
    h('h2', null, 'Catat transfer'),
    err,
    field('Nama', name, 'Sesuai nama pengirim di mutasi rekening.', 'f-name'),
    h('div', { class: 'fields-2' },
      field('Nominal (Rp)', amount, 'Angka bulat, contoh 1500000 atau 1.500.000.', 'f-amount'),
      field('Tanggal transfer', date.el, null, 'f-date')),
    submit,
    h('p', { class: 'hint', style: 'margin-top:12px' }, 'Entri langsung tercatat dengan status Menunggu, lalu diverifikasi admin terhadap mutasi rekening.'));
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    err.hidden = true;
    submit.disabled = true;
    try {
      const reason = submitBlockReason(ev, today());
      if (reason) throw new UserError(reason);
      validateEntryInput({ name: name.value, amount: amount.value, transfer_date: date.value }, today());
      // database memeriksa ulang semua aturan (periode memakai jam server)
      await liveApi('POST', `events/${ev.id}/entries`, { name: name.value, amount: amount.value, transfer_date: date.value });
      flash('ok', 'Entri tercatat dengan status Menunggu. Admin akan memverifikasinya terhadap mutasi rekening.');
      rerender();
    } catch (x) {
      if (!(x instanceof UserError)) throw x;
      err.textContent = x.message;
      err.hidden = false;
      err.scrollIntoView({ block: 'nearest' });
      submit.disabled = false;
    }
  });
  return form;
}

function entriesTable(ev) {
  if (!ev.entries.length) return h('div', { class: 'card empty' }, 'Belum ada entri yang tercatat.');
  const rows = sortEntries(ev.entries, 'submitted', 'desc').map((e) => h('tr', null,
    h('td', { 'data-label': 'Nama' }, h('strong', null, e.name)),
    h('td', { class: 'num', 'data-label': 'Nominal' }, rupiah(e.amount)),
    h('td', { 'data-label': 'Tgl transfer', class: 'nowrap' }, dateID(e.transfer_date)),
    h('td', { 'data-label': 'Diinput', class: 'nowrap' }, dateTimeID(e.submitted_at, tz)),
    h('td', { 'data-label': 'Status' }, statusChip(e.status),
      e.status === 'invalid' && e.admin_note ? h('div', { class: 'notes' }, e.admin_note) : null)));
  return h('div', { class: 'card table-wrap' },
    h('table', { class: 'stack' },
      h('thead', null, h('tr', null, h('th', null, 'Nama'), h('th', { class: 'num' }, 'Nominal'), h('th', null, 'Tgl transfer'), h('th', null, 'Diinput'), h('th', null, 'Status'))),
      h('tbody', null, rows)));
}

export async function renderEvent(id, { rerender }) {
  const pub = await loadPublished();
  const ev = pub.byId.get(id);
  if (!ev) {
    return notFound(pub.errors.some((e) => e.id === id) ? 'Data event ini gagal dimuat. Coba lagi nanti.' : 'Event tidak ditemukan.');
  }
  const t = today();
  const state = eventState(ev, t);
  const reason = submitBlockReason(ev, t);

  return [
    h('p', null, h('a', { href: '#/' }, '← Semua event aktif')),
    h('div', { class: 'row between' }, h('h1', null, ev.name), stateChip(ev)),
    h('p', { class: 'muted' }, `Periode input: ${periodText(ev)}`),
    ev.description ? h('div', { class: 'card pre' }, ev.description) : null,
    state === 'open' ? entryForm(ev, rerender) : h('div', { class: 'flash warn', role: 'status' }, reason),
    h('div', { class: 'row between' }, h('h2', null, 'Daftar entri'),
      h('button', { class: 'btn sm', type: 'button', onclick: () => rerender() }, 'Muat ulang')),
    statsStrip(summary(ev)),
    entriesTable(ev),
    h('p', { class: 'muted small' }, 'Catatan admin hanya ditampilkan untuk entri tidak valid.'),
  ];
}
